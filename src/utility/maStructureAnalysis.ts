// maStructureAnalysis.ts
// Pure, framework-agnostic MA-structure analysis. No fetching, no Vue —
// safe to call from a computed() (MAStructureAnalysisComponent) or from a
// plain sequential loop (BestMACrossingScanComponent's post-scan pass).

export interface MaRow {
  openTime: number
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  ma200_15m: number | null
  ma200_1h: number | null
  ma200_4h: number | null
  ma200_1d: number | null
}

export interface MaCapturePayload {
  symbol: string
  baseInterval: string
  maPeriod: number
  maIntervals: string[]
  generatedAt: string
  period: { candles: number; from: string | null; to: string | null }
  data: MaRow[]
}

export interface Scenario {
  entry: number; entryReason: string
  stop: number; stopReason: string
  target: number; targetReason: string
  rr: number
}

export type ConvictionLevel = 'High' | 'Moderate' | 'Low'

export interface StructureNode { key: string; label: string; color: string; value: number }

export interface StructureResult {
  order: StructureNode[]
  alignmentLabel: string
  alignmentClass: 'bullish' | 'bearish' | 'neutral'
  reasoning: string[]
}

export interface SqueezeResult {
  currentPct: number
  startPct: number
  trendLabel: string
  state: 'SQUEEZE' | 'EXPANSION' | 'NEUTRAL'
  stateClass: 'squeeze' | 'expansion' | 'neutral'
  rangeLabel: string
  narrative: string
}

// ── Volume trend ─────────────────────────────────────────────────────────────
// Derived entirely from the candles already in the payload — no extra fetch.
export interface VolumeResult {
  currentAvg: number
  priorAvg: number
  changePct: number
  trendLabel: 'Rising' | 'Falling' | 'Flat'
  upVolumeAvg: number
  downVolumeAvg: number
  /** which side (up-candles vs down-candles) has carried more volume recently */
  volumeBias: 'bullish' | 'bearish' | 'neutral'
  windowSize: number
  narrative: string
}

// ── Liquidity / bid-ask spread ──────────────────────────────────────────────
// NOT derivable from historical candles — this is live order-book data, so it
// only appears in the result when the caller explicitly supplies it.
export interface OrderBookSnapshot {
  bidPrice: number
  askPrice: number
}

export interface LiquidityResult {
  bidPrice: number
  askPrice: number
  spreadAbs: number
  spreadPct: number
  state: 'TIGHT' | 'NORMAL' | 'WIDE'
  narrative: string
}

export interface ConvictionResult {
  long: ConvictionLevel
  short: ConvictionLevel
  noTrade: ConvictionLevel
  reasoning: string[]
  ambiguous: boolean
}

export interface MaAnalysisOptions {
  swingLookback?: number
  stopBufferPct?: number
  squeezeThresholdPct?: number
  expansionThresholdPct?: number
  /** number of trailing candles averaged for the volume-trend read (default 20) */
  volumeWindow?: number
  /** spread % at/below which liquidity is considered tight (default 0.02%) */
  tightSpreadPct?: number
  /** spread % at/above which liquidity is considered wide (default 0.1%) */
  wideSpreadPct?: number
  /** live bid/ask snapshot — optional, since it isn't part of the historical payload */
  orderBook?: OrderBookSnapshot
}

export interface MaAnalysisResult {
  structure: StructureResult
  squeeze: SqueezeResult
  volume: VolumeResult
  liquidity: LiquidityResult | null
  longScenario: Scenario | null
  shortScenario: Scenario | null
  conviction: ConvictionResult
  invalidation: string[]
}

type MaKey = '15m' | '1h' | '4h' | '1d'
const MA_META: { key: MaKey; label: string; color: string; field: keyof MaRow }[] = [
  { key: '15m', label: '15m', color: '#64b5f6', field: 'ma200_15m' },
  { key: '1h', label: '1h', color: '#ffb74d', field: 'ma200_1h' },
  { key: '4h', label: '4h', color: '#ba68c8', field: 'ma200_4h' },
  { key: '1d', label: '1d', color: '#4ade80', field: 'ma200_1d' },
]

