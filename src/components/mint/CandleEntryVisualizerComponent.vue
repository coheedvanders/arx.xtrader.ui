<template>
  <div class="candle-visualizer">
    <div class="controls">
      <label class="checkbox-label">
        <input 
          v-model="connectVolumeSpikesvSpikes" 
          type="checkbox"
        />
        <span>Connect volume spikes</span>
      </label>

      <!-- Live status indicator -->
      <div class="live-indicator" :class="wsStatus">
        <span class="live-dot" />
        <span class="live-label">{{ wsStatusLabel }}</span>
      </div>
    </div>

    <div class="chart-container" ref="chartContainer" @wheel="handleZoom" @mousemove="handleMouseMove" @mouseleave="handleMouseLeave" @mousedown="startChartDrag">
      <svg :width="svgWidth" :height="svgHeight" class="candles-svg">
        <!-- Crosshair Lines -->
        <g v-show="true" ref="crosshairGroup" class="crosshair">
          <line
            x1="0"
            y1="0"
            :x2="svgWidth"
            y2="0"
            class="crosshair-line horizontal"
            style="display: none"
          />
          <line
            x1="0"
            y1="0"
            x2="0"
            :y2="svgHeight"
            class="crosshair-line vertical"
            style="display: none"
          />
        </g>

        <!-- Price Zone Backgrounds (grouped by session) -->
        <g class="price-zones">
          <rect
            v-for="(zone, i) in zoneRectangles"
            :key="`zone-${i}`"
            :x="zone.x"
            :y="zone.y"
            :width="zone.width"
            :height="zone.height"
            :class="['zone-rect', { 'zone-active': zone.isActive }]"
          />
        </g>

        <!-- Price Zone Mid Lines -->
        <g class="zone-mid-lines">
          <line
            v-for="(midLine, i) in zoneMidLines"
            :key="`mid-line-${i}`"
            :x1="midLine.x1"
            :y1="midLine.y"
            :x2="midLine.x2"
            :y2="midLine.y"
            class="mid-line"
          />
        </g>

        <!-- Support/Resistance Lines -->
        <g class="support-resistance-lines">
          <line
            v-for="(line, i) in supportResistanceLines"
            :key="`sr-line-${i}`"
            :x1="line.x1"
            :y1="line.y"
            :x2="line.x2"
            :y2="line.y"
            :class="['sr-line', `sr-${line.type}`]"
          />
        </g>

        <!-- TP/SL Boxes -->
        <g class="tp-sl-boxes">
          <rect
            v-for="(box, i) in tpSlBoxes"
            :key="`tp-sl-${i}`"
            :x="box.x"
            :y="box.y"
            :width="box.width"
            :height="box.height"
            :class="['tp-sl-rect', `box-${box.type}`, `status-${box.status}`]"
          />
        </g>

        <!-- Volume Spike Connection Line -->
        <polyline
          v-if="connectVolumeSpikesvSpikes && volumeSpikePoints.length > 0"
          :points="volumeSpikePoints"
          class="volume-spike-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- Volume Spike Change Labels -->
        <g v-if="connectVolumeSpikesvSpikes && volumeSpikeChangeLabels.length > 0" class="volume-spike-labels">
          <text
            v-for="(label, i) in volumeSpikeChangeLabels"
            :key="`vol-spike-label-${i}`"
            :x="label.x"
            :y="label.y"
            :class="['volume-spike-label', label.changePositive ? 'positive' : 'negative']"
          >
            {{ label.text }}
          </text>
        </g>

        <!-- Grid Lines -->
        <g class="grid">
          <line
            v-for="(price, i) in gridPrices"
            :key="`grid-${i}`"
            :x1="0"
            :y1="priceToY(price)"
            :x2="svgWidth"
            :y2="priceToY(price)"
            class="grid-line"
          />
        </g>

        <!-- EMA9 Line -->
        <polyline
          v-if="emaPoints.length > 0"
          :points="emaPoints"
          class="ema-line"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />

        <!-- Zone Labels -->
        <g class="zone-labels">
          <text
            v-for="(label, i) in zoneLabels"
            :key="`label-${i}`"
            :x="label.x"
            :y="label.y"
            class="zone-label-text"
          >
          {{ label.text }}
          </text>
        </g>

        <!-- Pattern Track Indicators -->
        <g v-for="(candle, i) in displayCandles" :key="`pattern-${i}`" class="pattern-track-indicators">
          <!-- Weakening Indicator -->
          <g v-if="candle.isWeakening" class="weakening-indicator">
            <polygon
              :points="`
                ${candleX(i)},${priceToY(candle.low!) + 62}
                ${candleX(i) - 5},${priceToY(candle.low!) + 70}
                ${candleX(i)},${priceToY(candle.low!) + 78}
                ${candleX(i) + 5},${priceToY(candle.low!) + 70}
              `"
              class="weakening-diamond"
            />
          </g>

          <g v-if="candle.patternTrack === 'hl'" class="higher-low-indicator">
            <circle
              :cx="candleX(i)"
              :cy="priceToY(candle.low!) + 15"
              r="3"
              class="hl-dot"
            />
            <text
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 28"
              class="pattern-label"
            >
              HL
            </text>
          </g>

          <text
              v-if="candle.candleData?.isCandleInAbsorption"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 45"
              class="pattern-label"
            >
              x
            </text>

            <text
              v-if="candle.candleData?.isSellingExhaustion"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 55"
              class="pattern-label"
            >
              S
            </text>

            <text
              v-if="candle.candleData?.isBuyingExhaustion"
              :x="candleX(i)"
              :y="priceToY(candle.low!) + 55"
              class="pattern-label"
            >
              B
            </text>

          <g v-if="candle.patternTrack === 'lh'" class="lower-high-indicator">
            <circle
              :cx="candleX(i)"
              :cy="priceToY(candle.high!) - 15"
              r="3"
              class="lh-dot"
            />
            <text
              :x="candleX(i)"
              :y="priceToY(candle.high!) - 20"
              class="pattern-label"
            >
              LH
            </text>
          </g>
        </g>

        <!-- Candles -->
        <g class="candles">
          <g class="atr-extensions">
              <rect
                v-for="(candle, i) in displayCandles"
                :key="`atr-ext-${i}`"
                :x="candleX(i) - candleWidth / 2"
                :y="priceToY(Math.max(candle.close!, candle.close_atr_adjusted))"
                :width="candleWidth"
                :height="Math.abs(candle.close_atr_adjusted - candle.close!) / priceDelta * svgHeight"
                class="atr-extension-rect"
                :class="{'is_not_1': candle.close_atr_abs_change < 1}"
              />
            </g>
          <g
            v-for="(candle, i) in displayCandles"
            :key="`candle-${i}`"
            class="candle"
            :class="{ 
              bull: candle.close! >= candle.open!, 
              bear: candle.close! < candle.open!,
              indecisive: candle.candleData?.isIndecisive,
              live: i === displayCandles.length - 1 && liveCandle !== null
            }"
            @click="openCandleModal(i)"
            @mouseenter="hoveredCandleIndex = i"
            @mouseleave="hoveredCandleIndex = null"
          >

            <!-- Wick -->
            <line
              :x1="candleX(i)"
              :y1="priceToY(candle.high!)"
              :x2="candleX(i)"
              :y2="priceToY(candle.low!)"
              class="wick"
            />

            <!-- Body -->
            <rect
              :x="candleX(i) - candleWidth / 2"
              :y="priceToY(Math.max(candle.open!, candle.close!))"
              :width="candleWidth"
              :height="Math.max(Math.abs(candle.close! - candle.open!) / priceDelta * svgHeight, 1)"
              class="body"
            />

            <g v-if="candle.candleData?.volumeSpike" class="volume-spike-indicator">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 29"
                r="4"
                class="volume-spike-dot"
              />
            </g>

            <g v-if="candle.volumeAnalysis?.zScore! > 3">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 36"
                r="4"
                class="is-past-volume-good-dot"
              />
            </g>

            <g v-if="candle.candleData && candle.candleData.priceMove != 'normal'">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 45"
                r="4"
                class="price-move"
              />
            </g>

            <g v-if="candle.candleData?.changePercentageZScore! > 3">
              <circle
                :cx="candleX(i)"
                :cy="priceToY(candle.low!) + 56"
                r="4"
                class="is-change-high-dot"
              />
            </g>

            <g v-if="candle.candleData?.isLongPotential" class="long-potential">
              <polygon
                :points="`${candleX(i)},${priceToY(candle.low!) + 25} ${candleX(i) - 5},${priceToY(candle.low!) + 33} ${candleX(i) + 5},${priceToY(candle.low!) + 33}`"/>
            </g>

            <g v-if="candle.candleData?.isShortPotential" class="short-potential">
              <polygon
                :points="`${candleX(i)},${priceToY(candle.high!) - 25} ${candleX(i) - 5},${priceToY(candle.high!) - 33} ${candleX(i) + 5},${priceToY(candle.high!) - 33}`"
                class="chevron-down"
              />
            </g>

            <!-- Overbought -->
            <g v-if="candle.overboughSoldAnalysis?.extremeLevel == 'overbought'" class="ob-indicator">
              <rect
                :x="candleX(i) - 3"
                :y="priceToY(candle.high!) - 10"
                width="6"
                height="6"
                class="ob-marker"
              />
            </g>

            <!-- Oversold -->
            <g v-if="candle.overboughSoldAnalysis?.extremeLevel == 'oversold'" class="os-indicator">
              <rect
                :x="candleX(i) - 3"
                :y="priceToY(candle.low!) + 10"
                width="6"
                height="6"
                class="os-marker"
              />
            </g>
          </g>
        </g>

        <!-- Price Axis Labels (Interactive) -->
        <text
          v-for="(price, i) in gridPrices"
          :key="`price-${i}`"
          :x="svgWidth - 5"
          :y="priceToY(price) + 4"
          class="price-label"
          @mousedown="startPriceAdjust(price, i, $event)"
          :style="{ cursor: 'ns-resize' }"
        >
          {{ price.toFixed(4) }}
        </text>

        <!-- Live price label on the right axis -->
        <g v-if="liveCandle" class="live-price-label-group">
          <rect
            :x="svgWidth - 50"
            :y="priceToY(liveCandle.close!) - 9"
            width="62"
            height="16"
            :class="['live-price-bg', liveCandle.close! >= liveCandle.open! ? 'bull-bg' : 'bear-bg']"
            rx="3"
          />
          <text
            :x="svgWidth - 25"
            :y="priceToY(liveCandle.close!) + 4"
            class="live-price-text"
          >
            {{ liveCandle.close!.toFixed(4) }}
          </text>
        </g>
      </svg>
    </div>

    <!-- Candle Details Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ (new Date(selectedCandle?.openTime!)).toLocaleString() }}</h2>
          <button class="close-btn" @click="closeModal">×</button>
        </div>

        <div class="modal-body">
          <div v-if="selectedCandle" class="candle-details">
            <div class="detail-grid">
              <!-- OHLC -->
              <div class="detail-item">
                <label>Open</label>
                <span>{{ selectedCandle.open!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>High</label>
                <span>{{ selectedCandle.high!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Low</label>
                <span>{{ selectedCandle.low!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Close</label>
                <span>{{ selectedCandle.close!.toFixed(4) }}</span>
              </div>
              <div class="detail-item">
                <label>Status</label>
                <span>{{ selectedCandle.status }}</span>
              </div>

              <div class="detail-item">
                <label>Condition Met</label>
                <span>{{ selectedCandle.candleData?.conditionMet }}</span>
              </div>

              <div class="detail-item">
                <label>PNL</label>
                <span>{{ selectedCandle.pnl!.toFixed(4) }}</span>
              </div>

              <div class="detail-item">
                <label>Extra Info</label>
                <span>{{ selectedCandle.candleData!.extraInfo }}</span>
              </div>

              <!-- Price Zone -->
              <div v-if="selectedCandle.priceZone" class="detail-section">
                <h3>Price Zone</h3>
                <div class="detail-item">
                  <label>Upper</label>
                  <span>{{ selectedCandle.priceZone!.upper }}</span>
                </div>
                <div class="detail-item">
                  <label>Mid</label>
                  <span>{{ selectedCandle.priceZone!.mid }}</span>
                </div>
                <div class="detail-item">
                  <label>Lower</label>
                  <span>{{ selectedCandle.priceZone!.lower }}</span>
                </div>
              </div>

              <!-- Support/Resistance -->
              <div v-if="selectedCandle.support || selectedCandle.resistance" class="detail-section">
                <h3>Support/Resistance</h3>
                <div v-if="selectedCandle.support" class="detail-item">
                  <label>Support</label>
                  <span>{{ selectedCandle.support?.lower!.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.resistance" class="detail-item">
                  <label>Resistance</label>
                  <span>{{ selectedCandle.resistance?.upper!.toFixed(4) }}</span>
                </div>
              </div>

              <!-- Trading Info -->
              <div v-if="selectedCandle.tpPrice || selectedCandle.slPrice || selectedCandle.side" class="detail-section">
                <h3>Trading Info</h3>
                <div v-if="selectedCandle.tpPrice" class="detail-item">
                  <label>TP Price</label>
                  <span>{{ selectedCandle.tpPrice.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.slPrice" class="detail-item">
                  <label>SL Price</label>
                  <span>{{ selectedCandle.slPrice.toFixed(4) }}</span>
                </div>
                <div v-if="selectedCandle.side" class="detail-item">
                  <label>Side</label>
                  <span :class="`side-badge side-${selectedCandle.side.toLowerCase()}`">{{ selectedCandle.side }}</span>
                </div>
              </div>

              <!-- Candle Data -->
              <div v-if="selectedCandle.candleData" class="detail-section">
                <h3>Candle Data</h3>
                <div v-for="(value, key) in selectedCandle.candleData" :key="key">
                  <template v-if="typeof value === 'object' && value !== null">
                    <div class="nested-section">
                      <h4>{{ key }}</h4>
                      <div v-for="(nestedValue, nestedKey) in value" :key="`${key}-${nestedKey}`" class="detail-item nested">
                        <label>{{ nestedKey }}</label>
                        <span>{{ formatValue(nestedValue) }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="detail-item">
                      <label>{{ key }}</label>
                      <span>{{ formatValue(value) }}</span>
                    </div>
                  </template>
                </div>
              </div>

              <!-- Status -->
              <div v-if="selectedCandle.status" class="detail-section">
                <h3>Status</h3>
                <div class="detail-item">
                  <label>Status</label>
                  <span :class="`status-badge status-${selectedCandle.status.toLowerCase()}`">{{ selectedCandle.status }}</span>
                </div>
              </div>

              <!-- Other Properties -->
              <div v-if="Object.keys(otherProps).length > 0" class="detail-section">
                <h3>Additional Properties</h3>
                <div v-for="(value, key) in otherProps" :key="key">
                  <template v-if="typeof value === 'object' && value !== null">
                    <div class="nested-section">
                      <h4>{{ key }}</h4>
                      <div v-for="(nestedValue, nestedKey) in value" :key="`${key}-${nestedKey}`" class="detail-item nested">
                        <label>{{ nestedKey }}</label>
                        <span>{{ formatValue(nestedValue) }}</span>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="detail-item">
                      <label>{{ key }}</label>
                      <span>{{ formatValue(value) }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CandleEntry } from '@/core/interfaces';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

// ─── Binance kline stream message shape ───────────────────────────────────────
interface BinanceKline {
  t: number   // Kline open time (ms)
  T: number   // Kline close time (ms)
  o: string   // Open price
  h: string   // High price
  l: string   // Low price
  c: string   // Close price
  v: string   // Base asset volume
  x: boolean  // Is this kline closed?
}

interface BinanceKlineMessage {
  e: 'kline'
  E: number
  s: string
  k: BinanceKline
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  candles: CandleEntry[]
  /** e.g. 'btcusdt' — must be lowercase for Binance stream name */
  symbol?: string
  /** Kline interval, must match the interval of the candles you're passing in */
  interval?: string
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'btcusdt',
  interval: '15m',
})

// ─── State ────────────────────────────────────────────────────────────────────
const selectedCandleIndex = ref<number | null>(null)
const showModal = ref(false)
const hoveredCandleIndex = ref<number | null>(null)
const candleWidth = ref(8)
const connectVolumeSpikesvSpikes = ref(false)
const candleGap = 5
const svgHeight = 600
const CANDLES_PER_ZONE = 24
const minCandleWidth = 8
const maxCandleWidth = 50
const zoomSensitivity = 0.1
const SR_SPAN = 3

const chartContainer = ref<HTMLElement | null>(null)
const crosshairGroup = ref<SVGGElement | null>(null)
const priceRangeMin = ref(0)
const priceRangeMax = ref(0)
let isAdjustingHeight = false
let isDraggingChart = false

// ─── WebSocket / live candle ──────────────────────────────────────────────────
type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
const wsStatus = ref<WsStatus>('connecting')
const wsStatusLabel = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Live',
  disconnected: 'Disconnected',
  error:        'Error',
}[wsStatus.value]))

/**
 * Partial CandleEntry overlay — only OHLC are live-patched; every other field
 * is inherited from the last candle in `props.candles`.
 */
const liveCandle = ref<CandleEntry | null>(null)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const MAX_RECONNECT_DELAY_MS = 30_000
let reconnectDelay = 2_000

function connectWebSocket() {
  if (ws) {
    ws.onclose = null   // prevent the reconnect handler from firing twice
    ws.close()
  }
 
  const streamName = `${props.symbol.toLowerCase()}@kline_${props.interval}`
  const url = `wss://fstream.binance.com/market/ws/${streamName}`
 
  wsStatus.value = 'connecting'
  ws = new WebSocket(url)
 
  ws.onopen = () => {
    wsStatus.value = 'connected'
    reconnectDelay = 2_000
  }
 
  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg: BinanceKlineMessage = JSON.parse(event.data as string)
      if (msg.e !== 'kline') return
 
      const k = msg.k
      const o = parseFloat(k.o)
      const h = parseFloat(k.h)
      const l = parseFloat(k.l)
      const c = parseFloat(k.c)
 
      // Guard: skip malformed frames — any NaN would collapse priceDelta to NaN
      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) return
 
      const lastPropCandle = props.candles[props.candles.length - 1]
      if (!lastPropCandle) return
 
      // Patch OHLC into a shallow copy of the last prop candle so all
      // computed indicators (zones, SR, etc.) remain intact.
      liveCandle.value = {
        ...lastPropCandle,
        openTime: k.t,
        open:  o,
        high:  h,
        low:   l,
        close: c,
      }
    } catch {
      // malformed frame — ignore
    }
  }
 
  ws.onerror = () => {
    wsStatus.value = 'error'
  }
 
  ws.onclose = () => {
    wsStatus.value = 'disconnected'
    // Exponential back-off reconnect
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      connectWebSocket()
    }, reconnectDelay)
  }
}

