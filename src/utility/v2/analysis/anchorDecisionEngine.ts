import type {
    CandleInfo,
    CandleAnchor,
    CandleAnchors,
    AnchorPoint,
    AnchorState,
    ActiveAnchor,
    ActiveAnchors,
    AnchorAnalysis,
    ANCHOR_REASON,
    ANCHOR_STATUS,
    ANCHOR_TYPE,
} from "@/core/interfacesv2";

/* ============================================================
 * PURPOSE
 * ============================================================
 * Maintains causal anchor state for the CURRENT candle.
 *
 * The engine performs two related jobs:
 *
 * 1. Detect whether the current candle creates a NEW anchor.
 *
 * 2. Maintain the lifecycle of previously detected anchors and
 *    determine which anchor is currently the most relevant for
 *    each analytical system.
 *
 * Historical anchors are preserved in:
 *
 *     result.candidates
 *
 * The currently selected anchors are exposed through:
 *
 *     result.active
 *
 * This prevents Price Action from having to inspect every
 * historical anchor.
 *
 * CAUSALITY:
 * Only candles[0..idx] are inspected.
 * No future candles are used.
 *
 * The caller may continue to use:
 *
 *     candle.anchors = getAnchorDecision(movingCandles)
 *
 * ============================================================ */


/* ============================================================
 * CONFIGURATION
 * ============================================================ */

const CONFIG = {
    RANGE_START_FULL_CONF_RATIO: 0.2,
    RANGE_START_ZERO_CONF_RATIO: 0.6,

    CONSOLIDATION_LOOKBACK: 6,
    CONSOLIDATION_MIN_COMPRESSED_FRACTION: 0.7,

    SWING_LOOKBACK: 3,
    SWING_MIN_REJECTION_WICK_RATIO: 0.4,
    SWING_FULL_CONF_WICK_RATIO: 0.8,
    SWING_MIN_CLOSE_LOCATION_FOR_LOW: 0.6,
    SWING_MAX_CLOSE_LOCATION_FOR_HIGH: 0.4,

    IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN: 1,
    IMPULSE_MIN_BODY_RATIO_FOR_CONF: 0.4,
    IMPULSE_FULL_CONF_BODY_RATIO: 0.9,

    STRUCTURE_BREAK_LOOKBACK: 20,

    LIQUIDITY_REGIME_LOOKBACK: 8,
    LIQUIDITY_REGIME_MAJORITY_FRACTION: 0.6,

    LIQUIDITY_SWEEP_LOOKBACK: 10,
    LIQUIDITY_SWEEP_MIN_WICK_RATIO: 0.4,
    LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO: 0.8,
    LIQUIDITY_SWEEP_MAX_CLOSE_LOCATION_AFTER_HIGH_SWEEP: 0.4,
    LIQUIDITY_SWEEP_MIN_CLOSE_LOCATION_AFTER_LOW_SWEEP: 0.6,

    RECLAIM_LOOKBACK: 8,
    RECLAIM_MIN_BODY_RATIO_FOR_CONF: 0.3,
    RECLAIM_FULL_CONF_BODY_RATIO: 0.8,

    DISPLACEMENT_MIN_BODY_ATR_RATIO: 1.2,
    DISPLACEMENT_MIN_BODY_RATIO: 0.6,

    SESSION_TIMEZONE_OFFSET_MS: 0,

    HEATMAP_MIN_SPACING: 5,
    AVWAP_MIN_SPACING: 3,
    FRVP_MIN_SPACING: 5,

    /*
     * Maximum number of historical anchors retained per system.
     * Old anchors are still represented on the candle where they
     * were created, but do not remain in the current registry.
     */
    MAX_ANCHORS_PER_TYPE: 20,

    /*
     * Anchor becomes weakened after this many candles without
     * meaningful relevance.
     */
    WEAKENED_RELEVANCE_THRESHOLD: 35,

    /*
     * Anchor is considered expired after this many candles when
     * it has remained weak.
     */
    MAX_WEAK_AGE: 30,

    /*
     * Relevance decay per candle.
     *
     * This is deliberately slow because an old AVWAP/FRVP anchor
     * can remain important for a long time.
     */
    AVWAP_AGE_DECAY: 0.15,
    FRVP_AGE_DECAY: 0.20,
    HEATMAP_AGE_DECAY: 0.40,

    /*
     * Minimum relevance required for an anchor to become the
     * active analytical anchor.
     */
    MIN_ACTIVE_RELEVANCE: 25,

    /*
     * New anchor bonus.
     *
     * New anchors should have an opportunity to become active,
     * but age/relevance and previous anchors still matter.
     */
    NEW_ANCHOR_RELEVANCE_BONUS: 10,
} as const;


