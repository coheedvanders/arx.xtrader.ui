import { type CandleEntry } from "@/core/interfaces";

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type ConfluenceDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type ConfluenceState =
  | "PRE_BREAK"
  | "RANGE"
  | "BULLISH_BREAK"
  | "BEARISH_BREAK"
  | "BULLISH_RETEST"
  | "BEARISH_RETEST"
  | "BULLISH_ACCEPTANCE"
  | "BEARISH_ACCEPTANCE"
  | "BULLISH_EXPANSION"
  | "BEARISH_EXPANSION"
  | "BULLISH_FAILURE"
  | "BEARISH_FAILURE";

export type PreviousStructure =
  | "BULLISH"
  | "BEARISH"
  | "COMPRESSION"
  | "RANGE"
  | "UNKNOWN";

export interface ConfluenceStateResult {
  direction: ConfluenceDirection;
  state: ConfluenceState;

  bullishScore: number;
  bearishScore: number;

  breakoutDetected: boolean;
  breakoutDirection: ConfluenceDirection;
  breakoutStrength: number;
  breakoutIndex: number;

  retestDetected: boolean;
  retestStrength: number;
  retestIndex: number;

  acceptanceScore: number;
  expansionScore: number;

  previousStructure: PreviousStructure;

  /** True if the *current* active breakout direction has been invalidated. */
  failed: boolean;

  /**
   * True if the structure flipped at least once (an initial breakout failed
   * and price re-broke the opposite boundary). `breakoutDirection` and the
   * score components always describe the *current* (most recent) leg.
   */
  flipped: boolean;

  interactionCount: number;

  reasoning: string[];
}

// =============================================================================
// TUNABLE PARAMETERS
// =============================================================================
//
// Every threshold below is expressed as a ratio/multiplier applied against a
// volatility- or structure-derived unit (ATR, confluence width, average
// volume) rather than as an absolute price or volume figure. This keeps the
// model usable across symbols/timeframes with wildly different tick sizes
// and liquidity. Nothing here is "proven optimal" — it's a sane starting
// point that is intentionally centralized so it can be tuned or exposed as
// config later.

const CONFIG = {
  /** Lookback window (in candles) used to build ATR and recency weighting. */
  atrPeriod: 14,

  /** How many pre-confluence candles to inspect for prior structure. */
  previousStructureLookback: 20,

  /**
   * How close (in ATR units) price needs to get to a boundary to count as a
   * "retest interaction", even without a wick/body fully touching the zone.
   */
  retestProximityAtr: 0.25,

  /** Break distance (in ATR) that is considered a "very strong" break. */
  strongBreakAtrMultiple: 1.5,

  /** Post-retest / post-break displacement (in ATR) considered "full" expansion. */
  fullExpansionAtrMultiple: 3.0,

  /** Recency decay: weight of the oldest interaction relative to the newest (0-1). */
  recencyDecayFloor: 0.25,

  /** acceptanceScore threshold above which state escalates to ACCEPTANCE. */
  acceptanceStateThreshold: 55,

  /** expansionScore threshold above which state escalates to EXPANSION. */
  expansionStateThreshold: 60,

  /** Component weights for the directional score (must sum to 1 when all present). */
  weights: {
    breakQuality: 0.25,
    retestQuality: 0.3,
    acceptance: 0.25,
    expansion: 0.2,
  },
} as const;

// =============================================================================
// SMALL MATH HELPERS
// =============================================================================

const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value));

/** Maps a raw ratio to a 0-100 score by clamping against a "full score" ceiling. */
const scoreFromRatio = (ratio: number, fullScoreAt: number): number =>
  clamp(ratio / fullScoreAt) * 100;

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const safeDiv = (numerator: number, denominator: number, fallback = 0): number =>
  denominator === 0 || !Number.isFinite(denominator) ? fallback : numerator / denominator;

// =============================================================================
// CANDLE-LEVEL PRIMITIVES
// =============================================================================