function disconnectWebSocket() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
}

// ─── displayCandles: replace last item with live data when available ──────────
/**
 * Drop-in replacement for `props.candles` across all computeds below.
 * All indices stay the same — only the last candle's OHLC values change.
 */
const displayCandles = computed<CandleEntry[]>(() => {
  if (!liveCandle.value || props.candles.length === 0) return props.candles
  return [
    ...props.candles.slice(0, props.candles.length),
    liveCandle.value,
  ]
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  scrollToRight()
  connectWebSocket()
})

onUnmounted(() => {
  disconnectWebSocket()
})

// ─── Existing computed / helpers (unchanged, but now use displayCandles) ──────

const selectedCandle = computed(() => {
  return selectedCandleIndex.value !== null ? displayCandles.value[selectedCandleIndex.value] : null
})

const otherProps = computed(() => {
  if (!selectedCandle.value) return {}
  const excluded = ['open', 'high', 'low', 'close', 'priceZone', 'tpPrice', 'slPrice', 'side', 'candleData', 'status']
  const others: Record<string, any> = {}
  for (const [key, value] of Object.entries(selectedCandle.value)) {
    if (!excluded.includes(key) && value !== undefined && value !== null) {
      others[key] = value
    }
  }
  return others
})

const minPrice = computed(() => {
  if (priceRangeMin.value !== 0) return priceRangeMin.value
  return Math.min(...displayCandles.value.map(c => c.low!)) * 0.98
})

