<template>
  <div class="accum-scanner">
    <div class="header-row">
      <h2>Accumulation Scanner</h2>
      <div class="controls">
        <label>
          Period
          <select v-model="period">
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
          </select>
        </label>
        <label>
          Lookback bars
          <input type="number" v-model.number="lookback" min="6" max="96" />
        </label>
        <button :disabled="isScanning" @click="runScan">
          {{ isScanning ? `Scanning ${progress.done}/${progress.total}...` : 'Run Scan' }}
        </button>
      </div>
    </div>

    <div v-if="isScanning" class="progress-bar">
      <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
    </div>

    <table v-if="results.length" class="results-table">
      <thead>
        <tr>
          <th @click="setSort('symbol')">Symbol</th>
          <th @click="setSort('priceChangePct')">Price Δ%</th>
          <th @click="setSort('oiChangePct')">OI Δ%</th>
          <th @click="setSort('takerBuyRatio')">Taker Buy Ratio</th>
          <th @click="setSort('largeBuyNotional')">Large Buy $</th>
          <th @click="setSort('largeSellNotional')">Large Sell $</th>
          <th @click="setSort('score')">Score</th>
          <th>Signal</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sortedResults" :key="r.symbol" :class="[signalClass(r.signal), { 'low-liquidity': r.lowLiquidity }]">
          <td class="symbol-cell">
            {{ r.symbol }}
            <span v-if="r.lowLiquidity" class="thin-tag" title="24h quote volume below threshold - ratios unreliable">thin</span>
          </td>
          <td :class="numClass(r.priceChangePct)">{{ r.priceChangePct.toFixed(2) }}%</td>
          <td :class="numClass(r.oiChangePct)">{{ r.oiChangePct.toFixed(2) }}%</td>
          <td>{{ r.takerBuyRatio.toFixed(3) }}</td>
          <td>{{ formatUsd(r.largeBuyNotional) }}</td>
          <td>{{ formatUsd(r.largeSellNotional) }}</td>
          <td>{{ r.score.toFixed(1) }}</td>
          <td>
            <span class="badge" :class="signalClass(r.signal)">{{ r.signal }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!isScanning && !results.length" class="empty-state">
      No scan run yet. Click "Run Scan" to check {{ symbols.length }} symbols.
    </div>

    <div v-if="errors.length" class="error-list">
      <div v-for="e in errors" :key="e.symbol">{{ e.symbol }}: {{ e.message }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useChocoMintoStore } from '@/stores/chocoMintoStore' // adjust import path to match project structure
import type { FuturesSymbol } from '@/core/interfaces'

interface ScanResult {
  symbol: string
  priceChangePct: number
  oiChangePct: number
  takerBuyRatio: number
  largeBuyNotional: number
  largeSellNotional: number
  score: number
  signal: 'Accumulation' | 'Distribution' | 'Neutral'
  quoteVolume24h: number
  lowLiquidity: boolean
}

interface ScanError {
  symbol: string
  message: string
}

const BASE_URL = 'https://fapi.binance.com'
const REQUEST_DELAY_MS = 400
const LARGE_TRADE_USD_THRESHOLD = 100_000
const FLAT_PRICE_THRESHOLD_PCT = 3
const OI_RISE_THRESHOLD_PCT = 5
const TAKER_BUY_BIAS = 0.52
const MIN_24H_QUOTE_VOLUME_USD = 5_000_000 // symbols below this are too thin to trust taker ratio / OI %

const chocoMintoStore = useChocoMintoStore()
const symbols = computed<string[]>(() => chocoMintoStore.futureSymbols.map(f => f.symbol) ?? [])

const period = ref<'5m' | '15m' | '1h' | '4h'>('5m')
const lookback = ref(24)
const isScanning = ref(false)
const results = ref<ScanResult[]>([])
const errors = ref<ScanError[]>([])
const progress = ref({ done: 0, total: 0 })
const sortKey = ref<keyof ScanResult>('score')
const sortDesc = ref(true)

const progressPct = computed(() =>
  progress.value.total === 0 ? 0 : (progress.value.done / progress.value.total) * 100
)

const sortedResults = computed(() => {
  const arr = [...results.value]
  arr.sort((a, b) => {
    const av = a[sortKey.value]
    const bv = b[sortKey.value]
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDesc.value ? bv.localeCompare(av) : av.localeCompare(bv)
    }
    const an = av as number
    const bn = bv as number
    return sortDesc.value ? bn - an : an - bn
  })
  return arr
})

