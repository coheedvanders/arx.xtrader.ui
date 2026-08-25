// src/utility/predictionProbability.ts
//
// Multi-factor, probabilistic (Monte Carlo) forward candle prediction.
//
// Given the last `pastCandles` bars plus their Open Interest, Long/Short
// account ratio, cross-timeframe EMA200 alignment (15m/1h/4h/1d), exchange
// wallet flow (inflow/outflow), and the live bid/ask spread, this scores a
// directional bias from each factor, blends them into a single drift
// adjustment on top of the window's realized drift/volatility, and runs a
// Monte Carlo GBM (geometric Brownian motion) simulation to project
// `predictedCandles` candles forward. Each factor score is fully retained
// in the result so the UI can show *why* it predicted what it predicted,
// not just the number.
//
// The EMA200 (and each cross-TF EMA) is then walked forward on the
// simulated median close path using the same incremental EMA formula the
// live chart already uses (ema_t = close_t*k + ema_{t-1}*(1-k)), so the
// line visually "continues" out of the last real candle into the
// projection instead of just stopping dead.
//
// This is a statistical projection, not a guarantee — treat `confidence`
// as "how internally consistent the factors + simulated paths agree with
// each other", not a win probability.

export interface PredictionCandleInput {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  /** 15m (chart-native) EMA200 at this candle — i.e. candle.candleData.ema200 */
  ema200: number | null
  /** 15m MA200 / MA100 at this candle — i.e. candle.candleData.ma200 / ma100 */
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
  /** candle.isWeakening — momentum-weakening flag on the candle itself */
  isWeakening: boolean
  /** candle.patternTrack — 'hl' (higher low, bullish structure) / 'lh' (lower high, bearish structure) */
  patternTrack: 'hl' | 'lh' | null
}

export interface PredictionParams {
  /** How many trailing candles to build the statistical model from. */
  pastCandles: number
  /** How many candles forward to project. */
  predictedCandles: number
  /** Current live bid/ask spread (%) — used only as a confidence modifier, not a direction input. */
  bidAskSpreadPercent: number | null
  /** Interval duration in ms — used to step predicted openTime and to note vs. cross-TF EMA resolution. */
  intervalMs: number
  /** Monte Carlo path count. Default 500. */
  simulations?: number
}

export interface FactorScore {
  name: string
  /** -1 (max bearish) .. +1 (max bullish) */
  score: number
  weight: number
  detail: string
}

export interface PredictedCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  /** 25th / 75th percentile close across all simulated paths at this step — a probability band, not a wick. */
  closeLow: number
  closeHigh: number
}

export interface EmaProjectionSeries {
  tf: '15m' | '1h' | '4h' | '1d'
  points: { openTime: number; ema: number }[]
}

export interface CandlePredictionResult {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  /** 0-100 */
  confidence: number
  /** -1..1, the blended factor score that biased the simulation's drift */
  compositeScore: number
  factors: FactorScore[]
  /** realized mean log-return per candle over the lookback window (pre-bias) */
  driftPerCandle: number
  /** realized stdev of log-returns per candle over the lookback window */
  volatilityPerCandle: number
  predictedCandles: PredictedCandle[]
  emaProjections: EmaProjectionSeries[]
  simulations: number
  pastCandlesUsed: number
}

// ─── small stats helpers ─────────────────────────────────────────────────

