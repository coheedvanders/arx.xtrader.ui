import type { CandleInfo } from "@/core/interfacesv2";

/**
 * Liquidity / liquidation heatmap.
 *
 * Simulates a time (x) × price (y) grid the way real liquidation heatmaps
 * (Coinglass/Binance-style) work: a long-side pool (below price — where
 * longs' stops/liquidations sit) and a short-side pool (above price) exist
 * SIMULTANEOUSLY at all times and evolve left→right as a running
 * simulation:
 *
 *   1. Each candle's volume splits into a long-side and short-side
 *      contribution, weighted by how convincingly that candle closed toward
 *      one side of its range (`candleStructure.closeLocation`, used here as
 *      a price-action proxy for crowd positioning — CandleInfo has no raw
 *      OI/L-S survey data), boosted when the candle was a genuine expansion
 *      bar (`candleStructure.isExpansion` + `strength`) rather than noise.
 *      Each side is spread across several sub-distances out from that
 *      candle's OPEN toward an ATR-scaled max distance (using the candle's
 *      own precomputed `atr`), fading with distance — a spread of
 *      leverage tiers rather than one fixed stop distance — and ADDED into
 *      a running per-price-bucket pool that persists across candles.
 *   2. Before adding its own contribution, each candle's actual traded
 *      range [low, high] SWEEPS whatever was already resting in the
 *      buckets it traded through.
 *   3. A snapshot of the pool is taken after every candle — that snapshot
 *      is the grid column at that candle's index.
 *
 * Colors are normalized against the single hottest cell across the WHOLE
 * grid, so a pool built 30 candles ago and one built on the last candle sit
 * on the same brightness scale.
 *
 * Pure function of the candle series — no chart/DOM state — so it can be
 * reused anywhere (the visualizer, a standalone analysis view, tests, etc).
 */

// ─── Tunables ───────────────────────────────────────────────────────────
const HEATMAP_MAX_DISTANCE_ATR = 2.5; // furthest a projected liquidation cluster can sit from its entry candle's open, in ATRs
const HEATMAP_NUM_BUCKETS = 60; // vertical (price) resolution of the grid
const HEATMAP_DECAY_STEPS = 12; // how many sub-distances a single candle's contribution is spread across, near→far
const HEATMAP_MIN_RENDER_RATIO = 0.03; // skip cells below this fraction of the grid's hottest cell

export interface LiquidationHeatmapCell {
  /** Index into the `candles` array this cell's column belongs to. */
  candleIndex: number;
  /** Index of this cell's row within the vertical bucket grid. */
  bucketIndex: number;
  priceLow: number;
  priceHigh: number;
  /** 0..1, normalized against the hottest cell in the whole grid. */
  intensity: number;
  /** Ready-to-use rgba() color string, already alpha-scaled by intensity. */
  color: string;
}

export interface LiquidationHeatmapResult {
  cells: LiquidationHeatmapCell[];
  rangeLow: number;
  rangeHigh: number;
  bucketHeight: number;
  /** The raw (pre-normalization) pool value of the hottest cell — useful for legends/debugging. */
  globalMaxPoolValue: number;
  /**
   * The raw, unfiltered, un-normalized per-bucket pool values as of the
   * LAST candle in the input range (i.e. the final simulation state).
   * `cells` is a lossy, display-oriented view of this (thresholded by
   * HEATMAP_MIN_RENDER_RATIO and normalized against the global max) — use
   * `finalPool` + `getPoolValueInRange` when you need an exact numeric
   * answer (e.g. "how much resting liquidity sits in this exact price
   * range") rather than a rendering.
   */
  finalPool: number[];
}

/** Low→high heat gradient: faint blue (cold) → yellow → red (hot). Opacity rises with intensity too, so a cold cell reads as "barely there" rather than just a different hue. */
function heatColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(59 + (250 - 59) * k);
    const g = Math.round(130 + (204 - 130) * k);
    const b = Math.round(246 + (21 - 246) * k);
    return `rgba(${r},${g},${b},${0.08 + t * 0.5})`;
  }
  const k = (t - 0.5) / 0.5;
  const r = Math.round(250 + (239 - 250) * k);
  const g = Math.round(204 + (68 - 204) * k);
  const b = Math.round(21 + (68 - 21) * k);
  return `rgba(${r},${g},${b},${0.33 + k * 0.55})`;
}

