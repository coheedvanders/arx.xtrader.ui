<!-- MACrossingVisualizerComponent.vue -->
<template>
  <div class="ma-crossing-visualizer">
    <div class="controls">
      <div class="symbol-badge">{{ props.symbol.toUpperCase() }} · 15m ({{ DISPLAY_CANDLES }} candles)</div>

      <label class="ctrl-label">
        Squeeze &lt;
        <input v-model.number="squeezeThresholdPct" type="number" min="0.05" max="5" step="0.05" class="ctrl-input" />
        %
      </label>

      <label class="ctrl-label">
        Expansion &gt;
        <input v-model.number="expansionThresholdPct" type="number" min="0.1" max="10" step="0.1" class="ctrl-input" />
        %
      </label>

      <button class="refresh-btn" :disabled="loading" @click="loadAll">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>

      <!-- Opens the MA structure analysis dialog using the currently-displayed data -->
      <button class="analyze-btn" :disabled="loading || !displayCandles.length" @click="openAnalysis">
        📊 Analyze Data
      </button>

      <!-- Clears any long/short preview mirrored from the analysis dialog -->
      <button
        v-if="previewLongScenario || previewShortScenario"
        class="clear-preview-btn"
        @click="clearPreview"
      >
        ✕ Clear Preview
      </button>

      <div class="summary" v-if="!loading && !error">
        {{ displayCandles.length }} candles
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading && displayCandles.length === 0" class="loading-state">
      Fetching {{ props.symbol.toUpperCase() }} 15m / 1h / 4h / 1d candles from Binance Futures…
    </div>

    <template v-else-if="displayCandles.length">
      <!-- Structure panel: dynamic ordering of price vs each 200 MA -->
      <div class="structure-panel">
        <div class="structure-panel-header">Current MA Structure (high → low)</div>
        <div class="structure-chain">
          <template v-for="(node, i) in structureOrder" :key="node.key">
            <span class="structure-node" :class="{ 'is-price': node.key === 'price' }" :style="{ color: node.color }">
              {{ node.label }}
              <span class="structure-value">{{ formatPrice(node.value) }}</span>
            </span>
            <span v-if="i < structureOrder.length - 1" class="structure-sep">›</span>
          </template>
        </div>
      </div>

      <!-- Squeeze / expansion panel -->
      <div class="squeeze-panel">
        <span class="squeeze-badge" :class="squeezeState.toLowerCase()">{{ squeezeState }}</span>
        <span class="squeeze-stat">
          <label>MA Spread</label><span>{{ currentSpreadPct !== null ? currentSpreadPct.toFixed(3) + '%' : 'n/a' }}</span>
        </span>
        <span class="squeeze-stat"><label>Squeeze &lt;</label><span>{{ squeezeThresholdPct.toFixed(2) }}%</span></span>
        <span class="squeeze-stat"><label>Expansion &gt;</label><span>{{ expansionThresholdPct.toFixed(2) }}%</span></span>
      </div>

      <!-- Data capture: pick a period, export OHLCV + all 4 MA200s as JSON -->
      <div class="capture-panel">
        <div class="capture-panel-header">Data Capture (OHLCV + MA200)</div>
        <div class="capture-controls">
          <label class="ctrl-label">
            Period
            <select class="ctrl-select" v-model.number="captureCandleCount">
              <option v-for="preset in PERIOD_PRESETS" :key="preset.label" :value="preset.candles">
                {{ preset.label }}
              </option>
            </select>
          </label>

          <label class="ctrl-label">
            Candles
            <input
              type="number"
              class="ctrl-input"
              v-model.number="captureCandleCount"
              min="1"
              :max="displayCandles.length"
            />
          </label>

          <span class="capture-range">{{ captureRangeLabel }}</span>

          <button class="capture-btn" :disabled="!clampedCaptureCount" @click="downloadCaptureJson">
            ⬇ Download JSON
          </button>
        </div>
      </div>

      <!-- Legend -->
      <div class="legend">
        <span v-for="ma in MA_INTERVALS" :key="ma.key" class="legend-item">
          <span class="legend-swatch" :style="{ background: ma.color }" />
          {{ ma.label }} 200MA
          <span class="legend-value">
            {{ lastMaValue(ma.key) !== null ? formatPrice(lastMaValue(ma.key) as number) : 'n/a' }}
          </span>
        </span>
        <span class="legend-item price">
          <span class="legend-swatch price" />
          Price
          <span class="legend-value">{{ lastPrice !== null ? formatPrice(lastPrice) : 'n/a' }}</span>
        </span>
        <span v-if="previewLongScenario" class="legend-item"><span class="legend-swatch" style="background:#4ade80" />Long preview</span>
        <span v-if="previewShortScenario" class="legend-item"><span class="legend-swatch" style="background:#ef5350" />Short preview</span>
      </div>

      <div class="chart-container" ref="chartContainer">
        <svg :width="svgWidth" :height="totalSvgHeight" class="ma-svg">
          <!-- Grid -->
          <g class="grid">
            <line
              v-for="(price, i) in gridPrices"
              :key="`grid-${i}`"
              :x1="0" :y1="priceToY(price)"
              :x2="svgWidth" :y2="priceToY(price)"
              class="grid-line"
            />
          </g>

          <!-- Candles -->
          <g class="candles">
            <g
              v-for="(candle, i) in displayCandles"
              :key="`c-${i}`"
              class="candle"
              :class="{ bull: candle.close >= candle.open, bear: candle.close < candle.open }"
            >
              <line
                :x1="candleX(i)" :y1="priceToY(candle.high)"
                :x2="candleX(i)" :y2="priceToY(candle.low)"
                class="wick"
              />
              <rect
                :x="candleX(i) - candleWidth / 2"
                :y="priceToY(Math.max(candle.open, candle.close))"
                :width="candleWidth"
                :height="Math.max(Math.abs(candle.close - candle.open) / priceDelta * svgHeight, 1)"
                class="body"
              />
            </g>
          </g>

          <!-- MA lines -->
          <g class="ma-lines">
            <path
              v-for="ma in MA_INTERVALS"
              :key="`line-${ma.key}`"
              :d="maPath(ma.key)"
              class="ma-line"
              :stroke="ma.color"
              fill="none"
            />
          </g>

          <!-- Preview overlay: long/short entry-stop-target, mirrored from the analysis dialog -->
          <g class="plan-lines" v-if="previewLongScenario">
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewLongScenario.entry)" :y2="priceToY(previewLongScenario.entry)" class="plan-line long entry" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewLongScenario.stop)" :y2="priceToY(previewLongScenario.stop)" class="plan-line long stop" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewLongScenario.target)" :y2="priceToY(previewLongScenario.target)" class="plan-line long target" />
            <text :x="6" :y="priceToY(previewLongScenario.entry) - 3" class="plan-line-label long">Entry {{ formatPrice(previewLongScenario.entry) }}</text>
            <text :x="6" :y="priceToY(previewLongScenario.stop) - 3" class="plan-line-label long">Stop {{ formatPrice(previewLongScenario.stop) }}</text>
            <text :x="6" :y="priceToY(previewLongScenario.target) - 3" class="plan-line-label long">Target {{ formatPrice(previewLongScenario.target) }}</text>
          </g>
          <g class="plan-lines" v-if="previewShortScenario">
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewShortScenario.entry)" :y2="priceToY(previewShortScenario.entry)" class="plan-line short entry" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewShortScenario.stop)" :y2="priceToY(previewShortScenario.stop)" class="plan-line short stop" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(previewShortScenario.target)" :y2="priceToY(previewShortScenario.target)" class="plan-line short target" />
            <text :x="6" :y="priceToY(previewShortScenario.entry) - 3" class="plan-line-label short">Entry {{ formatPrice(previewShortScenario.entry) }}</text>
            <text :x="6" :y="priceToY(previewShortScenario.stop) - 3" class="plan-line-label short">Stop {{ formatPrice(previewShortScenario.stop) }}</text>
            <text :x="6" :y="priceToY(previewShortScenario.target) - 3" class="plan-line-label short">Target {{ formatPrice(previewShortScenario.target) }}</text>
          </g>

          <!-- Price axis -->
          <text
            v-for="(price, i) in gridPrices"
            :key="`pl-${i}`"
            :x="svgWidth - 5"
            :y="priceToY(price) + 4"
            class="price-label"
          >
            {{ formatPrice(price) }}
          </text>

          <!-- Squeeze / expansion spread pane -->
          <g class="spread-pane">
            <line :x1="0" :x2="svgWidth" :y1="spreadTop" :y2="spreadTop" class="divider-line" />

            <line
              :x1="0" :x2="svgWidth"
              :y1="spreadThresholdY(squeezeThresholdPct)" :y2="spreadThresholdY(squeezeThresholdPct)"
              class="spread-threshold squeeze"
            />
            <line
              :x1="0" :x2="svgWidth"
              :y1="spreadThresholdY(expansionThresholdPct)" :y2="spreadThresholdY(expansionThresholdPct)"
              class="spread-threshold expansion"
            />

            <path :d="spreadPath" class="spread-line" fill="none" />

            <text :x="6" :y="spreadTop + 12" class="spread-pane-label">MA Spread % (squeeze / expansion)</text>
            <text :x="svgWidth - 5" :y="spreadThresholdY(squeezeThresholdPct) - 3" class="spread-threshold-label squeeze">
              squeeze {{ squeezeThresholdPct.toFixed(2) }}%
            </text>
            <text :x="svgWidth - 5" :y="spreadThresholdY(expansionThresholdPct) - 3" class="spread-threshold-label expansion">
              expansion {{ expansionThresholdPct.toFixed(2) }}%
            </text>
          </g>
        </svg>
      </div>
    </template>

    <!-- MA structure analysis dialog -->
    <DialogComponent v-model="showMACrossing" :width="'95vw'">
      <DialogHeaderComponent>
        {{ selectedSymbol }}
      </DialogHeaderComponent>
      <MAStructureAnalysisComponent v-if="analysisPayload" :data="analysisPayload" @preview="onPreview" />
    </DialogComponent>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
