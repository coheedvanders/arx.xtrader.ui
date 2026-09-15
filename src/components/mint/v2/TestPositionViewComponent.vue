<template>
  <div class="test-position-view">
    <div class="test-position-columns">
    <div class="test-position-main-column">
    <!-- Summary + filter: click a chip to filter the list to that status,
         click it again (or "All") to clear the filter. Counts always
         reflect the FULL unfiltered list, not the currently-filtered view. -->
    <div class="test-position-summary">
      <button
        class="test-position-summary-chip all"
        :class="{ active: statusFilter === 'ALL' }"
        @click="statusFilter = 'ALL'"
      >All <b>{{ positions.length }}</b></button>
      <button
        class="test-position-summary-chip active-chip"
        :class="{ active: statusFilter === 'ACTIVE' }"
        @click="statusFilter = statusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE'"
      >Active <b>{{ activeCount }}</b></button>
      <button
        class="test-position-summary-chip win-chip"
        :class="{ active: statusFilter === 'WIN' }"
        @click="statusFilter = statusFilter === 'WIN' ? 'ALL' : 'WIN'"
      >Win <b>{{ winCount }}</b></button>
      <button
        class="test-position-summary-chip loss-chip"
        :class="{ active: statusFilter === 'LOSS' }"
        @click="statusFilter = statusFilter === 'LOSS' ? 'ALL' : 'LOSS'"
      >Loss <b>{{ lossCount }}</b></button>
      <button
        class="test-position-summary-chip ambiguous-chip"
        :class="{ active: statusFilter === 'AMBIGUOUS' }"
        @click="statusFilter = statusFilter === 'AMBIGUOUS' ? 'ALL' : 'AMBIGUOUS'"
      >Ambiguous <b>{{ ambiguousCount }}</b></button>
      <button class="test-position-run-all" :disabled="runningAll || !activeCount" @click="runAll">
        {{ runningAll ? `Checking… (${runAllProgress})` : "Run All" }}
      </button>
      <button class="test-position-close-all" :disabled="closingAll || !activeCount" @click="closeAll">
        {{ closingAll ? "Closing…" : "Close All" }}
      </button>
    </div>

    <div class="test-position-summary test-position-summary-secondary">
      <span
        v-if="totalPnlCount"
        class="test-position-total-pnl"
        :class="totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'"
      >
        Total est. PnL: <b>{{ totalPnl >= 0 ? "+" : "" }}{{ totalPnl.toFixed(2) }} USDT</b>
        <span class="test-position-total-pnl-note">({{ totalPnlCount }} with a computed PnL)</span>
      </span>
      <span v-else class="test-position-total-pnl test-position-total-pnl-empty">No PnL computed yet — run a check first.</span>
      <button class="test-position-cache-session" :disabled="!positions.length" @click="cacheSession" title="Save a summary of the current session and start a fresh one">Cache Session</button>
      <button class="test-position-clear-all" :disabled="!positions.length" @click="clearAll()">Clear All</button>
    </div>

    <div v-if="totalPnlCount" class="test-position-summary test-position-pnl-breakdown">
      <span class="test-position-pnl-breakdown-item">
        Active: <b :class="activePnl.total >= 0 ? 'pnl-positive' : 'pnl-negative'">{{ activePnl.count ? (activePnl.total >= 0 ? "+" : "") + activePnl.total.toFixed(2) + " USDT" : "—" }}</b>
      </span>
      <span class="test-position-pnl-breakdown-item">
        Won: <b :class="winPnl.total >= 0 ? 'pnl-positive' : 'pnl-negative'">{{ winPnl.count ? (winPnl.total >= 0 ? "+" : "") + winPnl.total.toFixed(2) + " USDT" : "—" }}</b>
      </span>
      <span class="test-position-pnl-breakdown-item">
        Lost: <b :class="lossPnl.total >= 0 ? 'pnl-positive' : 'pnl-negative'">{{ lossPnl.count ? (lossPnl.total >= 0 ? "+" : "") + lossPnl.total.toFixed(2) + " USDT" : "—" }}</b>
      </span>
    </div>

    <div v-if="runAllSummary" class="test-position-run-summary">{{ runAllSummary }}</div>

    <div v-if="loading" class="test-position-empty">Loading…</div>
    <div v-else-if="!filteredPositions.length" class="test-position-empty">
      {{ positions.length ? "No positions match this filter." : "No test positions yet." }}
    </div>
    <template v-else>
      <div class="test-position-list">
        <div
          v-for="p in pagedPositions"
          :key="p.id"
          :ref="(el) => setRowRef(p.id, el)"
          class="test-position-row"
          :class="{ 'test-position-row-last-selected': p.id === lastSelectedId }"
          @click="selectPosition(p); $emit('select-symbol', p)"
        >
          <div class="test-position-row-main">
            <span class="test-position-symbol">{{ p.symbol }}</span>
            <span class="test-position-side" :class="p.side === 'LONG' ? 'long' : 'short'">{{ p.side }}</span>
            <span class="test-position-status" :class="statusClass(p.status)">{{ p.status }}</span>
          </div>
          <div class="test-position-row-prices">
            <span>Entry <b>{{ formatNum(p.entry) }}</b></span>
            <span>TP <b>{{ formatNum(p.tp) }}</b></span>
            <span>SL <b>{{ formatNum(p.sl) }}</b></span>
            <span>Duration <b>{{ formatDuration(durationMs(p)) }}</b></span>
            <span v-if="p.pnl !== null" :class="p.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'">
              PnL <b>{{ p.pnl >= 0 ? '+' : '' }}{{ p.pnl.toFixed(2) }} USDT ({{ p.pnlPercent! >= 0 ? '+' : '' }}{{ p.pnlPercent!.toFixed(1) }}%)</b>
            </span>
          </div>
          <div class="test-position-row-meta">
            <span>Created {{ formatDate(p.createdAt) }}</span>
            <span v-if="p.lastCheckedAt">· Checked {{ formatDate(p.lastCheckedAt) }}</span>
            <span v-if="p.resolvedAt">· Resolved {{ formatDate(p.resolvedAt) }}<template v-if="p.resolvedPrice !== null"> @ {{ formatNum(p.resolvedPrice) }}</template><template v-if="p.forceClosed"> (forced)</template></span>
          </div>
          <div class="test-position-row-actions" @click.stop>
            <button :disabled="checkingId === p.id" @click="runCheck(p)">
              {{ checkingId === p.id ? "Checking…" : "Check" }}
            </button>
            <button v-if="p.status === 'ACTIVE'" :disabled="forceClosingId === p.id" @click="forceClose(p)">
              {{ forceClosingId === p.id ? "Closing…" : "Force Close" }}
            </button>
            <button class="test-position-delete" @click="remove(p)">Delete</button>
          </div>
          <div v-if="checkError === p.id" class="test-position-error">{{ checkErrorMessage }}</div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="test-position-pagination">
        <button :disabled="currentPage === 1" @click="currentPage--">‹ Prev</button>
        <span>Page {{ currentPage }} / {{ totalPages }}</span>
        <button :disabled="currentPage === totalPages" @click="currentPage++">Next ›</button>
      </div>
    </template>

    <div v-if="sessionHistory.length" class="test-position-session-history">
      <button class="test-position-session-history-toggle" @click="showSessionHistory = !showSessionHistory">
        {{ showSessionHistory ? "▾" : "▸" }} Session history ({{ sessionHistory.length }})
      </button>
      <div v-if="showSessionHistory" class="test-position-session-history-list">
        <div v-for="s in sessionHistory" :key="s.id" class="test-position-session-row">
          <span>{{ formatDate(s.cachedAt) }}</span>
          <span>{{ s.totalCount }} total</span>
          <span class="pnl-positive">{{ s.winCount }}W</span>
          <span class="pnl-negative">{{ s.lossCount }}L</span>
          <span v-if="s.activeCount">{{ s.activeCount }} still active</span>
          <span :class="s.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'">
            <b>{{ s.totalPnl >= 0 ? "+" : "" }}{{ s.totalPnl.toFixed(2) }} USDT</b>
          </span>
        </div>
      </div>
    </div>
    </div>

    <div class="test-position-balance-column">
      <div class="test-position-balance-row">
        <label>Starting balance</label>
        <input type="number" min="0" step="1" v-model.number="startingBalance" />
      </div>
      <div class="test-position-balance-row">
        <label>Est. Maintenance Margin</label>
        <span>{{ estimatedMaintenanceMargin.toFixed(2) }} USDT</span>
      </div>
      <div class="test-position-balance-row">
        <label>Est. Margin Balance</label>
        <span :class="estimatedMarginBalance >= startingBalance ? 'pnl-positive' : 'pnl-negative'">{{ estimatedMarginBalance.toFixed(2) }} USDT</span>
      </div>
      <div class="test-position-balance-row">
        <label>Balance</label>
        <span :class="balance >= startingBalance ? 'pnl-positive' : 'pnl-negative'">{{ balance.toFixed(2) }} USDT</span>
      </div>
      <div class="test-position-balance-divider"></div>
      <div class="test-position-balance-title">Exposure</div>
      <div class="test-position-balance-row">
        <label>SL Risk</label>
        <span class="pnl-negative">-{{ exposure.slRisk.toFixed(2) }} USDT</span>
      </div>
      <div class="test-position-balance-row">
        <label>TP Gains</label>
        <span class="pnl-positive">+{{ exposure.tpGains.toFixed(2) }} USDT</span>
      </div>
      <div class="test-position-balance-note">Maintenance Margin is an approximation (flat rate), not Binance's actual tiered figure.</div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, type ComponentPublicInstance } from "vue";
