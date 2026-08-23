// ─── Flow movement spike detection (shared engine) ─────────────────────────────
//
// Reused by both FlowMovementScanner.vue (scans every futures symbol looking
// for a spike on its most recent candle) and CandleEntryVisualizerComponent.vue
// (renders a spike box above every past candle that qualified, not just the
// latest one). Keeping this logic in one place means both call sites agree on
// what "a flow spike" actually is.
//
// Structurally compatible with the `WalletMovement` interface already defined
// in CandleEntryVisualizerComponent.vue (amount/timestamp/type) — no import
// needed there, TS will accept walletMovements.value / flowScannerMovements.value
// directly wherever FlowMovementRecord[] is expected.

export interface FlowMovementRecord {
  amount: number
  timestamp: string
  type: 'INFLOW' | 'OUTFLOW'
  [key: string]: unknown
}

export interface CandleWindow {
  /** Candle open time, ms epoch. */
  openTime: number
}

/**
 * Sums abs(amount) per candle window, matching each movement's timestamp
 * against [openTime, openTime + intervalMs) — same as-of bucketing technique
 * used for the live wallet-movement panel's `movementPerCandle`. Direction
 * (inflow vs outflow) doesn't matter for spike detection, only magnitude of
 * total flow through the wallet.
 */
export function bucketFlowByCandle(
  movements: FlowMovementRecord[],
  windows: CandleWindow[],
  intervalMs: number,
): number[] {
  const totals = new Array(windows.length).fill(0)
  if (movements.length === 0 || windows.length === 0 || intervalMs <= 0) return totals

  for (const mv of movements) {
    const ts = new Date(mv.timestamp).getTime()
    if (isNaN(ts)) continue

    for (let i = windows.length - 1; i >= 0; i--) {
      const openTime = windows[i]?.openTime
      if (openTime == null) continue
      if (ts >= openTime && ts < openTime + intervalMs) {
        totals[i] += Math.abs(mv.amount)
        break
      }
    }
  }
  return totals
}

/**
 * Sums abs(amount) for movements falling in a single candle's window —
 * [openTime, openTime + intervalMs) — same matching rule as
 * `bucketFlowByCandle`, just for one candle instead of a whole array. This is
 * what `totalFlowForCandle` (flowMovementDb.ts) calls once it's pulled a
 * symbol's cached movements out of IndexedDB.
 */
export function totalFlowInWindow(
  movements: FlowMovementRecord[],
  openTime: number,
  intervalMs: number,
): number {
  if (movements.length === 0 || intervalMs <= 0) return 0

  let total = 0
  for (const mv of movements) {
    const ts = new Date(mv.timestamp).getTime()
    if (isNaN(ts)) continue
    if (ts >= openTime && ts < openTime + intervalMs) {
      total += Math.abs(mv.amount)
    }
  }
  return total
}

/**
 * Which direction dominated a single candle's window —
 * [openTime, openTime + intervalMs), same matching rule as
 * `totalFlowInWindow` — by comparing summed abs(amount) per `type`.
 *
 * Returns `null` when there's nothing in the window at all, or when inflow
 * and outflow are exactly tied (no dominant side), rather than defaulting to
 * either direction.
 */
export function dominantFlowInWindow(
  movements: FlowMovementRecord[],
  openTime: number,
  intervalMs: number,
): 'INFLOW' | 'OUTFLOW' | null {
  if (movements.length === 0 || intervalMs <= 0) return null

  let inflow = 0
  let outflow = 0
  for (const mv of movements) {
    const ts = new Date(mv.timestamp).getTime()
    if (isNaN(ts)) continue
    if (ts >= openTime && ts < openTime + intervalMs) {
      if (mv.type === 'INFLOW') inflow += Math.abs(mv.amount)
      else outflow += Math.abs(mv.amount)
    }
  }

  if (inflow === 0 && outflow === 0) return null
  if (inflow === outflow) return null
  return inflow > outflow ? 'INFLOW' : 'OUTFLOW'
}

export interface FlowSpikeResult {
  /** Per-candle spike flag — true at index i means the trailing `lookback`-candle window ending at i is a spike. */
  flags: boolean[]
  /** Per-candle z-score of its trailing-window flow total (null where there isn't enough history yet). */
  zScores: (number | null)[]
}

/**
 * Per-candle flow spike detector.
 *
 * Each candle already has its own total flow (from `bucketFlowByCandle`).
 * For candle i, this takes the **trailing `lookback` candles before it**
 * (i.e. i-lookback .. i-1 — candle i itself is never part of its own
 * baseline) as the comparison set, computes that baseline's mean/stddev,
 * and z-scores candle i's own flow against it: `(flow[i] - mean) / std`.
 * A candle is flagged as a spike when that z-score is >= `zThreshold`.
 *
 * This is causal by construction — candle i's baseline only ever looks
 * backward, never at itself or anything later — and it scores every
 * eligible candle (i >= lookback), not just the most recent one, so
 * callers can render a spike marker on every past candle that qualified.
 */
export function detectFlowSpikes(
  totalFlowPerCandle: number[],
  lookback = 24,
  zThreshold = 3,
): FlowSpikeResult {
  const n = totalFlowPerCandle.length
  const flags = new Array(n).fill(false)
  const zScores: (number | null)[] = new Array(n).fill(null)
  if (n <= lookback) return { flags, zScores }

  for (let i = lookback; i < n; i++) {
    let sum = 0
    for (let j = i - lookback; j < i; j++) sum += totalFlowPerCandle[j]
    const mean = sum / lookback

    let sqSum = 0
    for (let j = i - lookback; j < i; j++) sqSum += (totalFlowPerCandle[j] - mean) ** 2
    const std = Math.sqrt(sqSum / lookback)
    if (std === 0) continue // flat baseline (e.g. no movement data yet) — nothing to compare against

    const z = (totalFlowPerCandle[i] - mean) / std
    zScores[i] = z
    if (z >= zThreshold) flags[i] = true
  }

  return { flags, zScores }
}

export interface RecentFlowSpikeSummary {
  hasSpike: boolean
  zScore: number | null
  /** Total flow (inflow + outflow) summed over the trailing `lookback` candles ending at the most recent one. */
  totalFlowLast24: number
}

/**
 * Convenience wrapper around `detectFlowSpikes` that only cares about the
 * most recent candle — this is what FlowMovementScanner uses to decide
 * whether a symbol gets surfaced ("only display symbols with a recent spike").
 */
export function hasRecentFlowSpike(
  totalFlowPerCandle: number[],
  lookback = 24,
  zThreshold = 3,
): RecentFlowSpikeSummary {
  const lastIndex = totalFlowPerCandle.length - 1
  if (lastIndex < 0) return { hasSpike: false, zScore: null, totalFlowLast24: 0 }

  const { flags, zScores } = detectFlowSpikes(totalFlowPerCandle, lookback, zThreshold)
  const start = Math.max(0, lastIndex - lookback + 1)
  const totalFlowLast24 = totalFlowPerCandle.slice(start, lastIndex + 1).reduce((s, v) => s + v, 0)

  return {
    hasSpike: flags[lastIndex] ?? false,
    zScore: zScores[lastIndex] ?? null,
    totalFlowLast24,
  }
}