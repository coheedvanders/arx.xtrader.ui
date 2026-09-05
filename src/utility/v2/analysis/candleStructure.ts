import type { CandleInfo, CandleStructure, MARKET_DIRECTION } from "@/core/interfacesv2";

/* ============================================================
 * CONFIGURATION
 * All tunable thresholds live here. Nothing below this section
 * should hardcode a magic number — reference these constants.
 * ============================================================ */
const CONFIG = {
    // A candle is a doji when its body is this fraction of its range or less.
    DOJI_BODY_RATIO_THRESHOLD: 0.10,

    // Volatility classification vs. ATR. Purely descriptive of size, not direction.
    EXPANSION_RANGE_ATR_RATIO: 1.5,
    COMPRESSION_RANGE_ATR_RATIO: 0.6,

    // Weights used to compose the 0-100 structural strength score.
    // These weights are applied to independently-normalized (0-1) sub-scores,
    // so their sum should equal 1 for the final score to land cleanly in 0-100.
    STRENGTH_WEIGHTS: {
        body: 0.30,          // how much of the range is "real" body vs wick
        rangeVsAtr: 0.30,    // how large the candle is relative to recent volatility
        closeConviction: 0.20, // how close the close sits to the extreme of the range
        pattern: 0.20,       // bonus for engulfing / outside-bar structural events
    },

    // Range-to-ATR ratio considered "maximally large" for strength normalization.
    // Ratios at or above this are treated as a full-strength contribution.
    STRENGTH_RANGE_ATR_CAP: 2.0,
} as const;

/* ============================================================
 * SAFE MATH HELPERS
 * Centralize all division so NaN/Infinity can never leak out.
 * ============================================================ */
function safeDivide(numerator: number, denominator: number, fallback = 0): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return fallback;
    }
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : fallback;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/* ============================================================
 * RAW GEOMETRY
 * range / body / wicks / ratios / close location.
 * ============================================================ */
interface RawGeometry {
    range: number;
    body: number;
    upperWick: number;
    lowerWick: number;
    bodyRatio: number;
    upperWickRatio: number;
    lowerWickRatio: number;
    closeLocation: number;
}

function computeRawGeometry(candle: CandleInfo): RawGeometry {
    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    // range <= 0 (zero-range or bad data) must never produce NaN/Infinity downstream.
    const safeRange = range > 0 ? range : 0;

    return {
        range: safeRange,
        body,
        upperWick,
        lowerWick,
        bodyRatio: safeDivide(body, safeRange, 0),
        upperWickRatio: safeDivide(upperWick, safeRange, 0),
        lowerWickRatio: safeDivide(lowerWick, safeRange, 0),
        closeLocation: safeDivide(candle.close - candle.low, safeRange, 0.5),
    };
}

/* ============================================================
 * DIRECTION (of THIS candle only — not trend)
 * ============================================================ */
interface DirectionFlags {
    direction: MARKET_DIRECTION;
    isBullish: boolean;
    isBearish: boolean;
    isDoji: boolean;
}

function computeDirection(candle: CandleInfo, bodyRatio: number): DirectionFlags {
    const isBullish = candle.close > candle.open;
    const isBearish = candle.close < candle.open;

    let direction: MARKET_DIRECTION;
    if (candle.close === candle.open) {
        direction = 'NEUTRAL';
    } else {
        direction = isBullish ? 'BULLISH' : 'BEARISH';
    }

    const isDoji = bodyRatio <= CONFIG.DOJI_BODY_RATIO_THRESHOLD;

    return { direction, isBullish, isBearish, isDoji };
}

/* ============================================================
 * ATR NORMALIZATION
 * ============================================================ */
interface AtrRatios {
    rangeAtrRatio: number;
    bodyAtrRatio: number;
}

function computeAtrRatios(candle: CandleInfo, range: number, body: number): AtrRatios {
    const atr = candle.atr;
    const validAtr = Number.isFinite(atr) && atr > 0 ? atr : 0;

    return {
        rangeAtrRatio: safeDivide(range, validAtr, 0),
        bodyAtrRatio: safeDivide(body, validAtr, 0),
    };
}

/* ============================================================
 * EXPANSION / COMPRESSION
 * Size/volatility classification only — never directional.
 * ============================================================ */
interface VolatilityFlags {
    isExpansion: boolean;
    isCompression: boolean;
}