function setSort(key: keyof ScanResult) {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value
  } else {
    sortKey.value = key
    sortDesc.value = true
  }
}

function signalClass(signal: ScanResult['signal']) {
  return {
    'signal-accum': signal === 'Accumulation',
    'signal-dist': signal === 'Distribution',
    'signal-neutral': signal === 'Neutral',
  }
}

function numClass(val: number) {
  return { positive: val > 0, negative: val < 0 }
}

function formatUsd(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  return res.json()
}

async function fetchOpenInterestHist(symbol: string) {
  const url = `${BASE_URL}/futures/data/openInterestHist?symbol=${symbol}&period=${period.value}&limit=${lookback.value}`
  return fetchJson(url) as Promise<Array<{ sumOpenInterest: string; timestamp: number }>>
}

async function fetchTakerRatioHist(symbol: string) {
  const url = `${BASE_URL}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period.value}&limit=${lookback.value}`
  return fetchJson(url) as Promise<Array<{ buySellRatio: string; buyVol: string; sellVol: string }>>
}

async function fetchTicker24hr(symbol: string) {
  const url = `${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`
  return fetchJson(url) as Promise<{ priceChangePercent: string; quoteVolume: string }>
}

async function fetchRecentAggTrades(symbol: string) {
  const url = `${BASE_URL}/fapi/v1/aggTrades?symbol=${symbol}&limit=500`
  return fetchJson(url) as Promise<Array<{ p: string; q: string; m: boolean }>>
}

function computeLargeTradeNotionals(trades: Array<{ p: string; q: string; m: boolean }>) {
  let largeBuyNotional = 0
  let largeSellNotional = 0
  for (const t of trades) {
    const notional = parseFloat(t.p) * parseFloat(t.q)
    if (notional < LARGE_TRADE_USD_THRESHOLD) continue
    // m = true means buyer is the market maker -> the trade was an aggressive SELL hitting the bid
    if (t.m) {
      largeSellNotional += notional
    } else {
      largeBuyNotional += notional
    }
  }
  return { largeBuyNotional, largeSellNotional }
}

function classifySignal(
  priceChangePct: number,
  oiChangePct: number,
  takerBuyRatio: number,
  lowLiquidity: boolean
): ScanResult['signal'] {
  // thin symbols produce wild ratios/percentages that don't reflect real positioning - never classify them
  if (lowLiquidity) return 'Neutral'

  const priceFlat = Math.abs(priceChangePct) < FLAT_PRICE_THRESHOLD_PCT
  const oiRising = oiChangePct > OI_RISE_THRESHOLD_PCT
  const oiFalling = oiChangePct < -OI_RISE_THRESHOLD_PCT
  const buyBias = takerBuyRatio > TAKER_BUY_BIAS
  const sellBias = takerBuyRatio < 1 / TAKER_BUY_BIAS - 1 // symmetric-ish threshold below 1

  if (priceFlat && oiRising && buyBias) return 'Accumulation'
  if (priceFlat && oiFalling && sellBias) return 'Distribution'
  return 'Neutral'
}

function computeScore(
  oiChangePct: number,
  takerBuyRatio: number,
  largeBuyNotional: number,
  largeSellNotional: number,
  lowLiquidity: boolean
): number {
  // thin symbols get their score suppressed rather than removed, so they still show up
  // in the table (useful to know) but can never outrank a real, liquid signal
  const liquidityDampener = lowLiquidity ? 0.1 : 1

  const oiComponent = oiChangePct
  // log-scale + clamp: a ratio of 17.6 (thin-market noise) no longer swamps the score
  // the way a raw (ratio - 1) * 20 does. log2(1.3) is small, log2(17.6) is capped at 2.
  const clampedLogRatio = Math.max(-2, Math.min(2, Math.log2(Math.max(takerBuyRatio, 0.01))))
  const takerComponent = clampedLogRatio * 10
  const largeTradeComponent = (largeBuyNotional - largeSellNotional) / 10_000
  return (oiComponent + takerComponent + largeTradeComponent) * liquidityDampener
}