const maxPrice = computed(() => {
  if (priceRangeMax.value !== 0) return priceRangeMax.value
  return Math.max(...displayCandles.value.map(c => c.high!)) * 1.02
})

const priceDelta = computed(() => maxPrice.value - minPrice.value)

const svgWidth = computed(() => {
  return displayCandles.value.length * (candleWidth.value + candleGap) + 60
})

const gridPrices = computed(() => {
  const range = maxPrice.value - minPrice.value
  const step = range / 8
  return Array.from({ length: 9 }, (_, i) => minPrice.value + step * i)
})

const scrollToRight = () => {
  if (chartContainer.value) {
    nextTick(() => {
      chartContainer.value!.scrollLeft = chartContainer.value!.scrollWidth
    })
  }
}

const zoneRectangles = computed(() => {
  const rects = []
  let currentZone = null
  let zoneStartIndex = 0

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        rects.push({
          x: candleX(zoneStartIndex) - candleWidth.value / 2,
          y: priceToY(currentZone.upper!),
          width: candleX(i - 1) + candleWidth.value / 2 - (candleX(zoneStartIndex) - candleWidth.value / 2),
          height: priceToY(currentZone.lower!) - priceToY(currentZone.upper!),
          isActive: false,
        })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const zoneEndIndex = Math.min(zoneStartIndex + CANDLES_PER_ZONE - 1, displayCandles.value.length - 1)
    const endX = candleX(zoneEndIndex) + candleWidth.value / 2
    rects.push({
      x: candleX(zoneStartIndex) - candleWidth.value / 2,
      y: priceToY(currentZone.upper!),
      width: endX - (candleX(zoneStartIndex) - candleWidth.value / 2),
      height: priceToY(currentZone.lower!) - priceToY(currentZone.upper!),
      isActive: true,
    })
  }

  return rects
})

