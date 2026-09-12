// Intended location: src/utility/v2/analysis/predictMovement.ts
// (sibling of liquidationHeatmap.ts, liquiditySweepInfo.ts)

import type { CandleInfo, SIGNAL_DIRECTION } from "@/core/interfacesv2";
import { getLiqudationHeatmap, type LiquidationHeatmapResult } from "./liquidationHeatmap";

/**
 * Given the candles inside a manually-drawn liquidity heatmap tool's own
 * range, finds every significant achievable liquidity level (both above
 * and below current price) and gives each one its own probability —
 * rather than collapsing everything into a single pick. "Achievable" =
 * a contiguous CLUSTER of hot buckets, not a lone bucket (see
 * findHotClusters).
 *
 * IMPORTANT — what "probability" actually is: NOT a calibrated
 * statistical estimate. Each level's probability = (how much combined
 * signal weight supports that level's DIRECTION) x (how dominant this
 * specific cluster is among other clusters on the SAME side, by pool
 * value). Left uncapped, every level's probability across BOTH sides
 * sums to exactly 100%. Capping the list to the top few per side (see
 * MAX_LEVELS_PER_SIDE) means the displayed total can come in under 100%
 * — the remainder belongs to smaller clusters not shown.
 *
 * DRAGGABLE LEVELS: recomputeLevelAtPrice lets the UI drag a level line
 * to an arbitrary price and get a live-updated poolValue/probability —
 * using the SAME signal weights the original prediction computed (so
 * dragging doesn't silently redo the OI/LS/price-action/sweep read, only
 * the "which pool sits at this exact price" part), but looking up
 * whatever pool actually exists at the new price rather than trusting a
 * cluster identity that may no longer apply once you've moved off it. If
 * you drag into a cold, empty area, poolValue and probability correctly
 * drop toward zero — that's honest, not a bug.
 *
 * Signals used (all already computed elsewhere in this pipeline except
 * the magnet comparison itself, which is genuinely new — everything else
 * is combined, not re-derived):
 *   - OI positioning: LONG_BUILDUP/SHORT_COVERING lean bullish;
 *     SHORT_BUILDUP/LONG_UNWINDING lean bearish. Weighted by its own
 *     reported strength.
 *   - Long/short ratio state's own `direction` field, weighted by its own
 *     reported strength. This module trusts that field's face-value
 *     meaning rather than re-deriving a bullish/bearish read from the raw
 *     ratio itself — that interpretation already belongs to
 *     longShortRatioState.ts.
 *   - Price action's `dominant` direction, weighted by its own strength —
 *     boosted 1.3x when `strongAction` is true (see priceAction.ts).
 *   - The most recent liquidity sweep: SWEPT_AND_RESPECTED implies
 *     continuing the reference segment's own direction (the zone held);
 *     SWEPT_AND_CONTINUED implies the OPPOSITE (the zone failed) — see
 *     liquiditySweepInfo.ts.
 *   - Liquidity magnet: whichever side (up or down) has the LARGER total
 *     unswept hot pool, weighted by how dominant it is. This is what lets
 *     a side with real liquidity but NO trend-signal support still get
 *     some directional weight. Distance to the pool is NOT factored in
 *     anywhere in this module — a big pool far away counts the same as a
 *     big pool close by. That's a real simplification, stated plainly
 *     rather than assumed away.
 *
 * All trend signals are read from the LAST candle in the given range —
 * "current conditions as of now", not an aggregate across the whole
 * range. Every signal is an equally-weighted vote in the same tally —
 * this module does not try to decide the magnet matters more or less
 * than the trend signals, or vice versa. That's ARBITRARY, stated
 * plainly rather than dressed up as tuned.
 */

const CONFIG = {
    // Where a cell actually starts rendering as visually yellow, not
    // where heatColor()'s own interpolation formula happens to switch
    // branches internally (that's 0.5 — checked the actual RGB output:
    // intensity 0.458 already renders as rgba(234,198,40, .31),
    // unambiguously yellow). 0.3 is where the color first reads as
    // yellow-ish rather than blue-ish. Keep in sync with the same
    // constant in liquiditySweepInfo.ts.
    HOT_THRESHOLD: 0.3,

    // How many clusters to report per side, largest first. ARBITRARY —
    // exists purely to keep the display from listing every tiny cluster.
    MAX_LEVELS_PER_SIDE: 3,
};

