/**
 * rangeAnalyze.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Deterministic short-term (scalping) price-action / order-flow analyzer.
 *
 * Consumes the exact same JSON payload produced by the "Range Download"
 * tool (see buildRangeExportPayload() in CandleEntryVisualizerComponent.vue)
 * and produces a single RangeAnalysisResult: LONG / SHORT / NEUTRAL bias,
 * a confidence score, trade levels (entry/TP/SL/R:R), entry quality, and a
 * full breakdown of the reasoning per data source.
 *
 * No network calls, no LLM calls — pure functions over the supplied data.
 * Same input always produces the same output.
 *
 * Sources considered (each optional — never fabricated if missing):
 *   - OHLCV candles + EMA200
 *   - Open Interest
 *   - Long/Short account ratio
 *   - Anchored VWAP(s)
 *   - Fixed Range Volume Profile(s)
 */

// ─────────────────────────────────────────────────────────────────────────
// Input types (mirrors the Range Download export payload)
// ─────────────────────────────────────────────────────────────────────────

export interface RangeCandleInput {
  index: number;
  openTimeIso: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema200: number | null;
  openInterest: number | null;
  longShortRatio: { longAccount: number; shortAccount: number } | null;
}

export interface AnchoredVwapPointInput {
  index: number;
  openTimeIso: string | null;
  mid: number;
  upper: number;
  lower: number;
}

export interface AnchoredVwapInput {
  id: number | string;
  anchorIndex: number;
  isOpenEnded: boolean;
  points: AnchoredVwapPointInput[];
}

export interface FrvpBucketInput {
  priceLow: number;
  priceHigh: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  isPoc: boolean;
}

export interface FrvpInput {
  ownRange: { startIndex: number; endIndex: number };
  rangeHighPrice: number;
  rangeLowPrice: number;
  pocPrice: number;
  totalVolume: number;
  buckets: FrvpBucketInput[];
}

export interface RangeAnalysisInput {
  symbol: string;
  interval: string;
  generatedAt?: string;
  range: { startIndex: number; endIndex: number; candleCount: number };
  candles: RangeCandleInput[];
  anchoredVwaps: AnchoredVwapInput[];
  fixedRangeVolumeProfiles: FrvpInput[];
  /**
   * Optional: an already-placed Preview Buy/Sell position (see
   * `previewPosition` in CandleEntryVisualizerComponent.vue). When supplied,
   * the analyzer additionally scores the probability of THIS position's
   * TP being hit before its SL/invalidation, instead of only proposing its
   * own bias/TP/SL from scratch.
   */
  previewPosition?: PreviewPositionInput | null;
}

export interface PreviewPositionInput {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Output types
// ─────────────────────────────────────────────────────────────────────────

export type Bias = 'LONG' | 'SHORT' | 'NEUTRAL';

export type EntryQuality = 'VERY_GOOD' | 'GOOD' | 'FAIR' | 'POOR' | 'EXTENDED';

export type PositionAlignment = 'ALIGNED' | 'OPPOSED' | 'NEUTRAL';

export type TpRealism = 'WITHIN_STRUCTURE' | 'AT_STRUCTURE' | 'BEYOND_STRUCTURE' | 'UNKNOWN';

export interface PositionAnalysisResult {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  tpPrice: number;
  slPrice: number;

  tpDistancePercent: number;
  slDistancePercent: number;
  riskReward: number;

  /** 0-100. Confidence the TP is hit before the SL / thesis invalidation. */
  tpHitConfidence: number;

  /** How the position's side compares to the analyzer's own structural read. */
  alignment: PositionAlignment;

  /** Extension/chase check applied to the position's actual entry price. */
  entryQuality: EntryQuality;

  /** Known structural levels (swing, AVWAP, FRVP, EMA200) sitting between entry and TP. */
  obstacles: string[];

  tpRealism: TpRealism;

  description: string;
  thesis: string;
}

export interface RangeAnalysisResult {
  symbol: string;
  interval: string;

  bias: Bias;
  confidence: number;

  lastPrice: number;
  lastCandleTimeIso: string | null;
  lastCandleTimePht: string;

  entryQuality: EntryQuality;

  entryReference: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;

  /** Present only when a Preview Buy/Sell position was supplied as input. */
  position: PositionAnalysisResult | null;

  trend: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    priceVsEma: 'ABOVE' | 'BELOW' | 'RECLAIMING' | 'LOSING' | 'UNAVAILABLE';
    ema200: number | null;
    distancePercent: number | null;
    description: string;
  };

  priceAction: {
    structure: 'BULLISH' | 'BEARISH' | 'REVERSAL_BULLISH' | 'REVERSAL_BEARISH' | 'RANGE' | 'NEUTRAL';
    description: string;
  };

  openInterest: {
    status: 'FRESH_LONGS' | 'FRESH_SHORTS' | 'SHORT_COVERING' | 'LONG_LIQUIDATION' | 'MIXED' | 'UNAVAILABLE';
    description: string;
  };

  longShort: {
    longPercent: number | null;
    shortPercent: number | null;
    interpretation:
      | 'BULLISH_CONFIRMATION'
      | 'BEARISH_CONFIRMATION'
      | 'SQUEEZE_FUEL'
      | 'CROWDED_LONG'
      | 'CROWDED_SHORT'
      | 'NEUTRAL'
      | 'UNAVAILABLE';
    description: string;
  };

  avwap: {
    available: boolean;
    bias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE';
    nearestMid: number | null;
    nearestUpper: number | null;
    nearestLower: number | null;
    description: string;
  };

  frvp: {
    available: boolean;
    bias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE';
    nearestPoc: number | null;
    rangeHigh: number | null;
    rangeLow: number | null;
    pocBuyVolume: number | null;
    pocSellVolume: number | null;
    description: string;
  };

  supportingSignals: string[];
  contradictingSignals: string[];

  thesis: string;
  risk: string;

