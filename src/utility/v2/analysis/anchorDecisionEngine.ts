import type { CandleInfo, CandleAnchor, CandleAnchors, ANCHOR_REASON } from "@/core/interfacesv2";

/* ============================================================
 * PURPOSE
 * ============================================================
 * Answers ONE question for the CURRENT (last) candle in the
 * supplied array: "should this candle become an anchor for
 * AVWAP / Liquidity Heatmap / FRVP?"
 *
 * It does NOT calculate AVWAP, the heatmap, or FRVP themselves.
 * It does NOT return a historical array of anchors — the caller
 * (SimulationUtilityV2) already assigns the result to the
 * current candle:
 *
 *     candle.anchors = getAnchorDecision(movingCandles)
 *
 * CAUSALITY: only candles[0..idx] are ever read, where
 * idx = candles.length - 1. Nothing beyond the current candle
 * is inspected, so this is safe to call incrementally as new
 * candles arrive in realtime or in a walk-forward backtest.
 *
 * HYSTERESIS: because each candle's own `.anchors` decision is
 * persisted onto it by the caller as the simulation progresses,
 * this module can look BACKWARD at candles[j].anchors to find
 * the last time a given system anchored, and require a minimum
 * spacing before allowing a new one — without needing any
 * external state of its own. This is what stops the anchor from
 * jittering every bar while a regime is still developing.
 * ============================================================ */

/* ============================================================
 * CONFIGURATION — all tunable thresholds live here.
 * ============================================================ */
const CONFIG = {
    // RANGE_START: fires on the transition INTO compression.
    // rangeAtrRatio at/below FULL scores max confidence; at/above ZERO scores 0.
    RANGE_START_FULL_CONF_RATIO: 0.2,
    RANGE_START_ZERO_CONF_RATIO: 0.6,

    // CONSOLIDATION_START: confirmed persistence of compression over a window.
    CONSOLIDATION_LOOKBACK: 6,
    CONSOLIDATION_MIN_COMPRESSED_FRACTION: 0.7,

    // SWING_START: provisional wick-rejection swing (no future confirmation).
    SWING_LOOKBACK: 3,
    SWING_MIN_REJECTION_WICK_RATIO: 0.4,
    SWING_FULL_CONF_WICK_RATIO: 0.8,
    SWING_MIN_CLOSE_LOCATION_FOR_LOW: 0.6,   // close must sit in the upper 40% of range after a low sweep
    SWING_MAX_CLOSE_LOCATION_FOR_HIGH: 0.4,  // close must sit in the lower 40% of range after a high sweep

    // IMPULSE_ORIGIN: first candle of a brand-new directional run, not a continuation.
    IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN: 1,
    IMPULSE_MIN_BODY_RATIO_FOR_CONF: 0.4,
    IMPULSE_FULL_CONF_BODY_RATIO: 0.9,

    // STRUCTURE_BREAK: close beyond the prior N-candle high/low.
    STRUCTURE_BREAK_LOOKBACK: 20,

    // LIQUIDITY_REGIME_CHANGE: current candle's volatility state differs from
    // the dominant state of the preceding window (compression <-> expansion).
    LIQUIDITY_REGIME_LOOKBACK: 8,
    LIQUIDITY_REGIME_MAJORITY_FRACTION: 0.6,

    // LIQUIDITY_SWEEP: wick takes out a prior extreme, candle rejects back in.
    LIQUIDITY_SWEEP_LOOKBACK: 10,
    LIQUIDITY_SWEEP_MIN_WICK_RATIO: 0.4,
    LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO: 0.8,
    LIQUIDITY_SWEEP_MAX_CLOSE_LOCATION_AFTER_HIGH_SWEEP: 0.4,
    LIQUIDITY_SWEEP_MIN_CLOSE_LOCATION_AFTER_LOW_SWEEP: 0.6,

    // RECLAIM: close moves back through a recently-broken reference level.
    // NOTE: uses a simple "start-of-window close" as the reference level since
    // dedicated support/resistance detection is out of scope for this module —
    // a later structure module can supply a better level for this candidate.
    RECLAIM_LOOKBACK: 8,
    RECLAIM_MIN_BODY_RATIO_FOR_CONF: 0.3,
    RECLAIM_FULL_CONF_BODY_RATIO: 0.8,

    // DISPLACEMENT: unusually large, decisive body relative to ATR.
    DISPLACEMENT_MIN_BODY_ATR_RATIO: 1.2,
    DISPLACEMENT_MIN_BODY_RATIO: 0.6,

    // SESSION_START: new UTC calendar day.
    SESSION_TIMEZONE_OFFSET_MS: 0, // shift if a non-UTC session boundary is desired later

    // HYSTERESIS: minimum candles between two anchors of the same system.
    HEATMAP_MIN_SPACING: 5,
    AVWAP_MIN_SPACING: 3,
    FRVP_MIN_SPACING: 5,
} as const;

