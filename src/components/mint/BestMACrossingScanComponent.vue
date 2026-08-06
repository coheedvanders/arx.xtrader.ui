<!-- BestMACrossingScanComponent.vue -->
<template>
  <div class="ma200-cross-scanner">
    <div class="scanner-controls">
      <button class="start-btn" :disabled="scanning" @click="startScan()">
        {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Start' }}
      </button>

      <label class="interval-select-label">
        Interval
        <select
          class="interval-select"
          v-model="selectedInterval"
          :disabled="scanning || isScheduleActive"
          @change="onIntervalChange"
        >
          <option v-for="opt in intervalOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </label>

      <div v-if="convictionAnalyzing" class="schedule-status">
        Analyzing conviction {{ convictionProgress.done }}/{{ convictionProgress.total }}…
      </div>

      <div v-if="positionsLoading" class="schedule-status">
        Checking open positions…
      </div>

      <label class="interval-input-label">
        Every
        <input
          type="number"
          class="interval-input"
          v-model.number="scheduleMinutes"
          min="1"
          :disabled="isScheduleActive"
        />
        min
      </label>

      <button class="schedule-btn" :class="{ active: isScheduleActive }" @click="toggleSchedule">
        {{ isScheduleActive ? 'Stop Auto Scan' : 'Start Auto Scan' }}
      </button>

      <button class="test-alert-btn" @click="testAlert">Test Alert</button>

      <span class="result-count">
        {{ dailyCrossResults.length }} 1D cross(es) / {{ intradayCrossResults.length }} {{ selectedInterval }} cross(es)
      </span>
      <span v-if="errorSymbols.length" class="error-count">{{ errorSymbols.length }} failed</span>

      <label class="display-toggle">
        <input type="checkbox" v-model="showAllSymbols" />
        Display Symbols
      </label>
    </div>

    <div v-if="isScheduleActive" class="schedule-status">
      Auto-scanning every {{ scheduleMinutes }} minute(s). Next run: {{ nextRunLabel }}
    </div>

    <div v-if="scanning" class="progress-bar-track">
      <div class="progress-bar-fill" :style="{ width: `${scanProgressPct}%` }" />
      <span class="progress-bar-label">{{ scanProgress.done }} / {{ scanProgress.total }}</span>
    </div>

    <!-- debug view: every symbol scanned + all captured MAs, for cross-checking against Binance -->
    <div v-if="showAllSymbols" class="debug-panel">
      <div class="debug-panel-header">
        Captured MA per symbol ({{ allScanned.length }} scanned)
      </div>
      <table v-if="allScanned.length" class="results-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>1D 200 MA</th>
            <th>{{ selectedInterval }} 200 MA</th>
            <th>15M 100 MA</th>
            <th>Last Daily Close</th>
            <th>Last {{ selectedInterval }} Close</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in allScanned" :key="s.symbol">
            <td class="symbol-cell">{{ s.symbol }}</td>
            <td>{{ s.dailyMa200 !== null ? s.dailyMa200.toFixed(6) : 'n/a' }}</td>
            <td>{{ s.intradayMa200 !== null ? s.intradayMa200.toFixed(6) : 'n/a' }}</td>
            <td>{{ s.ma100_15m !== null ? s.ma100_15m.toFixed(6) : 'n/a' }}</td>
            <td>{{ s.lastDailyClose !== null ? s.lastDailyClose : 'n/a' }}</td>
            <td>{{ s.last15mClose !== null ? s.last15mClose : 'n/a' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="scanner-empty">No symbols scanned yet. Hit Start.</div>
    </div>

    <template v-if="!showAllSymbols">
      <div class="results-section">
        <div class="results-section-header">1D 200 MA crossing from {{ selectedInterval }}</div>
        <div v-if="!scanning && !dailyCrossResults.length" class="scanner-empty">
          No {{ selectedInterval }} candle has crossed the 1D 200 MA yet.
        </div>
        <table v-else-if="dailyCrossResults.length" class="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Direction</th>
              <th>% Gap</th>
              <th>MA Stack</th>
              <th>Above MA100</th>
              <th>Below MA100</th>
              <th>MA200 &Delta;%</th>
              <th>Long</th>
              <th>Short</th>
              <th class="actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in dailyCrossResults"
              :key="r.symbol"
              class="result-row"
              :class="{ 'is-reviewed': isReviewed(r.symbol) }"
              @click="openEntryHistory(r)"
            >
              <td class="symbol-cell">
                {{ r.symbol }}
                <span v-if="isOpenPosition(r.symbol)" class="open-position-tag">(open)</span>
              </td>
              <td>
                <span :class="['direction-tag', `direction-${r.direction}`]">
                  {{ r.direction === 'crossed-up' ? 'Crossed Up' : 'Crossed Down' }}
                </span>
              </td>
              <td class="gap-cell">{{ maGapPercent(r) }}</td>
              <td>
                <div class="ma-stack-cell">
                  <div
                    v-for="seg in maStackOrder(r)"
                    :key="seg.key"
                    class="ma-stack-segment"
                    :class="seg.key"
                  >
                    {{ seg.label }}
                  </div>
                </div>
              </td>
              <td class="ma-count-cell above">{{ r.aboveMa100Count }}</td>
              <td class="ma-count-cell below">{{ r.belowMa100Count }}</td>
              <td class="ma-count-cell" :class="maChangeClass(r)">{{ maChangeLabel(r) }}</td>
              <td>
                <span v-if="convictionFor(r.symbol) === 'pending'" class="conviction-cell pending">—</span>
                <span v-else-if="convictionFor(r.symbol) === 'loading'" class="conviction-cell loading">…</span>
                <span v-else-if="convictionFor(r.symbol) === 'error'" class="conviction-cell error">err</span>
                <span v-else :class="['conviction-tag', convictionClass((convictionFor(r.symbol) as any).long)]">
                  {{ (convictionFor(r.symbol) as any).long }}
                </span>
              </td>
              <td>
                <span v-if="convictionFor(r.symbol) === 'pending'" class="conviction-cell pending">—</span>
                <span v-else-if="convictionFor(r.symbol) === 'loading'" class="conviction-cell loading">…</span>
                <span v-else-if="convictionFor(r.symbol) === 'error'" class="conviction-cell error">err</span>
                <span v-else :class="['conviction-tag', convictionClass((convictionFor(r.symbol) as any).short)]">
                  {{ (convictionFor(r.symbol) as any).short }}
                </span>
              </td>
              <td class="actions-col">
                <button class="see-ma-btn" @click.stop="openMaVisualizer(r.symbol)">See MA</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="results-section">
        <div class="results-section-header">{{ selectedInterval }} 200 MA crossing (confirmed by prior 15m 100 MA cross)</div>
        <div v-if="!scanning && !intradayCrossResults.length" class="scanner-empty">
          No {{ selectedInterval }} candle has crossed its own 200 MA yet.
        </div>
        <table v-else-if="intradayCrossResults.length" class="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Direction</th>
              <th>% Gap</th>
              <th>MA Stack</th>
              <th>Above MA100</th>
              <th>Below MA100</th>
              <th>MA200 &Delta;%</th>
              <th>Long</th>
              <th>Short</th>
              <th class="actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in intradayCrossResults"
              :key="r.symbol"
              class="result-row"
              :class="{ 'is-reviewed': isReviewed(r.symbol) }"
              @click="openEntryHistory(r)"
            >
              <td class="symbol-cell">
                {{ r.symbol }}
                <span v-if="isOpenPosition(r.symbol)" class="open-position-tag">(open)</span>
              </td>
              <td>
                <span :class="['direction-tag', `direction-${r.direction}`]">
                  {{ r.direction === 'crossed-up' ? 'Crossed Up' : 'Crossed Down' }}
                </span>
              </td>
              <td class="gap-cell">{{ maGapPercent(r) }}</td>
              <td>
                <div class="ma-stack-cell">
                  <div
                    v-for="seg in maStackOrder(r)"
                    :key="seg.key"
                    class="ma-stack-segment"
                    :class="seg.key"
                  >
                    {{ seg.label }}
                  </div>
                </div>
              </td>
              <td class="ma-count-cell above">{{ r.aboveMa100Count }}</td>
              <td class="ma-count-cell below">{{ r.belowMa100Count }}</td>
              <td class="ma-count-cell" :class="maChangeClass(r)">{{ maChangeLabel(r) }}</td>
              <td>
                <span v-if="convictionFor(r.symbol) === 'pending'" class="conviction-cell pending">—</span>
                <span v-else-if="convictionFor(r.symbol) === 'loading'" class="conviction-cell loading">…</span>
                <span v-else-if="convictionFor(r.symbol) === 'error'" class="conviction-cell error">err</span>
                <span v-else :class="['conviction-tag', convictionClass((convictionFor(r.symbol) as any).long)]">
                  {{ (convictionFor(r.symbol) as any).long }}
                </span>
              </td>
              <td>
                <span v-if="convictionFor(r.symbol) === 'pending'" class="conviction-cell pending">—</span>
                <span v-else-if="convictionFor(r.symbol) === 'loading'" class="conviction-cell loading">…</span>
                <span v-else-if="convictionFor(r.symbol) === 'error'" class="conviction-cell error">err</span>
                <span v-else :class="['conviction-tag', convictionClass((convictionFor(r.symbol) as any).short)]">
                  {{ (convictionFor(r.symbol) as any).short }}
                </span>
              </td>
              <td class="actions-col">
                <button class="see-ma-btn" @click.stop="openMaVisualizer(r.symbol)">See MA</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
      <DialogHeaderComponent>
        {{ selectedSymbol }}
      </DialogHeaderComponent>
      <CandleEntryHistoryComponent :symbol="selectedSymbol" :candle-entries="selectedSymbolCandleEntries" />
    </DialogComponent>

    <DialogComponent v-model="showMACrossing" :width="'95vw'">
      <DialogHeaderComponent>
        {{ selectedSymbol }}
      </DialogHeaderComponent>
      <MACrosingVisualizer v-if="showMACrossing" :symbol="selectedSymbol" />
    </DialogComponent>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

// ---- adjust these import paths to match your project structure ----
import { KlineUtility } from '@/utility/klineUtility'
import { OrderMakerUtility } from '@/utility/OrderMakerUtility.ts';
import { useChocoMintoStore } from '@/stores/chocoMintoStore'
import type { FuturesSymbol, Candle, CandleEntry, Position } from '@/core/interfaces.ts';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import MACrosingVisualizer from './MACrossingVisualizerComponent.vue';
// ---------------------------------------------------------------------

import { buildMaCapturePayload } from '@/utility/maCapturePayload'
import { analyzeMaStructure } from '@/utility/maStructureAnalysis'
import type { ConvictionLevel } from '@/utility/maStructureAnalysis'
import { candleAnalyzer } from '@/utility/candleAnalyzerUtility.ts';
import { SimulationUtility } from '@/utility/simulationUtility.ts';

// how many 15m candles to pull per symbol for the conviction pass —
// matches the "3D" preset in the MA visualizer's capture panel
const CONVICTION_CAPTURE_CANDLES = 288
const CONVICTION_DELAY_MS = 400

type ConvictionCell = 'pending' | 'loading' | 'error' | { long: ConvictionLevel; short: ConvictionLevel }

const convictionAnalyzing = ref(false)
const convictionProgress = ref({ done: 0, total: 0 })
const convictionResults = ref<Record<string, ConvictionCell>>({})

function convictionFor(symbol: string): ConvictionCell {
  return convictionResults.value[symbol] ?? 'pending'
}

function convictionClass(level: ConvictionLevel): string {
  return level === 'High' ? 'bullish' : level === 'Moderate' ? 'neutral' : 'bearish'
}

// returns the two MA segments ordered top-to-bottom by value, so the higher
// one always renders on top of the stacked bar (blue = MA100, orange = MA200)
function maStackOrder(r: MaCrossResult): { key: 'ma100' | 'ma200'; label: string }[] {
  const ma200Seg = { key: 'ma200' as const, label: 'MA200' }
  if (r.ma100 === null) return [ma200Seg]
  const ma100Seg = { key: 'ma100' as const, label: 'MA100' }
  return r.ma100 > r.ma200 ? [ma100Seg, ma200Seg] : [ma200Seg, ma100Seg]
}

// % distance between the 200 MA and the 100 MA, relative to the lower of
// the two — how "squeezed" or "stretched apart" the two lines currently are
function maGapPercent(r: MaCrossResult): string {
  if (r.ma100 === null || r.ma100 === 0 || r.ma200 === 0) return 'n/a'
  const lower = Math.min(r.ma100, r.ma200)
  const gap = (Math.abs(r.ma200 - r.ma100) / lower) * 100
  return `${gap.toFixed(2)}%`
}

// formatted % change of the row's own 200 MA from the crossing point to now, e.g. "+3.42%"
function maChangeLabel(r: MaCrossResult): string {
  if (r.maChangePercent === null) return 'n/a'
  const sign = r.maChangePercent > 0 ? '+' : ''
  return `${sign}${r.maChangePercent.toFixed(2)}%`
}

function maChangeClass(r: MaCrossResult): string {
  if (r.maChangePercent === null) return ''
  return r.maChangePercent > 0 ? 'positive' : r.maChangePercent < 0 ? 'negative' : ''
}

// sequential, one symbol at a time — only over symbols that actually crossed,
// so it never touches the full watchlist
async function runConvictionAnalysis() {
  const uniqueSymbols = Array.from(new Set([
    ...dailyCrossResults.value.map(r => r.symbol),
    ...intradayCrossResults.value.map(r => r.symbol),
  ]))
  if (!uniqueSymbols.length) return

  convictionAnalyzing.value = true
  convictionProgress.value = { done: 0, total: uniqueSymbols.length }
  uniqueSymbols.forEach(s => { convictionResults.value[s] = 'pending' })

  for (const symbol of uniqueSymbols) {
    convictionResults.value[symbol] = 'loading'
    try {
      const payload = await buildMaCapturePayload(symbol, CONVICTION_CAPTURE_CANDLES)
      const analysis = analyzeMaStructure(payload)
      const result = { long: analysis.conviction.long, short: analysis.conviction.short }
      convictionResults.value[symbol] = result

      if (result.long === 'High') speakHighConviction(symbol, 'long')
      if (result.short === 'High') speakHighConviction(symbol, 'short')
    } catch (err) {
      console.error(`Conviction analysis failed for ${symbol}:`, err)
      convictionResults.value[symbol] = 'error'
    } finally {
      convictionProgress.value.done++
    }
    await sleep(CONVICTION_DELAY_MS)
  }

  convictionAnalyzing.value = false
}

// ── Open positions (fetched once per scan, so "(open)" stays fresh) ────────
const positionsLoading = ref(false)
const openPositionSymbols = ref<Set<string>>(new Set())

function isOpenPosition(symbol: string): boolean {
  return openPositionSymbols.value.has(symbol)
}

async function loadOpenPositions() {
  positionsLoading.value = true
  try {
    const positions: Position[] = await OrderMakerUtility.getPositions()
    openPositionSymbols.value = new Set(positions.map(p => p.symbol))
  } catch (err) {
    console.error('Failed to fetch open positions:', err)
    // leave whatever set we already had rather than wiping the "(open)" tags on a transient failure
  } finally {
    positionsLoading.value = false
  }
}

const props = withDefaults(
  defineProps<{
    interval?: string
    maxInitCandles?: number
  }>(),
  {
    interval: '15m',
    maxInitCandles: 100,
  }
)

// ── Dynamic interval selector ───────────────────────────────────────────
// The scanner's main interval used to be a fixed prop. It's now switchable
// from the UI; `props.interval` still seeds the initial value so existing
// parent usage keeps working unchanged.
const intervalOptions = ['15m', '1h', '4h', '1d'] as const
type ScanInterval = typeof intervalOptions[number]

const selectedInterval = ref<ScanInterval>(
  (intervalOptions as readonly string[]).includes(props.interval) ? (props.interval as ScanInterval) : '15m'
)

// switching interval invalidates any results gathered under the old
// timeframe, so clear everything rather than show mismatched rows
function onIntervalChange() {
  dailyCrossResults.value = []
  intradayCrossResults.value = []
  allScanned.value = []
  errorSymbols.value = []
  reviewedSymbols.value = new Set()
  convictionResults.value = {}
}

const chocoMintoStore = useChocoMintoStore()

const DAILY_MA_PERIOD = 200
// buffer above 200 so the SMA has a full 200 *closed* daily candles to work with
const DAILY_CANDLE_LIMIT = 210

const INTRADAY_MA_PERIOD = 200
// the selected-interval series also needs >= 200 candles for its own MA
const INTRADAY_CANDLE_MIN = 210

// how many candles to keep for the interval series overall — the entry
// history dialog (opened when a row is clicked) displays this same series,
// so it's fetched wide enough to give a full 1000-candle history there too
const ENTRY_HISTORY_CANDLES = 1000

// dedicated 15m 100-period MA — used purely as a confirming/filter line for
// the selected-interval 200 MA cross below. It is never surfaced as its own
// crossing result. The limit includes enough buffer beyond MA100_PERIOD so a
// rolling MA100 value can still be computed back at the crossing point
// (crossIdx can sit up to PRIOR_BREAK_LOOKBACK candles behind the latest one).
const MA100_PERIOD = 100
const MA100_CANDLE_LIMIT = 140
const MA100_INTERVAL = '15m'

interface MaCrossResult {
  symbol: string
  ma200: number
  direction: 'crossed-up' | 'crossed-down'
  latestCandle: Candle
  candles: CandleEntry[] // the fetched interval candles, shown in the entry history dialog
  ma100: number | null // 15m 100 MA value, used only for the MA-quality columns below
  aboveMa100Count: number // 15m candles closing above ma100 since the last MA100 cross
  belowMa100Count: number // 15m candles closing below ma100 since the last MA100 cross
  maChangePercent: number | null // % change of this row's 200 MA from the crossing point to now
}

interface ScanSymbolOutcome {
  daily: MaCrossResult | null
  intraday: MaCrossResult | null
}

interface ScannedSymbolDebug {
  symbol: string
  dailyMa200: number | null
  intradayMa200: number | null
  ma100_15m: number | null
  lastDailyClose: number | null
  lastIntervalClose: number | null
  last15mClose: number | null
}

const scanning = ref(false)
const scanProgress = ref({ done: 0, total: 0 })
const dailyCrossResults = ref<MaCrossResult[]>([])
const intradayCrossResults = ref<MaCrossResult[]>([])
const errorSymbols = ref<string[]>([])

// debug / testing toggle: shows every scanned symbol + all captured MAs
// so you can manually cross-check the values against Binance's chart
const showAllSymbols = ref(false)
const allScanned = ref<ScannedSymbolDebug[]>([])

// scheduled auto-run
const scheduleMinutes = ref(5)
const isScheduleActive = ref(false)
const nextRunAt = ref<number | null>(null)
const nextRunLabel = ref('—')
let scheduleTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

const showEntryHistory = ref(false)
const showMACrossing = ref(false)
const selectedSymbol = ref('')
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])

// Symbols the user has already opened (via row click or "See MA") — rendered
// with an orange highlight so it's obvious at a glance what's been reviewed.
const reviewedSymbols = ref<Set<string>>(new Set())

function isReviewed(symbol: string): boolean {
  return reviewedSymbols.value.has(symbol)
}

function markReviewed(symbol: string) {
  reviewedSymbols.value.add(symbol)
}

const symbols = computed<string[]>(() => chocoMintoStore.futureSymbols?.map((c: FuturesSymbol) => c.symbol) || [])

const scanProgressPct = computed(() => {
  if (!scanProgress.value.total) return 0
  return Math.min(100, Math.round((scanProgress.value.done / scanProgress.value.total) * 100))
})

onMounted(async () => {
  const localStorageFuturesMaxLeverage = localStorage.getItem('CACHED_FUTURES_SYMBOLS')
  if (localStorageFuturesMaxLeverage) {
    chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage) as FuturesSymbol[]
  }
})

