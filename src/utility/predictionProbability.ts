// src/utility/predictionProbability.ts
//
// ─── ARCHITECTURE ─────────────────────────────────────────────────────────
//
//                       MARKET DATA
//                           │
//           ┌───────────────┼────────────────┐
//           │               │                │
//        REGIME         POSITIONING       MICROSTRUCTURE
//           │               │                │
//     EMA 1h/4h/1d      OI + Price          Flow
//     EMA 15m           L/S ratio            Spread
//     Price structure   Liquidation state    Flow impulse
//           │               │                │
//           └───────────────┼────────────────┘
//                           │
//                    CONFLUENCE ENGINE
//                           │
//                ┌──────────┴──────────┐
//                │                     │
//          Directional pressure    Volatility state
//                │                     │
//                └──────────┬──────────┘
//                           │
//                    NEXT-CANDLE MODEL
//                           │
//                ┌──────────┼──────────┐
//                ↓          ↓          ↓
//              UP %       DOWN %     NEUTRAL %
//                           │
//                    CALIBRATION LAYER
//                           │
//                     FINAL PROBABILITY
//
// This replaces the old "5-7 independent factors → fixed weighted average
// → GBM directional inference" design. The problems with that design:
// (1) it let a single Cross-TF EMA score dominate via a flat 30% weight
// regardless of context, (2) it treated OI/flow/L-S as independent votes
// when their *real* information is in how they relate to each other and to
// price, and (3) it fed a scalar "composite score" straight into a GBM
// drift bias and called the resulting path-agreement rate a "probability",
// which conflates signal quality with an actual predictive distribution.
//
// The model here instead:
//  1. Separates REGIME (higher-TF EMA structure + price slope) from
//     short-term PRESSURE — regime sets a *prior*, it doesn't directly
//     vote.
//  2. Turns OI, L/S ratio, flow, spread, and EMA interaction into
//     structured *states* (not scores) — PRICE_UP_OI_UP, CROWDED_LONG,
//     RECLAIM, WIDE, etc.
//  3. Runs those states through an explicit CONFLUENCE ENGINE built from
//     named pairwise interactions (PRICE×OI, OI×FLOW, OI×L/S, EMA
//     REGIME×OI, EMA EVENT×FLOW, CROWDING×PRICE, …) rather than summing
//     independent indicators.
//  4. Converts the resulting bullish/bearish evidence + uncertainty into a
//     proper P(up)/P(down)/P(neutral) distribution that sums to 1, for
//     three horizons (1/2/4 candles), with predictive conviction decaying
//     as the horizon grows.
//  5. Keeps a Monte-Carlo GBM path simulation only as a SECONDARY
//     visualization layer for the chart overlay (predicted candles +
//     stretched EMAs) — it is seeded from the model's own expected
//     return/volatility, but it no longer determines direction.
//  6. Reports `confidence` (signal quality/data completeness/agreement) as
//     a separate concept from the probabilities themselves — a 68% P(up)
//     read can still carry LOW confidence if the underlying signals are
//     sparse or conflicting.
//  7. Exposes its full feature vector + per-horizon prediction as
//     loggable rows (`logEntries`) so predictions can be compared against
//     realized outcomes later for walk-forward calibration. Nothing here
//     claims that a stated probability equals a historically validated
//     hit rate — that can only be established by logging and checking.
//
// A note on constants: wherever a fixed multiplier or threshold remains
// (logistic steepness, horizon decay, drift-bias strength, etc.) it is
// called out in a comment as a CALIBRATION PLACEHOLDER — a transparent,
// documented prior standing in for a value that should eventually be
// learned from walk-forward validation, not a tuned "magic number".
// Wherever plausible, thresholds are expressed as z-scores/percentiles
// against the symbol's own recent distribution instead of hard-coded
// absolute magnitudes, so the same code adapts across symbols/regimes
// rather than assuming one asset's volatility profile.

// ─── stats helpers (private) ───────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)))
}

function clamp(x: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, x))
}

/** z-score of `value` against `series` (including itself). 0 if too little data to be meaningful. */
function zScoreOf(value: number, series: number[]): number {
  if (series.length < 3) return 0
  const m = mean(series)
  const sd = stdev(series) || 1e-9
  return (value - m) / sd
}

/** Fraction of `series` that is <= value — i.e. value's percentile rank within its own recent history. */
function percentileRank(value: number, series: number[]): number {
  if (series.length === 0) return 0.5
  const below = series.filter(v => v <= value).length
  return below / series.length
}

/** The p-th quantile (0..1) of `vals`, linearly interpolated. */
function quantile(vals: number[], p: number): number {
  const sorted = [...vals].sort((a, b) => a - b)
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** Ordinary least-squares slope (per index step) of a series against 0..n-1. */
function linregSlope(ys: number[]): number {
  const n = ys.length
  if (n < 2) return 0
  const xs = Array.from({ length: n }, (_, i) => i)
  const xMean = mean(xs)
  const yMean = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean)
    den += (xs[i] - xMean) ** 2
  }
  return den !== 0 ? num / den : 0
}