/**
 * Walks every bucket that [low, high] overlaps and invokes `cb` with the
 * bucket's own [bLow, bHigh] bounds, its index, and the overlap fraction
 * (0..1) of [low, high] that falls inside that bucket. Shared by every
 * caller that needs "which buckets does this price range touch, and how
 * much" — previously this index math was duplicated between
 * distributeIntoPool and clearSweptRange; now there's one place that can
 * be wrong instead of two that can silently drift apart.
 */
export function forEachOverlappingBucket(
  low: number,
  high: number,
  rangeLow: number,
  bucketHeight: number,
  numBuckets: number,
  cb: (bucketIndex: number, overlapFraction: number) => void
) {
  if (high <= low || bucketHeight <= 0) return;
  const startIdx = Math.max(0, Math.floor((low - rangeLow) / bucketHeight));
  const endIdx = Math.min(numBuckets - 1, Math.floor((high - rangeLow) / bucketHeight));
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const bLow = rangeLow + idx * bucketHeight;
    const bHigh = bLow + bucketHeight;
    const overlapLow = Math.max(low, bLow);
    const overlapHigh = Math.min(high, bHigh);
    if (overlapHigh > overlapLow) {
      cb(idx, (overlapHigh - overlapLow) / (high - low));
    }
  }
}

/** Adds `weight` into every bucket [low, high] overlaps, split proportionally by overlap fraction. */
function distributeIntoPool(
  pool: number[],
  low: number,
  high: number,
  weight: number,
  rangeLow: number,
  bucketHeight: number,
  numBuckets: number
) {
  if (weight <= 0) return;
  forEachOverlappingBucket(low, high, rangeLow, bucketHeight, numBuckets, (idx, frac) => {
    pool[idx] += weight * frac;
  });
}

/** Zeroes every bucket a candle's actual [low, high] traded through — that resting liquidity has been swept/grabbed. */
function clearSweptRange(
  pool: number[],
  low: number,
  high: number,
  rangeLow: number,
  bucketHeight: number,
  numBuckets: number
) {
  forEachOverlappingBucket(low, high, rangeLow, bucketHeight, numBuckets, (idx) => {
    pool[idx] = 0;
  });
}

/**
 * Sums how much pool value currently rests inside [low, high], using the
 * same overlap-fraction math as clearSweptRange — i.e. this returns
 * exactly the amount clearSweptRange would have zeroed out if a candle
 * with this exact [low, high] traded against this exact pool right now.
 * Read-only: does not mutate `pool`.
 *
 * This is what makes "how much did this candle sweep" measurable from
 * OUTSIDE the simulation loop, against a heatmap computed for an earlier
 * point in time (e.g. "the heatmap as of the previous candle") — see
 * getLiquiditySweepInfo in liquiditySweepInfo.ts.
 */
export function getPoolValueInRange(
  result: Pick<LiquidationHeatmapResult, "finalPool" | "rangeLow" | "bucketHeight">,
  low: number,
  high: number
): number {
  let sum = 0;
  forEachOverlappingBucket(
    low,
    high,
    result.rangeLow,
    result.bucketHeight,
    result.finalPool.length,
    (idx, frac) => {
      sum += result.finalPool[idx] * frac;
    }
  );
  return sum;
}

/**
 * Finds the price (bucket midpoint) with the highest resting pool value
 * within [low, high]. Used to answer "if this candle swept resting
 * liquidity, WHERE specifically was it densest" — a more defensible
 * anchor/level than arbitrarily picking the candle's own high or low.
 * Returns null if no bucket in range has any value.
 */
export function getPeakPriceInRange(
  result: Pick<LiquidationHeatmapResult, "finalPool" | "rangeLow" | "bucketHeight">,
  low: number,
  high: number
): number | null {
  let bestIdx = -1;
  let bestValue = 0;
  forEachOverlappingBucket(
    low,
    high,
    result.rangeLow,
    result.bucketHeight,
    result.finalPool.length,
    (idx) => {
      if (result.finalPool[idx] > bestValue) {
        bestValue = result.finalPool[idx];
        bestIdx = idx;
      }
    }
  );
  if (bestIdx < 0) return null;
  return result.rangeLow + bestIdx * result.bucketHeight + result.bucketHeight / 2;
}

/**
 * Computes a liquidation/liquidity heatmap for the given candle window.
 * `candles` should be in chronological order; the whole array is treated as
 * the analysis range (slice before calling if you only want a sub-range —
 * e.g. the range the user drag-selected on the chart).
 */