const zoneMidLines = computed(() => {
  const lines = []
  let currentZone = null
  let zoneStartIndex = 0

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        lines.push({
          x1: candleX(zoneStartIndex) - candleWidth.value / 2,
          x2: candleX(i - 1) + candleWidth.value / 2,
          y: priceToY(currentZone.mid!),
        })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const zoneEndIndex = Math.min(zoneStartIndex + CANDLES_PER_ZONE - 1, displayCandles.value.length - 1)
    lines.push({
      x1: candleX(zoneStartIndex) - candleWidth.value / 2,
      x2: candleX(zoneEndIndex) + candleWidth.value / 2,
      y: priceToY(currentZone.mid!),
    })
  }

  return lines
})

const supportResistanceLines = computed(() => {
  const lines: any[] = []

  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]

    if (candle.breakthrough_support && candle.support?.lower) {
      const startIndex = Math.max(0, i - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, i + SR_SPAN)
      lines.push({ x1: candleX(startIndex) - candleWidth.value / 2, x2: candleX(endIndex) + candleWidth.value / 2, y: priceToY(candle.support.lower), type: 'breakthrough_support' })
    }

    if (candle.breakthrough_resistance && candle.resistance?.upper) {
      const startIndex = Math.max(0, i - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, i + SR_SPAN)
      lines.push({ x1: candleX(startIndex) - candleWidth.value / 2, x2: candleX(endIndex) + candleWidth.value / 2, y: priceToY(candle.resistance.upper), type: 'breakthrough_resistance' })
    }
  }

  if (hoveredCandleIndex.value !== null) {
    const candleIndex = hoveredCandleIndex.value
    const candle = displayCandles.value[candleIndex]

    if (candle.support || candle.resistance) {
      const startIndex = Math.max(0, candleIndex - SR_SPAN)
      const endIndex = Math.min(displayCandles.value.length - 1, candleIndex + SR_SPAN)
      const x1 = candleX(startIndex) - candleWidth.value / 2
      const x2 = candleX(endIndex) + candleWidth.value / 2

      if (candle.support?.lower) lines.push({ x1, x2, y: priceToY(candle.support.lower), type: 'support' })
      if (candle.resistance?.upper) lines.push({ x1, x2, y: priceToY(candle.resistance.upper), type: 'resistance' })
    }
  }

  return lines
})