const range = (c: CandleEntry): number => c.high - c.low;

const body = (c: CandleEntry): number => Math.abs(c.close - c.open);

/** Body size relative to total candle range. Larger = more directional conviction. */
const bodyRatio = (c: CandleEntry): number => safeDiv(body(c), range(c), 0);

const isBullishCandle = (c: CandleEntry): boolean => c.close >= c.open;

/**
 * Where the close sits within the candle's range, oriented so that a close
 * near the "favorable" extreme for the candle's own direction returns ~1,
 * and a close near the opposite extreme returns ~0.
 */
const directionalCloseLocation = (c: CandleEntry): number => {
  const r = range(c);
  if (r === 0) return 0.5;
  const raw = (c.close - c.low) / r; // 0 = at low, 1 = at high
  return isBullishCandle(c) ? raw : 1 - raw;
};

/**
 * Rejection wick opposite to the candle's direction, normalized by range.
 * A bullish candle with a long upper wick (rejected higher prices) has a
 * high value here; a bearish candle with a long lower wick likewise.
 * High values indicate indecision/rejection working against continuation.
 */
const oppositeWickRatio = (c: CandleEntry): number => {
  const r = range(c);
  if (r === 0) return 0;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const opposite = isBullishCandle(c) ? upperWick : lowerWick;
  return clamp(opposite / r);
};

const trueRange = (curr: CandleEntry, prevClose: number | null): number => {
  const hl = curr.high - curr.low;
  if (prevClose === null) return hl;
  return Math.max(hl, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
};

/**
 * Causal ATR at each index: uses only candles up to and including that
 * index, so no future leakage is possible. Returns an array aligned 1:1
 * with `candles`. Early indices (before a full period is available) fall
 * back to a shrinking-window average rather than NaN.
 */
const computeCausalAtr = (candles: readonly CandleEntry[], period: number): number[] => {
  const trs: number[] = candles.map((c, i) =>
    trueRange(c, i === 0 ? null : candles[i - 1].close)
  );

  const atr: number[] = new Array(candles.length).fill(0);
  let windowSum = 0;
  for (let i = 0; i < trs.length; i++) {
    windowSum += trs[i];
    const windowStart = Math.max(0, i - period + 1);
    const windowLength = i - windowStart + 1;
    if (windowLength > period) {
      windowSum -= trs[windowStart - 1];
    }
    const effectiveLength = Math.min(period, i + 1);
    atr[i] = safeDiv(windowSum, effectiveLength, trs[i]);
  }
  return atr;
};

/**
 * A 0-1 "informativeness" weight for a candle: large-bodied, high-range
 * candles (relative to local ATR) carry more evidentiary weight than tiny
 * overlapping candles. Used to weight counts/averages so that a handful of
 * decisive candles can outweigh many insignificant ones.
 */
const candleInformativeness = (c: CandleEntry, atr: number): number => {
  const rangeVsAtr = clamp(safeDiv(range(c), atr, 0), 0, 2) / 2; // 0-1, caps at 2x ATR
  const conviction = bodyRatio(c);
  return clamp(0.5 * rangeVsAtr + 0.5 * conviction);
};

/**
 * Exponential-style recency weight: index 0 (oldest in the slice) gets
 * `CONFIG.recencyDecayFloor`, the last index gets 1.0, interpolated in
 * between. Keeps a single very recent candle from completely erasing an
 * established structure while still favoring fresh evidence.
 */
const recencyWeight = (indexInSlice: number, sliceLength: number): number => {
  if (sliceLength <= 1) return 1;
  const t = indexInSlice / (sliceLength - 1); // 0 (oldest) -> 1 (newest)
  return CONFIG.recencyDecayFloor + (1 - CONFIG.recencyDecayFloor) * t;
};

// =============================================================================
// PREVIOUS STRUCTURE (pre-confluence context)
// =============================================================================

interface Pivot {
  index: number;
  price: number;
  type: "HIGH" | "LOW";
}

/** Simple 3-candle fractal pivot detection (local high/low vs immediate neighbors). */
const findPivots = (candles: readonly CandleEntry[]): Pivot[] => {
  const pivots: Pivot[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];
    if (curr.high > prev.high && curr.high > next.high) {
      pivots.push({ index: i, price: curr.high, type: "HIGH" });
    } else if (curr.low < prev.low && curr.low < next.low) {
      pivots.push({ index: i, price: curr.low, type: "LOW" });
    }
  }
  return pivots;
};

