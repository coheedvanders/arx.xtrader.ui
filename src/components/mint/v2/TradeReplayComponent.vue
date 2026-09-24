<template>
    <div>
        <ButtonComponent rounded color="ghost" @click="loadCapturedData" :disabled="isLoading || isReplaying">load captured data</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="runReplay" :disabled="isLoading || isReplaying || masterTimestamps.length === 0">run replay</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="stopReplay" :disabled="!isReplaying">stop</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="stepOnce" :disabled="isLoading || isReplaying || masterTimestamps.length === 0">step</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="resetRun" :disabled="isLoading || isReplaying">reset run</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="exportResult" :disabled="isLoading || (resolvedPositionsLog.length === 0 && openPositionsDisplay.length === 0)">export result</ButtonComponent>

        <label class="ml-sm">starting balance
            <InputComponent v-model.number="startingBalance" :disabled="isReplaying" />
        </label>
        <label class="ml-sm">speed (ms/step)
            <InputComponent v-model.number="stepDelayMs" :disabled="isReplaying" />
        </label>

        <div class="text-center">{{ UI_STATUS_MESSAGE }}</div>
        <div class="text-center">{{ currentTimestampLocal }}</div>

        <div class="timestamps-container" v-if="masterTimestamps.length">
            <div
                v-for="(ts, idx) in masterTimestamps"
                :key="ts"
                class="timestamp-box"
                :class="{ passed: idx <= currentIndex }"
                @click="jumpToIndex(idx)"
            ></div>
        </div>

        <div class="row">
            <div class="col-lg-3 col-md-3 pa-md">
                <div>Symbols Loaded: {{ symbolCandles.size }}</div>
                <div>Progress: {{ currentIndex }} / {{ masterTimestamps.length }}</div>
                <div class="divider"></div>
                <div>Won: {{ stats.won }}</div>
                <div>Loss: {{ stats.loss }}</div>
                <div>Open: {{ openPositionsDisplay.length }}</div>
                <div class="divider"></div>
                <div>Total Taker Fee: {{ stats.totalTakerFee.toFixed(2) }} USDT</div>
                <div>Total Closed PNL: {{ stats.totalClosedPnl.toFixed(2) }} USDT</div>
                <div>Total Open PNL: {{ stats.totalOpenPnl.toFixed(2) }} USDT</div>
                <div class="divider"></div>
                <div>Starting Balance: {{ startingBalance.toFixed(2) }} USDT</div>
                <div>Estimated Margin Used: {{ estimatedMarginUsed.toFixed(2) }} USDT</div>
                <div>Estimated Maintenance Margin: {{ estimatedMaintenanceMargin.toFixed(2) }} USDT</div>
                <div>Margin Balance: {{ marginBalance.toFixed(2) }} USDT</div>
                <div>Balance: {{ balance.toFixed(2) }} USDT</div>
            </div>

            <div class="col-lg-9 col-md-9 replay-snap-wrapper pa-md">
                <TabComponent v-model="UI_SELECTED_TAB">
                    <TabListComponent>
                        <TabTriggerComponent v-model="UI_SELECTED_TAB" :value="'Account'">Account Balance</TabTriggerComponent>
                        <TabTriggerComponent v-model="UI_SELECTED_TAB" :value="'OpenPositions'">Open Positions</TabTriggerComponent>
                    </TabListComponent>

                    <TabContentComponent v-model="UI_SELECTED_TAB" :value="'Account'">
                        <TableComponent>
                            <template #header>
                                <TableHeaderComponent>
                                    <th>Time</th>
                                    <th>Open</th>
                                    <th>Won</th>
                                    <th>Loss</th>
                                    <th>Taker Fee</th>
                                    <th>Closed PNL</th>
                                    <th>Open PNL</th>
                                    <th>Margin Balance</th>
                                    <th>Balance</th>
                                    <th>Maintenance Margin</th>
                                </TableHeaderComponent>
                            </template>
                            <template #body>
                                <TableBodyComponent>
                                    <tr v-for="snap in [...snapshots].reverse()" :key="snap.timestamp">
                                        <td>{{ new Date(snap.timestamp).toLocaleString() }}</td>
                                        <td>{{ snap.open }}</td>
                                        <td>{{ snap.won }}</td>
                                        <td>{{ snap.loss }}</td>
                                        <td>{{ snap.totalTakerFee.toFixed(2) }}</td>
                                        <td>{{ snap.totalClosedPnl.toFixed(2) }}</td>
                                        <td>{{ snap.totalOpenPnl.toFixed(2) }}</td>
                                        <td>{{ snap.marginBalance.toFixed(2) }}</td>
                                        <td>{{ snap.balance.toFixed(2) }}</td>
                                        <td>{{ snap.estimatedMaintenanceMargin.toFixed(2) }}</td>
                                    </tr>
                                </TableBodyComponent>
                            </template>
                        </TableComponent>
                    </TabContentComponent>

                    <TabContentComponent v-model="UI_SELECTED_TAB" :value="'OpenPositions'">
                        <TableComponent>
                            <template #header>
                                <TableHeaderComponent>
                                    <th>Open Time</th>
                                    <th>Symbol</th>
                                    <th>Side</th>
                                    <th>Entry Price</th>
                                    <th>Current Price</th>
                                    <th>TP</th>
                                    <th>SL</th>
                                    <th>Margin</th>
                                    <th>Leverage</th>
                                    <th>PNL</th>
                                </TableHeaderComponent>
                            </template>
                            <template #body>
                                <TableBodyComponent>
                                    <tr v-for="row in openPositionsDisplay" :key="row.symbol + ':' + row.position.openGi">
                                        <td>{{ new Date(row.openTime).toLocaleString() }}</td>
                                        <td>{{ row.symbol }}</td>
                                        <td>{{ row.position.side }}</td>
                                        <td>{{ row.position.entryPrice }}</td>
                                        <td>{{ row.currentPrice }}</td>
                                        <td>{{ row.position.tp }}</td>
                                        <td>{{ row.position.sl }}</td>
                                        <td>{{ row.position.margin }}</td>
                                        <td>{{ row.position.leverage }}</td>
                                        <td>{{ row.markToMarketPnl.toFixed(2) }}</td>
                                    </tr>
                                </TableBodyComponent>
                            </template>
                        </TableComponent>
                    </TabContentComponent>
                </TabComponent>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * Replays whatever's ALREADY captured in each symbol's stored
 * SymbolInfo.candle_15m — unlike ReplayCandleEntryComponent (the old
 * version this is based on), this does NOT run a live simulation or
 * fetch candle-by-candle from a database as it goes. positionEntry is
 * already computed and sitting on each candle from whatever
 * runMarketAnalysis pass last produced it; this component's only job
 * is to walk that data forward in time and show what the account would
 * have looked like at each point, exactly like scrubbing through a
 * recording.
 *
 * candle.positionEntry is a SHARED, MUTATED object across every candle
 * a position spans (open through resolution) — its OWN .status/.pnl
 * always reflect the position's FINAL, fully-resolved outcome, not
 * "as of this replay step." So this never reads .status/.pnl directly
 * to decide what's open right now or what it was worth then; it
 * compares the replay's own current candle index against the
 * position's stable .openGi/.closeGi to classify it as not-yet-open /
 * currently-open / just-now-closed at each step, and for anything
 * still open reads position.walkingPnl[gi - openGi] — the per-candle
 * pnl history positionEntry.ts itself records — rather than
 * recomputing the pnl formula here. One source of truth for that
 * formula, not two copies that could quietly drift apart.
 */
