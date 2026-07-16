<template>
  <div class="key-levels-chart">
    <div class="controls">
      <div class="symbol-badge">{{ props.symbol.toUpperCase() }} · 4H</div>

      <label class="ctrl-label">
        Lookback
        <input v-model.number="pivotWindow" type="number" min="2" max="10" class="ctrl-input" />
      </label>

      <label class="ctrl-label">
        Zone %
        <input v-model.number="toleranceInputPct" type="number" min="0.05" max="2" step="0.05" class="ctrl-input" />
      </label>

      <label class="ctrl-label">
        Min touches
        <input v-model.number="minTouches" type="number" min="2" max="10" class="ctrl-input" />
      </label>

      <label class="ctrl-label">
        Max per side
        <input v-model.number="maxLevelsPerSide" type="number" min="1" max="15" class="ctrl-input" />
      </label>

      <label class="checkbox-label">
        <input v-model="showTouchMarkers" type="checkbox" />
        <span>Touch markers</span>
      </label>

      <label class="checkbox-label">
        <input v-model="showVolume" type="checkbox" />
        <span>Volume</span>
      </label>

      <button class="refresh-btn" :disabled="loading" @click="loadCandles">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>

      <div class="summary" v-if="!loading && !error">
        {{ supportLevels.length }} support · {{ resistanceLevels.length }} resistance
        <span class="dim">({{ candles.length }} candles)</span>
      </div>
    </div>

    <!-- Wall / position summary panel -->
    <div v-if="props.side || props.bidWall != null || props.askWall != null" class="position-panel" :class="props.side ? props.side.toLowerCase() : ''">
      <span v-if="props.side" class="side-badge" :class="props.side.toLowerCase()">{{ props.side }}</span>

      <span v-if="props.bidWall != null" class="position-stat bid">
        <label>Bid Wall</label><span>{{ formatPrice(props.bidWall) }}</span>
      </span>
      <span v-if="props.askWall != null" class="position-stat ask">
        <label>Ask Wall</label><span>{{ formatPrice(props.askWall) }}</span>
      </span>
      <span v-if="wallThicknessPct !== null" class="position-stat">
        <label>Wall Gap</label><span>{{ wallThicknessPct.toFixed(2) }}%</span>
      </span>

      <span v-if="props.tpPrice != null" class="position-stat tp">
        <label>TP</label><span>{{ formatPrice(props.tpPrice) }}</span>
      </span>
      <span v-if="props.slPrice != null" class="position-stat sl">
        <label>SL</label><span>{{ formatPrice(props.slPrice) }}</span>
      </span>
      <span v-if="riskRewardRatio !== null" class="position-stat">
        <label>R:R</label><span>{{ riskRewardRatio.toFixed(2) }}</span>
      </span>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading && candles.length === 0" class="loading-state">
      Fetching {{ props.symbol.toUpperCase() }} 4H candles from Binance Futures…
    </div>

    <div v-else class="chart-container" ref="chartContainer">
      <svg :width="svgWidth" :height="totalSvgHeight" class="levels-svg">
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

        <!-- Key level lines -->
        <g class="key-levels">
          <g v-for="(level, i) in keyLevels" :key="`level-${level.type}-${i}`">
            <line
              :x1="candleX(level.firstTouchIndex) - candleWidth / 2"
              :y1="priceToY(level.price)"
              :x2="svgWidth"
              :y2="priceToY(level.price)"
              :class="['level-line', level.type]"
              :stroke-width="lineWeight(level.touchCount)"
            />

            <!-- Touch markers -->
            <g v-if="showTouchMarkers">
              <circle
                v-for="(idx, j) in level.touchIndices"
                :key="`touch-${level.type}-${i}-${j}`"
                :cx="candleX(idx)"
                :cy="priceToY(level.price)"
                r="3"
                :class="['touch-dot', level.type]"
              />
            </g>

            <!-- Label -->
            <text
              :x="Math.max(4, candleX(level.firstTouchIndex) - candleWidth / 2 - 6)"
              :y="priceToY(level.price) - 5"
              :class="['level-label', level.type]"
              :text-anchor="level.firstTouchIndex < 3 ? 'start' : 'end'"
            >
              {{ level.type === 'support' ? 'S' : 'R' }} {{ formatPrice(level.price) }} ×{{ level.touchCount }}
            </text>
          </g>
        </g>

        <!-- Bid/Ask wall lines -->
        <g class="wall-lines">
          <line
            v-if="props.bidWall != null"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(props.bidWall)" :y2="priceToY(props.bidWall)"
            class="wall-line bid"
          />
          <text
            v-if="props.bidWall != null"
            :x="6" :y="priceToY(props.bidWall) - 4"
            class="wall-price-label bid"
          >
            Bid Wall {{ formatPrice(props.bidWall) }}
          </text>

          <line
            v-if="props.askWall != null"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(props.askWall)" :y2="priceToY(props.askWall)"
            class="wall-line ask"
          />
          <text
            v-if="props.askWall != null"
            :x="6" :y="priceToY(props.askWall) - 4"
            class="wall-price-label ask"
          >
            Ask Wall {{ formatPrice(props.askWall) }}
          </text>
        </g>

        <!-- TP/SL lines -->
        <g class="tpsl-lines">
          <line
            v-if="props.tpPrice != null"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(props.tpPrice)" :y2="priceToY(props.tpPrice)"
            class="tpsl-line tp"
          />
          <text
            v-if="props.tpPrice != null"
            :x="svgWidth - 6" :y="priceToY(props.tpPrice) - 4"
            class="tpsl-price-label tp"
            text-anchor="end"
          >
            TP {{ formatPrice(props.tpPrice) }}
          </text>

          <line
            v-if="props.slPrice != null"
            :x1="0" :x2="svgWidth"
            :y1="priceToY(props.slPrice)" :y2="priceToY(props.slPrice)"
            class="tpsl-line sl"
          />
          <text
            v-if="props.slPrice != null"
            :x="svgWidth - 6" :y="priceToY(props.slPrice) - 4"
            class="tpsl-price-label sl"
            text-anchor="end"
          >
            SL {{ formatPrice(props.slPrice) }}
          </text>
        </g>

        <!-- Candles -->
        <g class="candles">
          <g
            v-for="(candle, i) in candles"
            :key="`candle-${i}`"
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

        <!-- Price axis -->
        <text
          v-for="(price, i) in gridPrices"
          :key="`price-label-${i}`"
          :x="svgWidth - 5"
          :y="priceToY(price) + 4"
          class="price-label"
        >
          {{ formatPrice(price) }}
        </text>

        <!-- Volume pane -->
        <g v-if="showVolume" class="volume-pane">
          <line
            :x1="0" :x2="svgWidth"
            :y1="volumeTop" :y2="volumeTop"
            class="divider-line"
          />

          <g class="volume-grid">
            <line
              v-for="(vol, i) in volumeGridValues"
              :key="`vgrid-${i}`"
              :x1="0" :y1="volumeToY(vol)"
              :x2="svgWidth" :y2="volumeToY(vol)"
              class="volume-grid-line"
            />
          </g>

          <g class="volume-bars">
            <rect
              v-for="(candle, i) in candles"
              :key="`vol-${i}`"
              :x="candleX(i) - candleWidth / 2"
              :y="volumeToY(candle.volume)"
              :width="candleWidth"
              :height="Math.max(volumeBarHeight(candle.volume), 1)"
              :class="['volume-bar', candle.close >= candle.open ? 'bull' : 'bear']"
            />
          </g>

          <text
            v-for="(vol, i) in volumeGridValues"
            :key="`vol-label-${i}`"
            :x="svgWidth - 5"
            :y="volumeToY(vol) - 3"
            class="volume-axis-label"
          >
            {{ formatVolume(vol) }}
          </text>

          <text :x="6" :y="volumeTop + 12" class="volume-pane-label">Volume</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface PivotPoint {
  price: number
  index: number
}