import {
  listAllTestPositions,
  saveTestPosition,
  deleteTestPosition,
  clearAllTestPositions,
  type TestPosition,
} from "@/utility/testPositionDb";
import { checkTestPosition } from "@/utility/v2/analysis/checkTestPosition";
import { fetchLiveCandles, checkOneTestPosition } from "@/utility/v2/analysis/testPositionLiveCheck";
import {
  listAllSessionSummaries,
  saveSessionSummary,
  type SessionSummary,
} from "@/utility/sessionSummaryDb";
import type { CandleInfo } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

defineEmits<{ (e: "select-symbol", position: TestPosition): void }>();

const PAGE_SIZE = 10;

const positions = ref<TestPosition[]>([]);
const loading = ref(true);
const checkingId = ref<string | null>(null);
const checkError = ref<string | null>(null);
const checkErrorMessage = ref("");
const runningAll = ref(false);
const runAllProgress = ref("");
const runAllSummary = ref<string | null>(null);

// Persisted across opens: this component is fully destroyed and
// recreated every time the modal closes (v-if in the parent), so without
// this the filter would silently reset to "All" every single time —
// exactly the "next time I check another symbol, I get back to where I
// left" this is for.
const STATUS_FILTER_STORAGE_KEY = "cev2.testPositionView.statusFilter";
const LAST_SELECTED_STORAGE_KEY = "cev2.testPositionView.lastSelectedId";