import type { CandleInfo, SymbolInfo, PositionEntry } from '@/core/interfacesv2';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { klineDbUtilityV2 } from '@/utility/v2/klineDbUtilityV2';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';
import { computed, onUnmounted, ref } from 'vue';
import TableComponent from '../../shared/table/TableComponent.vue';
import TableHeaderComponent from '../../shared/table/TableHeaderComponent.vue';
import TableBodyComponent from '../../shared/table/TableBodyComponent.vue';
import TabComponent from '../../shared/tab/TabComponent.vue';
import TabListComponent from '../../shared/tab/TabListComponent.vue';
import TabTriggerComponent from '../../shared/tab/TabTriggerComponent.vue';
import TabContentComponent from '../../shared/tab/TabContentComponent.vue';
import ButtonComponent from '../../shared/form/ButtonComponent.vue';
import InputComponent from '../../shared/form/InputComponent.vue';

const props = withDefaults(defineProps<{
    startingBalance?: number;
}>(), {
    startingBalance: 300,
});

const chocoMintoStore = useChocoMintoStore();

const startingBalance = ref(props.startingBalance);
const stepDelayMs = ref(30);

const isLoading = ref(false);
const isReplaying = ref(false);
const UI_STATUS_MESSAGE = ref('');
const UI_SELECTED_TAB = ref('Account');

