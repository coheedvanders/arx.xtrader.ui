import type {
    CandleInfo,
    CandleStructure,
    MARKET_ALIGNMENT,
    MARKET_DIRECTION,
    MARKET_INTERVAL,
    MarketAlignment,
    MarketAlignmentComponent,
    SIGNAL_DIRECTION,
    SymbolInfo,
} from "@/core/interfacesv2"


const CONFIG = {
    BTC_WEIGHT: 0.50,
    ETH_WEIGHT: 0.25,
    SOL_WEIGHT: 0.25,

    STRUCTURE_WEIGHT: 0.30,
    PRICE_ACTION_WEIGHT: 0.25,
    VOLUME_WEIGHT: 0.15,
    OI_WEIGHT: 0.15,
    LONG_SHORT_WEIGHT: 0.15,

    STRONG_ALIGNMENT: 70,
    PARTIAL_ALIGNMENT: 45,
    STRONG_DIVERGENCE: 65,

    NEUTRAL_SCORE: 50,
}


export function getMarketAlignment(
    movingCandles: CandleInfo[],
    mainMarkets: SymbolInfo[],
    interval: MARKET_INTERVAL
): MarketAlignment {

    const targetCandle = movingCandles.at(-1)

    if (!targetCandle) {
        return createNeutralAlignment(0)
    }

    const btc = mainMarkets.find(x => x.name === "BTCUSDT")
    const eth = mainMarkets.find(x => x.name === "ETHUSDT")
    const sol = mainMarkets.find(x => x.name === "SOLUSDT")

    const btcCandle = findMatchingCandle(
        btc,
        interval,
        targetCandle.openTime
    )

    const ethCandle = findMatchingCandle(
        eth,
        interval,
        targetCandle.openTime
    )

    const solCandle = findMatchingCandle(
        sol,
        interval,
        targetCandle.openTime
    )

    const btcComparison = compareMarket(
        targetCandle,
        btcCandle
    )

    const ethComparison = compareMarket(
        targetCandle,
        ethCandle
    )

    const solComparison = compareMarket(
        targetCandle,
        solCandle
    )

    /*
     * BTC is the primary market driver.
     */
    const alignmentScore =
        btcComparison.score * CONFIG.BTC_WEIGHT +
        ethComparison.score * CONFIG.ETH_WEIGHT +
        solComparison.score * CONFIG.SOL_WEIGHT

    /*
     * Determine what the major markets themselves
     * are doing.
     */
    const marketConsensus = calculateMarketConsensus(
        btcCandle,
        ethCandle,
        solCandle
    )

    /*
     * Detect whether the target is moving opposite
     * to the major market direction.
     */
    const divergenceScore = calculateDivergenceScore(
        targetCandle,
        btcCandle,
        ethCandle,
        solCandle
    )

    const targetDirection =
        getTargetDirection(targetCandle)

    const state = determineAlignmentState(
        targetDirection,
        alignmentScore,
        divergenceScore,
        marketConsensus
    )

    const strength = calculateOverallStrength(
        alignmentScore,
        marketConsensus,
        divergenceScore
    )

    const reasons = buildOverallReasons(
        targetCandle,
        state,
        alignmentScore,
        marketConsensus,
        divergenceScore,
        btcComparison,
        ethComparison,
        solComparison
    )

    return {
        state,

        direction: targetDirection,

        strength,

        btc: toComponent(btcComparison),

        eth: toComponent(ethComparison),

        sol: toComponent(solComparison),

        marketConsensus,

        alignmentScore,

        divergenceScore,

        reasons,

        timestamp: targetCandle.openTime
    }
}


/*
 * ============================================================
 * MATCHING CANDLE
 * ============================================================
 *
 * Always use the same timeframe.
 *
 * We select the latest main-market candle whose openTime
 * is <= the target candle.
 *
 * This guarantees no future candle is consumed.
 */