function formatPrice(v: number): string {
  if (v >= 1000) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toFixed(6)
}

function lastMaValue(rows: MaRow[], field: keyof MaRow): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][field] as number | null
    if (v !== null) return v
  }
  return null
}

function firstMaValue(rows: MaRow[], field: keyof MaRow): number | null {
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][field] as number | null
    if (v !== null) return v
  }
  return null
}

function computeStructure(rows: MaRow[], price: number): StructureResult {
  const order: StructureNode[] = []
  for (const ma of MA_META) {
    const v = lastMaValue(rows, ma.field)
    if (v !== null) order.push({ key: ma.key, label: `${ma.label} MA`, color: ma.color, value: v })
  }
  if (rows.length) order.push({ key: 'price', label: 'Price', color: '#ffffff', value: price })
  order.sort((a, b) => b.value - a.value)

  const aboveCount = MA_META.filter((ma) => {
    const v = lastMaValue(rows, ma.field)
    return v !== null && price > v
  }).length
  const risingCount = MA_META.filter((ma) => {
    const last = lastMaValue(rows, ma.field)
    const first = firstMaValue(rows, ma.field)
    return last !== null && first !== null && last > first
  }).length
  const validMaCount = MA_META.filter((ma) => lastMaValue(rows, ma.field) !== null).length

  let alignmentLabel = 'Mixed / Conflicting'
  let alignmentClass: StructureResult['alignmentClass'] = 'neutral'
  if (validMaCount === MA_META.length) {
    if (aboveCount === MA_META.length && risingCount === MA_META.length) {
      alignmentLabel = 'Fully Aligned Bullish'
      alignmentClass = 'bullish'
    } else if (aboveCount === 0 && risingCount === 0) {
      alignmentLabel = 'Fully Aligned Bearish'
      alignmentClass = 'bearish'
    }
  }

  const reasoning: string[] = []
  reasoning.push(
    `Price (${formatPrice(price)}) is above ${aboveCount} of ${validMaCount} 200-MAs, and ${risingCount} of ${validMaCount} MAs have risen since the start of this window.`
  )
  for (const ma of MA_META) {
    const last = lastMaValue(rows, ma.field)
    const first = firstMaValue(rows, ma.field)
    if (last === null || first === null) continue
    const dir = last > first ? 'rising' : last < first ? 'declining' : 'flat'
    const side = price > last ? 'above' : 'below'
    reasoning.push(`${ma.label} MA is ${dir} over the window (${formatPrice(first)} → ${formatPrice(last)}); price is currently ${side} it.`)
  }
  if (alignmentClass === 'neutral') {
    reasoning.push('Because timeframes disagree (some MAs rising while price sits on the wrong side of another, typically the slower one), treat this as a genuine cross-timeframe conflict rather than a clean trend.')
  }

  return { order, alignmentLabel, alignmentClass, reasoning }
}