const zoneLabels = computed(() => {
  const labels = []
  let currentZone = null
  let zoneStartIndex = 0
  var currentSize = 0

  for (let i = 0; i <= displayCandles.value.length - 1; i++) {
    const candle = displayCandles.value[i]
    if (candle.priceZone && (!currentZone || JSON.stringify(currentZone) !== JSON.stringify(candle.priceZone))) {
      if (currentZone) {
        currentSize = displayCandles.value[i - 1].candleData!.zoneSizePercentage!
        const midX = (candleX(zoneStartIndex) + candleX(i - 1)) / 2
        labels.push({ x: midX, y: priceToY(currentZone.upper!) - 15, text: `${currentSize.toFixed(2)}% | ${displayCandles.value[i - 1].candleData!.extraInfo}` })
      }
      currentZone = candle.priceZone
      zoneStartIndex = i
    }
  }

  if (currentZone) {
    const midX = (candleX(zoneStartIndex) + candleX(displayCandles.value.length - 1)) / 2
    currentSize = displayCandles.value[displayCandles.value.length - 1].candleData!.zoneSizePercentage!
    labels.push({ x: midX, y: priceToY(currentZone.upper!) - 15, text: `${currentSize.toFixed(2)}%` })
  }

  return labels
})

const emaPoints = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const ema9 = displayCandles.value[i].candleData?.ema200
    if (ema9 !== undefined && ema9 !== null) {
      points.push(`${candleX(i)},${priceToY(ema9)}`)
    }
  }
  return points.join(' ')
})