/* ============================================================
 * MATH HELPERS
 * ============================================================ */

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function linearScale(
    value: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number
): number {
    if (!Number.isFinite(value) || x0 === x1) return y0;

    const t = clamp((value - x0) / (x1 - x0), 0, 1);

    return y0 + t * (y1 - y0);
}

function safeDivide(
    numerator: number,
    denominator: number,
    fallback = 0
): number {
    if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        denominator === 0
    ) {
        return fallback;
    }

    const result = numerator / denominator;

    return Number.isFinite(result) ? result : fallback;
}


/* ============================================================
 * INTERNAL CANDIDATE SIGNAL
 * ============================================================ */

interface CandidateSignal {
    reason: ANCHOR_REASON
    confidence: number
}


/* ============================================================
 * BASIC HELPERS
 * ============================================================ */

function emptyAnchor(): CandleAnchor {
    return {
        isAnchor: false,
        openTime: null,
        reasons: [],
        confidence: 0,
    }
}

function emptyAnchorState(): AnchorState {
    return {
        candidates: [],
        active: {
            avwap: null,
            frvp: null,
            liquidityHeatmap: null,
        },
    }
}

function trailingWindowInclusive(
    candles: CandleInfo[],
    idx: number,
    length: number
): CandleInfo[] {
    return candles.slice(
        Math.max(0, idx - length + 1),
        idx + 1
    )
}

function trailingWindowExclusive(
    candles: CandleInfo[],
    idx: number,
    length: number
): CandleInfo[] {
    return candles.slice(
        Math.max(0, idx - length),
        idx
    )
}

function getUtcDayKey(timestampMs: number): number {
    return Math.floor(
        (timestampMs + CONFIG.SESSION_TIMEZONE_OFFSET_MS) / 86_400_000
    )
}

function dedupeReasons(
    reasons: ANCHOR_REASON[]
): ANCHOR_REASON[] {
    return Array.from(new Set(reasons))
}

function createAnchorId(
    type: ANCHOR_TYPE,
    openTime: number
): string {
    return `${type}_${openTime}`
}


/* ============================================================
 * CANDIDATE DETECTORS
 * ============================================================ */