async function scanSymbol(symbol: string): Promise<ScanResult> {
  const [oiHist, takerHist, ticker, trades] = await Promise.all([
    fetchOpenInterestHist(symbol),
    fetchTakerRatioHist(symbol),
    fetchTicker24hr(symbol),
    fetchRecentAggTrades(symbol),
  ])

  if (!oiHist.length || !takerHist.length) {
    throw new Error('Insufficient history data')
  }

  const firstOi = parseFloat(oiHist[0].sumOpenInterest)
  const lastOi = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest)
  const oiChangePct = firstOi === 0 ? 0 : ((lastOi - firstOi) / firstOi) * 100

  const avgTakerBuyRatio =
    takerHist.reduce((sum, t) => sum + parseFloat(t.buySellRatio), 0) / takerHist.length

  const priceChangePct = parseFloat(ticker.priceChangePercent)
  const quoteVolume24h = parseFloat(ticker.quoteVolume)
  const lowLiquidity = quoteVolume24h < MIN_24H_QUOTE_VOLUME_USD

  const { largeBuyNotional, largeSellNotional } = computeLargeTradeNotionals(trades)

  const signal = classifySignal(priceChangePct, oiChangePct, avgTakerBuyRatio, lowLiquidity)
  const score = computeScore(
    oiChangePct,
    avgTakerBuyRatio,
    largeBuyNotional,
    largeSellNotional,
    lowLiquidity
  )

  return {
    symbol,
    priceChangePct,
    oiChangePct,
    takerBuyRatio: avgTakerBuyRatio,
    largeBuyNotional,
    largeSellNotional,
    score,
    signal,
    quoteVolume24h,
    lowLiquidity,
  }
}

async function runScan() {
  if (isScanning.value || !symbols.value.length) return
  isScanning.value = true
  results.value = []
  errors.value = []
  progress.value = { done: 0, total: symbols.value.length }

  for (const symbol of symbols.value) {
    try {
      const result = await scanSymbol(symbol)
      results.value.push(result)
    } catch (err) {
      errors.value.push({
        symbol,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
    progress.value.done++
    await delay(REQUEST_DELAY_MS)
  }

  isScanning.value = false
}

onMounted(async () => {
    var localStorageFuturesMaxLeverage = localStorage.getItem("CACHED_FUTURES_SYMBOLS");
    if(localStorageFuturesMaxLeverage){
        chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage!) as FuturesSymbol[]
    }
});
</script>

<style scoped>
.accum-scanner {
  color: #e0e0e0;
  background: #12141a;
  padding: 16px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.header-row h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.controls label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.controls select,
.controls input {
  background: #1c1f27;
  color: #e0e0e0;
  border: 1px solid #2c313d;
  border-radius: 4px;
  padding: 4px 6px;
  width: 64px;
}

.controls button {
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}

.controls button:disabled {
  background: #3b4252;
  cursor: not-allowed;
}

.progress-bar {
  height: 4px;
  background: #1c1f27;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.2s ease;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.results-table th {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid #2c313d;
  cursor: pointer;
  user-select: none;
  color: #9aa4b2;
  font-weight: 500;
}

.results-table th:hover {
  color: #e0e0e0;
}

.results-table td {
  padding: 8px;
  border-bottom: 1px solid #1c1f27;
}

.symbol-cell {
  font-weight: 600;
}

.positive {
  color: #22c55e;
}

.negative {
  color: #ef4444;
}

.badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.signal-accum {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.signal-dist {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.signal-neutral {
  background: rgba(154, 164, 178, 0.15);
  color: #9aa4b2;
}

.empty-state {
  color: #6b7280;
  font-size: 13px;
  padding: 24px 0;
  text-align: center;
}

.error-list {
  margin-top: 12px;
  font-size: 12px;
  color: #ef4444;
}

.low-liquidity {
  opacity: 0.55;
}

.thin-tag {
  font-size: 10px;
  color: #9aa4b2;
  background: rgba(154, 164, 178, 0.15);
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 6px;
  vertical-align: middle;
}
</style>