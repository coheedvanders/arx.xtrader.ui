<template>
  <div class="condition-board pa-md">
    <div class="preview-controls">
      <label class="preview-controls-label">
        Past candles
        <input
          type="number"
          min="1"
          class="preview-candles-input"
          v-model.number="pastCandlesCount"
        />
      </label>
      <button
        type="button"
        class="scan-preview-btn"
        :disabled="isScanningPreview"
        @click="scanCandlePreviews"
      >
        {{ isScanningPreview ? `Scanning… (${scanProgress.done}/${scanProgress.total})` : 'Scan Preview' }}
      </button>

      <label class="preview-controls-label">
        Order margin
        <input
          type="number"
          min="1"
          class="preview-candles-input"
          v-model.number="orderMargin"
        />
      </label>
    </div>

    <div
      v-for="group in groupedSymbols"
      :key="group.label"
      class="condition-group"
    >
      <div
        class="group-header"
        :class="group.isZone ? 'is-zone-header' : ''"
        @click="toggleGroup(group.label)"
      >
        <span class="group-chevron" :class="{ 'is-collapsed': isGroupCollapsed(group.label) }">▾</span>
        <span class="group-label">{{ group.label }}</span>
        <span class="group-count">{{ group.symbols.length }}</span>

        <div
          class="sentiment-bar"
          :title="`${groupSentiment(group.symbols).bullish} bulls · ${groupSentiment(group.symbols).bearish} bears · ${groupSentiment(group.symbols).neutral} neutral`"
        >
          <div class="sentiment-seg is-bullish" :style="{ width: groupSentiment(group.symbols).bullishPct + '%' }"></div>
          <div class="sentiment-seg is-neutral" :style="{ width: groupSentiment(group.symbols).neutralPct + '%' }"></div>
          <div class="sentiment-seg is-bearish" :style="{ width: groupSentiment(group.symbols).bearishPct + '%' }"></div>
        </div>
        <span class="sentiment-counts">
          <span class="is-bullish-text">{{ groupSentiment(group.symbols).bullish }}▲</span>
          /
          <span class="is-bearish-text">{{ groupSentiment(group.symbols).bearish }}▼</span>
        </span>
      </div>

      <div class="symbol-list" v-show="!isGroupCollapsed(group.label)">
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

            <div class="symbol-main-right">
              <span class="usdt-value">${{ formatUsdt((symbol as any).usdtValue) }}</span>

              <svg
                v-if="getCandlePreview(symbol.symbol).length"
                class="candle-preview-svg"
                :viewBox="`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`"
                preserveAspectRatio="none"
                @click.stop
              >
                <template v-for="c in candleGeometry(symbol.symbol)" :key="c.key">
                  <line
                    :x1="c.x" :y1="c.wickY1" :x2="c.x" :y2="c.wickY2"
                    class="candle-wick" :class="c.up ? 'is-up' : 'is-down'"
                  />
                  <rect
                    :x="c.bodyX" :y="c.bodyY" :width="c.bodyW" :height="c.bodyH"
                    class="candle-body" :class="c.up ? 'is-up' : 'is-down'"
                  />
                </template>
              </svg>
              <span v-else-if="isScanningPreview" class="candle-preview-placeholder">…</span>
            </div>
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

            <div class="order-actions" @click.stop>
              <button
                type="button"
                class="order-btn is-buy"
                :disabled="isPlacingOrder(symbol.symbol)"
                @click="placeOrder(symbol, 'BUY')"
              >
                {{ isPlacingOrder(symbol.symbol) ? '…' : 'Buy' }}
              </button>
              <button
                type="button"
                class="order-btn is-sell"
                :disabled="isPlacingOrder(symbol.symbol)"
                @click="placeOrder(symbol, 'SELL')"
              >
                {{ isPlacingOrder(symbol.symbol) ? '…' : 'Sell' }}
              </button>
            </div>
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
import { KlineUtility } from '@/utility/klineUtility';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility.ts';

interface Props {
  previewInterval?: string;
}

