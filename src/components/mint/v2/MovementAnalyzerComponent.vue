<template>
  <div class="movement-analyzer">

    <div class="ma-actions">
      <button class="ma-btn ma-btn-primary" :disabled="running" @click="runCurrent">
        Run Current{{ props.symbol ? ` (${props.symbol})` : "" }}
      </button>
      <button class="ma-btn" :disabled="running" @click="runAll">
        Run All ({{ totalSymbols }} symbols)
      </button>
      <button v-if="currentReport" class="ma-btn ma-btn-ghost" @click="downloadReport(props.symbol, currentReport)">
        Download Current Result
      </button>
    </div>

    <div v-if="running" class="ma-progress">
      <div class="ma-progress-label">
        Running {{ progressIndex }} / {{ progressTotal }}{{ progressSymbol ? ` — ${progressSymbol}` : "" }}
      </div>
      <div class="ma-progress-track">
        <div class="ma-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <div v-if="progressError" class="ma-progress-error">{{ progressError }}</div>
    </div>

    <div v-if="currentReport && !running" class="ma-current-summary">
      <div class="ma-summary-title">Current run summary</div>
      <div class="ma-summary-grid">
        <div><span class="ma-label">Candles</span><span class="ma-value">{{ currentReport.metadata.candleCount }}</span></div>
        <div><span class="ma-label">Anchors captured</span><span class="ma-value">{{ currentReport.anchorLifecycleOutcomes.length }}</span></div>
        <div><span class="ma-label">Sweep events</span><span class="ma-value">{{ currentReport.sweepEventOutcomes.filter(s => s.behavior === 'SWEPT').length }}</span></div>
        <div><span class="ma-label">Price-action sequences</span><span class="ma-value">{{ currentReport.priceActionSequenceOutcomes.length }}</span></div>
        <div><span class="ma-label">Confirmed sequences</span><span class="ma-value">{{ confirmedCount }}</span></div>
        <div><span class="ma-label">Magnet triggers</span><span class="ma-value">{{ currentReport.magnetAnalysis.length }}</span></div>
      </div>
    </div>

    <div class="ma-cached-list">
      <div class="ma-list-header">
        <div class="ma-list-title">Cached results ({{ totalCached }})</div>
        <div class="ma-page-size">
          Per page:
          <select v-model.number="pageSize">
            <option v-for="n in [10, 20, 50, 100]" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
      </div>

      <table class="ma-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Interval</th>
            <th>Candles</th>
            <th>Range</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pagedRows" :key="row.symbol">
            <td>{{ row.symbol }}</td>
            <td>{{ row.interval }}</td>
            <td>{{ row.candleCount }}</td>
            <td>{{ formatRange(row.startTime, row.endTime) }}</td>
            <td>{{ formatDate(row.updatedAt) }}</td>
            <td>
              <button class="ma-btn ma-btn-small" @click="downloadCached(row.symbol)">Download</button>
              <button class="ma-btn ma-btn-small ma-btn-ghost" @click="removeCached(row.symbol)">Delete</button>
            </td>
          </tr>
          <tr v-if="!pagedRows.length">
            <td colspan="6" class="ma-empty">No cached results yet — run "Run All" to populate this list.</td>
          </tr>
        </tbody>
      </table>

      <div class="ma-pagination" v-if="totalPages > 1">
        <button class="ma-btn ma-btn-small" :disabled="page <= 1" @click="page--">Prev</button>
        <span>Page {{ page }} / {{ totalPages }}</span>
        <button class="ma-btn ma-btn-small" :disabled="page >= totalPages" @click="page++">Next</button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { CandleInfo, SimulationAnalysisReport } from "@/core/interfacesv2";
import { analyzeMovements } from "@/utility/v2/analysis/simulationMovementAnalyzer";
import { klineDbUtilityV2 } from "@/utility/v2/klineDbUtilityV2";
import { useChocoMintoStore } from "@/stores/chocoMintoStore";
import {
  saveMovementAnalysis,
  loadMovementAnalysis,
  listMovementAnalysisSummaries,
  deleteMovementAnalysis,
  type CachedMovementAnalysisSummary,
} from "@/utility/cachedMovementAnalysisDb";

const props = defineProps<{
  symbol: string;
  candles: CandleInfo[];
}>();

const chocoMintoStore = useChocoMintoStore();

const currentReport = ref<SimulationAnalysisReport | null>(null);

const running = ref(false);
const progressIndex = ref(0);
const progressTotal = ref(0);
const progressSymbol = ref("");
const progressError = ref("");

const progressPercent = computed(() =>
  progressTotal.value > 0 ? Math.round((progressIndex.value / progressTotal.value) * 100) : 0
);

const totalSymbols = computed(() => chocoMintoStore.futureSymbols.length);

const confirmedCount = computed(() =>
  currentReport.value
    ? currentReport.value.priceActionSequenceOutcomes.filter(p => p.terminalStage === "CONFIRMED").length
    : 0
);

