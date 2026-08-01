<template>
  <div class="scanner">
    <div class="scanner-header">
      <div class="scanner-title">
        <h2>Volume Scanner</h2>
        <span class="scanner-sub">last 30d volume</span>
      </div>
      <div class="scanner-actions">
        <select class="interval-select" v-model="selectedInterval" :disabled="loading">
          <option v-for="opt in INTERVAL_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
        </select>
        <span v-if="loading" class="scan-progress">{{ scannedCount }} / {{ symbols.length }}</span>
        <button class="scan-btn" :disabled="loading" @click="scanAll">
          {{ loading ? 'Scanning…' : results.length ? 'Rescan' : 'Scan' }}
        </button>
      </div>
    </div>

    <div v-if="errorSymbols.length" class="scan-errors">
      Failed to scan: {{ errorSymbols.join(', ') }}
    </div>

    <table class="scan-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th class="num">Total Volume (30d, USDT)</th>
          <th>Volume Buildup</th>
          <th>Trend</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in sortedResults"
          :key="r.symbol"
          class="scan-row"
          @click="openHistory(r)"
        >
          <td class="symbol-cell">{{ r.symbol }}</td>
          <td class="num">{{ formatVolume(r.totalVolume) }}</td>
          <td>
            <span class="buildup" :class="{ active: r.volumeBuildup }">
              {{ r.volumeBuildup ? 'Yes' : 'No' }}
            </span>
          </td>
          <td>
            <span class="trend-badge" :class="r.trend">{{ r.trend }}</span>
          </td>
        </tr>
        <tr v-if="!loading && sortedResults.length === 0">
          <td colspan="4" class="empty">No symbols scanned yet.</td>
        </tr>
      </tbody>
    </table>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
      <DialogHeaderComponent>
        {{ selectedSymbol }}
      </DialogHeaderComponent>
      <CandleEntryHistoryComponent :symbol="selectedSymbol" :candle-entries="selectedSymbolCandleEntries" />
    </DialogComponent>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import type { CandleEntry, FuturesSymbol } from '@/core/interfaces.ts';


type Trend = 'bullish' | 'bearish' | 'ranging';
type Interval = '3m' | '5m' | '15m' | '1h' | '4h' | '1d';

const INTERVAL_OPTIONS: Interval[] = ['3m', '5m', '15m', '1h', '4h', '1d'];

interface ScanResult {
  symbol: string;
  candles: CandleEntry[];
  totalVolume: number;
  trend: Trend;
  volumeBuildup: boolean;
}

interface Props {
  defaultInterval?: Interval;
  lookbackDays?: number;
  buildupWindow?: number; // candles compared for volume buildup
  rangingThresholdPct?: number; // |close change %| below this = ranging
  requestDelayMs?: number; // pause between each symbol's request, avoids rate limit bans
}

const props = withDefaults(defineProps<Props>(), {
  defaultInterval: '1h',
  lookbackDays: 30,
  buildupWindow: 10,
  rangingThresholdPct: 3,
  requestDelayMs: 200,
});

const selectedInterval = ref<Interval>(props.defaultInterval);

const chocoMintoStore = useChocoMintoStore();
const symbols = computed<string[]>(() => chocoMintoStore.futureSymbols.map(f => f.symbol));

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com/fapi/v1/klines';

const results = ref<ScanResult[]>([]);
const loading = ref(false);
const scannedCount = ref(0);
const errorSymbols = ref<string[]>([]);

const showEntryHistory = ref(false);
const selectedSymbol = ref('');
const selectedSymbolCandleEntries = ref<CandleEntry[]>([]);

const sortedResults = computed<ScanResult[]>(() =>
  [...results.value].sort((a, b) => b.totalVolume - a.totalVolume)
);

function formatVolume(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(2) + 'K';
  return '$' + v.toFixed(2);
}