function loadPersistedStatusFilter(): "ALL" | "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS" {
  try {
    const stored = localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    if (stored === "ALL" || stored === "ACTIVE" || stored === "WIN" || stored === "LOSS" || stored === "AMBIGUOUS") {
      return stored;
    }
  } catch {
    // localStorage unavailable — fall back to default.
  }
  return "ALL";
}

function loadPersistedLastSelectedId(): string | null {
  try {
    return localStorage.getItem(LAST_SELECTED_STORAGE_KEY);
  } catch {
    return null;
  }
}

const statusFilter = ref<"ALL" | "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS">(loadPersistedStatusFilter());
watch(statusFilter, (val) => {
  try {
    localStorage.setItem(STATUS_FILTER_STORAGE_KEY, val);
  } catch {
    // ignore — persistence is a nice-to-have
  }
});

// The specific position last clicked (to switch symbols) — highlighted
// in the list so reopening the modal shows exactly which one you left
// off on, not just which filter tab.
const lastSelectedId = ref<string | null>(loadPersistedLastSelectedId());
function selectPosition(position: TestPosition) {
  lastSelectedId.value = position.id;
  try {
    localStorage.setItem(LAST_SELECTED_STORAGE_KEY, position.id);
  } catch {
    // ignore — persistence is a nice-to-have
  }
}

// Row elements keyed by position id, so the last-selected row can be
// scrolled into view programmatically on reopen — highlighting alone
// doesn't help if it's off past the bottom of the (scrollable) list.
const rowRefs = new Map<string, HTMLElement>();
function setRowRef(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) rowRefs.set(id, el);
  else rowRefs.delete(id);
}

async function scrollToLastSelected() {
  if (!lastSelectedId.value) return;
  await nextTick();
  const el = rowRefs.get(lastSelectedId.value);
  el?.scrollIntoView({ block: "nearest" });
}

const currentPage = ref(1);

const sessionHistory = ref<SessionSummary[]>([]);
const showSessionHistory = ref(false);
const forceClosingId = ref<string | null>(null);
const closingAll = ref(false);