/* ============================================================
 * MATH HELPERS
 * ============================================================ */
function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Linearly maps `value` from the range [x0 -> x1] onto [y0 -> y1], clamped.
 * Works regardless of whether x0 < x1 or x0 > x1 (i.e. increasing or
 * decreasing confidence as the raw value grows).
 */
function linearScale(value: number, x0: number, y0: number, x1: number, y1: number): number {
    if (!Number.isFinite(value) || x0 === x1) return y0;
    const t = clamp((value - x0) / (x1 - x0), 0, 1);
    return y0 + t * (y1 - y0);
}

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return fallback;
    }
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : fallback;
}

/* ============================================================
 * CANDIDATE SIGNAL
 * Internal representation of "this detector fired, with this
 * much confidence" — kept separate from final anchor selection.
 * ============================================================ */
interface CandidateSignal {
    reason: ANCHOR_REASON;
    confidence: number; // 0-100
}

function emptyAnchor(): CandleAnchor {
    return { isAnchor: false, reasons: [], confidence: 0 };
}

/**
 * Trailing window of `length` candles ENDING AT (and including) `idx`.
 * Never reaches past idx.
 */
function trailingWindowInclusive(candles: CandleInfo[], idx: number, length: number): CandleInfo[] {
    return candles.slice(Math.max(0, idx - length + 1), idx + 1);
}

/**
 * Trailing window of `length` candles BEFORE `idx` (excludes idx itself).
 */
function trailingWindowExclusive(candles: CandleInfo[], idx: number, length: number): CandleInfo[] {
    return candles.slice(Math.max(0, idx - length), idx);
}

function getUtcDayKey(timestampMs: number): number {
    return Math.floor((timestampMs + CONFIG.SESSION_TIMEZONE_OFFSET_MS) / 86_400_000);
}

/* ============================================================
 * CANDIDATE DETECTORS
 * Each inspects candles[0..idx] ONLY and returns a signal (or
 * null) for whether idx qualifies as that kind of candidate.
 * ============================================================ */

/** Transition INTO a compressed/quiet state — the tentative start of a range. */
function detectRangeStart(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const cs = candles[idx].candleStructure;
    if (!cs) return null;

    const previousCs = idx > 0 ? candles[idx - 1].candleStructure : null;
    const wasNotCompressed = !previousCs || !previousCs.isCompression;

    if (cs.isCompression && wasNotCompressed) {
        const confidence = linearScale(
            cs.rangeAtrRatio,
            CONFIG.RANGE_START_FULL_CONF_RATIO, 100,
            CONFIG.RANGE_START_ZERO_CONF_RATIO, 0
        );
        return { reason: 'RANGE_START', confidence: Math.round(confidence) };
    }
    return null;
}

