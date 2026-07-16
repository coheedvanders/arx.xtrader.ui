<template>
  <div class="price-alert">
    <div class="header">
      <h2>Timed Price Watch</h2>
      <div class="ws-indicator" :class="wsStatus">
        <span class="dot" />
        <span>{{ wsStatusLabel }}</span>
      </div>
    </div>

    <div class="setup-row">
      <label class="field">
        <span class="field-label">Symbol</span>
        <input
          v-model="symbolInput"
          type="text"
          placeholder="BTCUSDT"
          class="text-input"
          :disabled="isMonitoring"
          @input="symbolInput = symbolInput.toUpperCase()"
        />
      </label>

      <label class="field">
        <span class="field-label">Target price</span>
        <input
          v-model.number="targetPrice"
          type="number"
          step="any"
          placeholder="0.00"
          class="text-input"
          :disabled="isMonitoring"
        />
      </label>

      <label class="field">
        <span class="field-label">Alert mode</span>
        <select v-model="alertMode" class="text-input select-input" :disabled="isMonitoring">
          <option value="up">Price Went Up</option>
          <option value="down">Price Went Down</option>
        </select>
      </label>
    </div>

    <div class="setup-row">
      <span class="duration-label">Monitor for</span>
      <label class="field duration-field">
        <input v-model.number="durationHours" type="number" min="0" class="text-input small" :disabled="isMonitoring" />
        <span class="field-label">hrs</span>
      </label>
      <label class="field duration-field">
        <input v-model.number="durationMinutes" type="number" min="0" max="59" class="text-input small" :disabled="isMonitoring" />
        <span class="field-label">min</span>
      </label>
      <label class="field duration-field">
        <input v-model.number="durationSeconds" type="number" min="0" max="59" class="text-input small" :disabled="isMonitoring" />
        <span class="field-label">sec</span>
      </label>
    </div>

    <div class="action-row">
      <button
        v-if="!isMonitoring"
        class="btn primary"
        :disabled="!canStart"
        @click="startMonitoring"
      >
        Start Watching
      </button>
      <button v-else class="btn stop" @click="() => stopMonitoring('cancelled')">
        Stop Watching
      </button>

      <button class="btn ghost" @click="testVoice">Test Voice</button>

      <label class="mute-toggle">
        <input v-model="isMuted" type="checkbox" />
        <span>Mute</span>
      </label>
    </div>

    <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

    <div class="readout" :class="readoutClass">
      <div class="readout-main">
        <span class="current-price">
          {{ currentPrice !== null ? currentPrice.toFixed(pricePrecision) : '—' }}
        </span>
        <span class="symbol-tag">{{ activeSymbol || symbolInput || '—' }}</span>
      </div>

      <div class="readout-sub">
        <span class="target-tag">
          Target: {{ targetPrice !== null && targetPrice !== undefined ? Number(targetPrice).toFixed(pricePrecision) : '—' }}
          ({{ alertMode === 'up' ? 'up' : 'down' }})
        </span>
        <span v-if="isMonitoring" class="countdown-tag">
          {{ formattedCountdown }} remaining
        </span>
      </div>

      <div v-if="resultState !== 'none'" class="result-banner" :class="resultState">
        {{ resultState === 'reached' ? '✓ Target reached — watch stopped' : '✕ Time expired — target not reached' }}
      </div>
    </div>

    <ul v-if="alertLog.length > 0" class="alert-log">
      <li v-for="(entry, i) in alertLog" :key="i" :class="entry.result">
        <span class="log-time">{{ entry.time }}</span>
        <span class="log-text">{{ entry.text }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

// ─── Config ─────────────────────────────────────────────────────────────────
const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_LOG_ENTRIES = 20

// ─── Inputs ─────────────────────────────────────────────────────────────────
const symbolInput = ref<string>('BTCUSDT')
const targetPrice = ref<number | null>(null)
type AlertMode = 'up' | 'down'
const alertMode = ref<AlertMode>('up')

const durationHours = ref<number>(1)
const durationMinutes = ref<number>(0)
const durationSeconds = ref<number>(0)

const isMuted = ref<boolean>(false)

const totalDurationMs = computed(() => {
  const h = Number(durationHours.value) || 0
  const m = Number(durationMinutes.value) || 0
  const s = Number(durationSeconds.value) || 0
  return Math.max(0, (h * 3600 + m * 60 + s) * 1000)
})

const canStart = computed(() => {
  return (
    symbolInput.value.trim().length > 0 &&
    targetPrice.value !== null &&
    !isNaN(targetPrice.value) &&
    totalDurationMs.value > 0
  )
})

// ─── Monitoring state ───────────────────────────────────────────────────────
const isMonitoring = ref<boolean>(false)
const activeSymbol = ref<string>('')
const currentPrice = ref<number | null>(null)
const errorMessage = ref<string | null>(null)

type ResultState = 'none' | 'reached' | 'expired'
const resultState = ref<ResultState>('none')

const readoutClass = computed(() => {
  if (resultState.value === 'reached') return 'reached'
  if (resultState.value === 'expired') return 'expired'
  if (isMonitoring.value) return 'watching'
  return ''
})

interface AlertLogEntry {
  time: string
  text: string
  result: 'reached' | 'expired'
}
const alertLog = ref<AlertLogEntry[]>([])

// Decimal places to display, inferred from the target price the user typed in.
const pricePrecision = computed(() => {
  if (targetPrice.value === null || targetPrice.value === undefined) return 2
  const str = targetPrice.value.toString()
  const decimalIndex = str.indexOf('.')
  if (decimalIndex === -1) return 2
  return Math.min(8, str.length - decimalIndex - 1)
})

// ─── Countdown ────────────────────────────────────────────────────────────────
const remainingMs = ref<number>(0)
let endTimestamp = 0
let countdownTimer: ReturnType<typeof setInterval> | null = null

const formattedCountdown = computed(() => {
  const totalSec = Math.max(0, Math.round(remainingMs.value / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
})

function durationLabel(): string {
  const h = Number(durationHours.value) || 0
  const m = Number(durationMinutes.value) || 0
  const s = Number(durationSeconds.value) || 0
  const parts: string[] = []
  if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`)
  if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`)
  if (s > 0 || parts.length === 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`)
  return parts.join(' ')
}

function startCountdown() {
  stopCountdown()
  endTimestamp = Date.now() + totalDurationMs.value
  remainingMs.value = totalDurationMs.value
  countdownTimer = setInterval(() => {
    remainingMs.value = Math.max(0, endTimestamp - Date.now())
    if (remainingMs.value <= 0) {
      onDurationExpired()
    }
  }, 250)
}

function stopCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// ─── WebSocket (Binance USDⓈ-M Futures aggTrade — live traded price) ─────────
type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
const wsStatus = ref<WsStatus>('disconnected')
const wsStatusLabel = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Live',
  disconnected: 'Not monitoring',
  error:        'Connection error',
}[wsStatus.value]))

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 2_000

function connectPriceStream(symbol: string) {
  if (ws) {
    ws.onclose = null
    ws.close()
  }

  const streamName = `${symbol.toLowerCase()}@aggTrade`
  const url = `wss://fstream.binance.com/ws/${streamName}`

  wsStatus.value = 'connecting'
  errorMessage.value = null
  ws = new WebSocket(url)

  ws.onopen = () => {
    wsStatus.value = 'connected'
    reconnectDelay = 2_000
  }

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string)
      if (msg.e !== 'aggTrade') return
      const price = parseFloat(msg.p)
      if (isNaN(price)) return
      currentPrice.value = price
      evaluatePrice(price)
    } catch {
      // malformed frame — ignore
    }
  }

  ws.onerror = () => {
    wsStatus.value = 'error'
    errorMessage.value = `Couldn't reach the price feed for ${symbol}. Check the symbol is a valid Binance USDⓈ-M Futures pair.`
  }

  ws.onclose = () => {
    if (!isMonitoring.value) return
    wsStatus.value = 'disconnected'
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      connectPriceStream(symbol)
    }, reconnectDelay)
  }
}

