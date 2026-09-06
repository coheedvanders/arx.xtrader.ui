import {
    type CandleInfo,
    type PriceAction,
    type PriceActionEvent,
    type PriceActionReclaim,
    type PriceActionBreakout,
    type PriceActionSequence,
    type SIGNAL_DIRECTION,
    type ActiveAnchors,
    type ActiveAnchor,
} from '@/core/interfacesv2'


// ==================================================
// CONFIG
// ==================================================

const CONFIG = {

    // --------------------------------------------------
    // Structural levels
    // --------------------------------------------------

    STRUCTURAL_LOOKBACK: 20,

    LIQUIDITY_LOOKBACK: 10,

    VOLUME_LOOKBACK: 20,

    DISPLACEMENT_LOOKBACK: 5,


    // --------------------------------------------------
    // Anchor interaction
    // --------------------------------------------------

    // Minimum distance beyond an anchor level in ATR.
    MIN_LEVEL_BUFFER_ATR: 0.05,

    BREAKOUT_MIN_CLOSE_BEYOND_ATR: 0.10,

    REJECTION_MIN_PENETRATION_ATR: 0.05,


    // --------------------------------------------------
    // Displacement
    // --------------------------------------------------

    DISPLACEMENT_MIN_RANGE_ATR: 1.2,

    DISPLACEMENT_MIN_BODY_ATR: 0.7,

    DISPLACEMENT_MIN_BODY_RATIO: 0.55,

    DISPLACEMENT_MIN_CLOSE_LOCATION: 0.65,

    DISPLACEMENT_MIN_MOVE_ATR: 0.8,


    // --------------------------------------------------
    // Sequence
    // --------------------------------------------------

    CLOSE_CONFIRMATION_LOCATION_LONG: 0.60,

    CLOSE_CONFIRMATION_LOCATION_SHORT: 0.40,


    // --------------------------------------------------
    // Dominant direction
    // --------------------------------------------------

    DOMINANT_MIN_SCORE: 30,

    DOMINANT_MIN_MARGIN: 12,


    // --------------------------------------------------
    // Anchor relevance
    // --------------------------------------------------

    // Minimum active-anchor relevance before Price Action
    // considers the anchor a meaningful source of levels.
    MIN_ANCHOR_RELEVANCE: 25,

    // Weight applied when an event occurs directly at
    // an active anchor rather than only a structural level.
    ANCHOR_EVENT_BONUS: 15,

} as const


// ==================================================
// SAFE MATH
// ==================================================

function safeNumber(
    n: number | undefined | null,
    fallback = 0
): number {

    if (n === undefined || n === null) {
        return fallback
    }

    if (!Number.isFinite(n)) {
        return fallback
    }

    return n
}


function clamp(
    n: number,
    min: number,
    max: number
): number {

    const safe = safeNumber(n, min)

    return Math.min(
        max,
        Math.max(min, safe)
    )
}


function round2(n: number): number {

    return Math.round(
        safeNumber(n) * 100
    ) / 100
}


// ==================================================
// EMPTY / NEUTRAL BUILDERS
// ==================================================

function emptyEvent(
    reason = 'Insufficient evidence'
): PriceActionEvent {

    return {
        detected: false,
        direction: 'NEUTRAL',
        strength: 0,
        reasons: [reason],
    }
}


function emptyReclaim(
    reason = 'Insufficient evidence for reclaim'
): PriceActionReclaim {

    return {
        detected: false,
        direction: 'NEUTRAL',
        strength: 0,
        reasons: [reason],
        level: 0,
        penetration: 0,
        closeDistance: 0,
    }
}


function emptyBreakout(
    reason = 'Insufficient evidence'
): PriceActionBreakout {

    return {
        detected: false,
        direction: 'NEUTRAL',
        strength: 0,
        reasons: [reason],
        level: 0,
        volumeConfirmation: 0,
        displacementConfirmation: 0,
    }
}


function emptySequence(): PriceActionSequence {

    return {
        liquiditySweep: false,
        rejection: false,
        reclaim: false,
        displacement: false,
        closeConfirmation: false,
        completion: 0,
        direction: 'NEUTRAL',
    }
}


function buildNeutralPriceAction(
    reason: string
): PriceAction {

    return {
        displacement: emptyEvent(reason),
        rejection: emptyEvent(reason),
        reclaim: emptyReclaim(reason),
        breakout: emptyBreakout(reason),
        failedBreakout: emptyBreakout(reason),
        liquiditySweep: emptyEvent(reason),
        sequence: emptySequence(),

        long: 0,
        short: 0,

        dominant: 'NEUTRAL',

        strength: 0,

        reasons: [reason],
    }
}


// ==================================================
// STRUCTURAL LEVELS
// ==================================================

interface LevelInfo {

    high: number
    low: number

    valid: boolean

    source: string
}


function getPriorLevels(
    candles: CandleInfo[],
    lookback: number
): LevelInfo {

    const priorCandles =
        candles.slice(0, candles.length - 1)

    if (priorCandles.length === 0) {

        return {
            high: NaN,
            low: NaN,
            valid: false,
            source: 'STRUCTURE',
        }
    }

    const window =
        priorCandles.slice(
            Math.max(
                0,
                priorCandles.length - lookback
            )
        )

    if (window.length === 0) {

        return {
            high: NaN,
            low: NaN,
            valid: false,
            source: 'STRUCTURE',
        }
    }

    const high =
        Math.max(
            ...window.map(c => c.high)
        )

    const low =
        Math.min(
            ...window.map(c => c.low)
        )

    return {
        high,
        low,
        valid:
            Number.isFinite(high) &&
            Number.isFinite(low),
        source: 'STRUCTURE',
    }
}


// ==================================================
// ACTIVE ANCHOR LEVELS
// ==================================================

interface AnchorLevel {

    level: number

    source:
        | 'AVWAP'
        | 'FRVP_POC'
        | 'FRVP_VALUE_AREA_HIGH'
        | 'FRVP_VALUE_AREA_LOW'
        | 'LIQUIDATION_HEATMAP'

    anchor: ActiveAnchor

    relevance: number

    description: string
}


function isAnchorRelevant(
    anchor: ActiveAnchor | null | undefined
): anchor is ActiveAnchor {

    if (!anchor) {
        return false
    }

    return (
        safeNumber(anchor.anchor.relevance) >=
        CONFIG.MIN_ANCHOR_RELEVANCE
    )
}