// NOTE: adjust these two import paths to match your project's actual Dialog
// component location — they're placeholders standing in for whatever dialog
// primitives you already use elsewhere in the app.
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import MAStructureAnalysisComponent from './MAStructureAnalysisComponent.vue'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface MaSeriesConfig {
  key: '15m' | '1h' | '4h' | '1d'
  label: string
  color: string
  intervalMs: number
}

/** Mirrors the Scenario shape emitted by MAStructureAnalysisComponent's `preview` event. */
interface PreviewScenario {
  entry: number
  stop: number
  target: number
  rr: number
}

interface Props {
  symbol: string
}
const props = defineProps<Props>()

// ─── Config ─────────────────────────────────────────────────────────────────
const REST_BASE = 'https://fapi.binance.com'
const DISPLAY_CANDLES = 1000 // 15m candles plotted on the chart
const MA_PERIOD = 200
const MS_15M = 15 * 60 * 1000

const MA_INTERVALS: MaSeriesConfig[] = [
  { key: '15m', label: '15m', color: '#64b5f6', intervalMs: MS_15M },
  { key: '1h', label: '1h', color: '#ffb74d', intervalMs: 60 * 60 * 1000 },
  { key: '4h', label: '4h', color: '#ba68c8', intervalMs: 4 * 60 * 60 * 1000 },
  { key: '1d', label: '1d', color: '#4ade80', intervalMs: 24 * 60 * 60 * 1000 },
]
const BINANCE_INTERVAL_NAME: Record<string, string> = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' }