onMounted(async () => {
  try {
    positions.value = await listAllTestPositions();
  } catch (err) {
    console.error("Failed to load test positions:", err);
  } finally {
    loading.value = false;
  }
  if (lastSelectedId.value) {
    // Jump to whichever page actually contains it (under the just-loaded
    // statusFilter) — highlighting it is only useful if it's actually on
    // the visible page, not off on page 3 somewhere.
    const idx = filteredPositions.value.findIndex(p => p.id === lastSelectedId.value);
    if (idx >= 0) currentPage.value = Math.floor(idx / PAGE_SIZE) + 1;
  }
  try {
    sessionHistory.value = await listAllSessionSummaries();
  } catch (err) {
    console.error("Failed to load session history:", err);
  }
  scrollToLastSelected();
});

const activeCount = computed(() => positions.value.filter(p => p.status === "ACTIVE").length);
const winCount = computed(() => positions.value.filter(p => p.status === "WIN").length);
const lossCount = computed(() => positions.value.filter(p => p.status === "LOSS").length);
const ambiguousCount = computed(() => positions.value.filter(p => p.status === "AMBIGUOUS").length);

/** Sum of every position's own pnl where it's actually been computed — realized (WIN/LOSS) plus unrealized (still-ACTIVE, marked to last close). AMBIGUOUS and never-yet-checked positions have pnl === null and are excluded, not treated as zero. */
const totalPnl = computed(() =>
  positions.value.reduce((sum, p) => (p.pnl !== null ? sum + p.pnl : sum), 0)
);
const totalPnlCount = computed(() => positions.value.filter(p => p.pnl !== null).length);

/** Sum + count of pnl for positions in one specific status — used for the Active/Won/Lost breakdown below the grand total. Same "exclude null, don't treat as zero" rule as totalPnl. */
function pnlForStatus(status: TestPosition["status"]): { total: number; count: number } {
  const withPnl = positions.value.filter(p => p.status === status && p.pnl !== null);
  return { total: withPnl.reduce((sum, p) => sum + p.pnl!, 0), count: withPnl.length };
}
const activePnl = computed(() => pnlForStatus("ACTIVE"));
const winPnl = computed(() => pnlForStatus("WIN"));
const lossPnl = computed(() => pnlForStatus("LOSS"));

// Global (not per-symbol) — your account balance isn't scoped to whatever
// symbol happens to be on screen. Default 100, persisted the moment it's
// changed.
const STARTING_BALANCE_KEY = "cev2.testPositionView.startingBalance";
function loadStartingBalance(): number {
  try {
    const stored = localStorage.getItem(STARTING_BALANCE_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // localStorage unavailable — fall back to default.
  }
  return 100;
}
const startingBalance = ref(loadStartingBalance());
watch(startingBalance, (val) => {
  try {
    localStorage.setItem(STARTING_BALANCE_KEY, String(val));
  } catch {
    // ignore — persistence is a nice-to-have
  }
});

// Balance = starting balance + PnL of positions that have actually
// CLOSED (won or lost) — this IS "wallet balance" in Binance's own
// terminology: your running balance including every realized gain/loss,
// not just what you started with. AMBIGUOUS resolutions are excluded,
// same as everywhere else in this file: their pnl is always null by
// design, not zero.
const closedPnlTotal = computed(() => winPnl.value.total + lossPnl.value.total);
const balance = computed(() => startingBalance.value + closedPnlTotal.value);

// Margin Balance = wallet balance + unrealized PnL — Binance's own
// definition. The base here is `balance` (which already includes
// realized PnL from closed trades), NOT the raw starting deposit — an
// earlier version of this used startingBalance directly, which quietly
// dropped every closed trade's contribution and produced a wrong number
// the moment anything had actually closed. activePnl is exactly
// "unrealized PnL" here, since it's the sum of still-open positions
// marked to the last checked price.
const estimatedMarginBalance = computed(() => balance.value + activePnl.value.total);

// Maintenance Margin: an APPROXIMATION, not Binance's actual figure.
// Binance's real maintenance margin is a tiered schedule that varies by
// symbol AND position notional size, with a per-tier deduction amount —
// data this app doesn't have. This uses a single flat rate instead,
// roughly matching Binance's lowest bracket for most USDT-M pairs.
// Directionally useful, not precise — do not treat this figure as what
// Binance would actually show for liquidation risk.
const MAINTENANCE_MARGIN_RATE_APPROX = 0.004; // 0.4%
const estimatedMaintenanceMargin = computed(() =>
  positions.value
    .filter(p => p.status === "ACTIVE")
    .reduce((sum, p) => sum + p.margin * p.maxLeverage * MAINTENANCE_MARGIN_RATE_APPROX, 0)
);

// Exposure: what would actually happen if every ACTIVE position's SL (or
// TP) hit RIGHT NOW — distinct from activePnl, which is marked to the
// last CHECKED price, not to the SL/TP levels themselves. Same
// PnlUtility functions and BUY/SELL side mapping used everywhere else in
// this app, not a separate formula.
const exposure = computed(() => {
  let slRisk = 0;
  let tpGains = 0;
  for (const p of positions.value.filter(x => x.status === "ACTIVE")) {
    const apiSide = p.side === "LONG" ? "BUY" : "SELL";
    const slPercent = PnlUtility.calculatePNLPercent(p.entry, p.sl, apiSide, p.maxLeverage);
    slRisk += Math.abs(PnlUtility.calculateEstimatedPnl(p.margin, slPercent, p.maxLeverage));
    const tpPercent = PnlUtility.calculatePNLPercent(p.entry, p.tp, apiSide, p.maxLeverage);
    tpGains += PnlUtility.calculateEstimatedPnl(p.margin, tpPercent, p.maxLeverage);
  }
  return { slRisk, tpGains };
});

const filteredPositions = computed(() => {
  if (statusFilter.value === "ALL") return positions.value;
  return positions.value.filter(p => p.status === statusFilter.value);
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredPositions.value.length / PAGE_SIZE)));