// symbol -> its full candle_15m array, exactly as captured
const symbolCandles = new Map<string, CandleInfo[]>();
// symbol -> openTime -> index into that symbol's own candle_15m, for
// O(1) lookup of "does this symbol have a candle at this exact
// timestamp" as the replay walks the shared master timeline.
const symbolOpenTimeIndex = new Map<string, Map<number, number>>();

const masterTimestamps = ref<number[]>([]);
const currentIndex = ref(0);
let stopRequested = false;

const currentTimestampLocal = computed(() => {
    if (currentIndex.value <= 0 || currentIndex.value > masterTimestamps.value.length) return '';
    const ts = masterTimestamps.value[Math.min(currentIndex.value, masterTimestamps.value.length - 1)];
    return new Date(ts).toLocaleString();
});

interface RunStats {
    won: number;
    loss: number;
    totalTakerFee: number;
    totalClosedPnl: number;
    totalOpenPnl: number;
}

const stats = ref<RunStats>({ won: 0, loss: 0, totalTakerFee: 0, totalClosedPnl: 0, totalOpenPnl: 0 });

interface OpenPositionRow {
    symbol: string;
    position: PositionEntry;
    openTime: number;
    currentPrice: number;
    markToMarketPnl: number;
}
const openPositionsDisplay = ref<OpenPositionRow[]>([]);

interface AccountSnapshot {
    timestamp: number;
    won: number;
    loss: number;
    open: number;
    totalTakerFee: number;
    totalClosedPnl: number;
    totalOpenPnl: number;
    marginBalance: number;
    balance: number;
    // Added so liquidation risk can be traced through the WHOLE run,
    // not just checked at the current/final moment - without this,
    // there was no way to tell whether maintenance margin ever spiked
    // dangerously close to marginBalance at some intermediate point
    // that had since passed.
    estimatedMaintenanceMargin: number;
}
const snapshots = ref<AccountSnapshot[]>([]);

// symbol:openGi pairs already folded into stats.won/loss/totalClosedPnl
// - a position must only ever settle into the running totals ONCE,
// at the exact step its own closeGi is reached, not on every later
// step it's still referenced from (which would double count it).
const settledPositions = new Set<string>();

interface ResolvedPositionRecord {
    symbol: string;
    openTime: number;
    closeTime: number;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    sl: number;
    tp: number;
    margin: number;
    leverage: number;
    entryFee: number;
    status: 'WON' | 'LOSS';
    pnl: number | null;
    // Full per-candle pnl history over the position's own lifetime -
    // walkingPnl[k] is the pnl as of candle (openGi + k). Kept here
    // (not just the final pnl) specifically so this export can be used
    // to study HOW a position's pnl evolved before its outcome, not
    // just what the outcome was - e.g. whether losses tend to show a
    // brief favorable excursion first, or run straight against from
    // the start.
    walkingPnl: (number | null)[];
    openGi: number;
    closeGi: number | null;
    durationMinutes: number | null;
}
// Every position that settles during this run, in the order it
// settled - the export's main payload. Cleared on resetRun, same as
// everything else the run accumulates.
const resolvedPositionsLog = ref<ResolvedPositionRecord[]>([]);