// Data-capture period presets, expressed in 15m candle counts
const PERIOD_PRESETS = [
  { label: '4H', candles: 16 },
  { label: '12H', candles: 48 },
  { label: '1D', candles: 96 },
  { label: '3D', candles: 288 },
  { label: '7D', candles: 672 },
  { label: `All (${DISPLAY_CANDLES})`, candles: DISPLAY_CANDLES },
]

// ─── State ──────────────────────────────────────────────────────────────────
const loading = ref(false)
const error = ref<string | null>(null)
const chartContainer = ref<HTMLElement | null>(null)

// raw fetched candles per interval (larger than DISPLAY_CANDLES to allow MA warm-up)
const rawCandles = ref<Record<string, Candle[]>>({ '15m': [], '1h': [], '4h': [], '1d': [] })
// rolling SMA200 arrays, 1:1 aligned with rawCandles[key]
const rawMa = ref<Record<string, (number | null)[]>>({ '15m': [], '1h': [], '4h': [], '1d': [] })

const squeezeThresholdPct = ref(0.5)
const expansionThresholdPct = ref(2)

// how many of the most recent 15m candles to include in a data-capture export
const captureCandleCount = ref(288) // defaults to the "3D" preset

const candleWidth = ref(3)
const candleGap = 1
const svgHeight = 520
const spreadGap = 10
const spreadPaneHeight = 90

