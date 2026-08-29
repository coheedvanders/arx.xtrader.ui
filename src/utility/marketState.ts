// ─── Market State Classification (EMA200 + highest/lowest AVWAP) ──────────
//
// Simple three-way read:
//  - UPTREND:   latest close is above EMA200, AND most candles in the
//               window are LINGERING NEAR the HIGHEST AVWAP zone (within
//               PROXIMITY_PCT of it) — not necessarily crossing above it,
//               just hugging that level.
//  - DOWNTREND: latest close is below EMA200, AND most candles in the
//               window are lingering near the LOWEST AVWAP zone.
//  - CHOPPY:    anything else — candles not clustered near either extreme,
//               or EMA and AVWAP position disagreeing.
//
// "Lingering near" means at least LEAN_RATIO of the candles in the window
// close within PROXIMITY_PCT of that zone (inside the zone counts as
// distance 0) — not necessarily every single one.

import type { CandleEntry, PriceZone } from "@/core/interfaces"

export type MarketState =
  | 'uptrend'            // above EMA200, lingering near the highest AVWAP zone
  | 'downtrend'          // below EMA200, lingering near the lowest AVWAP zone
  | 'choppy'             // not clustered near either extreme, or EMA/AVWAP disagree
  | 'insufficient_data'  // no candles, or no matching AVWAP zones, to evaluate

export interface MarketStateResult {
  state: MarketState
  emaBias: 'bullish' | 'bearish' | 'neutral'
  /** The AVWAP zone with the highest midpoint in the window. */
  highestAvwap: PriceZone | null
  /** The AVWAP zone with the lowest midpoint in the window. */
  lowestAvwap: PriceZone | null
  /** Fraction of candles in the window lingering near the highest AVWAP zone (within PROXIMITY_PCT). */
  nearHighestRatio: number
  /** Fraction of candles in the window lingering near the lowest AVWAP zone (within PROXIMITY_PCT). */
  nearLowestRatio: number
  reason: string
}

/** Within this % of EMA200 counts as "sitting on it" — no clear bias yet. Tune against your typical volatility (0.15% suits majors on lower timeframes; alts may need it wider). */
const EMA_NEUTRAL_BAND_PCT = 0.15

/** Fraction of candles in the window that need to be lingering near the same zone (highest or lowest) to call it a trend — not necessarily every candle. */
const LEAN_RATIO = 0.6

/**
 * How close (as a % of that zone's own level) a candle's close needs to be
 * to count as "lingering near" a zone. A close inside the zone's band
 * always counts (distance 0); this only matters for closes outside it.
 * ASSUMPTION — no domain guidance was given for how wide "near" should be,
 * so this is a starting guess; tune to match how tightly price actually
 * clusters around your AVWAP pins on the timeframe you're using.
 */
const PROXIMITY_PCT = 0.3

/** The midpoint of an AVWAP zone — used to rank zones as highest/lowest. */
function zoneMid(zone: PriceZone): number {
  return (zone.upper + zone.lower) / 2
}

/**
 * % distance from a price to a zone: 0 if the price falls inside the zone's
 * band, otherwise the distance to whichever edge is closer, expressed as a
 * percentage of the zone's own midpoint.
 */
function zoneProximityPct(price: number, zone: PriceZone): number {
  if (price >= zone.lower && price <= zone.upper) return 0
  const distance = price > zone.upper ? price - zone.upper : zone.lower - price
  return (distance / zoneMid(zone)) * 100
}

/**
 * Identifies market state: EMA200 (read off the latest candle) as the
 * driver, and where the candles in the window sit relative to the highest
 * and lowest AVWAP zones in that same window as confirmation. See file
 * header for the full reasoning.
 *
 * `candles` and `avwaps` must be the same length and index-aligned
 * (candles[i] pairs with avwaps[i]). If they're mismatched in length, only
 * the overlapping range (from the start) is used.
 */
export function identifyMarketState(candles: CandleEntry[], avwaps: PriceZone[]): MarketStateResult {
  if (candles.length === 0) {
    return {
      state: 'insufficient_data',
      emaBias: 'neutral',
      highestAvwap: null,
      lowestAvwap: null,
      nearHighestRatio: 0,
      nearLowestRatio: 0,
      reason: 'No candles supplied.'
    }
  }

  // Driver: EMA200 bias off the most recent candle in the window.
  const latest = candles[candles.length - 1]
  const ema = latest.candleData?.ema200 ?? null
  let emaBias: MarketStateResult['emaBias'] = 'neutral'
  if (ema != null && ema !== 0) {
    const deviationPct = ((latest.close - ema) / ema) * 100
    if (deviationPct > EMA_NEUTRAL_BAND_PCT) emaBias = 'bullish'
    else if (deviationPct < -EMA_NEUTRAL_BAND_PCT) emaBias = 'bearish'
  }

  // candles[i] <-> avwaps[i]. Use only the overlapping, aligned range if the
  // two arrays don't match in length.
  const pairCount = Math.min(candles.length, avwaps.length)
  if (pairCount === 0) {
    return {
      state: 'insufficient_data',
      emaBias,
      highestAvwap: null,
      lowestAvwap: null,
      nearHighestRatio: 0,
      nearLowestRatio: 0,
      reason: 'No matching AVWAP zones for the supplied candles — nothing to confirm the EMA200 bias against.'
    }
  }

  const alignedCandles = candles.slice(0, pairCount)
  const alignedAvwaps = avwaps.slice(0, pairCount)

  const highestAvwap = alignedAvwaps.reduce((max, z) => (zoneMid(z) > zoneMid(max) ? z : max))
  const lowestAvwap = alignedAvwaps.reduce((min, z) => (zoneMid(z) < zoneMid(min) ? z : min))

  const nearHighestCount = alignedCandles.filter(c => zoneProximityPct(c.close, highestAvwap) <= PROXIMITY_PCT).length
  const nearLowestCount = alignedCandles.filter(c => zoneProximityPct(c.close, lowestAvwap) <= PROXIMITY_PCT).length
  const nearHighestRatio = nearHighestCount / pairCount
  const nearLowestRatio = nearLowestCount / pairCount

  const lingeringNearHighest = nearHighestRatio >= LEAN_RATIO
  const lingeringNearLowest = nearLowestRatio >= LEAN_RATIO

  if (emaBias === 'bullish' && lingeringNearHighest) {
    return {
      state: 'uptrend',
      emaBias,
      highestAvwap,
      lowestAvwap,
      nearHighestRatio,
      nearLowestRatio,
      reason: `Latest close above EMA200 and ${nearHighestCount}/${pairCount} candles lingering near the highest AVWAP zone in the window (within ${PROXIMITY_PCT}%) — uptrend.`
    }
  }

  if (emaBias === 'bearish' && lingeringNearLowest) {
    return {
      state: 'downtrend',
      emaBias,
      highestAvwap,
      lowestAvwap,
      nearHighestRatio,
      nearLowestRatio,
      reason: `Latest close below EMA200 and ${nearLowestCount}/${pairCount} candles lingering near the lowest AVWAP zone in the window (within ${PROXIMITY_PCT}%) — downtrend.`
    }
  }

  return {
    state: 'choppy',
    emaBias,
    highestAvwap,
    lowestAvwap,
    nearHighestRatio,
    nearLowestRatio,
    reason: `EMA bias is ${emaBias}; candles are ${nearHighestCount}/${pairCount} lingering near the highest AVWAP zone and ${nearLowestCount}/${pairCount} near the lowest — not clustered near either extreme.`
  }
}