function addAnchorLevel(
    levels: AnchorLevel[],
    level: number,
    source: AnchorLevel['source'],
    anchor: ActiveAnchor,
    description: string
): void {

    if (!Number.isFinite(level)) {
        return
    }

    if (!isAnchorRelevant(anchor)) {
        return
    }

    levels.push({
        level,
        source,
        anchor,
        relevance: safeNumber(
            anchor.anchor.relevance
        ),
        description,
    })
}


// --------------------------------------------------
// AVWAP
// --------------------------------------------------

function addAvwapLevels(
    levels: AnchorLevel[],
    active: ActiveAnchor
): void {

    const zone =
        active.analysis.avwap

    if (!zone) {
        return
    }

    addAnchorLevel(
        levels,
        zone.mid,
        'AVWAP',
        active,
        `AVWAP ${zone.mid.toFixed(2)}`
    )

    addAnchorLevel(
        levels,
        zone.upper,
        'AVWAP',
        active,
        `AVWAP upper ${zone.upper.toFixed(2)}`
    )

    addAnchorLevel(
        levels,
        zone.lower,
        'AVWAP',
        active,
        `AVWAP lower ${zone.lower.toFixed(2)}`
    )
}


// --------------------------------------------------
// FRVP
// --------------------------------------------------

function addFrvpLevels(
    levels: AnchorLevel[],
    active: ActiveAnchor
): void {

    const profile =
        active.analysis.frvp

    if (!profile) {
        return
    }

    addAnchorLevel(
        levels,
        profile.pocPrice,
        'FRVP_POC',
        active,
        `FRVP POC ${profile.pocPrice.toFixed(2)}`
    )

    addAnchorLevel(
        levels,
        profile.valueAreaHigh,
        'FRVP_VALUE_AREA_HIGH',
        active,
        `FRVP value-area high ${profile.valueAreaHigh.toFixed(2)}`
    )

    addAnchorLevel(
        levels,
        profile.valueAreaLow,
        'FRVP_VALUE_AREA_LOW',
        active,
        `FRVP value-area low ${profile.valueAreaLow.toFixed(2)}`
    )
}


// --------------------------------------------------
// LIQUIDATION HEATMAP
// --------------------------------------------------

function addHeatmapLevels(
    levels: AnchorLevel[],
    active: ActiveAnchor
): void {

    const heatmap =
        active.analysis.heatmap

    if (!heatmap || heatmap.cells.length === 0) {
        return
    }

    const cells =
        heatmap.cells.filter(
            cell =>
                Number.isFinite(cell.intensity) &&
                Number.isFinite(cell.priceLow) &&
                Number.isFinite(cell.priceHigh)
        )

    if (cells.length === 0) {
        return
    }

    const strongestCell =
        cells.reduce(
            (best, cell) =>
                cell.intensity > best.intensity
                    ? cell
                    : best,
            cells[0]
        )

    const level =
        (
            strongestCell.priceLow +
            strongestCell.priceHigh
        ) / 2

    addAnchorLevel(
        levels,
        level,
        'LIQUIDATION_HEATMAP',
        active,
        `Strongest liquidation pool ${level.toFixed(2)}`
    )
}


// ==================================================
// BUILD ACTIVE ANCHOR LEVELS
// ==================================================

function getActiveAnchorLevels(
    current: CandleInfo
): AnchorLevel[] {

    const active =
        current.anchors?.active

    if (!active) {
        return []
    }

    const levels: AnchorLevel[] = []

    if (isAnchorRelevant(active.avwap)) {

        addAvwapLevels(
            levels,
            active.avwap
        )
    }

    if (isAnchorRelevant(active.frvp)) {

        addFrvpLevels(
            levels,
            active.frvp
        )
    }

    if (isAnchorRelevant(active.liquidityHeatmap)) {

        addHeatmapLevels(
            levels,
            active.liquidityHeatmap
        )
    }

    return levels
}


// ==================================================
// FIND RELEVANT LEVELS
// ==================================================

function getMeaningfulLevels(
    candles: CandleInfo[]
): {
    structural: LevelInfo
    anchors: AnchorLevel[]
} {

    const current =
        candles[candles.length - 1]

    return {
        structural:
            getPriorLevels(
                candles,
                CONFIG.STRUCTURAL_LOOKBACK
            ),

        anchors:
            current
                ? getActiveAnchorLevels(current)
                : [],
    }
}


// ==================================================
// VOLUME CONFIRMATION
// ==================================================

function calculateVolumeConfirmation(
    candles: CandleInfo[]
): number {

    const current =
        candles[candles.length - 1]

    const priorCandles =
        candles.slice(
            0,
            candles.length - 1
        )

    const window =
        priorCandles.slice(
            Math.max(
                0,
                priorCandles.length -
                    CONFIG.VOLUME_LOOKBACK
            )
        )

    if (
        window.length === 0 ||
        !(current.volume > 0)
    ) {
        return 0
    }

    const avgVolume =
        window.reduce(
            (sum, c) =>
                sum + safeNumber(c.volume),
            0
        ) / window.length

    if (!(avgVolume > 0)) {
        return 0
    }

    const ratio =
        current.volume / avgVolume

    return clamp(
        ratio * 50,
        0,
        100
    )
}


// ==================================================
// FIND LEVEL INTERACTION
// ==================================================

interface LevelInteraction {

    level: number

    source: string

    relevance: number

    distanceAtr: number

    anchor: ActiveAnchor | null
}


function findNearestLevel(
    price: number,
    atr: number,
    levels: AnchorLevel[],
    structural: LevelInfo
): LevelInteraction | null {

    const candidates: LevelInteraction[] = []

    for (const anchorLevel of levels) {

        const distanceAtr =
            atr > 0
                ? Math.abs(
                      price -
                          anchorLevel.level
                  ) / atr
                : Infinity

        candidates.push({
            level: anchorLevel.level,
            source: anchorLevel.description,
            relevance: anchorLevel.relevance,
            distanceAtr,
            anchor: anchorLevel.anchor,
        })
    }

    if (structural.valid) {

        const highDistance =
            atr > 0
                ? Math.abs(
                      price -
                          structural.high
                  ) / atr
                : Infinity

        const lowDistance =
            atr > 0
                ? Math.abs(
                      price -
                          structural.low
                  ) / atr
                : Infinity

        candidates.push({
            level: structural.high,
            source: 'Structural high',
            relevance: 50,
            distanceAtr: highDistance,
            anchor: null,
        })

        candidates.push({
            level: structural.low,
            source: 'Structural low',
            relevance: 50,
            distanceAtr: lowDistance,
            anchor: null,
        })
    }

    if (candidates.length === 0) {
        return null
    }

    candidates.sort(
        (a, b) => {

            // Prefer close levels.
            const distanceDifference =
                a.distanceAtr -
                b.distanceAtr

            if (
                Math.abs(distanceDifference) >
                0.15
            ) {
                return distanceDifference
            }

            // If similarly close, prefer
            // the more relevant anchor.
            return (
                b.relevance -
                a.relevance
            )
        }
    )

    return candidates[0]
}