/** Box-Muller standard normal sample — used only by the secondary GBM visualization layer. */
function gaussianRandom(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ─── input / param types ────────────────────────────────────────────────────

export interface PredictionCandleInput {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  /** 15m (chart-native) EMA200 — candle.candleData.ema200 */
  ema200: number | null
  /** 15m MA200 / MA100 — candle.candleData.ma200 / ma100 */
  ma200: number | null
  ma100: number | null
  openInterest: number | null
  longShortRatio: { longAccount: number; shortAccount: number } | null
  crossTfEma: { '1h': number | null; '4h': number | null; '1d': number | null }
  flow: { inflow: number; outflow: number }
  /** candle.candleData.isBuyingExhaustion / isSellingExhaustion / isCandleInAbsorption */
  isBuyingExhaustion: boolean
  isSellingExhaustion: boolean
  isCandleInAbsorption: boolean
  /** candle.isWeakening */
  isWeakening: boolean
  /** candle.patternTrack */
  patternTrack: 'hl' | 'lh' | null
  /** Optional top-of-book snapshot for this candle. Only used if actually supplied — never inferred/invented. */
  bestBid?: number | null
  bestAsk?: number | null
  bidSize?: number | null
  askSize?: number | null
}

export interface PredictionParams {
  /** How many trailing candles to build the model from. */
  pastCandles: number
  /** Length of the SECONDARY GBM visualization path (predicted candles drawn on the chart). Independent of the 1/2/4-candle probability horizons. */
  predictedCandles: number
  /**
   * Recent bid/ask spread readings (%), most-recent-last. A single live
   * reading (length 1) is accepted and degrades gracefully to
   * 'INSUFFICIENT_DATA' rather than being compared against a hard-coded
   * threshold — the model prefers "no opinion" over a fake baseline.
   */
  bidAskSpreadPercentHistory: number[]
  /** Interval duration in ms — steps predicted openTime and the visualization EMA. */
  intervalMs: number
  /** Monte Carlo path count for the secondary visualization layer. Default 500. */
  simulations?: number
  /** Optional symbol tag, only used to stamp log entries for later calibration. */
  symbol?: string
}

// ─── regime / state / event vocabularies ───────────────────────────────────

export type Regime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'TRANSITION'
export type RegimeDetail =
  | 'strong_trend_up' | 'pullback_in_uptrend' | 'trend_up_consolidation'
  | 'strong_trend_down' | 'pullback_in_downtrend' | 'trend_down_consolidation'
  | 'range' | 'transition'

export type OiState =
  | 'PRICE_UP_OI_UP' | 'PRICE_UP_OI_DOWN'
  | 'PRICE_DOWN_OI_UP' | 'PRICE_DOWN_OI_DOWN'
  | 'INSUFFICIENT_DATA'

export type FlowState = 'BULLISH' | 'BEARISH' | 'NEUTRAL'
export type LsCrowding = 'CROWDED_LONG' | 'CROWDED_SHORT' | 'NEUTRAL'
export type SpreadState = 'TIGHT' | 'NORMAL' | 'WIDE' | 'INSUFFICIENT_DATA'
export type EmaEvent =
  | 'RECLAIM' | 'LOSS_OF_SUPPORT' | 'BREAKOUT' | 'BREAKDOWN'
  | 'REJECTION' | 'FAILED_BREAKOUT' | 'FAILED_BREAKDOWN' | 'NONE'
export type ConfluenceLevel = 'HIGH_CONFLUENCE' | 'MODERATE_CONFLUENCE' | 'LOW_CONFLUENCE' | 'CONFLICTING_SIGNALS'
export type ConfidenceLevel = 'LOW' | 'MODERATE' | 'HIGH'

interface RegimeResult {
  regime: Regime
  regimeDetail: RegimeDetail
  /** 0..1 — how clean/strong the regime read is, used to modulate (not replace) interaction weights. */
  strength: number
  /** -1..1 weighted fraction of tracked EMAs price sits above vs. below. */
  emaAlignment: number
  /** -1..1 normalized short-term slope (z-scored against the window's own return volatility). */
  shortSlopeZ: number
  detail: string
}

interface OiResult {
  shortWindow: OiState
  mediumWindow: OiState
  shortPriceChangeZ: number
  shortOiChangeZ: number
  /** 0..1 — magnitude/confidence of the underlying price+OI move, not its direction. */
  strength: number
  hasData: boolean
  detail: string
}

interface FlowResult {
  netFlow: number
  flowImpulse: number
  flowAcceleration: number
  /** 0..1 — how consistently recent flow has run one direction. */
  flowPersistence: number
  flowSpike: boolean
  flowZScore: number
  state: FlowState
  strength: number
  hasData: boolean
  detail: string
}

interface LsResult {
  zScore: number
  percentile: number
  slope: number
  crowding: LsCrowding
  strength: number
  hasData: boolean
  detail: string
}

interface SpreadResult {
  currentSpread: number | null
  spreadMean: number | null
  spreadStd: number | null
  spreadZScore: number | null
  spreadPercentile: number | null
  spreadChange: number | null
  state: SpreadState
  /** 0..1 contribution to overall prediction uncertainty (wide spread = high). */
  uncertainty: number
  detail: string
  /** Only populated if bid/ask size data was actually supplied on the input candles. */
  bidAskImbalance?: number
  microPrice?: number
  depthImbalance?: number
}

interface EmaEventResult {
  event: EmaEvent
  tf: string | null
  levelValue: number | null
  /** Only meaningful for REJECTION (+1 held above / -1 held below); other events derive direction via emaEventDirection(). */
  confirmation: number
  detail: string
}

// ─── confluence engine types ────────────────────────────────────────────────

export interface InteractionVote {
  name: string
  /** -1..1 signed directional read of this single interaction. */
  contribution: number
  /** 0..1 how much this interaction should count (driven by underlying data quality/magnitude). */
  weight: number
  note: string
}

interface ConfluenceResult {
  bullishEvidence: number
  bearishEvidence: number
  netEvidence: number
  totalEvidence: number
  signalAgreement: number
  signalDivergence: number
  level: ConfluenceLevel
  votes: InteractionVote[]
  dominantDriver: string
}

// ─── output types ────────────────────────────────────────────────────────────

export interface HorizonPrediction {
  /** candles ahead (1, 2, 4, …) */
  horizon: number
  probabilityUp: number
  probabilityDown: number
  probabilityNeutral: number
  expectedReturn: number
  expectedVolatility: number
  expectedHigh: number
  expectedLow: number
}

export interface PredictionDiagnostics {
  regime: Regime
  regimeDetail: RegimeDetail
  regimeStrength: number

  oiState: OiState
  oiShortWindowState: OiState
  oiStrength: number

  flowState: FlowState
  flowStrength: number
  flowAcceleration: number
  flowPersistence: number
  flowSpike: boolean

  lsCrowding: LsCrowding
  lsStrength: number
  lsPercentile: number

  spreadState: SpreadState
  spreadZScore: number | null

  emaEvent: EmaEvent
  emaEventTf: string | null

  bullishEvidence: number
  bearishEvidence: number
  signalAgreement: number
  signalDivergence: number
  confluenceLevel: ConfluenceLevel
  /** Which category of signal (trend/oi_positioning/flow/crowding/microstructure/ema_event) drove the most evidence. */
  dominantDriver: string

  /** Convenience copy of the next-1-candle distribution. */
  probabilityUp: number
  probabilityDown: number
  probabilityNeutral: number
  expectedReturn: number
  expectedVolatility: number

  votes: InteractionVote[]
}

export interface PredictedCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  /** 25th/75th percentile close across the secondary GBM paths — a probability band, not a wick. */
  closeLow: number
  closeHigh: number
}

export interface EmaProjectionSeries {
  tf: '15m' | '1h' | '4h' | '1d'
  points: { openTime: number; ema: number }[]
}

/** One loggable row per horizon, meant to be persisted (e.g. IndexedDB) and compared against realized outcomes later. */
export interface PredictionLogEntry {
  timestamp: number
  symbol?: string
  features: Record<string, number | string | boolean | null | undefined>
  regime: Regime
  predictedProbabilityUp: number
  predictedProbabilityDown: number
  predictedProbabilityNeutral: number
  horizon: number
}

export interface CandlePredictionResult {
  /** Primary output — conditional direction probabilities for 1/2/4 candles ahead. */
  horizons: { next1: HorizonPrediction; next2: HorizonPrediction; next4: HorizonPrediction }
  /** Convenience label derived from `horizons.next1` (LONG/SHORT if the up/down gap clears a small threshold, else NEUTRAL). */
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  /** Signal QUALITY, not probability — see module doc comment. */
  confidence: ConfidenceLevel
  confidenceScore: number
  diagnostics: PredictionDiagnostics

  /** Secondary visualization layer only — chart overlay, not the source of the probabilities above. */
  predictedCandles: PredictedCandle[]
  emaProjections: EmaProjectionSeries[]
  simulations: number
  pastCandlesUsed: number

  /** Ready-to-persist rows for walk-forward calibration later. */
  logEntries: PredictionLogEntry[]
}