function computeSqueeze(rows: MaRow[], squeezeThresholdPct: number, expansionThresholdPct: number): SqueezeResult {
  const spreadSeries = rows.map((r) => {
    const vals = MA_META.map((ma) => r[ma.field] as number | null).filter((v): v is number => v !== null)
    if (vals.length < MA_META.length || !r.close) return null
    return ((Math.max(...vals) - Math.min(...vals)) / r.close) * 100
  })

  const validIdx: number[] = []
  spreadSeries.forEach((v, i) => { if (v !== null) validIdx.push(i) })

  const currentPct = validIdx.length ? (spreadSeries[validIdx[validIdx.length - 1]] as number) : 0
  const startPct = validIdx.length ? (spreadSeries[validIdx[0]] as number) : 0
  const deltaPct = currentPct - startPct
  const trendLabel = Math.abs(deltaPct) < 0.05 ? 'Flat' : deltaPct < 0 ? 'Narrowing' : 'Widening'

  let state: SqueezeResult['state'] = 'NEUTRAL'
  let stateClass: SqueezeResult['stateClass'] = 'neutral'
  if (currentPct < squeezeThresholdPct) {
    state = 'SQUEEZE'
    stateClass = 'squeeze'
  } else if (currentPct > expansionThresholdPct) {
    state = 'EXPANSION'
    stateClass = 'expansion'
  }

  const rangeCandles = validIdx.length ? validIdx[validIdx.length - 1] - validIdx[0] : 0
  const rangeLabel = rangeCandles > 0 ? `${rangeCandles} candles` : 'window start'

  let narrative = ''
  if (state === 'SQUEEZE') {
    narrative = `MAs are bunched tight (${currentPct.toFixed(2)}% spread) — this often precedes a breakout, but doesn't say which direction.`
  } else if (state === 'EXPANSION') {
    narrative = `MAs are spread wide apart (${currentPct.toFixed(2)}% spread) — the trend is already extended, which raises reversion risk rather than signaling a fresh breakout.`
  } else {
    narrative = `Spread sits between the squeeze and expansion thresholds (${currentPct.toFixed(2)}%) — no strong compression or extension signal on its own.`
  }
  narrative += ` It has been ${trendLabel.toLowerCase()} over the captured window (${startPct.toFixed(2)}% → ${currentPct.toFixed(2)}%), so weight the current reading against that trend rather than in isolation.`

  return { currentPct, startPct, trendLabel, state, stateClass, rangeLabel, narrative }
}

// ── Volume trend ─────────────────────────────────────────────────────────────
function average(rows: MaRow[]): number {
  return rows.length ? rows.reduce((s, r) => s + r.volume, 0) / rows.length : 0
}

function computeVolume(rows: MaRow[], windowSize: number): VolumeResult {
  const window = Math.max(1, Math.min(windowSize, Math.floor(rows.length / 2) || rows.length))
  const recent = rows.slice(-window)
  const priorSlice = rows.slice(-window * 2, -window)
  const prior = priorSlice.length ? priorSlice : recent

  const currentAvg = average(recent)
  const priorAvg = average(prior)
  const changePct = priorAvg ? ((currentAvg - priorAvg) / priorAvg) * 100 : 0
  const trendLabel: VolumeResult['trendLabel'] = Math.abs(changePct) < 5 ? 'Flat' : changePct > 0 ? 'Rising' : 'Falling'

  const upCandles = recent.filter((r) => r.close >= r.open)
  const downCandles = recent.filter((r) => r.close < r.open)
  const upVolumeAvg = average(upCandles)
  const downVolumeAvg = average(downCandles)

  let volumeBias: VolumeResult['volumeBias'] = 'neutral'
  if (upVolumeAvg > downVolumeAvg * 1.15) volumeBias = 'bullish'
  else if (downVolumeAvg > upVolumeAvg * 1.15) volumeBias = 'bearish'

  let narrative = `Average volume over the last ${recent.length} candles is ${trendLabel.toLowerCase()} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% vs the prior ${prior.length} candles).`
  if (volumeBias === 'neutral') {
    narrative += ' Volume is roughly balanced between up and down candles, so it offers no clear directional confirmation right now.'
  } else {
    narrative += ` Volume has been skewed toward ${volumeBias === 'bullish' ? 'up' : 'down'} candles recently, which leans ${volumeBias}.`
  }

  return { currentAvg, priorAvg, changePct, trendLabel, upVolumeAvg, downVolumeAvg, volumeBias, windowSize: recent.length, narrative }
}