// ==================================================
// DISPLACEMENT
// ==================================================

function detectDisplacement(
    candles: CandleInfo[]
): PriceActionEvent {

    const current =
        candles[candles.length - 1]

    const cs =
        current?.candleStructure

    if (!current || !cs) {
        return emptyEvent(
            'Missing candle structure'
        )
    }

    const rangeAtrRatio =
        safeNumber(
            cs.rangeAtrRatio
        )

    const bodyAtrRatio =
        safeNumber(
            cs.bodyAtrRatio
        )

    const bodyRatio =
        safeNumber(
            cs.bodyRatio
        )

    const closeLocation =
        safeNumber(
            cs.closeLocation,
            0.5
        )

    const atr =
        safeNumber(current.atr)

    const lookback =
        Math.min(
            CONFIG.DISPLACEMENT_LOOKBACK,
            candles.length - 1
        )

    let moveAtrRatio = 0

    if (
        lookback > 0 &&
        atr > 0
    ) {

        const refCandle =
            candles[
                candles.length -
                    1 -
                    lookback
            ]

        moveAtrRatio =
            safeNumber(
                (
                    current.close -
                    refCandle.close
                ) / atr
            )
    }

    const bullishBias =
        cs.isBullish &&
        closeLocation >=
            CONFIG.DISPLACEMENT_MIN_CLOSE_LOCATION

    const bearishBias =
        cs.isBearish &&
        closeLocation <=
            1 -
            CONFIG.DISPLACEMENT_MIN_CLOSE_LOCATION

    const rangeOk =
        rangeAtrRatio >=
        CONFIG.DISPLACEMENT_MIN_RANGE_ATR

    const bodyAtrOk =
        bodyAtrRatio >=
        CONFIG.DISPLACEMENT_MIN_BODY_ATR

    const bodyRatioOk =
        bodyRatio >=
        CONFIG.DISPLACEMENT_MIN_BODY_RATIO

    const directionalMoveOk =
        lookback > 0 &&
        Math.abs(moveAtrRatio) >=
            CONFIG.DISPLACEMENT_MIN_MOVE_ATR

    const detected =
        rangeOk &&
        bodyAtrOk &&
        bodyRatioOk &&
        (bullishBias || bearishBias) &&
        directionalMoveOk

    const direction: SIGNAL_DIRECTION =
        detected
            ? bullishBias
                ? 'LONG'
                : 'SHORT'
            : 'NEUTRAL'

    const reasons: string[] = []

    if (!detected) {

        reasons.push(
            `Insufficient displacement: range=${rangeAtrRatio.toFixed(
                2
            )} ATR, body=${bodyAtrRatio.toFixed(
                2
            )} ATR, body ratio=${bodyRatio.toFixed(
                2
            )}, close location=${closeLocation.toFixed(
                2
            )}, move=${moveAtrRatio.toFixed(
                2
            )} ATR`
        )

    } else {

        reasons.push(
            `${direction === 'LONG'
                ? 'Bullish'
                : 'Bearish'
            } displacement: range=${rangeAtrRatio.toFixed(
                2
            )} ATR, body=${bodyAtrRatio.toFixed(
                2
            )} ATR, body ratio=${bodyRatio.toFixed(
                2
            )}, close location=${closeLocation.toFixed(
                2
            )}`
        )

        reasons.push(
            `Move vs ${lookback} candle(s) ago = ${moveAtrRatio.toFixed(
                2
            )} ATR`
        )
    }

    const strength =
        detected
            ? clamp(
                  (rangeAtrRatio /
                      CONFIG.DISPLACEMENT_MIN_RANGE_ATR) *
                      25 +

                      (bodyAtrRatio /
                          CONFIG.DISPLACEMENT_MIN_BODY_ATR) *
                          25 +

                      bodyRatio *
                          25 +

                      Math.min(
                          Math.abs(
                              moveAtrRatio
                          ) /
                              CONFIG.DISPLACEMENT_MIN_MOVE_ATR,
                          2
                      ) *
                          12.5,

                  0,
                  100
              )
            : 0

    return {
        detected,
        direction,
        strength: Math.round(
            strength
        ),
        reasons,
    }
}


// ==================================================
// REJECTION
// ==================================================

