<template>
  <div class="bst">
    <header class="bst-header">
      <h2>Black Swan Net</h2>
      <p class="bst-sub">Throw a far limit order across every symbol's whole history and count how often the crazy fish jumps into it.</p>
    </header>

    <section class="bst-controls">
      <label class="field">
        <span>Target price (%)</span>
        <input type="number" v-model.number="targetPct" step="10" :disabled="isRunning" />
      </label>
      <label class="field">
        <span>Reset every (days)</span>
        <input type="number" v-model.number="resetDays" min="1" :disabled="isRunning" />
      </label>
      <label class="field">
        <span>Symbol filter (optional, e.g. USDT)</span>
        <input type="text" v-model="symbolFilter" placeholder="USDT" :disabled="isRunning" />
      </label>
      <label class="field" v-if="availableYears.length">
        <span>Year</span>
        <select v-model="yearFilter">
          <option value="all">All years</option>
          <option v-for="y in availableYears" :key="y" :value="y">{{ y }}</option>
        </select>
      </label>

      <div class="actions">
        <button class="primary" @click="runBacktest" :disabled="isRunning || !symbols.length">
          {{ isRunning ? 'Running…' : `Run on ${symbols.length} symbols` }}
        </button>
        <button v-if="isRunning" class="danger" @click="cancelRequested = true">Cancel</button>
        <button @click="downloadCsv" :disabled="isRunning || !resultCount">Download CSV ({{ resultCount }})</button>
        <button class="ghost" @click="clearResults" :disabled="isRunning || !resultCount">Clear stored results</button>
      </div>
    </section>

    <section class="bst-summary" v-if="resultCount">
      <div class="stat-card">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ summary.total }}</span>
      </div>
      <div class="stat-card stat-win">
        <span class="stat-label">Win</span>
        <span class="stat-value">{{ summary.win }}</span>
      </div>
      <div class="stat-card stat-loss">
        <span class="stat-label">Loss</span>
        <span class="stat-value">{{ summary.loss }}</span>
      </div>
      <div class="stat-card stat-open">
        <span class="stat-label">Open</span>
        <span class="stat-value">{{ summary.open }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Win rate (closed)</span>
        <span class="stat-value">{{ summary.winRatePct }}</span>
      </div>
    </section>

    <section class="bst-progress" v-if="isRunning || statusLog.length">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
      <div class="progress-text">
        <span>{{ currentSymbol || '—' }}</span>
        <span>{{ symbolIndex }} / {{ symbols.length }}</span>
        <span>hits so far: {{ resultCount }}</span>
      </div>
      <div class="log" ref="logEl">
        <div v-for="(line, i) in statusLog" :key="i" class="log-line" :class="line.type">{{ line.text }}</div>
      </div>
    </section>

    <section class="bst-results" v-if="preview.length">
      <table>
        <thead>
          <tr>
            <th>symbol</th>
            <th>base_price</th>
            <th>limit_order_price</th>
            <th>hit_on</th>
            <th>tp_price</th>
            <th>sl_price</th>
            <th>status</th>
            <th>closed_on</th>
            <th>candles_to_close</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in preview" :key="i">
            <td>{{ r.symbol }}</td>
            <td>{{ r.base_price }}</td>
            <td>{{ r.limit_order_price }}</td>
            <td>{{ r.hit_on }}</td>
            <td>{{ r.tp_price }}</td>
            <td>{{ r.sl_price }}</td>
            <td :class="'status-' + r.status.toLowerCase()">{{ r.status }}</td>
            <td>{{ r.closed_on ?? '—' }}</td>
            <td>{{ r.candles_to_close ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="preview-note" v-if="filteredCount > preview.length">
        showing last {{ preview.length }} of {{ filteredCount }}{{ yearFilter === 'all' ? '' : ` (${yearFilter})` }} — download CSV for the full set
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import type { FuturesSymbol } from '@/core/interfaces';

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
}

interface HitRecord {
  id?: number;
  symbol: string;
  base_price: number;
  limit_order_price: number;
  hit_on: string;
  tp_price: number;
  sl_price: number;
  status: 'WIN' | 'LOSS' | 'OPEN';
  closed_on: string | null;
  candles_to_close: number | null;
}

type LogType = 'info' | 'warn' | 'error';

interface LogLine {
  text: string;
  type: LogType;
}

interface Summary {
  total: number;
  win: number;
  loss: number;
  open: number;
  winRatePct: string;
}

const chocoMintoStore = useChocoMintoStore();

const symbols = computed<string[]>(() => {
  const list: string[] = chocoMintoStore.futureSymbols.map((c) => c.symbol) || [];
  const filter = symbolFilter.value.trim().toUpperCase();
  return filter ? list.filter((s) => s.toUpperCase().includes(filter)) : list;
});

const targetPct = ref<number>(500);
const resetDays = ref<number>(5);
const symbolFilter = ref<string>('USDT');

const isRunning = ref<boolean>(false);
const cancelRequested = ref<boolean>(false);
const symbolIndex = ref<number>(0);
const currentSymbol = ref<string>('');
const statusLog = ref<LogLine[]>([]);
const logEl = ref<HTMLDivElement | null>(null);
const resultCount = ref<number>(0);
const allRows = ref<HitRecord[]>([]);
const yearFilter = ref<string>('all');

const availableYears = computed<string[]>(() => {
  const years = new Set<string>();
  for (const r of allRows.value) {
    if (r.hit_on) years.add(r.hit_on.slice(0, 4));
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
});

const filteredRows = computed<HitRecord[]>(() => {
  if (yearFilter.value === 'all') return allRows.value;
  return allRows.value.filter((r) => r.hit_on && r.hit_on.startsWith(yearFilter.value));
});

const filteredCount = computed<number>(() => filteredRows.value.length);
const preview = computed<HitRecord[]>(() => filteredRows.value.slice(-50).reverse());
const summary = computed<Summary>(() => computeSummary(filteredRows.value));

const progressPct = computed<number>(() => {
  if (!symbols.value.length) return 0;
  return Math.min(100, Math.round((symbolIndex.value / symbols.value.length) * 100));
});

function log(text: string, type: LogType = 'info'): void {
  statusLog.value.push({ text: `[${new Date().toLocaleTimeString()}] ${text}`, type });
  if (statusLog.value.length > 300) statusLog.value.shift();
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  });
}

// ---------------- IndexedDB ----------------
const DB_NAME = 'black_swan_net';
const DB_VERSION = 1;
const STORE_NAME = 'hits';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHits(rows: HitRecord[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    rows.forEach((r) => store.add(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getAllHits(): Promise<HitRecord[]> {
  const db = await openDb();
  const rows = await new Promise<HitRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as HitRecord[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

async function clearHits(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function computeSummary(rows: HitRecord[]): Summary {
  let win = 0;
  let loss = 0;
  let open = 0;
  for (const r of rows) {
    if (r.status === 'WIN') win++;
    else if (r.status === 'LOSS') loss++;
    else open++;
  }
  const closed = win + loss;
  const winRatePct = closed > 0 ? `${((win / closed) * 100).toFixed(1)}%` : '—';
  return { total: rows.length, win, loss, open, winRatePct };
}

async function refreshCount(): Promise<void> {
  const rows = await getAllHits();
  resultCount.value = rows.length;
  allRows.value = rows;
}

// ---------------- Binance Futures klines ----------------
const FAPI_BASE = 'https://fapi.binance.com';
const KLINE_LIMIT = 1500;

// raw Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

async function fetchAllDailyKlines(symbol: string): Promise<Candle[]> {
  const candles: Candle[] = [];
  let startTime = 1500000000000; // ~2017-07, before any futures symbol existed
  const now = Date.now();

  while (true) {
    const url = `${FAPI_BASE}/fapi/v1/klines?symbol=${symbol}&interval=1d&startTime=${startTime}&limit=${KLINE_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429 || res.status === 418) {
        log(`rate limited on ${symbol}, backing off…`, 'warn');
        await sleep(2000);
        continue;
      }
      throw new Error(`klines fetch failed for ${symbol}: ${res.status}`);
    }
    const data: RawKline[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      candles.push({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        closeTime: k[6],
      });
    }

    const lastCloseTime = data[data.length - 1][6];
    if (data.length < KLINE_LIMIT || lastCloseTime >= now) break;
    startTime = lastCloseTime + 1;
    await sleep(150);
  }

  return candles;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------- backtest ----------------
function backtestSymbol(symbol: string, candles: Candle[], pct: number, resetD: number): HitRecord[] {
  const hits: HitRecord[] = [];
  let i = 0;
  const n = candles.length;
  while (i < n) {
    const base = candles[i];
    const basePrice = base.open;
    const targetPrice = basePrice * (1 + pct / 100);
    const windowEnd = Math.min(i + resetD, n); // exclusive

    let hitIndex = -1;
    for (let j = i; j < windowEnd; j++) {
      if (candles[j].high >= targetPrice) {
        hitIndex = j;
        break;
      }
    }

    if (hitIndex !== -1) {
      // short entry at limit_order_price (targetPrice):
      // TP = base_price (full mean reversion), SL = one more targetPct step above entry
      const slPrice = targetPrice * (1 + pct / 150);
      let status: 'WIN' | 'LOSS' | 'OPEN' = 'OPEN';
      let closedOn: string | null = null;
      let candlesToClose: number | null = null;

      for (let k = hitIndex + 1; k < n; k++) {
        const c = candles[k];
        const hitSl = c.high >= slPrice;
        const hitTp = c.low <= basePrice;
        if (hitSl || hitTp) {
          // if both the TP and SL levels are touched within the same candle,
          // we can't know which came first intra-bar — assume the adverse
          // outcome (SL) to keep the test conservative
          status = hitSl ? 'LOSS' : 'WIN';
          closedOn = fmtDate(c.openTime);
          candlesToClose = k - hitIndex;
          break;
        }
      }

      hits.push({
        symbol,
        base_price: basePrice,
        limit_order_price: targetPrice,
        hit_on: fmtDate(candles[hitIndex].openTime),
        tp_price: basePrice,
        sl_price: slPrice,
        status,
        closed_on: closedOn,
        candles_to_close: candlesToClose,
      });
      i = hitIndex + 1; // new order starts right after a hit
    } else {
      i = windowEnd; // reset after the window with no hit
    }
  }
  return hits;
}

// ---------------- run ----------------
async function runBacktest(): Promise<void> {
  if (isRunning.value) return;
  isRunning.value = true;
  cancelRequested.value = false;
  symbolIndex.value = 0;
  statusLog.value = [];
  log(`starting backtest: target +${targetPct.value}%, reset every ${resetDays.value}d, ${symbols.value.length} symbols`);

  for (const symbol of symbols.value) {
    if (cancelRequested.value) {
      log('cancelled by user', 'warn');
      break;
    }
    symbolIndex.value += 1;
    currentSymbol.value = symbol;
    try {
      const candles = await fetchAllDailyKlines(symbol);
      if (!candles.length) {
        log(`${symbol}: no candle data, skipping`, 'warn');
        continue;
      }
      const hits = backtestSymbol(symbol, candles, targetPct.value, resetDays.value);
      if (hits.length) {
        await saveHits(hits);
        await refreshCount();
        log(`${symbol}: ${candles.length} candles, ${hits.length} hit(s)`);
      } else {
        log(`${symbol}: ${candles.length} candles, no hits`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${symbol}: error — ${message}`, 'error');
    }
    await sleep(200);
  }

  currentSymbol.value = '';
  isRunning.value = false;
  log('done');
}

// ---------------- CSV export ----------------
async function downloadCsv(): Promise<void> {
  const rows = await getAllHits();
  if (!rows.length) return;
  const header = 'symbol,base_price,limit_order_price,hit_on,tp_price,sl_price,status,closed_on,candles_to_close';
  const lines = rows.map(
    (r) =>
      `${r.symbol},${r.base_price},${r.limit_order_price},${r.hit_on},${r.tp_price},${r.sl_price},${r.status},${
        r.closed_on ?? ''
      },${r.candles_to_close ?? ''}`
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `black_swan_net_${targetPct.value}pct_${resetDays.value}d_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearResults(): Promise<void> {
  await clearHits();
  await refreshCount();
  log('stored results cleared');
}

onMounted(async () => {
    var localStorageFuturesMaxLeverage = localStorage.getItem("CACHED_FUTURES_SYMBOLS");
    if(localStorageFuturesMaxLeverage){
        chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage!) as FuturesSymbol[]
    }
    await refreshCount()
});
</script>

<style scoped>
.bst {
  --bg: #0d1117;
  --panel: #131a24;
  --border: #232c3a;
  --text: #d7dee8;
  --muted: #6b7788;
  --accent: #ff5f5f;
  --accent-dim: #7a2d2d;
  --green: #3ecf8e;
  background: var(--bg);
  color: var(--text);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 20px;
  border-radius: 10px;
  border: 1px solid var(--border);
  max-width: 900px;
}

.bst-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
  letter-spacing: 0.02em;
}
.bst-sub {
  margin: 0 0 18px;
  font-size: 12px;
  color: var(--muted);
}

.bst-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
  margin-bottom: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}
.field input {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 8px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  width: 160px;
}
.field input:focus {
  outline: none;
  border-color: var(--accent-dim);
}
.field select {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 8px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  width: 160px;
}
.field select:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
button {
  font-family: inherit;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
button:hover:not(:disabled) { border-color: #3a4658; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button.primary { background: var(--accent-dim); border-color: var(--accent); color: #ffe3e3; }
button.danger { background: #3a1414; border-color: var(--accent); color: #ffb3b3; }
button.ghost { background: transparent; }

.bst-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}
.stat-card {
  flex: 1 1 100px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-label {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.stat-value {
  font-size: 18px;
  font-weight: 600;
}
.stat-card.stat-win .stat-value { color: var(--green); }
.stat-card.stat-loss .stat-value { color: var(--accent); }
.stat-card.stat-open .stat-value { color: var(--muted); }

.bst-progress {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.progress-bar {
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 8px;
}
.log {
  max-height: 160px;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.6;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.log-line { color: var(--muted); }
.log-line.warn { color: #e8b04a; }
.log-line.error { color: var(--accent); }

.bst-results table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.bst-results th, .bst-results td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.bst-results th { color: var(--muted); font-weight: 500; }
.preview-note { font-size: 11px; color: var(--muted); margin-top: 8px; }
.status-win { color: var(--green); font-weight: 600; }
.status-loss { color: var(--accent); font-weight: 600; }
.status-open { color: var(--muted); font-weight: 600; }
</style>