interface KeyLevel {
  price: number
  type: 'support' | 'resistance'
  touchCount: number
  firstTouchIndex: number
  touchIndices: number[]
}

// ─── Props ──────────────────────────────────────────────────────────────────
interface Props {
  symbol: string
  bidWall?: number | null
  askWall?: number | null
  side?: 'LONG' | 'SHORT' | null
  tpPrice?: number | null
  slPrice?: number | null
}
const props = withDefaults(defineProps<Props>(), {
  bidWall: null,
  askWall: null,
  side: null,
  tpPrice: null,
  slPrice: null,
})

// ─── Config (internal, tunable via the controls bar) ───────────────────────
const CANDLE_LIMIT = 500 // 4h candles → ~83 days of history
const REST_BASE = 'https://fapi.binance.com'

const pivotWindow = ref(20)          // candles on each side to qualify as a local extreme
const toleranceInputPct = ref(0.25) // shown to the user as a %, converted to fraction below
const minTouches = ref(2)
const maxLevelsPerSide = ref(2)
const showTouchMarkers = ref(true)
const showVolume = ref(true)

const toleranceFraction = computed(() => toleranceInputPct.value / 100)

// ─── State ──────────────────────────────────────────────────────────────────
const candles = ref<Candle[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const chartContainer = ref<HTMLElement | null>(null)

const candleWidth = ref(6)
const candleGap = 3
const svgHeight = 560       // height of the price (candle) pane only
const volumeGap = 10        // gap between price pane and volume pane
const volumePaneHeight = 120 // height of the volume pane

// ─── Fetch ──────────────────────────────────────────────────────────────────
async function loadCandles() {
  loading.value = true
  error.value = null
  try {
    const sym = props.symbol.toUpperCase()
    const url = `${REST_BASE}/fapi/v1/klines?symbol=${sym}&interval=4h&limit=${CANDLE_LIMIT}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Binance request failed (${res.status}). Check the symbol is a valid USDⓈ-M futures pair.`)
    }
    const raw: any[] = await res.json()
    candles.value = raw.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
    await nextTick()
    scrollToRight()
  } catch (err) {
    console.error('Failed to load candles:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load candles.'
    candles.value = []
  } finally {
    loading.value = false
  }
}