/** Box-Muller standard normal sample. */
function gaussianRandom(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

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

function percentile(vals: number[], p: number): number {
  const sorted = [...vals].sort((a, b) => a - b)
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ─── factor scoring ───────────────────────────────────────────────────────
// Each factor returns a signed score in [-1, 1] (bearish..bullish) plus the
// weight it should carry in the composite blend and a human-readable detail
// string for tooltips/debugging.

/**
 * Open Interest read against price direction — the standard derivatives
 * interpretation matrix:
 *   price↑ & OI↑ = new longs entering        → bullish, strong
 *   price↑ & OI↓ = short covering             → bullish, weaker
 *   price↓ & OI↑ = new shorts entering        → bearish, strong
 *   price↓ & OI↓ = long liquidation/unwind    → bearish, weaker
 */
function scoreOpenInterest(window: PredictionCandleInput[]): FactorScore {
  const oi = window.map(c => c.openInterest).filter((v): v is number => v != null)
  if (oi.length < 3) {
    return { name: 'Open Interest', score: 0, weight: 0.22, detail: 'insufficient OI samples in window' }
  }
  const priceStart = window[0].close
  const priceEnd = window[window.length - 1].close
  const oiStart = oi[0]
  const oiEnd = oi[oi.length - 1]
  const priceUp = priceEnd >= priceStart
  const oiUp = oiEnd >= oiStart
  const oiChangeRatio = oiStart !== 0 ? (oiEnd - oiStart) / oiStart : 0
  const magnitude = clamp(Math.abs(oiChangeRatio) * 8, 0, 1)

  let base: number
  if (priceUp && oiUp) base = 1
  else if (priceUp && !oiUp) base = 0.4
  else if (!priceUp && oiUp) base = -1
  else base = -0.4

  const score = clamp(base * Math.max(magnitude, 0.35))
  return {
    name: 'Open Interest',
    score,
    weight: 0.22,
    detail: `${priceUp ? 'price up' : 'price down'} & ${oiUp ? 'OI up' : 'OI down'} (OI ${(oiChangeRatio * 100).toFixed(2)}%)`,
  }
}

/**
 * Long/Short account ratio — momentum-follows a mild drift in the long%,
 * but fades (goes contrarian) once the crowd is positioned at a statistical
 * extreme (|z| > 1.75 vs. its own rolling mean/stdev) — the standard
 * "crowded long/short" fade used around funding-sensitive extremes.
 */
function scoreLongShortRatio(window: PredictionCandleInput[]): FactorScore {
  const ls = window.map(c => c.longShortRatio?.longAccount).filter((v): v is number => v != null)
  if (ls.length < 5) {
    return { name: 'Long/Short Ratio', score: 0, weight: 0.14, detail: 'insufficient L/S samples in window' }
  }
  const m = mean(ls)
  const sd = stdev(ls) || 1e-6
  const current = ls[ls.length - 1]
  const z = (current - m) / sd
  const slope = (ls[ls.length - 1] - ls[0]) / ls.length

  const score = Math.abs(z) > 1.75
    ? clamp(-Math.sign(z) * 0.7)
    : clamp(Math.tanh(slope * 40))

  return {
    name: 'Long/Short Ratio',
    score,
    weight: 0.14,
    detail: `long%=${(current * 100).toFixed(1)} (z=${z.toFixed(2)})`,
  }
}

/**
 * Cross-timeframe EMA200 alignment (15m/1h/4h/1d) — price above/below each
 * EMA is scored by distance (not just binary side), and higher timeframes
 * carry more weight since a 1D EMA200 read matters more than a 15m one.
 */
function scoreCrossTfEma(window: PredictionCandleInput[]): FactorScore {
  const last = window[window.length - 1]
  const price = last.close
  const tfWeights: Record<'1h' | '4h' | '1d', number> = { '1h': 0.2, '4h': 0.35, '1d': 0.45 }
  let weightedSum = 0
  let weightUsed = 0
  const parts: string[] = []

  ;(['1h', '4h', '1d'] as const).forEach(tf => {
    const ema = last.crossTfEma[tf]
    if (ema == null) return
    const dist = (price - ema) / ema
    const sign = clamp(Math.tanh(dist * 25))
    weightedSum += sign * tfWeights[tf]
    weightUsed += tfWeights[tf]
    parts.push(`${tf}:${sign >= 0 ? 'above' : 'below'}(${(dist * 100).toFixed(2)}%)`)
  })

  if (last.ema200 != null) {
    const dist = (price - last.ema200) / last.ema200
    const sign = clamp(Math.tanh(dist * 25))
    weightedSum += sign * 0.1
    weightUsed += 0.1
    parts.push(`15m:${sign >= 0 ? 'above' : 'below'}`)
  }

  const score = weightUsed > 0 ? clamp(weightedSum / weightUsed) : 0
  return { name: 'Cross-TF EMA Alignment', score, weight: 0.30, detail: parts.join(', ') || 'no EMA data in window' }
}

/**
 * Exchange wallet flow — net inflow to exchanges is read as latent sell
 * pressure (bearish), net outflow as accumulation/off-exchange custody
 * (bullish). Normalized against the largest single-candle net move in the
 * window so it isn't dominated by one outlier bucket.
 */
function scoreFlowMovement(window: PredictionCandleInput[]): FactorScore {
  const flows = window.map(c => c.flow.inflow - c.flow.outflow) // net INTO exchange, per candle
  if (flows.every(f => f === 0)) {
    return { name: 'Exchange Flow', score: 0, weight: 0.18, detail: 'no flow data in window' }
  }
  const totalNet = flows.reduce((a, b) => a + b, 0)
  const scale = Math.max(...flows.map(f => Math.abs(f)), 1e-9)
  const score = clamp(-Math.tanh((totalNet / scale) * 1.2))
  return { name: 'Exchange Flow', score, weight: 0.18, detail: `net ${totalNet >= 0 ? 'inflow (bearish lean)' : 'outflow (bullish lean)'}` }
}

/** Raw price momentum — realized drift normalized by realized volatility (a rough Sharpe-style read). */
function scoreMomentum(logReturns: number[]): FactorScore {
  const m = mean(logReturns)
  const sd = stdev(logReturns) || 1e-9
  const score = clamp(Math.tanh((m / sd) * 3))
  return { name: 'Price Momentum', score, weight: 0.16, detail: `drift/vol=${(m / sd).toFixed(3)}` }
}

/**
 * Exhaustion / structure read — acts as a counter-trend brake. Buying
 * exhaustion after an up-move flags a potential top (bearish), selling
 * exhaustion after a down-move flags a potential bottom (bullish), a
 * weakening candle fades whatever the short local trend was doing, and
 * higher-low/lower-high pattern-track state adds a small structural lean.
 * Absorption doesn't get its own directional vote — it's noted in the
 * detail string and instead widens the simulation's volatility (see
 * `generateCandlePrediction`), since an absorbing candle usually means
 * "stalling", not "reversing".
 *
 * Every event is recency-weighted (exponential decay, most recent candle
 * weighted highest) so a signal from 2 candles ago dominates one from 40
 * candles ago.
 */
function scoreExhaustionStructure(window: PredictionCandleInput[]): FactorScore {
  const RECENCY_DECAY = 0.9
  let weightedSum = 0
  let weightUsed = 0
  let buyingExhCount = 0
  let sellingExhCount = 0
  let weakeningCount = 0
  let hlCount = 0
  let lhCount = 0
  let absorptionCount = 0

  for (let i = 0; i < window.length; i++) {
    const c = window[i]
    const recency = Math.pow(RECENCY_DECAY, window.length - 1 - i)

    if (c.isCandleInAbsorption) absorptionCount++

    if (c.isBuyingExhaustion) {
      buyingExhCount++
      weightedSum += -1 * 0.5 * recency
      weightUsed += 0.5 * recency
    }
    if (c.isSellingExhaustion) {
      sellingExhCount++
      weightedSum += 1 * 0.5 * recency
      weightUsed += 0.5 * recency
    }
    if (c.isWeakening) {
      weakeningCount++
      // Fade whatever the short local trend (vs. ~5 candles back) was doing.
      const lookback = Math.max(0, i - 5)
      const localTrend = Math.sign(c.close - window[lookback].close)
      weightedSum += -localTrend * 0.35 * recency
      weightUsed += 0.35 * recency
    }
    if (c.patternTrack === 'hl') {
      hlCount++
      weightedSum += 1 * 0.3 * recency
      weightUsed += 0.3 * recency
    }
    if (c.patternTrack === 'lh') {
      lhCount++
      weightedSum += -1 * 0.3 * recency
      weightUsed += 0.3 * recency
    }
  }

  const score = weightUsed > 0 ? clamp(weightedSum / weightUsed) : 0
  const detail = weightUsed > 0
    ? `buyExh=${buyingExhCount} sellExh=${sellingExhCount} weakening=${weakeningCount} HL=${hlCount} LH=${lhCount} absorption=${absorptionCount}`
    : 'no exhaustion/structure signals in window'

  return { name: 'Exhaustion / Structure', score, weight: 0.20, detail }
}

/**
 * Nearest-EMA bounce vs. break read. For every candle, finds whichever
 * tracked EMA/MA (15m EMA200, MA200, MA100, 1h/4h/1d EMA200) price is
 * currently closest to, then classifies what happened at that level:
 *   - BOUNCE: price wicked into/through the level but closed back on the
 *     same side it was already on → reinforces the existing trend.
 *   - BREAK: price closed on the opposite side from the prior candle, with
 *     real conviction (a decent-sized body, not a doji) → treated as a
 *     structure/regime shift and weighted stronger than a bounce.
 * Each event is weighted by which line it happened at (higher timeframe =
 * more weight) and recency-decayed the same way as the exhaustion factor.
 */
function scoreEmaBounceBreak(window: PredictionCandleInput[]): FactorScore {
  const RECENCY_DECAY = 0.9
  const TF_WEIGHT: Record<string, number> = { '15m': 0.15, MA100: 0.15, MA200: 0.2, '1h': 0.25, '4h': 0.35, '1d': 0.45 }

  let weightedSum = 0
  let weightUsed = 0
  let bounces = 0
  let breaks = 0
  const testedTfs = new Set<string>()

  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]
    const curr = window[i]

    const candidates = [
      { tf: '15m', prevValue: prev.ema200, currValue: curr.ema200 },
      { tf: 'MA200', prevValue: prev.ma200, currValue: curr.ma200 },
      { tf: 'MA100', prevValue: prev.ma100, currValue: curr.ma100 },
      { tf: '1h', prevValue: prev.crossTfEma['1h'], currValue: curr.crossTfEma['1h'] },
      { tf: '4h', prevValue: prev.crossTfEma['4h'], currValue: curr.crossTfEma['4h'] },
      { tf: '1d', prevValue: prev.crossTfEma['1d'], currValue: curr.crossTfEma['1d'] },
    ].filter(c => c.prevValue != null && c.currValue != null) as { tf: string; prevValue: number; currValue: number }[]

    if (candidates.length === 0) continue

    // Whichever tracked line current price sits nearest to.
    const nearest = candidates.reduce((best, c) =>
      Math.abs(curr.close - c.currValue) < Math.abs(curr.close - best.currValue) ? c : best
    )

    const wasAbove = prev.close > nearest.prevValue
    const isAbove = curr.close > nearest.currValue
    const wickCrossed = curr.high >= nearest.currValue && curr.low <= nearest.currValue
    const bodyRatio = curr.high !== curr.low ? Math.abs(curr.close - curr.open) / (curr.high - curr.low) : 0

    const recency = Math.pow(RECENCY_DECAY, window.length - 1 - i)
    const tfWeight = TF_WEIGHT[nearest.tf] ?? 0.2

    if (wasAbove !== isAbove && bodyRatio > 0.3) {
      // Break: side flipped candle-to-candle with real conviction.
      breaks++
      testedTfs.add(nearest.tf)
      const sign = isAbove ? 1 : -1
      weightedSum += sign * tfWeight * 1.0 * recency
      weightUsed += tfWeight * 1.0 * recency
    } else if (wasAbove === isAbove && wickCrossed) {
      // Bounce: level was tested (wicked into) but held, same side as before.
      bounces++
      testedTfs.add(nearest.tf)
      const sign = isAbove ? 1 : -1
      weightedSum += sign * tfWeight * 0.5 * recency
      weightUsed += tfWeight * 0.5 * recency
    }
  }

  const score = weightUsed > 0 ? clamp(weightedSum / weightUsed) : 0
  const detail = weightUsed > 0
    ? `${bounces} bounce(s), ${breaks} break(s) on [${[...testedTfs].join(', ')}]`
    : 'no EMA/MA tests detected in window'

  return { name: 'EMA Bounce/Break', score, weight: 0.24, detail }
}