const pagedPositions = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return filteredPositions.value.slice(start, start + PAGE_SIZE);
});

// Changing the filter (or the list shrinking below the current page's
// range) can leave currentPage pointing past the end — clamp it back.
watch([statusFilter, totalPages], () => {
  if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
});
watch(statusFilter, () => {
  currentPage.value = 1;
});

function statusClass(status: TestPosition["status"]): string {
  if (status === "WIN") return "win";
  if (status === "LOSS") return "loss";
  if (status === "AMBIGUOUS") return "ambiguous";
  return "active";
}

function formatNum(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** How long the position has been open: entry -> now if still ACTIVE, entry -> resolution if WIN/LOSS. Computed fresh each render rather than stored, since an ACTIVE position's duration keeps growing. */
function durationMs(p: TestPosition): number {
  const end = p.resolvedAt ?? Date.now();
  return Math.max(0, end - p.entryOpenTime);
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || !parts.length) parts.push(`${minutes}m`);
  return parts.join(" ");
}

async function runCheck(position: TestPosition) {
  checkingId.value = position.id;
  checkError.value = null;
  try {
    const candles = await fetchLiveCandles(position.symbol, position.entryOpenTime);
    if (!candles || !candles.length) {
      checkError.value = position.id;
      checkErrorMessage.value = `Could not fetch live candles for ${position.symbol} from Binance.`;
      return;
    }
    await checkOneTestPosition(position, candles);
  } catch (err) {
    checkError.value = position.id;
    checkErrorMessage.value = (err as Error)?.message ?? String(err);
  } finally {
    checkingId.value = null;
  }
}

/**
 * Closes a position RIGHT NOW rather than waiting for TP/SL to be hit —
 * categorized WIN if the current mark-to-market PnL is positive, LOSS if
 * negative. Re-checks against fresh candle data FIRST: if TP/SL (or the
 * ambiguous double-hit) already resolved it naturally, that result is
 * used as-is and NOT overridden — force-close only ever applies its own
 * manual win/loss categorization when the position is genuinely still
 * active. resolvedPrice is left null for an actual forced close, since
 * there's no level it resolved against — only a mark-to-market moment.
 */
