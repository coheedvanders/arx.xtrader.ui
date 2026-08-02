<!-- MAStructureAnalysisComponent.vue -->
<template>
  <div class="ma-structure-analysis">
    <div class="header-row">
      <div class="symbol-badge">{{ data.symbol }} · {{ data.baseInterval }} · {{ data.period.candles }} candles</div>
      <div class="range-label">{{ formatDate(data.period.from) }} → {{ formatDate(data.period.to) }}</div>
    </div>

    <div v-if="!rows.length" class="empty-state">No candle data to analyze.</div>

    <template v-else>
      <!-- ── 1. Market structure ─────────────────────────────────────────── -->
      <section class="panel">
        <div class="panel-header">
          <span>Market Structure</span>
          <span class="verdict-badge" :class="structure.alignmentClass">{{ structure.alignmentLabel }}</span>
        </div>

        <div class="structure-chain">
          <template v-for="(node, i) in structure.order" :key="node.key">
            <span class="structure-node" :class="{ 'is-price': node.key === 'price' }" :style="{ color: node.color }">
              {{ node.label }}
              <span class="structure-value">{{ formatPrice(node.value) }}</span>
            </span>
            <span v-if="i < structure.order.length - 1" class="structure-sep">›</span>
          </template>
        </div>

        <ul class="reasoning-list">
          <li v-for="(line, i) in structure.reasoning" :key="i">{{ line }}</li>
        </ul>
      </section>

      <!-- ── 2. Squeeze / expansion ──────────────────────────────────────── -->
      <section class="panel">
        <div class="panel-header">
          <span>Squeeze / Expansion</span>
          <span class="verdict-badge" :class="squeeze.stateClass">{{ squeeze.state }}</span>
        </div>

        <div class="stat-row">
          <span class="stat"><label>Current spread</label><span>{{ squeeze.currentPct.toFixed(2) }}%</span></span>
          <span class="stat"><label>{{ squeeze.rangeLabel }} ago</label><span>{{ squeeze.startPct.toFixed(2) }}%</span></span>
          <span class="stat"><label>Trend</label><span>{{ squeeze.trendLabel }}</span></span>
          <span class="stat">
            <label>Squeeze &lt;</label>
            <input v-model.number="squeezeThresholdPct" type="number" min="0.1" max="20" step="0.1" class="ctrl-input" /> %
          </span>
          <span class="stat">
            <label>Expansion &gt;</label>
            <input v-model.number="expansionThresholdPct" type="number" min="0.1" max="30" step="0.1" class="ctrl-input" /> %
          </span>
        </div>

        <p class="reasoning-line">{{ squeeze.narrative }}</p>
      </section>

      <!-- ── 3 & 4. Long / short scenarios ───────────────────────────────── -->
      <section class="scenario-grid">
        <div class="scenario-card long" :class="{ 'is-previewing': previewLong }">
          <div class="scenario-header">
            <span>Long Scenario</span>
            <span class="scenario-header-actions">
              <span class="verdict-badge" :class="convictionClass(conviction.long)">{{ conviction.long }} conviction</span>
              <button
                v-if="longScenario"
                type="button"
                class="preview-btn long"
                :class="{ active: previewLong }"
                @click="togglePreview('long')"
              >
                {{ previewLong ? '● Previewing' : 'Preview' }}
              </button>
            </span>
          </div>
          <template v-if="longScenario">
            <div class="scenario-row"><label>Entry</label><span>{{ formatPrice(longScenario.entry) }} <em>({{ longScenario.entryReason }})</em></span></div>
            <div class="scenario-row"><label>Stop-loss</label><span>{{ formatPrice(longScenario.stop) }} <em>({{ longScenario.stopReason }})</em></span></div>
            <div class="scenario-row"><label>Take-profit</label><span>{{ formatPrice(longScenario.target) }} <em>({{ longScenario.targetReason }})</em></span></div>
            <div class="scenario-row rr"><label>Risk : Reward</label><span :class="{ good: longScenario.rr >= 2, weak: longScenario.rr < 2 }">{{ longScenario.rr.toFixed(2) }} : 1</span></div>
          </template>
          <p v-else class="reasoning-line">Not enough structural data (swing low / MA) to build a long plan.</p>
        </div>

        <div class="scenario-card short" :class="{ 'is-previewing': previewShort }">
          <div class="scenario-header">
            <span>Short Scenario</span>
            <span class="scenario-header-actions">
              <span class="verdict-badge" :class="convictionClass(conviction.short)">{{ conviction.short }} conviction</span>
              <button
                v-if="shortScenario"
                type="button"
                class="preview-btn short"
                :class="{ active: previewShort }"
                @click="togglePreview('short')"
              >
                {{ previewShort ? '● Previewing' : 'Preview' }}
              </button>
            </span>
          </div>
          <template v-if="shortScenario">
            <div class="scenario-row"><label>Entry</label><span>{{ formatPrice(shortScenario.entry) }} <em>({{ shortScenario.entryReason }})</em></span></div>
            <div class="scenario-row"><label>Stop-loss</label><span>{{ formatPrice(shortScenario.stop) }} <em>({{ shortScenario.stopReason }})</em></span></div>
            <div class="scenario-row"><label>Take-profit</label><span>{{ formatPrice(shortScenario.target) }} <em>({{ shortScenario.targetReason }})</em></span></div>
            <div class="scenario-row rr"><label>Risk : Reward</label><span :class="{ good: shortScenario.rr >= 2, weak: shortScenario.rr < 2 }">{{ shortScenario.rr.toFixed(2) }} : 1</span></div>
          </template>
          <p v-else class="reasoning-line">Not enough structural data (swing high / MA) to build a short plan.</p>
        </div>
      </section>

      <!-- ── 5. Conviction / probability read ────────────────────────────── -->
      <section class="panel">
        <div class="panel-header"><span>Conviction Read</span></div>
        <div class="conviction-row">
          <span class="conviction-pill" :class="convictionClass(conviction.long)">Long · {{ conviction.long }}</span>
          <span class="conviction-pill" :class="convictionClass(conviction.short)">Short · {{ conviction.short }}</span>
          <span class="conviction-pill" :class="convictionClass(conviction.noTrade)">No-trade · {{ conviction.noTrade }}</span>
        </div>
        <ul class="reasoning-list">
          <li v-for="(line, i) in conviction.reasoning" :key="i">{{ line }}</li>
        </ul>
        <p class="disclaimer">
          This is a structured qualitative read of the MA/price data above — not a statistically derived
          probability or a backtested win rate. {{ conviction.ambiguous ? 'This setup is genuinely mixed; treat any directional call here with extra caution.' : '' }}
        </p>
      </section>

      <!-- ── 6. Invalidation ─────────────────────────────────────────────── -->
      <section class="panel">
        <div class="panel-header"><span>What Would Invalidate This Read</span></div>
        <ul class="reasoning-list">
          <li v-for="(line, i) in invalidation" :key="i">{{ line }}</li>
        </ul>
      </section>

      <!-- ── Chart ────────────────────────────────────────────────────────── -->
      <div class="legend">
        <span v-for="ma in MA_META" :key="ma.key" class="legend-item">
          <span class="legend-swatch" :style="{ background: ma.color }" />
          {{ ma.label }} 200MA
        </span>
        <span class="legend-item price"><span class="legend-swatch price" />Price</span>
        <span v-if="previewLong" class="legend-item"><span class="legend-swatch" style="background:#4ade80" />Long plan</span>
        <span v-if="previewShort" class="legend-item"><span class="legend-swatch" style="background:#ef5350" />Short plan</span>
      </div>

      <div class="chart-container" ref="chartContainer">
        <svg :width="svgWidth" :height="totalSvgHeight" class="ma-svg">
          <g class="grid">
            <line v-for="(price, i) in gridPrices" :key="`grid-${i}`" :x1="0" :y1="priceToY(price)" :x2="svgWidth" :y2="priceToY(price)" class="grid-line" />
          </g>

          <g class="candles">
            <g v-for="(candle, i) in rows" :key="`c-${i}`" class="candle" :class="{ bull: candle.close >= candle.open, bear: candle.close < candle.open }">
              <line :x1="candleX(i)" :y1="priceToY(candle.high)" :x2="candleX(i)" :y2="priceToY(candle.low)" class="wick" />
              <rect
                :x="candleX(i) - candleWidth / 2"
                :y="priceToY(Math.max(candle.open, candle.close))"
                :width="candleWidth"
                :height="Math.max(Math.abs(candle.close - candle.open) / priceDelta * svgHeight, 1)"
                class="body"
              />
            </g>
          </g>

          <g class="ma-lines">
            <path v-for="ma in MA_META" :key="`line-${ma.key}`" :d="maPath(ma.key)" class="ma-line" :stroke="ma.color" fill="none" />
          </g>

          <!-- Plan overlay lines: only rendered while their Preview toggle is on -->
          <g class="plan-lines" v-if="longScenario && previewLong">
            <line :x1="0" :x2="svgWidth" :y1="priceToY(longScenario.entry)" :y2="priceToY(longScenario.entry)" class="plan-line long entry" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(longScenario.stop)" :y2="priceToY(longScenario.stop)" class="plan-line long stop" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(longScenario.target)" :y2="priceToY(longScenario.target)" class="plan-line long target" />
            <text :x="6" :y="priceToY(longScenario.entry) - 3" class="plan-line-label long">Entry {{ formatPrice(longScenario.entry) }}</text>
            <text :x="6" :y="priceToY(longScenario.stop) - 3" class="plan-line-label long">Stop {{ formatPrice(longScenario.stop) }}</text>
            <text :x="6" :y="priceToY(longScenario.target) - 3" class="plan-line-label long">Target {{ formatPrice(longScenario.target) }}</text>
          </g>
          <g class="plan-lines" v-if="shortScenario && previewShort">
            <line :x1="0" :x2="svgWidth" :y1="priceToY(shortScenario.entry)" :y2="priceToY(shortScenario.entry)" class="plan-line short entry" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(shortScenario.stop)" :y2="priceToY(shortScenario.stop)" class="plan-line short stop" />
            <line :x1="0" :x2="svgWidth" :y1="priceToY(shortScenario.target)" :y2="priceToY(shortScenario.target)" class="plan-line short target" />
            <text :x="6" :y="priceToY(shortScenario.entry) - 3" class="plan-line-label short">Entry {{ formatPrice(shortScenario.entry) }}</text>
            <text :x="6" :y="priceToY(shortScenario.stop) - 3" class="plan-line-label short">Stop {{ formatPrice(shortScenario.stop) }}</text>
            <text :x="6" :y="priceToY(shortScenario.target) - 3" class="plan-line-label short">Target {{ formatPrice(shortScenario.target) }}</text>
          </g>

          <text v-for="(price, i) in gridPrices" :key="`pl-${i}`" :x="svgWidth - 5" :y="priceToY(price) + 4" class="price-label">
            {{ formatPrice(price) }}
          </text>

          <g class="spread-pane">
            <line :x1="0" :x2="svgWidth" :y1="spreadTop" :y2="spreadTop" class="divider-line" />
            <line :x1="0" :x2="svgWidth" :y1="spreadThresholdY(squeezeThresholdPct)" :y2="spreadThresholdY(squeezeThresholdPct)" class="spread-threshold squeeze" />
            <line :x1="0" :x2="svgWidth" :y1="spreadThresholdY(expansionThresholdPct)" :y2="spreadThresholdY(expansionThresholdPct)" class="spread-threshold expansion" />
            <path :d="spreadPath" class="spread-line" fill="none" />
            <text :x="6" :y="spreadTop + 12" class="spread-pane-label">MA Spread % of price (squeeze / expansion)</text>
            <text :x="svgWidth - 5" :y="spreadThresholdY(squeezeThresholdPct) - 3" class="spread-threshold-label squeeze">squeeze {{ squeezeThresholdPct.toFixed(1) }}%</text>
            <text :x="svgWidth - 5" :y="spreadThresholdY(expansionThresholdPct) - 3" class="spread-threshold-label expansion">expansion {{ expansionThresholdPct.toFixed(1) }}%</text>
          </g>
        </svg>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * MAStructureAnalysisComponent
 * ─────────────────────────────
 * Takes the OHLCV + 200-period MA (15m/1h/4h/1d) capture payload exported by
 * the MA crossing visualizer and reproduces, algorithmically, the same
 * six-part read a human analyst would give by eye:
 *   1. Market structure (price vs each 200MA, timeframe alignment)
 *   2. Squeeze vs expansion (MA spread, and how it's evolved)
 *   3. Long scenario (entry / stop / target / R:R, from real swing points)
 *   4. Short scenario (mirrored)
 *   5. Conviction read (qualitative, not a backtested probability)
 *   6. Invalidation conditions
 *
 * This is intentionally rule-based and transparent rather than "black box" —
 * every number shown can be traced back to a specific row, MA value, or
 * swing point in `props.data`.
 *
 * Preview: each scenario card has a "Preview" toggle that draws its
 * entry/stop/target lines on this component's own chart AND emits a
 * `preview` event so a parent (e.g. the MA crossing visualizer) can mirror
 * the same overlay on its own chart.
 */
import { computed, ref } from 'vue'

interface Row {
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

interface CapturePayload {
  symbol: string
  baseInterval: string
  maPeriod: number
  maIntervals: string[]
  generatedAt: string
  period: { candles: number; from: string | null; to: string | null }
  data: Row[]
}

interface Scenario {
  entry: number; entryReason: string
  stop: number; stopReason: string
  target: number; targetReason: string
  rr: number
}

interface Props {
  data: CapturePayload
  /** lookback (in candles, each side) used to detect a swing high/low fractal */
  swingLookback?: number
  /** % buffer added beyond a swing point when placing a stop-loss */
  stopBufferPct?: number
}

const props = withDefaults(defineProps<Props>(), {
  swingLookback: 3,
  stopBufferPct: 0.15,
})

const emit = defineEmits<{
  (e: 'preview', payload: { long: Scenario | null; short: Scenario | null }): void
}>()

type MaKey = '15m' | '1h' | '4h' | '1d'
const MA_META: { key: MaKey; label: string; color: string; field: keyof Row }[] = [
  { key: '15m', label: '15m', color: '#64b5f6', field: 'ma200_15m' },
  { key: '1h', label: '1h', color: '#ffb74d', field: 'ma200_1h' },
  { key: '4h', label: '4h', color: '#ba68c8', field: 'ma200_4h' },
  { key: '1d', label: '1d', color: '#4ade80', field: 'ma200_1d' },
]

const squeezeThresholdPct = ref(3)
const expansionThresholdPct = ref(10)

// ── preview toggles ─────────────────────────────────────────────────────────
const previewLong = ref(false)
const previewShort = ref(false)

function togglePreview(type: 'long' | 'short') {
  if (type === 'long') previewLong.value = !previewLong.value
  else previewShort.value = !previewShort.value

  emit('preview', {
    long: previewLong.value ? longScenario.value : null,
    short: previewShort.value ? shortScenario.value : null,
  })
}

const rows = computed<Row[]>(() => props.data?.data ?? [])
const lastRow = computed(() => rows.value[rows.value.length - 1] ?? null)
const price = computed(() => lastRow.value?.close ?? 0)

function formatPrice(v: number): string {
  if (v >= 1000) return v.toFixed(2)
  if (v >= 1) return v.toFixed(4)
  return v.toFixed(6)
}
function formatDate(iso: string | null): string {
  if (!iso) return 'n/a'
  return new Date(iso).toLocaleString()
}

// ── last known value of a given MA field (walking back past any nulls) ────
function lastMaValue(field: keyof Row): number | null {
  for (let i = rows.value.length - 1; i >= 0; i--) {
    const v = rows.value[i][field] as number | null
    if (v !== null) return v
  }
  return null
}

// first known (warmed-up) value of a given MA field, for slope comparison
function firstMaValue(field: keyof Row): number | null {
  for (let i = 0; i < rows.value.length; i++) {
    const v = rows.value[i][field] as number | null
    if (v !== null) return v
  }
  return null
}

// ── 1. Market structure ────────────────────────────────────────────────────
const structure = computed(() => {
  const order: { key: string; label: string; color: string; value: number }[] = []
  for (const ma of MA_META) {
    const v = lastMaValue(ma.field)
    if (v !== null) order.push({ key: ma.key, label: `${ma.label} MA`, color: ma.color, value: v })
  }
  if (lastRow.value) order.push({ key: 'price', label: 'Price', color: '#ffffff', value: price.value })
  order.sort((a, b) => b.value - a.value)

  const aboveCount = MA_META.filter((ma) => {
    const v = lastMaValue(ma.field)
    return v !== null && price.value > v
  }).length
  const risingCount = MA_META.filter((ma) => {
    const last = lastMaValue(ma.field)
    const first = firstMaValue(ma.field)
    return last !== null && first !== null && last > first
  }).length
  const validMaCount = MA_META.filter((ma) => lastMaValue(ma.field) !== null).length

  let alignmentLabel = 'Mixed / Conflicting'
  let alignmentClass = 'neutral'
  if (validMaCount === MA_META.length) {
    if (aboveCount === MA_META.length && risingCount === MA_META.length) {
      alignmentLabel = 'Fully Aligned Bullish'
      alignmentClass = 'bullish'
    } else if (aboveCount === 0 && risingCount === 0) {
      alignmentLabel = 'Fully Aligned Bearish'
      alignmentClass = 'bearish'
    }
  }

  const reasoning: string[] = []
  reasoning.push(
    `Price (${formatPrice(price.value)}) is above ${aboveCount} of ${validMaCount} 200-MAs, and ${risingCount} of ${validMaCount} MAs have risen since the start of this window.`
  )
  for (const ma of MA_META) {
    const last = lastMaValue(ma.field)
    const first = firstMaValue(ma.field)
    if (last === null || first === null) continue
    const dir = last > first ? 'rising' : last < first ? 'declining' : 'flat'
    const side = price.value > last ? 'above' : 'below'
    reasoning.push(`${ma.label} MA is ${dir} over the window (${formatPrice(first)} → ${formatPrice(last)}); price is currently ${side} it.`)
  }
  if (alignmentClass === 'neutral') {
    reasoning.push('Because timeframes disagree (some MAs rising while price sits on the wrong side of another, typically the slower one), treat this as a genuine cross-timeframe conflict rather than a clean trend.')
  }

  return { order, alignmentLabel, alignmentClass, reasoning }
})

// ── 2. Squeeze vs expansion ────────────────────────────────────────────────
interface SpreadPoint { index: number; pct: number | null }

const spreadSeries = computed<SpreadPoint[]>(() =>
  rows.value.map((r, i) => {
    const vals = MA_META.map((ma) => r[ma.field] as number | null).filter((v): v is number => v !== null)
    if (vals.length < MA_META.length || !r.close) return { index: i, pct: null }
    const pct = ((Math.max(...vals) - Math.min(...vals)) / r.close) * 100
    return { index: i, pct }
  })
)

const squeeze = computed(() => {
  const valid = spreadSeries.value.filter((p) => p.pct !== null) as { index: number; pct: number }[]
  const currentPct = valid.length ? valid[valid.length - 1].pct : 0
  const startPct = valid.length ? valid[0].pct : 0
  const deltaPct = currentPct - startPct
  const trendLabel = Math.abs(deltaPct) < 0.05 ? 'Flat' : deltaPct < 0 ? 'Narrowing' : 'Widening'

  let state = 'NEUTRAL'
  let stateClass = 'neutral'
  if (currentPct < squeezeThresholdPct.value) {
    state = 'SQUEEZE'
    stateClass = 'squeeze'
  } else if (currentPct > expansionThresholdPct.value) {
    state = 'EXPANSION'
    stateClass = 'expansion'
  }

  const rangeCandles = valid.length ? valid[valid.length - 1].index - valid[0].index : 0
  const rangeLabel = rangeCandles > 0 ? `${rangeCandles} candles` : 'window start'

  let narrative = ''
  if (state === 'SQUEEZE') {
    narrative = `MAs are bunched tight (${currentPct.toFixed(2)}% spread) — this often precedes a breakout, but doesn't say which direction.`
  } else if (state === 'EXPANSION') {
    narrative = `MAs are spread wide apart (${currentPct.toFixed(2)}% spread) — the trend is already extended, which raises reversion risk rather than signaling a fresh breakout.`
  } else {
    narrative = `Spread sits between the squeeze and expansion thresholds (${currentPct.toFixed(2)}%) — no strong compression or extension signal on its own.`
  }
  narrative += ` It has been ${trendLabel.toLowerCase()} over the captured window (${startPct.toFixed(2)}% → ${currentPct.toFixed(2)}%), so weight the current reading against that trend rather than in isolation.`

  return { currentPct, startPct, trendLabel, state, stateClass, rangeLabel, narrative }
})

// ── swing high / low detection (simple fractal) ────────────────────────────
interface Swing { index: number; price: number; time: string }

function findSwingLows(lookback: number): Swing[] {
  const out: Swing[] = []
  const r = rows.value
  for (let i = lookback; i < r.length - lookback; i++) {
    const low = r[i].low
    let isSwing = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && r[j].low < low) { isSwing = false; break }
    }
    if (isSwing) out.push({ index: i, price: low, time: r[i].time })
  }
  return out
}

