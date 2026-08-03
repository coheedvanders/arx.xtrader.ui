// maCapturePayload.ts
// Builds the same OHLCV + 200MA(15m/1h/4h/1d) capture payload shape that
// MACrossingVisualizerComponent's Data Capture panel exports — reusable by
// anything that needs to feed analyzeMaStructure() straight from Binance.
import { KlineUtility } from '@/utility/klineUtility'
import type { MaCapturePayload, MaRow } from './maStructureAnalysis'

interface RawCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const MA_PERIOD = 200
const MS_15M = 15 * 60 * 1000

const MA_INTERVALS: { key: '15m' | '1h' | '4h' | '1d'; intervalMs: number }[] = [
  { key: '15m', intervalMs: MS_15M },
  { key: '1h', intervalMs: 60 * 60 * 1000 },
  { key: '4h', intervalMs: 4 * 60 * 60 * 1000 },
  { key: '1d', intervalMs: 24 * 60 * 60 * 1000 },
]

// small gap between each of the 4 timeframe requests for a single symbol —
// separate from the caller's own inter-symbol delay. Set to 0 if
// KlineUtility already rate-limits internally.
const TIMEFRAME_FETCH_DELAY_MS = 150

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rollingSma(candles: RawCandle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null)
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

// same coverage math as MACrossingVisualizerComponent's requiredLimit()
function requiredLimit(displayCandles: number, intervalMs: number): number {
  const windowMs = displayCandles * MS_15M
  const coverage = Math.ceil(windowMs / intervalMs)
  return Math.min(1500, coverage + MA_PERIOD + 10)
}

/**
 * Fetches 15m/1h/4h/1d candles for `symbol` SEQUENTIALLY (no Promise.all —
 * one request at a time, matching the scanner's own rate-limiting style),
 * computes each timeframe's own rolling 200 SMA, and maps all four onto the
 * most recent `displayCandles` 15m candles.
 */
export async function buildMaCapturePayload(symbol: string, displayCandles: number): Promise<MaCapturePayload> {
  const sym = symbol.toUpperCase()

  const rawCandles: Record<string, RawCandle[]> = {}
  const rawMa: Record<string, (number | null)[]> = {}

  for (const ma of MA_INTERVALS) {
    const candles = await KlineUtility.getRecentKlines(sym, ma.key, requiredLimit(displayCandles, ma.intervalMs))
    rawCandles[ma.key] = candles
    rawMa[ma.key] = rollingSma(candles, MA_PERIOD)
    if (TIMEFRAME_FETCH_DELAY_MS) await sleep(TIMEFRAME_FETCH_DELAY_MS)
  }

  const fifteenMin = rawCandles['15m']
  const display = fifteenMin.slice(-displayCandles)
  const displayOffset = fifteenMin.length - display.length
  const timeline = display.map((c) => c.openTime)

  function mappedSeries(key: string): (number | null)[] {
    if (key === '15m') return rawMa['15m'].slice(displayOffset)
    const candles = rawCandles[key]
    const ma = rawMa[key]
    const result: (number | null)[] = []
    let j = -1
    for (const t of timeline) {
      while (j + 1 < candles.length && candles[j + 1].openTime <= t) j++
      result.push(j >= 0 ? ma[j] : null)
    }
    return result
  }

  const ma15 = mappedSeries('15m')
  const ma1h = mappedSeries('1h')
  const ma4h = mappedSeries('4h')
  const ma1d = mappedSeries('1d')

  const data: MaRow[] = display.map((c, i) => ({
    openTime: c.openTime,
    time: new Date(c.openTime).toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    ma200_15m: ma15[i],
    ma200_1h: ma1h[i],
    ma200_4h: ma4h[i],
    ma200_1d: ma1d[i],
  }))

  return {
    symbol: sym,
    baseInterval: '15m',
    maPeriod: MA_PERIOD,
    maIntervals: MA_INTERVALS.map((m) => m.key),
    generatedAt: new Date().toISOString(),
    period: {
      candles: data.length,
      from: data.length ? data[0].time : null,
      to: data.length ? data[data.length - 1].time : null,
    },
    data,
  }
}