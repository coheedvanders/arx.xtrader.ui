<template>
  <div class="flow-scanner">
    <div class="flow-scanner-header">
      <div class="flow-scanner-title">
        <h3>Flow Movement Scanner</h3>
        <span class="flow-scanner-subtitle">
          Exchange wallet inflow/outflow spikes across the last 24 &times; 15m candles
        </span>
      </div>

      <button
        class="flow-scanner-scan-btn"
        :disabled="scanning"
        @click="scanMovement"
        title="Pulls exchange wallet movement for every futures symbol, checks the last 24 (15m) candles for a flow z-score spike, and caches the result in IndexedDB"
      >
        {{ scanning ? `Scanning… (${scanProgress}/${scanTotal})` : 'Scan Movement' }}
      </button>
    </div>

    <div v-if="scanError" class="flow-scanner-error">{{ scanError }}</div>

    <div v-if="scanning" class="flow-scanner-progress-bar">
      <div class="flow-scanner-progress-fill" :style="{ width: scanProgressPct + '%' }" />
    </div>

    <div v-if="!scanning && sortedResults.length === 0" class="flow-scanner-empty">
      No recent flow spikes cached yet. Click "Scan Movement" to check every symbol.
    </div>

    <div v-else class="flow-scanner-results">
      <div
        v-for="r in sortedResults"
        :key="r.symbol"
        class="flow-scanner-row"
        @click="openSymbol(r.symbol)"
      >
        <span class="flow-scanner-symbol">{{ r.symbol }}</span>
        <span class="flow-scanner-flow">{{ formatNotional(r.totalFlowLast24) }}</span>
        <span class="flow-scanner-zscore">z {{ r.zScore?.toFixed(1) ?? '—' }}</span>
        <span class="flow-scanner-time">{{ formatAge(r.fetchedAt) }}</span>
      </div>
    </div>

    <!-- Reuse the same modal chrome the rest of the app uses to pop open the full visualizer for a spiking symbol -->
    <DialogComponent v-model="showVisualizer" :width="'95vw'">
      <DialogHeaderComponent>
        {{ activeSymbol?.toUpperCase() }} · Flow Spike
      </DialogHeaderComponent>

      <div v-if="visualizerLoading" class="flow-scanner-visualizer-loading">
        Loading candles for {{ activeSymbol?.toUpperCase() }}…
      </div>
      <div v-else-if="visualizerError" class="flow-scanner-error">{{ visualizerError }}</div>
      <CandleEntryVisualizerComponent
        v-else-if="activeCandles.length > 0"
        :candles="activeCandles"
        :symbol="activeSymbol!"
        :interval="VISUALIZER_INTERVAL"
      />
    </DialogComponent>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CandleEntry } from '@/core/interfaces'
import { useChocoMintoStore } from '@/stores/chocoMintoStore.ts'
import DialogComponent from '../shared/dialog/DialogComponent.vue'
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue'
import CandleEntryVisualizerComponent from './CandleEntryVisualizerComponent.vue'
import {
  bucketFlowByCandle,
  hasRecentFlowSpike,
  type FlowMovementRecord,
} from '@/utility/flowMovement.ts'
import {
  saveFlowMovement,
  getAllFlowMovements,
  type FlowMovementDbEntry,
} from '@/utility/flowMovementDb.ts'

const chocomintoStore = useChocoMintoStore()

// NOTE: must match the base used in CandleEntryVisualizerComponent.vue's
// fetchWalletMovement — adjust both together if whale_tracker_api.py moves.
const WALLET_MOVEMENT_API_BASE = 'http://127.0.0.1:5000'
const REST_BASE = 'https://fapi.binance.com'