function findSwingHighs(lookback: number): Swing[] {
  const out: Swing[] = []
  const r = rows.value
  for (let i = lookback; i < r.length - lookback; i++) {
    const high = r[i].high
    let isSwing = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && r[j].high > high) { isSwing = false; break }
    }
    if (isSwing) out.push({ index: i, price: high, time: r[i].time })
  }
  return out
}

const swingLows = computed(() => findSwingLows(props.swingLookback))
const swingHighs = computed(() => findSwingHighs(props.swingLookback))

// nearest MA below/above current price, for entry/target selection
function nearestMaBelow(): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null
  for (const ma of MA_META) {
    const v = lastMaValue(ma.field)
    if (v === null || v >= price.value) continue
    if (!best || v > best.value) best = { label: `${ma.label} MA`, value: v }
  }
  return best
}
function nearestMaAbove(): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null
  for (const ma of MA_META) {
    const v = lastMaValue(ma.field)
    if (v === null || v <= price.value) continue
    if (!best || v < best.value) best = { label: `${ma.label} MA`, value: v }
  }
  return best
}

// ── 3. Long scenario ────────────────────────────────────────────────────────
const longScenario = computed<Scenario | null>(() => {
  const support = nearestMaBelow()
  const entry = support ? support.value : price.value
  const entryReason = support ? `pullback to ${support.label}` : 'market — price already below every 200MA'

  // most recent swing low that sits below the entry level (the base of the current leg)
  const candidateLows = swingLows.value.filter((s) => s.price < entry)
  const lowSwing = candidateLows.length ? candidateLows[candidateLows.length - 1] : null
  if (!lowSwing) return null
  const stop = lowSwing.price * (1 - props.stopBufferPct / 100)
  const stopReason = `below swing low at ${formatPrice(lowSwing.price)} (${new Date(lowSwing.time).toLocaleString()})`

  // nearest resistance above entry: prior range high (highest high in dataset) or nearest swing high
  const highsAbove = swingHighs.value.filter((s) => s.price > entry)
  const targetSwing = highsAbove.length ? highsAbove.reduce((a, b) => (a.price > b.price ? a : b)) : null
  const target = targetSwing ? targetSwing.price : Math.max(...rows.value.map((r) => r.high))
  const targetReason = targetSwing ? `prior swing high at ${formatPrice(target)}` : 'highest high in the captured window'

  const risk = entry - stop
  const reward = target - entry
  if (risk <= 0 || reward <= 0) return null
  return { entry, entryReason, stop, stopReason, target, targetReason, rr: reward / risk }
})