export function getLiqudationHeatmap(candles: CandleInfo[]): LiquidationHeatmapResult | null {
  if (!candles || candles.length === 0) return null;

  const lastAtr = candles[candles.length - 1]?.atr ?? 0;
  if (!(lastAtr > 0)) return null;
  const maxDistance = lastAtr * HEATMAP_MAX_DISTANCE_ATR;

  let candlesLow = Infinity;
  let candlesHigh = -Infinity;
  for (const c of candles) {
    if (c.low < candlesLow) candlesLow = c.low;
    if (c.high > candlesHigh) candlesHigh = c.high;
  }
  if (!isFinite(candlesLow) || !isFinite(candlesHigh)) return null;

  const rangeLow = candlesLow - maxDistance;
  const rangeHigh = candlesHigh + maxDistance;
  const bucketHeight = (rangeHigh - rangeLow) / HEATMAP_NUM_BUCKETS;
  if (!(bucketHeight > 0)) return null;

  // Normalize volume against the biggest seen in this range, so contribution
  // size is relative to this window rather than an absolute threshold.
  let maxVolume = 0;
  for (const c of candles) maxVolume = Math.max(maxVolume, c.volume ?? 0);

  const pool = new Array(HEATMAP_NUM_BUCKETS).fill(0);
  const stepSize = maxDistance / HEATMAP_DECAY_STEPS;
  const columnSnapshots: number[][] = [];

  for (const c of candles) {
    // 1) SWEEP — this candle's own traded range consumes whatever resting
    // liquidity earlier candles built up inside it.
    clearSweptRange(pool, c.low, c.high, rangeLow, bucketHeight, HEATMAP_NUM_BUCKETS);

    // 2) NEW CONTRIBUTION — split into long-side (below open) and short-side
    // (above open) pools, both always present simultaneously. Weighted by
    // where this candle closed within its own range (a price-action proxy
    // for which side was more aggressive) and boosted for genuine expansion
    // bars, since those are the ones that actually build fresh, at-risk
    // positioning rather than chop.
    const volumeNorm = maxVolume > 0 ? (c.volume ?? 0) / maxVolume : 0;
    const structure = c.candleStructure;
    const buyPressure = structure ? Math.max(0, Math.min(1, structure.closeLocation)) : 0.5;
    const conviction = structure ? Math.max(0, Math.min(1, structure.strength ?? 0)) : 0;
    const freshPositionBoost = structure?.isExpansion ? conviction : conviction * 0.4;

    const longWeight = volumeNorm * buyPressure * (1 + freshPositionBoost);
    const shortWeight = volumeNorm * (1 - buyPressure) * (1 + freshPositionBoost);

    for (let s = 0; s < HEATMAP_DECAY_STEPS; s++) {
      const decay = 1 - s / HEATMAP_DECAY_STEPS; // 1.0 near the open, fading toward 0 at the ATR-scaled max distance
      if (decay <= 0) break;

      const longLow = c.open - (s + 1) * stepSize;
      const longHigh = c.open - s * stepSize;
      distributeIntoPool(pool, longLow, longHigh, longWeight * decay, rangeLow, bucketHeight, HEATMAP_NUM_BUCKETS);

      const shortLow = c.open + s * stepSize;
      const shortHigh = c.open + (s + 1) * stepSize;
      distributeIntoPool(pool, shortLow, shortHigh, shortWeight * decay, rangeLow, bucketHeight, HEATMAP_NUM_BUCKETS);
    }

    columnSnapshots.push(pool.slice());
  }

  // Global max across every column/bucket — puts the whole grid's colors on one comparable scale.
  let globalMax = 0;
  for (const snap of columnSnapshots) {
    for (const v of snap) if (v > globalMax) globalMax = v;
  }
  if (globalMax <= 0) return null;

  const cells: LiquidationHeatmapCell[] = [];
  columnSnapshots.forEach((snap, candleIndex) => {
    snap.forEach((value, bucketIndex) => {
      const intensity = value / globalMax;
      if (intensity < HEATMAP_MIN_RENDER_RATIO) return;
      const priceLow = rangeLow + bucketIndex * bucketHeight;
      const priceHigh = priceLow + bucketHeight;
      cells.push({
        candleIndex,
        bucketIndex,
        priceLow,
        priceHigh,
        intensity,
        color: heatColor(intensity),
      });
    });
  });

  return {
    cells,
    rangeLow,
    rangeHigh,
    bucketHeight,
    globalMaxPoolValue: globalMax,
    finalPool: pool.slice(),
  };
}

/** Correctly-spelled alias — same function, in case callers prefer it. */
export const getLiquidationHeatmap = getLiqudationHeatmap;