function findMatchingCandle(
    market: SymbolInfo | undefined,
    interval: MARKET_INTERVAL,
    targetOpenTime: number
): CandleInfo | undefined {

    if (!market) {
        return undefined
    }

    const candles = getIntervalCandles(
        market,
        interval
    )

    if (!candles.length) {
        return undefined
    }

    let result: CandleInfo | undefined

    for (const candle of candles) {

        if (candle.openTime > targetOpenTime) {
            break
        }

        result = candle
    }

    return result
}


function getIntervalCandles(
    market: SymbolInfo,
    interval: MARKET_INTERVAL
): CandleInfo[] {

    switch (interval) {

        case "15m":
            return market.candle_15m

        case "1h":
            return market.candle_1h

        case "4h":
            return market.candle_4h

        case "1d":
            return market.candle_1d
    }
}


/*
 * ============================================================
 * MARKET COMPARISON
 * ============================================================
 */

interface MarketComparison {
    score: number

    targetDirection: SIGNAL_DIRECTION

    marketDirection: SIGNAL_DIRECTION

    structureScore: number
    priceActionScore: number
    volumeScore: number
    oiScore: number
    longShortScore: number

    reasons: string[]
}


function compareMarket(
    target: CandleInfo,
    market: CandleInfo | undefined
): MarketComparison {

    const targetDirection =
        getTargetDirection(target)

    if (!market) {
        return {
            score: 0,

            targetDirection,

            marketDirection: "NEUTRAL",

            structureScore: 0,
            priceActionScore: 0,
            volumeScore: 0,
            oiScore: 0,
            longShortScore: 0,

            reasons: [
                "Main-market candle unavailable"
            ]
        }
    }

    const marketDirection =
        getMarketDirection(market)

    const structureScore =
        compareStructure(
            target,
            market
        )

    const priceActionScore =
        comparePriceAction(
            target,
            market
        )

    const volumeScore =
        compareVolume(
            target,
            market
        )

    const oiScore =
        compareOpenInterest(
            target,
            market
        )

    const longShortScore =
        compareLongShort(
            target,
            market
        )

    const score =
        structureScore * CONFIG.STRUCTURE_WEIGHT +
        priceActionScore * CONFIG.PRICE_ACTION_WEIGHT +
        volumeScore * CONFIG.VOLUME_WEIGHT +
        oiScore * CONFIG.OI_WEIGHT +
        longShortScore * CONFIG.LONG_SHORT_WEIGHT

    const reasons =
        buildComparisonReasons(
            target,
            market,
            structureScore,
            priceActionScore,
            volumeScore,
            oiScore,
            longShortScore
        )

    return {
        score,

        targetDirection,

        marketDirection,

        structureScore,
        priceActionScore,
        volumeScore,
        oiScore,
        longShortScore,

        reasons
    }
}


/*
 * ============================================================
 * DIRECTION
 * ============================================================
 *
 * Price Action is the primary short-term directional signal.
 *
 * Candle structure is the secondary directional source.
 */
function getTargetDirection(
    candle: CandleInfo
): SIGNAL_DIRECTION {

    if (
        candle.priceAction &&
        candle.priceAction.dominant !== "NEUTRAL"
    ) {
        return candle.priceAction.dominant
    }

    return marketDirectionToSignal(
        candle.candleStructure?.direction
    )
}


function getMarketDirection(
    candle: CandleInfo
): SIGNAL_DIRECTION {

    if (
        candle.priceAction &&
        candle.priceAction.dominant !== "NEUTRAL"
    ) {
        return candle.priceAction.dominant
    }

    return marketDirectionToSignal(
        candle.candleStructure?.direction
    )
}


function marketDirectionToSignal(
    direction: MARKET_DIRECTION | undefined
): SIGNAL_DIRECTION {

    if (direction === "BULLISH") {
        return "LONG"
    }

    if (direction === "BEARISH") {
        return "SHORT"
    }

    return "NEUTRAL"
}


/*
 * ============================================================
 * STRUCTURE
 * ============================================================
 */