// ── Liquidity / bid-ask spread ──────────────────────────────────────────────
function computeLiquidity(orderBook: OrderBookSnapshot | undefined, tightSpreadPct: number, wideSpreadPct: number): LiquidityResult | null {
  if (!orderBook) return null
  const { bidPrice, askPrice } = orderBook
  if (!bidPrice || !askPrice || askPrice <= bidPrice) return null

  const spreadAbs = askPrice - bidPrice
  const mid = (askPrice + bidPrice) / 2
  const spreadPct = mid ? (spreadAbs / mid) * 100 : 0

  let state: LiquidityResult['state'] = 'NORMAL'
  if (spreadPct <= tightSpreadPct) state = 'TIGHT'
  else if (spreadPct >= wideSpreadPct) state = 'WIDE'

  let narrative = `Bid/ask spread is ${spreadPct.toFixed(3)}% (bid ${formatPrice(bidPrice)} / ask ${formatPrice(askPrice)}).`
  if (state === 'WIDE') {
    narrative += ' That is wide enough to add meaningful slippage risk on entry and exit — treat any conviction read here with extra caution and consider smaller size or limit orders.'
  } else if (state === 'TIGHT') {
    narrative += ' That is tight, so execution risk from the spread itself is minimal.'
  } else {
    narrative += ' That is a normal spread — a modest execution cost, but not a major concern on its own.'
  }

  return { bidPrice, askPrice, spreadAbs, spreadPct, state, narrative }
}

interface Swing { index: number; price: number; time: string }

function findSwingLows(rows: MaRow[], lookback: number): Swing[] {
  const out: Swing[] = []
  for (let i = lookback; i < rows.length - lookback; i++) {
    const low = rows[i].low
    let isSwing = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && rows[j].low < low) { isSwing = false; break }
    }
    if (isSwing) out.push({ index: i, price: low, time: rows[i].time })
  }
  return out
}

function findSwingHighs(rows: MaRow[], lookback: number): Swing[] {
  const out: Swing[] = []
  for (let i = lookback; i < rows.length - lookback; i++) {
    const high = rows[i].high
    let isSwing = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && rows[j].high > high) { isSwing = false; break }
    }
    if (isSwing) out.push({ index: i, price: high, time: rows[i].time })
  }
  return out
}

function nearestMaBelow(rows: MaRow[], price: number): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null
  for (const ma of MA_META) {
    const v = lastMaValue(rows, ma.field)
    if (v === null || v >= price) continue
    if (!best || v > best.value) best = { label: `${ma.label} MA`, value: v }
  }
  return best
}

function nearestMaAbove(rows: MaRow[], price: number): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null
  for (const ma of MA_META) {
    const v = lastMaValue(rows, ma.field)
    if (v === null || v <= price) continue
    if (!best || v < best.value) best = { label: `${ma.label} MA`, value: v }
  }
  return best
}

function computeLongScenario(rows: MaRow[], price: number, swingLookback: number, stopBufferPct: number): Scenario | null {
  const support = nearestMaBelow(rows, price)
  const entry = support ? support.value : price
  const entryReason = support ? `pullback to ${support.label}` : 'market — price already below every 200MA'

  const candidateLows = findSwingLows(rows, swingLookback).filter((s) => s.price < entry)
  const lowSwing = candidateLows.length ? candidateLows[candidateLows.length - 1] : null
  if (!lowSwing) return null
  const stop = lowSwing.price * (1 - stopBufferPct / 100)
  const stopReason = `below swing low at ${formatPrice(lowSwing.price)} (${new Date(lowSwing.time).toLocaleString()})`

  const highsAbove = findSwingHighs(rows, swingLookback).filter((s) => s.price > entry)
  const targetSwing = highsAbove.length ? highsAbove.reduce((a, b) => (a.price > b.price ? a : b)) : null
  const target = targetSwing ? targetSwing.price : Math.max(...rows.map((r) => r.high))
  const targetReason = targetSwing ? `prior swing high at ${formatPrice(target)}` : 'highest high in the captured window'

  const risk = entry - stop
  const reward = target - entry
  if (risk <= 0 || reward <= 0) return null
  return { entry, entryReason, stop, stopReason, target, targetReason, rr: reward / risk }
}

