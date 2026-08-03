<!-- BestMACrossingScanComponent.vue -->
<template>
  <div class="ma200-cross-scanner">
    <div class="scanner-controls">
      <button class="start-btn" :disabled="scanning" @click="startScan()">
        {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Start' }}
      </button>

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

      <span class="result-count">{{ dailyCrossResults.length }} 1D cross(es) / {{ intradayCrossResults.length }} 15M cross(es)</span>
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

    <!-- debug view: every symbol scanned + both captured MAs, for cross-checking against Binance -->
    <div v-if="showAllSymbols" class="debug-panel">
      <div class="debug-panel-header">
        Captured MA per symbol ({{ allScanned.length }} scanned)
      </div>
      <table v-if="allScanned.length" class="results-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>1D 200 MA</th>
            <th>15M 200 MA</th>
            <th>Last Daily Close</th>
            <th>Last 15M Close</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in allScanned" :key="s.symbol">
            <td class="symbol-cell">{{ s.symbol }}</td>
            <td>{{ s.dailyMa200 !== null ? s.dailyMa200.toFixed(6) : 'n/a' }}</td>
            <td>{{ s.intradayMa200 !== null ? s.intradayMa200.toFixed(6) : 'n/a' }}</td>
            <td>{{ s.lastDailyClose !== null ? s.lastDailyClose : 'n/a' }}</td>
            <td>{{ s.lastIntervalClose !== null ? s.lastIntervalClose : 'n/a' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="scanner-empty">No symbols scanned yet. Hit Start.</div>
    </div>

    <template v-if="!showAllSymbols">
      <div class="results-section">
        <div class="results-section-header">1D 200 MA crossing from {{ props.interval }}</div>
        <div v-if="!scanning && !dailyCrossResults.length" class="scanner-empty">
          No {{ props.interval }} candle has crossed the 1D 200 MA yet.
        </div>
        <table v-else-if="dailyCrossResults.length" class="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Direction</th>
              <th>200 MA (1D)</th>
              <th>Open</th>
              <th>Close</th>
              <th>Candle Time</th>
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
              <td>{{ r.ma200.toFixed(4) }}</td>
              <td>{{ r.latestCandle.open }}</td>
              <td>{{ r.latestCandle.close }}</td>
              <td>{{ new Date(r.latestCandle.openTime).toLocaleString() }}</td>
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
        <div class="results-section-header">{{ props.interval }} 200 MA crossing</div>
        <div v-if="!scanning && !intradayCrossResults.length" class="scanner-empty">
          No {{ props.interval }} candle has crossed its own 200 MA yet.
        </div>
        <table v-else-if="intradayCrossResults.length" class="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Direction</th>
              <th>200 MA ({{ props.interval }})</th>
              <th>Open</th>
              <th>Close</th>
              <th>Candle Time</th>
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
              <td>{{ r.ma200.toFixed(4) }}</td>
              <td>{{ r.latestCandle.open }}</td>
              <td>{{ r.latestCandle.close }}</td>
              <td>{{ new Date(r.latestCandle.openTime).toLocaleString() }}</td>
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

const chocoMintoStore = useChocoMintoStore()

const DAILY_MA_PERIOD = 200
// buffer above 200 so the SMA has a full 200 *closed* daily candles to work with
const DAILY_CANDLE_LIMIT = 210

const INTRADAY_MA_PERIOD = 200
// the 15m (or whatever props.interval is) series also needs >= 200 candles for its own MA
const INTRADAY_CANDLE_MIN = 210

interface MaCrossResult {
  symbol: string
  ma200: number
  direction: 'crossed-up' | 'crossed-down'
  latestCandle: Candle
  candles: Candle[] // the fetched interval candles, shown in the entry history dialog
}

interface ScanSymbolOutcome {
  daily: MaCrossResult | null
  intraday: MaCrossResult | null
}

interface ScannedSymbolDebug {
  symbol: string
  dailyMa200: number | null
  intradayMa200: number | null
  lastDailyClose: number | null
  lastIntervalClose: number | null
}

const scanning = ref(false)
const scanProgress = ref({ done: 0, total: 0 })
const dailyCrossResults = ref<MaCrossResult[]>([])
const intradayCrossResults = ref<MaCrossResult[]>([])
const errorSymbols = ref<string[]>([])

// debug / testing toggle: shows every scanned symbol + both captured MAs
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function checkCross(latest: Candle, ma: number): 'crossed-up' | 'crossed-down' | null {
  if (latest.open < ma && latest.close > ma) return 'crossed-up'
  if (latest.open > ma && latest.close < ma) return 'crossed-down'
  return null
}

async function scanSymbol(symbol: string): Promise<ScanSymbolOutcome> {
  // 1) 1D 200 SMA
  const dailyCandles = await KlineUtility.getRecentKlines(symbol, '1d', DAILY_CANDLE_LIMIT)
  const dailyMa200 = calculateSma(dailyCandles, DAILY_MA_PERIOD)

  // 2) interval candles (default 15m) - used both for the interval's own 200 MA
  // and to check the interval candle against the 1D 200 MA
  const intervalCandles = await KlineUtility.getRecentKlines(
    symbol,
    props.interval,
    Math.max(props.maxInitCandles, INTRADAY_CANDLE_MIN)
  )
  const intradayMa200 = calculateSma(intervalCandles, INTRADAY_MA_PERIOD)
  const latest = intervalCandles.length ? intervalCandles[intervalCandles.length - 1] : null

  // record for the "Display Symbols" debug view regardless of whether a cross happened
  allScanned.value.push({
    symbol,
    dailyMa200,
    intradayMa200,
    lastDailyClose: dailyCandles.length ? dailyCandles[dailyCandles.length - 1].close : null,
    lastIntervalClose: latest ? latest.close : null,
  })

  const outcome: ScanSymbolOutcome = { daily: null, intraday: null }
  if (!latest) return outcome

  if (dailyMa200 !== null) {
    const direction = checkCross(latest, dailyMa200)
    if (direction) {
      outcome.daily = { symbol, ma200: dailyMa200, direction, latestCandle: latest, candles: intervalCandles }
    }
  }

  if (intradayMa200 !== null) {
    const direction = checkCross(latest, intradayMa200)
    if (direction) {
      outcome.intraday = { symbol, ma200: intradayMa200, direction, latestCandle: latest, candles: intervalCandles }
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

function openEntryHistory(result: MaCrossResult) {
  markReviewed(result.symbol)
  selectedSymbol.value = result.symbol
  selectedSymbolCandleEntries.value = []
  selectedSymbolCandleEntries.value = result.candles.map(c => ({
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