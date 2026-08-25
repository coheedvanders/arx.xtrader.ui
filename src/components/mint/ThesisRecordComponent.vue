<template>
  <div class="thesis-record-board pa-md">
    <div class="thesis-record-header">
      <span class="thesis-record-title">Theses — last 5 days</span>
      <span class="thesis-record-count">{{ theses.length }}</span>
      <button class="thesis-refresh-btn" :disabled="loading" @click="loadTheses">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
      <button
        class="thesis-refresh-btn thesis-check-all-btn"
        :disabled="!theses.length || checkingAll"
        @click="runCheckAll"
      >
        {{ checkingAll ? `Checking ${checkAllDone}/${theses.length}…` : 'Run Check All' }}
      </button>
      <button
        class="thesis-refresh-btn thesis-clear-all-btn"
        :disabled="!theses.length || clearingAll"
        @click="clearAll"
      >
        {{ clearingAll ? 'Clearing…' : 'Clear All' }}
      </button>
    </div>

    <div class="thesis-list">
      <div
        v-for="thesis in theses"
        :key="thesis.id"
        class="thesis-card"
        :class="thesis.side === 'LONG' ? 'is-long' : 'is-short'"
        @click="openThesis(thesis)"
      >
        <div class="thesis-main">
          <span class="thesis-symbol">{{ thesis.symbol.toUpperCase() }}</span>
          <span class="thesis-side-badge" :class="thesis.side.toLowerCase()">{{ thesis.side }}</span>
          <span class="thesis-time">{{ formatRelativeTime(thesis.createdAt) }}</span>
          <button
            class="thesis-remove-btn"
            title="Remove this thesis"
            @click.stop="removeThesis(thesis)"
          >
            ×
          </button>
        </div>

        <div class="thesis-prices">
          <span class="thesis-stat"><label>Entry</label><span>{{ formatPrice(thesis.entryPrice) }}</span></span>
          <span class="thesis-stat tp"><label>TP</label><span>{{ formatPrice(thesis.tpPrice) }}</span></span>
          <span class="thesis-stat sl"><label>SL</label><span>{{ formatPrice(thesis.slPrice) }}</span></span>
        </div>

        <div v-if="thesis.remarks" class="thesis-remarks">{{ thesis.remarks }}</div>

        <div class="thesis-check-row">
          <button
            class="thesis-check-btn"
            :disabled="checkResults[thesis.id!]?.status === 'checking'"
            @click.stop="runCheck(thesis)"
          >
            {{ checkResults[thesis.id!]?.status === 'checking' ? 'Checking…' : 'Run Check' }}
          </button>

          <span
            v-if="checkResults[thesis.id!] && checkResults[thesis.id!].status !== 'checking'"
            class="thesis-check-result"
            :class="resultClass(checkResults[thesis.id!].status)"
          >
            {{ resultLabel(checkResults[thesis.id!]) }}
          </span>
        </div>
      </div>

      <div v-if="!loading && !theses.length" class="thesis-empty">No theses recorded in the last 5 days.</div>
    </div>
  </div>

  <DialogComponent v-model="showThesisDialog" :width="'95vw'">
    <DialogHeaderComponent>
      {{ selectedThesis?.symbol?.toUpperCase() }} — {{ selectedThesis?.side }} thesis
    </DialogHeaderComponent>
    <CandleEntryVisualizerComponent
      v-if="selectedThesis"
      :symbol="selectedThesis.symbol"
      :candles="selectedSymbolCandles"
      :initial-show-thesis="true"
    />
  </DialogComponent>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryVisualizerComponent from './CandleEntryVisualizerComponent.vue';
import { klineDbUtility } from '@/utility/klineDbUtility';
import { getRecentTheses, deleteThesis, clearAllTheses, type ThesisRecord } from '@/utility/thesisDb.ts';
import type { CandleEntry } from '@/core/interfaces.ts';

const theses = ref<ThesisRecord[]>([]);
const loading = ref(false);

const showThesisDialog = ref(false);
const selectedThesis = ref<ThesisRecord | null>(null);
const selectedSymbolCandles = ref<CandleEntry[]>([]);

async function loadTheses() {
  loading.value = true;
  try {
    theses.value = await getRecentTheses(5);
  } catch (error) {
    console.error('Failed to load thesis records:', error);
  } finally {
    loading.value = false;
  }
}

// ── Remove one / clear all ──────────────────────────────────────────────
const clearingAll = ref(false);

/** Deletes a single thesis record and drops it from the current list + any cached check result, without a full reload. */
async function removeThesis(thesis: ThesisRecord) {
  if (thesis.id == null) return;
  try {
    await deleteThesis(thesis.id);
    theses.value = theses.value.filter((t) => t.id !== thesis.id);
    delete checkResults.value[thesis.id];
  } catch (error) {
    console.error('Failed to delete thesis:', error);
  }
}