function scrollToRight() {
  if (chartContainer.value) {
    chartContainer.value.scrollLeft = chartContainer.value.scrollWidth
  }
}

onMounted(loadCandles)
watch(() => props.symbol, loadCandles)

// ─── Pivot detection ────────────────────────────────────────────────────────
function findPivots(data: Candle[], window: number) {
  const pivotLows: PivotPoint[] = []
  const pivotHighs: PivotPoint[] = []

  for (let i = window; i < data.length - window; i++) {
    const slice = data.slice(i - window, i + window + 1)
    const isLow = slice.every((c) => data[i].low <= c.low)
    const isHigh = slice.every((c) => data[i].high >= c.high)
    if (isLow) pivotLows.push({ price: data[i].low, index: i })
    if (isHigh) pivotHighs.push({ price: data[i].high, index: i })
  }

  return { pivotLows, pivotHighs }
}

// ─── Cluster nearby pivots into candidate levels ──────────────────────────
function clusterPivots(pivots: PivotPoint[], tolerance: number): number[] {
  if (pivots.length === 0) return []
  const sorted = [...pivots].sort((a, b) => a.price - b.price)
  const clusters: PivotPoint[][] = []

  for (const p of sorted) {
    const last = clusters[clusters.length - 1]
    if (last) {
      const avg = last.reduce((s, x) => s + x.price, 0) / last.length
      if (Math.abs(p.price - avg) / avg <= tolerance) {
        last.push(p)
        continue
      }
    }
    clusters.push([p])
  }

  return clusters.map((cluster) => cluster.reduce((s, x) => s + x.price, 0) / cluster.length)
}

/**
 * Walks the FULL candle history (not just the pivots that formed the cluster)
 * counting discrete "touch and bounce" events with a zone in/out state
 * machine, so a level gets credit for every time price respected it —
 * not just the local extrema that happened to define it.
 */
function scanTouches(
  data: Candle[],
  levelPrice: number,
  tolerance: number,
  type: 'support' | 'resistance'
): number[] {
  const touchIndices: number[] = []
  let inZone = false

  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    const refPrice = type === 'support' ? c.low : c.high
    const near = Math.abs(refPrice - levelPrice) / levelPrice <= tolerance

    if (near && !inZone) {
      const bounced = type === 'support' ? c.close > levelPrice : c.close < levelPrice
      if (bounced) touchIndices.push(i)
      inZone = true
    } else if (!near) {
      inZone = false
    }
  }

  return touchIndices
}