function calculateSma(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null
  const relevant = candles.slice(-period)
  const sum = relevant.reduce((s, c) => s + c.close, 0)
  return sum / period
}

// same rolling SMA, but ending at a specific historical index instead of the
// end of the array — used to reconstruct what a MA value was back at an
// earlier point in time
function calculateSmaAtIndex(candles: Candle[], period: number, endIndexInclusive: number): number | null {
  const startIndex = endIndexInclusive - period + 1
  if (startIndex < 0) return null
  const relevant = candles.slice(startIndex, endIndexInclusive + 1)
  const sum = relevant.reduce((s, c) => s + c.close, 0)
  return sum / period
}

// highest index whose candle opened at or before the given timestamp — used
// to locate the equivalent point in a different timeframe's candle series
function findIndexAtOrBefore(candles: Candle[], timestamp: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].openTime <= timestamp) return i
  }
  return -1
}

// % change of a 200 MA series from where it stood at `crossTimestamp` to its
// current value — reconstructs the historical MA at the matching candle in
// this series, then compares it to the current MA
function computeMa200ChangePercent(
  candles: Candle[],
  period: number,
  currentMa: number | null,
  crossTimestamp: number | null,
): number | null {
  if (currentMa === null || crossTimestamp === null) return null
  const idx = findIndexAtOrBefore(candles, crossTimestamp)
  if (idx === -1) return null
  const maAtCross = calculateSmaAtIndex(candles, period, idx)
  if (maAtCross === null || maAtCross === 0) return null
  return ((currentMa - maAtCross) / maAtCross) * 100
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function checkCross(latest: Candle, ma: number): 'crossed-up' | 'crossed-down' | null {
  if (latest.open < ma && latest.close > ma) return 'crossed-up'
  if (latest.open > ma && latest.close < ma) return 'crossed-down'
  return null
}

// only surface a cross when the MA stack agrees with the direction:
// crossed-up requires MA200 already above MA100, crossed-down requires
// MA200 already below MA100 — filters out crosses against a misaligned stack
function isAlignedWithMaStack(
  direction: 'crossed-up' | 'crossed-down',
  ma200: number,
  ma100: number | null,
): boolean {
  if (ma100 === null) return false
  if (direction === 'crossed-up') return ma200 > ma100
  return ma200 < ma100
}

// how many candles back to look for a prior crossing of the 100 MA, used to
// confirm a fresh 200 MA cross on the current candle
const PRIOR_BREAK_LOOKBACK = 20

// index (within `candles`) of the most recent candle, prior to the latest
// one, that crossed the given MA level within the lookback window. Returns
// -1 if no such crossing is found.
function findLastCrossIndex(candles: Candle[], ma: number, lookback: number = PRIOR_BREAK_LOOKBACK): number {
  if (candles.length < 2) return -1
  const lastIdx = candles.length - 1 // exclude the most recent candle itself
  const searchFloor = Math.max(0, lastIdx - lookback)
  for (let i = lastIdx - 1; i >= searchFloor; i--) {
    if (checkCross(candles[i], ma) !== null) return i
  }
  return -1
}

// counts how many candles, from the last MA100 cross point through the
// latest candle (inclusive), closed above vs below the MA100 level — a
// quality/consistency read on the move since that cross. Falls back to the
// lookback window if no prior cross was found.
function countAboveBelowMa(candles: Candle[], ma: number, crossIdx: number, lookback: number = PRIOR_BREAK_LOOKBACK) {
  const startIdx = crossIdx !== -1 ? crossIdx : Math.max(0, candles.length - 1 - lookback)
  let aboveCount = 0
  let belowCount = 0
  for (let i = startIdx; i < candles.length; i++) {
    const close = candles[i].close
    if (close > ma) aboveCount++
    else if (close < ma) belowCount++
  }
  return { aboveCount, belowCount }
}

async function scanSymbol(symbol: string): Promise<ScanSymbolOutcome> {
  const interval = selectedInterval.value

  // 1) 1D 200 SMA
  const dailyCandles = await KlineUtility.getRecentKlines(symbol, '1d', DAILY_CANDLE_LIMIT)
  const dailyMa200 = calculateSma(dailyCandles, DAILY_MA_PERIOD)

  // 2) selected-interval candles - used both for the interval's own 200 MA
  // and to check the interval candle against the 1D 200 MA. Also fetched
  // wide enough (1000) to double as the full history shown in the entry
  // history dialog when the row is clicked.
  const intervalCandles = await KlineUtility.getRecentKlines(
    symbol,
    interval,
    Math.max(props.maxInitCandles, INTRADAY_CANDLE_MIN, ENTRY_HISTORY_CANDLES)
  )
  const intradayMa200 = calculateSma(intervalCandles, INTRADAY_MA_PERIOD)
  const latest = intervalCandles.length ? intervalCandles[intervalCandles.length - 1] : null

  // 3) dedicated 15m candles, solely to compute the 100 MA used as a
  // confirming filter for the 200 MA cross below. If the scanner's selected
  // interval is already 15m and we've already pulled enough candles for the
  // 200 MA (which needs more history than the 100 MA does), reuse that fetch
  // instead of hitting the API again.
  let m15Candles: Candle[]
  if (interval === MA100_INTERVAL && intervalCandles.length >= MA100_CANDLE_LIMIT) {
    m15Candles = intervalCandles
  } else {
    m15Candles = await KlineUtility.getRecentKlines(symbol, MA100_INTERVAL, MA100_CANDLE_LIMIT)
  }
  const ma100_15m = calculateSma(m15Candles, MA100_PERIOD)
  const latest15m = m15Candles.length ? m15Candles[m15Candles.length - 1] : null

  // record for the "Display Symbols" debug view regardless of whether a cross happened
  allScanned.value.push({
    symbol,
    dailyMa200,
    intradayMa200,
    ma100_15m,
    lastDailyClose: dailyCandles.length ? dailyCandles[dailyCandles.length - 1].close : null,
    lastIntervalClose: latest ? latest.close : null,
    last15mClose: latest15m ? latest15m.close : null,
  })

  // where the 100 MA was last crossed, and the above/below tally since that
  // point — computed once and reused for both the confirmation filter and
  // the "MA Stack" / "Above MA100" / "Below MA100" display columns
  const ma100CrossIdx = ma100_15m !== null ? findLastCrossIndex(m15Candles, ma100_15m) : -1
  const { aboveCount, belowCount } = ma100_15m !== null
    ? countAboveBelowMa(m15Candles, ma100_15m, ma100CrossIdx)
    : { aboveCount: 0, belowCount: 0 }

  // timestamp of the crossing candle — used to locate the equivalent point
  // in the daily / selected-interval series so we can compare each row's own
  // 200 MA then vs now
  const crossTimestamp = ma100CrossIdx !== -1 ? m15Candles[ma100CrossIdx].openTime : null

  // % change of the 200 MA itself, from where it stood at the crossing point
  // to where it stands now — how much the trend line has moved since the
  // cross, computed against each table's own 200 MA series
  const dailyMaChangePercent = computeMa200ChangePercent(dailyCandles, DAILY_MA_PERIOD, dailyMa200, crossTimestamp)
  const intradayMaChangePercent = computeMa200ChangePercent(intervalCandles, INTRADAY_MA_PERIOD, intradayMa200, crossTimestamp)

  const outcome: ScanSymbolOutcome = { daily: null, intraday: null }

  candleAnalyzer.initializePastCandlesSupportResistance(intervalCandles,1000 - 10,10);

  selectedSymbolCandleEntries.value = []
  selectedSymbolCandleEntries.value = intervalCandles.map(c => ({
            ...c,
            close_atr_abs_change: 0,
            close_atr_adjusted: 0,
            symbol: selectedSymbol.value,
            status: '',
            side: '',
            tpPrice: 0,
            duration: 0,
            slPrice: 0,
            zoneAnalysis: null,
            volumeAnalysis: null,
            overboughSoldAnalysis: null,
            pastVolumeAnalysis: null,
            candleData: null,
            priceZone: null,
            priceZoneInteraction: null,
            pnl: 0,
            leverage: 0,
            margin: 0,
            entryFee: 0,
            zoneSizePercentage: 0,
            closeAbsDistanceToZone: null,
            priceZoneEvaluation: null,
            patternTrack: "",
            isPoint: false,
            isWeakening: false
        }));

  candleAnalyzer.trackSwingPatterns(selectedSymbolCandleEntries.value);

  await SimulationUtility.markPositionEntries(
        1,
        10,
        1,
        1,
        symbol,
        selectedSymbolCandleEntries.value,
        50,
        selectedSymbolCandleEntries.value.length - 1,
        chocoMintoStore.startingTimeStamp);

  if (latest) {
    if (dailyMa200 !== null) {
      const direction = checkCross(latest, dailyMa200)
      // only surface it if the MA stack agrees: crossed-up needs MA200 above
      // MA100, crossed-down needs MA200 below MA100
      if (direction && isAlignedWithMaStack(direction, dailyMa200, ma100_15m)) {
        outcome.daily = {
          symbol,
          ma200: dailyMa200,
          direction,
          latestCandle: latest,
          candles: selectedSymbolCandleEntries.value,
          ma100: ma100_15m,
          aboveMa100Count: aboveCount,
          belowMa100Count: belowCount,
          maChangePercent: dailyMaChangePercent,
        }
      }
    }

    if (intradayMa200 !== null) {
      const direction = checkCross(latest, intradayMa200)
      // the current candle crossed the 200 MA — confirm it with a PRIOR
      // crossing of the 100 MA (the filter line) within the lookback window,
      // and require the MA stack to agree with the direction, before
      // surfacing it as a result
      if (
        direction &&
        ma100_15m !== null &&
        ma100CrossIdx !== -1 &&
        isAlignedWithMaStack(direction, intradayMa200, ma100_15m)
      ) {
        outcome.intraday = {
          symbol,
          ma200: intradayMa200,
          direction,
          latestCandle: latest,
          candles: selectedSymbolCandleEntries.value,
          ma100: ma100_15m,
          aboveMa100Count: aboveCount,
          belowMa100Count: belowCount,
          maChangePercent: intradayMaChangePercent,
        }
      }
    }
  }

  return outcome
}

// sequential, one symbol at a time, with a pause between requests - no concurrency
async function startScan() {
  if (scanning.value) return
  const symbolList = symbols.value
  if (!symbolList.length) return

  scanning.value = true
  dailyCrossResults.value = []
  intradayCrossResults.value = []
  errorSymbols.value = []
  allScanned.value = []
  reviewedSymbols.value = new Set()
  scanProgress.value = { done: 0, total: symbolList.length }

  const REQUEST_DELAY_MS = 200

  for (const symbol of symbolList) {
    try {
      const outcome = await scanSymbol(symbol)
      if (outcome.daily) dailyCrossResults.value.push(outcome.daily)
      if (outcome.intraday) intradayCrossResults.value.push(outcome.intraday)
    } catch {
      errorSymbols.value.push(symbol)
    } finally {
      scanProgress.value.done++
    }
    await sleep(REQUEST_DELAY_MS)
  }

  scanning.value = false

  // Refresh open positions right after every scan so "(open)" next to a
  // symbol always reflects the latest state, not whatever was fetched
  // hours ago.
  await loadOpenPositions()

  const totalCrosses = dailyCrossResults.value.length + intradayCrossResults.value.length
  if (totalCrosses > 0) {
    speakAlert(totalCrosses)
    await runConvictionAnalysis()
  }
}

function speakHighConviction(symbol: string, direction: 'long' | 'short') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(`High ${direction} conviction on ${symbol}`)
  utterance.rate = 1
  utterance.volume = 1
  window.speechSynthesis.speak(utterance)
}