const props = withDefaults(defineProps<Props>(), {
  previewInterval: '15m',
});

const chocoMintoStore = useChocoMintoStore();

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([]);
const selectedSymbol = ref('');

// ── Collapsible condition groups ────────────────────────────────────────────

const collapsedGroups = ref(new Set<string>());

function toggleGroup(label: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(label)) {
    next.delete(label);
  } else {
    next.add(label);
  }
  collapsedGroups.value = next;
}

function isGroupCollapsed(label: string) {
  return collapsedGroups.value.has(label);
}

// ── Bulls / bears sentiment summary ─────────────────────────────────────────

function groupSentiment(symbols: any[]) {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const s of symbols) {
    if (s.trend === 'BULLISH') bullish++;
    else if (s.trend === 'BEARISH') bearish++;
    else neutral++;
  }

  const total = symbols.length || 1;

  return {
    bullish,
    bearish,
    neutral,
    bullishPct: (bullish / total) * 100,
    bearishPct: (bearish / total) * 100,
    neutralPct: (neutral / total) * 100,
  };
}

// ── Buy / Sell order actions ────────────────────────────────────────────────

const orderMargin = ref(5);
const placingOrder = ref(new Set<string>());

function isPlacingOrder(symbol: string) {
  return placingOrder.value.has(symbol);
}

async function placeOrder(symbol: any, side: 'BUY' | 'SELL') {
  const key = symbol.symbol;
  if (placingOrder.value.has(key)) return;

  placingOrder.value = new Set(placingOrder.value).add(key);

  try {
    await OrderMakerUtility.openOrder(
      symbol.symbol,
      orderMargin.value,
      side,
      0,
      0,
      2,
      1.5
    );
  } catch (e) {
    console.error(`Failed to open ${side} order for ${key}`, e);
    alert(`Failed to open ${side} order for ${key}: ${(e as Error).message}`);
  } finally {
    const next = new Set(placingOrder.value);
    next.delete(key);
    placingOrder.value = next;
  }
}

// ── Candle preview (Scan Preview) ───────────────────────────────────────────

const PREVIEW_WIDTH = 84;
const PREVIEW_HEIGHT = 28;
const PREVIEW_SCAN_CHUNK_SIZE = 8;

const pastCandlesCount = ref(20);
const isScanningPreview = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
const candlePreviews = ref(new Map<string, CandleEntry[]>());

function candleOpen(c: any): number { return c?.open ?? c?.o ?? 0; }
function candleHigh(c: any): number { return c?.high ?? c?.h ?? 0; }
function candleLow(c: any): number { return c?.low ?? c?.l ?? 0; }
function candleClose(c: any): number { return c?.close ?? c?.c ?? 0; }

function getCandlePreview(symbol: string): CandleEntry[] {
  return candlePreviews.value.get(symbol) ?? [];
}

async function scanCandlePreviews() {
  if (isScanningPreview.value) return;

  const n = Math.max(1, Math.floor(pastCandlesCount.value) || 20);
  const symbols = Array.from(new Set(groupedSymbols.value.flatMap(g => g.symbols.map((s: any) => s.symbol))));

  isScanningPreview.value = true;
  scanProgress.value = { done: 0, total: symbols.length };

  try {
    for (let i = 0; i < symbols.length; i += PREVIEW_SCAN_CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + PREVIEW_SCAN_CHUNK_SIZE);

      await Promise.all(chunk.map(async (sym) => {
        try {
          const klines = await KlineUtility.getRecentKlines(sym, props.previewInterval, n);
          candlePreviews.value.set(sym, klines ?? []);
        } catch (e) {
          console.error(`Failed to load candle preview for ${sym}`, e);
        } finally {
          scanProgress.value = { ...scanProgress.value, done: scanProgress.value.done + 1 };
        }
      }));
    }
  } finally {
    isScanningPreview.value = false;
  }
}