function compareStructure(
    target: CandleInfo,
    market: CandleInfo
): number {

    const targetDirection =
        marketDirectionToSignal(
            target.candleStructure.direction
        )

    const marketDirection =
        marketDirectionToSignal(
            market.candleStructure.direction
        )

    const directionalScore =
        compareDirection(
            targetDirection,
            marketDirection
        )

    /*
     * Stronger structures deserve more confidence.
     */
    const strengthDifference =
        Math.abs(
            target.candleStructure.strength -
            market.candleStructure.strength
        )

    let strengthScore = 100

    if (strengthDifference > 60) {
        strengthScore = 40
    } else if (strengthDifference > 40) {
        strengthScore = 60
    } else if (strengthDifference > 20) {
        strengthScore = 80
    }

    return Math.round(
        directionalScore * 0.70 +
        strengthScore * 0.30
    )
}


/*
 * ============================================================
 * PRICE ACTION
 * ============================================================
 *
 * Your PriceAction already provides:
 *
 * dominant
 * long
 * short
 * strength
 *
 * Therefore use those directly.
 */
function comparePriceAction(
    target: CandleInfo,
    market: CandleInfo
): number {

    const targetDirection =
        target.priceAction.dominant

    const marketDirection =
        market.priceAction.dominant

    const directionalScore =
        compareDirection(
            targetDirection,
            marketDirection
        )

    /*
     * Compare directional conviction.
     *
     * Example:
     *
     * Target:
     * long = 90
     * short = 10
     *
     * BTC:
     * long = 85
     * short = 15
     *
     * → very strong alignment.
     */
    const targetPressure =
        target.priceAction.long -
        target.priceAction.short

    const marketPressure =
        market.priceAction.long -
        market.priceAction.short

    const pressureScore =
        comparePressure(
            targetPressure,
            marketPressure
        )

    const strengthDifference =
        Math.abs(
            target.priceAction.strength -
            market.priceAction.strength
        )

    let strengthScore = 100

    if (strengthDifference > 60) {
        strengthScore = 40
    } else if (strengthDifference > 40) {
        strengthScore = 60
    } else if (strengthDifference > 20) {
        strengthScore = 80
    }

    return Math.round(
        directionalScore * 0.50 +
        pressureScore * 0.30 +
        strengthScore * 0.20
    )
}


/*
 * ============================================================
 * VOLUME
 * ============================================================
 *
 * Volume has no direction.
 *
 * We compare participation/regime.
 */
function compareVolume(
    target: CandleInfo,
    market: CandleInfo
): number {

    const targetState =
        target.volumeState.state

    const marketState =
        market.volumeState.state

    if (
        targetState === marketState
    ) {
        return 100
    }

    /*
     * Expanding vs normal still indicates
     * partial participation.
     */
    if (
        (
            targetState === "EXPANDING" &&
            marketState === "NORMAL"
        ) ||
        (
            targetState === "NORMAL" &&
            marketState === "EXPANDING"
        )
    ) {
        return 70
    }

    if (
        (
            targetState === "CONTRACTING" &&
            marketState === "NORMAL"
        ) ||
        (
            targetState === "NORMAL" &&
            marketState === "CONTRACTING"
        )
    ) {
        return 60
    }

    return 30
}


/*
 * ============================================================
 * OPEN INTEREST
 * ============================================================
 */

function compareOpenInterest(
    target: CandleInfo,
    market: CandleInfo
): number {

    const targetOI =
        target.openInterest

    const marketOI =
        market.openInterest

    let score = 0

    /*
     * Same OI behavior.
     */
    if (
        targetOI.state ===
        marketOI.state
    ) {
        score += 60
    } else if (
        sameOIBehavior(
            targetOI.state,
            marketOI.state
        )
    ) {
        score += 40
    }

    /*
     * Compare actual OI movement.
     */
    if (
        Math.sign(
            targetOI.valueChange
        ) ===
        Math.sign(
            marketOI.valueChange
        )
    ) {
        score += 20
    }

    /*
     * Compare strength.
     */
    score +=
        strengthSimilarity(
            targetOI.strength,
            marketOI.strength
        ) * 0.20

    return Math.min(
        100,
        Math.round(score)
    )
}


