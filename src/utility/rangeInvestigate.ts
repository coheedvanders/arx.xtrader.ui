/**
 * rangeInvestigate.ts
 *
 * "Range Investigate" — given a selected range of candles, figures out
 * WHY price moved the way it did (organic flow vs. squeeze/liquidation
 * vs. a single whale print vs. thin-liquidity noise) and produces a
 * forward-looking prediction (continuation / pullback / reversal) for
 * the next price zone.
 *
 * This is deliberately a *different lens* than rangeAnalyze.ts:
 *   - rangeAnalyze.ts asks "is this a good trade right now" (bias, entry,
 *     TP/SL, R:R against the CURRENT preview position).
 *   - rangeInvestigate.ts asks "what caused this range to move like this,
 *     and does that cause imply continuation or exhaustion."
 *
 * It mirrors the heuristics from the standalone spike_investigate.py
 * script (volume-vs-baseline, OI delta, taker aggressor imbalance,
 * funding rate, large single-trade dominance) but runs entirely
 * client-side against data the chart already fetches (candles, OI,
 * long/short ratio) plus two small extra REST calls the caller makes
 * before invoking this module: aggTrades and fundingRate history.
 *
 * Deterministic and synchronous — no network calls happen in here.
 * The Vue component is responsible for fetching largeTrades/fundingRate
 * and building baseline context, then calling investigateRange(input).
 */

// ─── Input shapes ──────────────────────────────────────────────────────────

export interface RangeInvestigateCandleInput {
  index: number
  openTime: number | null
  openTimeIso: string | null
  open: number
  high: number
  low: number
  close: number
  volume: number
  ema200: number | null
  openInterest: number | null
  longShortRatio: { longAccount: number; shortAccount: number } | null
  /** Exchange wallet inflow notional bucketed to this candle (token -> exchange, potential supply increasing). 0 if none recorded. */
  inflow: number
  /** Exchange wallet outflow notional bucketed to this candle (exchange -> token, potential supply decreasing). 0 if none recorded. */
  outflow: number
}

/** One Binance aggTrade, already narrowed to the range's time window. */
export interface LargeTradeInput {
  time: number
  price: number
  qty: number
  notional: number
  /** Binance `m` flag: true = buyer was the maker, i.e. the trade was SELL-initiated (taker sold). */
  isBuyerMaker: boolean
}

export interface RangeInvestigatePreviewPosition {
  side: 'LONG' | 'SHORT'
  entryPrice: number
  tpPrice: number
  slPrice: number
}

export interface RangeInvestigateInput {
  symbol: string
  interval: string
  /** The selected range, oldest → newest. Needs at least 2 candles. */
  candles: RangeInvestigateCandleInput[]
  /** Average per-candle volume over the lookback window BEFORE the range started. Null if unavailable. */
  baselineAvgVolume: number | null
  /** OI sample immediately before the range started. Null if OI history isn't loaded. */
  baselineOiBefore: number | null
  /** Long-account % immediately before the range started (0-1). Null if long/short history isn't loaded. */
  baselineLongAccountBefore: number | null
  /** Most recent funding rate at/around the range (fraction, e.g. 0.0001 = 0.01%). Null if unavailable. */
  fundingRate: number | null
  /** aggTrades inside the range's exact time span, already fetched by the caller. */
  largeTrades: LargeTradeInput[]
  /** Average per-candle exchange inflow over the lookback window BEFORE the range started. Null if wallet movement data isn't loaded. */
  baselineAvgInflow: number | null
  /** Average per-candle exchange outflow over the lookback window BEFORE the range started. Null if wallet movement data isn't loaded. */
  baselineAvgOutflow: number | null
  /** Active preview position, if any — used only to flag alignment, same convention as rangeAnalyze. */
  previewPosition?: RangeInvestigatePreviewPosition | null
}

// ─── Output shapes ─────────────────────────────────────────────────────────

export type DominantDriver =
  | 'ORGANIC_FLOW'
  | 'SQUEEZE_LIQUIDATION'
  | 'WHALE_SINGLE_TRADE'
  | 'THIN_LIQUIDITY_NOISE'
  | 'UNCLEAR'

export type PredictionVerdict = 'CONTINUATION' | 'PULLBACK' | 'REVERSAL' | 'UNCLEAR'