function computeShortScenario(rows: MaRow[], price: number, swingLookback: number, stopBufferPct: number): Scenario | null {
  const resistance = nearestMaAbove(rows, price)
  const entry = resistance ? resistance.value : price
  const entryReason = resistance ? `retest of ${resistance.label}` : 'market — price already above every 200MA'

  const candidateHighs = findSwingHighs(rows, swingLookback).filter((s) => s.price > entry)
  const highSwing = candidateHighs.length ? candidateHighs[candidateHighs.length - 1] : null
  if (!highSwing) return null
  const stop = highSwing.price * (1 + stopBufferPct / 100)
  const stopReason = `above swing high at ${formatPrice(highSwing.price)} (${new Date(highSwing.time).toLocaleString()})`

  const lowsBelow = findSwingLows(rows, swingLookback).filter((s) => s.price < entry)
  const targetSwing = lowsBelow.length ? lowsBelow.reduce((a, b) => (a.price < b.price ? a : b)) : null
  const target = targetSwing ? targetSwing.price : Math.min(...rows.map((r) => r.low))
  const targetReason = targetSwing ? `prior swing low at ${formatPrice(target)}` : 'lowest low in the captured window'

  const risk = stop - entry
  const reward = entry - target
  if (risk <= 0 || reward <= 0) return null
  return { entry, entryReason, stop, stopReason, target, targetReason, rr: reward / risk }
}

function computeConviction(
  structure: StructureResult,
  squeeze: SqueezeResult,
  longScenario: Scenario | null,
  shortScenario: Scenario | null,
  volume: VolumeResult,
  liquidity: LiquidityResult | null
): ConvictionResult {
  const align = structure.alignmentClass
  const rrOk = (s: Scenario | null) => !!s && s.rr >= 2

  let long: ConvictionLevel = 'Low'
  let short: ConvictionLevel = 'Low'
  const reasoning: string[] = []

  if (align === 'bullish') {
    long = rrOk(longScenario) ? 'High' : 'Moderate'
    short = 'Low'
    reasoning.push('Timeframes are fully aligned bullish (price above every 200MA, all MAs rising), which favors longs over shorts.')
  } else if (align === 'bearish') {
    short = rrOk(shortScenario) ? 'High' : 'Moderate'
    long = 'Low'
    reasoning.push('Timeframes are fully aligned bearish (price below every 200MA, all MAs falling), which favors shorts over longs.')
  } else {
    long = 'Moderate'
    short = 'Moderate'
    reasoning.push('Timeframes are mixed — some MAs support the trend, at least one conflicts (commonly the slowest, 1d MA). Neither direction has full structural backing.')
  }

  if (squeeze.state === 'EXPANSION') {
    reasoning.push('MAs are already in an expansion / extended state, which raises reversion risk and caps conviction on a fresh entry in the direction of the existing move.')
  } else if (squeeze.state === 'SQUEEZE') {
    reasoning.push('MAs are compressed (squeeze), which raises the odds of a breakout but does not indicate direction on its own — do not treat the squeeze itself as directional.')
  }

  if (!rrOk(longScenario)) reasoning.push('The long plan does not clear a 2:1 risk:reward, which caps long conviction regardless of structure.')
  if (!rrOk(shortScenario)) reasoning.push('The short plan does not clear a 2:1 risk:reward, which caps short conviction regardless of structure.')

  // ── Volume confirmation / divergence ────────────────────────────────────
  if (align === 'bullish') {
    if (volume.volumeBias === 'bullish') {
      reasoning.push('Recent volume is skewed toward up candles, which supports the bullish alignment.')
    } else if (volume.volumeBias === 'bearish') {
      reasoning.push('Recent volume is actually skewed toward down candles despite the bullish MA alignment — a divergence worth weighing against the long case.')
      if (long === 'High') long = 'Moderate'
    }
  } else if (align === 'bearish') {
    if (volume.volumeBias === 'bearish') {
      reasoning.push('Recent volume is skewed toward down candles, which supports the bearish alignment.')
    } else if (volume.volumeBias === 'bullish') {
      reasoning.push('Recent volume is actually skewed toward up candles despite the bearish MA alignment — a divergence worth weighing against the short case.')
      if (short === 'High') short = 'Moderate'
    }
  }
  if (volume.trendLabel === 'Falling') {
    reasoning.push('Overall volume has been falling, which is a mild caution flag regardless of direction — moves on thinning volume are more prone to stalling or reversing.')
  }

  // ── Liquidity / spread ───────────────────────────────────────────────────
  if (liquidity) {
    if (liquidity.state === 'WIDE') {
      reasoning.push('The bid/ask spread is wide, adding real execution risk — this caps conviction on both sides regardless of the structural read.')
      if (long === 'High') long = 'Moderate'
      if (short === 'High') short = 'Moderate'
    } else if (liquidity.state === 'TIGHT') {
      reasoning.push('The bid/ask spread is tight, so execution risk is not a meaningful factor here.')
    }
  }

  const ambiguous = align === 'neutral' || (long === 'Low' && short === 'Low')
  const noTrade: ConvictionLevel = ambiguous ? 'High' : 'Low'
  if (ambiguous) reasoning.push('Because of the conflicting signals above, "no trade / wait for confirmation" is a legitimate stance here, not just a hedge.')

  return { long, short, noTrade, reasoning, ambiguous }
}