function disconnectPriceStream() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  wsStatus.value = 'disconnected'
}

// ─── Target-hit logic ─────────────────────────────────────────────────────────
function evaluatePrice(price: number) {
  if (!isMonitoring.value || targetPrice.value === null || targetPrice.value === undefined) return

  const hit = alertMode.value === 'up' ? price >= targetPrice.value : price <= targetPrice.value
  if (hit) {
    handleTargetReached(price)
  }
}

function handleTargetReached(price: number) {
  resultState.value = 'reached'
  const verb = alertMode.value === 'up' ? 'went up to' : 'went down to'
  const text = `${spokenSymbol(activeSymbol.value)} price ${verb} ${spokenNumber(targetPrice.value!)}. Current price ${spokenNumber(price)}. Target reached, watch stopped.`
  logAlert(text, 'reached')
  speak(text)
  stopMonitoring('reached')
}

function onDurationExpired() {
  if (resultState.value === 'reached') return // already handled
  resultState.value = 'expired'
  const text = `${spokenSymbol(activeSymbol.value)} watch stopped after ${durationLabel()}. Target price ${spokenNumber(targetPrice.value!)} was not reached.`
  logAlert(text, 'expired')
  speak(text)
  stopMonitoring('expired')
}

function logAlert(text: string, result: 'reached' | 'expired') {
  alertLog.value.unshift({
    time: new Date().toLocaleTimeString(),
    text,
    result,
  })
  if (alertLog.value.length > MAX_LOG_ENTRIES) alertLog.value.pop()
}