// ── 4. Short scenario (mirrored) ────────────────────────────────────────────
const shortScenario = computed<Scenario | null>(() => {
  const resistance = nearestMaAbove()
  const entry = resistance ? resistance.value : price.value
  const entryReason = resistance ? `retest of ${resistance.label}` : 'market — price already above every 200MA'

  const candidateHighs = swingHighs.value.filter((s) => s.price > entry)
  const highSwing = candidateHighs.length ? candidateHighs[candidateHighs.length - 1] : null
  if (!highSwing) return null
  const stop = highSwing.price * (1 + props.stopBufferPct / 100)
  const stopReason = `above swing high at ${formatPrice(highSwing.price)} (${new Date(highSwing.time).toLocaleString()})`

  const lowsBelow = swingLows.value.filter((s) => s.price < entry)
  const targetSwing = lowsBelow.length ? lowsBelow.reduce((a, b) => (a.price < b.price ? a : b)) : null
  const target = targetSwing ? targetSwing.price : Math.min(...rows.value.map((r) => r.low))
  const targetReason = targetSwing ? `prior swing low at ${formatPrice(target)}` : 'lowest low in the captured window'

  const risk = stop - entry
  const reward = entry - target
  if (risk <= 0 || reward <= 0) return null
  return { entry, entryReason, stop, stopReason, target, targetReason, rr: reward / risk }
})