// ─── Analysis dialog + preview state ───────────────────────────────────────
const showMACrossing = ref(false)
const selectedSymbol = computed(() => props.symbol.toUpperCase())
const analysisPayload = ref<ReturnType<typeof buildCapturePayload> | null>(null)

// Long/short plans mirrored from the analysis dialog's Preview toggles, drawn
// as overlay lines on this component's own chart.
const previewLongScenario = ref<PreviewScenario | null>(null)
const previewShortScenario = ref<PreviewScenario | null>(null)

/** Opens the MA structure analysis dialog using whatever period is currently
 *  selected in the Data Capture panel (falls back to all loaded candles). */
function openAnalysis() {
  analysisPayload.value = buildCapturePayload()
  showMACrossing.value = true
}

/** Receives { long, short } from MAStructureAnalysisComponent's Preview toggles. */
function onPreview(payload: { long: PreviewScenario | null; short: PreviewScenario | null }) {
  previewLongScenario.value = payload.long
  previewShortScenario.value = payload.short
}

function clearPreview() {
  previewLongScenario.value = null
  previewShortScenario.value = null
}

// ─── Fetch ──────────────────────────────────────────────────────────────────
async function fetchKlines(interval: string, limit: number): Promise<Candle[]> {
  const sym = props.symbol.toUpperCase()
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Binance request failed for ${interval} (${res.status}). Check the symbol is a valid USDⓈ-M futures pair.`)
  }
  const raw: any[] = await res.json()
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }))
}

function rollingSma(candles: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null)
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

// How many candles of a given interval are needed to (a) cover the same
// wall-clock window as DISPLAY_CANDLES 15m candles, and (b) still have a full
// 200-period warm-up before that window starts.
function requiredLimit(intervalMs: number): number {
  const windowMs = DISPLAY_CANDLES * MS_15M
  const coverage = Math.ceil(windowMs / intervalMs)
  return Math.min(1500, coverage + MA_PERIOD + 10)
}

async function loadAll() {
  loading.value = true
  error.value = null
  clearPreview()
  try {
    const results = await Promise.all(
      MA_INTERVALS.map((ma) => fetchKlines(BINANCE_INTERVAL_NAME[ma.key], requiredLimit(ma.intervalMs)))
    )
    const nextRaw: Record<string, Candle[]> = { '15m': [], '1h': [], '4h': [], '1d': [] }
    const nextMa: Record<string, (number | null)[]> = { '15m': [], '1h': [], '4h': [], '1d': [] }
    MA_INTERVALS.forEach((ma, i) => {
      nextRaw[ma.key] = results[i]
      nextMa[ma.key] = rollingSma(results[i], MA_PERIOD)
    })
    rawCandles.value = nextRaw
    rawMa.value = nextMa
    await nextTick()
    scrollToRight()
  } catch (err) {
    console.error('Failed to load MA crossing data:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load candle data.'
    rawCandles.value = { '15m': [], '1h': [], '4h': [], '1d': [] }
    rawMa.value = { '15m': [], '1h': [], '4h': [], '1d': [] }
  } finally {
    loading.value = false
  }
}

function scrollToRight() {
  if (chartContainer.value) {
    chartContainer.value.scrollLeft = chartContainer.value.scrollWidth
  }
}

onMounted(loadAll)
watch(() => props.symbol, loadAll)

// ─── Timeline (last DISPLAY_CANDLES 15m candles) ───────────────────────────
const displayCandles = computed<Candle[]>(() => rawCandles.value['15m'].slice(-DISPLAY_CANDLES))

// index offset of the first displayed 15m candle inside the full fetched 15m array
const displayOffset = computed(() => rawCandles.value['15m'].length - displayCandles.value.length)

const timeline = computed(() => displayCandles.value.map((c) => c.openTime))

/**
 * Maps a higher-timeframe's own MA200 series onto the 15m display timeline as
 * a step function. Uses each HTF candle as soon as it has OPENED (not only
 * once fully closed) — this mirrors calculateSma()'s slice(-200) in the
 * scanner, which averages whatever the latest 200 daily candles are, including
 * the currently-forming one. Using close-time here would silently drop the
 * live/forming candle and make the "current" MA lag a full period behind the
 * scanner's number.
 */
function mappedMaSeries(key: string): (number | null)[] {
  if (key === '15m') {
    return rawMa.value['15m'].slice(displayOffset.value)
  }
  const candles = rawCandles.value[key]
  const ma = rawMa.value[key]
  const result: (number | null)[] = []
  let j = -1
  for (const t of timeline.value) {
    while (j + 1 < candles.length && candles[j + 1].openTime <= t) {
      j++
    }
    result.push(j >= 0 ? ma[j] : null)
  }
  return result
}

const maSeriesByKey = computed<Record<string, (number | null)[]>>(() => {
  const out: Record<string, (number | null)[]> = {}
  for (const ma of MA_INTERVALS) out[ma.key] = mappedMaSeries(ma.key)
  return out
})

function lastMaValue(key: string): number | null {
  const series = maSeriesByKey.value[key]
  if (!series || !series.length) return null
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]
  }
  return null
}

const lastPrice = computed<number | null>(() => {
  const c = displayCandles.value
  return c.length ? c[c.length - 1].close : null
})

// ─── Structure ordering: dynamic "15m > 1h > price > 4h > 1d" style chain ──
const structureOrder = computed(() => {
  const nodes: { key: string; label: string; color: string; value: number }[] = []
  for (const ma of MA_INTERVALS) {
    const v = lastMaValue(ma.key)
    if (v !== null) nodes.push({ key: ma.key, label: `${ma.label} MA`, color: ma.color, value: v })
  }
  if (lastPrice.value !== null) {
    nodes.push({ key: 'price', label: 'Price', color: '#ffffff', value: lastPrice.value })
  }
  return nodes.sort((a, b) => b.value - a.value)
})

// ─── Squeeze / expansion ────────────────────────────────────────────────────
// % spread between the widest two MAs at each point in time, relative to their average
const spreadSeries = computed<(number | null)[]>(() => {
  const series = MA_INTERVALS.map((m) => maSeriesByKey.value[m.key])
  return timeline.value.map((_, i) => {
    const vals = series.map((s) => s[i]).filter((v): v is number => v !== null)
    if (vals.length < 2) return null
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    if (!avg) return null
    return ((max - min) / avg) * 100
  })
})

const currentSpreadPct = computed<number | null>(() => {
  const s = spreadSeries.value
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] !== null) return s[i]
  }
  return null
})

const squeezeState = computed(() => {
  const s = currentSpreadPct.value
  if (s === null) return 'N/A'
  if (s < squeezeThresholdPct.value) return 'SQUEEZE'
  if (s > expansionThresholdPct.value) return 'EXPANSION'
  return 'NEUTRAL'
})

// ─── Data capture (OHLCV + all four 200 MAs → downloadable JSON) ──────────
// clamp the requested candle count to what's actually loaded
const clampedCaptureCount = computed(() => {
  if (!displayCandles.value.length) return 0
  return Math.min(Math.max(1, captureCandleCount.value || 0), displayCandles.value.length)
})

const captureRangeLabel = computed(() => {
  const n = clampedCaptureCount.value
  if (!n) return ''
  const start = displayCandles.value[displayCandles.value.length - n]
  const end = displayCandles.value[displayCandles.value.length - 1]
  const fmt = (t: number) => new Date(t).toLocaleString()
  return `${n} candles · ${fmt(start.openTime)} → ${fmt(end.openTime)}`
})

interface CaptureRow {
  openTime: number
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  ma200_15m: number | null
  ma200_1h: number | null
  ma200_4h: number | null
  ma200_1d: number | null
}

function buildCapturePayload() {
  const n = clampedCaptureCount.value
  const total = displayCandles.value.length
  const startIdx = total - n

  const candles = displayCandles.value.slice(startIdx)
  const ma15 = maSeriesByKey.value['15m'].slice(startIdx)
  const ma1h = maSeriesByKey.value['1h'].slice(startIdx)
  const ma4h = maSeriesByKey.value['4h'].slice(startIdx)
  const ma1d = maSeriesByKey.value['1d'].slice(startIdx)

  const data: CaptureRow[] = candles.map((c, i) => ({
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
    symbol: props.symbol.toUpperCase(),
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

function downloadCaptureJson() {
  if (!clampedCaptureCount.value) return
  const payload = buildCapturePayload()
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `${props.symbol.toUpperCase()}_ohlcv_ma200_${payload.period.candles}c_${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Price pane geometry ─────────────────────────────────────────────────────
const minPrice = computed(() => {
  if (!displayCandles.value.length) return 0
  const lows = displayCandles.value.map((c) => c.low)
  const maValues: number[] = []
  for (const ma of MA_INTERVALS) {
    for (const v of maSeriesByKey.value[ma.key]) if (v !== null) maValues.push(v)
  }
  const planValues: number[] = []
  if (previewLongScenario.value) planValues.push(previewLongScenario.value.stop)
  if (previewShortScenario.value) planValues.push(previewShortScenario.value.target)
  return Math.min(...lows, ...(maValues.length ? maValues : lows), ...(planValues.length ? planValues : lows)) * 0.995
})

const maxPrice = computed(() => {
  if (!displayCandles.value.length) return 1
  const highs = displayCandles.value.map((c) => c.high)
  const maValues: number[] = []
  for (const ma of MA_INTERVALS) {
    for (const v of maSeriesByKey.value[ma.key]) if (v !== null) maValues.push(v)
  }
  const planValues: number[] = []
  if (previewLongScenario.value) planValues.push(previewLongScenario.value.target)
  if (previewShortScenario.value) planValues.push(previewShortScenario.value.stop)
  return Math.max(...highs, ...(maValues.length ? maValues : highs), ...(planValues.length ? planValues : highs)) * 1.005
})

const priceDelta = computed(() => maxPrice.value - minPrice.value || 1)
const svgWidth = computed(() => displayCandles.value.length * (candleWidth.value + candleGap) + 80)

const gridPrices = computed(() => {
  const step = priceDelta.value / 8
  return Array.from({ length: 9 }, (_, i) => minPrice.value + step * i)
})

const priceToY = (price: number): number => ((maxPrice.value - price) / priceDelta.value) * svgHeight
const candleX = (index: number): number => index * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10

/**
 * Builds a smooth SVG path through a list of points using a Catmull-Rom
 * spline (converted to cubic Beziers). The curve still passes through every
 * data point exactly — this only smooths the segments *between* points, it
 * never alters the underlying values.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

  let d = `M ${points[0].x} ${points[0].y} `
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y} `
  }
  return d.trim()
}

/** Splits a value series into contiguous (non-null) runs of {x,y} points. */
function toSegments(series: (number | null)[], toY: (v: number) => number): { x: number; y: number }[][] {
  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  series.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push({ x: candleX(i), y: toY(v) })
  })
  if (current.length) segments.push(current)
  return segments
}