/** Whether exchange inflow or outflow spiked meaningfully above its recent baseline during the range. Not itself a buy/sell signal — see FlowConfluence. */
export type FlowSpike = 'INFLOW_SPIKE' | 'OUTFLOW_SPIKE' | 'NONE'

/**
 * How the flow spike (if any) relates to the read already built from price + volume + OI.
 * This is a confluence layer, not an independent signal:
 *   CONFIRMS    — flow lines up with and strengthens the price/volume/OI read.
 *   CONTRADICTS — flow runs against the price/volume/OI read (price still wins; this only
 *                 flags reduced confidence / reversal risk, it never flips the direction).
 *   ABSORPTION  — price is rising into an inflow spike (more potential supply) without
 *                 breaking, i.e. buyers appear to be absorbing the extra supply. Bullish,
 *                 but distinct from a clean CONFIRMS since supply pressure is elevated.
 *   NEUTRAL     — no spike, or a spike that doesn't clearly align either way.
 */
export type FlowConfluence = 'CONFIRMS' | 'CONTRADICTS' | 'ABSORPTION' | 'NEUTRAL'

export interface RangeInvestigateMetrics {
  direction: 'up' | 'down' | 'flat'
  priceMovePercent: number
  rangeHigh: number
  rangeLow: number
  candleCount: number
  totalVolume: number
  avgVolumePerCandle: number
  volumeVsBaselineRatio: number | null
  oiBefore: number | null
  oiAfter: number | null
  oiChangePercent: number | null
  longAccountBefore: number | null
  longAccountAfter: number | null
  longAccountChangePercent: number | null
  fundingRatePercent: number | null
  takerBuyNotional: number
  takerSellNotional: number
  takerBuySellRatio: number | null
  largestTradeNotional: number | null
  largestTradeShareOfVolume: number | null
  closePositionInRange: number | null // 0 = at range low, 1 = at range high
  distanceFromEma200Percent: number | null
  totalInflow: number
  totalOutflow: number
  netFlow: number // totalInflow - totalOutflow; positive = net supply moving toward exchanges
  inflowVsBaselineRatio: number | null
  outflowVsBaselineRatio: number | null
  flowSpike: FlowSpike
  /** How the flow spike (if any) relates to the price/volume/OI read above — see FlowConfluence. */
  flowConfluence: FlowConfluence
}

export interface RangeInvestigatePrediction {
  verdict: PredictionVerdict
  confidence: number // 0-100, confidence in `verdict`
  continuationPercent: number
  pullbackPercent: number
  reversalPercent: number
  thesis: string
  invalidation: string
}

export interface RangeInvestigatePositionRead {
  side: 'LONG' | 'SHORT'
  alignment: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL'
  note: string
}