// ─── Key levels (the core output) ──────────────────────────────────────────
const keyLevels = computed<KeyLevel[]>(() => {
  if (candles.value.length < pivotWindow.value * 2 + 1) return []

  const { pivotLows, pivotHighs } = findPivots(candles.value, pivotWindow.value)
  const supportCandidates = clusterPivots(pivotLows, toleranceFraction.value)
  const resistanceCandidates = clusterPivots(pivotHighs, toleranceFraction.value)

  const build = (prices: number[], type: 'support' | 'resistance'): KeyLevel[] => {
    const levels: KeyLevel[] = []
    for (const price of prices) {
      const touches = scanTouches(candles.value, price, toleranceFraction.value, type)
      if (touches.length < minTouches.value) continue
      levels.push({
        price,
        type,
        touchCount: touches.length,
        firstTouchIndex: touches[0],
        touchIndices: touches,
      })
    }
    return levels.sort((a, b) => b.touchCount - a.touchCount).slice(0, maxLevelsPerSide.value)
  }

  return [...build(supportCandidates, 'support'), ...build(resistanceCandidates, 'resistance')]
})

const supportLevels = computed(() => keyLevels.value.filter((l) => l.type === 'support'))
const resistanceLevels = computed(() => keyLevels.value.filter((l) => l.type === 'resistance'))

// ─── Chart geometry (price pane) ────────────────────────────────────────────
/** Extra reference prices (walls, TP/SL) that should always stay within the visible chart range. */
const overlayPrices = computed<number[]>(() => {
  const prices: number[] = []
  if (typeof props.bidWall === 'number') prices.push(props.bidWall)
  if (typeof props.askWall === 'number') prices.push(props.askWall)
  if (typeof props.tpPrice === 'number') prices.push(props.tpPrice)
  if (typeof props.slPrice === 'number') prices.push(props.slPrice)
  return prices
})

const minPrice = computed(() => {
  if (candles.value.length === 0) return 0
  const lows = candles.value.map((c) => c.low)
  const levelPrices = keyLevels.value.map((l) => l.price)
  return Math.min(...lows, ...levelPrices, ...overlayPrices.value) * 0.995
})

const maxPrice = computed(() => {
  if (candles.value.length === 0) return 1
  const highs = candles.value.map((c) => c.high)
  const levelPrices = keyLevels.value.map((l) => l.price)
  return Math.max(...highs, ...levelPrices, ...overlayPrices.value) * 1.005
})

const priceDelta = computed(() => maxPrice.value - minPrice.value || 1)

const svgWidth = computed(() => candles.value.length * (candleWidth.value + candleGap) + 80)

const gridPrices = computed(() => {
  const step = priceDelta.value / 8
  return Array.from({ length: 9 }, (_, i) => minPrice.value + step * i)
})

const priceToY = (price: number): number => {
  return ((maxPrice.value - price) / priceDelta.value) * svgHeight
}

const candleX = (index: number): number => {
  return index * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10
}

const lineWeight = (touchCount: number): number => {
  return Math.min(4, 1.5 + touchCount * 0.3)
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 1) return price.toFixed(4)
  return price.toFixed(6)
}

// ─── Chart geometry (volume pane) ───────────────────────────────────────────
/** Y coordinate where the volume pane starts (just below the price pane + gap). */
const volumeTop = computed(() => svgHeight + volumeGap)

/** Total SVG height = price pane + gap + volume pane (collapses to just the price pane if hidden). */
const totalSvgHeight = computed(() =>
  showVolume.value ? svgHeight + volumeGap + volumePaneHeight : svgHeight
)

const maxVolume = computed(() => {
  if (candles.value.length === 0) return 1
  return Math.max(...candles.value.map((c) => c.volume), 0) || 1
})

/** A few evenly spaced reference volumes for the axis/grid (e.g. 0, half, max). */
const volumeGridValues = computed(() => {
  const max = maxVolume.value
  return [max, max / 2]
})

function volumeBarHeight(volume: number): number {
  return (volume / maxVolume.value) * volumePaneHeight
}