function detectRejection(
    candles: CandleInfo[]
): PriceActionEvent {

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {
        return emptyEvent(
            'Missing candle structure'
        )
    }

    const atr =
        safeNumber(current.atr)

    const {
        structural,
        anchors,
    } =
        getMeaningfulLevels(candles)

    if (
        !structural.valid &&
        anchors.length === 0
    ) {
        return emptyEvent(
            'No meaningful structural or anchor levels available'
        )
    }

    if (!(atr > 0)) {
        return emptyEvent(
            'Invalid ATR'
        )
    }

    const buffer =
        CONFIG.REJECTION_MIN_PENETRATION_ATR *
        atr

    // --------------------------------------------------
    // Anchor levels first
    // --------------------------------------------------

    for (const anchorLevel of anchors) {

        const level =
            anchorLevel.level

        const bearishPenetration =
            current.high -
            level

        const bearishRejection =
            bearishPenetration >= buffer &&
            current.close < level

        const bullishPenetration =
            level -
            current.low

        const bullishRejection =
            bullishPenetration >= buffer &&
            current.close > level

        if (
            bearishRejection &&
            !bullishRejection
        ) {

            const reversal =
                (
                    current.high -
                    current.close
                ) /
                Math.max(
                    bearishPenetration,
                    buffer
                )

            const strength =
                clamp(
                    (bearishPenetration /
                        atr) *
                        40 +

                        Math.min(
                            reversal,
                            1
                        ) *
                            45 +

                        CONFIG.ANCHOR_EVENT_BONUS,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'SHORT',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bearish rejection at ${anchorLevel.description}: high=${current.high.toFixed(
                        2
                    )}, penetration=${bearishPenetration.toFixed(
                        2
                    )} (${(
                        bearishPenetration /
                        atr
                    ).toFixed(
                        2
                    )} ATR), close=${current.close.toFixed(
                        2
                    )}`,
                ],
            }
        }

        if (
            bullishRejection &&
            !bearishRejection
        ) {

            const reversal =
                (
                    current.close -
                    current.low
                ) /
                Math.max(
                    bullishPenetration,
                    buffer
                )

            const strength =
                clamp(
                    (bullishPenetration /
                        atr) *
                        40 +

                        Math.min(
                            reversal,
                            1
                        ) *
                            45 +

                        CONFIG.ANCHOR_EVENT_BONUS,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'LONG',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bullish rejection at ${anchorLevel.description}: low=${current.low.toFixed(
                        2
                    )}, penetration=${bullishPenetration.toFixed(
                        2
                    )} (${(
                        bullishPenetration /
                        atr
                    ).toFixed(
                        2
                    )} ATR), close=${current.close.toFixed(
                        2
                    )}`,
                ],
            }
        }
    }

    // --------------------------------------------------
    // Structural fallback
    // --------------------------------------------------

    if (structural.valid) {

        const bearishPenetration =
            current.high -
            structural.high

        const bearishRejection =
            bearishPenetration >= buffer &&
            current.close <
                structural.high

        const bullishPenetration =
            structural.low -
            current.low

        const bullishRejection =
            bullishPenetration >= buffer &&
            current.close >
                structural.low

        if (
            bearishRejection &&
            !bullishRejection
        ) {

            const reversal =
                (
                    current.high -
                    current.close
                ) /
                Math.max(
                    bearishPenetration,
                    buffer
                )

            const strength =
                clamp(
                    (bearishPenetration /
                        atr) *
                        40 +
                        Math.min(
                            reversal,
                            1
                        ) *
                            60,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'SHORT',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bearish rejection at structural high ${structural.high.toFixed(
                        2
                    )}: high=${current.high.toFixed(
                        2
                    )}, close returned below`,
                ],
            }
        }

        if (
            bullishRejection &&
            !bearishRejection
        ) {

            const reversal =
                (
                    current.close -
                    current.low
                ) /
                Math.max(
                    bullishPenetration,
                    buffer
                )

            const strength =
                clamp(
                    (bullishPenetration /
                        atr) *
                        40 +
                        Math.min(
                            reversal,
                            1
                        ) *
                            60,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'LONG',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bullish rejection at structural low ${structural.low.toFixed(
                        2
                    )}: low=${current.low.toFixed(
                        2
                    )}, close returned above`,
                ],
            }
        }
    }

    return emptyEvent(
        'No meaningful level rejection detected'
    )
}


// ==================================================
// RECLAIM
// ==================================================