function maPath(key: string): string {
  const series = maSeriesByKey.value[key]
  if (!series) return ''
  return toSegments(series, priceToY)
    .map((segment) => smoothPath(segment))
    .join(' ')
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  return price.toFixed(6)
}

// ─── Squeeze/expansion pane geometry ────────────────────────────────────────
const spreadTop = computed(() => svgHeight + spreadGap)
const totalSvgHeight = computed(() => svgHeight + spreadGap + spreadPaneHeight)

const maxSpreadForAxis = computed(() => {
  const vals = spreadSeries.value.filter((v): v is number => v !== null)
  const dataMax = vals.length ? Math.max(...vals) : 1
  return Math.max(dataMax, expansionThresholdPct.value) * 1.15
})

function spreadToY(value: number): number {
  const ratio = Math.min(1, Math.max(0, value / maxSpreadForAxis.value))
  return spreadTop.value + spreadPaneHeight - ratio * spreadPaneHeight
}

function spreadThresholdY(pct: number): number {
  return spreadToY(pct)
}

const spreadPath = computed(() =>
  toSegments(spreadSeries.value, spreadToY)
    .map((segment) => smoothPath(segment))
    .join(' ')
)
</script>

<style scoped>
.ma-crossing-visualizer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  max-height: 80vh;
  overflow-y: auto;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem;
}