const estimatedMarginUsed = computed(() =>
    openPositionsDisplay.value.reduce((sum, row) => sum + row.position.margin, 0)
);

const estimatedMaintenanceMargin = computed(() =>
    openPositionsDisplay.value.reduce((sum, row) => {
        const notional = row.position.margin * row.position.leverage;
        return sum + BinanceMarginUtility.calculateMaintenanceMargin(row.symbol, notional);
    }, 0)
);

const balance = computed(() =>
    (startingBalance.value - (estimatedMarginUsed.value + stats.value.totalTakerFee)) + stats.value.totalClosedPnl
);

const marginBalance = computed(() =>
    balance.value + estimatedMarginUsed.value + stats.value.totalOpenPnl
);

/**
 * Pulls every future symbol's already-captured SymbolInfo straight out
 * of IndexedDB (klineDbUtilityV2) - no simulation runs here, this is
 * purely reading what a prior runMarketAnalysis pass already produced
 * and stored. Builds the shared master timeline as the union of every
 * symbol's own candle openTimes, so symbols with slightly different
 * history depth (e.g. a recent listing) still replay correctly instead
 * of silently misaligning against an assumed-common index.
 */
async function loadCapturedData() {
    isLoading.value = true;
    symbolCandles.clear();
    symbolOpenTimeIndex.clear();
    const timestampSet = new Set<number>();

    const symbols = chocoMintoStore.futureSymbols;
    for (let i = 0; i < symbols.length; i++) {
        UI_STATUS_MESSAGE.value = `loading captured data: ${i + 1}/${symbols.length}`;
        const symbol = symbols[i].symbol;
        const symbolInfo: SymbolInfo | null = await klineDbUtilityV2.getSymbolInfo(symbol);
        if (!symbolInfo || !symbolInfo.candle_15m?.length) continue;

        symbolCandles.set(symbol, symbolInfo.candle_15m);

        const openTimeMap = new Map<number, number>();
        for (let gi = 0; gi < symbolInfo.candle_15m.length; gi++) {
            const openTime = symbolInfo.candle_15m[gi].openTime;
            openTimeMap.set(openTime, gi);
            timestampSet.add(openTime);
        }
        symbolOpenTimeIndex.set(symbol, openTimeMap);
    }

    masterTimestamps.value = Array.from(timestampSet).sort((a, b) => a - b);
    resetRun();
    UI_STATUS_MESSAGE.value = `loaded ${symbolCandles.size} symbols, ${masterTimestamps.value.length} timestamps`;
    isLoading.value = false;
}

/** Clears the run's own state (stats/snapshots/open positions/replay
 * position) WITHOUT re-fetching from IndexedDB - same captured data,
 * fresh run. */
function resetRun() {
    currentIndex.value = 0;
    stats.value = { won: 0, loss: 0, totalTakerFee: 0, totalClosedPnl: 0, totalOpenPnl: 0 };
    openPositionsDisplay.value = [];
    snapshots.value = [];
    settledPositions.clear();
    resolvedPositionsLog.value = [];
    UI_STATUS_MESSAGE.value = '';
}

function jumpToIndex(idx: number) {
    if (isReplaying.value) return;
    currentIndex.value = Math.max(0, Math.min(idx, masterTimestamps.value.length));
}

/**
 * Advances the replay by exactly one master timestamp. For each loaded
 * symbol, looks up whether it has a candle at this exact timestamp; if
 * so, classifies whatever position that candle carries (if any) as
 * not-yet-relevant / just-opened / still-open / just-settled purely
 * from openGi/closeGi against this candle's own gi - never from
 * position.status directly, since that reflects the FINAL outcome, not
 * "as of right now" in the replay.
 */