async function forceClose(position: TestPosition) {
  forceClosingId.value = position.id;
  checkError.value = null;
  try {
    const candles = await fetchLiveCandles(position.symbol, position.entryOpenTime);
    if (!candles || !candles.length) {
      checkError.value = position.id;
      checkErrorMessage.value = `Could not fetch live candles for ${position.symbol} from Binance.`;
      return;
    }
    const result = checkTestPosition(position, candles);
    if (result.status !== "ACTIVE") {
      // Already naturally resolved on this fresh check (TP/SL hit, or
      // ambiguous) — apply that as-is, same as a normal check would.
      position.status = result.status;
      position.resolvedAt = result.resolvedAt;
      position.resolvedPrice = result.resolvedPrice;
      position.pnlPercent = result.pnlPercent;
      position.pnl = result.pnl;
    } else {
      position.status = (result.pnl ?? 0) >= 0 ? "WIN" : "LOSS";
      position.resolvedAt = Date.now();
      position.resolvedPrice = null;
      position.pnlPercent = result.pnlPercent;
      position.pnl = result.pnl;
      position.forceClosed = true;
    }
    position.lastCheckedAt = Date.now();
    await saveTestPosition(position);
  } catch (err) {
    checkError.value = position.id;
    checkErrorMessage.value = (err as Error)?.message ?? String(err);
  } finally {
    forceClosingId.value = null;
  }
}

/** Force-closes every still-ACTIVE position — same per-symbol candle-fetch caching as Run All, and the same "respect a natural resolution if the fresh check reveals one" rule as a single forceClose. */
async function closeAll() {
  if (closingAll.value) return;
  if (!activeCount.value) return;
  if (!confirm(`Force close all ${activeCount.value} active position(s)? Each will be marked WIN or LOSS based on its current PnL.`)) return;
  closingAll.value = true;
  const toClose = positions.value.filter(p => p.status === "ACTIVE");
  const earliestBySymbol = new Map<string, number>();
  for (const p of toClose) {
    const cur = earliestBySymbol.get(p.symbol);
    if (cur === undefined || p.entryOpenTime < cur) earliestBySymbol.set(p.symbol, p.entryOpenTime);
  }
  const candlesCache = new Map<string, CandleInfo[] | null>();
  try {
    for (const p of toClose) {
      try {
        let candles = candlesCache.get(p.symbol);
        if (candles === undefined) {
          candles = await fetchLiveCandles(p.symbol, earliestBySymbol.get(p.symbol)!);
          candlesCache.set(p.symbol, candles);
        }
        if (!candles || !candles.length) continue;
        const result = checkTestPosition(p, candles);
        if (result.status !== "ACTIVE") {
          p.status = result.status;
          p.resolvedAt = result.resolvedAt;
          p.resolvedPrice = result.resolvedPrice;
          p.pnlPercent = result.pnlPercent;
          p.pnl = result.pnl;
        } else {
          p.status = (result.pnl ?? 0) >= 0 ? "WIN" : "LOSS";
          p.resolvedAt = Date.now();
          p.resolvedPrice = null;
          p.pnlPercent = result.pnlPercent;
          p.pnl = result.pnl;
          p.forceClosed = true;
        }
        p.lastCheckedAt = Date.now();
        await saveTestPosition(p);
      } catch (err) {
        console.error(`Failed to force-close ${p.symbol}:`, err);
      }
    }
  } finally {
    closingAll.value = false;
  }
}

/**
 * Saves a snapshot of the current session's aggregate stats, then clears
 * every current test position to start fresh — the day-trading workflow
 * this is for is "trade a session, cache the result, start the next
 * session with a clean slate", not one ever-growing list.
 */
async function cacheSession() {
  if (!positions.value.length) return;
  if (!confirm("Cache a summary of this session and clear all current test positions to start a new session?")) return;

  const summary: SessionSummary = {
    id: crypto.randomUUID(),
    cachedAt: Date.now(),
    totalCount: positions.value.length,
    activeCount: activeCount.value,
    winCount: winCount.value,
    lossCount: lossCount.value,
    ambiguousCount: ambiguousCount.value,
    totalPnl: totalPnl.value,
    activePnl: activePnl.value.total,
    winPnl: winPnl.value.total,
    lossPnl: lossPnl.value.total,
  };

  try {
    await saveSessionSummary(summary);
    sessionHistory.value = [summary, ...sessionHistory.value];
  } catch (err) {
    console.error("Failed to cache session summary:", err);
    return; // don't clear positions if the summary failed to save — nothing would be left to show for the session
  }

  await clearAll(true);
}

/**
 * Checks every ACTIVE position (WIN/LOSS are already resolved and can't
 * change, so re-checking them would just waste candle fetches). Caches
 * each symbol's candle data for the duration of this run — several test
 * positions often share a symbol, and there's no reason to fetch the same
 * candles from IndexedDB more than once per batch.
 */
