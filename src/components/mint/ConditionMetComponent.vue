<template>
  <div class="condition-board pa-md">
    <div
      v-for="group in groupedSymbols"
      :key="group.label"
      class="condition-group"
    >
      <div class="group-header" :class="group.isZone ? 'is-zone-header' : ''">
        <span class="group-label">{{ group.label }}</span>
        <span class="group-count">{{ group.symbols.length }}</span>
      </div>

      <div class="symbol-list">
        <div
          v-for="symbol in group.symbols"
          :key="symbol.symbol"
          class="symbol-card"
          :class="{
            'is-av-cross': symbol.crossedLastAvwap,
            'is-recent-long': (symbol as any).hasRecentPosition && (symbol as any).recentPositionSide === 'LONG',
            'is-recent-short': (symbol as any).hasRecentPosition && (symbol as any).recentPositionSide === 'SHORT',
          }"
          @click="showEntryHistoryModal(symbol.symbol)"
        >
          <div class="symbol-main">
            <span class="symbol-name">{{ symbol.symbol }} <span v-if="symbol.crossedMa">[x]</span> <span v-if="symbol.crossedLastAvwap">[AV]</span> <span v-if="symbol.hasRecentCrossedMovementPoc">[FLOW MOVEMENT X]</span></span>
            <span class="usdt-value">${{ formatUsdt((symbol as any).usdtValue) }}</span>
          </div>

          <div class="symbol-meta">
            <span class="trend-badge" :class="trendClass(symbol.trend)">
              {{ symbol.trend }}
            </span>

            <!-- Zone-specific columns: zone size + MA level stack (only when data exists) -->
            <template v-if="group.isZone">
              <span v-if="hasZoneSize(symbol)" class="zone-size-value">
                zone: {{ formatZoneSize((symbol as any).zoneSize) }}
              </span>

              <div v-if="hasMaData(symbol)" class="ma-stack" :title="maTitle(symbol)">
                <div
                  v-for="row in maRows(symbol)"
                  :key="row.key"
                  class="ma-stack-row"
                >
                  <span class="ma-stack-label" :class="row.colorClass">{{ row.key }}</span>
                  <div class="ma-stack-track">
                    <div
                      class="ma-stack-fill"
                      :class="row.colorClass"
                      :style="{ width: row.widthPct + '%' }"
                    ></div>
                  </div>
                  <span class="ma-stack-value">{{ formatMaValue(row.value) }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div v-if="!group.symbols.length" class="range-empty">No symbols.</div>
      </div>
    </div>

    <div v-if="!groupedSymbols.length" class="range-empty">No symbols.</div>
  </div>

  <DialogComponent v-model="showEntryHistory" :width="'95vw'">
    <DialogHeaderComponent>
      {{ selectedSymbol }}
    </DialogHeaderComponent>
    <CandleEntryHistoryComponent :symbol="selectedSymbol" :candle-entries="selectedSymbolCandleEntries" />
  </DialogComponent>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import type { CandleEntry } from '@/core/interfaces.ts';
import { klineDbUtility } from '@/utility/klineDbUtility';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility.ts';

const chocoMintoStore = useChocoMintoStore();

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([]);
const selectedSymbol = ref('');

// ── Grouping by conditionMet ────────────────────────────────────────────────

function isZoneCondition(label: string) {
  return typeof label === 'string' && label.toLowerCase().startsWith('zone');
}

const groupedSymbols = computed(() => {
  const map = new Map<string, any[]>();

  for (const s of chocoMintoStore.futureSymbols) {
    const key = (s as any).conditionMet;
    if (typeof key !== 'string' || !key.trim()) continue; // skip blank/missing conditionMet

    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }

  return Array.from(map.entries())
    .map(([label, symbols]) => {
      const zone = isZoneCondition(label);

      // Zone conditions: order by zone size, descending.
      // Everything else: fall back to usdtValue, descending.
      const sorted = zone
        ? [...symbols].sort((a, b) => ((b as any).zoneSize ?? 0) - ((a as any).zoneSize ?? 0))
        : [...symbols].sort((a, b) => ((b as any).usdtValue ?? 0) - ((a as any).usdtValue ?? 0));

      return { label, symbols: sorted, isZone: zone };
    })
    .sort((a, b) => b.symbols.length - a.symbols.length);
});

// ── MA bar stack (ma200 = orange, ma100 = blue, greater value on top) ───────

function hasZoneSize(symbol: any): boolean {
  const v = symbol?.zoneSize;
  return typeof v === 'number' && !Number.isNaN(v);
}

function hasMaData(symbol: any): boolean {
  const ma200 = symbol?.ma200;
  const ma100 = symbol?.ma100;
  const validMa200 = typeof ma200 === 'number' && !Number.isNaN(ma200) && ma200 > 0;
  const validMa100 = typeof ma100 === 'number' && !Number.isNaN(ma100) && ma100 > 0;
  return validMa200 || validMa100;
}

function maRows(symbol: any) {
  const ma200 = typeof symbol?.ma200 === 'number' ? symbol.ma200 : 0;
  const ma100 = typeof symbol?.ma100 === 'number' ? symbol.ma100 : 0;
  const max = Math.max(ma200, ma100) || 1;

  const rows = [
    { key: 'ma200', value: ma200, colorClass: 'is-ma200', widthPct: (ma200 / max) * 100 },
    { key: 'ma100', value: ma100, colorClass: 'is-ma100', widthPct: (ma100 / max) * 100 },
  ];

  // Whichever MA is larger renders as the top row.
  return rows.sort((a, b) => b.value - a.value);
}

function maTitle(symbol: any) {
  const ma200 = (symbol as any)?.ma200;
  const ma100 = (symbol as any)?.ma100;
  return `ma200: ${ma200 ?? '—'} · ma100: ${ma100 ?? '—'}`;
}

function formatMaValue(value: number) {
  if (!value) return '—';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(2) + 'K';
  return value.toFixed(4);
}

function formatZoneSize(value: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(2) + 'K';
  return value.toFixed(2);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function trendClass(trend?: string) {
  switch (trend) {
    case 'BULLISH': return 'is-bullish';
    case 'BEARISH': return 'is-bearish';
    default:        return 'is-neutral';
  }
}

function formatUsdt(value: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000)     return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}

// ── Entry history modal ───────────────────────────────────────────────────────

async function showEntryHistoryModal(symbol: string) {
  showEntryHistory.value = true;
  selectedSymbol.value = symbol;
  selectedSymbolCandleEntries.value = await klineDbUtility.getKlines(symbol);
}

async function shoutAvCrosses() {
  var newPositions = chocoMintoStore.futureSymbols.filter(c => c.positionSide);

  var message = "";

  if(newPositions.length > 0){
    message = `${newPositions.length} new positions detected!`

    // newPositions.forEach(async (futureSymbol) => {
    //   var side = futureSymbol.positionSide == "LONG" ? "BUY" : "SELL";
    //   await OrderMakerUtility.openOrder(futureSymbol.symbol,5,side,futureSymbol.tpPrice,futureSymbol.slPrice);
    // });
  }

  if (message && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();

    let count = 0;

    const speak = (_message:string) => {

      const utter = new SpeechSynthesisUtterance(_message);

      utter.rate = 1;
      utter.pitch = 1.2;
      utter.volume = 1;

      window.speechSynthesis.speak(utter);
    };

    speak(message);
  }
}

defineExpose({
  shoutAvCrosses
})
</script>

<style scoped>
.condition-board {
  font-family: inherit;
}

.condition-group {
  margin-bottom: 20px;
}

.group-header {
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

.group-header.is-zone-header {
  background: rgba(251, 146, 60, 0.1);
  color: #fb923c;
}

.group-label {
  text-transform: uppercase;
}

.group-count {
  margin-left: auto;
  font-weight: 400;
  opacity: 0.7;
  font-size: 0.85rem;
}

.symbol-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.range-empty { font-size: 0.85rem; opacity: 0.6; padding: 12px 0; }

.symbol-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  cursor: pointer;
  transition: background 0.15s ease;
}
.symbol-card:hover { background: rgba(127, 127, 127, 0.14); }

.symbol-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.symbol-name { font-weight: 600; font-size: 0.95rem; }
.usdt-value  { font-size: 0.8rem; opacity: 0.7; }

.symbol-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.trend-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.is-bullish { background: rgba(34, 197, 94, 0.15);  color: #22c55e; }
.is-bearish { background: rgba(239, 68, 68, 0.15);  color: #ef4444; }
.is-neutral { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }

/* ── Zone size tag ─────────────────────────────────────────────── */
.zone-size-value {
  font-size: 0.78rem;
  font-weight: 700;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
  color: #fb923c;
}

/* ── MA bar stack ──────────────────────────────────────────────── */
.ma-stack {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-left: auto;
  min-width: 150px;
}

.ma-stack-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ma-stack-label {
  font-size: 0.65rem;
  font-weight: 700;
  width: 38px;
  text-align: right;
  letter-spacing: 0.02em;
}

.ma-stack-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.15);
  overflow: hidden;
}

.ma-stack-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}

.ma-stack-value {
  font-size: 0.68rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  min-width: 44px;
  text-align: right;
}

.ma-stack-label.is-ma200,
.ma-stack-fill.is-ma200 { color: #fb923c; }
.ma-stack-fill.is-ma200 { background: #fb923c; }

.ma-stack-label.is-ma100,
.ma-stack-fill.is-ma100 { color: #3b82f6; }
.ma-stack-fill.is-ma100 { background: #3b82f6; }

.symbol-card.is-av-cross {
  background: rgba(251, 146, 60, 0.12);
  border: 1px solid rgba(251, 146, 60, 0.5);
}
.symbol-card.is-av-cross:hover {
  background: rgba(251, 146, 60, 0.2);
}

.symbol-card.is-recent-long {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.5);
}
.symbol-card.is-recent-long:hover {
  background: rgba(34, 197, 94, 0.2);
}

.symbol-card.is-recent-short {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.5);
}
.symbol-card.is-recent-short:hover {
  background: rgba(239, 68, 68, 0.2);
}

.av-cross-tag {
  color: #fb923c;
  font-weight: 700;
}
</style>