// ─── Accumulation Analysis ──────────────────────────────────────────────────
// On-demand, single-symbol version of the accumulation scanner logic.
// Pulls OI history, taker buy/sell ratio, 24h ticker, and recent large trades
// from Binance USDⓈ-M Futures (public endpoints, no API key), then produces
// a plain-English read (matching the "BTCUSDT — Price flat, OI basically
// flat..." style) plus a long/short probability split.

export type AccumulationPattern =
  | 'Accumulation'
  | 'Distribution'
  | 'Momentum Long'
  | 'New Short Positioning'
  | 'Short Covering Rally'
  | 'Long Capitulation'
  | 'Neutral'
  | 'Thin Market'

export interface AccumulationAnalysisResult {
  symbol: string
  period: string
  lookback: number
  priceChangePct: number
  oiChangePct: number
  takerBuyRatio: number
  largeBuyNotional: number
  largeSellNotional: number
  quoteVolume24h: number
  lowLiquidity: boolean
  score: number
  pattern: AccumulationPattern
  narrative: string
  longProbability: number // 0-100
  shortProbability: number // 0-100
}

export interface AccumulationAnalysisOptions {
  period?: '5m' | '15m' | '1h' | '4h'
  lookback?: number
}

const BASE_URL = 'https://fapi.binance.com'
const LARGE_TRADE_USD_THRESHOLD = 100_000
const FLAT_PRICE_THRESHOLD_PCT = 3
const OI_RISE_THRESHOLD_PCT = 5
const TAKER_BUY_BIAS = 0.52
const MIN_24H_QUOTE_VOLUME_USD = 5_000_000

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  return res.json()
}

async function fetchOpenInterestHist(symbol: string, period: string, lookback: number) {
  const url = `${BASE_URL}/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${lookback}`
  return fetchJson(url) as Promise<Array<{ sumOpenInterest: string; timestamp: number }>>
}

async function fetchTakerRatioHist(symbol: string, period: string, lookback: number) {
  const url = `${BASE_URL}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=${lookback}`
  return fetchJson(url) as Promise<Array<{ buySellRatio: string; buyVol: string; sellVol: string }>>
}

async function fetchTicker24hr(symbol: string) {
  const url = `${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`
  return fetchJson(url) as Promise<{ priceChangePercent: string; quoteVolume: string }>
}

async function fetchRecentAggTrades(symbol: string) {
  const url = `${BASE_URL}/fapi/v1/aggTrades?symbol=${symbol}&limit=500`
  return fetchJson(url) as Promise<Array<{ p: string; q: string; m: boolean }>>
}

function computeLargeTradeNotionals(trades: Array<{ p: string; q: string; m: boolean }>) {
  let largeBuyNotional = 0
  let largeSellNotional = 0
  for (const t of trades) {
    const notional = parseFloat(t.p) * parseFloat(t.q)
    if (notional < LARGE_TRADE_USD_THRESHOLD) continue
    // m = true means buyer is the market maker -> the trade was an aggressive SELL hitting the bid
    if (t.m) {
      largeSellNotional += notional
    } else {
      largeBuyNotional += notional
    }
  }
  return { largeBuyNotional, largeSellNotional }
}

// ─── Score (same shape as the scanner, kept for consistency) ─────────────────

function computeScore(
  oiChangePct: number,
  takerBuyRatio: number,
  largeBuyNotional: number,
  largeSellNotional: number,
  lowLiquidity: boolean
): number {
  const liquidityDampener = lowLiquidity ? 0.1 : 1
  const oiComponent = oiChangePct
  const clampedLogRatio = Math.max(-2, Math.min(2, Math.log2(Math.max(takerBuyRatio, 0.01))))
  const takerComponent = clampedLogRatio * 10
  const largeTradeComponent = (largeBuyNotional - largeSellNotional) / 10_000
  return (oiComponent + takerComponent + largeTradeComponent) * liquidityDampener
}

// ─── Pattern classification ───────────────────────────────────────────────────
// Richer than the scanner's 3-way signal - this distinguishes *why* OI and
// price are moving together or apart, which is what actually separates
// "someone loading up quietly" from "a squeeze already happened."