// speaks "{count} crosses found" twice using the browser's built-in text-to-speech
function speakAlert(count: number) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  const message = `${count} ${count === 1 ? 'cross' : 'crosses'} found`
  //window.speechSynthesis.cancel() // clear any queued/stuck utterances before speaking

  for (let i = 0; i < 2; i++) {
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.rate = 1
    utterance.volume = 1
    //window.speechSynthesis.speak(utterance)
  }
}

// lets you confirm the alert voice works without waiting for a real cross
function testAlert() {
  speakAlert(3)
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function scheduleNextRun() {
  nextRunAt.value = Date.now() + scheduleMinutes.value * 60 * 1000
}

function toggleSchedule() {
  if (isScheduleActive.value) {
    // stop
    isScheduleActive.value = false
    if (scheduleTimer) clearInterval(scheduleTimer)
    if (countdownTimer) clearInterval(countdownTimer)
    scheduleTimer = null
    countdownTimer = null
    nextRunAt.value = null
    nextRunLabel.value = '—'
    return
  }

  // start
  isScheduleActive.value = true

  const runIfIdle = () => {
    if (!scanning.value) startScan()
    scheduleNextRun()
  }

  runIfIdle() // kick off an immediate run, then schedule the rest
  scheduleTimer = setInterval(runIfIdle, scheduleMinutes.value * 60 * 1000)

  countdownTimer = setInterval(() => {
    if (nextRunAt.value === null) return
    nextRunLabel.value = formatCountdown(nextRunAt.value - Date.now())
  }, 1000)
}

onUnmounted(() => {
  if (scheduleTimer) clearInterval(scheduleTimer)
  if (countdownTimer) clearInterval(countdownTimer)
})

async function openEntryHistory(result: MaCrossResult) {
  markReviewed(result.symbol)
  selectedSymbol.value = result.symbol

  selectedSymbolCandleEntries.value = []
  selectedSymbolCandleEntries.value = result.candles

  showEntryHistory.value = true
}

// opens the MA Crossing Visualizer dialog for a given symbol without
// triggering the row's own click handler (openEntryHistory)
function openMaVisualizer(symbol: string) {
  markReviewed(symbol)
  selectedSymbol.value = symbol
  showMACrossing.value = true
}
</script>

<style scoped>
.ma200-cross-scanner {
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

.start-btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.result-count {
  font-size: 13px;
  opacity: 0.7;
}

.error-count {
  font-size: 13px;
  color: #f87171;
}

.interval-select-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.85;
}

.interval-select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.interval-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interval-input-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.85;
}