function advanceOneStep() {
    const timestamp = masterTimestamps.value[currentIndex.value];
    const stillOpenRows: OpenPositionRow[] = [];
    let openPnlThisStep = 0;

    for (const [symbol, candles] of symbolCandles) {
        const openTimeMap = symbolOpenTimeIndex.get(symbol);
        const gi = openTimeMap?.get(timestamp);
        if (gi === undefined) continue;

        const candle = candles[gi];
        const position = candle.positionEntry;
        if (!position) continue;

        const posKey = symbol + ':' + position.openGi;
        const isNowClosed = position.closeGi != null && gi >= position.closeGi;

        if (isNowClosed) {
            if (!settledPositions.has(posKey) && (position.status === 'WON' || position.status === 'LOSS')) {
                settledPositions.add(posKey);
                if (position.status === 'WON') stats.value.won++;
                else stats.value.loss++;
                stats.value.totalClosedPnl += position.pnl ?? 0;
                // Entry fee added at settlement, matching the old
                // version's own pattern (ReplayCandleEntryComponent
                // adds entryFee to the running total when a position
                // closes, not when it opens).
                stats.value.totalTakerFee += position.entryFee ?? 0;

                resolvedPositionsLog.value.push({
                    symbol,
                    openTime: candles[position.openGi]?.openTime ?? timestamp,
                    closeTime: candle.openTime,
                    side: position.side,
                    entryPrice: position.entryPrice,
                    sl: position.sl,
                    tp: position.tp,
                    margin: position.margin,
                    leverage: position.leverage,
                    entryFee: position.entryFee,
                    status: position.status as 'WON' | 'LOSS',
                    pnl: position.pnl,
                    walkingPnl: [...position.walkingPnl],
                    openGi: position.openGi,
                    closeGi: position.closeGi,
                    durationMinutes: position.durationMinutes,
                });
            }
            continue;
        }

        // Still open as of this exact step (openGi <= gi < closeGi, or
        // closeGi not yet reached) - mark-to-market using THIS candle's
        // own close, same formula updatePositionEntry itself uses for
        // its OPEN branch, so the number is continuous with whatever
        // this same position shows once it actually settles.
        // walkingPnl[k] is the pnl as of candle (openGi + k) - so this
        // index always lands on the value AS OF gi, not the position's
        // eventual final outcome (which is all .pnl would give here,
        // since candle.positionEntry is the same mutated object at
        // every candle the position spans). Falls back to 0 only if
        // the history is somehow shorter than expected (shouldn't
        // happen for already-fully-captured data, but a position still
        // OPEN at the very end of a capture may not have this exact
        // gi recorded yet if the loop stopped one candle early).
        const walkingIndex = gi - position.openGi;
        const markToMarketPnl = position.walkingPnl[walkingIndex] ?? 0;
        openPnlThisStep += markToMarketPnl;

        stillOpenRows.push({
            symbol,
            position,
            openTime: candles[position.openGi]?.openTime ?? timestamp,
            currentPrice: candle.close,
            markToMarketPnl,
        });
    }

    openPositionsDisplay.value = stillOpenRows;
    stats.value.totalOpenPnl = openPnlThisStep;

    snapshots.value.push({
        timestamp,
        won: stats.value.won,
        loss: stats.value.loss,
        open: stillOpenRows.length,
        totalTakerFee: stats.value.totalTakerFee,
        totalClosedPnl: stats.value.totalClosedPnl,
        totalOpenPnl: stats.value.totalOpenPnl,
        marginBalance: marginBalance.value,
        balance: balance.value,
        estimatedMaintenanceMargin: estimatedMaintenanceMargin.value,
    });

    currentIndex.value++;
}

function stepOnce() {
    if (currentIndex.value >= masterTimestamps.value.length) return;
    advanceOneStep();
}

