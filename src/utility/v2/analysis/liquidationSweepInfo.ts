// Intended location: src/utility/v2/analysis/liquiditySweepInfo.ts
// (sibling of liquidationHeatmap.ts and liquidityHeatmapAnchor.ts)

import type {
    CandleInfo,
    LiquiditySweepInfo,
    LIQUIDITY_SWEEP_BEHAVIOR,
    SIGNAL_DIRECTION,
} from "@/core/interfacesv2";

import {
    getLiqudationHeatmap,
    forEachOverlappingBucket,
    type LiquidationHeatmapResult,
} from "./liquidationHeatmap";

/**
 * Measures how much of the PREVIOUS confirmed liquidity-heatmap-anchor
 * segment's "yellow and red" (hot) liquidity this candle's own [low, high]
 * range has swept, and whether that sweep looked like the level held
 * (support/resistance respected) or failed (broken through).
 *
 * "Previous segment" = the most recently CLOSED [START, END] pair from
 * liquidityHeatmapAnchor.ts — never the segment currently forming. If a
 * new trend is actively building right now, this deliberately still
 * measures against the trend BEFORE it, since the current one hasn't
 * closed out a heatmap of its own yet to measure against.
 *
 * "Yellow and red" = intensity >= HOT_THRESHOLD (0.3) on
 * liquidationHeatmap.ts's color gradient. NOT the same as heatColor()'s
 * own 0.5 branch-point, which sounds like it should be the blue/yellow
 * transition but isn't — the RGB math shows cells well below 0.5 already
 * render as visibly yellow (0.458 renders as rgba(234,198,40), clearly
 * yellow, not blue). 0.3 is where the color first reads as yellow-ish
 * rather than blue-ish — an earlier version of this file used 0.5,
 * checked directly against actual RGB output, and corrected. Cold
 * liquidity is deliberately excluded from every measurement here: it's
 * not what a trader means by "the pool" when looking at a heatmap.
 *
 * IMPORTANT SIMPLIFICATION: this is a per-candle SNAPSHOT against the
 * reference segment's original, unconsumed hot pool — not a running
 * depletion tracker. If three consecutive candles each dip into the same
 * zone, each one reports its own overlap against the FULL original hot
 * pool, not "what's left after the previous candle already took some".
 * Tracking true cumulative depletion across many candles would need
 * shared, mutable state keyed by pairId threaded across calls — a real
 * option later if this simpler version proves too noisy, but not assumed
 * necessary yet.
 *
 * Respect vs failure is decided on THIS CANDLE ALONE (open/close relative
 * to the hot zone's bounds) — a wick-sweep-and-reject read, same
 * single-candle scope every other module here uses. A slower multi-candle
 * grind through a zone before eventually reversing will NOT show up as
 * "respected" by this measure — that's a real scope limit, not silently
 * papered over.
 */

const CONFIG = {
    // Where a cell actually starts rendering as visually yellow, not
    // where heatColor()'s own interpolation formula happens to switch
    // branches internally (that's 0.5 — checked the actual RGB output:
    // intensity 0.458 already renders as rgba(234,198,40, .31),
    // unambiguously yellow, while 0.5 was excluding real, visibly-warm
    // zones like that one). 0.3 is where the color first reads as
    // yellow-ish rather than blue-ish (rgba(174,174,111) at exactly
    // 0.3) — still an eyeballed cutoff, not precisely derived, but a real
    // correction from a concrete measurement. Keep in sync with the same
    // constant in predictMovement.ts.
    HOT_THRESHOLD: 0.3,
};

function emptyResult(timestamp: number, reasons: string[]): LiquiditySweepInfo {
    return {
        behavior: "NO_PREVIOUS_ANCHOR",
        previousAnchorPairId: null,
        previousAnchorDirection: null,
        sweptValue: 0,
        totalHotPoolValue: 0,
        sweptRatio: 0,
        strength: 0,
        hotZoneLow: null,
        hotZoneHigh: null,
        sweptPriceLow: null,
        sweptPriceHigh: null,
        timestamp,
        reasons,
    };
}

interface ClosedSegment {
    pairId: string;
    startGi: number;
    endGi: number;
    direction: SIGNAL_DIRECTION;
}

/**
 * Re-derives every FULLY CLOSED [START, END] segment from the candles'
 * own liquidityAnchor arrays (same technique the UI's lhAnchorPairs
 * computed uses) and returns the most recently closed one — i.e. the
 * "previous heatmap anchor" relative to whatever's happening now, whether
 * that's a fresh segment currently forming or just undetermined structure.
 * A segment still awaiting its own END is never returned here — it has no
 * confirmed heatmap of its own yet to measure against.
 */
function findPreviousClosedSegment(candles: CandleInfo[]): ClosedSegment | null {
    const starts = new Map<string, number>();
    const ends = new Map<string, number>();
    const directions = new Map<string, SIGNAL_DIRECTION>();

    candles.forEach((c, gi) => {
        for (const a of c.liquidityAnchor ?? []) {
            if (a.type === "START") starts.set(a.pairId, gi);
            else ends.set(a.pairId, gi);
            directions.set(a.pairId, a.direction);
        }
    });

    let best: ClosedSegment | null = null;
    for (const [pairId, startGi] of starts) {
        const endGi = ends.get(pairId);
        if (endGi === undefined) continue; // still ongoing — not eligible
        if (!best || endGi > best.endGi) {
            best = { pairId, startGi, endGi, direction: directions.get(pairId)! };
        }
    }
    return best;
}