const volumeSpikePoints = computed(() => {
  const points: string[] = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    if (displayCandles.value[i].candleData?.volumeSpike) {
      points.push(`${candleX(i)},${priceToY(displayCandles.value[i].close!)}`)
    }
  }
  return points.join(' ')
})

const volumeSpikeChangeLabels = computed(() => {
  const labels: any[] = []
  const spikeIndices: number[] = []

  for (let i = 0; i < displayCandles.value.length; i++) {
    if (displayCandles.value[i].candleData?.volumeSpike) spikeIndices.push(i)
  }

  for (let i = 0; i < spikeIndices.length - 1; i++) {
    const ci = spikeIndices[i]
    const ni = spikeIndices[i + 1]
    const cp = displayCandles.value[ci].close!
    const np = displayCandles.value[ni].close!
    const pct = ((np - cp) / cp) * 100
    labels.push({
      x: (candleX(ci) + candleX(ni)) / 2,
      y: (priceToY(cp) + priceToY(np)) / 2 - 8,
      text: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
      changePositive: pct >= 0,
    })
  }

  return labels
})

const positions = computed(() => {
  const result = []
  for (let i = 0; i < displayCandles.value.length; i++) {
    const candle = displayCandles.value[i]
    if (candle.tpPrice && candle.slPrice && candle?.side) {
      let endIndex = i
      let endStatus = 'OPEN'
      for (let j = i + 1; j < displayCandles.value.length; j++) {
        const nc = displayCandles.value[j]
        if (nc.status && nc.status.includes('_')) { endIndex = j; endStatus = nc.status; break }
      }
      if (endStatus === 'OPEN') endIndex = displayCandles.value.length - 1
      result.push({ startIndex: i, endIndex, entryPrice: candle.close, tpPrice: candle.tpPrice, slPrice: candle.slPrice, side: candle.side, status: endStatus })
      i = endIndex
    }
  }
  return result
})

const tpSlBoxes = computed(() => {
  const boxes = []
  for (const pos of positions.value) {
    const isLong = pos.side === 'LONG'
    const tpUpper = isLong ? pos.tpPrice : pos.entryPrice
    const tpLower = isLong ? pos.entryPrice : pos.tpPrice
    boxes.push({ x: candleX(pos.startIndex) - candleWidth.value / 2, y: priceToY(tpUpper!), width: candleX(pos.endIndex) - candleX(pos.startIndex) + candleWidth.value, height: priceToY(tpLower!) - priceToY(tpUpper!), type: 'tp', status: pos.status })
    const slUpper = isLong ? pos.entryPrice : pos.slPrice
    const slLower = isLong ? pos.slPrice : pos.entryPrice
    boxes.push({ x: candleX(pos.startIndex) - candleWidth.value / 2, y: priceToY(slUpper!), width: candleX(pos.endIndex) - candleX(pos.startIndex) + candleWidth.value, height: priceToY(slLower!) - priceToY(slUpper!), type: 'sl', status: pos.status })
  }
  return boxes
})

// ─── Helpers ──────────────────────────────────────────────────────────────────
const priceToY = (price: number): number => {
  return ((maxPrice.value - price) / priceDelta.value) * svgHeight
}

const candleX = (index: number): number => {
  return index * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10
}

const handleZoom = (event: WheelEvent) => {
  event.preventDefault()
  const direction = event.deltaY > 0 ? -1 : 1
  const newWidth = candleWidth.value + direction * zoomSensitivity * 5
  if (newWidth >= minCandleWidth && newWidth <= maxCandleWidth) {
    candleWidth.value = newWidth
  }
}

const handleMouseMove = (event: MouseEvent) => {
  if (!chartContainer.value || !crosshairGroup.value) return
  const rect = chartContainer.value.querySelector('svg')?.getBoundingClientRect()
  if (!rect) return
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const h = crosshairGroup.value.querySelector('.crosshair-line.horizontal') as SVGLineElement
  const v = crosshairGroup.value.querySelector('.crosshair-line.vertical') as SVGLineElement
  if (h) { h.setAttribute('y1', String(y)); h.setAttribute('y2', String(y)); h.style.display = 'block' }
  if (v) { v.setAttribute('x1', String(x)); v.setAttribute('x2', String(x)); v.style.display = 'block' }
}

const handleMouseLeave = () => {
  if (!crosshairGroup.value) return
  const h = crosshairGroup.value.querySelector('.crosshair-line.horizontal') as SVGLineElement
  const v = crosshairGroup.value.querySelector('.crosshair-line.vertical') as SVGLineElement
  if (h) h.style.display = 'none'
  if (v) v.style.display = 'none'
}

