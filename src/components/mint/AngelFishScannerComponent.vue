<template>
  <div class="angel-fish-scanner">
    <div class="scanner-controls">
      <label class="interval-label">
        Interval
        <select v-model="selectedInterval" class="interval-select" :disabled="scanning">
          <option v-for="opt in INTERVALS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>

      <button class="rescan-btn" :disabled="scanning" @click="runScan()">
        {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Rescan' }}
      </button>

      <span class="result-count">{{ sortedResults.length }} squeeze(s) found</span>
    </div>

    <div v-if="scanning" class="progress-bar-track">
      <div class="progress-bar-fill" :style="{ width: `${scanProgressPct}%` }" />
      <span class="progress-bar-label">{{ scanProgress.done }} / {{ scanProgress.total }}</span>
    </div>

    <div v-if="scanning && !sortedResults.length" class="scanner-empty">
      Scanning {{ scanProgress.total }} symbols on {{ selectedInterval }}...
    </div>

    <div v-else-if="!sortedResults.length" class="scanner-empty">
      No angel fish head pattern detected on {{ selectedInterval }}.
    </div>

    <table v-else class="results-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Last Price</th>
          <th>Volume (USDT)</th>
          <th>Squeeze Score</th>
          <th>Convergence</th>
          <th>Bias</th>
          <th>Apex (bars)</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in sortedResults"
          :key="r.symbol"
          class="result-row"
          @click="openEntryHistory(r)"
        >
          <td class="symbol-cell">{{ r.symbol }}</td>
          <td>{{ r.lastPrice }}</td>
          <td>{{ formatUsdt(r.volumeUsdt) }}</td>
          <td>
            <span class="score-badge" :class="{ 'score-high': r.pattern.score >= 70 }">
              {{ r.pattern.score }}
            </span>
          </td>
          <td>{{ (r.pattern.convergenceRatio * 100).toFixed(0) }}%</td>
          <td>
            <span :class="['bias-tag', `bias-${r.pattern.bias}`]">{{ r.pattern.bias }}</span>
          </td>
          <td>{{ r.pattern.apexBarsAway ?? '—' }}</td>
        </tr>
      </tbody>
    </table>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
      <DialogHeaderComponent>
        {{ selectedSymbol }}
      </DialogHeaderComponent>
      <CandleEntryHistoryComponent :symbol="selectedSymbol" :candle-entries="selectedSymbolCandleEntries" />
    </DialogComponent>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'

// ---- adjust these three import paths to match your project structure ----
import { useChocoMintoStore } from '@/stores/chocoMintoStore'
import type { FuturesSymbol,CandleEntry } from '@/core/interfaces'

import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';


// ---------------------------------------------------------------------

const chocoMintoStore = useChocoMintoStore()

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com/fapi/v1/klines'

type Interval = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d'

const INTERVALS: { label: string; value: Interval }[] = [
  { label: '1m', value: '1m' },
  { label: '3m', value: '3m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
]

const selectedInterval = ref<Interval>('4h')

// candles pulled per symbol - needs enough history to find pivots on both sides of the squeeze
const CANDLE_LIMIT = 1000

// how far back to ask Binance for, per interval, sized so CANDLE_LIMIT candles actually exist
const LOOKBACK_DAYS_BY_INTERVAL: Record<Interval, number> = {
  '1m': 2,
  '3m': 4,
  '5m': 7,
  '15m': 14,
  '1h': 30,
  '4h': 90,
  '1d': 240,
}

// how many of the most recent candles are examined for the pattern itself
const PATTERN_WINDOW = 40

interface AngelFishLine {
  slope: number
  intercept: number
  rSquared: number
  touches: number
}

interface AngelFishPattern {
  upper: AngelFishLine // descending line through lower highs
  lower: AngelFishLine // ascending line through higher lows
  convergenceRatio: number // wedge width at the end / wedge width at the start (smaller = tighter squeeze)
  apexBarsAway: number | null // bars until the two lines would meet, projected forward
  bias: 'up' | 'down' | 'neutral' // where price currently sits inside the wedge
  score: number // 0-100 confidence
}

interface ScanResult {
  symbol: string
  lastPrice: number
  volumeUsdt: number
  candles: CandleEntry[]
  pattern: AngelFishPattern
}

const symbols = computed<string[]>(() => chocoMintoStore.futureSymbols?.map((c: FuturesSymbol) => c.symbol) || [])

const scanning = ref(false)
const scanProgress = ref({ done: 0, total: 0 })
const results = ref<ScanResult[]>([])
const errorSymbols = ref<string[]>([])

const showEntryHistory = ref(false)
const selectedSymbol = ref('')
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])