/** Deletes every thesis record after a confirm step (destructive, can't be undone). */
async function clearAll() {
  if (!theses.value.length || clearingAll.value) return;
  const confirmed = window.confirm(`Delete all ${theses.value.length} thesis record(s)? This can't be undone.`);
  if (!confirmed) return;

  clearingAll.value = true;
  try {
    await clearAllTheses();
    theses.value = [];
    checkResults.value = {};
  } catch (error) {
    console.error('Failed to clear thesis records:', error);
  } finally {
    clearingAll.value = false;
  }
}

// ── Opens the same Dialog/DialogHeader pattern ConditionMetComponent uses
// for its symbol click-through, loading live klines for the chart and
// telling it to switch its thesis overlay on immediately so TP/SL hits are
// visible as soon as the dialog opens.
async function openThesis(thesis: ThesisRecord) {
  selectedThesis.value = thesis;
  showThesisDialog.value = true;
  selectedSymbolCandles.value = await klineDbUtility.getKlines(thesis.symbol);
}

// ── Win/Loss checker ────────────────────────────────────────────────────
//
// "Run Check" pulls the symbol's 15m candles fresh from Binance, starting
// at the candle the thesis was opened against and running up to now, then
// walks that range candle-by-candle to see whether TP or SL got hit first
// — same hit-detection rule the chart's thesis overlay uses, just run
// against live REST data instead of whatever's currently in memory.
const REST_BASE = 'https://fapi.binance.com';
const CHECK_INTERVAL = '15m';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const BINANCE_KLINE_LIMIT = 1500;

type CheckStatus = 'checking' | 'win_long' | 'win_short' | 'loss_long' | 'loss_short' | 'open' | 'no_data' | 'error';

interface CheckResult {
  status: CheckStatus;
  hitAt?: number | null;
  error?: string;
}

const checkResults = ref<Record<number, CheckResult>>({});