export interface PredictionSignal {
    name: string;
    direction: SIGNAL_DIRECTION;
    weight: number; // 0-1
    reason: string;
}

export interface PredictedLevel {
    direction: "up" | "down";
    targetPrice: number;
    poolValue: number;
    /** 0-100 — see this module's own doc comment for exactly how this is split across multiple clusters on the same side. */
    probability: number;
}

export interface MovementPrediction {
    /** Every significant achievable level found, both sides, sorted by probability descending. Empty if no hot zone exists anywhere, or no signal had usable weight. */
    levels: PredictedLevel[];
    signals: PredictionSignal[];
    reasons: string[];
}

function emptyPrediction(reasons: string[]): MovementPrediction {
    return { levels: [], signals: [], reasons };
}

/** The four TREND signals — OI, LS ratio, price action, sweep. Magnet is added separately in buildContext, since it needs both sides' cluster totals, not just the last candle. */
function collectTrendSignals(lastCandle: CandleInfo): PredictionSignal[] {
    const signals: PredictionSignal[] = [];

    const pos = lastCandle.openInterest?.positioningState;
    if (pos && pos.behavior !== "NEUTRAL" && pos.behavior !== "INSUFFICIENT_DATA") {
        const dir: SIGNAL_DIRECTION = (pos.behavior === "LONG_BUILDUP" || pos.behavior === "SHORT_COVERING") ? "LONG" : "SHORT";
        signals.push({
            name: "OI positioning",
            direction: dir,
            weight: Math.max(0, Math.min(1, pos.strength / 100)),
            reason: `${pos.behavior} (strength ${pos.strength.toFixed(0)})`,
        });
    }

    const ls = lastCandle.longShort;
    if (ls && (ls.direction === "BULLISH" || ls.direction === "BEARISH")) {
        const dir: SIGNAL_DIRECTION = ls.direction === "BULLISH" ? "LONG" : "SHORT";
        signals.push({
            name: "Long/short ratio",
            direction: dir,
            weight: Math.max(0, Math.min(1, ls.strength / 100)),
            reason: `${ls.state} (strength ${ls.strength.toFixed(0)})`,
        });
    }

    const pa = lastCandle.priceAction;
    if (pa && pa.dominant !== "NEUTRAL") {
        const boost = pa.strongAction ? 1.3 : 1;
        signals.push({
            name: "Price action",
            direction: pa.dominant,
            weight: Math.max(0, Math.min(1, (pa.strength / 100) * boost)),
            reason: `${pa.dominant} sequence active (strength ${pa.strength.toFixed(0)}, ${Math.round(pa.sequence.completion * 100)}% complete${pa.strongAction ? ", strong action" : ""})`,
        });
    }

    const sweep = lastCandle.liquiditySweepInfo;
    if (sweep?.previousAnchorDirection && (sweep.behavior === "SWEPT_AND_RESPECTED" || sweep.behavior === "SWEPT_AND_CONTINUED")) {
        const respected = sweep.behavior === "SWEPT_AND_RESPECTED";
        const dir: SIGNAL_DIRECTION = respected
            ? sweep.previousAnchorDirection
            : (sweep.previousAnchorDirection === "LONG" ? "SHORT" : "LONG");
        signals.push({
            name: "Liquidity sweep",
            direction: dir,
            weight: Math.max(0, Math.min(1, sweep.strength / 100)),
            reason: respected
                ? `Respected ${sweep.previousAnchorDirection} zone — zone held`
                : `Continued through ${sweep.previousAnchorDirection} zone — zone failed`,
        });
    }

    return signals;
}

interface HotCluster {
    priceLow: number;
    priceHigh: number;
    /** Pool-value-weighted average price within the cluster — where its mass actually concentrates, not just its geometric midpoint. */
    centerPrice: number;
    totalPoolValue: number;
    peakIntensity: number;
}