/** Sums only the HOT (intensity >= HOT_THRESHOLD) portion of the pool overlapping [low, high] — getPoolValueInRange in liquidationHeatmap.ts sums the whole pool (hot + cold), which isn't what "swept the yellow/red" means. */
function sumHotPoolInRange(
    result: LiquidationHeatmapResult,
    hotBucketMask: boolean[],
    low: number,
    high: number
): number {
    let sum = 0;
    forEachOverlappingBucket(low, high, result.rangeLow, result.bucketHeight, result.finalPool.length, (idx, frac) => {
        if (hotBucketMask[idx]) sum += result.finalPool[idx] * frac;
    });
    return sum;
}

export function getLiquiditySweepInfo(movingCandles: CandleInfo[]): LiquiditySweepInfo {
    if (movingCandles.length < 2) {
        return emptyResult(movingCandles[0]?.openTime ?? 0, ["Not enough candle history to measure a sweep"]);
    }

    const currentIndex = movingCandles.length - 1;
    const currentCandle = movingCandles[currentIndex];

    const prevSegment = findPreviousClosedSegment(movingCandles);
    if (!prevSegment) {
        return emptyResult(currentCandle.openTime, ["No previously confirmed liquidity heatmap anchor segment to measure against yet"]);
    }

    // Only candles genuinely AFTER the reference segment are meaningful —
    // measuring a segment against its own candles would be circular.
    if (currentIndex <= prevSegment.endGi) {
        return emptyResult(currentCandle.openTime, [`Current candle (index ${currentIndex}) is still within the reference segment itself (ends at ${prevSegment.endGi})`]);
    }

    const slice = movingCandles.slice(prevSegment.startGi, prevSegment.endGi + 1);
    const heatmapResult = getLiqudationHeatmap(slice);
    if (!heatmapResult) {
        return emptyResult(currentCandle.openTime, ["Heatmap could not be computed for the reference segment (e.g. missing ATR)"]);
    }

    // Identify every hot bucket up front — reused both for the total and for the sweep-overlap sum.
    const hotBucketMask: boolean[] = new Array(heatmapResult.finalPool.length).fill(false);
    let totalHotPoolValue = 0;
    let hotZoneLow = Infinity;
    let hotZoneHigh = -Infinity;
    heatmapResult.finalPool.forEach((value, idx) => {
        const intensity = value / heatmapResult.globalMaxPoolValue;
        if (intensity >= CONFIG.HOT_THRESHOLD) {
            hotBucketMask[idx] = true;
            totalHotPoolValue += value;
            const bLow = heatmapResult.rangeLow + idx * heatmapResult.bucketHeight;
            hotZoneLow = Math.min(hotZoneLow, bLow);
            hotZoneHigh = Math.max(hotZoneHigh, bLow + heatmapResult.bucketHeight);
        }
    });

    if (totalHotPoolValue <= 0 || !isFinite(hotZoneLow)) {
        return {
            ...emptyResult(currentCandle.openTime, ["Reference segment's heatmap has no yellow/red (hot) liquidity to measure against"]),
            behavior: "NO_SWEEP",
            previousAnchorPairId: prevSegment.pairId,
            previousAnchorDirection: prevSegment.direction,
        };
    }

    const sweptValue = sumHotPoolInRange(heatmapResult, hotBucketMask, currentCandle.low, currentCandle.high);
    const sweptRatio = totalHotPoolValue > 0 ? sweptValue / totalHotPoolValue : 0;

    // Based on ACTUAL overlap with a hot bucket (sweptValue > 0), not just
    // entering [hotZoneLow, hotZoneHigh] — that bounding box can have gaps
    // between individual hot buckets, so touching the envelope alone
    // doesn't mean anything hot was actually reached.
    const touchedHotZone = sweptValue > 0;

    let behavior: LIQUIDITY_SWEEP_BEHAVIOR;
    const reasons: string[] = [
        `Measured against ${prevSegment.direction} segment ${prevSegment.pairId} (candles ${prevSegment.startGi}-${prevSegment.endGi})`,
        `Hot (yellow/red) zone: [${hotZoneLow.toFixed(4)}, ${hotZoneHigh.toFixed(4)}], total hot pool value ${totalHotPoolValue.toFixed(2)}`,
    ];

    if (!touchedHotZone) {
        behavior = "NO_SWEEP";
        reasons.push(`Candle range [${currentCandle.low}, ${currentCandle.high}] never reached the hot zone`);
    } else {
        reasons.push(`Candle range [${currentCandle.low}, ${currentCandle.high}] cleared ${(sweptRatio * 100).toFixed(1)}% of the hot pool`);

        // Respect/failure read: did THIS candle enter the zone from one
        // side and close back out the same side it came from?
        const enteredFromAbove = currentCandle.open >= hotZoneHigh;
        const enteredFromBelow = currentCandle.open <= hotZoneLow;

        if (enteredFromAbove && currentCandle.close > hotZoneHigh) {
            behavior = "SWEPT_AND_RESPECTED";
            reasons.push("Opened above the zone, dipped into it, closed back above — zone acted as support");
        } else if (enteredFromBelow && currentCandle.close < hotZoneLow) {
            behavior = "SWEPT_AND_RESPECTED";
            reasons.push("Opened below the zone, poked into it, closed back below — zone acted as resistance");
        } else {
            behavior = "SWEPT_AND_CONTINUED";
            reasons.push("Closed inside or through the zone — did not hold as support/resistance on this candle");
        }
    }

    return {
        behavior,
        previousAnchorPairId: prevSegment.pairId,
        previousAnchorDirection: prevSegment.direction,
        sweptValue,
        totalHotPoolValue,
        sweptRatio,
        strength: Math.max(0, Math.min(100, sweptRatio * 100)),
        hotZoneLow,
        hotZoneHigh,
        sweptPriceLow: currentCandle.low,
        sweptPriceHigh: currentCandle.high,
        timestamp: currentCandle.openTime,
        reasons,
    };
}