function sameOIBehavior(
    a: string,
    b: string
): boolean {

    const rising = [
        "RISING",
        "EXPANDING"
    ]

    const falling = [
        "FALLING",
        "CONTRACTING"
    ]

    if (
        rising.includes(a) &&
        rising.includes(b)
    ) {
        return true
    }

    if (
        falling.includes(a) &&
        falling.includes(b)
    ) {
        return true
    }

    return false
}


/*
 * ============================================================
 * LONG / SHORT
 * ============================================================
 */

function compareLongShort(
    target: CandleInfo,
    market: CandleInfo
): number {

    const targetLS =
        target.longShort

    const marketLS =
        market.longShort

    let score = 0

    if (
        targetLS.state ===
        marketLS.state
    ) {
        score += 60
    } else if (
        sameLongShortBehavior(
            targetLS.state,
            marketLS.state
        )
    ) {
        score += 40
    }

    /*
     * Ratio movement in the same direction.
     */
    if (
        Math.sign(
            targetLS.ratioChange
        ) ===
        Math.sign(
            marketLS.ratioChange
        )
    ) {
        score += 20
    }

    score +=
        strengthSimilarity(
            targetLS.strength,
            marketLS.strength
        ) * 0.20

    return Math.min(
        100,
        Math.round(score)
    )
}


function sameLongShortBehavior(
    a: string,
    b: string
): boolean {

    const longStates = [
        "LONG_DOMINANT",
        "LONG_INCREASING"
    ]

    const shortStates = [
        "SHORT_DOMINANT",
        "SHORT_INCREASING"
    ]

    if (
        longStates.includes(a) &&
        longStates.includes(b)
    ) {
        return true
    }

    if (
        shortStates.includes(a) &&
        shortStates.includes(b)
    ) {
        return true
    }

    return false
}


/*
 * ============================================================
 * DIRECTION COMPARISON
 * ============================================================
 */

function compareDirection(
    target: SIGNAL_DIRECTION,
    market: SIGNAL_DIRECTION
): number {

    if (
        target === "NEUTRAL" ||
        market === "NEUTRAL"
    ) {
        return CONFIG.NEUTRAL_SCORE
    }

    if (target === market) {
        return 100
    }

    return 0
}


/*
 * ============================================================
 * PRICE PRESSURE
 * ============================================================
 */

function comparePressure(
    target: number,
    market: number
): number {

    /*
     * Same sign = same directional pressure.
     */
    if (
        Math.sign(target) ===
        Math.sign(market)
    ) {
        const difference =
            Math.abs(target - market)

        if (difference <= 20) {
            return 100
        }

        if (difference <= 40) {
            return 80
        }

        if (difference <= 60) {
            return 60
        }

        return 40
    }

    /*
     * Opposite directional pressure.
     */
    return 0
}


/*
 * ============================================================
 * STRENGTH SIMILARITY
 * ============================================================
 */

function strengthSimilarity(
    target: number,
    market: number
): number {

    const difference =
        Math.abs(target - market)

    if (difference <= 10) {
        return 100
    }

    if (difference <= 20) {
        return 80
    }

    if (difference <= 40) {
        return 60
    }

    if (difference <= 60) {
        return 40
    }

    return 20
}


/*
 * ============================================================
 * MARKET CONSENSUS
 * ============================================================
 *
 * This answers:
 *
 * "Do BTC, ETH and SOL agree with each other?"
 *
 * It does NOT compare them to the target.
 */
function calculateMarketConsensus(
    btc: CandleInfo | undefined,
    eth: CandleInfo | undefined,
    sol: CandleInfo | undefined
): number {

    const markets = [
        {
            candle: btc,
            weight: CONFIG.BTC_WEIGHT
        },
        {
            candle: eth,
            weight: CONFIG.ETH_WEIGHT
        },
        {
            candle: sol,
            weight: CONFIG.SOL_WEIGHT
        }
    ]

    const validMarkets = markets.filter(
        x => x.candle !== undefined
    )

    if (!validMarkets.length) {
        return 0
    }

    let longWeight = 0
    let shortWeight = 0
    let neutralWeight = 0

    for (const market of validMarkets) {

        const direction =
            getMarketDirection(
                market.candle!
            )

        if (direction === "LONG") {
            longWeight += market.weight
        } else if (direction === "SHORT") {
            shortWeight += market.weight
        } else {
            neutralWeight += market.weight
        }
    }

    const totalWeight =
        validMarkets.reduce(
            (sum, x) => sum + x.weight,
            0
        )

    const strongest =
        Math.max(
            longWeight,
            shortWeight,
            neutralWeight
        )

    return Math.round(
        (strongest / totalWeight) * 100
    )
}