function computeVolatilityFlags(rangeAtrRatio: number): VolatilityFlags {
    return {
        isExpansion: rangeAtrRatio >= CONFIG.EXPANSION_RANGE_ATR_RATIO,
        isCompression: rangeAtrRatio > 0 && rangeAtrRatio <= CONFIG.COMPRESSION_RANGE_ATR_RATIO,
    };
}

/* ============================================================
 * INSIDE BAR / OUTSIDE BAR
 * Causal: only ever compares current candle to the immediately
 * preceding candle. First candle is always false.
 * ============================================================ */
interface ContainmentFlags {
    isInsideBar: boolean;
    isOutsideBar: boolean;
}

function computeContainment(current: CandleInfo, previous: CandleInfo | null): ContainmentFlags {
    if (!previous) {
        return { isInsideBar: false, isOutsideBar: false };
    }

    const isInsideBar = current.high <= previous.high && current.low >= previous.low;
    const isOutsideBar = current.high >= previous.high && current.low <= previous.low;

    return { isInsideBar, isOutsideBar };
}

/* ============================================================
 * ENGULFING (body engulfing, not wick engulfing)
 * Causal: only compares current candle to the immediately
 * preceding candle. First candle is always false.
 * ============================================================ */
interface EngulfingFlags {
    isBullishEngulfing: boolean;
    isBearishEngulfing: boolean;
}

function computeEngulfing(
    current: CandleInfo,
    currentIsBullish: boolean,
    currentIsBearish: boolean,
    previous: CandleInfo | null,
    previousIsBullish: boolean,
    previousIsBearish: boolean,
): EngulfingFlags {
    if (!previous) {
        return { isBullishEngulfing: false, isBearishEngulfing: false };
    }

    const currentBodyTop = Math.max(current.open, current.close);
    const currentBodyBottom = Math.min(current.open, current.close);
    const previousBodyTop = Math.max(previous.open, previous.close);
    const previousBodyBottom = Math.min(previous.open, previous.close);

    const currentBodyEngulfsPrevious =
        currentBodyTop >= previousBodyTop && currentBodyBottom <= previousBodyBottom;

    const isBullishEngulfing =
        previousIsBearish && currentIsBullish && currentBodyEngulfsPrevious;

    const isBearishEngulfing =
        previousIsBullish && currentIsBearish && currentBodyEngulfsPrevious;

    return { isBullishEngulfing, isBearishEngulfing };
}

/* ============================================================
 * CONSECUTIVE BULLISH / BEARISH RUN LENGTH
 * Causal running state carried across the loop in getCandleStructure.
 * ============================================================ */
interface ConsecutiveState {
    consecutiveBullish: number;
    consecutiveBearish: number;
}

function computeConsecutive(
    direction: MARKET_DIRECTION,
    previousState: ConsecutiveState,
): ConsecutiveState {
    if (direction === 'BULLISH') {
        return {
            consecutiveBullish: previousState.consecutiveBullish + 1,
            consecutiveBearish: 0,
        };
    }

    if (direction === 'BEARISH') {
        return {
            consecutiveBullish: 0,
            consecutiveBearish: previousState.consecutiveBearish + 1,
        };
    }

    // NEUTRAL / RANGE resets both runs.
    return { consecutiveBullish: 0, consecutiveBearish: 0 };
}

/* ============================================================
 * STRUCTURAL STRENGTH (0-100)
 * Purely descriptive of how structurally significant the candle
 * ITSELF is — not a prediction, not directional bias.
 * ============================================================ */