/**
 * Classifies the market structure immediately preceding the confluence using
 * pivot sequencing (higher-highs/higher-lows vs lower-highs/lower-lows) plus
 * a volatility-compression check. This intentionally uses relative
 * comparisons only (pivot-to-pivot, ATR-normalized range) so it generalizes
 * across symbols and timeframes.
 */
const classifyPreviousStructure = (
  priorCandles: readonly CandleEntry[],
  atr: number[]
): PreviousStructure => {
  if (priorCandles.length < 5) return "UNKNOWN";

  const pivots = findPivots(priorCandles);
  const highs = pivots.filter((p) => p.type === "HIGH");
  const lows = pivots.filter((p) => p.type === "LOW");

  const isIncreasing = (arr: Pivot[]): boolean =>
    arr.length >= 2 && arr.every((p, i) => i === 0 || p.price > arr[i - 1].price);
  const isDecreasing = (arr: Pivot[]): boolean =>
    arr.length >= 2 && arr.every((p, i) => i === 0 || p.price < arr[i - 1].price);

  const bullishStructure = isIncreasing(highs) && isIncreasing(lows);
  const bearishStructure = isDecreasing(highs) && isDecreasing(lows);

  // Compression: average true range over the recent window is meaningfully
  // smaller than the average true range over the whole lookback window.
  const recentAtr = atr[atr.length - 1] ?? 0;
  const olderAtr = average(atr.slice(0, Math.max(1, Math.floor(atr.length / 2))));
  const isCompressing = olderAtr > 0 && recentAtr < olderAtr * 0.6;

  if (bullishStructure && !isCompressing) return "BULLISH";
  if (bearishStructure && !isCompressing) return "BEARISH";
  if (isCompressing) return "COMPRESSION";
  return "RANGE";
};

// =============================================================================
// BREAKOUT / RETEST STATE MACHINE
// =============================================================================

interface BreakoutLeg {
  direction: ConfluenceDirection; // "BULLISH" | "BEARISH" (never NEUTRAL here)
  breakoutIndex: number; // index into `active` candles
  retestDetected: boolean;
  retestIndex: number;
  failed: boolean;
  failureIndex: number;

  // Evidence accumulated for scoring, all indices relative to `active`.
  breakCandleIndex: number;
  deepestRetestPenetration: number; // 0 = touched boundary only, 1 = through whole zone, >1 = past far side
  postBreakInteractionIndices: number[]; // candles overlapping/near the zone after the break
  maxFavorableDisplacementAtr: number; // best displacement since retest (or break), in ATR
  candlesSinceReference: number; // candle count since retest (or break if no retest)
}

const oppositeDirection = (d: ConfluenceDirection): ConfluenceDirection =>
  d === "BULLISH" ? "BEARISH" : d === "BEARISH" ? "BULLISH" : "NEUTRAL";

/**
 * Runs the confluence forward through `active` candles (chronological, all
 * at/after confluenceOpenTime) and returns the *current* breakout leg, plus
 * a flag for whether a flip (failed leg followed by an opposite break)
 * occurred anywhere along the way. Only ever looks backward/at the current
 * candle — never ahead — satisfying the no-future-leakage requirement.
 */