export interface RangeInvestigateResult {
  symbol: string
  interval: string
  generatedAt: string
  rangeStartTimeIso: string | null
  rangeEndTimeIso: string | null
  dominantDriver: DominantDriver
  driverConfidence: number // 0-100
  whyItHappened: string
  supportingSignals: string[]
  contradictingSignals: string[]
  metrics: RangeInvestigateMetrics
  prediction: RangeInvestigatePrediction
  position: RangeInvestigatePositionRead | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function pct(from: number, to: number): number {
  if (from === 0) return 0
  return ((to - from) / from) * 100
}

/** How many multiples of the pre-range baseline an inflow/outflow total needs to hit before it counts as a "spike" (e.g. baseline ~1.2M -> range ~8M is a ~6.7x spike; 2.5x is the floor treated as meaningful). */
const FLOW_SPIKE_RATIO = 2.5

/** Normalize three raw scores into percentages that sum to 100. */
function normalizeToPercent(a: number, b: number, c: number): [number, number, number] {
  const total = a + b + c
  if (total <= 0) return [33, 34, 33]
  return [
    Math.round((a / total) * 100),
    Math.round((b / total) * 100),
    100 - Math.round((a / total) * 100) - Math.round((b / total) * 100),
  ]
}

// ─── Core analysis ──────────────────────────────────────────────────────────

export function investigateRange(input: RangeInvestigateInput): RangeInvestigateResult {
  const { candles } = input
  if (candles.length < 2) {
    throw new Error('Range Investigate needs at least 2 candles selected.')
  }

  const first = candles[0]
  const last = candles[candles.length - 1]

  const rangeHigh = Math.max(...candles.map(c => c.high))
  const rangeLow = Math.min(...candles.map(c => c.low))
  const priceMovePercent = pct(first.open, last.close)
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(priceMovePercent) < 0.05 ? 'flat' : priceMovePercent > 0 ? 'up' : 'down'

  // ── Volume ──────────────────────────────────────────────────────────────
  const totalVolume = candles.reduce((s, c) => s + (c.volume ?? 0), 0)
  const avgVolumePerCandle = totalVolume / candles.length
  const volumeVsBaselineRatio =
    input.baselineAvgVolume && input.baselineAvgVolume > 0
      ? avgVolumePerCandle / input.baselineAvgVolume
      : null

  // ── Open Interest ───────────────────────────────────────────────────────
  const oiSamples = candles.map(c => c.openInterest).filter((v): v is number => v != null)
  const oiBefore = input.baselineOiBefore ?? (oiSamples.length ? oiSamples[0] : null)
  const oiAfter = oiSamples.length ? oiSamples[oiSamples.length - 1] : null
  const oiChangePercent = oiBefore != null && oiAfter != null ? pct(oiBefore, oiAfter) : null

  // ── Long/Short ratio ────────────────────────────────────────────────────
  const lsSamples = candles.map(c => c.longShortRatio).filter((v): v is { longAccount: number; shortAccount: number } => v != null)
  const longAccountBefore = input.baselineLongAccountBefore ?? (lsSamples.length ? lsSamples[0].longAccount : null)
  const longAccountAfter = lsSamples.length ? lsSamples[lsSamples.length - 1].longAccount : null
  const longAccountChangePercent =
    longAccountBefore != null && longAccountAfter != null ? pct(longAccountBefore, longAccountAfter) : null

  // ── Funding ──────────────────────────────────────────────────────────────
  const fundingRatePercent = input.fundingRate != null ? input.fundingRate * 100 : null

  // ── Taker aggressor flow from largeTrades (aggTrades) ──────────────────
  let takerBuyNotional = 0
  let takerSellNotional = 0
  let largestTradeNotional: number | null = null
  for (const t of input.largeTrades) {
    if (t.isBuyerMaker) takerSellNotional += t.notional // buyer=maker -> seller was the taker
    else takerBuyNotional += t.notional // buyer was the taker
    if (largestTradeNotional == null || t.notional > largestTradeNotional) largestTradeNotional = t.notional
  }
  const totalTakerNotional = takerBuyNotional + takerSellNotional
  const takerBuySellRatio = totalTakerNotional > 0 ? takerBuyNotional / (takerSellNotional || 1) : null
  const largestTradeShareOfVolume =
    largestTradeNotional != null && totalTakerNotional > 0 ? largestTradeNotional / totalTakerNotional : null

  // ── Where did it close relative to the range, and vs EMA200 ────────────
  const closePositionInRange = rangeHigh > rangeLow ? clamp((last.close - rangeLow) / (rangeHigh - rangeLow), 0, 1) : null
  const distanceFromEma200Percent = last.ema200 ? pct(last.ema200, last.close) : null

  // ── Exchange inflow/outflow — supply-side confluence, NOT an independent signal ────────
  // Inflow = potential exchange supply increasing. Outflow = potential exchange supply
  // decreasing. This never overrides the price/volume/OI read above; it only strengthens,
  // weakens, or flags a conflict against it (see FlowConfluence).
  const totalInflow = candles.reduce((s, c) => s + (c.inflow ?? 0), 0)
  const totalOutflow = candles.reduce((s, c) => s + (c.outflow ?? 0), 0)
  const netFlow = totalInflow - totalOutflow
  const avgInflowPerCandle = totalInflow / candles.length
  const avgOutflowPerCandle = totalOutflow / candles.length
  const inflowVsBaselineRatio =
    input.baselineAvgInflow && input.baselineAvgInflow > 0 ? avgInflowPerCandle / input.baselineAvgInflow : null
  const outflowVsBaselineRatio =
    input.baselineAvgOutflow && input.baselineAvgOutflow > 0 ? avgOutflowPerCandle / input.baselineAvgOutflow : null

  const isInflowSpike = totalInflow > 0 && inflowVsBaselineRatio != null && inflowVsBaselineRatio >= FLOW_SPIKE_RATIO
  const isOutflowSpike = totalOutflow > 0 && outflowVsBaselineRatio != null && outflowVsBaselineRatio >= FLOW_SPIKE_RATIO

  let flowSpike: FlowSpike = 'NONE'
  if (isInflowSpike && isOutflowSpike) {
    // Both spiked vs baseline (rare) — go with whichever side actually dominates this range.
    flowSpike = totalInflow >= totalOutflow ? 'INFLOW_SPIKE' : 'OUTFLOW_SPIKE'
  } else if (isInflowSpike) {
    flowSpike = 'INFLOW_SPIKE'
  } else if (isOutflowSpike) {
    flowSpike = 'OUTFLOW_SPIKE'
  }

  // Read volume/OI the same "up/down/neutral" way the driver scoring below does, so the
  // flow layer is judged against the same bar as everything else instead of its own scale.
  // (volumeVsBaselineRatio, not the `volRatio` alias — that's declared later in the driver-scoring block.)
  const volForFlowRead = volumeVsBaselineRatio ?? 1
  const volumeParticipation: 'up' | 'down' | 'neutral' = volForFlowRead >= 1.3 ? 'up' : volForFlowRead < 0.8 ? 'down' : 'neutral'
  const oiCondition: 'up' | 'down' | 'neutral' =
    oiChangePercent == null ? 'neutral' : oiChangePercent >= 3 ? 'up' : oiChangePercent <= -3 ? 'down' : 'neutral'

  // Confluence hierarchy: price action first, then volume, then OI, then flow last — flow
  // only ever strengthens/weakens/conflicts with what those already established.
  let flowConfluence: FlowConfluence = 'NEUTRAL'
  if (direction === 'up') {
    if (flowSpike === 'OUTFLOW_SPIKE' && volumeParticipation === 'up') {
      flowConfluence = 'CONFIRMS' // price up + volume up + outflow spike -> strong bullish confluence
    } else if (flowSpike === 'INFLOW_SPIKE' && volumeParticipation === 'up') {
      flowConfluence = 'ABSORPTION' // price up + volume up + inflow spike -> bullish, buyers absorbing supply
    } else if (flowSpike === 'INFLOW_SPIKE' && volumeParticipation !== 'up' && oiCondition !== 'up') {
      flowConfluence = 'CONTRADICTS' // price up + volume down + OI down + inflow spike -> weak bullish / reversal risk
    }
  } else if (direction === 'down') {
    if (flowSpike === 'INFLOW_SPIKE' && volumeParticipation === 'up') {
      flowConfluence = 'CONFIRMS' // price down + volume up + inflow spike -> strong bearish confluence
    } else if (flowSpike === 'OUTFLOW_SPIKE' && volumeParticipation === 'up') {
      flowConfluence = 'CONTRADICTS' // price down + volume up + outflow spike -> conflicted; price still wins
    } else if (flowSpike === 'OUTFLOW_SPIKE' && volumeParticipation !== 'up' && oiCondition !== 'up') {
      flowConfluence = 'CONTRADICTS' // price down + volume down + OI down + outflow spike -> weakens bearish continuation
    }
  }

  const metrics: RangeInvestigateMetrics = {
    direction,
    priceMovePercent,
    rangeHigh,
    rangeLow,
    candleCount: candles.length,
    totalVolume,
    avgVolumePerCandle,
    volumeVsBaselineRatio,
    oiBefore,
    oiAfter,
    oiChangePercent,
    longAccountBefore,
    longAccountAfter,
    longAccountChangePercent,
    fundingRatePercent,
    takerBuyNotional,
    takerSellNotional,
    takerBuySellRatio,
    largestTradeNotional,
    largestTradeShareOfVolume,
    closePositionInRange,
    distanceFromEma200Percent,
    totalInflow,
    totalOutflow,
    netFlow,
    inflowVsBaselineRatio,
    outflowVsBaselineRatio,
    flowSpike,
    flowConfluence,
  }

  // ── Driver classification ───────────────────────────────────────────────
  const supportingSignals: string[] = []
  const contradictingSignals: string[] = []

  // Score each candidate driver, then pick the strongest.
  let organicScore = 0
  let squeezeScore = 0
  let whaleScore = 0
  let thinScore = 0

  const volRatio = volumeVsBaselineRatio ?? 1
  if (volRatio >= 2) {
    organicScore += 1
    supportingSignals.push(`Volume ran ~${volRatio.toFixed(1)}x the baseline average — real participation, not a thin print.`)
  } else if (volRatio < 1.3) {
    thinScore += 1.5
    contradictingSignals.push(`Volume was only ~${volRatio.toFixed(1)}x baseline — this move happened on comparatively light volume.`)
  }

  if (oiChangePercent != null) {
    if (Math.abs(priceMovePercent) > 0.5 && oiChangePercent >= 3) {
      organicScore += 2
      supportingSignals.push(`Open Interest rose ${oiChangePercent.toFixed(2)}% alongside the ${direction} move — fresh positions opening, not just existing longs/shorts changing hands.`)
    } else if (Math.abs(priceMovePercent) > 0.5 && oiChangePercent <= -3) {
      squeezeScore += 2.5
      supportingSignals.push(`Open Interest FELL ${oiChangePercent.toFixed(2)}% while price moved ${direction} — positions were closing out, consistent with a squeeze or stop-loss/liquidation cascade rather than new conviction buying.`)
    }
  }

  if (largestTradeShareOfVolume != null && largestTradeNotional != null) {
    if (largestTradeShareOfVolume >= 0.35) {
      whaleScore += 2.5
      supportingSignals.push(`A single trade (~$${largestTradeNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}) accounted for ${(largestTradeShareOfVolume * 100).toFixed(0)}% of the captured taker volume — one large participant likely drove a meaningful chunk of this move.`)
    }
  }

  if (takerBuySellRatio != null) {
    if (direction === 'up' && takerBuySellRatio >= 1.5) {
      organicScore += 1
      supportingSignals.push(`Taker buy flow outweighed taker sell flow ${takerBuySellRatio.toFixed(2)}:1 — aggressive market buying, not just price drifting up on thin resistance.`)
    } else if (direction === 'down' && takerBuySellRatio != null && takerBuySellRatio <= 0.67) {
      organicScore += 1
      supportingSignals.push(`Taker sell flow dominated (buy/sell ratio ${takerBuySellRatio.toFixed(2)}) — aggressive market selling drove the move down.`)
    } else if (direction === 'up' && takerBuySellRatio < 1) {
      contradictingSignals.push(`Price rose but taker sell flow was actually heavier (ratio ${takerBuySellRatio.toFixed(2)}) — the move may be more about a lack of sellers/thin book than real buying pressure.`)
      thinScore += 0.5
    }
  }

  if (candles.length <= 3 && volRatio < 1.5) {
    thinScore += 1
  }

  // ── Flow confluence — strengthens/weakens the driver read above, never sets it alone ───
  if (flowConfluence === 'CONFIRMS' && flowSpike === 'OUTFLOW_SPIKE') {
    organicScore += 1.5
    supportingSignals.push(`Exchange outflow spiked ~${outflowVsBaselineRatio!.toFixed(1)}x baseline while price and volume both rose — potential sell-side supply is thinning right alongside the rally. The flow data supports the bullish price action.`)
  } else if (flowConfluence === 'CONFIRMS' && flowSpike === 'INFLOW_SPIKE') {
    organicScore += 1.5
    supportingSignals.push(`Exchange inflow spiked ~${inflowVsBaselineRatio!.toFixed(1)}x baseline while price fell on rising volume — potential sell-side supply increased right alongside the sell-off. The flow data confirms the bearish price action.`)
  } else if (flowConfluence === 'ABSORPTION') {
    organicScore += 0.5
    supportingSignals.push(`Inflow spiked ~${inflowVsBaselineRatio!.toFixed(1)}x baseline even as price kept rising on rising volume — buyers appear to be absorbing the extra potential supply rather than being overwhelmed by it.`)
  } else if (flowConfluence === 'CONTRADICTS' && direction === 'up') {
    thinScore += 0.5
    contradictingSignals.push(`Inflow spiked ~${inflowVsBaselineRatio!.toFixed(1)}x baseline while volume and Open Interest both faded — participation and positioning aren't confirming this rally, and potential supply is building against it. The move lacks strong confirmation and may be vulnerable to reversal.`)
  } else if (flowConfluence === 'CONTRADICTS' && direction === 'down' && flowSpike === 'OUTFLOW_SPIKE') {
    if (volumeParticipation === 'up') {
      contradictingSignals.push(`Despite reduced potential exchange supply (outflow ~${outflowVsBaselineRatio!.toFixed(1)}x baseline), sellers are still controlling price on rising volume. The outflow is a bullish supply-side undertone, but price action hasn't confirmed it — a conflicted read.`)
    } else {
      contradictingSignals.push(`Bearish price action here is paired with declining participation, falling Open Interest, and an outflow spike (~${outflowVsBaselineRatio!.toFixed(1)}x baseline) — reduced potential exchange supply weakens the case for this bearish move continuing.`)
    }
  }

  const scores: { driver: DominantDriver; score: number }[] = [
    { driver: 'ORGANIC_FLOW', score: organicScore },
    { driver: 'SQUEEZE_LIQUIDATION', score: squeezeScore },
    { driver: 'WHALE_SINGLE_TRADE', score: whaleScore },
    { driver: 'THIN_LIQUIDITY_NOISE', score: thinScore },
  ]
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const runnerUp = scores[1]
  const dominantDriver: DominantDriver = top.score > 0 ? top.driver : 'UNCLEAR'
  const scoreSpread = top.score - (runnerUp?.score ?? 0)
  const driverConfidence = top.score <= 0 ? 30 : clamp(50 + scoreSpread * 12, 35, 92)

  const whyItHappened = buildWhyNarrative(dominantDriver, metrics, input) + buildFlowNarrative(metrics)

  // ── Forward prediction: continuation vs pullback vs reversal ───────────
  let continuationScore = 1
  let pullbackScore = 1
  let reversalScore = 1

  // Driver-based prior
  if (dominantDriver === 'ORGANIC_FLOW') continuationScore += 2.5
  if (dominantDriver === 'SQUEEZE_LIQUIDATION') { reversalScore += 2; pullbackScore += 1 }
  if (dominantDriver === 'WHALE_SINGLE_TRADE') pullbackScore += 1.5
  if (dominantDriver === 'THIN_LIQUIDITY_NOISE') pullbackScore += 2

  // Where price closed within its own range: closing near the extreme = continuation-friendly,
  // closing back toward the middle/opposite side = rejection.
  if (closePositionInRange != null) {
    if (direction === 'up') {
      if (closePositionInRange >= 0.75) continuationScore += 1.5
      else if (closePositionInRange <= 0.4) { pullbackScore += 1.5; reversalScore += 0.5 }
    } else if (direction === 'down') {
      if (closePositionInRange <= 0.25) continuationScore += 1.5
      else if (closePositionInRange >= 0.6) { pullbackScore += 1.5; reversalScore += 0.5 }
    }
  }

  // Funding rate extremity — crowded positioning in the direction of the move raises squeeze/pullback risk.
  if (fundingRatePercent != null) {
    if (direction === 'up' && fundingRatePercent > 0.05) {
      pullbackScore += 1.5
      contradictingSignals.push(`Funding is running hot (${fundingRatePercent.toFixed(3)}%) — longs are already crowded and paying up, raising the odds of a long-squeeze pullback.`)
    } else if (direction === 'down' && fundingRatePercent < -0.05) {
      reversalScore += 1.5
      contradictingSignals.push(`Funding is deeply negative (${fundingRatePercent.toFixed(3)}%) — shorts are crowded, raising the odds of a short-squeeze bounce.`)
    }
  }

  // EMA200 context — moving further from EMA200 without pause raises mean-reversion odds.
  if (distanceFromEma200Percent != null && Math.abs(distanceFromEma200Percent) > 5) {
    pullbackScore += 1
    contradictingSignals.push(`Price is now ${Math.abs(distanceFromEma200Percent).toFixed(1)}% away from EMA200 — stretched enough that a mean-reversion pullback wouldn't be surprising.`)
  }

  // Long/short crowd shift — a fast swing to one-sided positioning during the move is contrarian.
  if (longAccountChangePercent != null && Math.abs(longAccountChangePercent) > 8) {
    if (direction === 'up' && longAccountChangePercent > 0) pullbackScore += 1
    if (direction === 'down' && longAccountChangePercent < 0) reversalScore += 1
  }

  // Flow confluence — same confluence layer as above, applied to the forward read. Never
  // flips the verdict on its own; only nudges confidence toward/away from continuation.
  if (flowConfluence === 'CONFIRMS') {
    continuationScore += 1
  } else if (flowConfluence === 'ABSORPTION') {
    continuationScore += 0.5 // bullish, but supply pressure is elevated so the boost is smaller than a clean CONFIRMS
  } else if (flowConfluence === 'CONTRADICTS' && direction === 'up') {
    pullbackScore += 1
    reversalScore += 0.5
  } else if (flowConfluence === 'CONTRADICTS' && direction === 'down') {
    pullbackScore += 1
  }

  const [continuationPercent, pullbackPercent, reversalPercent] = normalizeToPercent(
    continuationScore,
    pullbackScore,
    reversalScore
  )

  let verdict: PredictionVerdict = 'UNCLEAR'
  let top2 = Math.max(continuationPercent, pullbackPercent, reversalPercent)
  if (continuationPercent === top2) verdict = 'CONTINUATION'
  else if (pullbackPercent === top2) verdict = 'PULLBACK'
  else verdict = 'REVERSAL'
  const predictionConfidence = clamp(top2, 34, 90)

  const prediction: RangeInvestigatePrediction = {
    verdict,
    confidence: predictionConfidence,
    continuationPercent,
    pullbackPercent,
    reversalPercent,
    thesis: buildPredictionThesis(verdict, direction, metrics),
    invalidation: buildInvalidation(direction, metrics),
  }

  // ── Preview position alignment (same convention as rangeAnalyze.ts) ────
  let position: RangeInvestigatePositionRead | null = null
  if (input.previewPosition) {
    const side = input.previewPosition.side
    const movesWithVerdict =
      (side === 'LONG' && verdict === 'CONTINUATION' && direction === 'up') ||
      (side === 'SHORT' && verdict === 'CONTINUATION' && direction === 'down') ||
      (side === 'LONG' && verdict === 'REVERSAL' && direction === 'down') ||
      (side === 'SHORT' && verdict === 'REVERSAL' && direction === 'up')
    const movesAgainstVerdict =
      (side === 'LONG' && (verdict === 'PULLBACK' || verdict === 'REVERSAL') && direction === 'up') ||
      (side === 'SHORT' && (verdict === 'PULLBACK' || verdict === 'REVERSAL') && direction === 'down')

    const alignment: 'ALIGNED' | 'OPPOSED' | 'NEUTRAL' = movesWithVerdict
      ? 'ALIGNED'
      : movesAgainstVerdict
        ? 'OPPOSED'
        : 'NEUTRAL'

    position = {
      side,
      alignment,
      note:
        alignment === 'ALIGNED'
          ? `Your ${side} preview lines up with the ${verdict.toLowerCase()} read — the driver behind this move supports it continuing to work.`
          : alignment === 'OPPOSED'
            ? `Your ${side} preview is fighting the ${verdict.toLowerCase()} read — the signals here suggest caution on this side.`
            : `The ${verdict.toLowerCase()} read doesn't clearly favor either side of your ${side} preview — treat this as a neutral data point.`,
    }
  }

  return {
    symbol: input.symbol,
    interval: input.interval,
    generatedAt: new Date().toISOString(),
    rangeStartTimeIso: first.openTimeIso,
    rangeEndTimeIso: last.openTimeIso,
    dominantDriver,
    driverConfidence: Math.round(driverConfidence),
    whyItHappened,
    supportingSignals,
    contradictingSignals,
    metrics,
    prediction,
    position,
  }
}

// ─── Narrative builders ─────────────────────────────────────────────────────

function buildWhyNarrative(driver: DominantDriver, m: RangeInvestigateMetrics, input: RangeInvestigateInput): string {
  const dirWord = m.direction === 'up' ? 'rallied' : m.direction === 'down' ? 'sold off' : 'chopped sideways'
  const movePct = Math.abs(m.priceMovePercent).toFixed(2)

  switch (driver) {
    case 'ORGANIC_FLOW':
      return `${input.symbol} ${dirWord} ${movePct}% over this range on genuinely elevated volume, with Open Interest building in the same direction and taker flow leaning the same way. That combination — new money entering, not just existing positions getting squeezed — points to a real, flow-driven move rather than a mechanical one.`
    case 'SQUEEZE_LIQUIDATION':
      return `${input.symbol} ${dirWord} ${movePct}%, but Open Interest dropped through the move rather than rising. That's the signature of a squeeze or liquidation cascade: existing positions getting forced out (stopped out or liquidated) accelerates price in one direction without fresh conviction behind it. Moves like this tend to be sharper and shorter-lived than organic trend moves.`
    case 'WHALE_SINGLE_TRADE':
      return `${input.symbol} ${dirWord} ${movePct}%, and a disproportionate share of the volume in this window came from one or two oversized trades. That suggests a single large participant (a whale or a market maker rebalancing) moved the tape more than broad market consensus did — worth treating with more caution than a move built from many smaller trades.`
    case 'THIN_LIQUIDITY_NOISE':
      return `${input.symbol} ${dirWord} ${movePct}% on volume that wasn't meaningfully above baseline. With this few participants involved, the move may say more about a temporarily thin order book than about any real shift in sentiment — these tend to mean-revert more often than they hold.`
    default:
      return `${input.symbol} ${dirWord} ${movePct}% over this range, but the available signals (volume, OI, taker flow) don't point clearly to one driver. Could be a mix of factors, or data availability (OI/trade history) is limited for this symbol/window — treat the read below with extra caution.`
  }
}

/**
 * One trailing sentence summarizing how exchange inflow/outflow relates to the driver read
 * above — confirms, weakens, or is a non-factor. Appended to whyItHappened rather than
 * replacing any of it, per the confluence hierarchy (price > volume > OI > flow).
 */
function buildFlowNarrative(m: RangeInvestigateMetrics): string {
  switch (m.flowConfluence) {
    case 'CONFIRMS':
      return m.flowSpike === 'OUTFLOW_SPIKE'
        ? ` Exchange outflow also spiked through the range, thinning potential sell-side supply in the same direction as the move — flow data lines up with and reinforces this read.`
        : ` Exchange inflow also spiked through the range, adding potential sell-side supply in the same direction as the move — flow data lines up with and reinforces this read.`
    case 'ABSORPTION':
      return ` Exchange inflow spiked through the range too, but price kept climbing anyway — a sign buyers are absorbing the extra potential supply rather than being overwhelmed by it.`
    case 'CONTRADICTS':
      return m.flowSpike === 'INFLOW_SPIKE'
        ? ` Worth flagging: exchange inflow spiked while participation and positioning faded, adding potential supply into an already-weakening move — that combination raises reversal risk.`
        : ` Worth flagging: exchange outflow spiked even as price didn't confirm it — potential supply is thinning, which is a bullish undertone the price action hasn't backed up yet.`
    default:
      return m.flowSpike === 'NONE' ? '' : ` Exchange flow moved outside its usual range here, but it doesn't clearly line up with or against this move either way.`
  }
}

function buildPredictionThesis(verdict: PredictionVerdict, direction: 'up' | 'down' | 'flat', m: RangeInvestigateMetrics): string {
  const nextDirWord = direction === 'up' ? 'higher' : direction === 'down' ? 'lower' : 'sideways'
  const oppositeDirWord = direction === 'up' ? 'lower' : direction === 'down' ? 'higher' : 'sideways'

  switch (verdict) {
    case 'CONTINUATION':
      return `Structure favors price continuing ${nextDirWord} into the next price zone — the driver behind this move (fresh OI, one-sided taker flow) hasn't shown signs of exhaustion yet.`
    case 'PULLBACK':
      return `Structure favors a pullback before any further move — price closed away from the extreme of this range and/or positioning looks stretched, which typically resolves with at least a partial retrace before the next leg.`
    case 'REVERSAL':
      return `Structure favors an outright reversal toward ${oppositeDirWord} prices — the move looks mechanically driven (squeeze/thin liquidity) rather than organic, and crowded positioning is working against it continuing.`
    default:
      return `Signals are mixed enough that no direction has a clear edge into the next price zone — treat this range as inconclusive rather than forcing a bias.`
  }
}

function buildInvalidation(direction: 'up' | 'down' | 'flat', m: RangeInvestigateMetrics): string {
  if (direction === 'up') {
    return `A clean break back below this range's low (${m.rangeLow}) with volume would invalidate a continuation read and confirm the pullback/reversal case instead.`
  } else if (direction === 'down') {
    return `A clean break back above this range's high (${m.rangeHigh}) with volume would invalidate a continuation read and confirm the pullback/reversal case instead.`
  }
  return `A decisive break of either side of this range (${m.rangeLow} - ${m.rangeHigh}) on volume would be the first sign of which way this resolves.`
}