function computeStrength(inputs: {
    bodyRatio: number;
    rangeAtrRatio: number;
    closeLocation: number;
    isBullish: boolean;
    isBearish: boolean;
    isBullishEngulfing: boolean;
    isBearishEngulfing: boolean;
    isOutsideBar: boolean;
}): number {
    const { bodyRatio, rangeAtrRatio, closeLocation, isBullish, isBearish,
        isBullishEngulfing, isBearishEngulfing, isOutsideBar } = inputs;

    // 1) Body dominance: a candle that is mostly body is more structurally significant
    //    than one that is mostly wick, regardless of direction.
    const bodyScore = clamp(bodyRatio, 0, 1);

    // 2) Size relative to recent volatility, capped so an outlier can't blow past 1.
    const rangeVsAtrScore = clamp(safeDivide(rangeAtrRatio, CONFIG.STRENGTH_RANGE_ATR_CAP, 0), 0, 1);

    // 3) Conviction of the close: how close it sits to the extreme of the range
    //    in the direction the candle actually closed. A bullish candle closing
    //    near its high is just as "strong" as a bearish candle closing near its low.
    let closeConvictionScore: number;
    if (isBullish) {
        closeConvictionScore = clamp(closeLocation, 0, 1);
    } else if (isBearish) {
        closeConvictionScore = clamp(1 - closeLocation, 0, 1);
    } else {
        // Neutral/doji candles have no directional conviction to reward.
        closeConvictionScore = 0;
    }

    // 4) Pattern bonus: engulfing or outside-bar candles represent a structurally
    //    meaningful event (full absorption of the prior candle) independent of
    //    whether that event is bullish or bearish.
    const patternScore = (isBullishEngulfing || isBearishEngulfing || isOutsideBar) ? 1 : 0;

    const weights = CONFIG.STRENGTH_WEIGHTS;
    const composite =
        bodyScore * weights.body +
        rangeVsAtrScore * weights.rangeVsAtr +
        closeConvictionScore * weights.closeConviction +
        patternScore * weights.pattern;

    return clamp(Math.round(composite * 100), 0, 100);
}

/* ============================================================
 * PUBLIC API
 * ============================================================ */
export function getCandleStructure(candles: CandleInfo[]): CandleStructure {
    const results: CandleStructure[] = [];

    let runningConsecutive: ConsecutiveState = {
        consecutiveBullish: 0,
        consecutiveBearish: 0,
    };

    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const previous = i > 0 ? candles[i - 1] : null;

        const geometry = computeRawGeometry(candle);
        const directionFlags = computeDirection(candle, geometry.bodyRatio);
        const atrRatios = computeAtrRatios(candle, geometry.range, geometry.body);
        const volatilityFlags = computeVolatilityFlags(atrRatios.rangeAtrRatio);
        const containment = computeContainment(candle, previous);

        let previousIsBullish = false;
        let previousIsBearish = false;
        if (previous) {
            previousIsBullish = previous.close > previous.open;
            previousIsBearish = previous.close < previous.open;
        }

        const engulfing = computeEngulfing(
            candle,
            directionFlags.isBullish,
            directionFlags.isBearish,
            previous,
            previousIsBullish,
            previousIsBearish,
        );

        runningConsecutive = computeConsecutive(directionFlags.direction, runningConsecutive);

        const strength = computeStrength({
            bodyRatio: geometry.bodyRatio,
            rangeAtrRatio: atrRatios.rangeAtrRatio,
            closeLocation: geometry.closeLocation,
            isBullish: directionFlags.isBullish,
            isBearish: directionFlags.isBearish,
            isBullishEngulfing: engulfing.isBullishEngulfing,
            isBearishEngulfing: engulfing.isBearishEngulfing,
            isOutsideBar: containment.isOutsideBar,
        });

        const structure: CandleStructure = {
            direction: directionFlags.direction,

            range: geometry.range,
            body: geometry.body,
            upperWick: geometry.upperWick,
            lowerWick: geometry.lowerWick,

            bodyRatio: geometry.bodyRatio,
            upperWickRatio: geometry.upperWickRatio,
            lowerWickRatio: geometry.lowerWickRatio,

            closeLocation: geometry.closeLocation,

            rangeAtrRatio: atrRatios.rangeAtrRatio,
            bodyAtrRatio: atrRatios.bodyAtrRatio,

            isBullish: directionFlags.isBullish,
            isBearish: directionFlags.isBearish,
            isDoji: directionFlags.isDoji,

            isExpansion: volatilityFlags.isExpansion,
            isCompression: volatilityFlags.isCompression,

            isInsideBar: containment.isInsideBar,
            isOutsideBar: containment.isOutsideBar,

            isBullishEngulfing: engulfing.isBullishEngulfing,
            isBearishEngulfing: engulfing.isBearishEngulfing,

            consecutiveBullish: runningConsecutive.consecutiveBullish,
            consecutiveBearish: runningConsecutive.consecutiveBearish,

            strength,
        };

        results.push(structure);
    }

    return results[results.length - 1];
}