/** Confirmed persistence of compression over a trailing window — fires ONCE, on confirmation. */
function detectConsolidationStart(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const cs = candles[idx].candleStructure;
    if (!cs || !cs.isCompression) return null;
    if (idx < CONFIG.CONSOLIDATION_LOOKBACK - 1) return null;

    const currentWindow = trailingWindowInclusive(candles, idx, CONFIG.CONSOLIDATION_LOOKBACK);
    const currentFraction = safeDivide(
        currentWindow.filter(c => c.candleStructure?.isCompression).length,
        currentWindow.length
    );
    if (currentFraction < CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION) return null;

    // Only fire on the candle where the threshold is first crossed — otherwise
    // every subsequent still-compressed candle would re-fire the same signal.
    const previousWindow = trailingWindowInclusive(candles, idx - 1, CONFIG.CONSOLIDATION_LOOKBACK);
    const previousFraction = previousWindow.length
        ? safeDivide(previousWindow.filter(c => c.candleStructure?.isCompression).length, previousWindow.length)
        : 0;
    if (previousFraction >= CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION) return null;

    const confidence = linearScale(currentFraction, CONFIG.CONSOLIDATION_MIN_COMPRESSED_FRACTION, 60, 1, 100);
    return { reason: 'CONSOLIDATION_START', confidence: Math.round(confidence) };
}

/**
 * Provisional swing origin: current candle takes out the recent trailing
 * extreme AND shows wick rejection back into range. This is intentionally
 * NOT a confirmed fractal swing (that would require future candles) — it's
 * the earliest causal evidence available that a swing may be forming.
 */
function detectSwingStart(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const current = candles[idx];
    const cs = current.candleStructure;
    if (!cs || idx < CONFIG.SWING_LOOKBACK) return null;

    const priorWindow = trailingWindowExclusive(candles, idx, CONFIG.SWING_LOOKBACK);
    if (!priorWindow.length) return null;

    const priorLow = Math.min(...priorWindow.map(c => c.low));
    const priorHigh = Math.max(...priorWindow.map(c => c.high));

    const isLowSweepRejection =
        current.low <= priorLow &&
        cs.lowerWickRatio >= CONFIG.SWING_MIN_REJECTION_WICK_RATIO &&
        cs.closeLocation >= CONFIG.SWING_MIN_CLOSE_LOCATION_FOR_LOW;

    if (isLowSweepRejection) {
        const confidence = linearScale(
            cs.lowerWickRatio,
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO, 50,
            CONFIG.SWING_FULL_CONF_WICK_RATIO, 100
        );
        return { reason: 'SWING_START', confidence: Math.round(confidence) };
    }

    const isHighSweepRejection =
        current.high >= priorHigh &&
        cs.upperWickRatio >= CONFIG.SWING_MIN_REJECTION_WICK_RATIO &&
        cs.closeLocation <= CONFIG.SWING_MAX_CLOSE_LOCATION_FOR_HIGH;

    if (isHighSweepRejection) {
        const confidence = linearScale(
            cs.upperWickRatio,
            CONFIG.SWING_MIN_REJECTION_WICK_RATIO, 50,
            CONFIG.SWING_FULL_CONF_WICK_RATIO, 100
        );
        return { reason: 'SWING_START', confidence: Math.round(confidence) };
    }

    return null;
}

/** First candle of a brand-new directional run with an expansion-sized, dominant body. */
function detectImpulseOrigin(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const cs = candles[idx].candleStructure;
    if (!cs || !cs.isExpansion || cs.isDoji) return null;

    const isOrigin =
        (cs.direction === 'BULLISH' && cs.consecutiveBullish <= CONFIG.IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN) ||
        (cs.direction === 'BEARISH' && cs.consecutiveBearish <= CONFIG.IMPULSE_MAX_CONSECUTIVE_FOR_ORIGIN);
    if (!isOrigin) return null;

    const confidence = linearScale(
        cs.bodyRatio,
        CONFIG.IMPULSE_MIN_BODY_RATIO_FOR_CONF, 50,
        CONFIG.IMPULSE_FULL_CONF_BODY_RATIO, 100
    );
    return { reason: 'IMPULSE_ORIGIN', confidence: Math.round(confidence) };
}