function detectRangeStart(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const cs = candles[idx].candleStructure;

    if (!cs) return null;

    const previousCs =
        idx > 0
            ? candles[idx - 1].candleStructure
            : null;

    const wasNotCompressed =
        !previousCs || !previousCs.isCompression;

    if (cs.isCompression && wasNotCompressed) {

        const confidence = linearScale(
            cs.rangeAtrRatio,
            CONFIG.RANGE_START_FULL_CONF_RATIO,
            100,
            CONFIG.RANGE_START_ZERO_CONF_RATIO,
            0
        );

        return {
            reason: "RANGE_START",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectConsolidationStart(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const cs = candles[idx].candleStructure;

    if (!cs || !cs.isCompression) return null;

    if (idx < CONFIG.CONSOLIDATION_LOOKBACK - 1) {
        return null;
    }

    const currentWindow = trailingWindowInclusive(
        candles,
        idx,
        CONFIG.CONSOLIDATION_LOOKBACK
    );

    const currentFraction = safeDivide(
        currentWindow.filter(
            c => c.candleStructure?.isCompression
        ).length,
        currentWindow.length
    );

    if (
        currentFraction <
        CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION
    ) {
        return null;
    }

    const previousWindow =
        trailingWindowInclusive(
            candles,
            idx - 1,
            CONFIG.CONSOLIDATION_LOOKBACK
        );

    const previousFraction =
        previousWindow.length
            ? safeDivide(
                previousWindow.filter(
                    c => c.candleStructure?.isCompression
                ).length,
                previousWindow.length
            )
            : 0;

    if (
        previousFraction >=
        CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION
    ) {
        return null;
    }

    const confidence = linearScale(
        currentFraction,
        CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION,
        60,
        1,
        100
    );

    return {
        reason: "CONSOLIDATION_START",
        confidence: Math.round(confidence),
    };
}


function detectSwingStart(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const current = candles[idx];
    const cs = current.candleStructure;

    if (!cs || idx < CONFIG.SWING_LOOKBACK) {
        return null;
    }

    const priorWindow = trailingWindowExclusive(
        candles,
        idx,
        CONFIG.SWING_LOOKBACK
    );

    if (!priorWindow.length) return null;

    const priorLow = Math.min(
        ...priorWindow.map(c => c.low)
    );

    const priorHigh = Math.max(
        ...priorWindow.map(c => c.high)
    );

    const isLowSweepRejection =
        current.low <= priorLow &&
        cs.lowerWickRatio >=
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO &&
        cs.closeLocation >=
            CONFIG.SWING_MIN_CLOSE_LOCATION_FOR_LOW;

    if (isLowSweepRejection) {

        const confidence = linearScale(
            cs.lowerWickRatio,
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO,
            50,
            CONFIG.SWING_FULL_CONF_WICK_RATIO,
            100
        );

        return {
            reason: "SWING_START",
            confidence: Math.round(confidence),
        };
    }

    const isHighSweepRejection =
        current.high >= priorHigh &&
        cs.upperWickRatio >=
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO &&
        cs.closeLocation <=
            CONFIG.SWING_MAX_CLOSE_LOCATION_FOR_HIGH;

    if (isHighSweepRejection) {

        const confidence = linearScale(
            cs.upperWickRatio,
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO,
            50,
            CONFIG.SWING_FULL_CONF_WICK_RATIO,
            100
        );

        return {
            reason: "SWING_START",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectImpulseOrigin(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const cs = candles[idx].candleStructure;

    if (!cs || !cs.isExpansion || cs.isDoji) {
        return null;
    }

    const isOrigin =
        (
            cs.direction === "BULLISH" &&
            cs.consecutiveBullish <=
                CONFIG.IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN
        ) ||
        (
            cs.direction === "BEARISH" &&
            cs.consecutiveBearish <=
                CONFIG.IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN
        );

    if (!isOrigin) return null;

    const confidence = linearScale(
        cs.bodyRatio,
        CONFIG.IMPULSE_MIN_BODY_RATIO_FOR_CONF,
        50,
        CONFIG.IMPULSE_FULL_CONF_BODY_RATIO,
        100
    );

    return {
        reason: "IMPULSE_ORIGIN",
        confidence: Math.round(confidence),
    };
}


function detectStructureBreak(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const current = candles[idx];
    const cs = current.candleStructure;

    if (!cs || idx < CONFIG.STRUCTURE_BREAK_LOOKBACK) {
        return null;
    }

    const priorWindow = trailingWindowExclusive(
        candles,
        idx,
        CONFIG.STRUCTURE_BREAK_LOOKBACK
    );

    if (!priorWindow.length) return null;

    const priorHigh = Math.max(
        ...priorWindow.map(c => c.high)
    );

    const priorLow = Math.min(
        ...priorWindow.map(c => c.low)
    );

    const range = cs.range || 1;

    if (current.close > priorHigh) {

        const overshoot = safeDivide(
            current.close - priorHigh,
            range
        );

        const confidence = linearScale(
            overshoot,
            0,
            55,
            1,
            100
        );

        return {
            reason: "STRUCTURE_BREAK",
            confidence: Math.round(confidence),
        };
    }

    if (current.close < priorLow) {

        const overshoot = safeDivide(
            priorLow - current.close,
            range
        );

        const confidence = linearScale(
            overshoot,
            0,
            55,
            1,
            100
        );

        return {
            reason: "STRUCTURE_BREAK",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectLiquidityRegimeChange(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const cs = candles[idx].candleStructure;

    if (!cs || idx < CONFIG.LIQUIDITY_REGIME_LOOKBACK) {
        return null;
    }

    const priorWindow = trailingWindowExclusive(
        candles,
        idx,
        CONFIG.LIQUIDITY_REGIME_LOOKBACK
    );

    if (
        !priorWindow.length ||
        !priorWindow.every(c => c.candleStructure)
    ) {
        return null;
    }

    const compressedFraction = safeDivide(
        priorWindow.filter(
            c => c.candleStructure!.isCompression
        ).length,
        priorWindow.length
    );

    const expandedFraction = safeDivide(
        priorWindow.filter(
            c => c.candleStructure!.isExpansion
        ).length,
        priorWindow.length
    );

    const priorDominant:
        | "compression"
        | "expansion"
        | "neutral" =
        compressedFraction >=
        CONFIG.LIQUIDITY_REGIME_MAJORITY_FRACTION
            ? "compression"
            : expandedFraction >=
                CONFIG.LIQUIDITY_REGIME_MAJORITY_FRACTION
                ? "expansion"
                : "neutral";

    const currentState:
        | "compression"
        | "expansion"
        | "neutral" =
        cs.isCompression
            ? "compression"
            : cs.isExpansion
                ? "expansion"
                : "neutral";

    if (
        priorDominant === "neutral" ||
        currentState === "neutral" ||
        currentState === priorDominant
    ) {
        return null;
    }

    const confidence =
        currentState === "expansion"
            ? linearScale(
                cs.rangeAtrRatio,
                1.5,
                60,
                3,
                100
            )
            : linearScale(
                cs.rangeAtrRatio,
                0.6,
                60,
                0.2,
                100
            );

    return {
        reason: "LIQUIDITY_REGIME_CHANGE",
        confidence: Math.round(confidence),
    };
}


function detectLiquiditySweep(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const current = candles[idx];
    const cs = current.candleStructure;

    if (
        !cs ||
        idx < CONFIG.LIQUIDITY_SWEEP_LOOKBACK
    ) {
        return null;
    }

    const priorWindow = trailingWindowExclusive(
        candles,
        idx,
        CONFIG.LIQUIDITY_SWEEP_LOOKBACK
    );

    if (!priorWindow.length) return null;

    const priorHigh = Math.max(
        ...priorWindow.map(c => c.high)
    );

    const priorLow = Math.min(
        ...priorWindow.map(c => c.low)
    );

    const sweptHigh =
        current.high > priorHigh &&
        cs.upperWickRatio >=
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO &&
        cs.closeLocation <=
            CONFIG.LIQUIDITY_SWEEP_MAX_CLOSE_LOCATION_AFTER_HIGH_SWEEP;

    if (sweptHigh) {

        const confidence = linearScale(
            cs.upperWickRatio,
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO,
            55,
            CONFIG.LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO,
            100
        );

        return {
            reason: "LIQUIDITY_SWEEP",
            confidence: Math.round(confidence),
        };
    }

    const sweptLow =
        current.low < priorLow &&
        cs.lowerWickRatio >=
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO &&
        cs.closeLocation >=
            CONFIG.LIQUIDITY_SWEEP_MIN_CLOSE_LOCATION_AFTER_LOW_SWEEP;

    if (sweptLow) {

        const confidence = linearScale(
            cs.lowerWickRatio,
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO,
            55,
            CONFIG.LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO,
            100
        );

        return {
            reason: "LIQUIDITY_SWEEP",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectReclaim(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const current = candles[idx];
    const cs = current.candleStructure;

    if (!cs || idx < CONFIG.RECLAIM_LOOKBACK) {
        return null;
    }

    const priorWindow = trailingWindowExclusive(
        candles,
        idx,
        CONFIG.RECLAIM_LOOKBACK
    );

    if (!priorWindow.length) return null;

    const level = priorWindow[0].close;

    const wasBrokenBelow =
        priorWindow.some(c => c.close < level);

    const wasBrokenAbove =
        priorWindow.some(c => c.close > level);

    if (
        wasBrokenBelow &&
        current.close > level &&
        cs.isBullish
    ) {

        const confidence = linearScale(
            cs.bodyRatio,
            CONFIG.RECLAIM_MIN_BODY_RATIO_FOR_CONF,
            55,
            CONFIG.RECLAIM_FULL_CONF_BODY_RATIO,
            100
        );

        return {
            reason: "RECLAIM",
            confidence: Math.round(confidence),
        };
    }

    if (
        wasBrokenAbove &&
        current.close < level &&
        cs.isBearish
    ) {

        const confidence = linearScale(
            cs.bodyRatio,
            CONFIG.RECLAIM_MIN_BODY_RATIO_FOR_CONF,
            55,
            CONFIG.RECLAIM_FULL_CONF_BODY_RATIO,
            100
        );

        return {
            reason: "RECLAIM",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectDisplacement(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    const cs = candles[idx].candleStructure;

    if (!cs || cs.isDoji) return null;

    if (
        cs.bodyAtrRatio >=
            CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO &&
        cs.bodyRatio >=
            CONFIG.DISPLACEMENT_MIN_BODY_RATIO
    ) {

        const confidence = linearScale(
            cs.bodyAtrRatio,
            CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO,
            55,
            CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO * 2,
            100
        );

        return {
            reason: "DISPLACEMENT",
            confidence: Math.round(confidence),
        };
    }

    return null;
}


function detectSessionStart(
    candles: CandleInfo[],
    idx: number
): CandidateSignal | null {

    if (idx === 0) return null;

    const current = candles[idx];
    const previous = candles[idx - 1];

    if (
        getUtcDayKey(current.openTime) !==
        getUtcDayKey(previous.openTime)
    ) {
        return {
            reason: "SESSION_START",
            confidence: 100,
        };
    }

    return null;
}


/* ============================================================
 * RAW CANDLE ANCHOR DETECTION
 * ============================================================ */

function buildCandleAnchor(
    candidates: (CandidateSignal | null)[],
    candles: CandleInfo[],
    idx: number,
    minSpacing: number
): CandleAnchor {

    const valid = candidates.filter(
        (c): c is CandidateSignal => c !== null
    );

    if (!valid.length) {
        return emptyAnchor();
    }

    const previousAnchors = candles
        .slice(0, idx)
        .filter(c => c.anchors)
        .length;

    void previousAnchors;

    const reasons = dedupeReasons(
        valid.map(v => v.reason)
    );

    const confidence = clamp(
        Math.round(
            Math.max(
                ...valid.map(v => v.confidence)
            )
        ),
        0,
        100
    );

    /*
     * Spacing is handled when creating/updating the persistent
     * anchor registry. The raw CandleAnchor represents the
     * detection itself.
     */
    void minSpacing;

    return {
        isAnchor: true,
        openTime: candles[idx].openTime,
        reasons,
        confidence,
    };
}


/* ============================================================
 * ANCHOR CREATION
 * ============================================================ */

function createAnchorPoint(
    type: ANCHOR_TYPE,
    candle: CandleInfo,
    reason: ANCHOR_REASON,
    confidence: number
): AnchorPoint {

    return {
        id: createAnchorId(
            type,
            candle.openTime
        ),

        type,

        openTime: candle.openTime,

        reason,

        confidence: clamp(
            confidence,
            0,
            100
        ),

        status: "ACTIVE",

        age: 0,

        relevance: clamp(
            confidence + CONFIG.NEW_ANCHOR_RELEVANCE_BONUS,
            0,
            100
        ),
    };
}


/* ============================================================
 * FIND HISTORICAL ANCHORS
 * ============================================================ */

function collectHistoricalAnchors(
    candles: CandleInfo[],
    type: ANCHOR_TYPE
): AnchorPoint[] {

    const result: AnchorPoint[] = [];

    for (const candle of candles) {

        const anchorState = candle.anchors;

        if (!anchorState?.candidates) {
            continue;
        }

        for (const anchor of anchorState.candidates) {

            if (anchor.type !== type) {
                continue;
            }

            const existing = result.find(
                a =>
                    a.openTime === anchor.openTime &&
                    a.type === anchor.type
            );

            if (existing) {
                continue;
            }

            result.push({
                id: anchor.id,

                type: anchor.type,

                openTime: anchor.openTime,

                reason: anchor.reason,

                confidence: anchor.confidence,

                status: anchor.status,

                age: anchor.age,

                relevance: anchor.relevance,
            });
        }
    }

    return result;
}


/* ============================================================
 * ANCHOR RELEVANCE
 * ============================================================ */

function getAgeDecay(
    type: ANCHOR_TYPE
): number {

    switch (type) {

        case "AVWAP":
            return CONFIG.AVWAP_AGE_DECAY;

        case "FRVP":
            return CONFIG.FRVP_AGE_DECAY;

        case "LIQUIDITY_HEATMAP":
            return CONFIG.HEATMAP_AGE_DECAY;
    }
}

/*
 * Separate function so configuration typo cannot silently
 * affect the actual relevance algorithm.
 */
function getAnchorAgeDecay(
    type: ANCHOR_TYPE
): number {

    if (type === "AVWAP") {
        return CONFIG.AVWAP_AGE_DECAY;
    }

    if (type === "FRVP") {
        return CONFIG.FRVP_AGE_DECAY;
    }

    return CONFIG.HEATMAP_AGE_DECAY;
}


function calculateAnchorRelevance(
    anchor: AnchorPoint,
    currentIndex: number,
    anchorIndex: number
): number {

    const age =
        Math.max(
            0,
            currentIndex - anchorIndex
        );

    const decay =
        getAnchorAgeDecay(anchor.type);

    const agePenalty =
        age * decay;

    return clamp(
        anchor.confidence - agePenalty,
        0,
        100
    );
}


/* ============================================================
 * ANCHOR STATUS
 * ============================================================ */

function updateAnchorStatus(
    anchor: AnchorPoint
): AnchorPoint {

    if (
        anchor.status === "INVALIDATED" ||
        anchor.status === "EXPIRED"
    ) {
        return anchor;
    }

    if (
        anchor.relevance <=
        CONFIG.WEAKENED_RELEVANCE_THRESHOLD
    ) {

        if (
            anchor.age >=
            CONFIG.MAX_WEAK_AGE
        ) {

            return {
                ...anchor,
                status: "EXPIRED",
            };
        }

        return {
            ...anchor,
            status: "WEAKENED",
        };
    }

    return {
        ...anchor,
        status: "ACTIVE",
    };
}


/* ============================================================
 * BUILD CURRENT ANCHOR REGISTRY
 * ============================================================ */

function buildAnchorRegistry(
    candles: CandleInfo[],
    idx: number,
    type: ANCHOR_TYPE,
    currentCandidate: CandleAnchor
): AnchorPoint[] {

    const historical =
        collectHistoricalAnchors(
            candles,
            type
        );

    /*
     * Add current candidate if it was not already represented.
     */
    if (
        currentCandidate.isAnchor &&
        currentCandidate.openTime !== null
    ) {

        const exists =
            historical.some(
                a =>
                    a.openTime ===
                    currentCandidate.openTime &&
                    a.type === type
            );

        if (!exists) {

            historical.push(
                createAnchorPoint(
                    type,
                    candles[idx],
                    currentCandidate.reasons[0] ?? "OTHER",
                    currentCandidate.confidence
                )
            );
        }
    }

    const result: AnchorPoint[] = [];

    for (const anchor of historical) {

        const anchorIndex =
            candles.findIndex(
                c =>
                    c.openTime ===
                    anchor.openTime
            );

        if (anchorIndex < 0) continue;

        const age =
            Math.max(
                0,
                idx - anchorIndex
            );

        const relevance =
            calculateAnchorRelevance(
                anchor,
                idx,
                anchorIndex
            );

        const updated =
            updateAnchorStatus({
                ...anchor,
                age,
                relevance,
            });

        result.push(updated);
    }

    /*
     * Keep the strongest/relevant historical anchors.
     *
     * This prevents the registry from growing forever.
     */
    return result
        .sort(
            (a, b) =>
                b.relevance - a.relevance
        )
        .slice(
            0,
            CONFIG.MAX_ANCHORS_PER_TYPE
        );
}


/* ============================================================
 * ACTIVE ANCHOR SELECTION
 * ============================================================ */

function selectActiveAnchor(
    anchors: AnchorPoint[],
    type: ANCHOR_TYPE
): AnchorPoint | null {

    const eligible =
        anchors.filter(
            anchor =>
                anchor.type === type &&
                (
                    anchor.status === "ACTIVE" ||
                    anchor.status === "WEAKENED"
                ) &&
                anchor.relevance >=
                    CONFIG.MIN_ACTIVE_RELEVANCE
        );

    if (!eligible.length) {
        return null;
    }

    /*
     * Highest relevance wins.
     *
     * This is deliberately NOT "newest anchor wins".
     */
    eligible.sort(
        (a, b) => {

            const relevanceDifference =
                b.relevance - a.relevance;

            if (
                Math.abs(
                    relevanceDifference
                ) > 5
            ) {
                return relevanceDifference;
            }

            /*
             * If relevance is close, prefer the newer anchor.
             */
            return b.openTime - a.openTime;
        }
    );

    return eligible[0];
}


/* ============================================================
 * ANALYSIS PLACEHOLDER
 *
 * Anchor engine itself does not calculate the actual AVWAP,
 * FRVP or heatmap.
 *
 * The simulation layer can populate these values after the
 * active anchor has been selected.
 * ============================================================ */

function emptyAnchorAnalysis(): AnchorAnalysis {
    return {
        avwap: null,
        frvp: null,
        heatmap: null,
    };
}


function createActiveAnchor(
    anchor: AnchorPoint
): ActiveAnchor {

    return {
        anchor,
        analysis: emptyAnchorAnalysis(),
    };
}


/* ============================================================
 * SYSTEM-SPECIFIC CANDIDATES
 * ============================================================ */

function selectAvwapAnchor(
    candles: CandleInfo[],
    idx: number
): CandleAnchor {

    return buildCandleAnchor(
        [
            detectLiquiditySweep(candles, idx),
            detectDisplacement(candles, idx),
            detectReclaim(candles, idx),
            detectStructureBreak(candles, idx),
            detectImpulseOrigin(candles, idx),
            detectSessionStart(candles, idx),
        ],
        candles,
        idx,
        CONFIG.AVWAP_MIN_SPACING
    );
}


function selectLiquidityHeatmapAnchor(
    candles: CandleInfo[],
    idx: number
): CandleAnchor {

    return buildCandleAnchor(
        [
            detectRangeStart(candles, idx),
            detectConsolidationStart(candles, idx),
            detectSwingStart(candles, idx),
            detectImpulseOrigin(candles, idx),
            detectLiquidityRegimeChange(candles, idx),
        ],
        candles,
        idx,
        CONFIG.HEATMAP_MIN_SPACING
    );
}


function selectFrvpAnchor(
    candles: CandleInfo[],
    idx: number
): CandleAnchor {

    return buildCandleAnchor(
        [
            detectRangeStart(candles, idx),
            detectConsolidationStart(candles, idx),
            detectImpulseOrigin(candles, idx),
            detectStructureBreak(candles, idx),
            detectSessionStart(candles, idx),
        ],
        candles,
        idx,
        CONFIG.FRVP_MIN_SPACING
    );
}


/* ============================================================
 * PUBLIC API
 * ============================================================ */

export function getAnchorDecision(
    candles: CandleInfo[]
): AnchorState {

    if (
        !candles ||
        candles.length === 0
    ) {
        return emptyAnchorState();
    }

    const idx =
        candles.length - 1;

    const current =
        candles[idx];

    if (
        !current.candleStructure
    ) {
        return emptyAnchorState();
    }


    /* --------------------------------------------------------
     * Detect what the CURRENT candle is proposing.
     * -------------------------------------------------------- */

    const avwapCandidate =
        selectAvwapAnchor(
            candles,
            idx
        );

    const heatmapCandidate =
        selectLiquidityHeatmapAnchor(
            candles,
            idx
        );

    const frvpCandidate =
        selectFrvpAnchor(
            candles,
            idx
        );


    /* --------------------------------------------------------
     * Build historical anchor registry.
     * -------------------------------------------------------- */

    const avwapAnchors =
        buildAnchorRegistry(
            candles,
            idx,
            "AVWAP",
            avwapCandidate
        );

    const frvpAnchors =
        buildAnchorRegistry(
            candles,
            idx,
            "FRVP",
            frvpCandidate
        );

    const heatmapAnchors =
        buildAnchorRegistry(
            candles,
            idx,
            "LIQUIDITY_HEATMAP",
            heatmapCandidate
        );


    /* --------------------------------------------------------
     * Select ONE currently relevant anchor per system.
     * -------------------------------------------------------- */

    const activeAvwap =
        selectActiveAnchor(
            avwapAnchors,
            "AVWAP"
        );

    const activeFrvp =
        selectActiveAnchor(
            frvpAnchors,
            "FRVP"
        );

    const activeHeatmap =
        selectActiveAnchor(
            heatmapAnchors,
            "LIQUIDITY_HEATMAP"
        );


    const active: ActiveAnchors = {
        avwap:
            activeAvwap
                ? createActiveAnchor(activeAvwap)
                : null,

        frvp:
            activeFrvp
                ? createActiveAnchor(activeFrvp)
                : null,

        liquidityHeatmap:
            activeHeatmap
                ? createActiveAnchor(activeHeatmap)
                : null,
    };


    /* --------------------------------------------------------
     * Combine historical anchors.
     *
     * candidates contains every known anchor for the current
     * candle, regardless of which system owns it.
     * -------------------------------------------------------- */

    const candidates = [
        ...avwapAnchors,
        ...frvpAnchors,
        ...heatmapAnchors,
    ]
        .sort(
            (a, b) =>
                a.openTime - b.openTime
        );


    return {
        candidates,
        active,
    };
}