function candleGeometry(symbol: string) {
  const candles = getCandlePreview(symbol);
  if (!candles.length) return [];

  const highs = candles.map(candleHigh);
  const lows = candles.map(candleLow);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = (max - min) || 1;

  const slotWidth = PREVIEW_WIDTH / candles.length;
  const bodyWidth = Math.max(1, slotWidth * 0.6);
  const yFor = (price: number) => PREVIEW_HEIGHT - ((price - min) / range) * PREVIEW_HEIGHT;

  return candles.map((c, i) => {
    const o = candleOpen(c);
    const h = candleHigh(c);
    const l = candleLow(c);
    const cl = candleClose(c);
    const up = cl >= o;

    const x = i * slotWidth + slotWidth / 2;
    const bodyTop = yFor(Math.max(o, cl));
    const bodyBottom = yFor(Math.min(o, cl));

    return {
      key: i,
      x,
      wickY1: yFor(h),
      wickY2: yFor(l),
      bodyX: x - bodyWidth / 2,
      bodyY: bodyTop,
      bodyW: bodyWidth,
      bodyH: Math.max(1, bodyBottom - bodyTop),
      up,
    };
  });
}

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
  var recentVovs = chocoMintoStore.futureSymbols.filter(c => c.conditionMet == "RECENT_VOVS");

  var message = "";

  if(recentVovs.length > 0){
    message = `${recentVovs.length} recent VOVS detected!`
  }

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
    speak(message);
  }
}

defineExpose({
  shoutAvCrosses,
  scanCandlePreviews,
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
  cursor: pointer;
  user-select: none;
}

.group-chevron {
  display: inline-block;
  font-size: 0.75rem;
  opacity: 0.7;
  transition: transform 0.15s ease;
}
.group-chevron.is-collapsed {
  transform: rotate(-90deg);
}

/* ── Bulls/bears sentiment bar ─────────────────────────────────── */
.sentiment-bar {
  display: flex;
  width: 90px;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.15);
  flex-shrink: 0;
}

.sentiment-seg {
  height: 100%;
}
.sentiment-seg.is-bullish { background: #22c55e; }
.sentiment-seg.is-bearish { background: #ef4444; }
.sentiment-seg.is-neutral { background: #94a3b8; }

.sentiment-counts {
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
.is-bullish-text { color: #22c55e; }
.is-bearish-text { color: #ef4444; }

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

/* ── Preview controls toolbar ─────────────────────────────────────────── */
.preview-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.08);
}

.preview-controls-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  opacity: 0.85;
}

.preview-candles-input {
  width: 64px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  background: rgba(127, 127, 127, 0.06);
  color: inherit;
  font-size: 0.85rem;
}

.scan-preview-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  font-weight: 600;
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s ease;
}
.scan-preview-btn:hover:not(:disabled) { background: rgba(59, 130, 246, 0.25); }
.scan-preview-btn:disabled { opacity: 0.6; cursor: default; }

/* ── Mini candle preview ──────────────────────────────────────────────── */
.symbol-main-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.candle-preview-svg {
  width: 84px;
  height: 28px;
  display: block;
}

.candle-preview-placeholder {
  font-size: 0.75rem;
  opacity: 0.4;
  width: 84px;
  text-align: center;
}

.candle-wick { stroke-width: 1; }
.candle-wick.is-up { stroke: #22c55e; }
.candle-wick.is-down { stroke: #ef4444; }

.candle-body.is-up { fill: #22c55e; }
.candle-body.is-down { fill: #ef4444; }

/* ── Buy / Sell order actions ─────────────────────────────────────────── */
.order-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.order-btn {
  padding: 4px 14px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s ease;
}
.order-btn:disabled { opacity: 0.6; cursor: default; }

.order-btn.is-buy {
  border: 1px solid rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}
.order-btn.is-buy:hover:not(:disabled) { background: rgba(34, 197, 94, 0.28); }

.order-btn.is-sell {
  border: 1px solid rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.order-btn.is-sell:hover:not(:disabled) { background: rgba(239, 68, 68, 0.28); }
</style>