.interval-input {
  width: 56px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: inherit;
}

.schedule-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.schedule-btn.active {
  background: rgba(80, 200, 120, 0.2);
  border-color: rgba(80, 200, 120, 0.4);
  color: #4ade80;
}

.test-alert-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}

.schedule-status {
  font-size: 12px;
  opacity: 0.7;
}

.display-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.85;
  cursor: pointer;
  margin-left: auto;
}

.debug-panel {
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 10px;
}

.debug-panel-header {
  font-size: 12px;
  opacity: 0.6;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.results-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.results-section-header {
  font-size: 12px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  transition: background 0.15s ease;
}

/* Hover: clearer than the previous barely-visible tint */
.result-row:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}

/* Clicked / reviewed (row click or "See MA"): persistent orange highlight */
.result-row.is-reviewed {
  background: rgba(255, 152, 0, 0.14);
}

.result-row.is-reviewed:hover {
  background: rgba(255, 152, 0, 0.22);
}

.result-row.is-reviewed td:first-child {
  box-shadow: inset 3px 0 0 0 #ff9800;
}

.symbol-cell {
  font-weight: 600;
}

/* Shown next to a symbol's name when OrderMakerUtility.getPositions() reports
   a currently open position for it, e.g. "BTCUSDT (open)" */
.open-position-tag {
  margin-left: 4px;
  font-weight: 700;
  font-size: 11px;
  color: #4ade80;
}