// ─── Voice (Web Speech API) ───────────────────────────────────────────────────
function speak(text: string) {
  if (isMuted.value) return
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel() // don't stack overlapping utterances
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

function testVoice() {
  const symbol = (symbolInput.value || 'the symbol').trim()
  speak(`This is a test alert for ${spokenSymbol(symbol)}.`)
}

/** Spells out common bases so "BTCUSDT" reads as "Bitcoin" rather than one long garbled word. */
function spokenSymbol(symbol: string): string {
  if (!symbol) return 'the symbol'
  const knownBases: Record<string, string> = {
    BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'B N B',
    XRP: 'Ripple', DOGE: 'Dogecoin', ADA: 'Cardano', AVAX: 'Avalanche',
  }
  const upper = symbol.toUpperCase()
  for (const [base, spoken] of Object.entries(knownBases)) {
    if (upper.startsWith(base)) return spoken
  }
  return upper
}

function spokenNumber(n: number): string {
  return n.toFixed(pricePrecision.value)
}

// ─── Start / stop ─────────────────────────────────────────────────────────────
function startMonitoring() {
  if (!canStart.value) return
  const symbol = symbolInput.value.trim().toUpperCase()
  activeSymbol.value = symbol
  isMonitoring.value = true
  resultState.value = 'none'
  currentPrice.value = null
  reconnectDelay = 2_000
  startCountdown()
  connectPriceStream(symbol)
}

function stopMonitoring(reason: 'reached' | 'expired' | 'cancelled') {
  isMonitoring.value = false
  stopCountdown()
  disconnectPriceStream()
  if (reason === 'cancelled') {
    window.speechSynthesis?.cancel()
    resultState.value = 'none'
  }
}

onUnmounted(() => {
  stopCountdown()
  disconnectPriceStream()
  window.speechSynthesis?.cancel()
})
</script>

<style scoped>
.price-alert {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  background: #1a1a1a;
  border-radius: 8px;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-width: 520px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.ws-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
}

.ws-indicator .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #555;
}

.ws-indicator.connected { color: #26a69a; }
.ws-indicator.connected .dot { background: #26a69a; box-shadow: 0 0 6px #26a69a; animation: pulse 1.5s infinite; }
.ws-indicator.connecting { color: #fbbf24; }
.ws-indicator.connecting .dot { background: #fbbf24; }
.ws-indicator.error { color: #ef5350; }
.ws-indicator.error .dot { background: #ef5350; }
.ws-indicator.disconnected { color: #888; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.setup-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.duration-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #999;
  align-self: center;
  padding-bottom: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 100px;
}

.duration-field {
  flex: none;
  align-items: center;
  min-width: 60px;
}

.field-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #999;
  text-align: center;
}

.text-input {
  padding: 8px 10px;
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  font-family: monospace;
}

.text-input.small {
  width: 60px;
  text-align: center;
  padding: 8px 6px;
}

.text-input:focus {
  outline: none;
  border-color: #64b5f6;
}

.text-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.select-input {
  cursor: pointer;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.1s ease;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn:not(:disabled):hover {
  transform: translateY(-1px);
}

.btn.primary {
  background: rgba(38,166,154,0.2);
  border-color: #26a69a;
  color: #26a69a;
}

.btn.primary:not(:disabled):hover {
  background: rgba(38,166,154,0.35);
}

.btn.stop {
  background: rgba(239,83,80,0.2);
  border-color: #ef5350;
  color: #ef5350;
}

.btn.stop:hover {
  background: rgba(239,83,80,0.35);
}

.btn.ghost {
  background: rgba(255,255,255,0.06);
  border-color: #555;
  color: #ccc;
}

.btn.ghost:hover {
  background: rgba(255,255,255,0.12);
}

.mute-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #ccc;
  cursor: pointer;
  margin-left: auto;
}

.mute-toggle input {
  cursor: pointer;
}

.error-banner {
  padding: 8px 12px;
  background: rgba(239,83,80,0.12);
  border: 1px solid rgba(239,83,80,0.4);
  border-radius: 6px;
  color: #ef5350;
  font-size: 13px;
}

.readout {
  padding: 1rem;
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  border-left: 3px solid #555;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.readout.watching { border-left-color: #64b5f6; }
.readout.reached { border-left-color: #26a69a; background: rgba(38,166,154,0.07); }
.readout.expired { border-left-color: #ef5350; background: rgba(239,83,80,0.07); }

.readout-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.current-price {
  font-size: 28px;
  font-weight: 700;
  font-family: monospace;
}

.symbol-tag {
  font-size: 13px;
  color: #999;
  letter-spacing: 0.5px;
}

.readout-sub {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-family: monospace;
  color: #aaa;
}

.countdown-tag {
  color: #64b5f6;
  font-weight: 700;
}

.result-banner {
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 4px;
}

.result-banner.reached {
  background: rgba(38,166,154,0.15);
  color: #26a69a;
}

.result-banner.expired {
  background: rgba(239,83,80,0.15);
  color: #ef5350;
}

.alert-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}

.alert-log li {
  display: flex;
  gap: 10px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(255,255,255,0.03);
}

.alert-log li.reached { border-left: 2px solid #26a69a; }
.alert-log li.expired { border-left: 2px solid #ef5350; }

.log-time {
  color: #777;
  font-family: monospace;
  white-space: nowrap;
}

.log-text {
  color: #ddd;
}
</style>