// ─── calibration placeholders (documented, not "tuned") ───────────────────
//
// Every constant below is a transparent prior standing in for a value that
// should eventually be replaced by walk-forward-fit numbers once
// `logEntries` has accumulated enough realized outcomes to calibrate
// against. None of these are presented as empirically derived.

const EMA_TF_WEIGHT: Record<string, number> = { '15m': 0.15, MA100: 0.15, MA200: 0.2, '1h': 0.25, '4h': 0.35, '1d': 0.45 }
const HORIZON_DECAY: Record<number, number> = { 1: 1.0, 2: 0.82, 4: 0.62 } // predictive conviction decay by horizon
const HORIZON_NEUTRAL_GROWTH: Record<number, number> = { 1: 0, 2: 0.04, 4: 0.09 } // extra chop allowance by horizon
const LOGISTIC_STEEPNESS = 4 // maps netEvidence (-1..1) to an up/down split
const NEUTRAL_BASE = 0.12 // baseline P(neutral) even under a clean directional read
const NEUTRAL_UNCERTAINTY_SCALE = 0.7 // how much aggregate uncertainty inflates P(neutral)
const DRIFT_BIAS_STRENGTH = 0.6 // how much confluence nudges realized drift for the magnitude model
const DIRECTION_LABEL_THRESHOLD = 0.08 // |P(up)-P(down)| below this reads as the NEUTRAL convenience label

// ─── 1. regime classification ──────────────────────────────────────────────
//
// Higher-timeframe EMA alignment establishes a PRIOR, not a vote — it feeds
// the confluence engine's interaction terms (EMA Regime × OI, EMA Regime ×
// Flow) rather than contributing its own directional score.

function classifyRegime(window: PredictionCandleInput[]): RegimeResult {
  const last = window[window.length - 1]
  const price = last.close

  const lines = (
    [
      { tf: '15m', value: last.ema200, weight: 0.15 },
      { tf: '1h', value: last.crossTfEma['1h'], weight: 0.25 },
      { tf: '4h', value: last.crossTfEma['4h'], weight: 0.30 },
      { tf: '1d', value: last.crossTfEma['1d'], weight: 0.30 },
    ].filter(l => l.value != null)
  ) as { tf: string; value: number; weight: number }[]

  let alignment = 0
  let weightUsed = 0
  const parts: string[] = []
  for (const l of lines) {
    const sign = price > l.value ? 1 : -1
    alignment += sign * l.weight
    weightUsed += l.weight
    parts.push(`${l.tf}:${sign > 0 ? 'above' : 'below'}`)
  }
  const emaAlignment = weightUsed > 0 ? clamp(alignment / weightUsed) : 0

  const slopeN = Math.min(10, window.length)
  const recentCloses = window.slice(-slopeN).map(c => c.close)
  const slope = linregSlope(recentCloses)
  const avgPrice = mean(recentCloses) || price

  const logReturns: number[] = []
  for (let i = 1; i < window.length; i++) logReturns.push(Math.log(window[i].close / window[i - 1].close))
  const retStd = stdev(logReturns) || 1e-9
  const slopeReturnUnits = avgPrice !== 0 ? slope / avgPrice : 0
  const shortSlopeZ = clamp(slopeReturnUnits / retStd / 4)

  const ALIGN_TREND_THRESHOLD = 0.4
  const SLOPE_TREND_THRESHOLD = 0.3
  const RANGE_THRESHOLD = 0.25

  let regime: Regime
  let regimeDetail: RegimeDetail

  if (Math.abs(emaAlignment) < RANGE_THRESHOLD && Math.abs(shortSlopeZ) < RANGE_THRESHOLD) {
    regime = 'RANGE'
    regimeDetail = 'range'
  } else if (emaAlignment > ALIGN_TREND_THRESHOLD) {
    regime = 'TREND_UP'
    regimeDetail = shortSlopeZ > SLOPE_TREND_THRESHOLD ? 'strong_trend_up'
      : shortSlopeZ < -SLOPE_TREND_THRESHOLD ? 'pullback_in_uptrend'
      : 'trend_up_consolidation'
  } else if (emaAlignment < -ALIGN_TREND_THRESHOLD) {
    regime = 'TREND_DOWN'
    regimeDetail = shortSlopeZ < -SLOPE_TREND_THRESHOLD ? 'strong_trend_down'
      : shortSlopeZ > SLOPE_TREND_THRESHOLD ? 'pullback_in_downtrend'
      : 'trend_down_consolidation'
  } else {
    regime = 'TRANSITION'
    regimeDetail = 'transition'
  }

  const strength = clamp((Math.abs(emaAlignment) + Math.abs(shortSlopeZ)) / 2, 0, 1)

  return {
    regime, regimeDetail, strength, emaAlignment, shortSlopeZ,
    detail: `EMA align=${emaAlignment.toFixed(2)} [${parts.join(', ') || 'no EMA data'}], slopeZ=${shortSlopeZ.toFixed(2)}`,
  }
}

// ─── 2. OI / price state machine ───────────────────────────────────────────

function classifyOiWindow(window: PredictionCandleInput[], n: number): OiState {
  const w = window.slice(-n)
  const oi = w.map(c => c.openInterest).filter((v): v is number => v != null)
  const closes = w.map(c => c.close)
  if (oi.length < 3 || closes.length < 3) return 'INSUFFICIENT_DATA'
  const priceUp = closes[closes.length - 1] >= closes[0]
  const oiUp = oi[oi.length - 1] >= oi[0]
  if (priceUp && oiUp) return 'PRICE_UP_OI_UP'
  if (priceUp && !oiUp) return 'PRICE_UP_OI_DOWN'
  if (!priceUp && oiUp) return 'PRICE_DOWN_OI_UP'
  return 'PRICE_DOWN_OI_DOWN'
}

/** The direction this OI state implies, BEFORE any interaction modulates it. */
function oiStateSign(state: OiState): number {
  switch (state) {
    case 'PRICE_UP_OI_UP': return 1
    case 'PRICE_UP_OI_DOWN': return 1
    case 'PRICE_DOWN_OI_UP': return -1
    case 'PRICE_DOWN_OI_DOWN': return -1
    default: return 0
  }
}

/** How much continuation conviction the state implies on its own — new positioning (1.0) vs. covering/liquidation (0.5). */
function oiStateQualityMultiplier(state: OiState): number {
  switch (state) {
    case 'PRICE_UP_OI_UP': return 1.0 // long build
    case 'PRICE_UP_OI_DOWN': return 0.5 // short covering — weaker continuation quality
    case 'PRICE_DOWN_OI_UP': return 1.0 // short build
    case 'PRICE_DOWN_OI_DOWN': return 0.5 // long liquidation — potentially exhausted
    default: return 0
  }
}

