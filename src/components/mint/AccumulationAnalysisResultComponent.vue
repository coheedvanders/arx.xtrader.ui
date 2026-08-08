<template>
  <div class="accum-analysis">
    <div v-if="isLoading" class="state-msg">Running accumulation analysis for {{ symbol.toUpperCase() }}...</div>

    <div v-else-if="error" class="state-msg error">
      Failed to analyze {{ symbol.toUpperCase() }}: {{ error }}
      <button class="retry-btn" @click="load">Retry</button>
    </div>

    <template v-else-if="result">
      <div class="pattern-row">
        <span class="pattern-badge" :class="patternClass(result.pattern)">{{ result.pattern }}</span>
        <span v-if="result.lowLiquidity" class="thin-tag" title="24h quote volume below liquidity floor">thin market</span>
      </div>

      <p class="narrative">{{ result.narrative }}</p>

      <div class="metrics-grid">
        <div class="metric">
          <label>Price Δ</label>
          <span :class="numClass(result.priceChangePct)">{{ result.priceChangePct.toFixed(2) }}%</span>
        </div>
        <div class="metric">
          <label>OI Δ</label>
          <span :class="numClass(result.oiChangePct)">{{ result.oiChangePct.toFixed(2) }}%</span>
        </div>
        <div class="metric">
          <label>Taker Buy Ratio</label>
          <span>{{ result.takerBuyRatio.toFixed(3) }}</span>
        </div>
        <div class="metric">
          <label>Large Buy</label>
          <span class="positive">{{ formatUsd(result.largeBuyNotional) }}</span>
        </div>
        <div class="metric">
          <label>Large Sell</label>
          <span class="negative">{{ formatUsd(result.largeSellNotional) }}</span>
        </div>
        <div class="metric">
          <label>Score</label>
          <span>{{ result.score.toFixed(1) }}</span>
        </div>
      </div>

      <div class="probability-section">
        <div class="probability-labels">
          <span class="long-label">Long {{ result.longProbability.toFixed(1) }}%</span>
          <span class="short-label">Short {{ result.shortProbability.toFixed(1) }}%</span>
        </div>
        <div class="probability-bar">
          <div class="long-fill" :style="{ width: result.longProbability + '%' }"></div>
        </div>
      </div>

      <div class="meta-row">
        <span>Period: {{ result.period }}</span>
        <span>Lookback: {{ result.lookback }} bars</span>
        <span>24h Vol: {{ formatUsd(result.quoteVolume24h) }}</span>
      </div>

      <button class="retry-btn" @click="load">Re-run</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import {
  runAccumulationAnalysis,
  type AccumulationAnalysisResult,
  type AccumulationPattern,
} from '@/utility/accumulationAnalysis'

interface Props {
  symbol: string
  period?: '5m' | '15m' | '1h' | '4h'
  lookback?: number
}

const props = withDefaults(defineProps<Props>(), {
  period: '5m',
  lookback: 24,
})

const isLoading = ref(false)
const error = ref<string | null>(null)
const result = ref<AccumulationAnalysisResult | null>(null)

async function load() {
  isLoading.value = true
  error.value = null
  try {
    result.value = await runAccumulationAnalysis(props.symbol, {
      period: props.period,
      lookback: props.lookback,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    isLoading.value = false
  }
}

function patternClass(pattern: AccumulationPattern) {
  return {
    'pattern-accum': pattern === 'Accumulation',
    'pattern-dist': pattern === 'Distribution',
    'pattern-long': pattern === 'Momentum Long' || pattern === 'Long Capitulation',
    'pattern-short': pattern === 'New Short Positioning' || pattern === 'Short Covering Rally',
    'pattern-neutral': pattern === 'Neutral' || pattern === 'Thin Market',
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

onMounted(load)
watch(() => props.symbol, load)
</script>

<style scoped>
.accum-analysis {
  color: #e0e0e0;
  background: #12141a;
  padding: 16px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  min-width: 320px;
}

.state-msg {
  font-size: 13px;
  color: #9aa4b2;
  padding: 24px 0;
  text-align: center;
}

.state-msg.error {
  color: #ef4444;
}

.pattern-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.pattern-badge {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.pattern-accum {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.pattern-dist {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.pattern-long {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
}

.pattern-short {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
}

.pattern-neutral {
  background: rgba(154, 164, 178, 0.15);
  color: #9aa4b2;
}

.thin-tag {
  font-size: 11px;
  color: #9aa4b2;
  background: rgba(154, 164, 178, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
}

.narrative {
  font-size: 13px;
  line-height: 1.6;
  color: #cbd2dc;
  margin: 0 0 16px 0;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #1c1f27;
  border-radius: 6px;
  padding: 8px 10px;
}

.metric label {
  font-size: 11px;
  color: #6b7280;
}

.metric span {
  font-size: 13px;
  font-weight: 600;
}

.positive {
  color: #22c55e;
}

.negative {
  color: #ef4444;
}

.probability-section {
  margin-bottom: 14px;
}

.probability-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.long-label {
  color: #22c55e;
  font-weight: 600;
}

.short-label {
  color: #ef4444;
  font-weight: 600;
}

.probability-bar {
  height: 8px;
  background: #ef4444;
  border-radius: 4px;
  overflow: hidden;
}

.long-fill {
  height: 100%;
  background: #22c55e;
}

.meta-row {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 12px;
}

.retry-btn {
  background: #1c1f27;
  color: #e0e0e0;
  border: 1px solid #2c313d;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}

.retry-btn:hover {
  border-color: #2563eb;
}
</style>