const runBreakoutStateMachine = (
  active: readonly CandleEntry[],
  atr: readonly number[],
  confluenceHigh: number,
  confluenceLow: number,
  reasoning: string[]
): { leg: BreakoutLeg | null; flipped: boolean; lastFailedDirection: ConfluenceDirection | null } => {
  const zoneWidth = Math.max(confluenceHigh - confluenceLow, 1e-9);

  let leg: BreakoutLeg | null = null;
  let flipped = false;
  let lastFailedDirection: ConfluenceDirection | null = null;

  const startLeg = (direction: ConfluenceDirection, index: number): BreakoutLeg => ({
    direction,
    breakoutIndex: index,
    retestDetected: false,
    retestIndex: -1,
    failed: false,
    failureIndex: -1,
    breakCandleIndex: index,
    deepestRetestPenetration: 0,
    postBreakInteractionIndices: [],
    maxFavorableDisplacementAtr: 0,
    candlesSinceReference: 0,
  });

  for (let i = 0; i < active.length; i++) {
    const c = active[i];
    const localAtr = atr[i] || 1e-9;

    if (!leg) {
      // Still pre-break: look for the first decisive close beyond a boundary.
      if (c.close > confluenceHigh) {
        leg = startLeg("BULLISH", i);
        reasoning.push(`Bullish break at index ${i}: close ${c.close} > confluenceHigh ${confluenceHigh}.`);
      } else if (c.close < confluenceLow) {
        leg = startLeg("BEARISH", i);
        reasoning.push(`Bearish break at index ${i}: close ${c.close} < confluenceLow ${confluenceLow}.`);
      }
      continue;
    }

    const isBullishLeg = leg.direction === "BULLISH";
    const nearZone =
      isBullishLeg
        ? c.low <= confluenceHigh + localAtr * CONFIG.retestProximityAtr
        : c.high >= confluenceLow - localAtr * CONFIG.retestProximityAtr;

    if (nearZone) {
      leg.postBreakInteractionIndices.push(i);
    }

    if (!leg.retestDetected) {
      // Looking for the first meaningful revisit of the zone.
      if (nearZone) {
        leg.retestDetected = true;
        leg.retestIndex = i;
        leg.candlesSinceReference = 0;

        // Penetration depth normalized by zone width: 0 = boundary only,
        // 1 = fully through to the far boundary, >1 = beyond the far side.
        const penetration = isBullishLeg
          ? clamp(safeDiv(confluenceHigh - c.low, zoneWidth, 0), 0, 3)
          : clamp(safeDiv(c.high - confluenceLow, zoneWidth, 0), 0, 3);
        leg.deepestRetestPenetration = Math.max(leg.deepestRetestPenetration, penetration);

        reasoning.push(
          `${leg.direction} retest at index ${i}, penetration ${(penetration * 100).toFixed(0)}% of zone width.`
        );
      } else {
        leg.candlesSinceReference++;
      }
    } else {
      leg.candlesSinceReference++;
      if (nearZone) {
        const penetration = isBullishLeg
          ? clamp(safeDiv(confluenceHigh - c.low, zoneWidth, 0), 0, 3)
          : clamp(safeDiv(c.high - confluenceLow, zoneWidth, 0), 0, 3);
        leg.deepestRetestPenetration = Math.max(leg.deepestRetestPenetration, penetration);
      }
    }

    // Track best favorable displacement (in ATR) since the reference point
    // (retest if we have one, otherwise the break itself).
    const displacement = isBullishLeg ? c.close - confluenceHigh : confluenceLow - c.close;
    leg.maxFavorableDisplacementAtr = Math.max(
      leg.maxFavorableDisplacementAtr,
      safeDiv(displacement, localAtr, 0)
    );

    // Failure check: a decisive close through the *opposite* boundary
    // invalidates the current leg outright, regardless of prior evidence.
    const failsNow = isBullishLeg ? c.close < confluenceLow : c.close > confluenceHigh;
    if (failsNow) {
      leg.failed = true;
      leg.failureIndex = i;
      reasoning.push(
        `${leg.direction} leg failed at index ${i}: close ${c.close} crossed the opposite boundary.`
      );

      // Flip: treat this same candle as the opening break of the opposite leg
      // so subsequent candles are evaluated against the new direction. The
      // failed leg's outcome is preserved in `reasoning` for auditability.
      flipped = true;
      lastFailedDirection = leg.direction;
      leg = startLeg(oppositeDirection(leg.direction), i);
    }
  }

  return { leg, flipped, lastFailedDirection };
};