function detectReclaim(
    candles: CandleInfo[]
): PriceActionReclaim {

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {
        return emptyReclaim(
            'Missing candle structure'
        )
    }

    if (candles.length < 3) {
        return emptyReclaim(
            'Insufficient history for reclaim'
        )
    }

    const prev =
        candles[candles.length - 2]

    const atr =
        safeNumber(current.atr)

    if (!(atr > 0)) {
        return emptyReclaim(
            'Invalid ATR'
        )
    }

    const {
        structural,
        anchors,
    } =
        getMeaningfulLevels(candles)

    const buffer =
        CONFIG.MIN_LEVEL_BUFFER_ATR *
        atr

    // --------------------------------------------------
    // Anchor reclaim
    // --------------------------------------------------

    for (const anchorLevel of anchors) {

        const level =
            anchorLevel.level

        const bullishSetup =
            prev.close <
            level - buffer

        const bullishReclaim =
            bullishSetup &&
            current.close >
                level + buffer

        const bearishSetup =
            prev.close >
            level + buffer

        const bearishReclaim =
            bearishSetup &&
            current.close <
                level - buffer

        if (
            bullishReclaim &&
            !bearishReclaim
        ) {

            const penetration =
                Math.max(
                    0,
                    level -
                        Math.min(
                            current.low,
                            prev.low
                        )
                )

            const closeDistance =
                current.close -
                level

            const strength =
                clamp(
                    (
                        Math.abs(
                            closeDistance
                        ) /
                            atr
                    ) *
                        55 +

                        Math.min(
                            penetration /
                                atr,
                            1
                        ) *
                            30 +

                        CONFIG.ANCHOR_EVENT_BONUS,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'LONG',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bullish reclaim of ${anchorLevel.description}: previous close=${prev.close.toFixed(
                        2
                    )}, current close=${current.close.toFixed(
                        2
                    )}, distance above=${closeDistance.toFixed(
                        2
                    )}`,
                ],
                level: round2(level),
                penetration: round2(
                    penetration
                ),
                closeDistance: round2(
                    closeDistance
                ),
            }
        }

        if (
            bearishReclaim &&
            !bullishReclaim
        ) {

            const penetration =
                Math.max(
                    0,
                    Math.max(
                        current.high,
                        prev.high
                    ) - level
                )

            const closeDistance =
                level -
                current.close

            const strength =
                clamp(
                    (
                        Math.abs(
                            closeDistance
                        ) /
                            atr
                    ) *
                        55 +

                        Math.min(
                            penetration /
                                atr,
                            1
                        ) *
                            30 +

                        CONFIG.ANCHOR_EVENT_BONUS,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'SHORT',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bearish reclaim failure below ${anchorLevel.description}: previous close=${prev.close.toFixed(
                        2
                    )}, current close=${current.close.toFixed(
                        2
                    )}, distance below=${closeDistance.toFixed(
                        2
                    )}`,
                ],
                level: round2(level),
                penetration: round2(
                    penetration
                ),
                closeDistance: round2(
                    closeDistance
                ),
            }
        }
    }

    // --------------------------------------------------
    // Structural fallback
    // --------------------------------------------------

    if (structural.valid) {

        const bullishSetup =
            prev.close <
            structural.low -
                buffer

        const bullishReclaim =
            bullishSetup &&
            current.close >
                structural.low +
                    buffer

        if (bullishReclaim) {

            const level =
                structural.low

            const penetration =
                Math.max(
                    0,
                    level -
                        Math.min(
                            current.low,
                            prev.low
                        )
                )

            const closeDistance =
                current.close -
                level

            const strength =
                clamp(
                    (
                        Math.abs(
                            closeDistance
                        ) /
                            atr
                    ) *
                        60 +

                        Math.min(
                            penetration /
                                atr,
                            1
                        ) *
                            40,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'LONG',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bullish reclaim of structural low ${level.toFixed(
                        2
                    )}: previous close=${prev.close.toFixed(
                        2
                    )}, current close=${current.close.toFixed(
                        2
                    )}`,
                ],
                level: round2(level),
                penetration: round2(
                    penetration
                ),
                closeDistance: round2(
                    closeDistance
                ),
            }
        }

        const bearishSetup =
            prev.close >
            structural.high +
                buffer

        const bearishReclaim =
            bearishSetup &&
            current.close <
                structural.high -
                    buffer

        if (bearishReclaim) {

            const level =
                structural.high

            const penetration =
                Math.max(
                    0,
                    Math.max(
                        current.high,
                        prev.high
                    ) - level
                )

            const closeDistance =
                level -
                current.close

            const strength =
                clamp(
                    (
                        Math.abs(
                            closeDistance
                        ) /
                            atr
                    ) *
                        60 +

                        Math.min(
                            penetration /
                                atr,
                            1
                        ) *
                            40,
                    0,
                    100
                )

            return {
                detected: true,
                direction: 'SHORT',
                strength: Math.round(
                    strength
                ),
                reasons: [
                    `Bearish reclaim failure below structural high ${level.toFixed(
                        2
                    )}: previous close=${prev.close.toFixed(
                        2
                    )}, current close=${current.close.toFixed(
                        2
                    )}`,
                ],
                level: round2(level),
                penetration: round2(
                    penetration
                ),
                closeDistance: round2(
                    closeDistance
                ),
            }
        }
    }

    return emptyReclaim(
        'No reclaim detected'
    )
}


// ==================================================
// BREAKOUT
// ==================================================

function detectBreakout(
    candles: CandleInfo[],
    displacement: PriceActionEvent
): PriceActionBreakout {

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {
        return emptyBreakout(
            'Missing candle structure'
        )
    }

    const atr =
        safeNumber(current.atr)

    if (!(atr > 0)) {
        return emptyBreakout(
            'Invalid ATR'
        )
    }

    const {
        structural,
        anchors,
    } =
        getMeaningfulLevels(candles)

    const buffer =
        CONFIG.BREAKOUT_MIN_CLOSE_BEYOND_ATR *
        atr

    // --------------------------------------------------
    // Check anchor levels
    // --------------------------------------------------

    for (const anchorLevel of anchors) {

        const level =
            anchorLevel.level

        const bullishBreak =
            current.close >
                level + buffer

        const bearishBreak =
            current.close <
                level - buffer

        if (
            !bullishBreak &&
            !bearishBreak
        ) {
            continue
        }

        if (
            bullishBreak &&
            bearishBreak
        ) {
            continue
        }

        const direction:
            SIGNAL_DIRECTION =
                bullishBreak
                    ? 'LONG'
                    : 'SHORT'

        const volumeConfirmation =
            calculateVolumeConfirmation(
                candles
            )

        const displacementConfirmation =
            displacement.detected &&
            displacement.direction ===
                direction
                ? displacement.strength
                : Math.round(
                      displacement.strength *
                          0.3
                  )

        const closeBeyondAtr =
            Math.abs(
                current.close -
                    level
            ) / atr

        const strength =
            clamp(
                closeBeyondAtr * 40 +
                    volumeConfirmation *
                        0.3 +
                    displacementConfirmation *
                        0.3 +
                    CONFIG.ANCHOR_EVENT_BONUS,
                0,
                100
            )

        return {
            detected: true,
            direction,
            strength: Math.round(
                strength
            ),
            reasons: [
                `${direction === 'LONG'
                    ? 'Bullish'
                    : 'Bearish'
                } breakout of ${anchorLevel.description}: close=${current.close.toFixed(
                    2
                )}, distance beyond=${closeBeyondAtr.toFixed(
                    2
                )} ATR, volume=${Math.round(
                    volumeConfirmation
                )}, displacement=${Math.round(
                    displacementConfirmation
                )}`,
            ],
            level: round2(level),
            volumeConfirmation:
                Math.round(
                    volumeConfirmation
                ),
            displacementConfirmation:
                Math.round(
                    displacementConfirmation
                ),
        }
    }

    // --------------------------------------------------
    // Structural fallback
    // --------------------------------------------------

    if (!structural.valid) {

        return emptyBreakout(
            'No structural or anchor breakout detected'
        )
    }

    const bullishBreak =
        current.close >
        structural.high +
            buffer

    const bearishBreak =
        current.close <
        structural.low -
            buffer

    if (
        !bullishBreak &&
        !bearishBreak
    ) {
        return emptyBreakout(
            'No breakout detected'
        )
    }

    if (
        bullishBreak &&
        bearishBreak
    ) {
        return emptyBreakout(
            'Ambiguous breakout evidence'
        )
    }

    const direction:
        SIGNAL_DIRECTION =
            bullishBreak
                ? 'LONG'
                : 'SHORT'

    const level =
        bullishBreak
            ? structural.high
            : structural.low

    const volumeConfirmation =
        calculateVolumeConfirmation(
            candles
        )

    const displacementConfirmation =
        displacement.detected &&
        displacement.direction ===
            direction
            ? displacement.strength
            : Math.round(
                  displacement.strength *
                      0.3
              )

    const closeBeyondAtr =
        Math.abs(
            current.close -
                level
        ) / atr

    const strength =
        clamp(
            closeBeyondAtr * 40 +
                volumeConfirmation *
                    0.3 +
                displacementConfirmation *
                    0.3,
            0,
            100
        )

    return {
        detected: true,
        direction,
        strength: Math.round(
            strength
        ),
        reasons: [
            `${direction === 'LONG'
                ? 'Bullish'
                : 'Bearish'
            } breakout of structural level ${level.toFixed(
                2
            )}: close=${current.close.toFixed(
                2
            )}, volume=${Math.round(
                volumeConfirmation
            )}, displacement=${Math.round(
                displacementConfirmation
            )}`,
        ],
        level: round2(level),
        volumeConfirmation:
            Math.round(
                volumeConfirmation
            ),
        displacementConfirmation:
            Math.round(
                displacementConfirmation
            ),
    }
}


// ==================================================
// FAILED BREAKOUT
// ==================================================

function detectFailedBreakout(
    candles: CandleInfo[]
): PriceActionBreakout {

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {
        return emptyBreakout(
            'Missing candle structure'
        )
    }

    const atr =
        safeNumber(current.atr)

    if (!(atr > 0)) {
        return emptyBreakout(
            'Invalid ATR'
        )
    }

    const {
        structural,
        anchors,
    } =
        getMeaningfulLevels(candles)

    const buffer =
        CONFIG.MIN_LEVEL_BUFFER_ATR *
        atr

    // --------------------------------------------------
    // Anchor levels
    // --------------------------------------------------

    for (const anchorLevel of anchors) {

        const level =
            anchorLevel.level

        const bearishFailed =
            current.high >
                level + buffer &&
            current.close <
                level

        const bullishFailed =
            current.low <
                level - buffer &&
            current.close >
                level

        if (
            !bearishFailed &&
            !bullishFailed
        ) {
            continue
        }

        if (
            bearishFailed &&
            bullishFailed
        ) {
            continue
        }

        const direction:
            SIGNAL_DIRECTION =
                bearishFailed
                    ? 'SHORT'
                    : 'LONG'

        const extremum =
            bearishFailed
                ? current.high
                : current.low

        const penetration =
            Math.abs(
                extremum -
                    level
            )

        const reversal =
            Math.abs(
                current.close -
                    level
            )

        const volumeConfirmation =
            calculateVolumeConfirmation(
                candles
            )

        const displacementConfirmation =
            clamp(
                (reversal / atr) *
                    100,
                0,
                100
            )

        const strength =
            clamp(
                (penetration / atr) *
                    30 +
                    (reversal / atr) *
                        40 +
                    volumeConfirmation *
                        0.3 +
                    CONFIG.ANCHOR_EVENT_BONUS,
                0,
                100
            )

        return {
            detected: true,
            direction,
            strength: Math.round(
                strength
            ),
            reasons: [
                `Failed breakout at ${anchorLevel.description}: ${
                    bearishFailed
                        ? 'high'
                        : 'low'
                }=${extremum.toFixed(
                    2
                )}, close returned ${
                    bearishFailed
                        ? 'below'
                        : 'above'
                } level at ${current.close.toFixed(
                    2
                )}`,
            ],
            level: round2(level),
            volumeConfirmation:
                Math.round(
                    volumeConfirmation
                ),
            displacementConfirmation:
                Math.round(
                    displacementConfirmation
                ),
        }
    }

    // --------------------------------------------------
    // Structural fallback
    // --------------------------------------------------

    if (!structural.valid) {

        return emptyBreakout(
            'No structural or anchor failed breakout detected'
        )
    }

    const bearishFailed =
        current.high >
            structural.high +
                buffer &&
        current.close <
            structural.high

    const bullishFailed =
        current.low <
            structural.low -
                buffer &&
        current.close >
            structural.low

    if (
        !bearishFailed &&
        !bullishFailed
    ) {
        return emptyBreakout(
            'No failed breakout detected'
        )
    }

    if (
        bearishFailed &&
        bullishFailed
    ) {
        return emptyBreakout(
            'Ambiguous failed-breakout evidence'
        )
    }

    const direction:
        SIGNAL_DIRECTION =
            bearishFailed
                ? 'SHORT'
                : 'LONG'

    const level =
        bearishFailed
            ? structural.high
            : structural.low

    const extremum =
        bearishFailed
            ? current.high
            : current.low

    const penetration =
        Math.abs(
            extremum -
                level
        )

    const reversal =
        Math.abs(
            current.close -
                level
        )

    const volumeConfirmation =
        calculateVolumeConfirmation(
            candles
        )

    const displacementConfirmation =
        clamp(
            (reversal / atr) *
                100,
            0,
            100
        )

    const strength =
        clamp(
            (penetration / atr) *
                30 +
                (reversal / atr) *
                    40 +
                volumeConfirmation *
                    0.3,
            0,
            100
        )

    return {
        detected: true,
        direction,
        strength: Math.round(
            strength
        ),
        reasons: [
            `Failed structural breakout ${
                bearishFailed
                    ? 'above'
                    : 'below'
            } ${level.toFixed(
                2
            )}: ${
                bearishFailed
                    ? 'high'
                    : 'low'
            }=${extremum.toFixed(
                2
            )}, close returned ${
                bearishFailed
                    ? 'below'
                    : 'above'
            }`,
        ],
        level: round2(level),
        volumeConfirmation:
            Math.round(
                volumeConfirmation
            ),
        displacementConfirmation:
            Math.round(
                displacementConfirmation
            ),
    }
}


// ==================================================
// LIQUIDITY SWEEP
// ==================================================

function detectLiquiditySweep(
    candles: CandleInfo[]
): PriceActionEvent {

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {
        return emptyEvent(
            'Missing candle structure'
        )
    }

    const atr =
        safeNumber(current.atr)

    if (!(atr > 0)) {
        return emptyEvent(
            'Invalid ATR'
        )
    }

    const {
        structural,
        anchors,
    } =
        getMeaningfulLevels(candles)

    const buffer =
        CONFIG.MIN_LEVEL_BUFFER_ATR *
        atr

    // --------------------------------------------------
    // Anchor liquidity
    // --------------------------------------------------

    for (const anchorLevel of anchors) {

        const level =
            anchorLevel.level

        const bearishSweep =
            current.high >
                level + buffer &&
            current.close <
                level

        const bullishSweep =
            current.low <
                level - buffer &&
            current.close >
                level

        if (
            !bearishSweep &&
            !bullishSweep
        ) {
            continue
        }

        if (
            bearishSweep &&
            bullishSweep
        ) {
            continue
        }

        const direction:
            SIGNAL_DIRECTION =
                bearishSweep
                    ? 'SHORT'
                    : 'LONG'

        const excursion =
            bearishSweep
                ? current.high -
                  level
                : level -
                  current.low

        const reversal =
            bearishSweep
                ? current.high -
                  current.close
                : current.close -
                  current.low

        const closeLocation =
            safeNumber(
                current.candleStructure
                    .closeLocation,
                0.5
            )

        const closeScore =
            bearishSweep
                ? closeLocation
                : 1 -
                  closeLocation

        const strength =
            clamp(
                (excursion / atr) *
                    30 +
                    (reversal / atr) *
                        45 +
                    closeScore *
                        10 +
                    CONFIG.ANCHOR_EVENT_BONUS,
                0,
                100
            )

        return {
            detected: true,
            direction,
            strength: Math.round(
                strength
            ),
            reasons: [
                `${
                    bearishSweep
                        ? 'Bearish'
                        : 'Bullish'
                } liquidity sweep at ${anchorLevel.description}: excursion=${excursion.toFixed(
                    2
                )} (${(
                    excursion /
                    atr
                ).toFixed(
                    2
                )} ATR), reversal=${reversal.toFixed(
                    2
                )}, close=${current.close.toFixed(
                    2
                )}`,
            ],
        }
    }

    // --------------------------------------------------
    // Recent structural liquidity
    // --------------------------------------------------

    const levels =
        getPriorLevels(
            candles,
            CONFIG.LIQUIDITY_LOOKBACK
        )

    if (!levels.valid) {

        return emptyEvent(
            'No recent liquidity levels available'
        )
    }

    const bearishSweep =
        current.high >
            levels.high + buffer &&
        current.close <
            levels.high

    const bullishSweep =
        current.low <
            levels.low - buffer &&
        current.close >
            levels.low

    if (
        bearishSweep &&
        !bullishSweep
    ) {

        const excursion =
            current.high -
            levels.high

        const reversal =
            current.high -
            current.close

        const closeLocation =
            safeNumber(
                current.candleStructure
                    .closeLocation,
                0.5
            )

        const strength =
            clamp(
                (excursion / atr) *
                    30 +
                    (reversal / atr) *
                        50 +
                    closeLocation *
                        20,
                0,
                100
            )

        return {
            detected: true,
            direction: 'SHORT',
            strength: Math.round(
                strength
            ),
            reasons: [
                `Bearish liquidity sweep above recent high ${levels.high.toFixed(
                    2
                )}: high=${current.high.toFixed(
                    2
                )}, close returned to ${current.close.toFixed(
                    2
                )}`,
            ],
        }
    }

    if (
        bullishSweep &&
        !bearishSweep
    ) {

        const excursion =
            levels.low -
            current.low

        const reversal =
            current.close -
            current.low

        const closeLocation =
            safeNumber(
                current.candleStructure
                    .closeLocation,
                0.5
            )

        const strength =
            clamp(
                (excursion / atr) *
                    30 +
                    (reversal / atr) *
                        50 +
                    (1 -
                        closeLocation) *
                        20,
                0,
                100
            )

        return {
            detected: true,
            direction: 'LONG',
            strength: Math.round(
                strength
            ),
            reasons: [
                `Bullish liquidity sweep below recent low ${levels.low.toFixed(
                    2
                )}: low=${current.low.toFixed(
                    2
                )}, close returned to ${current.close.toFixed(
                    2
                )}`,
            ],
        }
    }

    return emptyEvent(
        'No potential liquidity sweep detected'
    )
}


// ==================================================
// PRICE ACTION SEQUENCE
// ==================================================

function buildPriceActionSequence(
    liquiditySweep: PriceActionEvent,
    rejection: PriceActionEvent,
    reclaim: PriceActionReclaim,
    displacement: PriceActionEvent,
    current: CandleInfo
): PriceActionSequence {

    const closeLocation =
        safeNumber(
            current.candleStructure
                ?.closeLocation,
            0.5
        )

    const detectedDirections:
        SIGNAL_DIRECTION[] =
            [
                liquiditySweep,
                rejection,
                reclaim,
                displacement,
            ]
                .filter(
                    e => e.detected
                )
                .map(
                    e => e.direction
                )

    const longVotes =
        detectedDirections.filter(
            d => d === 'LONG'
        ).length

    const shortVotes =
        detectedDirections.filter(
            d => d === 'SHORT'
        ).length

    let direction:
        SIGNAL_DIRECTION =
            'NEUTRAL'

    if (
        longVotes >
        shortVotes
    ) {
        direction = 'LONG'
    }
    else if (
        shortVotes >
        longVotes
    ) {
        direction = 'SHORT'
    }

    if (
        direction === 'NEUTRAL'
    ) {
        return emptySequence()
    }

    const closeConfirmation =
        direction === 'LONG'
            ? closeLocation >=
              CONFIG.CLOSE_CONFIRMATION_LOCATION_LONG
            : closeLocation <=
              CONFIG.CLOSE_CONFIRMATION_LOCATION_SHORT

    const sweepAgrees =
        liquiditySweep.detected &&
        liquiditySweep.direction ===
            direction

    const rejectionAgrees =
        rejection.detected &&
        rejection.direction ===
            direction

    const reclaimAgrees =
        reclaim.detected &&
        reclaim.direction ===
            direction

    const displacementAgrees =
        displacement.detected &&
        displacement.direction ===
            direction

    const stagesPresent = [
        sweepAgrees,
        rejectionAgrees,
        reclaimAgrees,
        displacementAgrees,
        closeConfirmation,
    ]

    const stagesHit =
        stagesPresent.filter(
            Boolean
        ).length

    const completion =
        clamp(
            (
                stagesHit /
                stagesPresent.length
            ) * 100,
            0,
            100
        )

    return {
        liquiditySweep:
            sweepAgrees,

        rejection:
            rejectionAgrees,

        reclaim:
            reclaimAgrees,

        displacement:
            displacementAgrees,

        closeConfirmation,

        completion:
            Math.round(
                completion
            ),

        direction,
    }
}


// ==================================================
// DIRECTIONAL SCORES
// ==================================================

function calculateDirectionalScores(
    displacement: PriceActionEvent,
    rejection: PriceActionEvent,
    reclaim: PriceActionReclaim,
    breakout: PriceActionBreakout,
    failedBreakout: PriceActionBreakout,
    liquiditySweep: PriceActionEvent,
    sequence: PriceActionSequence
): {
    long: number
    short: number
} {

    let long = 0
    let short = 0

    const WEIGHTS = {

        displacement: 1.0,

        rejection: 0.9,

        reclaim: 1.0,

        breakout: 1.1,

        failedBreakout: 0.9,

        liquiditySweep: 0.8,

        sequence: 1.2,
    }

    const add = (
        event: {
            detected: boolean
            direction: SIGNAL_DIRECTION
            strength: number
        },
        weight: number
    ) => {

        if (!event.detected) {
            return
        }

        const contribution =
            event.strength *
            weight *
            0.4

        if (
            event.direction ===
            'LONG'
        ) {
            long += contribution
        }
        else if (
            event.direction ===
            'SHORT'
        ) {
            short += contribution
        }
    }

    add(
        displacement,
        WEIGHTS.displacement
    )

    add(
        rejection,
        WEIGHTS.rejection
    )

    add(
        reclaim,
        WEIGHTS.reclaim
    )

    add(
        breakout,
        WEIGHTS.breakout
    )

    add(
        failedBreakout,
        WEIGHTS.failedBreakout
    )

    add(
        liquiditySweep,
        WEIGHTS.liquiditySweep
    )

    if (
        sequence.direction !==
        'NEUTRAL'
    ) {

        const contribution =
            sequence.completion *
            WEIGHTS.sequence *
            0.4

        if (
            sequence.direction ===
            'LONG'
        ) {
            long += contribution
        }
        else {
            short += contribution
        }
    }

    // --------------------------------------------------
    // Conflict reduction
    // --------------------------------------------------

    const conflict =
        Math.min(
            long,
            short
        )

    long -=
        conflict * 0.5

    short -=
        conflict * 0.5

    return {
        long: Math.round(
            clamp(
                long,
                0,
                100
            )
        ),

        short: Math.round(
            clamp(
                short,
                0,
                100
            )
        ),
    }
}


// ==================================================
// DOMINANT DIRECTION
// ==================================================

function calculateDominant(
    long: number,
    short: number
): SIGNAL_DIRECTION {

    const maxScore =
        Math.max(
            long,
            short
        )

    const margin =
        Math.abs(
            long -
                short
        )

    if (
        maxScore <
            CONFIG.DOMINANT_MIN_SCORE ||
        margin <
            CONFIG.DOMINANT_MIN_MARGIN
    ) {
        return 'NEUTRAL'
    }

    return long > short
        ? 'LONG'
        : 'SHORT'
}


// ==================================================
// OVERALL STRENGTH
// ==================================================

function calculateOverallStrength(
    displacement: PriceActionEvent,
    rejection: PriceActionEvent,
    reclaim: PriceActionReclaim,
    breakout: PriceActionBreakout,
    failedBreakout: PriceActionBreakout,
    liquiditySweep: PriceActionEvent,
    sequence: PriceActionSequence,
    dominant: SIGNAL_DIRECTION
): number {

    if (
        dominant === 'NEUTRAL'
    ) {

        return Math.round(
            clamp(
                sequence.completion *
                    0.3,
                0,
                40
            )
        )
    }

    const agreeingEvents = [
        displacement,
        rejection,
        reclaim,
        breakout,
        failedBreakout,
        liquiditySweep,
    ].filter(
        e =>
            e.detected &&
            e.direction ===
                dominant
    )

    const avgEventStrength =
        agreeingEvents.length > 0
            ? agreeingEvents.reduce(
                  (
                      sum,
                      e
                  ) =>
                      sum +
                      e.strength,
                  0
              ) /
              agreeingEvents.length
            : 0

    const coherenceBonus =
        clamp(
            (
                agreeingEvents.length -
                1
            ) * 12,
            0,
            40
        )

    const sequenceBonus =
        sequence.direction ===
        dominant
            ? sequence.completion *
              0.25
            : 0

    return Math.round(
        clamp(
            avgEventStrength *
                0.5 +
                coherenceBonus +
                sequenceBonus,
            0,
            100
        )
    )
}


// ==================================================
// TOP LEVEL REASONS
// ==================================================

function buildOverallReasons(
    displacement: PriceActionEvent,
    rejection: PriceActionEvent,
    reclaim: PriceActionReclaim,
    breakout: PriceActionBreakout,
    failedBreakout: PriceActionBreakout,
    liquiditySweep: PriceActionEvent,
    sequence: PriceActionSequence,
    dominant: SIGNAL_DIRECTION,
    long: number,
    short: number
): string[] {

    const reasons: string[] = []

    if (
        displacement.detected
    ) {
        reasons.push(
            ...displacement.reasons
        )
    }

    if (
        rejection.detected
    ) {
        reasons.push(
            ...rejection.reasons
        )
    }

    if (
        reclaim.detected
    ) {
        reasons.push(
            ...reclaim.reasons
        )
    }

    if (
        breakout.detected
    ) {
        reasons.push(
            ...breakout.reasons
        )
    }

    if (
        failedBreakout.detected
    ) {
        reasons.push(
            ...failedBreakout.reasons
        )
    }

    if (
        liquiditySweep.detected
    ) {
        reasons.push(
            ...liquiditySweep.reasons
        )
    }

    if (
        sequence.direction !==
            'NEUTRAL' &&
        sequence.completion > 0
    ) {

        reasons.push(
            `Price-action sequence ${sequence.direction}: ${sequence.completion}% complete`
        )
    }

    reasons.push(
        `Directional scores: LONG=${long}, SHORT=${short}, dominant=${dominant}`
    )

    if (
        reasons.length === 1
    ) {

        reasons.unshift(
            'No significant price-action events detected on this candle'
        )
    }

    return reasons
}


// ==================================================
// PUBLIC ENTRY POINT
// ==================================================

export function getPriceAction(
    candles: CandleInfo[]
): PriceAction {

    if (
        !candles ||
        candles.length === 0
    ) {

        return buildNeutralPriceAction(
            'No candle data available'
        )
    }

    const current =
        candles[candles.length - 1]

    if (
        !current ||
        !current.candleStructure
    ) {

        return buildNeutralPriceAction(
            'Missing candle structure for current candle'
        )
    }

    const displacement =
        detectDisplacement(
            candles
        )

    const rejection =
        detectRejection(
            candles
        )

    const reclaim =
        detectReclaim(
            candles
        )

    const breakout =
        detectBreakout(
            candles,
            displacement
        )

    const failedBreakout =
        detectFailedBreakout(
            candles
        )

    const liquiditySweep =
        detectLiquiditySweep(
            candles
        )

    const sequence =
        buildPriceActionSequence(
            liquiditySweep,
            rejection,
            reclaim,
            displacement,
            current
        )

    const {
        long,
        short,
    } =
        calculateDirectionalScores(
            displacement,
            rejection,
            reclaim,
            breakout,
            failedBreakout,
            liquiditySweep,
            sequence
        )

    const dominant =
        calculateDominant(
            long,
            short
        )

    const strength =
        calculateOverallStrength(
            displacement,
            rejection,
            reclaim,
            breakout,
            failedBreakout,
            liquiditySweep,
            sequence,
            dominant
        )

    const reasons =
        buildOverallReasons(
            displacement,
            rejection,
            reclaim,
            breakout,
            failedBreakout,
            liquiditySweep,
            sequence,
            dominant,
            long,
            short
        )

    return {

        displacement,

        rejection,

        reclaim,

        breakout,

        failedBreakout,

        liquiditySweep,

        sequence,

        long,

        short,

        dominant,

        strength,

        reasons,
    }
}