// sorted by volume "buildup" in USDT, highest first
const sortedResults = computed(() => [...results.value].sort((a, b) => b.volumeUsdt - a.volumeUsdt))

const scanProgressPct = computed(() => {
  if (!scanProgress.value.total) return 0
  return Math.min(100, Math.round((scanProgress.value.done / scanProgress.value.total) * 100))
})

onMounted(async () => {
  const localStorageFuturesMaxLeverage = localStorage.getItem('CACHED_FUTURES_SYMBOLS')
  if (localStorageFuturesMaxLeverage) {
    chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage) as FuturesSymbol[]
  }
  await runScan()
})

watch(selectedInterval, () => {
  runScan()
})

async function fetchKlines(symbol: string, interval: Interval): Promise<CandleEntry[]> {
  const endTime = Date.now()
  const lookbackDays = LOOKBACK_DAYS_BY_INTERVAL[interval]
  const startTime = endTime - lookbackDays * 24 * 60 * 60 * 1000
  const url = `${BINANCE_FUTURES_BASE}?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${CANDLE_LIMIT}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${symbol}: ${res.status}`)
  const raw: unknown[][] = await res.json()
  return raw.map(k => ({
    symbol,
    openTime: k[0] as number,
    open: +k[1]!,
    high: +k[2]!,
    low: +k[3]!,
    close: +k[4]!,
    close_atr_adjusted: 0,
    close_atr_abs_change: 0,
    volume: +k[5]!,
    closeTime: k[6] as number,
    duration: (k[6] as number) - (k[0] as number),
    closed: true,
    support: null,
    resistance: null,
    breakthrough_resistance: false,
    breakthrough_support: false,
    status: '',
    side: '',
    tpPrice: 0,
    slPrice: 0,
    zoneAnalysis: null,
    volumeAnalysis: null,
    overboughSoldAnalysis: null,
    pastVolumeAnalysis: null,
    candleData: null,
    pnl: 0,
    leverage: 0,
    margin: 0,
    entryFee: 0,
    priceZone: null,
    priceZoneInteraction: null,
    closeAbsDistanceToZone: null,
    priceZoneEvaluation: null,
    patternTrack: '',
    isPoint: false,
    isWeakening: false,
  })) as CandleEntry[]
}

// ---------------- pattern detection ----------------

interface Pivot {
  index: number
  price: number
}

// a pivot high is a candle whose high is the max within [i-left, i+right]
function findPivotHighs(candles: CandleEntry[], left = 2, right = 2): Pivot[] {
  const pivots: Pivot[] = []
  for (let i = left; i < candles.length - right; i++) {
    const window = candles.slice(i - left, i + right + 1)
    const isHigh = window.every(c => c.high <= candles[i].high)
    if (isHigh) pivots.push({ index: i, price: candles[i].high })
  }
  return pivots
}

// a pivot low is a candle whose low is the min within [i-left, i+right]
function findPivotLows(candles: CandleEntry[], left = 2, right = 2): Pivot[] {
  const pivots: Pivot[] = []
  for (let i = left; i < candles.length - right; i++) {
    const window = candles.slice(i - left, i + right + 1)
    const isLow = window.every(c => c.low >= candles[i].low)
    if (isLow) pivots.push({ index: i, price: candles[i].low })
  }
  return pivots
}