function analyzeOi(window: PredictionCandleInput[], pastN: number): OiResult {
  const shortN = clamp(Math.round(pastN / 6), 4, 12)
  const shortWindow = classifyOiWindow(window, shortN)
  const mediumWindow = classifyOiWindow(window, pastN)

  const oiSeries = window.map(c => c.openInterest).filter((v): v is number => v != null)
  const closes = window.map(c => c.close)

  let oiChangeZ = 0
  if (oiSeries.length >= 4) {
    const oiReturns: number[] = []
    for (let i = 1; i < oiSeries.length; i++) oiReturns.push((oiSeries[i] - oiSeries[i - 1]) / (oiSeries[i - 1] || 1))
    oiChangeZ = zScoreOf(oiReturns[oiReturns.length - 1] ?? 0, oiReturns)
  }

  const closeReturns: number[] = []
  for (let i = 1; i < closes.length; i++) closeReturns.push(Math.log(closes[i] / closes[i - 1]))
  const priceChangeZ = zScoreOf(closeReturns[closeReturns.length - 1] ?? 0, closeReturns)

  const hasData = mediumWindow !== 'INSUFFICIENT_DATA'
  const strength = hasData ? clamp((Math.abs(priceChangeZ) + Math.abs(oiChangeZ)) / 4, 0, 1) : 0

  return {
    shortWindow, mediumWindow,
    shortPriceChangeZ: priceChangeZ, shortOiChangeZ: oiChangeZ,
    strength, hasData,
    detail: hasData
      ? `short=${shortWindow} medium=${mediumWindow} (priceZ=${priceChangeZ.toFixed(2)}, oiZ=${oiChangeZ.toFixed(2)})`
      : 'insufficient OI samples in window',
  }
}

// ─── 3. dynamic flow features ──────────────────────────────────────────────
//
// No unconditional "inflow=bearish/outflow=bullish" rule — flow only earns
// a directional state from its own recent impulse/acceleration, and its
// eventual effect on the prediction is entirely mediated through the
// confluence engine's interaction terms (PRICE×FLOW, OI×FLOW, FLOW×SPREAD,
// EMA REGIME×FLOW, EMA EVENT×FLOW), not a standalone vote.

function analyzeFlow(window: PredictionCandleInput[], pastN: number): FlowResult {
  const flows = window.map(c => c.flow.inflow - c.flow.outflow) // net INTO exchange per candle
  const hasData = !flows.every(f => f === 0)
  if (!hasData) {
    return { netFlow: 0, flowImpulse: 0, flowAcceleration: 0, flowPersistence: 0, flowSpike: false, flowZScore: 0, state: 'NEUTRAL', strength: 0, hasData, detail: 'no flow data in window' }
  }

  const shortN = clamp(Math.round(pastN / 6), 4, 12)
  const shortFlows = flows.slice(-shortN)
  const priorFlows = flows.slice(-shortN * 2, -shortN)
  const netFlow = flows.reduce((a, b) => a + b, 0)
  const flowImpulse = mean(shortFlows) - (priorFlows.length ? mean(priorFlows) : mean(shortFlows))

  const half = Math.max(1, Math.floor(shortFlows.length / 2))
  const flowAcceleration = mean(shortFlows.slice(half)) - mean(shortFlows.slice(0, half))

  const lastFlow = flows[flows.length - 1]
  const flowZScore = zScoreOf(lastFlow, flows)
  const flowSpike = Math.abs(flowZScore) > 2

  const lastSign = Math.sign(lastFlow)
  const sameSignCount = lastSign === 0 ? 0 : shortFlows.filter(f => Math.sign(f) === lastSign).length
  const flowPersistence = lastSign === 0 ? 0 : clamp(sameSignCount / shortFlows.length, 0, 1)

  // Rising inflow (positive impulse) = latent sell pressure = bearish; rising outflow = bullish.
  const state: FlowState = Math.abs(flowImpulse) < 1e-9 ? 'NEUTRAL' : (flowImpulse < 0 ? 'BULLISH' : 'BEARISH')
  const impulseZ = zScoreOf(flowImpulse, flows)
  const strength = clamp((Math.abs(impulseZ) / 2) * (0.5 + 0.5 * flowPersistence), 0, 1)

  return {
    netFlow, flowImpulse, flowAcceleration, flowPersistence, flowSpike, flowZScore,
    state, strength, hasData,
    detail: `impulse=${flowImpulse.toFixed(2)} accel=${flowAcceleration.toFixed(2)} persistence=${(flowPersistence * 100).toFixed(0)}% z=${flowZScore.toFixed(2)}${flowSpike ? ' [SPIKE]' : ''}`,
  }
}

// ─── 4. L/S ratio as positioning/crowding, not direction ──────────────────

function analyzeLs(window: PredictionCandleInput[]): LsResult {
  const ls = window.map(c => c.longShortRatio?.longAccount).filter((v): v is number => v != null)
  if (ls.length < 5) {
    return { zScore: 0, percentile: 0.5, slope: 0, crowding: 'NEUTRAL', strength: 0, hasData: false, detail: 'insufficient L/S samples in window' }
  }
  const current = ls[ls.length - 1]
  const z = zScoreOf(current, ls)
  const percentile = percentileRank(current, ls)
  const slope = linregSlope(ls.slice(-Math.min(10, ls.length)))

  let crowding: LsCrowding = 'NEUTRAL'
  if (percentile > 0.85 || z > 1.5) crowding = 'CROWDED_LONG'
  else if (percentile < 0.15 || z < -1.5) crowding = 'CROWDED_SHORT'

  const strength = clamp(Math.abs(z) / 2.5, 0, 1)
  return {
    zScore: z, percentile, slope, crowding, strength, hasData: true,
    detail: `long%=${(current * 100).toFixed(1)} z=${z.toFixed(2)} pct=${(percentile * 100).toFixed(0)} slope=${slope.toFixed(4)}`,
  }
}

// ─── 5. spread / microstructure ────────────────────────────────────────────

function analyzeSpread(spreadHistory: number[]): SpreadResult {
  const valid = spreadHistory.filter(v => Number.isFinite(v))
  if (valid.length < 5) {
    const current = valid.length ? valid[valid.length - 1] : null
    return {
      currentSpread: current, spreadMean: null, spreadStd: null, spreadZScore: null, spreadPercentile: null, spreadChange: null,
      state: 'INSUFFICIENT_DATA', uncertainty: 0.5,
      detail: 'insufficient spread history to build a self-baseline — treated as neutral uncertainty rather than a fixed threshold',
    }
  }
  const current = valid[valid.length - 1]
  const spreadMean = mean(valid)
  const spreadStd = stdev(valid) || 1e-9
  const spreadZScore = (current - spreadMean) / spreadStd
  const spreadPercentile = percentileRank(current, valid)
  const spreadChange = valid.length > 1 ? current - valid[valid.length - 2] : 0

  let state: SpreadState = 'NORMAL'
  if (spreadZScore < -0.5 || spreadPercentile < 0.3) state = 'TIGHT'
  else if (spreadZScore > 0.5 || spreadPercentile > 0.7) state = 'WIDE'

  const uncertainty = state === 'WIDE' ? clamp(0.5 + spreadPercentile * 0.5, 0, 1)
    : state === 'TIGHT' ? clamp(0.15 + (1 - spreadPercentile) * 0.1, 0, 0.3)
    : 0.3

  return {
    currentSpread: current, spreadMean, spreadStd, spreadZScore, spreadPercentile, spreadChange, state, uncertainty,
    detail: `spread z=${spreadZScore.toFixed(2)} pct=${(spreadPercentile * 100).toFixed(0)}% (${state})`,
  }
}

