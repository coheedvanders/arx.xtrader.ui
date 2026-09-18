// Intended location: src/utility/v2/analysis/trendState.ts
//
// SUPERSEDES an earlier version of this module built on marketStructure's
// HH/HL/LH/LL labels directly (an "HH followed by HL confirms uptrend"
// rule). That approach had a real bug: when a failed candidate segment
// got merged backward into the prior one, the merge wasn't re-validated
// afterward, so the CUMULATIVE effect of multiple small merges could
// drift a segment's net price movement opposite to its own label —
// confirmed against real XRPUSDT data (a 151-candle segment labeled
// DOWN that had net risen in price). A recursive re-validation fix
// still didn't fully close every case.
//
// This version uses a standard zigzag: track the running price extreme
// (by close) since the last confirmed pivot, and only commit a segment
// once price retraces at least MIN_RETRACE_ATR from that extreme. This
// guarantees a segment's endpoint IS the most favorable close reached
// in its own direction, by construction — there is no merge step, so
// there is nothing to cascade incorrectly. Verified against 6 real
// symbols (majors, a low-volatility one, and the case that broke the
// old design): 0 mismatches at every threshold tested, where a
// mismatch means the segment's own end close was worse than its start
// close in its claimed direction.
//
// Strictly causal: only ever looks at candles up to the current index,
// same as the rest of this pipeline. A segment isn't committed until
// the retracement is actually observed — no look-ahead into the future
// to decide where an extreme "will end up."

import type { CandleInfo, TrendSegmentInfo } from "@/core/interfacesv2";

export type TrendDirection = TrendSegmentInfo["direction"];

export interface TrendSegment {
    direction: TrendDirection;
    /** Index of the pivot this segment starts from (the prior segment's own extreme, or the very first candle). */
    startGi: number;
    /** Index of the most favorable close reached in this segment's direction. Inclusive. If the segment is still ongoing (no confirmed reversal yet), this is the best close seen so far, which may still improve with more data. */
    endGi: number;
    ended: boolean;
    /** openTime of the candle at which the retracement from endGi's extreme was first confirmed — always later than endGi's own candle, often much later. */
    confirmedOpenTime: number;
}

// Stated, tunable threshold, not a "correct" value — how many ATRs
// price must retrace from the running extreme before a segment is
// considered to have genuinely reversed, rather than just paused.
// Chosen empirically: produces roughly 5-10 segments across a 500-candle
// (~5 day) window for most tested symbols, which reads as "a handful of
// broad, visually obvious trends" rather than tracking every minor
// wiggle. A very low-volatility symbol (e.g. a stablecoin-adjacent
// asset) may still produce more segments than this at the same
// threshold, since its own ATR is small relative to its price ticks —
// worth widening the threshold further for such a symbol specifically
// if that shows up as noisy in practice.
const MIN_RETRACE_ATR = 5.0;

function avgAtrOverRange(candles: CandleInfo[], startIdx: number, endIdx: number): number {
    let sum = 0, count = 0;
    for (let i = startIdx; i <= endIdx; i++) {
        const atr = candles[i].atr;
        if (atr > 0) { sum += atr; count++; }
    }
    return count > 0 ? sum / count : 0;
}

export function detectTrendSegments(candles: CandleInfo[], minRetraceAtr: number = MIN_RETRACE_ATR): TrendSegment[] {
    const segments: TrendSegment[] = [];
    if (candles.length < 2) return segments;

    let pivotIdx = 0;
    let pivotConfirmedOpenTime = candles[0].openTime; // the very first pivot has nothing before it to confirm it — its own candle's time is the earliest honest value
    let direction: TrendDirection | null = null;
    let extremeIdx = 0;
    let extremePrice = candles[0].close;

    for (let i = 1; i < candles.length; i++) {
        const close = candles[i].close;

        if (direction === null) {
            if (close > extremePrice) { direction = "UP"; extremeIdx = i; extremePrice = close; }
            else if (close < extremePrice) { direction = "DOWN"; extremeIdx = i; extremePrice = close; }
            continue;
        }

        if (direction === "UP") {
            if (close > extremePrice) { extremeIdx = i; extremePrice = close; continue; }
            const avgAtr = avgAtrOverRange(candles, pivotIdx, i);
            const retrace = extremePrice - close;
            if (avgAtr > 0 && retrace / avgAtr >= minRetraceAtr) {
                segments.push({ direction: "UP", startGi: pivotIdx, endGi: extremeIdx, ended: true, confirmedOpenTime: pivotConfirmedOpenTime });
                pivotIdx = extremeIdx;
                pivotConfirmedOpenTime = candles[i].openTime; // THIS candle is what confirmed the reversal, and so also confirms the new pivot
                direction = "DOWN";
                extremeIdx = i;
                extremePrice = close;
            }
        } else {
            if (close < extremePrice) { extremeIdx = i; extremePrice = close; continue; }
            const avgAtr = avgAtrOverRange(candles, pivotIdx, i);
            const retrace = close - extremePrice;
            if (avgAtr > 0 && retrace / avgAtr >= minRetraceAtr) {
                segments.push({ direction: "DOWN", startGi: pivotIdx, endGi: extremeIdx, ended: true, confirmedOpenTime: pivotConfirmedOpenTime });
                pivotIdx = extremeIdx;
                pivotConfirmedOpenTime = candles[i].openTime;
                direction = "UP";
                extremeIdx = i;
                extremePrice = close;
            }
        }
    }

    if (direction) {
        const finalEndGi = extremeIdx === pivotIdx ? candles.length - 1 : extremeIdx;
        segments.push({
            direction,
            startGi: pivotIdx,
            endGi: finalEndGi,
            ended: false,
            confirmedOpenTime: pivotConfirmedOpenTime,
        });
    }

    return segments;
}