/**
 * Merges contiguous hot buckets into clusters. A liquidity zone worth
 * calling "a level" is rarely one isolated bucket — it's a run of
 * adjacent hot buckets that together represent a real, substantial pool.
 * The whole contiguous run becomes one cluster here, and its center is
 * pool-weighted (dominated by its hottest buckets), not a plain
 * geometric midpoint.
 */
function findHotClusters(heatmap: LiquidationHeatmapResult): HotCluster[] {
    const clusters: HotCluster[] = [];
    let runIndices: number[] = [];

    const flushRun = () => {
        if (!runIndices.length) return;
        let totalPoolValue = 0;
        let weightedPriceSum = 0;
        let peakIntensity = 0;
        let priceLow = Infinity;
        let priceHigh = -Infinity;
        for (const idx of runIndices) {
            const value = heatmap.finalPool[idx];
            const bLow = heatmap.rangeLow + idx * heatmap.bucketHeight;
            const bMid = bLow + heatmap.bucketHeight / 2;
            totalPoolValue += value;
            weightedPriceSum += value * bMid;
            peakIntensity = Math.max(peakIntensity, value / heatmap.globalMaxPoolValue);
            priceLow = Math.min(priceLow, bLow);
            priceHigh = Math.max(priceHigh, bLow + heatmap.bucketHeight);
        }
        clusters.push({
            priceLow,
            priceHigh,
            centerPrice: totalPoolValue > 0 ? weightedPriceSum / totalPoolValue : (priceLow + priceHigh) / 2,
            totalPoolValue,
            peakIntensity,
        });
        runIndices = [];
    };

    heatmap.finalPool.forEach((value, idx) => {
        const intensity = value / heatmap.globalMaxPoolValue;
        if (intensity >= CONFIG.HOT_THRESHOLD) {
            runIndices.push(idx);
        } else {
            flushRun();
        }
    });
    flushRun();

    return clusters;
}

interface PredictionContext {
    heatmap: LiquidationHeatmapResult;
    currentPrice: number;
    aboveClusters: HotCluster[];
    belowClusters: HotCluster[];
    signals: PredictionSignal[];
    bullishWeight: number;
    bearishWeight: number;
    totalWeight: number;
}

/**
 * Everything both predictMovement and recomputeLevelAtPrice need, built
 * once and shared — so dragging a level doesn't silently redo the trend
 * signal read differently than the original prediction did, and so this
 * logic exists in exactly one place.
 */
function buildContext(rangeCandles: CandleInfo[]): PredictionContext | null {
    if (!rangeCandles.length) return null;
    const heatmap = getLiqudationHeatmap(rangeCandles);
    if (!heatmap) return null;

    const lastCandle = rangeCandles[rangeCandles.length - 1];
    const currentPrice = lastCandle.close;

    const allClusters = findHotClusters(heatmap);
    const aboveClusters = allClusters.filter(c => c.centerPrice > currentPrice);
    const belowClusters = allClusters.filter(c => c.centerPrice < currentPrice);

    const signals = collectTrendSignals(lastCandle);

    const upPool = aboveClusters.reduce((sum, c) => sum + c.totalPoolValue, 0);
    const downPool = belowClusters.reduce((sum, c) => sum + c.totalPoolValue, 0);
    if (upPool > 0 || downPool > 0) {
        const totalPool = upPool + downPool;
        if (upPool > downPool) {
            signals.push({
                name: "Liquidity magnet",
                direction: "LONG",
                weight: upPool / totalPool,
                reason: `Larger total unswept pool above (${upPool.toFixed(2)} vs ${downPool.toFixed(2)} below)`,
            });
        } else if (downPool > upPool) {
            signals.push({
                name: "Liquidity magnet",
                direction: "SHORT",
                weight: downPool / totalPool,
                reason: `Larger total unswept pool below (${downPool.toFixed(2)} vs ${upPool.toFixed(2)} above)`,
            });
        }
    }

    let bullishWeight = 0;
    let bearishWeight = 0;
    for (const s of signals) {
        if (s.direction === "LONG") bullishWeight += s.weight;
        else if (s.direction === "SHORT") bearishWeight += s.weight;
    }

    return { heatmap, currentPrice, aboveClusters, belowClusters, signals, bullishWeight, bearishWeight, totalWeight: bullishWeight + bearishWeight };
}