/** Only computed if bid/ask size data was actually supplied — never invented from spread alone. */
function analyzeMicrostructure(last: PredictionCandleInput): Partial<Pick<SpreadResult, 'bidAskImbalance' | 'microPrice' | 'depthImbalance'>> {
  if (last.bestBid == null || last.bestAsk == null || last.bidSize == null || last.askSize == null) return {}
  const totalSize = last.bidSize + last.askSize
  const bidAskImbalance = totalSize > 0 ? (last.bidSize - last.askSize) / totalSize : 0
  const microPrice = totalSize > 0
    ? (last.bestBid * last.askSize + last.bestAsk * last.bidSize) / totalSize
    : (last.bestBid + last.bestAsk) / 2
  // Top-of-book only — a fuller multi-level depth imbalance isn't available from this input, so it aliases bidAskImbalance.
  return { bidAskImbalance, microPrice, depthImbalance: bidAskImbalance }
}

// ─── 6. contextual EMA bounce/break events ─────────────────────────────────

function classifyEmaEvent(window: PredictionCandleInput[]): EmaEventResult {
  const LOOKBACK = Math.min(6, window.length - 1)

  for (let back = 0; back < LOOKBACK; back++) {
    const i = window.length - 1 - back
    if (i < 1) break
    const prev = window[i - 1]
    const curr = window[i]

    const candidates = (
      [
        { tf: '15m', prevValue: prev.ema200, currValue: curr.ema200 },
        { tf: 'MA200', prevValue: prev.ma200, currValue: curr.ma200 },
        { tf: 'MA100', prevValue: prev.ma100, currValue: curr.ma100 },
        { tf: '1h', prevValue: prev.crossTfEma['1h'], currValue: curr.crossTfEma['1h'] },
        { tf: '4h', prevValue: prev.crossTfEma['4h'], currValue: curr.crossTfEma['4h'] },
        { tf: '1d', prevValue: prev.crossTfEma['1d'], currValue: curr.crossTfEma['1d'] },
      ].filter(c => c.prevValue != null && c.currValue != null)
    ) as { tf: string; prevValue: number; currValue: number }[]
    if (candidates.length === 0) continue

    const nearest = candidates.reduce((best, c) => Math.abs(curr.close - c.currValue) < Math.abs(curr.close - best.currValue) ? c : best)
    const wasAbove = prev.close > nearest.prevValue
    const isAbove = curr.close > nearest.currValue
    const wickCrossed = curr.high >= nearest.currValue && curr.low <= nearest.currValue
    const bodyRatio = curr.high !== curr.low ? Math.abs(curr.close - curr.open) / (curr.high - curr.low) : 0
    const flipped = wasAbove !== isAbove

    if (flipped && bodyRatio > 0.3) {
      const bullishFlip = isAbove
      if (back > 0) {
        const after = window[i + 1]
        const held = bullishFlip ? after.close > nearest.currValue : after.close < nearest.currValue
        if (!held) {
          return {
            event: bullishFlip ? 'FAILED_BREAKOUT' : 'FAILED_BREAKDOWN',
            tf: nearest.tf, levelValue: nearest.currValue, confirmation: 0,
            detail: `${bullishFlip ? 'breakout' : 'breakdown'} on ${nearest.tf} failed to hold on the next candle`,
          }
        }
      }
      const lookback2 = window.slice(Math.max(0, i - 4), i)
      const sideBeforeCount = lookback2.filter(c => {
        const v = nearest.tf === '15m' ? c.ema200 : nearest.tf === 'MA200' ? c.ma200 : nearest.tf === 'MA100' ? c.ma100 : c.crossTfEma[nearest.tf as '1h' | '4h' | '1d']
        return v != null && (bullishFlip ? c.close <= v : c.close >= v)
      }).length
      const wasEstablishedOtherSide = lookback2.length > 0 && sideBeforeCount / lookback2.length > 0.5
      const event: EmaEvent = bullishFlip
        ? (wasEstablishedOtherSide ? 'RECLAIM' : 'BREAKOUT')
        : (wasEstablishedOtherSide ? 'LOSS_OF_SUPPORT' : 'BREAKDOWN')
      return { event, tf: nearest.tf, levelValue: nearest.currValue, confirmation: 0, detail: `${event} at ${nearest.tf} (body ratio ${bodyRatio.toFixed(2)})` }
    }

    if (wasAbove === isAbove && wickCrossed && bodyRatio < 0.3) {
      return {
        event: 'REJECTION', tf: nearest.tf, levelValue: nearest.currValue, confirmation: isAbove ? 1 : -1,
        detail: `rejection wick at ${nearest.tf} EMA, held ${isAbove ? 'above' : 'below'}`,
      }
    }
  }

  return { event: 'NONE', tf: null, levelValue: null, confirmation: 0, detail: 'no qualifying EMA event in recent candles' }
}

function emaEventDirection(r: EmaEventResult): number {
  switch (r.event) {
    case 'RECLAIM': case 'BREAKOUT': case 'FAILED_BREAKDOWN': return 1
    case 'LOSS_OF_SUPPORT': case 'BREAKDOWN': case 'FAILED_BREAKOUT': return -1
    case 'REJECTION': return r.confirmation
    default: return 0
  }
}

// ─── confluence engine: explicit pairwise interactions ─────────────────────
//
// Per the target architecture, the informative signal lives in how these
// readings RELATE, not in five independent votes. Each function below is
// one named interaction from that list; it returns null (contributes
// nothing) when the underlying data is insufficient. Note OI×L/S and
// CROWDING×OI are the same pairing (crowding IS the L/S-derived measure)
// and are implemented once as `interactionOiLsCrowding`.

function vote(name: string, contribution: number, weight: number, note: string): InteractionVote {
  return { name, contribution: clamp(contribution), weight: clamp(weight, 0, 1), note }
}

/** PRICE × OI */
function interactionPriceOi(oi: OiResult): InteractionVote | null {
  if (!oi.hasData) return null
  const sign = oiStateSign(oi.mediumWindow)
  const quality = oiStateQualityMultiplier(oi.mediumWindow)
  return vote('PRICE × OI', sign * quality, oi.strength, `${oi.mediumWindow} (quality ${quality})`)
}

/** PRICE × FLOW — agreement confirms, disagreement reads as divergence/absorption risk against price. */
function interactionPriceFlow(priceDirSign: number, flow: FlowResult): InteractionVote | null {
  if (flow.state === 'NEUTRAL' || flow.strength === 0) return null
  const flowSign = flow.state === 'BULLISH' ? 1 : -1
  const agree = priceDirSign !== 0 && priceDirSign === flowSign
  const note = priceDirSign === 0
    ? 'flow read (price flat)'
    : agree ? 'flow confirms price direction' : 'flow diverges from price — absorption/divergence risk'
  return vote('PRICE × FLOW', flowSign, flow.strength, note)
}

