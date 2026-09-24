import type { CandleInfo, TrendStats, TrendSegmentStats, AvwapBreakEvent, LS_STATE } from "@/core/interfacesv2";
import { detectTrendSegments } from "./trendState";

// ARBITRARY, stated thresholds — same status as every other ATR
// threshold in this pipeline. How far (in ATRs) price must travel
// PAST the broken level, in the break's own direction, to count as a
// genuine continuation; how far it must travel back through the level
// in the OPPOSITE direction to count as a swept reversal instead.
const CONTINUATION_THRESHOLD_ATR = 1.0;
const REVERSAL_THRESHOLD_ATR = 0.5;
// How many candles forward to look before giving up and calling a
// break's outcome UNRESOLVED. This module runs post-hoc (see its own
// module-level comment on TrendStats in interfacesv2.ts) so looking
// ahead at all is fine here — this cap just keeps a single break from
// searching the entire rest of the dataset for a resolution that may
// never come.
const MAX_LOOKAHEAD_CANDLES = 20;

function mostFrequent<T extends string>(values: T[]): T {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = values[0];
    let bestCount = 0;
    for (const [k, c] of counts) {
        if (c > bestCount) { best = k; bestCount = c; }
    }
    return best;
}

function giFromOpenTime(candles: CandleInfo[], openTime: number): number {
    for (let i = 0; i < candles.length; i++) {
        if (candles[i].openTime === openTime) return i;
    }
    return -1;
}

/**
 * One stats record per fully-resolved trend segment (detectTrendSegments'
 * own batch form — appropriate here since this whole module is a
 * post-hoc pass, not part of the causal walk-forward loop). Captures
 * the confirmation lag, the segment's own "steepness" (a sharp move in
 * few candles vs a slow move over many), and descriptive OI/LS/volume
 * aggregates across the segment's own candles.
 */
function buildSegmentStats(candles: CandleInfo[]): TrendSegmentStats[] {
    const segments = detectTrendSegments(candles);
    const stats: TrendSegmentStats[] = [];

    for (const seg of segments) {
        const startCandle = candles[seg.startGi];
        const endCandle = candles[seg.endGi];
        if (!startCandle || !endCandle) continue;

        const confirmedGi = giFromOpenTime(candles, seg.confirmedOpenTime);
        const durationCandles = seg.endGi - seg.startGi + 1;
        const priceChangePercent = ((endCandle.close - startCandle.close) / startCandle.close) * 100;
        const changePerCandlePercent = durationCandles > 0 ? priceChangePercent / durationCandles : 0;

        const segCandles = candles.slice(seg.startGi, seg.endGi + 1);

        const oiChanges = segCandles
            .map(c => c.openInterest?.valueChangePercent)
            .filter((v): v is number => v != null && Number.isFinite(v));
        const avgOpenInterestChangePercent = oiChanges.length
            ? oiChanges.reduce((a, b) => a + b, 0) / oiChanges.length
            : null;

        const lsStates = segCandles
            .map(c => c.longShort?.state)
            .filter((v): v is LS_STATE => v != null);
        const dominantLongShortState = lsStates.length ? mostFrequent(lsStates) : null;

        const relVols = segCandles
            .map(c => c.volumeState?.relativeVolume)
            .filter((v): v is number => v != null && Number.isFinite(v));
        const avgRelativeVolume = relVols.length
            ? relVols.reduce((a, b) => a + b, 0) / relVols.length
            : null;

        stats.push({
            direction: seg.direction,
            startGi: seg.startGi,
            endGi: seg.endGi,
            startOpenTime: startCandle.openTime,
            endOpenTime: endCandle.openTime,
            confirmedOpenTime: seg.confirmedOpenTime,
            confirmationLagCandles: confirmedGi >= 0 ? confirmedGi - seg.startGi : -1,
            durationCandles,
            priceChangePercent,
            changePerCandlePercent,
            avgOpenInterestChangePercent,
            dominantLongShortState,
            avgRelativeVolume,
        });
    }

    return stats;
}