const startChartDrag = (event: MouseEvent) => {
  if ((event.target as SVGElement).classList?.contains('price-label')) return
  isDraggingChart = true
  const startX = event.clientX
  const startY = event.clientY
  const startScrollLeft = chartContainer.value?.scrollLeft || 0
  const startMinPrice = minPrice.value
  const startMaxPrice = maxPrice.value
  const originalRange = startMaxPrice - startMinPrice

  const handleDragMove = (moveEvent: MouseEvent) => {
    if (!isDraggingChart || !chartContainer.value) return
    chartContainer.value.scrollLeft = startScrollLeft - (moveEvent.clientX - startX)
    const priceShift = ((moveEvent.clientY - startY) / svgHeight) * originalRange
    priceRangeMin.value = startMinPrice + priceShift
    priceRangeMax.value = startMaxPrice + priceShift
  }

  const handleDragEnd = () => {
    isDraggingChart = false
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
  }

  document.addEventListener('mousemove', handleDragMove)
  document.addEventListener('mouseup', handleDragEnd)
}

const startPriceAdjust = (price: number, index: number, event: MouseEvent) => {
  event.preventDefault()
  isAdjustingHeight = true
  const startY = event.clientY
  const originalRange = maxPrice.value - minPrice.value

  const handleMove = (moveEvent: MouseEvent) => {
    const priceShift = ((moveEvent.clientY - startY) / svgHeight) * originalRange
    const newMin = minPrice.value - priceShift
    const newMax = maxPrice.value + priceShift
    if (newMax - newMin > originalRange * 0.1) {
      priceRangeMin.value = newMin
      priceRangeMax.value = newMax
    }
  }

  const handleUp = () => {
    isAdjustingHeight = false
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

const openCandleModal = (index: number) => {
  selectedCandleIndex.value = index
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
  selectedCandleIndex.value = null
}

const formatValue = (value: any): string => {
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<style scoped>
.candle-visualizer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  overflow-x: auto;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.checkbox-label input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

/* ── Live indicator ───────────────────────────────────────────────────── */
.live-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
  margin-left: auto;
  letter-spacing: 0.4px;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.live-indicator.connected   { color: #26a69a; }
.live-indicator.connecting  { color: #fbbf24; }
.live-indicator.disconnected{ color: #888; }
.live-indicator.error       { color: #ef5350; }

.live-indicator.connected   .live-dot { background: #26a69a; box-shadow: 0 0 6px #26a69a; animation: pulse 1.5s infinite; }
.live-indicator.connecting  .live-dot { background: #fbbf24; }
.live-indicator.disconnected .live-dot{ background: #555; }
.live-indicator.error       .live-dot { background: #ef5350; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

/* ── Live price label on axis ─────────────────────────────────────────── */
.live-price-label-group { pointer-events: none; }

.live-price-bg { opacity: 0.9; }
.live-price-bg.bull-bg { fill: #26a69a; }
.live-price-bg.bear-bg { fill: #ef5350; }

.live-price-text {
  fill: #fff;
  font-size: 10px;
  font-weight: bold;
  text-anchor: middle;
  font-family: monospace;
}

/* ── Live candle outline ──────────────────────────────────────────────── */
.candle.live .body {
  stroke-dasharray: 3 2;
  opacity: 0.95;
}

/* ── Rest of original styles ──────────────────────────────────────────── */
.chart-container {
  position: relative;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  user-select: none;
}

.candles-svg { display: block; }

.crosshair { pointer-events: none; }
.crosshair-line { stroke: rgba(255,255,255,0.3); stroke-width: 1; stroke-dasharray: 4,4; }
.crosshair-line.horizontal { opacity: 0.6; }
.crosshair-line.vertical   { opacity: 0.6; }

.zone-rect { fill: rgba(128,128,128,0.12); stroke: rgba(255,255,255,0.1); stroke-width: 1; }
.zone-rect.zone-active { fill: rgba(100,149,237,0.2); stroke: rgba(100,149,237,0.4); stroke-width: 2; }

.zone-mid-lines { pointer-events: none; }
.mid-line { stroke: rgba(255,255,255,0.3); stroke-width: 1.5; stroke-dasharray: 4,4; }

.support-resistance-lines { pointer-events: none; }
.sr-line { stroke-width: 2; stroke-dasharray: 6,3; }
.sr-line.sr-support { stroke: #ef5350; opacity: 0.8; }
.sr-line.sr-resistance { stroke: #26a69a; opacity: 0.8; }
.sr-line.sr-breakthrough_support { stroke: #ef5350; opacity: 1; stroke-width: 1; stroke-dasharray: 8,4; }
.sr-line.sr-breakthrough_resistance { stroke: #26a69a; opacity: 1; stroke-width: 1; stroke-dasharray: 8,4; }

.tp-sl-boxes { pointer-events: none; }
.tp-sl-rect { stroke-width: 2; }
.tp-sl-rect.box-tp { fill: rgba(38,166,154,0.3); stroke: #26a69a; }
.tp-sl-rect.box-tp.status-open { fill: rgba(38,166,154,0.2); }
.tp-sl-rect.box-tp.status-win_long, .tp-sl-rect.box-tp.status-win_short { fill: rgba(38,166,154,0.4); }
.tp-sl-rect.box-tp.status-loss_long, .tp-sl-rect.box-tp.status-loss_short { fill: rgba(38,166,154,0.15); }
.tp-sl-rect.box-sl { fill: rgba(239,83,80,0.3); stroke: #ef5350; }
.tp-sl-rect.box-sl.status-open { fill: rgba(239,83,80,0.2); }
.tp-sl-rect.box-sl.status-win_long, .tp-sl-rect.box-sl.status-win_short { fill: rgba(239,83,80,0.15); }
.tp-sl-rect.box-sl.status-loss_long, .tp-sl-rect.box-sl.status-loss_short { fill: rgba(239,83,80,0.4); }

.volume-spike-line { stroke: #fb923c; opacity: 0.8; pointer-events: none; }

.long-potential  { stroke: #42f12b; fill: #42f12b; opacity: 0.8; pointer-events: none; }
.short-potential { stroke: #ff2323; fill: #ff2323; opacity: 0.8; pointer-events: none; }
.ema-line { stroke: #ffffff; opacity: 0.7; pointer-events: none; }

.grid-line { stroke: rgba(255,255,255,0.05); stroke-width: 1; }

.price-label { fill: rgba(255,255,255,0.6); font-size: 11px; text-anchor: end; user-select: none; }
.price-label:hover { fill: rgba(255,255,255,0.9); font-weight: bold; }

.zone-label-text { fill: rgba(255,255,255,0.4); font-size: 10px; pointer-events: none; }

.candle { cursor: pointer; transition: opacity 0.2s; }
.candle:hover { opacity: 0.8; }
.candle.indecisive { opacity: 0.5; }
.wick { stroke-width: 1; }
.candle.bull .wick { stroke: #26a69a; }
.candle.bear .wick { stroke: #ef5350; }
.body { stroke-width: 1; }
.candle.bull .body { fill: #26a69a; stroke: #26a69a; }
.candle.bear .body { fill: #ef5350; stroke: #ef5350; }

.volume-spike-indicator { pointer-events: none; }
.volume-spike-dot   { fill: #fbbf24; opacity: 0.9; }
.is-past-volume-good-dot { fill: #ffffff; opacity: 0.9; }
.is-change-high-dot { fill: #3bd1ff; opacity: 0.9; }
.price-move         { fill: #b130d1; opacity: 0.9; }

.support-resistance-dots { pointer-events: none; }
.sr-dot { fill: #808080; opacity: 0.3; transition: opacity 0.2s; }
.sr-dot.visible { opacity: 0.8; }

.modal-overlay { position: fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:1000; }
.modal-content { background:#1a1a1a; border:1px solid #333; border-radius:8px; max-width:600px; max-height:80vh; overflow-y:auto; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
.modal-header { display:flex; justify-content:space-between; align-items:center; padding:1.5rem; border-bottom:1px solid #333; position:sticky; top:0; background:#1a1a1a; }
.modal-header h2 { margin:0; font-size:18px; color:#26a69a; }
.close-btn { background:none; border:none; color:#999; font-size:24px; cursor:pointer; padding:0; width:30px; height:30px; display:flex; align-items:center; justify-content:center; transition:color 0.2s; }
.close-btn:hover { color:#fff; }
.modal-body { padding:1.5rem; }
.candle-details { color:#fff; }
.detail-grid { display:flex; flex-direction:column; gap:1.5rem; }
.detail-section { border-left:2px solid #26a69a; padding-left:1rem; }
.detail-section h3 { margin:0 0 0.5rem 0; font-size:14px; color:#26a69a; }
.detail-item { display:flex; justify-content:space-between; margin-bottom:0.5rem; font-size:13px; }
.detail-item label { color:#999; min-width:120px; }
.detail-item span { color:#fff; font-family:monospace; font-weight:500; }
.side-badge, .status-badge { padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold; }
.side-badge.side-long { background:rgba(38,166,154,0.3); color:#26a69a; }
.side-badge.side-short { background:rgba(239,83,80,0.3); color:#ef5350; }
.status-badge { background:rgba(100,149,237,0.3); color:#64b5f6; }
.nested-section { margin-left:1rem; padding-left:1rem; border-left:1px solid #444; margin-top:0.75rem; margin-bottom:0.75rem; }
.nested-section h4 { margin:0 0 0.5rem 0; font-size:12px; color:#999; text-transform:uppercase; letter-spacing:0.5px; }
.detail-item.nested { margin-bottom:0.35rem; }
.detail-item.nested label { min-width:100px; font-size:12px; }

.volume-spike-label { font-size:11px; font-weight:bold; text-anchor:middle; }
.volume-spike-label.positive { fill:#26a69a; }
.volume-spike-label.negative { fill:#ef5350; }

.ob-marker { fill: red; }
.os-marker { fill: green; }

.atr-extensions { pointer-events: none; }
.atr-extension-rect { stroke:#808080; stroke-width:1; opacity:0.5; stroke-linecap:round; background:gray; }
.atr-extension-rect.is_not_1 { display:none; }

.pattern-track-indicators { pointer-events: none; }
.higher-low-indicator { opacity: 0.9; }
.hl-dot { fill:#42f12b; opacity:1; }
.lower-high-indicator { opacity: 0.9; }
.lh-dot { fill:#ff2323; opacity:1; }
.pattern-label { font-size:10px; font-weight:bold; text-anchor:middle; fill:#fff; opacity:0.8; }
.pattern-label:hover { opacity:1; font-size:11px; }
.weakening-indicator { pointer-events: none; }
.weakening-diamond { fill:#f59e0b; opacity:0.9; stroke:#fcd34d; stroke-width:1; }
</style>