/*
 * ============================================================
 * DIVERGENCE
 * ============================================================
 *
 * This specifically measures:
 *
 * Target direction
 *        VS
 * Main market direction
 *
 * High divergence = target is doing something different.
 */
function calculateDivergenceScore(
    target: CandleInfo,
    btc: CandleInfo | undefined,
    eth: CandleInfo | undefined,
    sol: CandleInfo | undefined
): number {

    const targetDirection =
        getTargetDirection(target)

    if (
        targetDirection === "NEUTRAL"
    ) {
        return 0
    }

    const markets = [
        {
            candle: btc,
            weight: CONFIG.BTC_WEIGHT
        },
        {
            candle: eth,
            weight: CONFIG.ETH_WEIGHT
        },
        {
            candle: sol,
            weight: CONFIG.SOL_WEIGHT
        }
    ]

    let opposingWeight = 0
    let validWeight = 0

    for (const market of markets) {

        if (!market.candle) {
            continue
        }

        const direction =
            getMarketDirection(
                market.candle
            )

        if (
            direction === "NEUTRAL"
        ) {
            continue
        }

        validWeight += market.weight

        if (
            direction !== targetDirection
        ) {
            opposingWeight += market.weight
        }
    }

    if (validWeight === 0) {
        return 0
    }

    return Math.round(
        (opposingWeight / validWeight) * 100
    )
}


/*
 * ============================================================
 * FINAL STATE
 * ============================================================
 */

function determineAlignmentState(
    targetDirection: SIGNAL_DIRECTION,
    alignmentScore: number,
    divergenceScore: number,
    marketConsensus: number
): MARKET_ALIGNMENT {

    if (
        targetDirection === "NEUTRAL"
    ) {
        return "NEUTRAL"
    }

    /*
     * Strong divergence takes precedence.
     *
     * Example:
     *
     * BTC/ETH/SOL bearish
     * Target bullish
     */
    if (
        divergenceScore >=
        CONFIG.STRONG_DIVERGENCE
    ) {
        return targetDirection === "LONG"
            ? "DIVERGING_BULLISH"
            : "DIVERGING_BEARISH"
    }

    /*
     * Strong alignment.
     */
    if (
        alignmentScore >=
        CONFIG.STRONG_ALIGNMENT &&
        marketConsensus >= 60
    ) {
        return targetDirection === "LONG"
            ? "ALIGNED_BULLISH"
            : "ALIGNED_BEARISH"
    }

    /*
     * Partial alignment.
     */
    if (
        alignmentScore >=
        CONFIG.PARTIAL_ALIGNMENT
    ) {
        return targetDirection === "LONG"
            ? "PARTIALLY_BULLISH"
            : "PARTIALLY_BEARISH"
    }

    /*
     * Even if alignment is weak, the target can
     * still have a directional state.
     */
    return targetDirection === "LONG"
        ? "PARTIALLY_BULLISH"
        : "PARTIALLY_BEARISH"
}


/*
 * ============================================================
 * OVERALL STRENGTH
 * ============================================================
 */

function calculateOverallStrength(
    alignmentScore: number,
    marketConsensus: number,
    divergenceScore: number
): number {

    /*
     * Divergence is not treated as "bad".
     *
     * A strong divergence is itself a strong
     * market relationship.
     */
    if (
        divergenceScore >=
        CONFIG.STRONG_DIVERGENCE
    ) {
        return Math.round(
            divergenceScore
        )
    }

    return Math.round(
        alignmentScore * 0.65 +
        marketConsensus * 0.35
    )
}


/*
 * ============================================================
 * COMPONENT
 * ============================================================
 */

