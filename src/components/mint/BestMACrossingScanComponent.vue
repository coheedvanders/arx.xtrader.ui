<template>
  <div class="ma200-cross-scanner">
    <div class="scanner-controls">
      <button class="start-btn" :disabled="scanning" @click="startScan()">
        {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Start' }}
      </button>

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
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in dailyCrossResults" :key="r.symbol" class="result-row" @click="openEntryHistory(r)">
              <td class="symbol-cell">{{ r.symbol }}</td>
              <td>
                <span :class="['direction-tag', `direction-${r.direction}`]">
                  {{ r.direction === 'crossed-up' ? 'Crossed Up' : 'Crossed Down' }}
                </span>
              </td>
              <td>{{ r.ma200.toFixed(4) }}</td>
              <td>{{ r.latestCandle.open }}</td>
              <td>{{ r.latestCandle.close }}</td>
              <td>{{ new Date(r.latestCandle.openTime).toLocaleString() }}</td>
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
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in intradayCrossResults" :key="r.symbol" class="result-row" @click="openEntryHistory(r)">
              <td class="symbol-cell">{{ r.symbol }}</td>
              <td>
                <span :class="['direction-tag', `direction-${r.direction}`]">
                  {{ r.direction === 'crossed-up' ? 'Crossed Up' : 'Crossed Down' }}
                </span>
              </td>
              <td>{{ r.ma200.toFixed(4) }}</td>
              <td>{{ r.latestCandle.open }}</td>
              <td>{{ r.latestCandle.close }}</td>
              <td>{{ new Date(r.latestCandle.openTime).toLocaleString() }}</td>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

// ---- adjust these import paths to match your project structure ----
import { KlineUtility } from '@/utility/klineUtility'
import { useChocoMintoStore } from '@/stores/chocoMintoStore'
import type { FuturesSymbol, Candle, CandleEntry } from '@/core/interfaces.ts';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
// ---------------------------------------------------------------------

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
const scheduleMinutes = ref(15)
const isScheduleActive = ref(false)
const nextRunAt = ref<number | null>(null)
const nextRunLabel = ref('—')
let scheduleTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

const showEntryHistory = ref(false)
const selectedSymbol = ref('')
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])

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
  scanProgress.value = { done: 0, total: symbolList.length }

  const REQUEST_DELAY_MS = 400

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

  const totalCrosses = dailyCrossResults.value.length + intradayCrossResults.value.length
  if (totalCrosses > 0) {
    speakAlert(totalCrosses)
  }
}

// speaks "{count} crosses found" twice using the browser's built-in text-to-speech
function speakAlert(count: number) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  const message = `${count} ${count === 1 ? 'cross' : 'crosses'} found`
  window.speechSynthesis.cancel() // clear any queued/stuck utterances before speaking

  for (let i = 0; i < 2; i++) {
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.rate = 1
    utterance.volume = 1
    window.speechSynthesis.speak(utterance)
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
}

.result-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.symbol-cell {
  font-weight: 600;
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
</style>