// =============================================================================
// SCORING
// =============================================================================

interface ScoreBreakdown {
  breakQuality: number | null;
  retestQuality: number | null;
  acceptance: number | null;
  expansion: number | null;
}

/** Volume relative to a trailing local baseline (excludes the candle itself). */
const relativeVolume = (
  active: readonly CandleEntry[],
  index: number,
  baselinePeriod = 20
): number => {
  const start = Math.max(0, index - baselinePeriod);
  const baseline = active.slice(start, index);
  if (baseline.length === 0) return 1;
  const avgVol = average(baseline.map((c) => c.volume));
  return safeDiv(active[index].volume, avgVol, 1);
};

const scoreBreakQuality = (
  active: readonly CandleEntry[],
  atr: readonly number[],
  leg: BreakoutLeg,
  confluenceHigh: number,
  confluenceLow: number
): number => {
  const c = active[leg.breakCandleIndex];
  const localAtr = atr[leg.breakCandleIndex] || 1e-9;
  const isBullishLeg = leg.direction === "BULLISH";

  const breakDistance = isBullishLeg ? c.close - confluenceHigh : confluenceLow - c.close;
  const distanceScore = scoreFromRatio(
    Math.max(0, breakDistance) / localAtr,
    CONFIG.strongBreakAtrMultiple
  );

  const bodyScore = bodyRatio(c) * 100;
  const closeLocScore = directionalCloseLocation(c) * 100;
  const wickScore = (1 - oppositeWickRatio(c)) * 100;

  const volRatio = relativeVolume(active, leg.breakCandleIndex);
  const volumeScore = scoreFromRatio(volRatio, 2); // 2x avg volume = full score

  return average([distanceScore, bodyScore, closeLocScore, wickScore, volumeScore]);
};

const scoreRetestQuality = (
  active: readonly CandleEntry[],
  leg: BreakoutLeg
): number | null => {
  if (!leg.retestDetected) return null;

  const retestCandle = active[leg.retestIndex];
  const isBullishLeg = leg.direction === "BULLISH";

  // Shallower penetration = stronger. deepestRetestPenetration is already
  // normalized to zone width (0 = boundary touch, 1 = full zone, capped 3).
  const proximityScore = (1 - clamp(leg.deepestRetestPenetration, 0, 1)) * 100;

  // Rejection: for a bullish leg we want the retest candle (or the most
  // extreme interaction) to show a lower-wick rejection and close back
  // above the boundary; mirrored for bearish.
  const rejectionScore = isBullishLeg
    ? (1 - oppositeWickRatio({ ...retestCandle, close: retestCandle.close, open: retestCandle.open } as CandleEntry)) * 100
    : (1 - oppositeWickRatio(retestCandle)) * 100;

  // Reclaim/hold: did the leg avoid failing after the retest was logged?
  const reclaimScore = leg.failed && leg.failureIndex >= leg.retestIndex ? 0 : 100;

  // Volume behavior: constructive when retest volume contracts relative to
  // the break candle (less aggressive opposing participation).
  const breakVol = active[leg.breakCandleIndex].volume;
  const retestVol = retestCandle.volume;
  const volumeScore = scoreFromRatio(1 - clamp(safeDiv(retestVol, breakVol, 1), 0, 1), 0.6);

  return average([proximityScore, rejectionScore, reclaimScore, volumeScore]);
};