async function runAll() {
  if (runningAll.value) return;
  runningAll.value = true;
  runAllSummary.value = null;
  const toCheck = positions.value.filter(p => p.status === "ACTIVE");

  // Cache one fetch per SYMBOL, but using the EARLIEST entryOpenTime
  // needed across every position on that symbol in this batch — two
  // positions on the same symbol opened at different times both need to
  // be covered by the same cached fetch, not just whichever one happened
  // to trigger it first.
  const earliestBySymbol = new Map<string, number>();
  for (const p of toCheck) {
    const cur = earliestBySymbol.get(p.symbol);
    if (cur === undefined || p.entryOpenTime < cur) earliestBySymbol.set(p.symbol, p.entryOpenTime);
  }
  const candlesCache = new Map<string, CandleInfo[] | null>();
  const skippedSymbols = new Set<string>();
  const erroredSymbols = new Set<string>();
  let checkedCount = 0;
  let done = 0;
  try {
    for (const p of toCheck) {
      runAllProgress.value = `${done}/${toCheck.length}`;
      try {
        let candles = candlesCache.get(p.symbol);
        if (candles === undefined) {
          candles = await fetchLiveCandles(p.symbol, earliestBySymbol.get(p.symbol)!);
          candlesCache.set(p.symbol, candles);
        }
        if (!candles || !candles.length) {
          skippedSymbols.add(p.symbol);
          continue;
        }
        await checkOneTestPosition(p, candles);
        checkedCount++;
      } catch (err) {
        erroredSymbols.add(p.symbol);
        console.error(`Failed to check ${p.symbol}:`, err);
      }
      done++;
    }
  } finally {
    runningAll.value = false;
    runAllProgress.value = "";
    const parts: string[] = [`Checked ${checkedCount}/${toCheck.length}`];
    if (skippedSymbols.size) parts.push(`could not fetch: ${[...skippedSymbols].join(", ")}`);
    if (erroredSymbols.size) parts.push(`errored: ${[...erroredSymbols].join(", ")}`);
    runAllSummary.value = toCheck.length ? parts.join(" — ") : null;
  }
}

async function remove(position: TestPosition) {
  positions.value = positions.value.filter(p => p.id !== position.id);
  try {
    await deleteTestPosition(position.id);
  } catch (err) {
    console.error("Failed to delete test position:", err);
  }
}

async function clearAll(skipConfirm = false) {
  if (!positions.value.length) return;
  if (!skipConfirm && !confirm("Clear every test position? This can't be undone.")) return;
  positions.value = [];
  try {
    await clearAllTestPositions();
  } catch (err) {
    console.error("Failed to clear test positions:", err);
  }
}
</script>