/** OI × FLOW — flow confirms or contradicts the OI-implied positioning read. */
function interactionOiFlow(oi: OiResult, flow: FlowResult): InteractionVote | null {
  if (!oi.hasData) return null
  const oiSign = oiStateSign(oi.mediumWindow)
  if (oiSign === 0) return null
  const flowSign = flow.state === 'BULLISH' ? 1 : flow.state === 'BEARISH' ? -1 : 0
  let mult: number
  let note: string
  if (flowSign === 0) { mult = 0.5; note = `${oi.mediumWindow} with neutral flow` }
  else if (oiSign === flowSign) { mult = 1.0; note = `${oi.mediumWindow} confirmed by ${flow.state.toLowerCase()} flow` }
  else { mult = 0.2; note = `${oi.mediumWindow} contradicted by ${flow.state.toLowerCase()} flow — possible exhaustion/warning` }
  return vote('OI × FLOW', oiSign * mult, oi.strength * 0.5 + flow.strength * 0.5, note)
}

/** OI × L/S Crowding (also covers CROWDING × OI — same pairing). */
function interactionOiLsCrowding(oi: OiResult, ls: LsResult): InteractionVote | null {
  if (!oi.hasData || ls.crowding === 'NEUTRAL') return null
  const oiSign = oiStateSign(oi.mediumWindow)
  if (oiSign === 0) return null
  let mult: number
  let note: string
  if (oiSign > 0 && ls.crowding === 'CROWDED_SHORT') { mult = 1.4; note = 'bullish OI read + crowded shorts → squeeze/continuation potential' }
  else if (oiSign > 0 && ls.crowding === 'CROWDED_LONG') { mult = 0.4; note = 'bullish OI read but crowded longs → elevated long-liquidation/reversal risk' }
  else if (oiSign < 0 && ls.crowding === 'CROWDED_LONG') { mult = 1.4; note = 'bearish OI read + crowded longs → continuation risk increases' }
  else { mult = 0.4; note = 'bearish OI read but crowded shorts → elevated short-squeeze risk' }
  return vote('OI × L/S Crowding', oiSign * mult, clamp(oi.strength * 0.6 + ls.strength * 0.6, 0, 1), note)
}

/** FLOW × SPREAD — spread modulates how much the flow signal should be trusted, not its direction. */
function interactionFlowSpread(flow: FlowResult, spread: SpreadResult): InteractionVote | null {
  if (flow.state === 'NEUTRAL' || flow.strength === 0) return null
  const flowSign = flow.state === 'BULLISH' ? 1 : -1
  const spreadMult = spread.state === 'WIDE' ? 0.4 : spread.state === 'TIGHT' ? 1.2 : 0.8
  return vote('FLOW × SPREAD', flowSign, clamp(flow.strength * spreadMult, 0, 1), `${flow.state.toLowerCase()} flow, spread ${spread.state.toLowerCase()}`)
}

/** EMA REGIME × OI */
function interactionEmaRegimeOi(regime: RegimeResult, oi: OiResult): InteractionVote | null {
  if (!oi.hasData) return null
  const oiSign = oiStateSign(oi.mediumWindow)
  if (oiSign === 0) return null
  const regimeSign = regime.regime === 'TREND_UP' ? 1 : regime.regime === 'TREND_DOWN' ? -1 : 0
  let mult: number
  let note: string
  if (regimeSign === 0) { mult = 0.6; note = `${oi.mediumWindow} with no clear higher-TF regime prior` }
  else if (oiSign === regimeSign) { mult = 1.0; note = `${oi.mediumWindow} aligned with ${regime.regime} — continuation` }
  else { mult = 0.5; note = `${oi.mediumWindow} against ${regime.regime} — possible countertrend/reversal` }
  return vote('EMA Regime × OI', oiSign * mult, clamp(oi.strength * (0.5 + 0.5 * regime.strength), 0, 1), note)
}

/** EMA REGIME × FLOW */
function interactionEmaRegimeFlow(regime: RegimeResult, flow: FlowResult): InteractionVote | null {
  if (flow.state === 'NEUTRAL' || flow.strength === 0) return null
  const flowSign = flow.state === 'BULLISH' ? 1 : -1
  const regimeSign = regime.regime === 'TREND_UP' ? 1 : regime.regime === 'TREND_DOWN' ? -1 : 0
  let mult: number
  let note: string
  if (regimeSign === 0) { mult = 0.6; note = `${flow.state.toLowerCase()} flow with no clear higher-TF regime prior` }
  else if (flowSign === regimeSign) { mult = 1.0; note = `${flow.state.toLowerCase()} flow aligned with ${regime.regime}` }
  else { mult = 0.5; note = `${flow.state.toLowerCase()} flow against ${regime.regime} — possible countertrend` }
  return vote('EMA Regime × Flow', flowSign * mult, clamp(flow.strength * (0.5 + 0.5 * regime.strength), 0, 1), note)
}

/** EMA EVENT × OI */
function interactionEmaEventOi(emaEvent: EmaEventResult, oi: OiResult): InteractionVote | null {
  if (emaEvent.event === 'NONE' || !oi.hasData) return null
  const eventDir = emaEventDirection(emaEvent)
  if (eventDir === 0) return null
  const oiSign = oiStateSign(oi.mediumWindow)
  const tfWeight = EMA_TF_WEIGHT[emaEvent.tf ?? ''] ?? 0.2
  let mult: number
  let note: string
  if (oiSign === 0) { mult = 0.6; note = `${emaEvent.event} with flat/insufficient OI` }
  else if (oiSign === eventDir) { mult = 1.0; note = `${emaEvent.event} confirmed by OI` }
  else { mult = 0.35; note = `${emaEvent.event} not confirmed by OI — lower-quality/failure risk` }
  return vote('EMA Event × OI', eventDir * mult, clamp(tfWeight * (0.6 + 0.4 * oi.strength), 0, 1), note)
}

/** EMA EVENT × FLOW */
function interactionEmaEventFlow(emaEvent: EmaEventResult, flow: FlowResult): InteractionVote | null {
  if (emaEvent.event === 'NONE') return null
  const eventDir = emaEventDirection(emaEvent)
  if (eventDir === 0) return null
  const tfWeight = EMA_TF_WEIGHT[emaEvent.tf ?? ''] ?? 0.2
  let mult: number
  let note: string
  if (flow.state === 'NEUTRAL') { mult = 0.6; note = `${emaEvent.event} with neutral flow` }
  else {
    const flowSign = flow.state === 'BULLISH' ? 1 : -1
    mult = flowSign === eventDir ? 1.0 : 0.35
    note = flowSign === eventDir ? `${emaEvent.event} confirmed by ${flow.state.toLowerCase()} flow` : `${emaEvent.event} not confirmed by flow — lower-quality/failure risk`
  }
  return vote('EMA Event × Flow', eventDir * mult, clamp(tfWeight * (0.6 + 0.4 * flow.strength), 0, 1), note)
}

/** CROWDING × PRICE — price extending further into already-crowded positioning reads as a reversal/squeeze risk. */
function interactionCrowdingPrice(ls: LsResult, priceDirSign: number): InteractionVote | null {
  if (ls.crowding === 'NEUTRAL' || priceDirSign === 0) return null
  if (ls.crowding === 'CROWDED_LONG' && priceDirSign > 0) {
    return vote('Crowding × Price', -1, clamp(ls.strength * 0.6, 0, 1), 'price extending into crowded-long positioning — reversal risk')
  }
  if (ls.crowding === 'CROWDED_SHORT' && priceDirSign < 0) {
    return vote('Crowding × Price', 1, clamp(ls.strength * 0.6, 0, 1), 'price extending into crowded-short positioning — squeeze risk')
  }
  return null
}