const scoreAcceptance = (
  active: readonly CandleEntry[],
  atr: readonly number[],
  leg: BreakoutLeg,
  confluenceHigh: number,
  confluenceLow: number
): number => {
  const isBullishLeg = leg.direction === "BULLISH";
  const referenceIndex = leg.retestDetected ? leg.retestIndex : leg.breakCandleIndex;
  const postCandles = active.slice(referenceIndex + 1);
  if (postCandles.length === 0) return 50; // not enough data yet: neutral

  let weightedOutside = 0;
  let weightedTotal = 0;
  const normalizedDistances: number[] = [];

  postCandles.forEach((c, i) => {
    const globalIndex = referenceIndex + 1 + i;
    const localAtr = atr[globalIndex] || 1e-9;
    const info = candleInformativeness(c, localAtr);
    const rec = recencyWeight(i, postCandles.length);
    const weight = info * rec;

    const isOutside = isBullishLeg ? c.close > confluenceHigh : c.close < confluenceLow;
    weightedTotal += weight;
    if (isOutside) {
      weightedOutside += weight;
      const dist = isBullishLeg ? c.close - confluenceHigh : confluenceLow - c.close;
      normalizedDistances.push(clamp(safeDiv(dist, localAtr, 0), 0, 3) / 3);
    }
  });

  const acceptanceRatioScore = scoreFromRatio(safeDiv(weightedOutside, weightedTotal, 0), 1);
  const distanceMaintainedScore = scoreFromRatio(average(normalizedDistances), 1);
  const noReturnScore = leg.failed ? 0 : 100;

  return average([acceptanceRatioScore, distanceMaintainedScore, noReturnScore]);
};

const scoreExpansion = (
  active: readonly CandleEntry[],
  atr: readonly number[],
  leg: BreakoutLeg
): number => {
  const referenceIndex = leg.retestDetected ? leg.retestIndex : leg.breakCandleIndex;
  const postCandles = active.slice(referenceIndex + 1);
  if (postCandles.length === 0) return 0;

  const displacementScore = scoreFromRatio(
    Math.max(0, leg.maxFavorableDisplacementAtr),
    CONFIG.fullExpansionAtrMultiple
  );

  const velocity = safeDiv(leg.maxFavorableDisplacementAtr, postCandles.length, 0);
  const velocityScore = scoreFromRatio(velocity, CONFIG.fullExpansionAtrMultiple / 3);

  // Volume confirmation: is volume expanding again through the move away
  // from the zone, rather than fading?
  const firstHalfVol = average(postCandles.slice(0, Math.ceil(postCandles.length / 2)).map((c) => c.volume));
  const secondHalfVol = average(postCandles.slice(Math.ceil(postCandles.length / 2)).map((c) => c.volume));
  const volumeConfirmScore = scoreFromRatio(safeDiv(secondHalfVol, firstHalfVol || 1, 1), 1.2);

  return average([displacementScore, velocityScore, volumeConfirmScore]);
};

/**
 * Combines the four components into a single directional confidence score,
 * renormalizing the configured weights when a component is unavailable
 * (e.g. no retest has happened yet) instead of penalizing for missing data.
 */
const combineWeighted = (breakdown: ScoreBreakdown): number => {
  const entries: Array<[number, number]> = [];
  if (breakdown.breakQuality !== null) entries.push([breakdown.breakQuality, CONFIG.weights.breakQuality]);
  if (breakdown.retestQuality !== null) entries.push([breakdown.retestQuality, CONFIG.weights.retestQuality]);
  if (breakdown.acceptance !== null) entries.push([breakdown.acceptance, CONFIG.weights.acceptance]);
  if (breakdown.expansion !== null) entries.push([breakdown.expansion, CONFIG.weights.expansion]);

  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return 50;

  return entries.reduce((sum, [score, w]) => sum + score * (w / totalWeight), 0);
};

// =============================================================================
// STATE RESOLUTION
// =============================================================================