.symbol-badge {
  font-family: monospace;
  font-weight: bold;
  font-size: 13px;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 4px;
  letter-spacing: 0.4px;
}

.ctrl-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #999;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.ctrl-input {
  width: 64px;
  padding: 4px 8px;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  font-family: monospace;
}

.ctrl-input:focus {
  outline: none;
  border-color: #64b5f6;
}

.refresh-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid #555;
  background: rgba(255, 255, 255, 0.06);
  color: #ccc;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.12);
}

/* Analyze Data button */
.analyze-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid rgba(100, 181, 246, 0.4);
  background: rgba(100, 181, 246, 0.12);
  color: #64b5f6;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.analyze-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.analyze-btn:not(:disabled):hover {
  background: rgba(100, 181, 246, 0.22);
}

/* Clear Preview button */
.clear-preview-btn {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: #aaa;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.clear-preview-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.summary {
  margin-left: auto;
  font-size: 12px;
  color: #ccc;
  font-family: monospace;
}

.error-banner {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.1);
  border: 1px solid rgba(239, 83, 80, 0.3);
  border-radius: 4px;
  padding: 0.75rem 1rem;
  font-size: 13px;
}

.loading-state {
  color: #999;
  font-size: 13px;
  padding: 2rem;
  text-align: center;
}