function computeInvalidation(
  rows: MaRow[],
  price: number,
  squeeze: SqueezeResult,
  squeezeThresholdPct: number,
  volume: VolumeResult,
  liquidity: LiquidityResult | null
): string[] {
  const lines: string[] = []
  const support = nearestMaBelow(rows, price)
  const resistance = nearestMaAbove(rows, price)
  if (support) lines.push(`Invalidates the bullish/long read: a 15m close below ${formatPrice(support.value)} (${support.label}) — the nearest short-term support giving way.`)
  if (resistance) lines.push(`Invalidates the bearish/short read: a 15m close above ${formatPrice(resistance.value)} (${resistance.label}) — the nearest overhead resistance being reclaimed.`)
  if (squeeze.state !== 'SQUEEZE') {
    lines.push(`Would flag a fresh squeeze setup worth re-checking: MA spread compressing well below ${squeezeThresholdPct.toFixed(1)}% while price also tightens its range.`)
  }
  if (volume.volumeBias !== 'neutral') {
    const opposite = volume.volumeBias === 'bullish' ? 'bearish' : 'bullish'
    lines.push(`Volume is currently skewed ${volume.volumeBias}; a sustained flip toward ${opposite}-skewed volume would undercut the current volume read.`)
  }
  if (liquidity && liquidity.state === 'WIDE') {
    lines.push(`The bid/ask spread is already wide (${liquidity.spreadPct.toFixed(3)}%); if it widens further, execution cost alone may make any entry impractical.`)
  }
  return lines
}

/**
 * Runs the full read against a capture payload: market structure, squeeze/
 * expansion, volume trend, liquidity (if an order-book snapshot is supplied),
 * long/short scenarios, conviction, and invalidation.
 * Pure / synchronous — safe to call from a computed() or a plain loop.
 */
export function analyzeMaStructure(payload: MaCapturePayload, options: MaAnalysisOptions = {}): MaAnalysisResult {
  const {
    swingLookback = 3,
    stopBufferPct = 0.15,
    squeezeThresholdPct = 3,
    expansionThresholdPct = 10,
    volumeWindow = 20,
    tightSpreadPct = 0.02,
    wideSpreadPct = 0.1,
    orderBook,
  } = options

  const rows = payload?.data ?? []
  const lastRow = rows[rows.length - 1] ?? null
  const price = lastRow?.close ?? 0

  const structure = computeStructure(rows, price)
  const squeeze = computeSqueeze(rows, squeezeThresholdPct, expansionThresholdPct)
  const volume = computeVolume(rows, volumeWindow)
  const liquidity = computeLiquidity(orderBook, tightSpreadPct, wideSpreadPct)
  const longScenario = computeLongScenario(rows, price, swingLookback, stopBufferPct)
  const shortScenario = computeShortScenario(rows, price, swingLookback, stopBufferPct)
  const conviction = computeConviction(structure, squeeze, longScenario, shortScenario, volume, liquidity)
  const invalidation = computeInvalidation(rows, price, squeeze, squeezeThresholdPct, volume, liquidity)

  return { structure, squeeze, volume, liquidity, longScenario, shortScenario, conviction, invalidation }
}