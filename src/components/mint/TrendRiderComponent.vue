<template>
  <div class="trend-board pa-md">
    <div class="sentiment-banner" :class="sentimentClass">
      <div class="sentiment-label">MARKET: {{ sentimentLabel }}</div>
      <div class="sentiment-reason">{{ sentimentReason }}</div>
    </div>

    <div class="summary-row">
      <div class="summary-col">
        <div class="summary-title">trend</div>
        <div v-for="row in trendCounts" :key="row.label" class="summary-line">
          <span class="summary-label" :class="summaryColorClass(row.label)">{{ row.label }}</span>
          <div class="summary-bar-track">
            <div
              class="summary-bar-fill"
              :class="summaryColorClass(row.label)"
              :style="{ width: summaryBarWidth(row.count, trendCounts) + '%' }"
            ></div>
          </div>
          <span class="summary-count">{{ row.count }}</span>
        </div>
      </div>
      <div class="summary-col">
        <div class="summary-title">lookbackTrend</div>
        <div v-for="row in lookbackTrendCounts" :key="row.label" class="summary-line">
          <span class="summary-label" :class="summaryColorClass(row.label)">{{ row.label }}</span>
          <div class="summary-bar-track">
            <div
              class="summary-bar-fill"
              :class="summaryColorClass(row.label)"
              :style="{ width: summaryBarWidth(row.count, lookbackTrendCounts) + '%' }"
            ></div>
          </div>
          <span class="summary-count">{{ row.count }}</span>
        </div>
      </div>
    </div>

    <div class="summary-row">
      <div class="summary-col summary-col-wide">
        <div class="summary-title">change %</div>
        <div
          v-for="row in changeRangeCounts"
          :key="row.label"
          class="summary-line summary-line-clickable"
          @click="selectChangeRange(row)"
        >
          <span class="summary-label" :class="row.colorClass">{{ row.label }}</span>
          <div class="summary-bar-track">
            <div
              class="summary-bar-fill"
              :class="row.colorClass"
              :style="{ width: summaryBarWidth(row.count, changeRangeCounts) + '%' }"
            ></div>
          </div>
          <span class="summary-count">{{ row.count }}</span>
        </div>
      </div>
    </div>

    <!-- Z-score spike summary -->
    <div class="summary-row">
      <div class="summary-col summary-col-wide">
        <div class="summary-title">z-score spikes (|z| ≥ 3, last candle)</div>
        <div
          v-for="row in zScoreGroupCounts"
          :key="row.label"
          class="summary-line summary-line-clickable"
          @click="selectZScoreGroup(row.label)"
        >
          <span class="summary-label" :class="row.colorClass">{{ row.label }}</span>
          <div class="summary-bar-track">
            <div
              class="summary-bar-fill"
              :class="row.colorClass"
              :style="{ width: summaryBarWidth(row.count, zScoreGroupCounts) + '%' }"
            ></div>
          </div>
          <span class="summary-count">{{ row.count }}</span>
        </div>
      </div>
    </div>

    <!-- Symbols sorted by g1CandleCount, descending -->
    <div class="summary-row">
      <div class="summary-col summary-col-wide">
        <div class="summary-title">symbols by g1CandleCount (desc)</div>
        <div class="range-symbol-list">
          <div
            v-for="symbol in symbolsByG1CandleCount"
            :key="symbol.symbol"
            class="symbol-card"
            @click="showEntryHistoryModal(symbol.symbol)"
          >
            <div class="symbol-main">
              <span class="symbol-name">{{ symbol.symbol }}</span>
              <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
            </div>

            <div class="symbol-meta">
              <span class="trend-badge" :class="trendClass(symbol.trend)">
                {{ symbol.trend }}
              </span>
              <span class="g1-count-value">g1: {{ (symbol as any).g1CandleCount }}</span>
            </div>
          </div>

          <div v-if="!symbolsByG1CandleCount.length" class="range-empty">No symbols.</div>
        </div>
      </div>
    </div>

    <!-- ── Wall range fetch trigger + progress (bearish/bullish only) ────── -->
    <div class="wall-fetch-bar">
      <button
        class="wall-fetch-btn"
        :disabled="wallFetchInProgress || wallFetchAllInProgress"
        @click="fetchWallRanges"
      >
        {{ wallFetchInProgress ? 'Fetching walls…' : 'Get Wall Ranges' }}
      </button>

      <button
        class="wall-fetch-btn wall-fetch-btn-alt"
        :disabled="wallFetchInProgress || wallFetchAllInProgress"
        @click="fetchAllWallRanges"
      >
        {{ wallFetchAllInProgress ? 'Fetching all walls…' : 'Get All Wall Ranges' }}
      </button>

      <div v-if="wallFetchInProgress" class="wall-progress">
        <div class="wall-progress-track">
          <div class="wall-progress-fill" :style="{ width: wallFetchPercent + '%' }"></div>
        </div>
        <span class="wall-progress-label">{{ wallFetchProgress }} / {{ wallFetchTotal }}</span>
      </div>

      <div v-if="wallFetchAllInProgress" class="wall-progress">
        <div class="wall-progress-track">
          <div class="wall-progress-fill" :style="{ width: wallFetchAllPercent + '%' }"></div>
        </div>
        <span class="wall-progress-label">{{ wallFetchAllProgress }} / {{ wallFetchAllTotal }}</span>
      </div>

      <button
        class="wall-sort-btn"
        :class="{ active: sortByWallRange }"
        @click="toggleSortByWallRange"
      >
        {{ sortByWallRange ? 'Sorted by wall range ✓' : 'Sort by wall range' }}
      </button>
    </div>

    <!-- All symbols by wall range, auto-sorted desc -->
    <div class="summary-row">
      <div class="summary-col summary-col-wide">
        <div class="summary-title">all symbols by wall range % (desc)</div>
        <div class="range-symbol-list">
          <div
            v-for="symbol in allSymbolsByWallRange"
            :key="symbol.symbol"
            class="symbol-card"
            @click="showEntryHistoryModal(symbol.symbol)"
          >
            <div class="symbol-main">
              <span class="symbol-name">{{ symbol.symbol }}</span>
              <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
            </div>

            <div class="symbol-meta">
              <span class="trend-badge" :class="trendClass(symbol.trend)">
                {{ symbol.trend }}
              </span>
              <span class="change-value" :class="summaryColorClass(symbol.trend)">
                <template v-if="wallThicknessPct(symbol) !== null">
                  {{ wallThicknessPct(symbol)!.toFixed(2) }}%
                </template>
                <template v-else>—</template>
              </span>
            </div>
          </div>

          <div v-if="!allSymbolsByWallRange.length" class="range-empty">No symbols.</div>
        </div>
      </div>
    </div>

    <div class="row">
      <!-- BEARISH column -->
      <div class="col-md-6">
        <div class="actions">
          <button class="ride-btn buy" @click="rideTrend('BEARISH','BUY')">Buy</button>
          <button class="ride-btn" @click="rideTrend('BEARISH','SELL')">Sell</button>
          <button @click="shoutMarketSentiment">Check Changes</button>
        </div>
        <div class="col-header bearish">
          <span class="dot bearish-dot"></span>
          BEARISH
          <span class="count">{{ bearishSymbols.length }} / {{ chocoMintoStore.futureSymbols.length }}</span>
        </div>

        <div class="symbol-list">
          <div
            v-for="symbol in bearishSymbols"
            :key="symbol.symbol"
            class="symbol-card"
            @click="showEntryHistoryModal(symbol.symbol)"
          >
            <div class="symbol-main">
              <span class="symbol-name">{{ symbol.symbol }} <span v-if="symbol.crossedMa">(x)</span></span>
              <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
            </div>

            <div class="symbol-meta">
              <span class="trend-badge" :class="trendClass(symbol.trend)">
                <template v-if="wallThicknessPct(symbol) !== null">({{ wallThicknessPct(symbol)!.toFixed(2) }}%)</template>
                <template v-else>(—)</template>
                {{ symbol.trend }} - {{ symbol.g1CandleCount }}
              </span>

              <div class="lookback-row" v-if="symbol.lookbackTrend?.length">
                <span
                  v-for="(t, i) in symbol.lookbackTrend"
                  :key="i"
                  class="lookback-dot"
                  :class="trendClass(t)"
                  :title="t"
                ></span>
              </div>

              <!-- Structure mini bars -->
              <div
                class="structure-mini"
                :title="`${(symbol as any).candlesAboveCount} above / ${(symbol as any).candlesBelowCount} below`"
              >
                <div class="structure-mini-row">
                  <span class="structure-mini-label-text">↑</span>
                  <div class="structure-mini-track">
                    <div
                      class="structure-mini-fill is-strong-bull"
                      :style="{ width: (symbol as any).candlesAboveCount + '%' }"
                    ></div>
                  </div>
                  <span class="structure-mini-count">{{ (symbol as any).candlesAboveCount }}</span>
                </div>
                <div class="structure-mini-row">
                  <span class="structure-mini-label-text">↓</span>
                  <div class="structure-mini-track">
                    <div
                      class="structure-mini-fill is-strong-bear"
                      :style="{ width: (symbol as any).candlesBelowCount + '%' }"
                    ></div>
                  </div>
                  <span class="structure-mini-count">{{ (symbol as any).candlesBelowCount }}</span>
                </div>
              </div>

              <!-- Z-score spike badge -->
              <div
                v-if="hasZScoreSpike(symbol)"
                class="zscore-spike-badge"
                :class="zScoreSpikeClass(symbol)"
                :title="`change ${zScoreChangePct(symbol)?.toFixed(2)}% · z-score ${zScoreValue(symbol)?.toFixed(2)}`"
                @click.stop="showEntryHistoryModal(symbol.symbol)"
              >
                <span class="zscore-spike-icon">
                  {{ zScoreSpikeClass(symbol) === 'is-strong-bull' ? '▲' : '▼' }}
                </span>
                <span class="zscore-spike-text">
                  {{ (zScoreChangePct(symbol) ?? 0) >= 0 ? '+' : '' }}{{ zScoreChangePct(symbol)?.toFixed(2) }}%
                </span>
                <span class="zscore-spike-z">z{{ zScoreValue(symbol)?.toFixed(1) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- BULLISH column -->
      <div class="col-md-6">
        <div class="actions">
          <button class="ride-btn buy" @click="rideTrend('BULLISH','BUY')">Buy</button>
          <button class="ride-btn" @click="rideTrend('BULLISH','SELL')">Sell</button>
          <button >Check Changes</button>
        </div>
        <div class="col-header bullish">
          <span class="dot bullish-dot"></span>
          BULLISH
          <span class="count">{{ bullishSymbols.length }} / {{ chocoMintoStore.futureSymbols.length }}</span>
        </div>

        <div class="symbol-list">
          <div
            v-for="symbol in bullishSymbols"
            :key="symbol.symbol"
            class="symbol-card"
            @click="showEntryHistoryModal(symbol.symbol)"
          >
            <div class="symbol-main">
              <span class="symbol-name">{{ symbol.symbol }} <span v-if="symbol.crossedMa">(x)</span></span>
              <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
            </div>

            <div class="symbol-meta">
              <span class="trend-badge" :class="trendClass(symbol.trend)">
                <template v-if="wallThicknessPct(symbol) !== null">({{ wallThicknessPct(symbol)!.toFixed(2) }}%)</template>
                <template v-else>(—)</template>
                {{ symbol.trend }} - {{ symbol.g1CandleCount }}
              </span>

              <div class="lookback-row" v-if="symbol.lookbackTrend?.length">
                <span
                  v-for="(t, i) in symbol.lookbackTrend"
                  :key="i"
                  class="lookback-dot"
                  :class="trendClass(t)"
                  :title="t"
                ></span>
              </div>

              <!-- Z-score spike badge -->
              <div
                v-if="hasZScoreSpike(symbol)"
                class="zscore-spike-badge"
                :class="zScoreSpikeClass(symbol)"
                :title="`change ${zScoreChangePct(symbol)?.toFixed(2)}% · z-score ${zScoreValue(symbol)?.toFixed(2)}`"
                @click.stop="showEntryHistoryModal(symbol.symbol)"
              >
                <span class="zscore-spike-icon">
                  {{ zScoreSpikeClass(symbol) === 'is-strong-bull' ? '▲' : '▼' }}
                </span>
                <span class="zscore-spike-text">
                  {{ (zScoreChangePct(symbol) ?? 0) >= 0 ? '+' : '' }}{{ zScoreChangePct(symbol)?.toFixed(2) }}%
                </span>
                <span class="zscore-spike-z">z{{ zScoreValue(symbol)?.toFixed(1) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <DialogComponent v-model="showEntryHistory" :width="'95vw'">
    <DialogHeaderComponent>
      {{ selectedSymbol }}
    </DialogHeaderComponent>
    <CandleEntryHistoryComponent :symbol="selectedSymbol" :candle-entries="selectedSymbolCandleEntries" />
  </DialogComponent>

  <DialogComponent v-model="showRangeModal" :width="'95vw'">
    <DialogHeaderComponent>
      change % {{ selectedRange?.label }} ({{ rangeSymbols.length }})
    </DialogHeaderComponent>
    <div class="range-symbol-list">
      <div
        v-for="symbol in rangeSymbols"
        :key="symbol.symbol"
        class="symbol-card"
        @click="showEntryHistoryModal(symbol.symbol)"
      >
        <div class="symbol-main">
          <span class="symbol-name">{{ symbol.symbol }}</span>
          <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
        </div>

        <div class="symbol-meta">
          <span class="trend-badge" :class="trendClass(symbol.trend)">
            {{ symbol.trend }}
          </span>
          <span class="change-value" :class="(symbol as any).change >= 0 ? 'is-strong-bull' : 'is-strong-bear'">
            {{ (symbol as any).change >= 0 ? '+' : '' }}{{ (symbol as any).change?.toFixed(2) }}% - {{ symbol.g1CandleCount }}
          </span>
        </div>
      </div>

      <div v-if="!rangeSymbols.length" class="range-empty">No symbols in this range.</div>
    </div>
  </DialogComponent>

  <DialogComponent v-model="showZScoreModal" :width="'95vw'">
    <DialogHeaderComponent>
      z-score spikes — {{ selectedZScoreGroup }} ({{ zScoreGroupSymbols.length }})
    </DialogHeaderComponent>
    <div class="range-symbol-list">
      <div
        v-for="symbol in zScoreGroupSymbols"
        :key="symbol.symbol"
        class="symbol-card"
        @click="showEntryHistoryModal(symbol.symbol)"
      >
        <div class="symbol-main">
          <span class="symbol-name">{{ symbol.symbol }}</span>
          <span class="usdt-value">${{ formatUsdt(symbol.usdtValue) }}</span>
        </div>

        <div class="symbol-meta">
          <span class="trend-badge" :class="trendClass(symbol.trend)">
            {{ symbol.trend }}
          </span>
          <span class="change-value" :class="zScoreSpikeClass(symbol)">
            {{ (zScoreChangePct(symbol) ?? 0) >= 0 ? '+' : '' }}{{ zScoreChangePct(symbol)?.toFixed(2) }}%
          </span>
          <span class="zscore-spike-z">z{{ zScoreValue(symbol)?.toFixed(2) }}</span>
        </div>
      </div>

      <div v-if="!zScoreGroupSymbols.length" class="range-empty">No symbols in this group.</div>
    </div>
  </DialogComponent>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import type { CandleEntry } from '@/core/interfaces.ts';
import { klineDbUtility } from '@/utility/klineDbUtility';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility.ts';
import { useNotificationStore } from '@/stores/notificationStore.ts';
// NOTE: adjust this import path to wherever candleAnalyzer actually lives in your project
import { candleAnalyzer } from '@/utility/candleAnalyzerUtility.ts';

const chocoMintoStore = useChocoMintoStore();
const notificationStore = useNotificationStore();

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([]);
const selectedSymbol = ref('');

// ── Symbol lists ──────────────────────────────────────────────────────────────

const sortByWallRange = ref(false);

function toggleSortByWallRange() {
  sortByWallRange.value = !sortByWallRange.value;
}

/** Nulls (no wall data fetched yet) always sort to the bottom, widest range first. */
function byWallRangeDesc(a: any, b: any) {
  const aVal = wallThicknessPct(a);
  const bVal = wallThicknessPct(b);
  if (aVal === null && bVal === null) return 0;
  if (aVal === null) return 1;
  if (bVal === null) return -1;
  return bVal - aVal;
}

const bearishSymbols = computed(() => {
  const symbols = chocoMintoStore.futureSymbols.filter(s => s.conditionMet === 'BEARISH');
  if (sortByWallRange.value) return symbols.sort(byWallRangeDesc);
  return symbols.sort((a, b) => (a as any).candlesAboveCount - (b as any).candlesAboveCount); // lowest above = most structurally bearish
});

const bullishSymbols = computed(() => {
  const symbols = chocoMintoStore.futureSymbols.filter(s => s.conditionMet === 'BULLISH');
  if (sortByWallRange.value) return symbols.sort(byWallRangeDesc);
  return symbols.sort((a, b) => (b as any).candlesAboveCount - (a as any).candlesAboveCount); // highest above = most structurally bullish
});

// Symbols sorted by g1CandleCount, descending (all symbols, not just bearish/bullish)
const symbolsByG1CandleCount = computed(() =>
  [...chocoMintoStore.futureSymbols].sort(
    (a, b) => ((b as any).g1CandleCount ?? 0) - ((a as any).g1CandleCount ?? 0)
  )
);

// All symbols sorted by wall range %, descending (nulls last)
const allSymbolsByWallRange = computed(() =>
  [...chocoMintoStore.futureSymbols].sort(byWallRangeDesc)
);

// ── Ride trend ────────────────────────────────────────────────────────────────

async function rideTrend(side: string, position: string) {
  const symbols =
    side === 'BEARISH'
      ? bearishSymbols.value.slice(0, 10)
      : bullishSymbols.value.slice(0, 10);

  for (const s of symbols) {
    try {
      await OrderMakerUtility.openOrder(s.symbol, chocoMintoStore.orderCost, position, 0, 0);
    } catch (e) {}
  }
}

// ── Wall range fetching (bearish + bullish symbols only, rate-limited) ────────

const WALL_FETCH_INTERVAL_MS = 2000;

const wallFetchInProgress = ref(false);
const wallFetchProgress = ref(0);
const wallFetchTotal = ref(0);

const wallFetchPercent = computed(() => {
  if (!wallFetchTotal.value) return 0;
  return Math.round((wallFetchProgress.value / wallFetchTotal.value) * 100);
});

let wallFetchCancelled = false;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWallRanges() {
  if (wallFetchInProgress.value || wallFetchAllInProgress.value) return;

  // Only symbols currently classified bearish or bullish — skip neutral.
  const targets = [...bearishSymbols.value, ...bullishSymbols.value];
  if (!targets.length) return;

  wallFetchCancelled = false;
  wallFetchInProgress.value = true;
  wallFetchProgress.value = 0;
  wallFetchTotal.value = targets.length;

  try {
    for (const symbol of targets) {
      if (wallFetchCancelled) break;

      try {
        const { largestBidWall, lowestAskWall } = await candleAnalyzer.getBidAskWall(symbol.symbol);
        (symbol as any).bidWall = largestBidWall?.price ?? null;
        (symbol as any).askWall = lowestAskWall?.price ?? null;
      } catch (e) {
        console.error(`Failed to fetch wall range for ${symbol.symbol}:`, e);
      }

      wallFetchProgress.value++;

      // Rate-limit to 1 call / 2s, skip the wait after the final symbol.
      if (!wallFetchCancelled && wallFetchProgress.value < wallFetchTotal.value) {
        await sleep(WALL_FETCH_INTERVAL_MS);
      }
    }
  } finally {
    wallFetchInProgress.value = false;
  }
}

// ── Wall range fetching (ALL symbols, rate-limited, 2s per call) ─────────────

const wallFetchAllInProgress = ref(false);
const wallFetchAllProgress = ref(0);
const wallFetchAllTotal = ref(0);

const wallFetchAllPercent = computed(() => {
  if (!wallFetchAllTotal.value) return 0;
  return Math.round((wallFetchAllProgress.value / wallFetchAllTotal.value) * 100);
});

let wallFetchAllCancelled = false;

async function fetchAllWallRanges() {
  if (wallFetchAllInProgress.value || wallFetchInProgress.value) return;

  const targets = [...chocoMintoStore.futureSymbols];
  if (!targets.length) return;

  wallFetchAllCancelled = false;
  wallFetchAllInProgress.value = true;
  wallFetchAllProgress.value = 0;
  wallFetchAllTotal.value = targets.length;

  try {
    for (const symbol of targets) {
      if (wallFetchAllCancelled) break;

      try {
        const { largestBidWall, lowestAskWall } = await candleAnalyzer.getBidAskWall(symbol.symbol);
        (symbol as any).bidWall = largestBidWall?.price ?? null;
        (symbol as any).askWall = lowestAskWall?.price ?? null;
      } catch (e) {
        console.error(`Failed to fetch wall range for ${symbol.symbol}:`, e);
      }

      wallFetchAllProgress.value++;

      // Rate-limit to 1 call / 2s, skip the wait after the final symbol.
      if (!wallFetchAllCancelled && wallFetchAllProgress.value < wallFetchAllTotal.value) {
        await sleep(WALL_FETCH_INTERVAL_MS);
      }
    }
  } finally {
    wallFetchAllInProgress.value = false;
  }
}

onUnmounted(() => {
  wallFetchCancelled = true;
  wallFetchAllCancelled = true;
});

/**
 * "Thickness" of the wall gap as a percentage of the bid/ask midpoint.
 * Using the midpoint (rather than bidWall alone) keeps the % symmetric
 * regardless of which side happens to be the smaller number.
 */
function wallThicknessPct(symbol: any): number | null {
  const bid = symbol?.bidWall;
  const ask = symbol?.askWall;
  if (typeof bid !== 'number' || typeof ask !== 'number' || bid <= 0 || ask <= 0) return null;
  const mid = (ask + bid) / 2;
  if (!mid) return null;
  return Math.abs((ask - bid) / mid) * 100;
}

// ── Generic distinct counter ──────────────────────────────────────────────────

function countDistinct(values: unknown[]): { label: string; count: number }[] {
  const flat: unknown[] = [];
  for (const v of values) {
    if (Array.isArray(v)) flat.push(...v);
    else flat.push(v);
  }

  const map = new Map<string, number>();
  for (const v of flat) {
    const key =
      v === null || v === undefined
        ? String(v)
        : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

const trendCounts = computed(() =>
  countDistinct(chocoMintoStore.futureSymbols.map(s => (s as any).trend))
);

const lookbackTrendCounts = computed(() =>
  countDistinct(chocoMintoStore.futureSymbols.map(s => (s as any).lookbackTrend))
);

// ── Color helpers ─────────────────────────────────────────────────────────────

function summaryColorClass(label: string) {
  const key = label;
  if (key === 'bullish' || key === 'strong_uptrend') return 'is-strong-bull';
  if (key === 'mild_uptrend') return 'is-mild-bull';
  if (key === 'bearish' || key === 'strong_downtrend') return 'is-strong-bear';
  if (key === 'mild_downtrend') return 'is-mild-bear';
  return 'is-neutral-summary';
}

function summaryBarWidth(count: number, rows: { count: number }[]) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  if (!max) return 0;
  return (count / max) * 100;
}

function trendClass(trend?: string) {
  switch (trend) {
    case 'BULLISH': return 'is-bullish';
    case 'BEARISH': return 'is-bearish';
    default:        return 'is-neutral';
  }
}

function formatUsdt(value: number) {
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

// ── Change % ranges ───────────────────────────────────────────────────────────

type ChangeRange = { label: string; min: number; max: number; colorClass: string };

const CHANGE_RANGES: ChangeRange[] = [
  { label: '< -5%',       min: -Infinity, max: -5,       colorClass: 'is-strong-bear'     },
  { label: '-5% to -2%',  min: -5,        max: -2,       colorClass: 'is-strong-bear'     },
  { label: '-2% to -1%',  min: -2,        max: -1,       colorClass: 'is-mild-bear'       },
  { label: '-1% to 0%',   min: -1,        max: 0,        colorClass: 'is-mild-bear'       },
  { label: '0% to 1%',    min: 0,         max: 1,        colorClass: 'is-mild-bull'       },
  { label: '1% to 2%',    min: 1,         max: 2,        colorClass: 'is-mild-bull'       },
  { label: '2% to 5%',    min: 2,         max: 5,        colorClass: 'is-strong-bull'     },
  { label: '> 5%',        min: 5,         max: Infinity, colorClass: 'is-strong-bull'     },
];

const changeRangeCounts = computed(() => {
  const buckets = CHANGE_RANGES.map(r => ({ ...r, count: 0 }));
  for (const s of chocoMintoStore.futureSymbols) {
    const change = (s as any).change;
    if (typeof change !== 'number' || Number.isNaN(change)) continue;
    const bucket = buckets.find(b => change >= b.min && change < b.max);
    if (bucket) bucket.count++;
  }
  return buckets;
});

const showRangeModal = ref(false);
const selectedRange = ref<ChangeRange | null>(null);

function selectChangeRange(range: ChangeRange) {
  selectedRange.value = range;
  showRangeModal.value = true;
}

const rangeSymbols = computed(() => {
  if (!selectedRange.value) return [];
  const { min, max } = selectedRange.value;
  return chocoMintoStore.futureSymbols
    .filter(s => {
      const change = (s as any).change;
      return typeof change === 'number' && !Number.isNaN(change) && change >= min && change < max;
    })
    .sort((a, b) => (b as any).change - (a as any).change);
});

// ── Market structure (candlesAboveCount / 100) ────────────────────────────────
// Buckets symbols by how many of the last 100 candles closed above the
// reference level. 0–20 = deeply bearish structure, 80–100 = deeply bullish.

type StructureRange = { label: string; min: number; max: number; colorClass: string };

const STRUCTURE_RANGES: StructureRange[] = [
  { label: '0–20  (strongly bearish)',  min: 0,  max: 20,  colorClass: 'is-strong-bear'     },
  { label: '20–40 (leaning bearish)',   min: 20, max: 40,  colorClass: 'is-mild-bear'       },
  { label: '40–60 (neutral / ranging)', min: 40, max: 60,  colorClass: 'is-neutral-summary' },
  { label: '60–80 (leaning bullish)',   min: 60, max: 80,  colorClass: 'is-mild-bull'       },
  { label: '80–100 (strongly bullish)', min: 80, max: 101, colorClass: 'is-strong-bull'     },
];

const structureRangeCounts = computed(() => {
  const buckets = STRUCTURE_RANGES.map(r => ({ ...r, count: 0 }));
  for (const s of chocoMintoStore.futureSymbols) {
    const above = (s as any).candlesAboveCount;
    if (typeof above !== 'number' || Number.isNaN(above)) continue;
    const bucket = buckets.find(b => above >= b.min && above < b.max);
    if (bucket) bucket.count++;
  }
  return buckets;
});

// Market-wide average: what % of the last 100 candles across ALL symbols are above
const aggregateAbovePct = computed(() => {
  const symbols = chocoMintoStore.futureSymbols;
  if (!symbols.length) return 50;
  const total = symbols.reduce((sum, s) => {
    const above = (s as any).candlesAboveCount;
    return sum + (typeof above === 'number' && !Number.isNaN(above) ? above : 50);
  }, 0);
  return total / symbols.length;
});

function structureMiniClass(candlesAbove: number) {
  if (candlesAbove >= 80) return 'is-strong-bull';
  if (candlesAbove >= 60) return 'is-mild-bull';
  if (candlesAbove >= 40) return 'is-neutral-summary';
  if (candlesAbove >= 20) return 'is-mild-bear';
  return 'is-strong-bear';
}

// ── Z-score spike detection (lastCandle.candleData.changePercentageZScore) ────
// Flags symbols whose most recent candle has an unusually large change
// (|z| >= 3), grouped into bull/bear based on the sign of the change %.

function hasZScoreSpike(symbol: any): boolean {
  const z = symbol?.changeZScore;
  return typeof z === 'number' && !Number.isNaN(z) && z >= 3;
}

function zScoreValue(symbol: any): number | undefined {
  const z = symbol?.changeZScore;
  return typeof z === 'number' && !Number.isNaN(z) ? z : undefined;
}

function zScoreChangePct(symbol: any): number | undefined {
  const change = symbol?.changeZScore;
  return typeof change === 'number' && !Number.isNaN(change) ? change : undefined;
}

function zScoreSpikeClass(symbol: any): string {
  const change = zScoreChangePct(symbol);
  return typeof change === 'number' && change >= 0 ? 'is-strong-bull' : 'is-strong-bear';
}

const zScoreSpikeSymbols = computed(() =>
  chocoMintoStore.futureSymbols.filter(s => hasZScoreSpike(s))
);

const zScoreBullSymbols = computed(() =>
  zScoreSpikeSymbols.value
    .filter(s => (zScoreChangePct(s) ?? 0) >= 0)
    .sort((a, b) => (zScoreChangePct(b) ?? 0) - (zScoreChangePct(a) ?? 0))
);

const zScoreBearSymbols = computed(() =>
  zScoreSpikeSymbols.value
    .filter(s => (zScoreChangePct(s) ?? 0) < 0)
    .sort((a, b) => (zScoreChangePct(a) ?? 0) - (zScoreChangePct(b) ?? 0))
);

const zScoreGroupCounts = computed(() => [
  { label: 'Bull spikes', count: zScoreBullSymbols.value.length, colorClass: 'is-strong-bull' },
  { label: 'Bear spikes', count: zScoreBearSymbols.value.length, colorClass: 'is-strong-bear' },
]);

const showZScoreModal = ref(false);
const selectedZScoreGroup = ref<'Bull spikes' | 'Bear spikes' | ''>('');

function selectZScoreGroup(label: string) {
  selectedZScoreGroup.value = label as 'Bull spikes' | 'Bear spikes';
  showZScoreModal.value = true;
}

const zScoreGroupSymbols = computed(() => {
  if (selectedZScoreGroup.value === 'Bull spikes') return zScoreBullSymbols.value;
  if (selectedZScoreGroup.value === 'Bear spikes') return zScoreBearSymbols.value;
  return [];
});

// ── Market sentiment ──────────────────────────────────────────────────────────

function countOf(rows: { label: string; count: number }[], label: string) {
  return rows.find(r => r.label.toLowerCase() === label.toLowerCase())?.count ?? 0;
}

const sentimentScore = computed(() => {
  // trend vote
  const bearishTrend = countOf(trendCounts.value, 'bearish');
  const bullishTrend = countOf(trendCounts.value, 'bullish');
  const trendTotal   = bearishTrend + bullishTrend;
  const trendVote    = trendTotal ? (bullishTrend - bearishTrend) / trendTotal : 0;

  // lookbackTrend vote (strong moves weighted 2×)
  const strongDown   = countOf(lookbackTrendCounts.value, 'strong_downtrend');
  const mildDown     = countOf(lookbackTrendCounts.value, 'mild_downtrend');
  const strongUp     = countOf(lookbackTrendCounts.value, 'strong_uptrend');
  const mildUp       = countOf(lookbackTrendCounts.value, 'mild_uptrend');
  const downScore    = strongDown * 2 + mildDown;
  const upScore      = strongUp   * 2 + mildUp;
  const lookbackTotal = downScore + upScore;
  const lookbackVote = lookbackTotal ? (upScore - downScore) / lookbackTotal : 0;

  // live symbol count vote
  const bCount     = bearishSymbols.value.length;
  const bullCount  = bullishSymbols.value.length;
  const countTotal = bCount + bullCount;
  const countVote  = countTotal ? (bullCount - bCount) / countTotal : 0;

  // structure vote: aggregateAbovePct normalised to -1..+1
  const structureVote = (aggregateAbovePct.value - 50) / 50;

  // four signals averaged equally
  return (trendVote + lookbackVote + countVote + structureVote) / 4;
});

const sentimentLabel = computed(() => {
  const s = sentimentScore.value;
  if (s <= -0.35) return 'BEAR';
  if (s >=  0.35) return 'BULL';
  return 'NEUTRAL';
});

const sentimentClass = computed(() => {
  const label = sentimentLabel.value;
  if (label === 'BEAR') return 'is-strong-bear';
  if (label === 'BULL') return 'is-strong-bull';
  return 'is-neutral-summary';
});

const sentimentReason = computed(() => {
  const bearishTrend = countOf(trendCounts.value, 'bearish');
  const bullishTrend = countOf(trendCounts.value, 'bullish');
  const strongDown   = countOf(lookbackTrendCounts.value, 'strong_downtrend');
  const strongUp     = countOf(lookbackTrendCounts.value, 'strong_uptrend');
  const bCount       = bearishSymbols.value.length;
  const bullCount    = bullishSymbols.value.length;

  const trendLead =
    bearishTrend === bullishTrend ? 'trend is split evenly'
    : bearishTrend > bullishTrend ? `bearish trend leads (${bearishTrend} vs ${bullishTrend})`
    : `bullish trend leads (${bullishTrend} vs ${bearishTrend})`;

  const lookbackLead =
    strongDown === strongUp ? 'lookback momentum is balanced'
    : strongDown > strongUp ? `lookback shows stronger downtrend momentum (${strongDown} vs ${strongUp})`
    : `lookback shows stronger uptrend momentum (${strongUp} vs ${strongDown})`;

  const countLead =
    bCount === bullCount ? 'live signals are split evenly'
    : bCount > bullCount ? `bearish signals outnumber bullish (${bCount} vs ${bullCount})`
    : `bullish signals outnumber bearish (${bullCount} vs ${bCount})`;

  const structureLead =
    aggregateAbovePct.value >= 60 ? `market structure is bullish (avg ${aggregateAbovePct.value.toFixed(0)}% above)`
    : aggregateAbovePct.value <= 40 ? `market structure is bearish (avg ${aggregateAbovePct.value.toFixed(0)}% above)`
    : `market structure is neutral (avg ${aggregateAbovePct.value.toFixed(0)}% above)`;

  return `${trendLead}; ${lookbackLead}; ${countLead}; ${structureLead}.`;
});

// ── Shout market sentiment ────────────────────────────────────────────────────

function shoutMarketSentiment() {
  const total = chocoMintoStore.futureSymbols.length;

  if (!total) return;

  const bullCount = bullishSymbols.value.length;
  const bearCount = bearishSymbols.value.length;

  let message = "";

  if (bullCount >= 70 && bullCount > bearCount) {
    message = "Bullish market run detected.";

    notificationStore.showNotification("success","top-right","BULL RUN!","Bullish market move detected");
  }
  else if (bearCount >= 70 && bearCount > bullCount) {
    message = "Bearish market run detected.";

    notificationStore.showNotification("danger","top-right","BEAR DRAG!","Bearish market move detected");
  }else{
    var crazyBullMoves = chocoMintoStore.futureSymbols.filter(f => f.change >= 5);
    var crazyBearMoves = chocoMintoStore.futureSymbols.filter(f => f.change <= -5);

    if(crazyBullMoves.length > 0 || crazyBearMoves.length > 0){
        message = `Crazy candle changes detected. ${crazyBullMoves.length} Bulls and ${crazyBearMoves.length} Bears.`
    }
  }

  if (message && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();

    let count = 0;

    const speak = () => {
      if (count >= 3) return;

      const utter = new SpeechSynthesisUtterance(message);

      utter.rate = 1;
      utter.pitch = 1.2;
      utter.volume = 1;

      utter.onend = () => {
        count++;
        speak();
      };

      window.speechSynthesis.speak(utter);
    };

    speak();
  }
}

defineExpose({ shoutMarketSentiment });
</script>

<style scoped>
.trend-board {
  font-family: inherit;
}

.sentiment-banner {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 14px;
  background: rgba(127, 127, 127, 0.08);
  border-left: 4px solid currentColor;
}

.sentiment-label {
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.04em;
}

.sentiment-reason {
  font-size: 0.8rem;
  opacity: 0.75;
  color: inherit;
  filter: grayscale(0.3);
}

.summary-row {
  display: flex;
  gap: 32px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
}

.summary-col {
  flex: 1;
  min-width: 0;
}

.summary-col-wide {
  flex: 1 1 100%;
}

.summary-title {
  font-weight: 600;
  font-size: 0.8rem;
  letter-spacing: 0.03em;
  opacity: 0.7;
  margin-bottom: 4px;
}

.summary-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
  padding: 3px 0;
}

.summary-line-clickable {
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 6px;
  margin: 0 -6px;
  transition: background 0.15s ease;
}

.summary-line-clickable:hover {
  background: rgba(127, 127, 127, 0.12);
}

.summary-label {
  flex: 0 0 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.78rem;
}

.summary-bar-track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.12);
  overflow: hidden;
}

.summary-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}

.summary-count {
  flex: 0 0 32px;
  text-align: right;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

/* ── Wall range fetch trigger + progress ──────────────────────── */
.wall-fetch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.wall-fetch-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: #64b5f6;
  color: #0d0d0d;
  font-weight: 600;
  cursor: pointer;
}

.wall-fetch-btn-alt {
  background: #ba68c8;
}

.wall-fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wall-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 280px;
}

.wall-progress-track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.15);
  overflow: hidden;
}