/* ── Structure panel ──────────────────────────────────────────────────── */
.structure-panel {
  padding: 0.6rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.structure-panel-header {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}

.structure-chain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-family: monospace;
  font-size: 14px;
}

.structure-node {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-weight: bold;
}

.structure-node.is-price {
  padding: 1px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}

.structure-value {
  font-weight: normal;
  opacity: 0.75;
  font-size: 12px;
}

.structure-sep {
  color: #555;
  font-weight: bold;
}

/* ── Squeeze / expansion panel ────────────────────────────────────────── */
.squeeze-panel {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  flex-wrap: wrap;
}

.squeeze-badge {
  padding: 3px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 0.6px;
}

.squeeze-badge.squeeze {
  background: rgba(255, 183, 77, 0.2);
  color: #ffb74d;
}

.squeeze-badge.expansion {
  background: rgba(80, 200, 120, 0.2);
  color: #4ade80;
}

.squeeze-badge.neutral {
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
}

.squeeze-badge.n\/a {
  background: rgba(255, 255, 255, 0.06);
  color: #777;
}

.squeeze-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: monospace;
  color: #fff;
}

.squeeze-stat label {
  color: #999;
  font-family: inherit;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.4px;
}

/* ── Data capture panel ───────────────────────────────────────────────── */
.capture-panel {
  padding: 0.6rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(255, 255, 255, 0.15);
}