function linearRegression(points: Pivot[]): { slope: number; intercept: number; rSquared: number } | null {
  const n = points.length
  if (n < 2) return null
  const sumX = points.reduce((s, p) => s + p.index, 0)
  const sumY = points.reduce((s, p) => s + p.price, 0)
  const sumXY = points.reduce((s, p) => s + p.index * p.price, 0)
  const sumX2 = points.reduce((s, p) => s + p.index * p.index, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const meanY = sumY / n
  const ssTot = points.reduce((s, p) => s + (p.price - meanY) ** 2, 0)
  const ssRes = points.reduce((s, p) => s + (p.price - (slope * p.index + intercept)) ** 2, 0)
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, rSquared }
}

function countTouches(
  candles: CandleEntry[],
  slope: number,
  intercept: number,
  side: 'high' | 'low',
  tolerance: number
): number {
  let touches = 0
  candles.forEach((c, i) => {
    const lineY = slope * i + intercept
    const price = side === 'high' ? c.high : c.low
    if (Math.abs(price - lineY) <= tolerance) touches++
  })
  return touches
}

/**
 * Angel fish head pattern = a descending line drawn through a series of lower
 * highs, and an ascending line drawn through a series of higher lows, both
 * lines touching most of the candles they pass near, narrowing (squeezing)
 * toward an apex like a fish's head profile. This flags a volatility
 * contraction with a breakout imminent in either direction.
 */
function detectAngelFishPattern(fullCandles: CandleEntry[], windowSize = PATTERN_WINDOW): AngelFishPattern | null {
  if (fullCandles.length < windowSize) return null
  const candles = fullCandles.slice(-windowSize)

  const pivotHighs = findPivotHighs(candles)
  const pivotLows = findPivotLows(candles)
  if (pivotHighs.length < 3 || pivotLows.length < 3) return null

  // bias toward the most recent swings so the line reflects the current squeeze
  const recentHighs = pivotHighs.slice(-6)
  const recentLows = pivotLows.slice(-6)

  const highLine = linearRegression(recentHighs)
  const lowLine = linearRegression(recentLows)
  if (!highLine || !lowLine) return null

  // shape requirement: lower highs (descending) + higher lows (ascending)
  if (highLine.slope >= 0 || lowLine.slope <= 0) return null

  const avgRange = candles.reduce((s, c) => s + (c.high - c.low), 0) / candles.length
  const tolerance = avgRange * 0.35

  const touchesUpper = countTouches(candles, highLine.slope, highLine.intercept, 'high', tolerance)
  const touchesLower = countTouches(candles, lowLine.slope, lowLine.intercept, 'low', tolerance)

  // "hitting most of the candles that interact with it" -> require real coverage, not just 2 points
  const minTouches = Math.max(3, Math.floor(candles.length * 0.15))
  if (touchesUpper < minTouches || touchesLower < minTouches) return null

  const startX = 0
  const endX = candles.length - 1
  const widthStart = highLine.slope * startX + highLine.intercept - (lowLine.slope * startX + lowLine.intercept)
  const widthEnd = highLine.slope * endX + highLine.intercept - (lowLine.slope * endX + lowLine.intercept)

  // must be a real, non-crossed, narrowing wedge
  if (widthStart <= 0 || widthEnd <= 0 || widthEnd >= widthStart) return null
  const convergenceRatio = widthEnd / widthStart

  const slopeDiff = highLine.slope - lowLine.slope
  const apexX = slopeDiff !== 0 ? (lowLine.intercept - highLine.intercept) / slopeDiff : null
  const apexBarsAway = apexX !== null ? Math.round(apexX - endX) : null

  // where the last close sits inside the wedge: near the lower line -> more room to break up, and vice versa
  const lastClose = candles[candles.length - 1].close
  const upperNow = highLine.slope * endX + highLine.intercept
  const lowerNow = lowLine.slope * endX + lowLine.intercept
  const posInWedge = (lastClose - lowerNow) / (upperNow - lowerNow || 1)
  let bias: AngelFishPattern['bias'] = 'neutral'
  if (posInWedge < 0.4) bias = 'up'
  else if (posInWedge > 0.6) bias = 'down'

  const touchScore = Math.min(1, (touchesUpper + touchesLower) / (candles.length * 0.5))
  const fitScore = Math.max(0, (highLine.rSquared + lowLine.rSquared) / 2)
  const squeezeScore = Math.max(0, 1 - convergenceRatio)
  const apexScore = apexBarsAway !== null && apexBarsAway > 0 && apexBarsAway <= windowSize ? 1 : 0.4

  const score = Math.round((touchScore * 0.35 + fitScore * 0.25 + squeezeScore * 0.25 + apexScore * 0.15) * 100)

  return {
    upper: { slope: highLine.slope, intercept: highLine.intercept, rSquared: highLine.rSquared, touches: touchesUpper },
    lower: { slope: lowLine.slope, intercept: lowLine.intercept, rSquared: lowLine.rSquared, touches: touchesLower },
    convergenceRatio,
    apexBarsAway,
    bias,
    score,
  }
}