function toComponent(
    comparison: MarketComparison
): MarketAlignmentComponent {

    return {
        score: Math.round(
            comparison.score
        ),

        direction:
            comparison.marketDirection,

        aligned:
            comparison.score >=
            CONFIG.STRONG_ALIGNMENT,

        reasons:
            comparison.reasons
    }
}


/*
 * ============================================================
 * REASONS
 * ============================================================
 */

function buildComparisonReasons(
    target: CandleInfo,
    market: CandleInfo,
    structureScore: number,
    priceActionScore: number,
    volumeScore: number,
    oiScore: number,
    longShortScore: number
): string[] {

    const reasons: string[] = []

    const targetDirection =
        getTargetDirection(target)

    const marketDirection =
        getMarketDirection(market)

    if (
        targetDirection !== "NEUTRAL" &&
        targetDirection === marketDirection
    ) {
        reasons.push(
            `Directional alignment: ${targetDirection}`
        )
    } else if (
        targetDirection !== "NEUTRAL" &&
        marketDirection !== "NEUTRAL"
    ) {
        reasons.push(
            `Directional divergence: target ${targetDirection}, market ${marketDirection}`
        )
    }

    if (structureScore >= 80) {
        reasons.push(
            "Candle structure is strongly aligned"
        )
    } else if (structureScore <= 20) {
        reasons.push(
            "Candle structure is strongly divergent"
        )
    }

    if (priceActionScore >= 80) {
        reasons.push(
            `Price action is aligned (${target.priceAction.dominant})`
        )
    } else if (priceActionScore <= 20) {
        reasons.push(
            "Price action is divergent"
        )
    }

    if (volumeScore >= 80) {
        reasons.push(
            `Volume regime is aligned (${target.volumeState.state})`
        )
    }

    if (oiScore >= 80) {
        reasons.push(
            `Open interest behavior is aligned (${target.openInterest.state})`
        )
    }

    if (longShortScore >= 80) {
        reasons.push(
            `Long/short positioning is aligned (${target.longShort.state})`
        )
    }

    return reasons
}


function buildOverallReasons(
    target: CandleInfo,
    state: MARKET_ALIGNMENT,
    alignmentScore: number,
    marketConsensus: number,
    divergenceScore: number,
    btc: MarketComparison,
    eth: MarketComparison,
    sol: MarketComparison
): string[] {

    const reasons: string[] = []

    reasons.push(
        `BTC alignment score: ${Math.round(btc.score)}`
    )

    reasons.push(
        `ETH alignment score: ${Math.round(eth.score)}`
    )

    reasons.push(
        `SOL alignment score: ${Math.round(sol.score)}`
    )

    if (marketConsensus >= 75) {
        reasons.push(
            "BTC/ETH/SOL show strong market consensus"
        )
    } else if (marketConsensus <= 45) {
        reasons.push(
            "BTC/ETH/SOL show significant market dispersion"
        )
    }

    if (alignmentScore >= 75) {
        reasons.push(
            "Target is strongly participating with the main market"
        )
    } else if (alignmentScore <= 35) {
        reasons.push(
            "Target is behaving differently from the main market"
        )
    }

    if (
        divergenceScore >=
        CONFIG.STRONG_DIVERGENCE
    ) {
        reasons.push(
            state === "DIVERGING_BULLISH"
                ? "Strong bullish relative-strength divergence detected"
                : "Strong bearish relative-strength divergence detected"
        )
    }

    return reasons
}


/*
 * ============================================================
 * EMPTY / NEUTRAL
 * ============================================================
 */

function createNeutralAlignment(
    timestamp: number
): MarketAlignment {

    const component: MarketAlignmentComponent = {
        score: 0,
        direction: "NEUTRAL",
        aligned: false,
        reasons: []
    }

    return {
        state: "NEUTRAL",

        direction: "NEUTRAL",

        strength: 0,

        btc: { ...component },
        eth: { ...component },
        sol: { ...component },

        marketConsensus: 0,

        alignmentScore: 0,

        divergenceScore: 0,

        reasons: [],

        timestamp
    }
}