// Intended location: src/utility/v2/analysis/liquiditySweepInfo.ts
// (sibling of liquidationHeatmap.ts and liquidationHeatmapStamp.ts)

import type {
    CandleInfo,
    LiquiditySweepInfo,
    LIQUIDITY_SWEEP_BEHAVIOR,
} from "@/core/interfacesv2";

import { getLiquidationHeatmap, getPoolValueInRange, getPeakPriceInRange } from "./liquidationHeatmap";

const CONFIG = {
    // Fraction of the active anchor's own peak pool value that must be
    // cleared for a candle to count as a meaningful sweep rather than
    // noise. ARBITRARY, uncalibrated — flagging it as such rather than
    // presenting it as a validated cutoff.
    SWEEP_MEANINGFUL_RATIO_THRESHOLD: 0.15,
};

function emptyResult(timestamp: number, reasons: string[]): LiquiditySweepInfo {
    return {
        behavior: "NO_ACTIVE_HEATMAP",
        sweptValue: 0,
        sweptRatio: 0,
        sweptPriceLow: null,
        sweptPriceHigh: null,
        peakPrice: null,
        measuredSides: [],
        anchorClusterIds: [],
        timestamp,
        reasons,
    };
}

/**
 * Measures how much of the PREVIOUS candle's active liquidity anchor(s)
 * this candle's own [low, high] range swept.
 *
 * "Previous candle's" anchor = whichever side(s) were ACTIVE as of
 * `movingCandles[length-2]`'s stamp — i.e. the heatmap as it stood BEFORE
 * this candle traded. The heatmap is recomputed over
 * [anchorStartIndex, currentIndex) (excluding the current candle) so the
 * measurement reflects genuinely-resting liquidity, not liquidity this
 * candle itself would have contributed.
 *
 * This is purely observational: it does NOT feed back into
 * liquidationHeatmapStamp.ts's lifecycle decision (that's governed only by
 * OI positioning). Whether sweep behavior should eventually influence the
 * lifecycle is a separate, testable question for later — not assumed here.
 *
 * Note on accuracy: liquidationHeatmap.ts uses a single merged pool for
 * long- and short-side contributions (a bucket can carry weight
 * contributed by either side from different candles). That means
 * `sweptValue` is a real, exact number for "how much resting pool value
 * this candle cleared" — but it CANNOT be decomposed into "how much was
 * long-side vs short-side". `measuredSides` only reports which side(s)'
 * anchors were live, not the composition of what got swept.
 */
export function getLiquiditySweepInfo(
    movingCandles: CandleInfo[]
): LiquiditySweepInfo {

    if (movingCandles.length < 2) {
        return emptyResult(
            movingCandles[0]?.openTime ?? 0,
            ["Not enough candle history to measure a sweep"]
        );
    }

    const currentIndex = movingCandles.length - 1;
    const currentCandle = movingCandles[currentIndex];
    const previousCandle = movingCandles[currentIndex - 1];

    const previousStamp = previousCandle.liquidationHeatmapStamp;

    const activeSides: Array<{
        side: "LONG" | "SHORT";
        eventCandleIndex: number;
        clusterId: string | null;
    }> = [];

    if (
        previousStamp?.long.status === "ACTIVE" &&
        previousStamp.long.eventCandleIndex !== null
    ) {
        activeSides.push({
            side: "LONG",
            eventCandleIndex: previousStamp.long.eventCandleIndex,
            clusterId: previousStamp.long.clusterId,
        });
    }

    if (
        previousStamp?.short.status === "ACTIVE" &&
        previousStamp.short.eventCandleIndex !== null
    ) {
        activeSides.push({
            side: "SHORT",
            eventCandleIndex: previousStamp.short.eventCandleIndex,
            clusterId: previousStamp.short.clusterId,
        });
    }

    if (!activeSides.length) {
        return emptyResult(
            currentCandle.openTime,
            ["No ACTIVE liquidity anchor on either side to measure against"]
        );
    }

    const anchorStartIndex = Math.min(
        ...activeSides.map(s => s.eventCandleIndex)
    );

    // Through the previous candle only — excludes the current candle's own
    // contribution, so we're measuring against what was genuinely resting
    // before this candle traded.
    const slice = movingCandles.slice(anchorStartIndex, currentIndex);

    if (!slice.length) {
        return emptyResult(
            currentCandle.openTime,
            ["Active anchor range resolved to an empty candle slice"]
        );
    }

    const heatmapResult = getLiquidationHeatmap(slice);

    if (!heatmapResult) {
        return emptyResult(
            currentCandle.openTime,
            ["Heatmap could not be computed for the active anchor range (e.g. missing ATR)"]
        );
    }

    const sweptValue = getPoolValueInRange(
        heatmapResult,
        currentCandle.low,
        currentCandle.high
    );

    const peakPrice = getPeakPriceInRange(
        heatmapResult,
        currentCandle.low,
        currentCandle.high
    );

    const sweptRatio =
        heatmapResult.globalMaxPoolValue > 0
            ? sweptValue / heatmapResult.globalMaxPoolValue
            : 0;

    const behavior: LIQUIDITY_SWEEP_BEHAVIOR =
        sweptRatio >= CONFIG.SWEEP_MEANINGFUL_RATIO_THRESHOLD
            ? "SWEPT"
            : "NO_SWEEP";

    const reasons: string[] = [
        `Measured against ${activeSides.map(s => s.side).join(" + ")} anchor(s) starting at candle index ${anchorStartIndex}`,
        `Candle range [${currentCandle.low}, ${currentCandle.high}] cleared ${(sweptRatio * 100).toFixed(1)}% of the anchor's peak pool value`,
    ];

    if (behavior === "SWEPT") {
        reasons.push("Meaningful sweep — treat this as evidence the resting liquidity here was taken");
    } else {
        reasons.push("Below the meaningful-sweep threshold — likely noise, not a real liquidity grab");
    }

    return {
        behavior,
        sweptValue,
        sweptRatio,
        sweptPriceLow: currentCandle.low,
        sweptPriceHigh: currentCandle.high,
        peakPrice,
        measuredSides: activeSides.map(s => s.side),
        anchorClusterIds: activeSides
            .map(s => s.clusterId)
            .filter((id): id is string => id !== null),
        timestamp: currentCandle.openTime,
        reasons,
    };
}