// ── 5. Conviction read ──────────────────────────────────────────────────────
type ConvictionLevel = 'High' | 'Moderate' | 'Low'

function convictionClass(level: ConvictionLevel): string {
  return level === 'High' ? 'bullish' : level === 'Moderate' ? 'neutral' : 'bearish'
}

const conviction = computed(() => {
  const align = structure.value.alignmentClass // bullish | bearish | neutral
  const rrOk = (s: Scenario | null) => !!s && s.rr >= 2

  let long: ConvictionLevel = 'Low'
  let short: ConvictionLevel = 'Low'
  const reasoning: string[] = []

  if (align === 'bullish') {
    long = rrOk(longScenario.value) ? 'High' : 'Moderate'
    short = 'Low'
    reasoning.push('Timeframes are fully aligned bullish (price above every 200MA, all MAs rising), which favors longs over shorts.')
  } else if (align === 'bearish') {
    short = rrOk(shortScenario.value) ? 'High' : 'Moderate'
    long = 'Low'
    reasoning.push('Timeframes are fully aligned bearish (price below every 200MA, all MAs falling), which favors shorts over longs.')
  } else {
    long = 'Moderate'
    short = 'Moderate'
    reasoning.push('Timeframes are mixed — some MAs support the trend, at least one conflicts (commonly the slowest, 1d MA). Neither direction has full structural backing.')
  }

  if (squeeze.value.state === 'EXPANSION') {
    reasoning.push('MAs are already in an expansion / extended state, which raises reversion risk and caps conviction on a fresh entry in the direction of the existing move.')
  } else if (squeeze.value.state === 'SQUEEZE') {
    reasoning.push('MAs are compressed (squeeze), which raises the odds of a breakout but does not indicate direction on its own — do not treat the squeeze itself as directional.')
  }

  if (!rrOk(longScenario.value)) reasoning.push('The long plan does not clear a 2:1 risk:reward, which caps long conviction regardless of structure.')
  if (!rrOk(shortScenario.value)) reasoning.push('The short plan does not clear a 2:1 risk:reward, which caps short conviction regardless of structure.')

  const ambiguous = align === 'neutral' || (long === 'Low' && short === 'Low')
  const noTrade: ConvictionLevel = ambiguous ? 'High' : long === 'Low' && short === 'Low' ? 'High' : 'Low'
  if (ambiguous) reasoning.push('Because of the conflicting signals above, "no trade / wait for confirmation" is a legitimate stance here, not just a hedge.')

  return { long, short, noTrade, reasoning, ambiguous }
})