// Spike detection window: last 24 candles of the 15m interval (per spec).
const VISUALIZER_INTERVAL = '15m'
const FLOW_INTERVAL_MS = 15 * 60 * 1000
const FLOW_LOOKBACK = 24
const FLOW_Z_THRESHOLD = 3
// Fetch a little more than the lookback so the rolling window has candles to
// look back across, not just exactly 24 (would leave nothing to score against).
const SCAN_CANDLE_LIMIT = 60
// Small pause between symbols so we don't hammer the whale-tracker API / Binance.
const SCAN_DELAY_MS = 200

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatNotional(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

function formatAge(ms: number): string {
  const deltaMin = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (deltaMin < 1) return 'just now'
  if (deltaMin < 60) return `${deltaMin}m ago`
  return `${Math.round(deltaMin / 60)}h ago`
}

// ─── Scan state ─────────────────────────────────────────────────────────────
const scanning = ref(false)
const scanProgress = ref(0)
const scanTotal = ref(0)
const scanError = ref<string | null>(null)
const scanProgressPct = computed(() =>
  scanTotal.value > 0 ? Math.round((scanProgress.value / scanTotal.value) * 100) : 0,
)

const results = ref<Record<string, FlowMovementDbEntry>>({})

const sortedResults = computed(() =>
  Object.values(results.value)
    .filter((r) => r.hasSpike)
    .sort((a, b) => (b.zScore ?? 0) - (a.zScore ?? 0)),
)

/** Loads whatever's already cached from previous scans so results show up immediately, before a fresh scan is even triggered. */
async function loadCachedResults() {
  try {
    const entries = await getAllFlowMovements()
    const map: Record<string, FlowMovementDbEntry> = {}
    for (const e of entries) map[e.symbol] = e
    results.value = map
  } catch (err) {
    console.error('[FlowMovementScanner] failed to load cached results', err)
  }
}
loadCachedResults()

/** Fetches recent 15m klines for `symbol`, just enough to build the candle windows the movement gets bucketed against. */
async function fetchCandleWindows(symbol: string): Promise<CandleEntry[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${VISUALIZER_INTERVAL}&limit=${SCAN_CANDLE_LIMIT}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`klines request failed (${res.status})`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((k: any[]) => ({
    openTime: Number(k[0]),
    closeTime: Number(k[6]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  })) as CandleEntry[]
}

/** Fetches wallet movement records for `symbol` across [startMs, endMs]. */
async function fetchMovements(symbol: string, startMs: number, endMs: number): Promise<FlowMovementRecord[]> {
  const startIso = new Date(startMs).toISOString()
  const endIso = new Date(endMs).toISOString()
  const url = `${WALLET_MOVEMENT_API_BASE}/api/movement?symbol=${encodeURIComponent(symbol.toUpperCase())}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
  const res = await fetch(url)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `movement request failed (${res.status})`)
  return Array.isArray(body) ? body : []
}

/** Scans a single symbol end-to-end and writes the result into both IndexedDB and the reactive `results` map. */
async function scanSymbol(symbol: string) {
  const candles = await fetchCandleWindows(symbol)
  if (candles.length === 0) return

  const first = candles[0]
  const last = candles[candles.length - 1]
  if (first.openTime == null || last.openTime == null) return

  // Same "don't ask for a future block" clamp as the visualizer's fetchWalletMovement.
  const rawEndMs = last.openTime + FLOW_INTERVAL_MS
  const endMs = Math.min(rawEndMs, Date.now())

  const movements = await fetchMovements(symbol, first.openTime, endMs)
  const totalFlowPerCandle = bucketFlowByCandle(
    movements,
    candles.map((c) => ({ openTime: c.openTime! })),
    FLOW_INTERVAL_MS,
  )
  const summary = hasRecentFlowSpike(totalFlowPerCandle, FLOW_LOOKBACK, FLOW_Z_THRESHOLD)

  const entry: FlowMovementDbEntry = {
    symbol: symbol.toUpperCase(),
    movements,
    startMs: first.openTime,
    endMs,
    intervalMs: FLOW_INTERVAL_MS,
    totalFlowLast24: summary.totalFlowLast24,
    zScore: summary.zScore,
    hasSpike: summary.hasSpike,
    fetchedAt: Date.now(),
    // This IS the canonical scan (fixed 15m / 60-candle / 24-lookback / z>=3)
    // the scanner's own list is filtered/sorted by — mark it so the
    // visualizer's background backfill (which shares this same DB record)
    // knows never to overwrite the verdict fields above with its own
    // whatever-interval-is-on-screen computation.
    scannerVerified: true,
  }

  await saveFlowMovement(entry)
  results.value = { ...results.value, [entry.symbol]: entry }
}

async function scanMovement() {
  if (scanning.value) return
  const symbols = chocomintoStore.futureSymbols.map((f: { symbol: string }) => f.symbol)
  if (symbols.length === 0) {
    scanError.value = 'No futures symbols available to scan'
    return
  }

  scanning.value = true
  scanError.value = null
  scanProgress.value = 0
  scanTotal.value = symbols.length

  for (const symbol of symbols) {
    try {
      await scanSymbol(symbol)
    } catch (err) {
      // One symbol failing (rate limit, delisted, API hiccup) shouldn't abort the whole scan.
      console.warn(`[FlowMovementScanner] failed to scan ${symbol}`, err)
    } finally {
      scanProgress.value++
    }
    await sleep(SCAN_DELAY_MS)
  }

  scanning.value = false
}

// ─── Visualizer dialog ──────────────────────────────────────────────────────
const showVisualizer = ref(false)
const activeSymbol = ref<string | null>(null)
const activeCandles = ref<CandleEntry[]>([])
const visualizerLoading = ref(false)
const visualizerError = ref<string | null>(null)

async function openSymbol(symbol: string) {
  activeSymbol.value = symbol
  showVisualizer.value = true
  visualizerLoading.value = true
  visualizerError.value = null
  activeCandles.value = []
  try {
    const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${VISUALIZER_INTERVAL}&limit=300`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`klines request failed (${res.status})`)
    const data = await res.json()
    activeCandles.value = (Array.isArray(data) ? data : []).map((k: any[]) => ({
      openTime: Number(k[0]),
      closeTime: Number(k[6]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    })) as CandleEntry[]
  } catch (err) {
    visualizerError.value = err instanceof Error ? err.message : 'failed to load candles'
  } finally {
    visualizerLoading.value = false
  }
}
</script>

<style scoped>
.flow-scanner {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.flow-scanner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.flow-scanner-title h3 {
  margin: 0;
  font-size: 15px;
}

.flow-scanner-subtitle {
  font-size: 11px;
  color: #888;
}

.flow-scanner-scan-btn {
  background: #eab308;
  color: #1a1a1a;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.flow-scanner-scan-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.flow-scanner-error {
  color: #ef5350;
  font-size: 12px;
}

.flow-scanner-empty {
  color: #888;
  font-size: 12px;
  padding: 12px 0;
}

.flow-scanner-progress-bar {
  height: 4px;
  background: #2a2a2a;
  border-radius: 2px;
  overflow: hidden;
}
.flow-scanner-progress-fill {
  height: 100%;
  background: #eab308;
  transition: width 0.2s ease;
}

.flow-scanner-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.flow-scanner-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  background: #202020;
  cursor: pointer;
  transition: background 0.15s ease;
}
.flow-scanner-row:hover {
  background: #2a2a2a;
}

.flow-scanner-symbol {
  font-weight: 600;
  font-size: 13px;
}
.flow-scanner-flow {
  font-size: 12px;
  color: #ccc;
}
.flow-scanner-zscore {
  font-size: 12px;
  color: #eab308;
  font-weight: 600;
}
.flow-scanner-time {
  font-size: 11px;
  color: #777;
}

.flow-scanner-visualizer-loading {
  padding: 24px;
  text-align: center;
  color: #888;
}
</style>