async function runReplay() {
    isReplaying.value = true;
    stopRequested = false;
    try {
        while (currentIndex.value < masterTimestamps.value.length && !stopRequested) {
            advanceOneStep();
            UI_STATUS_MESSAGE.value = `replaying: ${currentIndex.value}/${masterTimestamps.value.length}`;
            if (stepDelayMs.value > 0) {
                await new Promise(resolve => setTimeout(resolve, stepDelayMs.value));
            }
        }
    } finally {
        isReplaying.value = false;
        UI_STATUS_MESSAGE.value = stopRequested ? 'stopped' : 'replay complete';
    }
}

function stopReplay() {
    stopRequested = true;
}

function buildExportPayload() {
    return {
        exportedAt: Date.now(),
        startingBalance: startingBalance.value,
        replayRange: {
            startTimestamp: masterTimestamps.value[0] ?? null,
            endTimestamp: masterTimestamps.value[masterTimestamps.value.length - 1] ?? null,
            currentTimestamp: masterTimestamps.value[Math.min(currentIndex.value, masterTimestamps.value.length - 1)] ?? null,
            stepsCompleted: currentIndex.value,
            totalSteps: masterTimestamps.value.length,
        },
        // symbolsLoaded is whatever actually got SymbolInfo data (only
        // the interesting subset, if that filter was on for this run).
        // allKnownSymbols is the full scannable universe regardless of
        // filtering - together they tell you how selective this run's
        // filter actually was (e.g. "134 of 336 qualified") without
        // needing a separate symbolInfo batch to cross-reference.
        symbolsLoaded: Array.from(symbolCandles.keys()),
        allKnownSymbols: chocoMintoStore.futureSymbols.map((s: any) => s.symbol),
        finalStats: { ...stats.value },
        finalBalance: {
            balance: balance.value,
            marginBalance: marginBalance.value,
            estimatedMarginUsed: estimatedMarginUsed.value,
            estimatedMaintenanceMargin: estimatedMaintenanceMargin.value,
        },
        resolvedPositions: resolvedPositionsLog.value,
        stillOpenPositions: openPositionsDisplay.value.map(row => ({
            symbol: row.symbol,
            openTime: row.openTime,
            side: row.position.side,
            entryPrice: row.position.entryPrice,
            sl: row.position.sl,
            tp: row.position.tp,
            margin: row.position.margin,
            leverage: row.position.leverage,
            entryFee: row.position.entryFee,
            currentPrice: row.currentPrice,
            markToMarketPnl: row.markToMarketPnl,
            walkingPnl: [...row.position.walkingPnl],
            openGi: row.position.openGi,
        })),
        snapshots: snapshots.value,
    };
}

/**
 * Exports everything this run has produced as a single downloadable
 * JSON file - the replay's own output (settled positions with their
 * full walkingPnl histories, the account snapshot history, whatever's
 * still open) plus enough run metadata to know exactly what produced
 * it. Works at any point, not just after a full run completes - useful
 * for exporting a stopped-early or still-in-progress replay too.
 *
 * Deliberately does NOT re-export the underlying symbolInfo/candle
 * data itself - that's already capturable separately, and duplicating
 * potentially hundreds of symbols' full candle histories into every
 * export would make this unwieldy for what it's actually for. This is
 * specifically the REPLAY's own output: the things that only exist as
 * a result of walking the timeline, not what was already sitting in
 * the raw capture beforehand.
 */
function exportResult() {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateLabel = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `trade-replay-${dateLabel}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

onUnmounted(() => {
    stopRequested = true;
});
</script>

<style scoped>
.timestamps-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.timestamp-box {
  background-color: #ccc;
  padding: 2px 2px;
  border-radius: 2px;
  font-size: 0.75rem;
  white-space: nowrap;
  flex: 1 1 auto;
  text-align: center;
  min-width: 10px;
  max-width: 40px;
  cursor: pointer;
}

.timestamp-box.passed {
  background-color: #4ea855;
}

.replay-snap-wrapper {
  max-height: 77vh;
  overflow-y: auto;
}
</style>