function categoryOf(name: string): string {
  if (name.includes('Event')) return 'ema_event'
  if (name.includes('Regime')) return 'trend'
  if (name.includes('Crowding')) return 'crowding'
  if (name.includes('Spread')) return 'microstructure'
  if (name.includes('Flow')) return 'flow'
  if (name.includes('OI')) return 'oi_positioning'
  return 'other'
}

function computeConfluence(votes: (InteractionVote | null)[]): ConfluenceResult {
  const valid = votes.filter((v): v is InteractionVote => v !== null && v.weight > 0)

  let posSum = 0
  let negSum = 0
  let totalWeight = 0
  const categoryMagnitude: Record<string, number> = {}
  for (const v of valid) {
    posSum += Math.max(v.contribution, 0) * v.weight
    negSum += Math.max(-v.contribution, 0) * v.weight
    totalWeight += v.weight
    const cat = categoryOf(v.name)
    categoryMagnitude[cat] = (categoryMagnitude[cat] ?? 0) + Math.abs(v.contribution) * v.weight
  }

  const bullishEvidence = totalWeight > 0 ? clamp(posSum / totalWeight, 0, 1) : 0
  const bearishEvidence = totalWeight > 0 ? clamp(negSum / totalWeight, 0, 1) : 0
  const netEvidence = clamp(bullishEvidence - bearishEvidence)
  const totalEvidence = clamp(bullishEvidence + bearishEvidence, 0, 1)
  const signalAgreement = totalEvidence > 0 ? clamp(Math.abs(netEvidence) / totalEvidence, 0, 1) : 0
  const signalDivergence = 1 - signalAgreement

  let level: ConfluenceLevel
  if (totalEvidence < 0.15) level = 'LOW_CONFLUENCE'
  else if (signalAgreement >= 0.65) level = 'HIGH_CONFLUENCE'
  else if (signalAgreement >= 0.4) level = 'MODERATE_CONFLUENCE'
  else level = 'CONFLICTING_SIGNALS'

  const dominantDriver = Object.entries(categoryMagnitude).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'

  return { bullishEvidence, bearishEvidence, netEvidence, totalEvidence, signalAgreement, signalDivergence, level, votes: valid, dominantDriver }
}

// ─── horizon probability builder ───────────────────────────────────────────

function buildHorizon(
  h: number,
  netEvidence: number,
  neutralBaseProb: number,
  lastClose: number,
  expectedReturnPerCandle: number,
  volatilityPerCandle: number,
): HorizonPrediction {
  const decay = HORIZON_DECAY[h] ?? Math.pow(0.82, h - 1)
  const neutralGrowth = HORIZON_NEUTRAL_GROWTH[h] ?? Math.min(0.15, 0.02 * (h - 1))
  const S_h = netEvidence * decay
  const neutralProb = clamp(neutralBaseProb + neutralGrowth, 0, 0.92)
  const remaining = 1 - neutralProb
  const pUpShare = 1 / (1 + Math.exp(-LOGISTIC_STEEPNESS * S_h))
  const probabilityUp = remaining * pUpShare
  const probabilityDown = remaining * (1 - pUpShare)

  const expectedReturn = expectedReturnPerCandle * h
  const expectedVolatility = volatilityPerCandle * Math.sqrt(h)
  const Z = 1.28 // ~80% band, calibration placeholder

  return {
    horizon: h,
    probabilityUp, probabilityDown, probabilityNeutral: neutralProb,
    expectedReturn, expectedVolatility,
    expectedHigh: lastClose * Math.exp(expectedReturn + Z * expectedVolatility),
    expectedLow: lastClose * Math.exp(expectedReturn - Z * expectedVolatility),
  }
}

// ─── main entry ───────────────────────────────────────────────────────────