// ── 6. Invalidation ──────────────────────────────────────────────────────────
const invalidation = computed(() => {
  const lines: string[] = []
  const support = nearestMaBelow()
  const resistance = nearestMaAbove()
  if (support) lines.push(`Invalidates the bullish/long read: a 15m close below ${formatPrice(support.value)} (${support.label}) — the nearest short-term support giving way.`)
  if (resistance) lines.push(`Invalidates the bearish/short read: a 15m close above ${formatPrice(resistance.value)} (${resistance.label}) — the nearest overhead resistance being reclaimed.`)
  if (squeeze.value.state !== 'SQUEEZE') {
    lines.push(`Would flag a fresh squeeze setup worth re-checking: MA spread compressing well below ${squeezeThresholdPct.value.toFixed(1)}% while price also tightens its range.`)
  }
  return lines
})

// ── chart geometry (mirrors the MA crossing visualizer) ─────────────────────
const chartContainer = ref<HTMLElement | null>(null)
const candleWidth = ref(3)
const candleGap = 1
const svgHeight = 420
const spreadGap = 10
const spreadPaneHeight = 80

const minPrice = computed(() => {
  if (!rows.value.length) return 0
  const lows = rows.value.map((c) => c.low)
  const maValues: number[] = []
  for (const ma of MA_META) for (const r of rows.value) if (r[ma.field] !== null) maValues.push(r[ma.field] as number)
  const planValues: number[] = []
  if (previewLong.value && longScenario.value) planValues.push(longScenario.value.stop)
  if (previewShort.value && shortScenario.value) planValues.push(shortScenario.value.target)
  return Math.min(...lows, ...(maValues.length ? maValues : lows), ...(planValues.length ? planValues : lows)) * 0.995
})
const maxPrice = computed(() => {
  if (!rows.value.length) return 1
  const highs = rows.value.map((c) => c.high)
  const maValues: number[] = []
  for (const ma of MA_META) for (const r of rows.value) if (r[ma.field] !== null) maValues.push(r[ma.field] as number)
  const planValues: number[] = []
  if (previewLong.value && longScenario.value) planValues.push(longScenario.value.target)
  if (previewShort.value && shortScenario.value) planValues.push(shortScenario.value.stop)
  return Math.max(...highs, ...(maValues.length ? maValues : highs), ...(planValues.length ? planValues : highs)) * 1.005
})
const priceDelta = computed(() => maxPrice.value - minPrice.value || 1)
const svgWidth = computed(() => rows.value.length * (candleWidth.value + candleGap) + 80)
const gridPrices = computed(() => {
  const step = priceDelta.value / 8
  return Array.from({ length: 9 }, (_, i) => minPrice.value + step * i)
})
const priceToY = (p: number) => ((maxPrice.value - p) / priceDelta.value) * svgHeight
const candleX = (i: number) => i * (candleWidth.value + candleGap) + candleWidth.value / 2 + 10

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