async function fetchKlines(symbol: string): Promise<CandleEntry[]> {
  const endTime = Date.now();
  const startTime = endTime - props.lookbackDays * 24 * 60 * 60 * 1000;
  const url = `${BINANCE_FUTURES_BASE}?symbol=${symbol}&interval=${selectedInterval.value}&startTime=${startTime}&endTime=${endTime}&limit=1500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${symbol}: ${res.status}`);
  const raw: unknown[][] = await res.json();
  return raw.map(k => ({
    symbol,
    openTime: k[0] as number,
    open: +k[1]!,
    high: +k[2]!,
    low: +k[3]!,
    close: +k[4]!,
    close_atr_adjusted: 0,
    close_atr_abs_change: 0,
    volume: +k[5]!,
    closeTime: k[6] as number,
    duration: (k[6] as number) - (k[0] as number),
    closed: true,
    support: null,
    resistance: null,
    breakthrough_resistance: false,
    breakthrough_support: false,
    status: '',
    side: '',
    tpPrice: 0,
    slPrice: 0,
    zoneAnalysis: null,
    volumeAnalysis: null,
    overboughSoldAnalysis: null,
    pastVolumeAnalysis: null,
    candleData: null,
    pnl: 0,
    leverage: 0,
    margin: 0,
    entryFee: 0,
    priceZone: null,
    priceZoneInteraction: null,
    closeAbsDistanceToZone: null,
    priceZoneEvaluation: null,
    patternTrack: '',
    isPoint: false,
    isWeakening: false,
  }));
}

function determineTrend(candles: CandleEntry[]): Trend {
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const pctChange = ((last - first) / first) * 100;
  if (Math.abs(pctChange) < props.rangingThresholdPct) return 'ranging';
  return pctChange > 0 ? 'bullish' : 'bearish';
}

function hasVolumeBuildup(candles: CandleEntry[]): boolean {
  const w = props.buildupWindow;
  if (candles.length < w * 2) return false;
  const avg = (arr: CandleEntry[]) => arr.reduce((s, c) => s + c.volume * c.close, 0) / arr.length;
  const recent = avg(candles.slice(-w));
  const prior = avg(candles.slice(-w * 2, -w));
  return recent > prior;
}

async function scanSymbol(symbol: string): Promise<ScanResult> {
  const candles = await fetchKlines(symbol);
  if (!candles.length) throw new Error(`${symbol}: no candles`);
  return {
    symbol,
    candles,
    totalVolume: candles.reduce((s, c) => s + c.volume * c.close, 0), // USDT notional, not base-asset volume
    trend: determineTrend(candles),
    volumeBuildup: hasVolumeBuildup(candles),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scanAll(): Promise<void> {
  loading.value = true;
  scannedCount.value = 0;
  errorSymbols.value = [];
  const scanned: ScanResult[] = [];

  for (const symbol of symbols.value) {
    try {
      scanned.push(await scanSymbol(symbol));
    } catch (e) {
      errorSymbols.value.push(symbol);
    }
    scannedCount.value++;
    await sleep(props.requestDelayMs);
  }

  results.value = scanned;
  loading.value = false;
}

function openHistory(r: ScanResult): void {
  selectedSymbol.value = r.symbol;
  selectedSymbolCandleEntries.value = r.candles;
  showEntryHistory.value = true;
}


onMounted(async () => {
    var localStorageFuturesMaxLeverage = localStorage.getItem("CACHED_FUTURES_SYMBOLS");
    if(localStorageFuturesMaxLeverage){
        chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage!) as FuturesSymbol[]
    }
});
</script>

<style scoped>
.scanner {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: #e2e8f0;
}

.scanner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.scanner-title h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.scanner-sub {
  font-size: 0.75rem;
  color: #94a3b8;
}

.scanner-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.scan-progress {
  font-size: 0.75rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.interval-select {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  font-size: 0.8rem;
}

.scan-btn {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
}

.scan-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.scan-errors {
  font-size: 0.75rem;
  color: #f87171;
}

.scan-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.scan-table th {
  text-align: left;
  font-weight: 500;
  color: #94a3b8;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #1e293b;
}

.scan-table th.num,
.scan-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.scan-row {
  cursor: pointer;
  border-bottom: 1px solid #1e293b;
}

.scan-row:hover {
  background: #16202f;
}

.scan-table td {
  padding: 0.5rem 0.75rem;
}

.symbol-cell {
  font-weight: 600;
}

.buildup {
  color: #64748b;
}

.buildup.active {
  color: #38bdf8;
  font-weight: 600;
}

.trend-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  text-transform: capitalize;
}

.trend-badge.bullish {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.trend-badge.bearish {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.trend-badge.ranging {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.empty {
  text-align: center;
  color: #64748b;
  padding: 1rem;
}
</style>