// ── Run current ──────────────────────────────────────────────────────────

function runCurrent() {
  if (!props.candles.length) return;
  currentReport.value = analyzeMovements(props.candles, { symbol: props.symbol });
}

// ── Run all ──────────────────────────────────────────────────────────────
// Sequential, no parallelism — per instruction, this can be revisited if
// the symbol list grows large enough that it matters.

async function runAll() {
  const symbols = chocoMintoStore.futureSymbols.map(f => f.symbol);
  if (!symbols.length) return;

  running.value = true;
  progressTotal.value = symbols.length;
  progressIndex.value = 0;
  progressError.value = "";

  for (const sym of symbols) {
    progressSymbol.value = sym;
    try {
      const info = await klineDbUtilityV2.getSymbolInfo(sym);
      if (!info || !info.candle_15m.length) {
        progressError.value = `Skipped ${sym}: no cached candle data`;
      } else {
        const report = analyzeMovements(info.candle_15m, { symbol: sym, interval: "15m" });
        await saveMovementAnalysis({ symbol: sym, report, updatedAt: Date.now() });
      }
    } catch (err) {
      progressError.value = `Failed on ${sym}: ${err instanceof Error ? err.message : String(err)}`;
    }
    progressIndex.value++;
  }

  running.value = false;
  await refreshCachedList();
}

// ── Cached list (paginated) ──────────────────────────────────────────────

const cachedRows = ref<CachedMovementAnalysisSummary[]>([]);
const page = ref(1);
const pageSize = ref(10);

const totalCached = computed(() => cachedRows.value.length);
const totalPages = computed(() => Math.max(1, Math.ceil(cachedRows.value.length / pageSize.value)));
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return cachedRows.value.slice(start, start + pageSize.value);
});

async function refreshCachedList() {
  cachedRows.value = await listMovementAnalysisSummaries();
  if (page.value > totalPages.value) page.value = totalPages.value;
}

async function removeCached(symbol: string) {
  await deleteMovementAnalysis(symbol);
  await refreshCachedList();
}

// ── Downloads ──────────────────────────────────────────────────────────

function downloadReport(symbol: string, report: SimulationAnalysisReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `movement-analysis-${symbol || "current"}-${report.metadata.generatedAt}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadCached(symbol: string) {
  const cached = await loadMovementAnalysis(symbol);
  if (!cached) return;
  downloadReport(symbol, cached.report);
}

// ── Formatting ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatRange(start: number, end: number): string {
  const fmt = (t: number) => new Date(t).toLocaleDateString();
  return `${fmt(start)} - ${fmt(end)}`;
}

onMounted(refreshCachedList);
</script>

<style scoped>
.movement-analyzer {
  font-family: var(--mono, monospace);
  color: #cdd3db;
  padding: 8px 4px;
}

.ma-actions { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }

.ma-btn {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.14);
  color: #cdd3db;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.ma-btn:hover:not(:disabled) { border-color: rgba(255,255,255,.3); color: #fff; }
.ma-btn:disabled { opacity: .5; cursor: not-allowed; }
.ma-btn-primary { background: rgba(45,212,191,.15); border-color: #2dd4bf; color: #2dd4bf; }
.ma-btn-ghost { background: transparent; }
.ma-btn-small { padding: 3px 8px; font-size: 11px; margin-right: 4px; }

.ma-progress { margin-bottom: 14px; }
.ma-progress-label { font-size: 12px; margin-bottom: 4px; }
.ma-progress-track {
  width: 100%; height: 8px; border-radius: 4px;
  background: rgba(255,255,255,.08); overflow: hidden;
}
.ma-progress-fill { height: 100%; background: #2dd4bf; transition: width .15s ease; }
.ma-progress-error { color: #f59e0b; font-size: 11px; margin-top: 4px; }

.ma-current-summary {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.ma-summary-title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #9aa4b2; margin-bottom: 8px; }
.ma-summary-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px 16px; font-size: 12px;
}
.ma-label { color: #9aa4b2; margin-right: 6px; }
.ma-value { color: #fff; font-weight: 600; }

.ma-list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.ma-list-title { font-size: 12px; color: #9aa4b2; text-transform: uppercase; letter-spacing: .5px; }
.ma-page-size { font-size: 12px; }
.ma-page-size select {
  background: rgba(255,255,255,.06); color: #cdd3db;
  border: 1px solid rgba(255,255,255,.14); border-radius: 4px; padding: 2px 4px; margin-left: 4px;
}

.ma-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ma-table th {
  text-align: left; color: #9aa4b2; font-weight: 500;
  border-bottom: 1px solid rgba(255,255,255,.12); padding: 6px 8px;
}
.ma-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.06); }
.ma-empty { text-align: center; color: #7d8590; padding: 16px; }

.ma-pagination { display: flex; align-items: center; gap: 10px; justify-content: center; margin-top: 10px; font-size: 12px; }
</style>