/** Parses the AVWAP_BODY_BREAK_LEVEL tag out of a candle's own extras (see simulationUtilityV2.ts) — the specific POC AVWAP value that candle's body broke through. */
function parseBreakLevel(candle: CandleInfo): number | null {
    if (!candle.extras?.length) return null;
    const idx = candle.extras.indexOf("AVWAP_BODY_BREAK_LEVEL");
    if (idx === -1) return null;
    const val = parseFloat(candle.extras[idx + 1]);
    return Number.isFinite(val) ? val : null;
}

/**
 * For every AVWAP_BODY_BREAK candle, classifies what happened next:
 * did price keep moving in the break's own direction (CONTINUATION),
 * or reverse back through the level the other way (SWEEP_REVERSAL) —
 * directly answering "price breaks AVWAP high/low then reverses back,
 * more likely a sweep before going the other side" from the request
 * this module exists to serve. Whichever happens FIRST within the
 * lookahead window wins; if neither clears its own threshold in time,
 * the break is left UNRESOLVED rather than forced into either bucket.
 */
function detectAvwapBreakEvents(candles: CandleInfo[]): AvwapBreakEvent[] {
    const events: AvwapBreakEvent[] = [];

    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        if (!candle.conditions_met?.includes("AVWAP_BODY_BREAK")) continue;
        const level = parseBreakLevel(candle);
        if (level == null) continue;

        const breakDirection: "UP" | "DOWN" = candle.close > candle.open ? "UP" : "DOWN";
        const atr = candle.atr > 0 ? candle.atr : 1;

        let outcome: AvwapBreakEvent["outcome"] = "UNRESOLVED";
        let resolvedAtGi: number | null = null;

        const lookaheadEnd = Math.min(i + MAX_LOOKAHEAD_CANDLES, candles.length - 1);
        for (let j = i + 1; j <= lookaheadEnd; j++) {
            const c = candles[j];
            const continuedDist = breakDirection === "UP" ? (c.high - level) / atr : (level - c.low) / atr;
            const reversedDist = breakDirection === "UP" ? (level - c.low) / atr : (c.high - level) / atr;

            if (reversedDist >= REVERSAL_THRESHOLD_ATR) {
                // A same-candle case where BOTH thresholds clear is
                // genuinely ambiguous (which happened first within the
                // candle isn't knowable from OHLC alone) — resolved as
                // SWEEP_REVERSAL rather than CONTINUATION, the more
                // conservative of the two readings.
                outcome = "SWEEP_REVERSAL";
                resolvedAtGi = j;
                break;
            }
            if (continuedDist >= CONTINUATION_THRESHOLD_ATR) {
                outcome = "CONTINUATION";
                resolvedAtGi = j;
                break;
            }
        }

        events.push({
            gi: i,
            openTime: candle.openTime,
            avwapLevel: level,
            breakDirection,
            outcome,
            resolvedAtGi,
            openInterestChangePercent: candle.openInterest?.valueChangePercent ?? null,
            longShortState: candle.longShort?.state ?? null,
            relativeVolume: candle.volumeState?.relativeVolume ?? null,
        });
    }

    return events;
}

/**
 * Builds the full TrendStats summary for one already-analyzed candle
 * array. Must run AFTER SimulationUtilityV2.runAnalysis has fully
 * populated candles (trendState, conditions_met, extras, openInterest,
 * longShort, volumeState) — this module only reads what's already
 * there, it never runs its own market-structure or trend detection
 * from raw OHLCV (detectTrendSegments' own zigzag logic aside, which
 * this reuses rather than duplicates).
 */
export function computeTrendStats(candles: CandleInfo[]): TrendStats {
    return {
        segments: buildSegmentStats(candles),
        avwapBreakEvents: detectAvwapBreakEvents(candles),
    };
}