export function generateCandlePrediction(history: PredictionCandleInput[], params: PredictionParams): CandlePredictionResult {
  const pastN = Math.max(10, Math.min(params.pastCandles, history.length))
  const window = history.slice(-pastN)
  const closes = window.map(c => c.close)
  const lastClose = closes[closes.length - 1]
  const lastOpenTime = window[window.length - 1].openTime
  const intervalMs = params.intervalMs

  const logReturns: number[] = []
  for (let i = 1; i < closes.length; i++) logReturns.push(Math.log(closes[i] / closes[i - 1]))
  const driftPerCandle = mean(logReturns)
  let volatilityPerCandle = stdev(logReturns) || Math.abs(driftPerCandle) * 0.5 || 0.001

  // ── regime / positioning / microstructure ──
  const regime = classifyRegime(window)
  const oi = analyzeOi(window, pastN)
  const flow = analyzeFlow(window, pastN)
  const ls = analyzeLs(window)
  const spread: SpreadResult = { ...analyzeSpread(params.bidAskSpreadPercentHistory), ...analyzeMicrostructure(window[window.length - 1]) }
  const emaEvent = classifyEmaEvent(window)

  const priceDirSign = (() => {
    const n = Math.min(6, window.length)
    const recent = window.slice(-n)
    const chg = recent[recent.length - 1].close - recent[0].close
    return Math.abs(chg) < 1e-9 ? 0 : Math.sign(chg)
  })()

  // ── confluence engine: explicit interactions, not independent votes ──
  const votes = [
    interactionPriceOi(oi),
    interactionPriceFlow(priceDirSign, flow),
    interactionOiFlow(oi, flow),
    interactionOiLsCrowding(oi, ls),
    interactionFlowSpread(flow, spread),
    interactionEmaRegimeOi(regime, oi),
    interactionEmaRegimeFlow(regime, flow),
    interactionEmaEventOi(emaEvent, oi),
    interactionEmaEventFlow(emaEvent, flow),
    interactionCrowdingPrice(ls, priceDirSign),
  ]
  const confluence = computeConfluence(votes)
  const netEvidence = confluence.netEvidence

  // ── volatility state (separate from direction) ──
  const shortRetN = Math.min(8, logReturns.length)
  const shortStd = stdev(logReturns.slice(-shortRetN))
  const volCompressed = volatilityPerCandle > 0 && shortStd > 0 && shortStd < volatilityPerCandle * 0.5

  const recentWindow = window.slice(-Math.min(5, window.length))
  const stallingCount = recentWindow.filter(c => c.isBuyingExhaustion || c.isSellingExhaustion || c.isCandleInAbsorption).length
  volatilityPerCandle *= 1 + 0.15 * clamp(stallingCount / recentWindow.length, 0, 1)

  // ── uncertainty → P(neutral) baseline ──
  // Explicitly widens neutral probability under mixed regime, thin data,
  // wide spread, low volatility (chop), and conflicting signals — a market
  // state is allowed to resolve to "no edge" instead of being forced LONG/SHORT.
  const regimeUncertainty = (regime.regime === 'RANGE' || regime.regime === 'TRANSITION') ? 1 : clamp(1 - regime.strength, 0, 1)
  const weakSignalUncertainty = clamp(1 - confluence.totalEvidence, 0, 1)
  const U = clamp(
    regimeUncertainty * 0.25 +
    spread.uncertainty * 0.2 +
    weakSignalUncertainty * 0.25 +
    (volCompressed ? 1 : 0) * 0.1 +
    confluence.signalDivergence * 0.2,
    0, 1,
  )
  const neutralBaseProb = clamp(NEUTRAL_BASE + U * NEUTRAL_UNCERTAINTY_SCALE, 0, 0.9)

  // ── magnitude model, separate from direction ──
  const expectedReturnPerCandle = driftPerCandle + netEvidence * volatilityPerCandle * DRIFT_BIAS_STRENGTH

  const next1 = buildHorizon(1, netEvidence, neutralBaseProb, lastClose, expectedReturnPerCandle, volatilityPerCandle)
  const next2 = buildHorizon(2, netEvidence, neutralBaseProb, lastClose, expectedReturnPerCandle, volatilityPerCandle)
  const next4 = buildHorizon(4, netEvidence, neutralBaseProb, lastClose, expectedReturnPerCandle, volatilityPerCandle)

  const dirDelta = next1.probabilityUp - next1.probabilityDown
  const direction: CandlePredictionResult['direction'] = Math.abs(dirDelta) < DIRECTION_LABEL_THRESHOLD ? 'NEUTRAL' : (dirDelta > 0 ? 'LONG' : 'SHORT')

  // ── confidence: signal QUALITY, not probability ──
  const dataCompleteness = mean([oi.hasData ? 1 : 0, flow.hasData ? 1 : 0, ls.hasData ? 1 : 0, spread.state !== 'INSUFFICIENT_DATA' ? 1 : 0])
  const confidenceScore = clamp(
    confluence.signalAgreement * 0.4 +
    dataCompleteness * 0.3 +
    (1 - spread.uncertainty) * 0.15 +
    confluence.totalEvidence * 0.15,
    0, 1,
  ) * 100
  const confidence: ConfidenceLevel = confidenceScore >= 70 ? 'HIGH' : confidenceScore >= 45 ? 'MODERATE' : 'LOW'

  // ── secondary visualization layer (GBM) — seeded from the model's own expected return/volatility, not from a separate ad-hoc drift bias ──
  const simulations = params.simulations ?? 500
  const predictedN = Math.max(1, params.predictedCandles)
  const avgRange = mean(window.map(c => c.high - c.low))
  const avgRangePct = closes.length ? avgRange / mean(closes) : 0.01

  const pathsClose: number[][] = []
  for (let s = 0; s < simulations; s++) {
    let price = lastClose
    const path: number[] = []
    for (let t = 0; t < predictedN; t++) {
      const r = expectedReturnPerCandle + volatilityPerCandle * gaussianRandom()
      price = price * Math.exp(r)
      path.push(price)
    }
    pathsClose.push(path)
  }

  const predictedCandles: PredictedCandle[] = []
  let prevClose = lastClose
  for (let t = 0; t < predictedN; t++) {
    const closesAtT = pathsClose.map(p => p[t])
    const medianClose = quantile(closesAtT, 0.5)
    const p25 = quantile(closesAtT, 0.25)
    const p75 = quantile(closesAtT, 0.75)
    const open = prevClose
    const rangeJitter = 0.7 + Math.random() * 0.6
    const range = Math.abs(medianClose * avgRangePct * rangeJitter)
    const high = Math.max(open, medianClose) + range * 0.5
    const low = Math.min(open, medianClose) - range * 0.5
    predictedCandles.push({ openTime: lastOpenTime + intervalMs * (t + 1), open, high, low, close: medianClose, closeLow: p25, closeHigh: p75 })
    prevClose = medianClose
  }

  const k200 = 2 / (200 + 1)
  function projectEma(seedEma: number | null): { openTime: number; ema: number }[] {
    if (seedEma == null) return []
    let ema = seedEma
    return predictedCandles.map(pc => {
      ema = pc.close * k200 + ema * (1 - k200)
      return { openTime: pc.openTime, ema }
    })
  }
  const last = window[window.length - 1]
  const emaProjections: EmaProjectionSeries[] = [
    { tf: '15m', points: projectEma(last.ema200) },
    { tf: '1h', points: projectEma(last.crossTfEma['1h']) },
    { tf: '4h', points: projectEma(last.crossTfEma['4h']) },
    { tf: '1d', points: projectEma(last.crossTfEma['1d']) },
  ]

  // ── diagnostics ──
  const diagnostics: PredictionDiagnostics = {
    regime: regime.regime, regimeDetail: regime.regimeDetail, regimeStrength: regime.strength,
    oiState: oi.mediumWindow, oiShortWindowState: oi.shortWindow, oiStrength: oi.strength,
    flowState: flow.state, flowStrength: flow.strength, flowAcceleration: flow.flowAcceleration, flowPersistence: flow.flowPersistence, flowSpike: flow.flowSpike,
    lsCrowding: ls.crowding, lsStrength: ls.strength, lsPercentile: ls.percentile,
    spreadState: spread.state, spreadZScore: spread.spreadZScore,
    emaEvent: emaEvent.event, emaEventTf: emaEvent.tf,
    bullishEvidence: confluence.bullishEvidence, bearishEvidence: confluence.bearishEvidence,
    signalAgreement: confluence.signalAgreement, signalDivergence: confluence.signalDivergence,
    confluenceLevel: confluence.level, dominantDriver: confluence.dominantDriver,
    probabilityUp: next1.probabilityUp, probabilityDown: next1.probabilityDown, probabilityNeutral: next1.probabilityNeutral,
    expectedReturn: next1.expectedReturn, expectedVolatility: next1.expectedVolatility,
    votes: confluence.votes,
  }

  // ── calibration/logging scaffold — persistence is left to the caller (e.g. IndexedDB) ──
  const logEntries: PredictionLogEntry[] = [next1, next2, next4].map(h => ({
    timestamp: Date.now(),
    symbol: params.symbol,
    features: {
      regime: regime.regime, regimeStrength: regime.strength,
      oiState: oi.mediumWindow, oiStrength: oi.strength,
      flowState: flow.state, flowStrength: flow.strength, flowZScore: flow.flowZScore,
      lsCrowding: ls.crowding, lsZScore: ls.zScore,
      spreadState: spread.state, spreadZScore: spread.spreadZScore,
      emaEvent: emaEvent.event,
      signalAgreement: confluence.signalAgreement, dominantDriver: confluence.dominantDriver,
    },
    regime: regime.regime,
    predictedProbabilityUp: h.probabilityUp,
    predictedProbabilityDown: h.probabilityDown,
    predictedProbabilityNeutral: h.probabilityNeutral,
    horizon: h.horizon,
  }))

  return {
    horizons: { next1, next2, next4 },
    direction, confidence, confidenceScore,
    diagnostics,
    predictedCandles, emaProjections, simulations, pastCandlesUsed: pastN,
    logEntries,
  }
}