.wall-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: #64b5f6;
  transition: width 0.2s ease;
}

.wall-progress-label {
  font-size: 0.75rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.wall-sort-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  background: transparent;
  color: inherit;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  margin-left: auto;
  white-space: nowrap;
}

.wall-sort-btn:hover {
  background: rgba(127, 127, 127, 0.1);
}

.wall-sort-btn.active {
  background: rgba(100, 181, 246, 0.15);
  border-color: #64b5f6;
  color: #64b5f6;
}

/* ── Market structure aggregate bar ───────────────────────────── */
.structure-aggregate {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.structure-aggregate-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.25);
  overflow: hidden;
}

.structure-aggregate-fill.bull {
  height: 100%;
  border-radius: 999px;
  background: #22c55e;
  transition: width 0.3s ease;
}

.structure-aggregate-label {
  font-size: 0.75rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

/* ── Structure mini bars (per symbol card) ────────────────────── */
.structure-mini {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-left: auto;
}

.structure-mini-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.structure-mini-label-text {
  font-size: 0.65rem;
  opacity: 0.55;
  width: 10px;
  text-align: center;
  line-height: 1;
}

.structure-mini-track {
  width: 52px;
  height: 4px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.15);
  overflow: hidden;
}

.structure-mini-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}

.structure-mini-fill.is-strong-bull { background: #22c55e; }
.structure-mini-fill.is-strong-bear { background: #ef4444; }

.structure-mini-count {
  font-size: 0.65rem;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
  width: 22px;
  text-align: right;
  line-height: 1;
}

/* ── Z-score spike badge (per symbol card) ────────────────────── */
.zscore-spike-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.zscore-spike-badge.is-strong-bull {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.zscore-spike-badge.is-strong-bear {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.zscore-spike-icon { line-height: 1; }
.zscore-spike-z { opacity: 0.7; font-weight: 600; }

/* ── g1CandleCount value tag (per symbol card) ────────────────── */
.g1-count-value {
  font-size: 0.78rem;
  font-weight: 700;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

/* ── Semantic colour scale ────────────────────────────────────── */
.is-strong-bear { color: #ef4444; }
.summary-bar-fill.is-strong-bear { background: #ef4444; }

.is-mild-bear { color: #f3a4a4; }
.summary-bar-fill.is-mild-bear { background: #f3a4a4; }

.is-neutral-summary { color: #94a3b8; }
.summary-bar-fill.is-neutral-summary { background: #94a3b8; }

.is-mild-bull { color: #86efac; }
.summary-bar-fill.is-mild-bull { background: #86efac; }

.is-strong-bull { color: #22c55e; }
.summary-bar-fill.is-strong-bull { background: #22c55e; }

/* ── Layout ───────────────────────────────────────────────────── */
.row { display: flex; gap: 16px; }
.col-md-6 { flex: 1; min-width: 0; }

.col-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 10px;
}

.col-header.bearish { background: rgba(239, 68, 68, 0.08); color: #ef4444; }
.col-header.bullish { background: rgba(34, 197, 94, 0.08);  color: #22c55e; }

.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.bearish-dot { background: #ef4444; }
.bullish-dot { background: #22c55e; }

.count { margin-left: auto; font-weight: 400; opacity: 0.7; font-size: 0.85rem; }

.actions { margin-bottom: 10px; display: flex; gap: 8px; }

.ride-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: #ef4444;
  color: white;
  font-weight: 600;
  cursor: pointer;
}
.ride-btn.buy { background: #7ee970; }
.ride-btn:hover { opacity: 0.9; }

.symbol-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 70vh;
  overflow-y: auto;
}

.range-symbol-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 75vh;
  overflow-y: auto;
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
  gap: 8px;
}

.trend-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.change-value {
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.is-bullish { background: rgba(34, 197, 94, 0.15);  color: #22c55e; }
.is-bearish { background: rgba(239, 68, 68, 0.15);  color: #ef4444; }
.is-neutral { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }

.lookback-row { display: flex; gap: 3px; }

.lookback-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.3);
}
.lookback-dot.is-bullish { background: #22c55e; }
.lookback-dot.is-bearish { background: #ef4444; }
.lookback-dot.is-neutral { background: rgba(148, 163, 184, 0.4); }
</style>