/** Close breaks decisively beyond the prior N-candle high/low. */
function detectStructureBreak(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const current = candles[idx];
    const cs = current.candleStructure;
    if (!cs || idx < CONFIG.STRUCTURE_BREAK_LOOKBACK) return null;

    const priorWindow = trailingWindowExclusive(candles, idx, CONFIG.STRUCTURE_BREAK_LOOKBACK);
    if (!priorWindow.length) return null;

    const priorHigh = Math.max(...priorWindow.map(c => c.high));
    const priorLow = Math.min(...priorWindow.map(c => c.low));
    const range = cs.range || 1;

    if (current.close > priorHigh) {
        const overshoot = safeDivide(current.close - priorHigh, range);
        const confidence = linearScale(overshoot, 0, 55, 1, 100);
        return { reason: 'STRUCTURE_BREAK', confidence: Math.round(confidence) };
    }
    if (current.close < priorLow) {
        const overshoot = safeDivide(priorLow - current.close, range);
        const confidence = linearScale(overshoot, 0, 55, 1, 100);
        return { reason: 'STRUCTURE_BREAK', confidence: Math.round(confidence) };
    }
    return null;
}

/** Current candle's volatility state (compression/expansion) flips relative to the recent dominant state. */
function detectLiquidityRegimeChange(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const cs = candles[idx].candleStructure;
    if (!cs || idx < CONFIG.LIQUIDITY_REGIME_LOOKBACK) return null;

    const priorWindow = trailingWindowExclusive(candles, idx, CONFIG.LIQUIDITY_REGIME_LOOKBACK);
    if (!priorWindow.length || !priorWindow.every(c => c.candleStructure)) return null;

    const compressedFraction = safeDivide(priorWindow.filter(c => c.candleStructure!.isCompression).length, priorWindow.length);
    const expandedFraction = safeDivide(priorWindow.filter(c => c.candleStructure!.isExpansion).length, priorWindow.length);

    const priorDominant: 'compression' | 'expansion' | 'neutral' =
        compressedFraction >= CONFIG.LIQUIDITY_REGIME_MAJORITY_FRACTION ? 'compression' :
            expandedFraction >= CONFIG.LIQUIDITY_REGIME_MAJORITY_FRACTION ? 'expansion' : 'neutral';

    const currentState: 'compression' | 'expansion' | 'neutral' =
        cs.isCompression ? 'compression' : cs.isExpansion ? 'expansion' : 'neutral';

    if (priorDominant === 'neutral' || currentState === 'neutral' || currentState === priorDominant) {
        return null;
    }

    const confidence = currentState === 'expansion'
        ? linearScale(cs.rangeAtrRatio, 1.5, 60, 3, 100)
        : linearScale(cs.rangeAtrRatio, 0.6, 60, 0.2, 100);

    return { reason: 'LIQUIDITY_REGIME_CHANGE', confidence: Math.round(confidence) };
}

/** Wick takes out a prior extreme, but the candle closes back inside the prior range — a liquidity grab. */
function detectLiquiditySweep(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const current = candles[idx];
    const cs = current.candleStructure;
    if (!cs || idx < CONFIG.LIQUIDITY_SWEEP_LOOKBACK) return null;

    const priorWindow = trailingWindowExclusive(candles, idx, CONFIG.LIQUIDITY_SWEEP_LOOKBACK);
    if (!priorWindow.length) return null;

    const priorHigh = Math.max(...priorWindow.map(c => c.high));
    const priorLow = Math.min(...priorWindow.map(c => c.low));

    const sweptHigh =
        current.high > priorHigh &&
        cs.upperWickRatio >= CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO &&
        cs.closeLocation <= CONFIG.LIQUIDITY_SWEEP_MAX_CLOSE_LOCATION_AFTER_HIGH_SWEEP;

    if (sweptHigh) {
        const confidence = linearScale(
            cs.upperWickRatio,
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO, 55,
            CONFIG.LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO, 100
        );
        return { reason: 'LIQUIDITY_SWEEP', confidence: Math.round(confidence) };
    }

    const sweptLow =
        current.low < priorLow &&
        cs.lowerWickRatio >= CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO &&
        cs.closeLocation >= CONFIG.LIQUIDITY_SWEEP_MIN_CLOSE_LOCATION_AFTER_LOW_SWEEP;

    if (sweptLow) {
        const confidence = linearScale(
            cs.lowerWickRatio,
            CONFIG.LIQUIDITY_SWEEP_MIN_WICK_RATIO, 55,
            CONFIG.LIQUIDITY_SWEEP_FULL_CONF_WICK_RATIO, 100
        );
        return { reason: 'LIQUIDITY_SWEEP', confidence: Math.round(confidence) };
    }

    return null;
}