function classifyPattern(
  priceChangePct: number,
  oiChangePct: number,
  takerBuyRatio: number,
  lowLiquidity: boolean
): AccumulationPattern {
  if (lowLiquidity) return 'Thin Market'

  const priceFlat = Math.abs(priceChangePct) < FLAT_PRICE_THRESHOLD_PCT
  const priceUp = priceChangePct >= FLAT_PRICE_THRESHOLD_PCT
  const priceDown = priceChangePct <= -FLAT_PRICE_THRESHOLD_PCT
  const oiRising = oiChangePct > OI_RISE_THRESHOLD_PCT
  const oiFalling = oiChangePct < -OI_RISE_THRESHOLD_PCT
  const buyBias = takerBuyRatio > TAKER_BUY_BIAS
  const sellBias = takerBuyRatio < 1 / TAKER_BUY_BIAS - 1

  if (priceFlat && oiRising && buyBias) return 'Accumulation'
  if (priceFlat && oiRising && sellBias) return 'Distribution'
  if (priceUp && oiRising) return 'Momentum Long'
  if (priceDown && oiRising) return 'New Short Positioning'
  if (priceUp && oiFalling) return 'Short Covering Rally'
  if (priceDown && oiFalling) return 'Long Capitulation'
  return 'Neutral'
}

// ─── Long/short probability ───────────────────────────────────────────────────
// Combines three normalized signals into a single -1..+1 directional score,
// then maps it to a probability split. Thin markets get pulled hard toward
// 50/50 since the underlying ratios aren't trustworthy at that volume.

function computeDirectionalProbability(
  priceChangePct: number,
  oiChangePct: number,
  takerBuyRatio: number,
  largeBuyNotional: number,
  largeSellNotional: number,
  lowLiquidity: boolean
): { longProbability: number; shortProbability: number } {
  const takerSignal = Math.max(-1, Math.min(1, Math.log2(Math.max(takerBuyRatio, 0.01)) / 2))

  const totalLarge = largeBuyNotional + largeSellNotional
  const largeTradeSignal = totalLarge > 0 ? (largeBuyNotional - largeSellNotional) / totalLarge : 0

  const priceFlat = Math.abs(priceChangePct) < FLAT_PRICE_THRESHOLD_PCT
  const priceUp = priceChangePct > 0
  const oiRising = oiChangePct > OI_RISE_THRESHOLD_PCT
  const oiFalling = oiChangePct < -OI_RISE_THRESHOLD_PCT
  const buyBias = takerBuyRatio > TAKER_BUY_BIAS

  let oiPriceSignal = 0
  if (oiRising) {
    if (priceFlat) {
      oiPriceSignal = buyBias ? 0.8 : -0.8 // accumulation / distribution - strongest signal
    } else if (priceUp) {
      oiPriceSignal = 0.5 // longs chasing an already-moving market - real but late
    } else {
      oiPriceSignal = -1 // fresh shorts opening into a drop - strongest bearish signal
    }
  } else if (oiFalling) {
    oiPriceSignal = priceUp ? -0.3 : 0.3 // covering rally (fade risk) / capitulation (contrarian, weak)
  }

  let directional = oiPriceSignal * 0.5 + takerSignal * 0.3 + largeTradeSignal * 0.2

  if (lowLiquidity) {
    directional *= 0.2 // pull hard toward 50/50 - thin data isn't trustworthy
  }

  directional = Math.max(-1, Math.min(1, directional))

  // clamp final probability to 5-95 - never claim near-certainty from this kind of signal
  const longProbability = Math.max(5, Math.min(95, 50 + directional * 50))
  return {
    longProbability: Math.round(longProbability * 10) / 10,
    shortProbability: Math.round((100 - longProbability) * 10) / 10,
  }
}

// ─── Narrative ─────────────────────────────────────────────────────────────