/* MA100-vs-MA200 stacked bar: whichever value is higher renders on top */
.ma-stack-cell {
  display: flex;
  flex-direction: column;
  width: 64px;
  border-radius: 4px;
  overflow: hidden;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}

.ma-stack-segment {
  padding: 3px 0;
  color: #0b0e14;
}

.ma-stack-segment.ma100 {
  background: #42a5f5; /* blue */
}

.ma-stack-segment.ma200 {
  background: #ffa726; /* orange */
}

.ma-count-cell {
  text-align: center;
  font-weight: 600;
}

.ma-count-cell.above {
  color: #4ade80;
}

.ma-count-cell.below {
  color: #f87171;
}

.ma-count-cell.positive {
  color: #4ade80;
}

.ma-count-cell.negative {
  color: #f87171;
}

.gap-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.direction-tag {
  padding: 2px 8px;
  border-radius: 999px;
}

.direction-crossed-up {
  background: rgba(80, 200, 120, 0.15);
  color: #4ade80;
}

.direction-crossed-down {
  background: rgba(220, 80, 80, 0.15);
  color: #f87171;
}

/* ── "See MA" hover action ────────────────────────────────────────────── */
.actions-col {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

.see-ma-btn {
  opacity: 0;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(100, 181, 246, 0.4);
  background: rgba(100, 181, 246, 0.12);
  color: #64b5f6;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.result-row:hover .see-ma-btn,
.see-ma-btn:focus-visible {
  opacity: 1;
}

.see-ma-btn:hover {
  background: rgba(100, 181, 246, 0.22);
}

.conviction-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.conviction-tag.bullish { background: rgba(80, 200, 120, 0.18); color: #4ade80; }
.conviction-tag.bearish { background: rgba(239, 83, 80, 0.18); color: #ef5350; }
.conviction-tag.neutral { background: rgba(255, 183, 77, 0.18); color: #ffb74d; }

.conviction-cell.pending { opacity: 0.35; }
.conviction-cell.loading { opacity: 0.6; }
.conviction-cell.error { color: #f87171; font-size: 11px; }
</style>