// ─── main entry ───────────────────────────────────────────────────────────

export function generateCandlePrediction(
  history: PredictionCandleInput[],
  params: PredictionParams,
): CandlePredictionResult {
  const pastN = Math.max(10, Math.min(params.pastCandles, history.length))
  const window = history.slice(-pastN)
  const closes = window.map(c => c.close)

  const logReturns: number[] = []
  for (let i = 1; i < closes.length; i++) logReturns.push(Math.log(closes[i] / closes[i - 1]))

  const driftPerCandle = mean(logReturns)
  let volatilityPerCandle = stdev(logReturns) || Math.abs(driftPerCandle) * 0.5 || 0.001

  // Recent exhaustion/absorption tends to precede choppier, wider-ranged
  // price action rather than a clean trend continuation — widen the
  // simulated volatility (up to +15%) proportionate to how much of the
  // last few candles show that stalling behavior.
  const recentWindow = window.slice(-Math.min(5, window.length))
  const stallingCount = recentWindow.filter(c => c.isBuyingExhaustion || c.isSellingExhaustion || c.isCandleInAbsorption).length
  const volatilityMultiplier = 1 + 0.15 * clamp(stallingCount / recentWindow.length, 0, 1)
  volatilityPerCandle *= volatilityMultiplier

  const factors: FactorScore[] = [
    scoreOpenInterest(window),
    scoreLongShortRatio(window),
    scoreCrossTfEma(window),
    scoreFlowMovement(window),
    scoreMomentum(logReturns),
    scoreExhaustionStructure(window),
    scoreEmaBounceBreak(window),
  ]
  const totalWeight = factors.reduce((a, f) => a + f.weight, 0)
  const compositeScore = clamp(factors.reduce((a, f) => a + f.score * f.weight, 0) / totalWeight)

  // Liquidity confidence modifier from the live spread — tighter spread → trust the projection more.
  const spreadPct = params.bidAskSpreadPercent
  const liquidityMultiplier = spreadPct == null ? 1 : clamp(1 - clamp(spreadPct / 0.15, 0, 1) * 0.35, 0.55, 1)

  // Bias the realized drift toward the composite factor score, scaled by
  // realized volatility so the nudge is proportionate to how noisy this
  // symbol/timeframe actually trades.
  const DRIFT_BIAS_STRENGTH = 0.6
  const adjustedDrift = driftPerCandle + compositeScore * volatilityPerCandle * DRIFT_BIAS_STRENGTH

  // Rough average true range %, used to shape simulated candle wicks.
  const avgRange = mean(window.map(c => c.high - c.low))
  const avgRangePct = closes.length ? avgRange / mean(closes) : 0.01

  const predictedN = Math.max(1, params.predictedCandles)
  const simulations = params.simulations ?? 500
  const lastClose = closes[closes.length - 1]
  const lastOpenTime = window[window.length - 1].openTime
  const intervalMs = params.intervalMs

  // Monte Carlo GBM: pathsClose[sim][step]
  const pathsClose: number[][] = []
  for (let s = 0; s < simulations; s++) {
    let price = lastClose
    const path: number[] = []
    for (let t = 0; t < predictedN; t++) {
      const r = adjustedDrift + volatilityPerCandle * gaussianRandom()
      price = price * Math.exp(r)
      path.push(price)
    }
    pathsClose.push(path)
  }

  const predictedCandles: PredictedCandle[] = []
  let prevClose = lastClose
  for (let t = 0; t < predictedN; t++) {
    const closesAtT = pathsClose.map(p => p[t])
    const medianClose = percentile(closesAtT, 0.5)
    const p25 = percentile(closesAtT, 0.25)
    const p75 = percentile(closesAtT, 0.75)
    const open = prevClose

    // Shape a plausible intra-candle range around the median move using the
    // window's realized ATR% plus light jitter so candles don't look
    // perfectly uniform.
    const rangeJitter = 0.7 + Math.random() * 0.6
    const range = Math.abs(medianClose * avgRangePct * rangeJitter)
    const high = Math.max(open, medianClose) + range * 0.5
    const low = Math.min(open, medianClose) - range * 0.5

    predictedCandles.push({
      openTime: lastOpenTime + intervalMs * (t + 1),
      open,
      high,
      low,
      close: medianClose,
      closeLow: p25,
      closeHigh: p75,
    })
    prevClose = medianClose
  }

  // Confidence blends (a) how many simulated paths agree on final direction,
  // and (b) how strong the composite factor score is, then discounts for a
  // wide live spread. 50 = coin flip, 100 = paths + factors fully agree.
  const finalCloses = pathsClose.map(p => p[p.length - 1])
  const pathsUp = finalCloses.filter(c => c > lastClose).length
  const pathAgreement = Math.max(pathsUp, simulations - pathsUp) / simulations // 0.5..1
  const rawConfidence = pathAgreement * 0.6 + (Math.abs(compositeScore) * 0.5 + 0.5) * 0.4
  const confidence = clamp(rawConfidence * liquidityMultiplier, 0, 1) * 100

  const direction: CandlePredictionResult['direction'] =
    Math.abs(compositeScore) < 0.08 ? 'NEUTRAL' : compositeScore > 0 ? 'LONG' : 'SHORT'

  // ── stretch the EMAs onto the predicted path ──────────────────────────
  // Standard incremental EMA200: ema_t = close_t*k + ema_{t-1}*(1-k), seeded
  // from the last known real EMA and stepped forward on the *median*
  // predicted close. The 1h/4h/1d lines are approximated on this same
  // 15m-resolution predicted series using their own k — a real 1h/4h/1d
  // candle only closes every 4/16/96 predicted candles, so treat these as a
  // smoothed continuation of the higher-TF trend rather than an exact
  // higher-TF EMA recompute.
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

  return {
    direction,
    confidence,
    compositeScore,
    factors,
    driftPerCandle,
    volatilityPerCandle,
    predictedCandles,
    emaProjections,
    simulations,
    pastCandlesUsed: pastN,
  }
}