.capture-panel-header {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 8px;
}

.capture-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.ctrl-select {
  padding: 4px 8px;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-family: monospace;
}

.ctrl-select:focus {
  outline: none;
  border-color: #64b5f6;
}

.capture-range {
  font-size: 12px;
  font-family: monospace;
  color: #999;
}

.capture-btn {
  margin-left: auto;
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid rgba(80, 200, 120, 0.4);
  background: rgba(80, 200, 120, 0.12);
  color: #4ade80;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.capture-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capture-btn:not(:disabled):hover {
  background: rgba(80, 200, 120, 0.22);
}

/* ── Legend ────────────────────────────────────────────────────────────── */
.legend {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  flex-wrap: wrap;
  font-size: 12px;
  color: #ccc;
  padding: 0 0.25rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: monospace;
}

.legend-swatch {
  width: 12px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}

.legend-swatch.price {
  background: #ffffff;
  opacity: 0.6;
}

.legend-value {
  opacity: 0.7;
}

/* ── Chart ─────────────────────────────────────────────────────────────── */
.chart-container {
  position: relative;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 1rem;
  height: 90vh;
  overflow: auto;
  flex-shrink: 0;
}

.ma-svg {
  display: block;
}

.grid-line {
  stroke: rgba(255, 255, 255, 0.05);
  stroke-width: 1;
}

.wick {
  stroke-width: 1;
}

.candle.bull .wick {
  stroke: #26a69a;
}

.candle.bear .wick {
  stroke: #ef5350;
}

.body {
  stroke-width: 1;
}

.candle.bull .body {
  fill: #26a69a;
  stroke: #26a69a;
}

.candle.bear .body {
  fill: #ef5350;
  stroke: #ef5350;
}

.ma-line {
  stroke-width: 1.5;
  opacity: 0.95;
}

.price-label {
  fill: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  text-anchor: end;
  user-select: none;
}

/* ── Preview overlay lines ────────────────────────────────────────────── */
.plan-line { stroke-width: 1; stroke-dasharray: 5, 3; opacity: 0.8; }
.plan-line.long { stroke: #4ade80; }
.plan-line.short { stroke: #ef5350; }
.plan-line.entry { opacity: 0.9; }
.plan-line.stop { stroke-dasharray: 2, 2; }
.plan-line.target { stroke-dasharray: 8, 3; }
.plan-line-label { font-size: 9px; font-family: monospace; }
.plan-line-label.long { fill: #4ade80; }
.plan-line-label.short { fill: #ef5350; }

/* ── Spread / squeeze pane ────────────────────────────────────────────── */
.divider-line {
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}

.spread-line {
  stroke: #64b5f6;
  stroke-width: 1.5;
}

.spread-threshold {
  stroke-width: 1;
  stroke-dasharray: 4, 4;
}

.spread-threshold.squeeze {
  stroke: #ffb74d;
  opacity: 0.6;
}

.spread-threshold.expansion {
  stroke: #4ade80;
  opacity: 0.6;
}

.spread-threshold-label {
  font-size: 9px;
  font-family: monospace;
  text-anchor: end;
}

.spread-threshold-label.squeeze {
  fill: #ffb74d;
}

.spread-threshold-label.expansion {
  fill: #4ade80;
}

.spread-pane-label {
  fill: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  user-select: none;
}
</style>