const resolveState = (
  leg: BreakoutLeg | null,
  acceptanceScore: number,
  expansionScore: number,
  active: readonly CandleEntry[],
  flipped: boolean,
  lastFailedDirection: ConfluenceDirection | null
): ConfluenceState => {
  if (!leg) return "RANGE";

  if (leg.failed) {
    return leg.direction === "BULLISH" ? "BULLISH_FAILURE" : "BEARISH_FAILURE";
  }

  // A flip just occurred and the new (opposite) leg hasn't developed any
  // evidence of its own yet — the most informative thing to report is the
  // failure that just happened, not a brand-new "BREAK" with zero history.
  const candlesSinceFlip = active.length - 1 - leg.breakCandleIndex;
  if (flipped && lastFailedDirection && candlesSinceFlip === 0 && !leg.retestDetected) {
    return lastFailedDirection === "BULLISH" ? "BULLISH_FAILURE" : "BEARISH_FAILURE";
  }

  if (!leg.retestDetected) {
    return leg.direction === "BULLISH" ? "BULLISH_BREAK" : "BEARISH_BREAK";
  }
  if (expansionScore >= CONFIG.expansionStateThreshold) {
    return leg.direction === "BULLISH" ? "BULLISH_EXPANSION" : "BEARISH_EXPANSION";
  }
  if (acceptanceScore >= CONFIG.acceptanceStateThreshold) {
    return leg.direction === "BULLISH" ? "BULLISH_ACCEPTANCE" : "BEARISH_ACCEPTANCE";
  }
  return leg.direction === "BULLISH" ? "BULLISH_RETEST" : "BEARISH_RETEST";
};

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Evaluates the directional state of a previously identified confluence
 * zone (`confluenceLow`..`confluenceHigh`) as of the most recent candle in
 * `candles`. See module-level architecture notes below for the scoring
 * model.
 *
 * Uses only `candles` up to and including the last element — never any
 * "future" data — so it is safe to call at any point in a backtest replay.
 */