/**
 * `rangeCandles` = the candles inside the heatmap tool's own selected
 * range (the same slice the tool already computes its own heatmap from).
 */
export function predictMovement(rangeCandles: CandleInfo[]): MovementPrediction {
    const ctx = buildContext(rangeCandles);
    if (!ctx) {
        return emptyPrediction(rangeCandles.length ? ["Heatmap could not be computed for this range (e.g. missing ATR)"] : ["No candles in range"]);
    }

    if (!ctx.signals.length) {
        return emptyPrediction(["No usable OI/LS/price-action/sweep/magnet signal for this range"]);
    }

    const reasons = ctx.signals.map(s => `${s.name}: ${s.direction} (weight ${s.weight.toFixed(2)}) — ${s.reason}`);

    if (ctx.totalWeight === 0) {
        return { levels: [], signals: ctx.signals, reasons: [...reasons, "Signals present but all had zero weight"] };
    }

    // Each side's total directional support is split across that side's
    // own clusters proportional to each cluster's share of that side's
    // total pool — this is what lets a side with several clusters show
    // several levels, each with an honest slice of that side's support.
    const buildLevels = (clusters: HotCluster[], direction: "up" | "down", sideWeight: number): PredictedLevel[] => {
        const sidePool = clusters.reduce((sum, c) => sum + c.totalPoolValue, 0);
        if (sidePool <= 0) return [];
        return clusters
            .map(c => ({
                direction,
                targetPrice: c.centerPrice,
                poolValue: c.totalPoolValue,
                probability: Math.round((sideWeight / ctx.totalWeight) * (c.totalPoolValue / sidePool) * 100),
            }))
            .sort((a, b) => b.poolValue - a.poolValue)
            .slice(0, CONFIG.MAX_LEVELS_PER_SIDE);
    };

    const levels = [
        ...buildLevels(ctx.aboveClusters, "up", ctx.bullishWeight),
        ...buildLevels(ctx.belowClusters, "down", ctx.bearishWeight),
    ].sort((a, b) => b.probability - a.probability);

    if (!levels.length) {
        reasons.push("No hot (yellow/red) liquidity zone exists on either side of current price in this range");
        return { levels: [], signals: ctx.signals, reasons };
    }

    for (const lvl of levels) {
        reasons.push(`${lvl.direction} level at ${lvl.targetPrice.toFixed(4)}: ${lvl.probability}% (pool ${lvl.poolValue.toFixed(2)})`);
    }

    return { levels, signals: ctx.signals, reasons };
}

/**
 * Live-recomputes a level's poolValue/probability at an arbitrary
 * (user-dragged) price, using the SAME signal weights the original
 * prediction computed — only "which pool sits at this exact price" is
 * re-evaluated, not the OI/LS/price-action/sweep read. Looks up whichever
 * cluster (if any) actually contains the new price; dragging into a cold,
 * empty area correctly returns a low/zero poolValue and probability.
 * Returns null only if the range's heatmap can't be computed at all.
 */
export function recomputeLevelAtPrice(
    rangeCandles: CandleInfo[],
    direction: "up" | "down",
    newPrice: number
): { targetPrice: number; poolValue: number; probability: number } | null {
    const ctx = buildContext(rangeCandles);
    if (!ctx || ctx.totalWeight === 0) return null;

    const sideClusters = direction === "up" ? ctx.aboveClusters : ctx.belowClusters;
    const sideWeight = direction === "up" ? ctx.bullishWeight : ctx.bearishWeight;
    const sidePool = sideClusters.reduce((sum, c) => sum + c.totalPoolValue, 0);

    const containing = sideClusters.find(c => newPrice >= c.priceLow && newPrice <= c.priceHigh);
    const poolValue = containing?.totalPoolValue ?? 0;
    const probability = sidePool > 0 ? Math.round((sideWeight / ctx.totalWeight) * (poolValue / sidePool) * 100) : 0;

    return { targetPrice: newPrice, poolValue, probability };
}