/**
 * Close reclaims a recently-broken reference level. Uses the close at the
 * start of the lookback window as a simple stand-in for "a level" — this is
 * intentionally basic; real support/resistance belongs to a later module.
 */
function detectReclaim(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const current = candles[idx];
    const cs = current.candleStructure;
    if (!cs || idx < CONFIG.RECLAIM_LOOKBACK) return null;

    const priorWindow = trailingWindowExclusive(candles, idx, CONFIG.RECLAIM_LOOKBACK);
    if (!priorWindow.length) return null;

    const level = priorWindow[0].close;
    const wasBrokenBelow = priorWindow.some(c => c.close < level);
    const wasBrokenAbove = priorWindow.some(c => c.close > level);

    if (wasBrokenBelow && current.close > level && cs.isBullish) {
        const confidence = linearScale(cs.bodyRatio, CONFIG.RECLAIM_MIN_BODY_RATIO_FOR_CONF, 55, CONFIG.RECLAIM_FULL_CONF_BODY_RATIO, 100);
        return { reason: 'RECLAIM', confidence: Math.round(confidence) };
    }
    if (wasBrokenAbove && current.close < level && cs.isBearish) {
        const confidence = linearScale(cs.bodyRatio, CONFIG.RECLAIM_MIN_BODY_RATIO_FOR_CONF, 55, CONFIG.RECLAIM_FULL_CONF_BODY_RATIO, 100);
        return { reason: 'RECLAIM', confidence: Math.round(confidence) };
    }
    return null;
}

/** Unusually large, decisive body relative to recent volatility (ATR). */
function detectDisplacement(candles: CandleInfo[], idx: number): CandidateSignal | null {
    const cs = candles[idx].candleStructure;
    if (!cs || cs.isDoji) return null;

    if (cs.bodyAtrRatio >= CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO && cs.bodyRatio >= CONFIG.DISPLACEMENT_MIN_BODY_RATIO) {
        const confidence = linearScale(
            cs.bodyAtrRatio,
            CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO, 55,
            CONFIG.DISPLACEMENT_MIN_BODY_ATR_RATIO * 2, 100
        );
        return { reason: 'DISPLACEMENT', confidence: Math.round(confidence) };
    }
    return null;
}

/** Current candle opens on a new UTC calendar day relative to the previous candle. */
function detectSessionStart(candles: CandleInfo[], idx: number): CandidateSignal | null {
    if (idx === 0) return null; // nothing to compare the very first candle against

    const current = candles[idx];
    const previous = candles[idx - 1];
    if (getUtcDayKey(current.openTime) !== getUtcDayKey(previous.openTime)) {
        return { reason: 'SESSION_START', confidence: 100 };
    }
    return null;
}

/* ============================================================
 * ANCHOR SELECTION
 * Combines candidate signals for a system, applies hysteresis
 * against that system's own anchor history, and produces the
 * final CandleAnchor for the current candle.
 * ============================================================ */

/**
 * Walks backward from just before `idx` to find the most recent candle
 * where the given system was already an anchor. Reads the decisions the
 * caller has already persisted onto earlier candles — this IS the engine's
 * only form of state, and it's entirely causal (never reads ahead of idx).
 */