function toSegments(series: (number | null)[], toY: (v: number) => number) {
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

function maPath(key: MaKey): string {
  const meta = MA_META.find((m) => m.key === key)!
  const series = rows.value.map((r) => r[meta.field] as number | null)
  return toSegments(series, priceToY).map(smoothPath).join(' ')
}

const spreadTop = computed(() => svgHeight + spreadGap)
const totalSvgHeight = computed(() => svgHeight + spreadGap + spreadPaneHeight)
const maxSpreadForAxis = computed(() => {
  const vals = spreadSeries.value.map((p) => p.pct).filter((v): v is number => v !== null)
  const dataMax = vals.length ? Math.max(...vals) : 1
  return Math.max(dataMax, expansionThresholdPct.value) * 1.15
})
function spreadToY(v: number): number {
  const ratio = Math.min(1, Math.max(0, v / maxSpreadForAxis.value))
  return spreadTop.value + spreadPaneHeight - ratio * spreadPaneHeight
}
function spreadThresholdY(pct: number): number {
  return spreadToY(pct)
}
const spreadPath = computed(() => toSegments(spreadSeries.value.map((p) => p.pct), spreadToY).map(smoothPath).join(' '))
</script>

<style scoped>
.ma-structure-analysis {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  color: #ccc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-height: 80vh;
  overflow-y: auto;
}

.header-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
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

.range-label {
  font-size: 11px;
  color: #888;
  font-family: monospace;
}

.empty-state {
  color: #888;
  padding: 2rem;
  text-align: center;
}

.panel {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #999;
  margin-bottom: 0.6rem;
}

.verdict-badge {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.verdict-badge.bullish { background: rgba(80, 200, 120, 0.18); color: #4ade80; }
.verdict-badge.bearish { background: rgba(239, 83, 80, 0.18); color: #ef5350; }
.verdict-badge.neutral { background: rgba(255, 183, 77, 0.18); color: #ffb74d; }
.verdict-badge.squeeze { background: rgba(255, 183, 77, 0.18); color: #ffb74d; }
.verdict-badge.expansion { background: rgba(80, 200, 120, 0.18); color: #4ade80; }

.structure-chain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-family: monospace;
  font-size: 14px;
  margin-bottom: 0.6rem;
}
.structure-node { display: inline-flex; align-items: baseline; gap: 6px; font-weight: bold; }
.structure-node.is-price { padding: 1px 8px; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; }
.structure-value { font-weight: normal; opacity: 0.75; font-size: 12px; }
.structure-sep { color: #555; font-weight: bold; }

.reasoning-list { margin: 0; padding-left: 1.1rem; font-size: 13px; line-height: 1.5; }
.reasoning-list li { margin-bottom: 0.3rem; }
.reasoning-line { font-size: 13px; line-height: 1.5; margin: 0.4rem 0 0; }

.stat-row { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
.stat { display: flex; align-items: center; gap: 6px; font-size: 13px; font-family: monospace; color: #fff; }
.stat label { color: #999; font-family: inherit; text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px; }
.ctrl-input { width: 56px; padding: 3px 6px; background: #0d0d0d; border: 1px solid #333; border-radius: 4px; color: #fff; font-size: 12px; font-family: monospace; }
.ctrl-input:focus { outline: none; border-color: #64b5f6; }

.scenario-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 720px) { .scenario-grid { grid-template-columns: 1fr; } }

.scenario-card { padding: 0.75rem 1rem; border-radius: 6px; background: rgba(255, 255, 255, 0.04); border-left: 3px solid transparent; transition: background 0.15s ease; }
.scenario-card.long { border-left-color: #4ade80; }
.scenario-card.short { border-left-color: #ef5350; }
.scenario-card.long.is-previewing { background: rgba(80, 200, 120, 0.08); }
.scenario-card.short.is-previewing { background: rgba(239, 83, 80, 0.08); }

.scenario-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #999; margin-bottom: 0.6rem; gap: 0.5rem; }
.scenario-header-actions { display: flex; align-items: center; gap: 8px; }

.preview-btn {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: #ccc;
  white-space: nowrap;
}
.preview-btn:hover { background: rgba(255, 255, 255, 0.12); }
.preview-btn.long.active { border-color: rgba(74, 222, 128, 0.6); background: rgba(74, 222, 128, 0.18); color: #4ade80; }
.preview-btn.short.active { border-color: rgba(239, 83, 80, 0.6); background: rgba(239, 83, 80, 0.18); color: #ef5350; }

.scenario-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; font-size: 13px; padding: 3px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.scenario-row label { color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
.scenario-row span { font-family: monospace; text-align: right; }
.scenario-row em { color: #888; font-style: normal; font-size: 11px; display: block; }
.scenario-row.rr span.good { color: #4ade80; font-weight: bold; }
.scenario-row.rr span.weak { color: #ffb74d; font-weight: bold; }

.conviction-row { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
.conviction-pill { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.conviction-pill.bullish { background: rgba(80, 200, 120, 0.15); color: #4ade80; }
.conviction-pill.bearish { background: rgba(239, 83, 80, 0.15); color: #ef5350; }
.conviction-pill.neutral { background: rgba(255, 183, 77, 0.15); color: #ffb74d; }

.disclaimer { font-size: 11px; color: #888; font-style: italic; margin: 0.6rem 0 0; line-height: 1.5; }

.legend { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; font-size: 12px; color: #ccc; padding: 0 0.25rem; }
.legend-item { display: flex; align-items: center; gap: 6px; font-family: monospace; }
.legend-swatch { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
.legend-swatch.price { background: #ffffff; opacity: 0.6; }

.chart-container { position: relative; background: #0d0d0d; border: 1px solid #333; border-radius: 6px; padding: 1rem; height: 90vh; overflow: auto; flex-shrink: 0; }
.ma-svg { display: block; }
.grid-line { stroke: rgba(255, 255, 255, 0.05); stroke-width: 1; }
.wick { stroke-width: 1; }
.candle.bull .wick { stroke: #26a69a; }
.candle.bear .wick { stroke: #ef5350; }
.body { stroke-width: 1; }
.candle.bull .body { fill: #26a69a; stroke: #26a69a; }
.candle.bear .body { fill: #ef5350; stroke: #ef5350; }
.ma-line { stroke-width: 1.5; opacity: 0.95; }
.price-label { fill: rgba(255, 255, 255, 0.6); font-size: 11px; text-anchor: end; user-select: none; }

.plan-line { stroke-width: 1; stroke-dasharray: 5, 3; opacity: 0.8; }
.plan-line.long { stroke: #4ade80; }
.plan-line.short { stroke: #ef5350; }
.plan-line.entry { opacity: 0.9; }
.plan-line.stop { stroke-dasharray: 2, 2; }
.plan-line.target { stroke-dasharray: 8, 3; }
.plan-line-label { font-size: 9px; font-family: monospace; }
.plan-line-label.long { fill: #4ade80; }
.plan-line-label.short { fill: #ef5350; }

.divider-line { stroke: rgba(255, 255, 255, 0.12); stroke-width: 1; }
.spread-line { stroke: #64b5f6; stroke-width: 1.5; }
.spread-threshold { stroke-width: 1; stroke-dasharray: 4, 4; }
.spread-threshold.squeeze { stroke: #ffb74d; opacity: 0.6; }
.spread-threshold.expansion { stroke: #4ade80; opacity: 0.6; }
.spread-threshold-label { font-size: 9px; font-family: monospace; text-anchor: end; }
.spread-threshold-label.squeeze { fill: #ffb74d; }
.spread-threshold-label.expansion { fill: #4ade80; }
.spread-pane-label { fill: rgba(255, 255, 255, 0.4); font-size: 10px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.4px; user-select: none; }
</style>