<style scoped>
.test-position-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: #cdd3db;
}
.test-position-columns {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.test-position-main-column {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.test-position-balance-column {
  flex: 0 0 190px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
.test-position-balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.test-position-balance-row label {
  color: #9aa4b2;
}
.test-position-balance-row input {
  width: 70px;
  background: #171b21;
  border: 1px solid #3a4048;
  color: #f8fafc;
  border-radius: 4px;
  padding: 2px 6px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  text-align: right;
}
.test-position-balance-divider {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}
.test-position-balance-title {
  font-size: 10px;
  color: #667;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.test-position-balance-note {
  font-size: 9.5px;
  color: #556;
  line-height: 1.4;
  margin-top: 4px;
}
.test-position-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.test-position-summary-chip {
  background: #171b21;
  border: 1px solid #3a4048;
  color: #9aa4b2;
  border-radius: 4px;
  padding: 4px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  cursor: pointer;
}
.test-position-summary-chip b { margin-left: 4px; color: #f8fafc; }
.test-position-summary-chip.active { border-color: #f8fafc; color: #f8fafc; }
.test-position-summary-chip.active-chip.active { border-color: #60a5fa; color: #60a5fa; }
.test-position-summary-chip.active-chip.active b { color: #60a5fa; }
.test-position-summary-chip.win-chip.active { border-color: #22c55e; color: #22c55e; }
.test-position-summary-chip.win-chip.active b { color: #22c55e; }
.test-position-summary-chip.loss-chip.active { border-color: #ef4444; color: #ef4444; }
.test-position-summary-chip.loss-chip.active b { color: #ef4444; }
.test-position-summary-chip.ambiguous-chip.active { border-color: #f59e0b; color: #f59e0b; }
.test-position-summary-chip.ambiguous-chip.active b { color: #f59e0b; }
.test-position-run-all {
  margin-left: auto;
  background: rgba(79,195,247,.1);
  border: 1px solid rgba(79,195,247,.45);
  color: #4fc3f7;
  border-radius: 4px;
  padding: 4px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.test-position-run-all:hover:not(:disabled) { background: rgba(79,195,247,.18); }
.test-position-run-all:disabled { opacity: 0.45; cursor: not-allowed; }

.test-position-close-all {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.5);
  color: #f59e0b;
  border-radius: 4px;
  padding: 4px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.test-position-close-all:hover:not(:disabled) { background: rgba(245, 158, 11, 0.2); }
.test-position-close-all:disabled { opacity: 0.45; cursor: not-allowed; }

.test-position-summary-secondary {
  border-bottom: none;
  padding-top: 0;
  padding-bottom: 8px;
}
.test-position-total-pnl {
  font-size: 12px;
}
.test-position-total-pnl-note {
  color: #667;
  font-size: 10px;
  margin-left: 4px;
}
.test-position-total-pnl-empty {
  color: #667;
  font-size: 11px;
}
.test-position-cache-session {
  margin-left: auto;
  background: rgba(96, 165, 250, 0.1);
  border: 1px solid rgba(96, 165, 250, 0.5);
  color: #60a5fa;
  border-radius: 4px;
  padding: 4px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.test-position-cache-session:hover:not(:disabled) { background: rgba(96, 165, 250, 0.2); }
.test-position-cache-session:disabled { opacity: 0.4; cursor: not-allowed; }

.test-position-clear-all {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #ef4444;
  border-radius: 4px;
  padding: 4px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.test-position-clear-all:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
.test-position-clear-all:disabled { opacity: 0.4; cursor: not-allowed; }
.test-position-pnl-breakdown {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 0;
  padding-bottom: 8px;
  gap: 16px;
}
.test-position-pnl-breakdown-item {
  font-size: 11px;
  color: #9aa4b2;
}
.test-position-run-summary {
  font-size: 10px;
  color: #9aa4b2;
  padding: 4px 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.test-position-empty {
  color: #667;
  text-align: center;
  padding: 24px 0;
}
.test-position-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}
.test-position-row {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.test-position-row:hover {
  border-color: rgba(255, 255, 255, 0.2);
}
.test-position-row-last-selected {
  border-color: #60a5fa;
  background: rgba(96, 165, 250, 0.08);
}
.test-position-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.test-position-symbol {
  font-weight: 700;
  color: #f8fafc;
}
.test-position-side {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
}
.test-position-side.long {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}
.test-position-side.short {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
.test-position-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: auto;
}
.test-position-status.active {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}
.test-position-status.win {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}
.test-position-status.loss {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
.test-position-status.ambiguous {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}
.pnl-positive { color: #22c55e; }
.pnl-negative { color: #ef4444; }

.test-position-session-history {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
  margin-top: 4px;
}
.test-position-session-history-toggle {
  background: none;
  border: none;
  color: #9aa4b2;
  font-family: var(--mono, monospace);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.test-position-session-history-toggle:hover { color: #f8fafc; }
.test-position-session-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  max-height: 30vh;
  overflow-y: auto;
}
.test-position-session-row {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 10px;
  color: #9aa4b2;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
}
.test-position-row-prices {
  display: flex;
  gap: 14px;
  color: #9aa4b2;
  font-size: 11px;
  flex-wrap: wrap;
}
.test-position-row-meta {
  display: flex;
  gap: 4px;
  color: #667;
  font-size: 10px;
  flex-wrap: wrap;
}
.test-position-row-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.test-position-row-actions button {
  background: #171b21;
  border: 1px solid #3a4048;
  color: #cdd3db;
  border-radius: 4px;
  padding: 3px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  cursor: pointer;
}
.test-position-row-actions button:hover:not(:disabled) {
  border-color: #f8fafc;
  color: #f8fafc;
}
.test-position-row-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.test-position-delete:hover:not(:disabled) {
  border-color: #ef4444 !important;
  color: #ef4444 !important;
}
.test-position-error {
  color: #ef4444;
  font-size: 10px;
}
.test-position-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 4px;
}
.test-position-pagination button {
  background: #171b21;
  border: 1px solid #3a4048;
  color: #cdd3db;
  border-radius: 4px;
  padding: 3px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  cursor: pointer;
}
.test-position-pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>