function findLastAnchorIndex(candles: CandleInfo[], idx: number, system: keyof CandleAnchors): number {
    for (let j = idx - 1; j >= 0; j--) {
        if (candles[j].anchors?.[system]?.isAnchor) return j;
    }
    return -1;
}

function dedupeReasons(reasons: ANCHOR_REASON[]): ANCHOR_REASON[] {
    return Array.from(new Set(reasons));
}

function buildAnchor(
    candidates: (CandidateSignal | null)[],
    candles: CandleInfo[],
    idx: number,
    system: keyof CandleAnchors,
    minSpacing: number
): CandleAnchor {
    const valid = candidates.filter((c): c is CandidateSignal => c !== null);
    if (!valid.length) return emptyAnchor();

    // Hysteresis: suppress a new anchor if the last one for this system is too recent.
    const lastAnchorIndex = findLastAnchorIndex(candles, idx, system);
    if (lastAnchorIndex >= 0 && idx - lastAnchorIndex < minSpacing) {
        return emptyAnchor();
    }

    const reasons = dedupeReasons(valid.map(v => v.reason));
    const confidence = clamp(Math.round(Math.max(...valid.map(v => v.confidence))), 0, 100);

    return { isAnchor: true, reasons, confidence };
}

function selectLiquidityHeatmapAnchor(candles: CandleInfo[], idx: number): CandleAnchor {
    const candidates = [
        detectRangeStart(candles, idx),
        detectConsolidationStart(candles, idx),
        detectSwingStart(candles, idx),
        detectImpulseOrigin(candles, idx),
        detectLiquidityRegimeChange(candles, idx),
    ];
    return buildAnchor(candidates, candles, idx, 'liquidityHeatmap', CONFIG.HEATMAP_MIN_SPACING);
}

function selectAvwapAnchor(candles: CandleInfo[], idx: number): CandleAnchor {
    const candidates = [
        detectLiquiditySweep(candles, idx),
        detectDisplacement(candles, idx),
        detectReclaim(candles, idx),
        detectStructureBreak(candles, idx),
        detectImpulseOrigin(candles, idx),
        detectSessionStart(candles, idx),
    ];
    return buildAnchor(candidates, candles, idx, 'avwap', CONFIG.AVWAP_MIN_SPACING);
}

function selectFrvpAnchor(candles: CandleInfo[], idx: number): CandleAnchor {
    const candidates = [
        detectRangeStart(candles, idx),
        detectConsolidationStart(candles, idx),
        detectImpulseOrigin(candles, idx),
        detectStructureBreak(candles, idx),
        detectSessionStart(candles, idx),
    ];
    return buildAnchor(candidates, candles, idx, 'frvp', CONFIG.FRVP_MIN_SPACING);
}

/* ============================================================
 * PUBLIC API
 * ============================================================ */

/**
 * Decides whether the LAST candle in `candles` should become an anchor for
 * AVWAP, the Liquidity Heatmap, and/or FRVP. Intended to be called
 * incrementally as `candle.anchors = getAnchorDecision(candles.slice(0, i + 1))`
 * — only candles[0..last] are ever inspected.
 */
export function getAnchorDecision(candles: CandleInfo[]): CandleAnchors {
    if (!candles || candles.length === 0) {
        return { avwap: emptyAnchor(), liquidityHeatmap: emptyAnchor(), frvp: emptyAnchor() };
    }

    const idx = candles.length - 1;
    const current = candles[idx];

    // candleStructure must already be computed for this candle (see candleStructure.ts) —
    // without it there's nothing safe to evaluate.
    if (!current.candleStructure) {
        return { avwap: emptyAnchor(), liquidityHeatmap: emptyAnchor(), frvp: emptyAnchor() };
    }

    return {
        avwap: selectAvwapAnchor(candles, idx),
        liquidityHeatmap: selectLiquidityHeatmapAnchor(candles, idx),
        frvp: selectFrvpAnchor(candles, idx),
    };
}