/** Pages through Binance's 15m klines from startTime to endTime (1500 candles per request). */
async function fetchCandlesRange(symbol: string, startTime: number, endTime: number): Promise<CandleEntry[]> {
  const candles: CandleEntry[] = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${CHECK_INTERVAL}&startTime=${cursor}&endTime=${endTime}&limit=${BINANCE_KLINE_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;

    for (const k of data) {
      candles.push({
        openTime: Number(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: Number(k[6]),
      } as CandleEntry);
    }

    const lastOpenTime = Number(data[data.length - 1][0]);
    if (data.length < BINANCE_KLINE_LIMIT || lastOpenTime <= cursor) break;
    cursor = lastOpenTime + CHECK_INTERVAL_MS;
  }

  return candles;
}

/** Walks the candle range oldest→newest looking for the first candle that touches TP or SL. */
function evaluateWinLoss(thesis: ThesisRecord, candles: CandleEntry[]): CheckResult {
  if (!candles.length) return { status: 'no_data' };
  const isLong = thesis.side === 'LONG';

  for (const c of candles) {
    if (c.high == null || c.low == null) continue;
    const hitTp = isLong ? c.high >= thesis.tpPrice : c.low <= thesis.tpPrice;
    const hitSl = isLong ? c.low <= thesis.slPrice : c.high >= thesis.slPrice;
    if (!hitTp && !hitSl) continue;

    if (hitTp && hitSl) {
      // Both touched within the same candle — OHLC alone can't tell us
      // which came first, so approximate using distance from open.
      const distToTp = Math.abs((c.open ?? thesis.entryPrice) - thesis.tpPrice);
      const distToSl = Math.abs((c.open ?? thesis.entryPrice) - thesis.slPrice);
      const wonTp = distToTp <= distToSl;
      return {
        status: wonTp ? (isLong ? 'win_long' : 'win_short') : (isLong ? 'loss_long' : 'loss_short'),
        hitAt: c.openTime ?? null,
      };
    }
    if (hitTp) return { status: isLong ? 'win_long' : 'win_short', hitAt: c.openTime ?? null };
    return { status: isLong ? 'loss_long' : 'loss_short', hitAt: c.openTime ?? null };
  }

  return { status: 'open' };
}

async function runCheck(thesis: ThesisRecord) {
  if (thesis.id == null) return;
  checkResults.value[thesis.id] = { status: 'checking' };

  try {
    const startTime = thesis.entryOpenTime ?? thesis.createdAt;
    const candles = await fetchCandlesRange(thesis.symbol, startTime, Date.now());
    checkResults.value[thesis.id] = evaluateWinLoss(thesis, candles);
  } catch (error) {
    console.error('Thesis win/loss check failed:', error);
    checkResults.value[thesis.id] = {
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to check.',
    };
  }
}

// "Run Check All" fires runCheck for every thesis currently listed. Requests
// are capped at a small concurrency limit (rather than firing 30+ REST calls
// at once) to stay polite to Binance's rate limits.
const CHECK_ALL_CONCURRENCY = 4;
const checkingAll = ref(false);
const checkAllDone = ref(0);

async function runCheckAll() {
  if (checkingAll.value || !theses.value.length) return;
  checkingAll.value = true;
  checkAllDone.value = 0;

  const queue = [...theses.value];

  async function worker() {
    while (queue.length) {
      const thesis = queue.shift();
      if (!thesis) break;
      await runCheck(thesis);
      checkAllDone.value += 1;
    }
  }

  try {
    const workers = Array.from({ length: Math.min(CHECK_ALL_CONCURRENCY, theses.value.length) }, worker);
    await Promise.all(workers);
  } finally {
    checkingAll.value = false;
  }
}

function resultClass(status: CheckStatus) {
  if (status === 'win_long' || status === 'win_short') return 'is-win';
  if (status === 'loss_long' || status === 'loss_short') return 'is-loss';
  if (status === 'error') return 'is-error';
  return 'is-open';
}

function resultLabel(result: CheckResult) {
  const hitSuffix = result.hitAt ? ` @ ${new Date(result.hitAt).toLocaleString()}` : '';
  switch (result.status) {
    case 'win_long':
    case 'win_short':
      return `TP HIT${hitSuffix}`;
    case 'loss_long':
    case 'loss_short':
      return `SL HIT${hitSuffix}`;
    case 'open':
      return 'Still open';
    case 'no_data':
      return 'No candle data';
    case 'error':
      return result.error ?? 'Check failed';
    default:
      return '';
  }
}

function formatPrice(value: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(4);
}

function formatRelativeTime(ms: number) {
  const diffMs = Date.now() - ms;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

onMounted(loadTheses);
</script>

<style scoped>
.thesis-record-board {
  font-family: inherit;
}

.thesis-record-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 10px;
  background: rgba(127, 127, 127, 0.08);
}

.thesis-record-title { text-transform: uppercase; }

.thesis-record-count {
  font-weight: 400;
  opacity: 0.7;
  font-size: 0.85rem;
}

.thesis-refresh-btn {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #555;
  background: rgba(255,255,255,0.06);
  color: #ccc;
  font-size: 0.78rem;
  cursor: pointer;
}
.thesis-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.thesis-refresh-btn:not(:disabled):hover { background: rgba(255,255,255,0.12); }

.thesis-check-all-btn {
  margin-left: 0;
  border-color: #ab47bc;
  color: #ce93d8;
  background: rgba(171,71,188,0.12);
}
.thesis-check-all-btn:not(:disabled):hover { background: rgba(171,71,188,0.25); }

.thesis-clear-all-btn {
  margin-left: 0;
  border-color: #ef5350;
  color: #ef9a9a;
  background: rgba(239,83,80,0.12);
}
.thesis-clear-all-btn:not(:disabled):hover { background: rgba(239,83,80,0.25); }

.thesis-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thesis-empty { font-size: 0.85rem; opacity: 0.6; padding: 12px 0; }

.thesis-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  cursor: pointer;
  transition: background 0.15s ease;
  border-left: 3px solid #555;
}
.thesis-card:hover { background: rgba(127, 127, 127, 0.14); }
.thesis-card.is-long { border-left-color: #26a69a; }
.thesis-card.is-short { border-left-color: #ef5350; }

.thesis-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.thesis-symbol { font-weight: 600; font-size: 0.95rem; }

.thesis-side-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.4px;
}
.thesis-side-badge.long { background: rgba(38,166,154,0.3); color: #26a69a; }
.thesis-side-badge.short { background: rgba(239,83,80,0.3); color: #ef5350; }

.thesis-time {
  margin-left: auto;
  font-size: 0.75rem;
  opacity: 0.6;
}

.thesis-remove-btn {
  border: none;
  background: transparent;
  color: #888;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
  border-radius: 4px;
}
.thesis-remove-btn:hover { color: #ef5350; background: rgba(239,83,80,0.12); }

.thesis-prices {
  display: flex;
  gap: 14px;
}

.thesis-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: monospace;
}
.thesis-stat label {
  color: #999;
  font-family: inherit;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.4px;
}
.thesis-stat.tp span:last-child { color: #26a69a; }
.thesis-stat.sl span:last-child { color: #ef5350; }

.thesis-remarks {
  font-size: 0.8rem;
  opacity: 0.8;
  white-space: pre-wrap;
}

.thesis-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.thesis-check-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #555;
  background: rgba(255,255,255,0.06);
  color: #ccc;
  font-size: 0.75rem;
  cursor: pointer;
}
.thesis-check-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.thesis-check-btn:not(:disabled):hover { background: rgba(255,255,255,0.12); }

.thesis-check-result {
  font-size: 0.75rem;
  font-weight: 700;
  font-family: monospace;
  letter-spacing: 0.02em;
}
.thesis-check-result.is-win { color: #26a69a; }
.thesis-check-result.is-loss { color: #ef5350; }
.thesis-check-result.is-open { color: #64b5f6; }
.thesis-check-result.is-error { color: #f59e0b; }
</style>