// volume "buildup" converted to an approximate USDT value (volume * close, summed over recent candles)
function estimateVolumeUsdt(candles: CandleEntry[], lastN = 20): number {
  const recent = candles.slice(-lastN)
  return recent.reduce((sum, c) => sum + c.volume * c.close, 0)
}

// ---------------- scan orchestration ----------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function scanSymbol(symbol: string): Promise<ScanResult | null> {
  const candles = await fetchKlines(symbol, selectedInterval.value)
  const pattern = detectAngelFishPattern(candles)
  if (!pattern) return null
  return {
    symbol,
    lastPrice: candles[candles.length - 1]?.close ?? 0,
    volumeUsdt: estimateVolumeUsdt(candles),
    candles,
    pattern,
  }
}

async function runScan() {
  if (scanning.value) return
  const symbolList = symbols.value
  if (!symbolList.length) return

  scanning.value = true
  results.value = []
  errorSymbols.value = []
  scanProgress.value = { done: 0, total: symbolList.length }

  const REQUEST_DELAY_MS = 400

  for (const symbol of symbolList) {
    try {
      const result = await scanSymbol(symbol)
      if (result) results.value.push(result)
    } catch {
      errorSymbols.value.push(symbol)
    } finally {
      scanProgress.value.done++
    }
    await sleep(REQUEST_DELAY_MS)
  }

  scanning.value = false
}

function formatUsdt(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
}

function openEntryHistory(result: ScanResult) {
  selectedSymbol.value = result.symbol
  selectedSymbolCandleEntries.value = result.candles
  showEntryHistory.value = true
}
</script>

<style scoped>
.angel-fish-scanner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scanner-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.interval-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  opacity: 0.8;
}

.interval-select {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
}

.rescan-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.rescan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.result-count {
  font-size: 13px;
  opacity: 0.7;
}

.scanner-empty {
  padding: 24px;
  text-align: center;
  opacity: 0.6;
}

.progress-bar-track {
  position: relative;
  width: 100%;
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80, #22d3ee);
  transition: width 0.2s ease;
}

.progress-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  mix-blend-mode: difference;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.results-table th {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  opacity: 0.7;
  font-weight: 500;
}

.results-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.result-row {
  cursor: pointer;
}

.result-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.symbol-cell {
  font-weight: 600;
}

.score-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.score-badge.score-high {
  background: rgba(80, 200, 120, 0.2);
  color: #4ade80;
}

.bias-tag {
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: capitalize;
}

.bias-up {
  background: rgba(80, 200, 120, 0.15);
  color: #4ade80;
}

.bias-down {
  background: rgba(220, 80, 80, 0.15);
  color: #f87171;
}

.bias-neutral {
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
}
</style>