  scoreBreakdown: {
    priceAction: number;
    ema: number;
    openInterest: number;
    longShort: number;
    avwap: number;
    frvp: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal shared types
// ─────────────────────────────────────────────────────────────────────────

/** score: -1 (max bearish) .. +1 (max bullish). weight: relative importance 0..1. */
interface SubSignal {
  available: boolean;
  score: number;
  weight: number;
  description: string;
  supporting: string[];
  contradicting: string[];
}

function num(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────────────────────────────────
// Timezone helper — PHT = UTC+8
// ─────────────────────────────────────────────────────────────────────────

function toPht(iso: string | null): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'N/A';
  const phtMs = d.getTime() + 8 * 60 * 60 * 1000;
  const p = new Date(phtMs);
  const yyyy = p.getUTCFullYear();
  const mm = String(p.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(p.getUTCDate()).padStart(2, '0');
  const hh = String(p.getUTCHours()).padStart(2, '0');
  const min = String(p.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} PHT`;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Price action / market structure
// ─────────────────────────────────────────────────────────────────────────

interface PivotPoint {
  index: number;
  price: number;
}

/** Simple fractal pivot detector: needs `lookback` bars on both sides. */
function findPivots(candles: RangeCandleInput[], lookback = 2): { highs: PivotPoint[]; lows: PivotPoint[] } {
  const highs: PivotPoint[] = [];
  const lows: PivotPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= lookback; k++) {
      if (candles[i - k].high > c.high || candles[i + k].high > c.high) isHigh = false;
      if (candles[i - k].low < c.low || candles[i + k].low < c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: c.index, price: c.high });
    if (isLow) lows.push({ index: c.index, price: c.low });
  }
  return { highs, lows };
}

interface PriceActionAnalysis extends SubSignal {
  structure: RangeAnalysisResult['priceAction']['structure'];
  recentSwingHigh: number | null;
  recentSwingLow: number | null;
  shortTermSwingHigh: number | null;
  shortTermSwingLow: number | null;
}

function analyzePriceAction(candles: RangeCandleInput[]): PriceActionAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  if (candles.length < 5) {
    return {
      available: false,
      score: 0,
      weight: 0.25,
      description: 'Not enough candles in range to read structure (need at least 5).',
      supporting,
      contradicting,
      structure: 'NEUTRAL',
      recentSwingHigh: null,
      recentSwingLow: null,
      shortTermSwingHigh: null,
      shortTermSwingLow: null,
    };
  }

  const last = candles[candles.length - 1];
  const range = Math.max(last.high - last.low, 1e-9);
  const body = last.close - last.open;
  const closeLoc = (last.close - last.low) / range; // 0 = at low, 1 = at high
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;

  // Immediate window (last ~10 candles, excluding the last one itself)
  const immediateLookback = Math.min(10, candles.length - 1);
  const immediateWindow = candles.slice(candles.length - 1 - immediateLookback, candles.length - 1);
  const priorHigh = immediateWindow.length ? Math.max(...immediateWindow.map(c => c.high)) : last.high;
  const priorLow = immediateWindow.length ? Math.min(...immediateWindow.map(c => c.low)) : last.low;

  // Short-term window (last ~50 candles) for swing / HH-HL vs LH-LL structure
  const shortTermLookback = Math.min(50, candles.length);
  const shortTermWindow = candles.slice(candles.length - shortTermLookback);
  const { highs, lows } = findPivots(shortTermWindow, 2);

  let structure: PriceActionAnalysis['structure'] = 'NEUTRAL';
  let score = 0;

  // ── Immediate reaction: breakout / breakdown / rejection / reclaim ──
  const brokeAboveRecentHigh = last.high > priorHigh;
  const brokeBelowRecentLow = last.low < priorLow;
  const acceptedAboveHigh = last.close > priorHigh;
  const acceptedBelowLow = last.close < priorLow;

  if (brokeAboveRecentHigh && !acceptedAboveHigh && closeLoc < 0.45) {
    // Poked above recent high but rejected back inside — failed breakout
    score -= 0.55;
    structure = 'REVERSAL_BEARISH';
    contradicting.push('Failed breakout above recent high — price rejected back below it (upper wick, weak close).');
  } else if (acceptedAboveHigh) {
    score += 0.55;
    structure = 'BULLISH';
    supporting.push('Breakout above recent range high with acceptance (close held above it).');
  }

  if (brokeBelowRecentLow && !acceptedBelowLow && closeLoc > 0.55) {
    // Poked below recent low but reclaimed — failed breakdown
    score += 0.55;
    structure = structure === 'BULLISH' ? 'BULLISH' : 'REVERSAL_BULLISH';
    supporting.push('Failed breakdown below recent range low — price reclaimed back above it (lower wick, strong close).');
  } else if (acceptedBelowLow) {
    score -= 0.55;
    structure = 'BEARISH';
    contradicting.push('Breakdown below recent range low with acceptance (close held below it).');
  }

  // ── Rejection wicks at the extremes even without a clean break ──
  if (upperWick > body_abs(body) * 1.3 && upperWick > range * 0.35 && closeLoc < 0.5) {
    score -= 0.2;
    contradicting.push('Long upper wick on the latest candle — rejection from the highs.');
  }
  if (lowerWick > body_abs(body) * 1.3 && lowerWick > range * 0.35 && closeLoc > 0.5) {
    score += 0.2;
    supporting.push('Long lower wick on the latest candle — rejection from the lows / demand stepping in.');
  }

  // ── Short-term HH/HL vs LH/LL structure from pivots ──
  if (highs.length >= 2 && lows.length >= 2) {
    const lastTwoHighs = highs.slice(-2);
    const lastTwoLows = lows.slice(-2);
    const higherHighs = lastTwoHighs[1].price > lastTwoHighs[0].price;
    const higherLows = lastTwoLows[1].price > lastTwoLows[0].price;
    const lowerHighs = lastTwoHighs[1].price < lastTwoHighs[0].price;
    const lowerLows = lastTwoLows[1].price < lastTwoLows[0].price;

    if (higherHighs && higherLows) {
      score += 0.3;
      supporting.push('Short-term swing structure is making higher highs and higher lows.');
      if (structure === 'NEUTRAL') structure = 'BULLISH';
    } else if (lowerHighs && lowerLows) {
      score -= 0.3;
      contradicting.push('Short-term swing structure is making lower highs and lower lows.');
      if (structure === 'NEUTRAL') structure = 'BEARISH';
    } else {
      // mixed swing structure — treat as range/compression unless immediate reaction already picked a side
      if (structure === 'NEUTRAL') structure = 'RANGE';
    }
  }

  // Close location as a mild standalone tilt
  score += (closeLoc - 0.5) * 0.3;

  score = clamp(score, -1, 1);

  const shortTermSwingHigh = highs.length ? highs[highs.length - 1].price : null;
  const shortTermSwingLow = lows.length ? lows[lows.length - 1].price : null;

  const description =
    `Last candle closed ${(closeLoc * 100).toFixed(0)}% up its own range ` +
    `(O ${last.open} H ${last.high} L ${last.low} C ${last.close}). ` +
    `Immediate ${immediateLookback}-candle range: ${priorLow}–${priorHigh}. ` +
    (structure === 'BULLISH' || structure === 'REVERSAL_BULLISH'
      ? 'Structure favors buyers here.'
      : structure === 'BEARISH' || structure === 'REVERSAL_BEARISH'
      ? 'Structure favors sellers here.'
      : 'Structure is mixed / range-bound.');

  return {
    available: true,
    score,
    weight: 0.25,
    description,
    supporting,
    contradicting,
    structure,
    recentSwingHigh: priorHigh,
    recentSwingLow: priorLow,
    shortTermSwingHigh,
    shortTermSwingLow,
  };
}

function body_abs(body: number): number {
  return Math.abs(body) < 1e-9 ? 1e-9 : Math.abs(body);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. EMA200 — background trend filter
// ─────────────────────────────────────────────────────────────────────────

interface EmaAnalysis extends SubSignal {
  priceVsEma: RangeAnalysisResult['trend']['priceVsEma'];
  ema200: number | null;
  distancePercent: number | null;
}

function analyzeEMA200(candles: RangeCandleInput[]): EmaAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  const last = candles[candles.length - 1];
  if (!num(last?.ema200)) {
    return {
      available: false,
      score: 0,
      weight: 0.1,
      description: 'EMA200 unavailable for the latest candle (likely too early in the dataset).',
      supporting,
      contradicting,
      priceVsEma: 'UNAVAILABLE',
      ema200: null,
      distancePercent: null,
    };
  }

  const ema = last.ema200 as number;
  const distancePercent = ((last.close - ema) / ema) * 100;
  const nowAbove = last.close > ema;

  // Look a few candles back for a transition (reclaim/loss)
  let prevAbove: boolean | null = null;
  for (let i = candles.length - 2; i >= Math.max(0, candles.length - 6); i--) {
    if (num(candles[i].ema200)) {
      prevAbove = candles[i].close > (candles[i].ema200 as number);
      break;
    }
  }

  let priceVsEma: EmaAnalysis['priceVsEma'];
  let score: number;

  if (prevAbove === false && nowAbove) {
    priceVsEma = 'RECLAIMING';
    score = 0.7;
    supporting.push('Price is reclaiming EMA200 — bullish background transition.');
  } else if (prevAbove === true && !nowAbove) {
    priceVsEma = 'LOSING';
    score = -0.7;
    contradicting.push('Price is losing EMA200 — bearish background transition.');
  } else if (nowAbove) {
    priceVsEma = 'ABOVE';
    score = 0.5;
    supporting.push(`Price trading above EMA200 (${distancePercent.toFixed(2)}% away) — bullish background.`);
  } else {
    priceVsEma = 'BELOW';
    score = -0.5;
    contradicting.push(`Price trading below EMA200 (${distancePercent.toFixed(2)}% away) — bearish background.`);
  }

  const description =
    `EMA200 = ${ema.toFixed(6)}. Price is ${priceVsEma.toLowerCase()} EMA200, ` +
    `${Math.abs(distancePercent).toFixed(2)}% ${nowAbove ? 'above' : 'below'} it. ` +
    `This is background context only — a fresh short-term reversal can override it for a scalp.`;

  return {
    available: true,
    score,
    weight: 0.1,
    description,
    supporting,
    contradicting,
    priceVsEma,
    ema200: ema,
    distancePercent,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Open Interest — positioning behavior
// ─────────────────────────────────────────────────────────────────────────

interface OiAnalysis extends SubSignal {
  status: RangeAnalysisResult['openInterest']['status'];
}

function analyzeOpenInterest(candles: RangeCandleInput[]): OiAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  const valid = candles.filter(c => num(c.openInterest));
  if (valid.length < 3) {
    return {
      available: false,
      score: 0,
      weight: 0.2,
      description: 'Open Interest unavailable or insufficient — positioning context excluded from the score.',
      supporting,
      contradicting,
      status: 'UNAVAILABLE',
    };
  }

  const window = valid.slice(-Math.min(20, valid.length));
  const first = window[0];
  const last = window[window.length - 1];

  const oiChangePct = ((last.openInterest as number) - (first.openInterest as number)) / Math.abs(first.openInterest as number) * 100;
  const priceChangePct = ((last.close - first.close) / first.close) * 100;

  const oiUp = oiChangePct > 0.5;
  const oiDown = oiChangePct < -0.5;
  const priceUp = priceChangePct > 0.15;
  const priceDown = priceChangePct < -0.15;

  let status: OiAnalysis['status'] = 'MIXED';
  let score = 0;

  if (priceUp && oiUp) {
    status = 'FRESH_LONGS';
    score = 0.8;
    supporting.push(`Price up ${priceChangePct.toFixed(2)}% with OI up ${oiChangePct.toFixed(2)}% — fresh long positioning, continuation-supportive.`);
  } else if (priceDown && oiUp) {
    status = 'FRESH_SHORTS';
    score = -0.8;
    contradicting.push(`Price down ${priceChangePct.toFixed(2)}% with OI up ${oiChangePct.toFixed(2)}% — fresh short positioning, continuation-supportive to the downside.`);
  } else if (priceUp && oiDown) {
    status = 'SHORT_COVERING';
    score = 0.25;
    supporting.push(`Price up ${priceChangePct.toFixed(2)}% with OI down ${oiChangePct.toFixed(2)}% — looks like short covering; the rally may lack fresh conviction.`);
  } else if (priceDown && oiDown) {
    status = 'LONG_LIQUIDATION';
    score = -0.25;
    contradicting.push(`Price down ${priceChangePct.toFixed(2)}% with OI down ${oiChangePct.toFixed(2)}% — looks like long liquidation; the drop may be exhausting rather than fresh distribution.`);
  } else {
    status = 'MIXED';
    score = 0;
  }

  const description =
    `Over the last ${window.length} OI-valid candles: price ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%, ` +
    `OI ${oiChangePct >= 0 ? '+' : ''}${oiChangePct.toFixed(2)}%. Read as ${status.replace('_', ' ').toLowerCase()}.`;

  return { available: true, score, weight: 0.2, description, supporting, contradicting, status };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Long/Short ratio — crowd positioning / squeeze fuel
// ─────────────────────────────────────────────────────────────────────────

interface LongShortAnalysis extends SubSignal {
  interpretation: RangeAnalysisResult['longShort']['interpretation'];
  longPercent: number | null;
  shortPercent: number | null;
}

function analyzeLongShort(candles: RangeCandleInput[]): LongShortAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  const valid = candles.filter(c => c.longShortRatio && num(c.longShortRatio.longAccount) && num(c.longShortRatio.shortAccount));
  if (valid.length < 3) {
    return {
      available: false,
      score: 0,
      weight: 0.15,
      description: 'Long/Short ratio unavailable or insufficient — positioning/fuel context excluded from the score.',
      supporting,
      contradicting,
      interpretation: 'UNAVAILABLE',
      longPercent: null,
      shortPercent: null,
    };
  }

  const window = valid.slice(-Math.min(20, valid.length));
  const toLongPct = (c: RangeCandleInput) => {
    const { longAccount, shortAccount } = c.longShortRatio!;
    const total = longAccount + shortAccount;
    return total > 0 ? (longAccount / total) * 100 : 50;
  };

  const first = window[0];
  const last = window[window.length - 1];
  const firstLongPct = toLongPct(first);
  const lastLongPct = toLongPct(last);
  const priceChangePct = ((last.close - first.close) / first.close) * 100;

  const longPctUp = lastLongPct - firstLongPct > 1;
  const longPctDown = lastLongPct - firstLongPct < -1;
  const priceUp = priceChangePct > 0.15;
  const priceDown = priceChangePct < -0.15;

  let interpretation: LongShortAnalysis['interpretation'] = 'NEUTRAL';
  let score = 0;

  if (priceUp && longPctUp) {
    interpretation = 'BULLISH_CONFIRMATION';
    score = 0.35;
    supporting.push(`Long% rose to ${lastLongPct.toFixed(1)}% alongside the rally — crowd-confirmed, though rising crowding adds long-liquidation risk on a pullback.`);
  } else if (priceDown && longPctUp) {
    interpretation = 'BEARISH_CONFIRMATION';
    score = -0.5;
    contradicting.push(`Price falling while Long% rose to ${lastLongPct.toFixed(1)}% — trapped longs, strong downside liquidation fuel.`);
  } else if (priceDown && !longPctUp) {
    interpretation = 'BEARISH_CONFIRMATION';
    score = -0.3;
    contradicting.push(`Short side building (Long% ${lastLongPct.toFixed(1)}%) as price falls — bearish crowd confirmation.`);
  } else if (priceUp && longPctDown) {
    interpretation = 'SQUEEZE_FUEL';
    score = 0.4;
    supporting.push(`Price rising while Long% fell to ${lastLongPct.toFixed(1)}% — stubborn shorts, potential short-squeeze fuel.`);
  } else if (lastLongPct > 68) {
    interpretation = 'CROWDED_LONG';
    score = -0.15;
    contradicting.push(`Long% is crowded at ${lastLongPct.toFixed(1)}% — elevated long-squeeze / liquidation risk.`);
  } else if (lastLongPct < 32) {
    interpretation = 'CROWDED_SHORT';
    score = 0.15;
    supporting.push(`Short side is crowded (Long% only ${lastLongPct.toFixed(1)}%) — elevated short-squeeze risk.`);
  } else {
    interpretation = 'NEUTRAL';
    score = 0;
  }

  const description =
    `Long% moved from ${firstLongPct.toFixed(1)}% to ${lastLongPct.toFixed(1)}% over the last ${window.length} candles ` +
    `while price moved ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%. Read as ${interpretation.replace('_', ' ').toLowerCase()}. ` +
    `Positioning is a fuel signal, not directional truth on its own.`;

  return {
    available: true,
    score,
    weight: 0.15,
    description,
    supporting,
    contradicting,
    interpretation,
    longPercent: lastLongPct,
    shortPercent: 100 - lastLongPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Anchored VWAP — value / acceptance
// ─────────────────────────────────────────────────────────────────────────

interface AvwapAnalysis extends SubSignal {
  bias: RangeAnalysisResult['avwap']['bias'];
  nearestMid: number | null;
  nearestUpper: number | null;
  nearestLower: number | null;
}

function analyzeAVWAP(avwaps: AnchoredVwapInput[], latestIndex: number, latestClose: number): AvwapAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  if (!avwaps.length) {
    return {
      available: false,
      score: 0,
      weight: 0.15,
      description: 'No Anchored VWAP placed in this range — AVWAP context excluded from the score.',
      supporting,
      contradicting,
      bias: 'UNAVAILABLE',
      nearestMid: null,
      nearestUpper: null,
      nearestLower: null,
    };
  }

  // Weight more recent anchors (higher anchorIndex) more heavily.
  const enriched = avwaps
    .map(a => {
      const point = [...a.points].reverse().find(p => p.index <= latestIndex) ?? a.points[a.points.length - 1];
      const prevPoint = a.points.length > 1 ? a.points[a.points.length - 2] : null;
      return { anchor: a, point, prevPoint };
    })
    .filter(e => e.point);

  if (!enriched.length) {
    return {
      available: false,
      score: 0,
      weight: 0.15,
      description: 'AVWAP present but no point aligns with the latest candle.',
      supporting,
      contradicting,
      bias: 'UNAVAILABLE',
      nearestMid: null,
      nearestUpper: null,
      nearestLower: null,
    };
  }

  // Most recent anchor drives the reported nearest levels + gets the most weight.
  enriched.sort((a, b) => b.anchor.anchorIndex - a.anchor.anchorIndex);
  const primary = enriched[0];

  let totalWeight = 0;
  let weightedScore = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  enriched.forEach((e, i) => {
    const recencyWeight = 1 / (i + 1); // most recent anchor weighted highest
    const { point, prevPoint } = e;
    let s = 0;

    const aboveMid = latestClose > point.mid;
    const prevAboveMid = prevPoint ? prevPoint.mid < latestClose /* approx, refined below */ : null;

    if (aboveMid) {
      s = 0.5;
      bullishCount++;
    } else {
      s = -0.5;
      bearishCount++;
    }

    // Extension toward bands
    if (latestClose >= point.upper) s += 0.2; // still bullish-tilted but extension handled separately
    if (latestClose <= point.lower) s -= 0.2;

    weightedScore += s * recencyWeight;
    totalWeight += recencyWeight;
  });

  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const score = clamp(avgScore, -1, 1);

  let bias: AvwapAnalysis['bias'];
  if (bullishCount > 0 && bearishCount > 0 && Math.abs(score) < 0.25) {
    bias = 'MIXED';
  } else if (score > 0) {
    bias = 'BULLISH';
  } else {
    bias = 'BEARISH';
  }

  const mostRecentAbove = latestClose > primary.point.mid;
  if (mostRecentAbove) {
    supporting.push(`Price is above the most recent Anchored VWAP mid (${primary.point.mid.toFixed(6)}) — bullish acceptance.`);
  } else {
    contradicting.push(`Price is below the most recent Anchored VWAP mid (${primary.point.mid.toFixed(6)}) — bearish acceptance.`);
  }
  if (latestClose >= primary.point.upper) {
    supporting.push('Price is at/above the AVWAP upper band — bullish but potentially extended.');
  }
  if (latestClose <= primary.point.lower) {
    contradicting.push('Price is at/below the AVWAP lower band — bearish but potentially extended.');
  }
  if (enriched.length > 1 && bias === 'MIXED') {
    supporting.push('Note: older AVWAP anchors disagree with the most recent one — treated as a short-term-vs-background split, not averaged blindly.');
  }

  const description =
    `${enriched.length} AVWAP anchor(s) considered, most recent weighted highest. ` +
    `Most recent anchor mid = ${primary.point.mid.toFixed(6)} (upper ${primary.point.upper.toFixed(6)}, lower ${primary.point.lower.toFixed(6)}). ` +
    `Price is ${mostRecentAbove ? 'above' : 'below'} it → ${bias.toLowerCase()} read.`;

  return {
    available: true,
    score,
    weight: 0.15,
    description,
    supporting,
    contradicting,
    bias,
    nearestMid: primary.point.mid,
    nearestUpper: primary.point.upper,
    nearestLower: primary.point.lower,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Fixed Range Volume Profile — value / acceptance
// ─────────────────────────────────────────────────────────────────────────

interface FrvpAnalysis extends SubSignal {
  bias: RangeAnalysisResult['frvp']['bias'];
  nearestPoc: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
  pocBuyVolume: number | null;
  pocSellVolume: number | null;
}

function analyzeFRVPForRange(profiles: FrvpInput[], latestIndex: number, latestClose: number): FrvpAnalysis {
  const supporting: string[] = [];
  const contradicting: string[] = [];

  if (!profiles.length) {
    return {
      available: false,
      score: 0,
      weight: 0.15,
      description: 'No Fixed Range Volume Profile placed in this range — FRVP context excluded from the score.',
      supporting,
      contradicting,
      bias: 'UNAVAILABLE',
      nearestPoc: null,
      rangeHigh: null,
      rangeLow: null,
      pocBuyVolume: null,
      pocSellVolume: null,
    };
  }

  // Prefer the most recent profile (closest endIndex to latestIndex) as primary.
  const sorted = [...profiles].sort((a, b) => b.ownRange.endIndex - a.ownRange.endIndex);
  const primary = sorted[0];

  let totalWeight = 0;
  let weightedScore = 0;

  sorted.forEach((p, i) => {
    const recencyWeight = 1 / (i + 1);
    const aboveePoc = latestClose > p.pocPrice;
    let s = aboveePoc ? 0.5 : -0.5;
    if (latestClose >= p.rangeHighPrice) s += 0.15;
    if (latestClose <= p.rangeLowPrice) s -= 0.15;
    weightedScore += s * recencyWeight;
    totalWeight += recencyWeight;
  });

  const score = clamp(totalWeight > 0 ? weightedScore / totalWeight : 0, -1, 1);
  const bias: FrvpAnalysis['bias'] = score > 0.1 ? 'BULLISH' : score < -0.1 ? 'BEARISH' : 'MIXED';

  const aboveMainPoc = latestClose > primary.pocPrice;
  if (aboveMainPoc) {
    supporting.push(`Price is above the most recent FRVP's POC (${primary.pocPrice.toFixed(6)}) — bullish acceptance above value.`);
  } else {
    contradicting.push(`Price is below the most recent FRVP's POC (${primary.pocPrice.toFixed(6)}) — bearish acceptance below value.`);
  }

  const pocBucket = primary.buckets.find(b => b.isPoc) ?? null;
  if (pocBucket) {
    const buyDominant = pocBucket.buyVolume > pocBucket.sellVolume * 1.15;
    const sellDominant = pocBucket.sellVolume > pocBucket.buyVolume * 1.15;
    if (buyDominant) {
      supporting.push('POC bucket is buy-dominant — behaves more like support.');
    } else if (sellDominant) {
      contradicting.push('POC bucket is sell-dominant — behaves more like resistance.');
    }
  }

  if (latestClose >= primary.rangeHighPrice) {
    supporting.push('Price is at/above this FRVP\'s range high — bullish but potentially extended beyond value.');
  }
  if (latestClose <= primary.rangeLowPrice) {
    contradicting.push('Price is at/below this FRVP\'s range low — bearish but potentially extended beyond value.');
  }

  const description =
    `${sorted.length} FRVP(s) considered, most recent weighted highest. ` +
    `Most recent profile: POC ${primary.pocPrice.toFixed(6)}, range ${primary.rangeLowPrice.toFixed(6)}–${primary.rangeHighPrice.toFixed(6)}. ` +
    `Price is ${aboveMainPoc ? 'above' : 'below'} POC → ${bias.toLowerCase()} read.`;

  return {
    available: true,
    score,
    weight: 0.15,
    description,
    supporting,
    contradicting,
    bias,
    nearestPoc: primary.pocPrice,
    rangeHigh: primary.rangeHighPrice,
    rangeLow: primary.rangeLowPrice,
    pocBuyVolume: pocBucket?.buyVolume ?? null,
    pocSellVolume: pocBucket?.sellVolume ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Aggregate score + bias + confidence
// ─────────────────────────────────────────────────────────────────────────

function calculateScore(signals: SubSignal[]): { bias: Bias; confidence: number; weightedSum: number; missing: number } {
  const available = signals.filter(s => s.available);
  const missing = signals.length - available.length;

  const totalWeight = available.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = totalWeight > 0
    ? available.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight
    : 0;

  const NEUTRAL_THRESHOLD = 0.06;
  const bias: Bias = weightedSum > NEUTRAL_THRESHOLD ? 'LONG' : weightedSum < -NEUTRAL_THRESHOLD ? 'SHORT' : 'NEUTRAL';

  // Base confidence scales with signal strength/agreement (|weightedSum| in [0,1]).
  let confidence = 50 + Math.abs(weightedSum) * 45;

  // Cap max confidence when major sources are missing — don't let a clean
  // price/EMA/AVWAP read alone produce a 90%+ score.
  const maxConfidence = clamp(95 - missing * 8, 55, 95);
  confidence = clamp(confidence, 50, maxConfidence);

  if (bias === 'NEUTRAL') {
    confidence = clamp(confidence, 50, 60);
  }

  return { bias, confidence: Math.round(confidence), weightedSum, missing };
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Extension / chase detection → entry quality
// ─────────────────────────────────────────────────────────────────────────

function detectExtension(
  bias: Bias,
  latestClose: number,
  priceAction: PriceActionAnalysis,
  avwap: AvwapAnalysis,
  frvp: FrvpAnalysis,
  ema: EmaAnalysis,
  confidence: number
): EntryQuality {
  if (bias === 'NEUTRAL') return 'FAIR';

  let extensionPoints = 0;

  if (bias === 'LONG') {
    if (avwap.available && avwap.nearestUpper !== null && latestClose >= avwap.nearestUpper * 0.998) extensionPoints++;
    if (frvp.available && frvp.rangeHigh !== null && latestClose >= frvp.rangeHigh * 0.998) extensionPoints++;
    if (priceAction.shortTermSwingHigh !== null && latestClose >= priceAction.shortTermSwingHigh * 0.998) extensionPoints++;
    if (ema.available && ema.distancePercent !== null && ema.distancePercent > 6) extensionPoints++;
  } else {
    if (avwap.available && avwap.nearestLower !== null && latestClose <= avwap.nearestLower * 1.002) extensionPoints++;
    if (frvp.available && frvp.rangeLow !== null && latestClose <= frvp.rangeLow * 1.002) extensionPoints++;
    if (priceAction.shortTermSwingLow !== null && latestClose <= priceAction.shortTermSwingLow * 1.002) extensionPoints++;
    if (ema.available && ema.distancePercent !== null && ema.distancePercent < -6) extensionPoints++;
  }

  if (extensionPoints >= 2) return 'EXTENDED';
  if (extensionPoints === 1) return confidence >= 70 ? 'FAIR' : 'POOR';

  if (confidence >= 80) return 'VERY_GOOD';
  if (confidence >= 68) return 'GOOD';
  if (confidence >= 58) return 'FAIR';
  return 'POOR';
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Trade levels — TP / SL / entry / R:R
// ─────────────────────────────────────────────────────────────────────────

interface TradeLevels {
  entryReference: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
}

function calculateTradeLevels(
  bias: Bias,
  latestClose: number,
  entryQuality: EntryQuality,
  priceAction: PriceActionAnalysis,
  avwap: AvwapAnalysis,
  frvp: FrvpAnalysis,
  ema: EmaAnalysis
): TradeLevels {
  if (bias === 'NEUTRAL') {
    return { entryReference: null, stopLoss: null, takeProfit: null, riskReward: null };
  }

  const entry = latestClose;

  if (bias === 'LONG') {
    const slCandidates: number[] = [];
    if (priceAction.recentSwingLow !== null && priceAction.recentSwingLow < entry) slCandidates.push(priceAction.recentSwingLow);
    if (avwap.available && avwap.nearestMid !== null && avwap.nearestMid < entry) slCandidates.push(avwap.nearestMid);
    if (frvp.available && frvp.nearestPoc !== null && frvp.nearestPoc < entry) slCandidates.push(frvp.nearestPoc);
    if (ema.available && ema.ema200 !== null && ema.ema200 < entry) slCandidates.push(ema.ema200);
    // Closest support below entry = tightest, most defensible stop.
    const stopLoss = slCandidates.length ? Math.max(...slCandidates) : null;

    const tpCandidates: number[] = [];
    if (priceAction.shortTermSwingHigh !== null && priceAction.shortTermSwingHigh > entry) tpCandidates.push(priceAction.shortTermSwingHigh);
    if (avwap.available && avwap.nearestUpper !== null && avwap.nearestUpper > entry) tpCandidates.push(avwap.nearestUpper);
    if (frvp.available && frvp.rangeHigh !== null && frvp.rangeHigh > entry) tpCandidates.push(frvp.rangeHigh);
    // Closest resistance above entry = most realistic scalp target.
    const takeProfit = tpCandidates.length ? Math.min(...tpCandidates) : null;

    let riskReward: number | null = null;
    if (stopLoss !== null && takeProfit !== null && entry - stopLoss > 0) {
      riskReward = (takeProfit - entry) / (entry - stopLoss);
    }

    // If entry is already extended, reference a pullback level instead of chasing.
    let entryReference = entry;
    if (entryQuality === 'EXTENDED') {
      if (avwap.available && avwap.nearestMid !== null && avwap.nearestMid < entry) entryReference = avwap.nearestMid;
      else if (frvp.available && frvp.nearestPoc !== null && frvp.nearestPoc < entry) entryReference = frvp.nearestPoc;
    }

    return { entryReference, stopLoss, takeProfit, riskReward };
  }

  // SHORT
  const slCandidates: number[] = [];
  if (priceAction.recentSwingHigh !== null && priceAction.recentSwingHigh > entry) slCandidates.push(priceAction.recentSwingHigh);
  if (avwap.available && avwap.nearestMid !== null && avwap.nearestMid > entry) slCandidates.push(avwap.nearestMid);
  if (frvp.available && frvp.nearestPoc !== null && frvp.nearestPoc > entry) slCandidates.push(frvp.nearestPoc);
  if (ema.available && ema.ema200 !== null && ema.ema200 > entry) slCandidates.push(ema.ema200);
  const stopLoss = slCandidates.length ? Math.min(...slCandidates) : null;

  const tpCandidates: number[] = [];
  if (priceAction.shortTermSwingLow !== null && priceAction.shortTermSwingLow < entry) tpCandidates.push(priceAction.shortTermSwingLow);
  if (avwap.available && avwap.nearestLower !== null && avwap.nearestLower < entry) tpCandidates.push(avwap.nearestLower);
  if (frvp.available && frvp.rangeLow !== null && frvp.rangeLow < entry) tpCandidates.push(frvp.rangeLow);
  const takeProfit = tpCandidates.length ? Math.max(...tpCandidates) : null;

  let riskReward: number | null = null;
  if (stopLoss !== null && takeProfit !== null && stopLoss - entry > 0) {
    riskReward = (entry - takeProfit) / (stopLoss - entry);
  }

  let entryReference = entry;
  if (entryQuality === 'EXTENDED') {
    if (avwap.available && avwap.nearestMid !== null && avwap.nearestMid > entry) entryReference = avwap.nearestMid;
    else if (frvp.available && frvp.nearestPoc !== null && frvp.nearestPoc > entry) entryReference = frvp.nearestPoc;
  }

  return { entryReference, stopLoss, takeProfit, riskReward };
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Thesis / risk narrative
// ─────────────────────────────────────────────────────────────────────────

function buildThesis(
  bias: Bias,
  confidence: number,
  priceAction: PriceActionAnalysis,
  ema: EmaAnalysis,
  oi: OiAnalysis,
  ls: LongShortAnalysis,
  avwap: AvwapAnalysis,
  frvp: FrvpAnalysis,
  entryQuality: EntryQuality
): { thesis: string; risk: string } {
  if (bias === 'NEUTRAL') {
    return {
      thesis: `No clean short-term edge right now (confidence ${confidence}%). Signals are mixed across price action, background trend, and available positioning data — best treated as a range until a clearer immediate reaction shows up.`,
      risk: 'Neutral read — no defensible invalidation level to size a scalp against. Wait for a fresh breakout, breakdown, or rejection at a known level.',
    };
  }

  const dirWord = bias === 'LONG' ? 'bullish' : 'bearish';
  const backgroundWord = ema.available
    ? (ema.priceVsEma === 'ABOVE' || ema.priceVsEma === 'RECLAIMING' ? 'bullish' : 'bearish')
    : 'undefined (EMA200 unavailable)';

  const isReversal = ema.available && backgroundWord !== dirWord && backgroundWord !== 'undefined (EMA200 unavailable)';

  const parts: string[] = [];
  parts.push(
    isReversal
      ? `Short-term ${dirWord} reversal inside a ${backgroundWord} background structure.`
      : `Short-term ${dirWord} move aligned with a ${backgroundWord} background structure.`
  );
  parts.push(priceAction.description);
  if (oi.available) parts.push(oi.description);
  if (ls.available) parts.push(ls.description);
  if (avwap.available) parts.push(avwap.description);
  if (frvp.available) parts.push(frvp.description);
  if (entryQuality === 'EXTENDED') {
    parts.push(`Direction looks ${dirWord}, but price is already extended toward a known level — chasing here is lower quality; a pullback entry is preferable.`);
  }

  const risk =
    bias === 'LONG'
      ? 'Primary risk: a loss of the nearest support structure below price would invalidate the long thesis and likely accelerate downside.'
      : 'Primary risk: a reclaim of the nearest resistance structure above price would invalidate the short thesis and likely accelerate upside.';

  return { thesis: parts.join(' '), risk };
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Preview position analysis — confidence of hitting a GIVEN TP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scores the probability that a specific, already-placed position (side +
 * entry + TP + SL — e.g. from "Preview Buy"/"Preview Sell") reaches its TP
 * before its SL or before the underlying thesis invalidates.
 *
 * Base probability starts from pure entry/TP/SL geometry (a breakeven-style
 * estimate: room-to-SL vs distance-to-TP, as in a symmetric random walk),
 * then is adjusted by:
 *   - whether the analyzer's own structural read (bias) agrees with the
 *     position's side (alignment)
 *   - how many known structural levels (swing high/low, AVWAP, FRVP, EMA200)
 *     sit between entry and TP as potential obstacles
 *   - whether the TP itself lands within, at, or beyond the nearest known
 *     structural level in that direction (realistic vs. reaching too far)
 *   - whether the entry itself is already extended/chasing
 */
function computePositionAnalysis(
  position: PreviewPositionInput,
  bias: Bias,
  confidence: number,
  priceAction: PriceActionAnalysis,
  ema: EmaAnalysis,
  avwap: AvwapAnalysis,
  frvp: FrvpAnalysis
): PositionAnalysisResult {
  const { side, entryPrice, tpPrice, slPrice } = position;
  const isLong = side === 'LONG';

  const tpDistancePercent = (Math.abs(tpPrice - entryPrice) / entryPrice) * 100;
  const slDistancePercent = (Math.abs(entryPrice - slPrice) / entryPrice) * 100;
  const riskReward = slDistancePercent > 0 ? Math.round((tpDistancePercent / slDistancePercent) * 100) / 100 : 0;

  // Geometry-based baseline: more room to SL relative to TP distance = higher
  // raw probability of reaching TP first (and vice versa) with no edge assumed.
  const baseProb = (slDistancePercent + tpDistancePercent) > 0
    ? (slDistancePercent / (slDistancePercent + tpDistancePercent)) * 100
    : 50;

  // Directional alignment vs the analyzer's own structural read.
  let alignment: PositionAlignment;
  let edgeAdjust = 0;
  if (bias === 'NEUTRAL') {
    alignment = 'NEUTRAL';
    edgeAdjust = 0;
  } else if (bias === side) {
    alignment = 'ALIGNED';
    edgeAdjust = (confidence - 50) * 0.6;
  } else {
    alignment = 'OPPOSED';
    edgeAdjust = -(confidence - 50) * 0.6;
  }

  // Obstacles: known structural levels sitting between entry and TP.
  const obstacles: string[] = [];
  const candidateLevels: Array<{ label: string; price: number | null }> = [
    { label: `recent swing ${isLong ? 'high' : 'low'}`, price: isLong ? priceAction.shortTermSwingHigh : priceAction.shortTermSwingLow },
    { label: 'AVWAP mid', price: avwap.available ? avwap.nearestMid : null },
    { label: isLong ? 'AVWAP upper band' : 'AVWAP lower band', price: avwap.available ? (isLong ? avwap.nearestUpper : avwap.nearestLower) : null },
    { label: 'FRVP POC', price: frvp.available ? frvp.nearestPoc : null },
    { label: isLong ? 'FRVP range high' : 'FRVP range low', price: frvp.available ? (isLong ? frvp.rangeHigh : frvp.rangeLow) : null },
    { label: 'EMA200', price: ema.available ? ema.ema200 : null },
  ];

  for (const c of candidateLevels) {
    if (c.price === null) continue;
    const inPath = isLong
      ? c.price > entryPrice && c.price < tpPrice
      : c.price < entryPrice && c.price > tpPrice;
    if (inPath) obstacles.push(`${c.label} (${c.price.toFixed(6)}) sits between entry and TP.`);
  }
  const obstaclePenalty = Math.min(obstacles.length * 6, 18);

  // TP realism: compare TP against the nearest known level beyond entry in
  // the trade's direction (the most likely place price actually struggles).
  const directionalLevels = candidateLevels
    .map(c => c.price)
    .filter((p): p is number => p !== null && (isLong ? p > entryPrice : p < entryPrice));
  const nearestStructural = directionalLevels.length
    ? (isLong ? Math.min(...directionalLevels) : Math.max(...directionalLevels))
    : null;

  let tpRealism: TpRealism = 'UNKNOWN';
  let realismAdjust = 0;
  if (nearestStructural !== null) {
    const closeToLevel = Math.abs(tpPrice - nearestStructural) / entryPrice < 0.003;
    const beyond = isLong ? tpPrice > nearestStructural : tpPrice < nearestStructural;
    if (closeToLevel) {
      tpRealism = 'AT_STRUCTURE';
      realismAdjust = 4;
    } else if (beyond) {
      tpRealism = 'BEYOND_STRUCTURE';
      realismAdjust = -8;
    } else {
      tpRealism = 'WITHIN_STRUCTURE';
      realismAdjust = 0;
    }
  }

  // Extension check on the ACTUAL entry price of this position (not
  // necessarily the latest close if the preview was taken a few candles ago).
  const entryQuality = detectExtension(side, entryPrice, priceAction, avwap, frvp, ema, confidence);
  const extensionPenalty = entryQuality === 'EXTENDED' ? 10 : entryQuality === 'POOR' ? 4 : 0;

  const tpHitConfidence = Math.round(
    clamp(baseProb + edgeAdjust - obstaclePenalty + realismAdjust - extensionPenalty, 5, 95)
  );

  const alignmentText =
    alignment === 'ALIGNED'
      ? `The current structural read agrees with this ${side} (bias ${bias} at ${confidence}% confidence) — supportive of reaching TP.`
      : alignment === 'OPPOSED'
      ? `The current structural read disagrees with this ${side} (bias ${bias} at ${confidence}% confidence) — this is a counter-trend position, which lowers the odds of reaching TP cleanly.`
      : `The current structural read is NEUTRAL — no strong tailwind or headwind for this ${side}.`;

  const realismText =
    tpRealism === 'BEYOND_STRUCTURE'
      ? 'The TP sits beyond the nearest known structural level in that direction — price may stall there before TP is reached.'
      : tpRealism === 'AT_STRUCTURE'
      ? 'The TP lines up closely with a known structural level — a realistic, well-placed target.'
      : tpRealism === 'WITHIN_STRUCTURE'
      ? 'The TP sits comfortably within the current structure, short of the next known level.'
      : 'No structural level found beyond entry in this direction to judge TP placement against.';

  const description =
    `${side} from ${entryPrice} → TP ${tpPrice} (${tpDistancePercent.toFixed(2)}%) / SL ${slPrice} (${slDistancePercent.toFixed(2)}%), R:R ${riskReward.toFixed(2)}. ` +
    `Geometry-only baseline hit probability ${baseProb.toFixed(0)}%, adjusted to ${tpHitConfidence}% after structure. ` +
    (obstacles.length ? `${obstacles.length} structural level(s) sit between entry and TP.` : 'No known structural obstacles sit between entry and TP.');

  const thesis =
    `${alignmentText} ${realismText} ` +
    (obstacles.length
      ? `Between entry and TP: ${obstacles.map(o => o.replace(/\.$/, '')).join('; ')}.`
      : 'No placed AVWAP/FRVP/swing level sits between entry and TP.') +
    (entryQuality === 'EXTENDED'
      ? ' Entry also looks extended relative to recent structure, which adds pullback/reversal risk before TP.'
      : '');

  return {
    side,
    entryPrice,
    tpPrice,
    slPrice,
    tpDistancePercent: Math.round(tpDistancePercent * 100) / 100,
    slDistancePercent: Math.round(slDistancePercent * 100) / 100,
    riskReward,
    tpHitConfidence,
    alignment,
    entryQuality,
    obstacles,
    tpRealism,
    description,
    thesis,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

export function analyzeRange(data: RangeAnalysisInput): RangeAnalysisResult {
  const candles = Array.isArray(data.candles) ? data.candles : [];

  if (candles.length === 0) {
    const empty: RangeAnalysisResult = {
      symbol: data.symbol ?? 'UNKNOWN',
      interval: data.interval ?? '',
      bias: 'NEUTRAL',
      confidence: 50,
      lastPrice: NaN,
      lastCandleTimeIso: null,
      lastCandleTimePht: 'N/A',
      entryQuality: 'POOR',
      entryReference: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      position: null,
      trend: { direction: 'NEUTRAL', priceVsEma: 'UNAVAILABLE', ema200: null, distancePercent: null, description: 'No candles in range.' },
      priceAction: { structure: 'NEUTRAL', description: 'No candles in range.' },
      openInterest: { status: 'UNAVAILABLE', description: 'No candles in range.' },
      longShort: { longPercent: null, shortPercent: null, interpretation: 'UNAVAILABLE', description: 'No candles in range.' },
      avwap: { available: false, bias: 'UNAVAILABLE', nearestMid: null, nearestUpper: null, nearestLower: null, description: 'No candles in range.' },
      frvp: { available: false, bias: 'UNAVAILABLE', nearestPoc: null, rangeHigh: null, rangeLow: null, pocBuyVolume: null, pocSellVolume: null, description: 'No candles in range.' },
      supportingSignals: [],
      contradictingSignals: [],
      thesis: 'No candles available in this range — nothing to analyze.',
      risk: 'N/A',
      scoreBreakdown: { priceAction: 0, ema: 0, openInterest: 0, longShort: 0, avwap: 0, frvp: 0 },
    };
    return empty;
  }

  const last = candles[candles.length - 1];
  const latestIndex = last.index;
  const latestClose = last.close;

  const priceAction = analyzePriceAction(candles);
  const ema = analyzeEMA200(candles);
  const oi = analyzeOpenInterest(candles);
  const ls = analyzeLongShort(candles);
  const avwap = analyzeAVWAP(data.anchoredVwaps ?? [], latestIndex, latestClose);
  const frvp = analyzeFRVPForRange(data.fixedRangeVolumeProfiles ?? [], latestIndex, latestClose);

  const { bias, confidence } = calculateScore([priceAction, ema, oi, ls, avwap, frvp]);

  const entryQuality = detectExtension(bias, latestClose, priceAction, avwap, frvp, ema, confidence);
  const levels = calculateTradeLevels(bias, latestClose, entryQuality, priceAction, avwap, frvp, ema);
  const { thesis, risk } = buildThesis(bias, confidence, priceAction, ema, oi, ls, avwap, frvp, entryQuality);

  const position = data.previewPosition
    ? computePositionAnalysis(data.previewPosition, bias, confidence, priceAction, ema, avwap, frvp)
    : null;

  const supportingSignals: string[] = [];
  const contradictingSignals: string[] = [];
  [priceAction, ema, oi, ls, avwap, frvp].forEach(s => {
    supportingSignals.push(...s.supporting);
    contradictingSignals.push(...s.contradicting);
  });

  const trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = !ema.available
    ? 'NEUTRAL'
    : ema.priceVsEma === 'ABOVE' || ema.priceVsEma === 'RECLAIMING'
    ? 'BULLISH'
    : ema.priceVsEma === 'BELOW' || ema.priceVsEma === 'LOSING'
    ? 'BEARISH'
    : 'NEUTRAL';

  return {
    symbol: data.symbol,
    interval: data.interval,
    bias,
    confidence,
    lastPrice: latestClose,
    lastCandleTimeIso: last.openTimeIso,
    lastCandleTimePht: toPht(last.openTimeIso),
    entryQuality,
    entryReference: levels.entryReference,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    riskReward: levels.riskReward !== null ? Math.round(levels.riskReward * 100) / 100 : null,
    position,
    trend: {
      direction: trendDirection,
      priceVsEma: ema.priceVsEma,
      ema200: ema.ema200,
      distancePercent: ema.distancePercent !== null ? Math.round(ema.distancePercent * 100) / 100 : null,
      description: ema.description,
    },
    priceAction: {
      structure: priceAction.structure,
      description: priceAction.description,
    },
    openInterest: {
      status: oi.status,
      description: oi.description,
    },
    longShort: {
      longPercent: ls.longPercent !== null ? Math.round(ls.longPercent * 10) / 10 : null,
      shortPercent: ls.shortPercent !== null ? Math.round(ls.shortPercent * 10) / 10 : null,
      interpretation: ls.interpretation,
      description: ls.description,
    },
    avwap: {
      available: avwap.available,
      bias: avwap.bias,
      nearestMid: avwap.nearestMid,
      nearestUpper: avwap.nearestUpper,
      nearestLower: avwap.nearestLower,
      description: avwap.description,
    },
    frvp: {
      available: frvp.available,
      bias: frvp.bias,
      nearestPoc: frvp.nearestPoc,
      rangeHigh: frvp.rangeHigh,
      rangeLow: frvp.rangeLow,
      pocBuyVolume: frvp.pocBuyVolume,
      pocSellVolume: frvp.pocSellVolume,
      description: frvp.description,
    },
    supportingSignals,
    contradictingSignals,
    thesis,
    risk,
    scoreBreakdown: {
      priceAction: Math.round(priceAction.score * 100) / 100,
      ema: Math.round(ema.score * 100) / 100,
      openInterest: Math.round(oi.score * 100) / 100,
      longShort: Math.round(ls.score * 100) / 100,
      avwap: Math.round(avwap.score * 100) / 100,
      frvp: Math.round(frvp.score * 100) / 100,
    },
  };
}