function volumeToY(volume: number): number {
  return volumeTop.value + volumePaneHeight - volumeBarHeight(volume)
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}K`
  return volume.toFixed(2)
}

/**
 * Gap between the largest bid wall and lowest ask wall, as a % of their
 * midpoint. Small % = walls sitting close together (thin/contested zone).
 * Large % = walls far apart (thick/open zone).
 */
const wallThicknessPct = computed<number | null>(() => {
  const bid = props.bidWall
  const ask = props.askWall
  if (typeof bid !== 'number' || typeof ask !== 'number' || bid <= 0 || ask <= 0) return null
  const mid = (ask + bid) / 2
  if (!mid) return null
  return Math.abs((ask - bid) / mid) * 100
})

/** Reward:risk ratio derived from side + entry (last close) + tp/sl, when all are present. */
const riskRewardRatio = computed<number | null>(() => {
  if (!props.side || typeof props.tpPrice !== 'number' || typeof props.slPrice !== 'number') return null
  const last = candles.value[candles.value.length - 1]
  if (!last) return null
  const entry = last.close
  const reward = props.side === 'LONG' ? props.tpPrice - entry : entry - props.tpPrice
  const risk = props.side === 'LONG' ? entry - props.slPrice : props.slPrice - entry
  if (risk <= 0) return null
  return reward / risk
})
</script>

<style scoped>
.key-levels-chart {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
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
  flex-direction: column;
  gap: 2px;
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

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #ccc;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
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

.summary {
  margin-left: auto;
  font-size: 12px;
  color: #ccc;
  font-family: monospace;
}

.summary .dim {
  color: #777;
}

/* ── Position / wall summary panel ────────────────────────────────────── */
.position-panel {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid #555;
  flex-wrap: wrap;
}

.position-panel.long { border-left-color: #26a69a; }
.position-panel.short { border-left-color: #ef5350; }

.side-badge {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 0.4px;
}

.side-badge.long { background: rgba(38, 166, 154, 0.3); color: #26a69a; }
.side-badge.short { background: rgba(239, 83, 80, 0.3); color: #ef5350; }

.position-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: monospace;
  color: #fff;
}

.position-stat label {
  color: #999;
  font-family: inherit;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.4px;
}

.position-stat.bid span:last-child { color: #26a69a; }
.position-stat.ask span:last-child { color: #ef5350; }
.position-stat.tp span:last-child { color: #26a69a; }
.position-stat.sl span:last-child { color: #ef5350; }

/* ── Bid/ask wall lines on chart ──────────────────────────────────────── */
.wall-lines { pointer-events: none; }

.wall-line {
  stroke-width: 1.5;
  stroke-dasharray: 10, 4;
  opacity: 0.75;
}

.wall-line.bid { stroke: #26a69a; }
.wall-line.ask { stroke: #ef5350; }

.wall-price-label {
  font-size: 10px;
  font-weight: bold;
  font-family: monospace;
}

.wall-price-label.bid { fill: #26a69a; }
.wall-price-label.ask { fill: #ef5350; }

/* ── TP/SL lines on chart ─────────────────────────────────────────────── */
.tpsl-lines { pointer-events: none; }

.tpsl-line {
  stroke-width: 1.5;
  stroke-dasharray: 4, 4;
  opacity: 0.9;
}

.tpsl-line.tp { stroke: #64b5f6; }
.tpsl-line.sl { stroke: #ffb74d; }

.tpsl-price-label {
  font-size: 10px;
  font-weight: bold;
  font-family: monospace;
}

.tpsl-price-label.tp { fill: #64b5f6; }
.tpsl-price-label.sl { fill: #ffb74d; }

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

.chart-container {
  position: relative;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
}

.levels-svg {
  display: block;
}

.grid-line {
  stroke: rgba(255, 255, 255, 0.05);
  stroke-width: 1;
}

.level-line {
  stroke-dasharray: 8, 4;
  opacity: 0.85;
}

.level-line.support {
  stroke: #26a69a;
}

.level-line.resistance {
  stroke: #ef5350;
}

.touch-dot {
  opacity: 0.9;
  stroke: #0d0d0d;
  stroke-width: 1;
}

.touch-dot.support {
  fill: #26a69a;
}

.touch-dot.resistance {
  fill: #ef5350;
}

.level-label {
  font-size: 10px;
  font-weight: bold;
  font-family: monospace;
}

.level-label.support {
  fill: #26a69a;
}

.level-label.resistance {
  fill: #ef5350;
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

.price-label {
  fill: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  text-anchor: end;
  user-select: none;
}

/* ── Volume pane ───────────────────────────────────────────────────────── */
.divider-line {
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}

.volume-grid-line {
  stroke: rgba(255, 255, 255, 0.05);
  stroke-width: 1;
  stroke-dasharray: 3, 3;
}

.volume-bar {
  opacity: 0.55;
}

.volume-bar.bull {
  fill: #26a69a;
}

.volume-bar.bear {
  fill: #ef5350;
}

.volume-axis-label {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-family: monospace;
  text-anchor: end;
  user-select: none;
}

.volume-pane-label {
  fill: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  user-select: none;
}
</style>