export function GetConfluenceState(
  candles: CandleEntry[],
  confluenceOpenTime: number,
  confluenceHigh: number,
  confluenceLow: number
): ConfluenceStateResult {
  const reasoning: string[] = [];

  const neutralResult = (message: string): ConfluenceStateResult => {
    reasoning.push(message);
    return {
      direction: "NEUTRAL",
      state: "PRE_BREAK",
      bullishScore: 50,
      bearishScore: 50,
      breakoutDetected: false,
      breakoutDirection: "NEUTRAL",
      breakoutStrength: 0,
      breakoutIndex: -1,
      retestDetected: false,
      retestStrength: 0,
      retestIndex: -1,
      acceptanceScore: 0,
      expansionScore: 0,
      previousStructure: "UNKNOWN",
      failed: false,
      flipped: false,
      interactionCount: 0,
      reasoning,
    };
  };

  // --- Input validation -----------------------------------------------------
  if (!candles || candles.length === 0) {
    return neutralResult("No candle data supplied.");
  }
  if (
    !Number.isFinite(confluenceHigh) ||
    !Number.isFinite(confluenceLow) ||
    confluenceHigh <= confluenceLow
  ) {
    return neutralResult("Invalid confluence range: high must be greater than low.");
  }

  // Sort defensively by openTime without mutating the caller's array; also
  // guards against duplicate timestamps by keeping stable relative order.
  const sorted = candles
    .map((c, originalIndex) => ({ c, originalIndex }))
    .sort((a, b) => a.c.openTime - b.c.openTime || a.originalIndex - b.originalIndex)
    .map((wrapped) => wrapped.c);

  const confluenceCandleIndex = sorted.findIndex((c) => c.openTime >= confluenceOpenTime);
  if (confluenceCandleIndex === -1) {
    return neutralResult("No candles found at or after confluenceOpenTime.");
  }

  const priorCandles = sorted.slice(0, confluenceCandleIndex);
  const active = sorted.slice(confluenceCandleIndex);

  if (active.length === 0) {
    return neutralResult("No candles available at/after the confluence open time yet.");
  }

  // ATR is computed over the full series causally, then sliced, so early
  // `active` candles still benefit from pre-confluence volatility context.
  const fullAtr = computeCausalAtr(sorted, CONFIG.atrPeriod);
  const activeAtr = fullAtr.slice(confluenceCandleIndex);

  const structureLookback = priorCandles.slice(
    Math.max(0, priorCandles.length - CONFIG.previousStructureLookback)
  );
  const previousStructure = classifyPreviousStructure(
    structureLookback,
    fullAtr.slice(Math.max(0, confluenceCandleIndex - structureLookback.length), confluenceCandleIndex)
  );

  const { leg, flipped, lastFailedDirection } = runBreakoutStateMachine(
    active,
    activeAtr,
    confluenceHigh,
    confluenceLow,
    reasoning
  );

  if (!leg) {
    // Price never closed decisively beyond either boundary: still forming.
    reasoning.push("No decisive break of either boundary yet; treating as unresolved range.");
    return {
      direction: "NEUTRAL",
      state: "RANGE",
      bullishScore: 50,
      bearishScore: 50,
      breakoutDetected: false,
      breakoutDirection: "NEUTRAL",
      breakoutStrength: 0,
      breakoutIndex: -1,
      retestDetected: false,
      retestStrength: 0,
      retestIndex: -1,
      acceptanceScore: 0,
      expansionScore: 0,
      previousStructure,
      failed: false,
      flipped: false,
      interactionCount: 0,
      reasoning,
    };
  }

  const breakQuality = scoreBreakQuality(active, activeAtr, leg, confluenceHigh, confluenceLow);
  const retestQuality = scoreRetestQuality(active, leg);
  const acceptanceScore = scoreAcceptance(active, activeAtr, leg, confluenceHigh, confluenceLow);
  const expansionScore = leg.retestDetected ? scoreExpansion(active, activeAtr, leg) : 0;

  let directionalScore = combineWeighted({
    breakQuality,
    retestQuality,
    acceptance: leg.retestDetected ? acceptanceScore : null,
    expansion: leg.retestDetected ? expansionScore : null,
  });

  // Aggressively penalize a failed leg regardless of what earlier evidence
  // looked like — a reclaim/close through the opposite boundary invalidates
  // the thesis outright rather than merely lowering the average.
  if (leg.failed) {
    directionalScore = Math.min(directionalScore, 15);
    reasoning.push(`Directional score capped due to leg failure at index ${leg.failureIndex}.`);
  }

  const state = resolveState(leg, acceptanceScore, expansionScore, active, flipped, lastFailedDirection);

  // For a failure state, the *direction* label reflects the side that is
  // now winning (opposite of the failed leg), matching the convention that
  // `state` names the specific event ("BULLISH_FAILURE") while `direction`
  // names the resulting bias.
  const direction: ConfluenceDirection = leg.failed ? oppositeDirection(leg.direction) : leg.direction;

  const bullishScore = leg.direction === "BULLISH" ? directionalScore : 100 - directionalScore;
  const bearishScore = 100 - bullishScore;

  reasoning.push(
    `Previous structure: ${previousStructure}. Breakout: ${leg.direction} at index ${leg.breakCandleIndex}. ` +
      `Retest: ${leg.retestDetected ? "yes" : "no"}. Failed: ${leg.failed ? "yes" : "no"}. Flipped: ${flipped}.`
  );

  return {
    direction,
    state,
    bullishScore: Math.round(bullishScore * 10) / 10,
    bearishScore: Math.round(bearishScore * 10) / 10,
    breakoutDetected: true,
    breakoutDirection: leg.direction,
    breakoutStrength: Math.round(breakQuality * 10) / 10,
    breakoutIndex: leg.breakCandleIndex,
    retestDetected: leg.retestDetected,
    retestStrength: retestQuality === null ? 0 : Math.round(retestQuality * 10) / 10,
    retestIndex: leg.retestIndex,
    acceptanceScore: Math.round(acceptanceScore * 10) / 10,
    expansionScore: Math.round(expansionScore * 10) / 10,
    previousStructure,
    failed: leg.failed,
    flipped,
    interactionCount: leg.postBreakInteractionIndices.length,
    reasoning,
  };
}