function formatUsd(val: number): string {
  if (val === 0) return '$0'
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

function buildNarrative(result: Omit<AccumulationAnalysisResult, 'narrative'>): string {
  const {
    symbol,
    priceChangePct,
    oiChangePct,
    takerBuyRatio,
    largeBuyNotional,
    largeSellNotional,
    lowLiquidity,
    pattern,
  } = result

  if (lowLiquidity) {
    return (
      `${symbol} — 24h quote volume is below the $${(MIN_24H_QUOTE_VOLUME_USD / 1_000_000).toFixed(0)}M ` +
      `liquidity floor, so the taker ratio (${takerBuyRatio.toFixed(2)}) and OI % change (${oiChangePct.toFixed(2)}%) ` +
      `are likely noise from thin order flow rather than real positioning. Treat this read as unreliable.`
    )
  }

  const priceDesc =
    Math.abs(priceChangePct) < FLAT_PRICE_THRESHOLD_PCT
      ? 'flat'
      : priceChangePct > 0
        ? `up ${priceChangePct.toFixed(2)}%`
        : `down ${Math.abs(priceChangePct).toFixed(2)}%`

  const oiDesc =
    oiChangePct > OI_RISE_THRESHOLD_PCT
      ? `rising (+${oiChangePct.toFixed(2)}%)`
      : oiChangePct < -OI_RISE_THRESHOLD_PCT
        ? `falling (${oiChangePct.toFixed(2)}%)`
        : `roughly flat (${oiChangePct.toFixed(2)}%)`

  const netLargeTrade = largeBuyNotional - largeSellNotional
  const hasLargeTrades = largeBuyNotional > 0 || largeSellNotional > 0
  const largeTradeDesc = hasLargeTrades
    ? `a ${netLargeTrade >= 0 ? 'net buy' : 'net sell'} skew of ${formatUsd(Math.abs(netLargeTrade))} ` +
      `(${formatUsd(largeBuyNotional)} buy vs ${formatUsd(largeSellNotional)} sell in trades over $${(LARGE_TRADE_USD_THRESHOLD / 1000).toFixed(0)}K)`
    : 'no trades large enough to register'

  const base = `${symbol} — Price ${priceDesc}, OI ${oiDesc}, taker buy ratio ${takerBuyRatio.toFixed(3)}, with ${largeTradeDesc}.`

  const conclusions: Record<AccumulationPattern, string> = {
    Accumulation:
      ' Price steady while OI and buy pressure both build is the classic quiet-loading-up pattern — someone is opening new longs without moving the market yet.',
    Distribution:
      ' Price steady while OI builds and sell pressure dominates suggests new shorts are being opened quietly, or size is being unloaded without spooking price yet.',
    'Momentum Long':
      ' This is a coin that already moved, with OI confirming fresh longs chasing the trend — momentum continuation, not stealth accumulation. Getting in here means buying after the move, not before it.',
    'New Short Positioning':
      ' Price dropping while OI rises means new short positions are being opened aggressively into the decline — conviction selling, or the early stage of a liquidation cascade. Worth checking the chart for capitulation.',
    'Short Covering Rally':
      ' Price rising while OI falls means the move is being driven by shorts closing out, not fresh longs. These rallies can fade once the covering is done since there is no new buying underneath.',
    'Long Capitulation':
      ' Price falling while OI falls means longs are being stopped out or closing voluntarily. Contrarian read: selling pressure may be closer to exhausted than a fresh-short scenario would suggest, but this is a weak signal.',
    Neutral:
      ' None of the price/OI/taker legs are strongly aligned right now — no clear positioning story either way.',
    'Thin Market': '',
  }

  return base + conclusions[pattern]
}

// ─── OI rate over an arbitrary time range (for FRVP integration) ─────────────
// Unlike runAccumulationAnalysis (which looks back N bars from "now"), this
// fetches OI history for an exact [startTime, endTime] window - e.g. the
// span of a Fixed Range Volume Profile selection - and reports the rate of
// change across it. Binance's period buckets are fixed sizes, so the bucket
// is picked based on the window length to keep resolution reasonable while
// staying under the endpoint's 500-point limit.

export interface OpenInterestRangeRate {
  startOi: number
  endOi: number
  oiChangeAbs: number
  oiChangePct: number
  ratePerHour: number // % change per hour, normalized so ranges of different lengths are comparable
  period: string
  pointCount: number
}

function pickPeriodForRange(durationMs: number): '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' {
  const hours = durationMs / 3_600_000
  if (hours <= 2) return '5m'
  if (hours <= 6) return '15m'
  if (hours <= 12) return '30m'
  if (hours <= 24) return '1h'
  if (hours <= 24 * 3) return '2h'
  if (hours <= 24 * 7) return '4h'
  if (hours <= 24 * 21) return '12h'
  return '1d'
}

/**
 * Fetches OI history spanning [startTime, endTime] (ms epoch) and returns the
 * change across that exact window. Returns null if Binance has no OI data
 * covering that range (e.g. range predates when OI history is retained for
 * that symbol, which is typically a much shorter window than kline history).
 */
export async function getOpenInterestRateForRange(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<OpenInterestRangeRate | null> {
  const period = pickPeriodForRange(endTime - startTime)
  const upperSymbol = symbol.toUpperCase()
  const url = `${BASE_URL}/futures/data/openInterestHist?symbol=${upperSymbol}&period=${period}&startTime=${startTime}&endTime=${endTime}&limit=500`
  const data = (await fetchJson(url)) as Array<{ sumOpenInterest: string; timestamp: number }>

  if (!data.length) return null

  const startOi = parseFloat(data[0].sumOpenInterest)
  const endOi = parseFloat(data[data.length - 1].sumOpenInterest)
  const oiChangeAbs = endOi - startOi
  const oiChangePct = startOi === 0 ? 0 : (oiChangeAbs / startOi) * 100
  const durationHours = (endTime - startTime) / 3_600_000
  const ratePerHour = durationHours > 0 ? oiChangePct / durationHours : 0

  return {
    startOi,
    endOi,
    oiChangeAbs,
    oiChangePct,
    ratePerHour,
    period,
    pointCount: data.length,
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAccumulationAnalysis(
  symbol: string,
  options: AccumulationAnalysisOptions = {}
): Promise<AccumulationAnalysisResult> {
  const period = options.period ?? '5m'
  const lookback = options.lookback ?? 24
  const upperSymbol = symbol.toUpperCase()

  const [oiHist, takerHist, ticker, trades] = await Promise.all([
    fetchOpenInterestHist(upperSymbol, period, lookback),
    fetchTakerRatioHist(upperSymbol, period, lookback),
    fetchTicker24hr(upperSymbol),
    fetchRecentAggTrades(upperSymbol),
  ])

  if (!oiHist.length || !takerHist.length) {
    throw new Error(`Insufficient history data for ${upperSymbol}`)
  }

  const firstOi = parseFloat(oiHist[0].sumOpenInterest)
  const lastOi = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest)
  const oiChangePct = firstOi === 0 ? 0 : ((lastOi - firstOi) / firstOi) * 100

  const takerBuyRatio =
    takerHist.reduce((sum, t) => sum + parseFloat(t.buySellRatio), 0) / takerHist.length

  const priceChangePct = parseFloat(ticker.priceChangePercent)
  const quoteVolume24h = parseFloat(ticker.quoteVolume)
  const lowLiquidity = quoteVolume24h < MIN_24H_QUOTE_VOLUME_USD

  const { largeBuyNotional, largeSellNotional } = computeLargeTradeNotionals(trades)

  const score = computeScore(oiChangePct, takerBuyRatio, largeBuyNotional, largeSellNotional, lowLiquidity)
  const pattern = classifyPattern(priceChangePct, oiChangePct, takerBuyRatio, lowLiquidity)
  const { longProbability, shortProbability } = computeDirectionalProbability(
    priceChangePct,
    oiChangePct,
    takerBuyRatio,
    largeBuyNotional,
    largeSellNotional,
    lowLiquidity
  )

  const partial = {
    symbol: upperSymbol,
    period,
    lookback,
    priceChangePct,
    oiChangePct,
    takerBuyRatio,
    largeBuyNotional,
    largeSellNotional,
    quoteVolume24h,
    lowLiquidity,
    score,
    pattern,
    longProbability,
    shortProbability,
  }

  return {
    ...partial,
    narrative: buildNarrative(partial),
  }
}