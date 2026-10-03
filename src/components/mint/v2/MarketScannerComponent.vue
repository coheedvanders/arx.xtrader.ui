<template>
    <CardComponent class="market-scanner pa-sm mr-sm">
        <CardBodyComponent class="market-scanner-body">

            <!-- Progress -->
            <div v-if="progressCounter > 0" class="scanner-progress">
                <div class="scanner-progress-header">
                    <span>Market Scan</span>
                    <span>{{ progressCounter }}/{{ futureSymbols.length }}</span>
                </div>

                <ProgressBarComponent
                    :max="futureSymbols.length"
                    :value="progressCounter"
                />
            </div>

            <!-- Filters: show only symbols with an open position / a closed
                 position / a won position. Checked boxes are OR'd; none
                 checked shows everything. Counts are this batch's matches. -->
            <div class="scanner-filters">
                <label :class="{ 'scanner-filter-active': filterOpen }">
                    <input type="checkbox" v-model="filterOpen" /> open ({{ filterCounts.open }})
                </label>
                <label :class="{ 'scanner-filter-active': filterClosed }">
                    <input type="checkbox" v-model="filterClosed" /> closed ({{ filterCounts.closed }})
                </label>
                <label :class="{ 'scanner-filter-active': filterWon }">
                    <input type="checkbox" v-model="filterWon" /> won ({{ filterCounts.won }})
                </label>
            </div>

            <!-- Symbols -->
            <div class="scanner-list">
                <div
                    v-for="futureSymbol in filteredSymbols"
                    :key="futureSymbol.symbol"
                    class="scanner-row"
                    :class="{
                        'scanner-row-visited': visitedSymbols.has(futureSymbol.symbol),
                        'scanner-row-processing': statusOf(futureSymbol) === 'processing',
                        'scanner-row-hit': conditionOf(futureSymbol),
                        'scanner-row-position-opened': futureSymbol.positionInteraction === 'OPENED',
                        'scanner-row-position-closed': futureSymbol.positionInteraction === 'CLOSED'
                    }"
                    @click="showEntryHistoryModal(futureSymbol)"
                >
                    <!-- Symbol -->
                    <div class="scanner-symbol">
                        <span class="scanner-status-dot"></span>
                        <span class="symbol-name">
                            {{ futureSymbol.symbol }}
                        </span>
                    </div>

                    <!-- Condition -->
                    <div class="scanner-condition">
                        <span
                            v-if="conditionOf(futureSymbol)"
                            class="condition-badge"
                        >
                            {{ conditionOf(futureSymbol) }}
                        </span>
                    </div>

                    <!-- Status -->
                    <div class="scanner-status">
                        {{ statusOf(futureSymbol) }}
                    </div>
                </div>

                <div
                    v-if="futureSymbols.length === 0"
                    class="scanner-empty"
                >
                    No symbols
                </div>
                <div
                    v-else-if="filteredSymbols.length === 0"
                    class="scanner-empty"
                >
                    No symbols match the filter
                </div>
            </div>

        </CardBodyComponent>
    </CardComponent>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
        <DialogHeaderComponent>
            {{ selectedSymbol }}
        </DialogHeaderComponent>
        <CandleVisualizerV2Component :symbol="selectedSymbol" />
    </DialogComponent>
</template>

<script setup lang="ts">
import CardBodyComponent from '@/components/shared/card/CardBodyComponent.vue';
import CardComponent from '@/components/shared/card/CardComponent.vue';
import type { Candle, FuturesSymbol, SimulationStats } from '@/core/interfaces';
import { computed, reactive, ref } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import ProgressBarComponent from '@/components/shared/ProgressBarComponent.vue';
import DialogComponent from '@/components/shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '@/components/shared/dialog/DialogHeaderComponent.vue';
import type { CandleInfo, SymbolInfo, PositionEntry } from '@/core/interfacesv2';
import { KlineUtility } from '@/utility/klineUtility';
import { klineDbUtilityV2 } from '@/utility/v2/klineDbUtilityV2';
import { CandleAnalyzerV2 } from '@/utility/v2/candleAnalyzerV2';
import { SimulationUtilityV2, type AnalysisCarry } from '@/utility/v2/simulationUtilityV2';
import { forceClosePosition } from '@/utility/v2/analysis/positionEntry';
import { setDisplayPreparer, type PositionInteraction } from '@/utility/v2/liveDisplay';
import CandleVisualizerV2Component from './CandleVisualizerV2Component.vue';
import { getStoredInterestingSymbols } from '@/utility/v2/analysis/symbolInterest';

const chocoMintoStore = useChocoMintoStore();

const props = defineProps<{
    futureSymbols: FuturesSymbol[];
    margin: number;
    interval: string;
    supportAndResistancePeriodLength: number;
    maxInitCandles: number;
    targetTpRoi: number;
    targetSlRoi: number;
    maxOpenPositions: number;
    newCandleTriggerKey: string;
    positionDurationMedian: number;
    /**
     * Epoch ms the scan's window should END at, or 0 for "the most recent
     * candles" - which is what this component did before the prop existed, so
     * leaving the start date empty is provably unchanged behaviour.
     *
     * The parent has always passed this; it was never declared here, so it was
     * silently ignored and every scan read the latest 500 candles whatever date
     * was set.
     */
    simulationStart?: number;
}>();

const emit = defineEmits(['onCompleted']);

const progressCounter = ref(0);

// Row filters (see the template). Read from each symbol's simulationStats,
// which every scan / "next" keeps up to date - in a live run, from its ledger.
const filterOpen = ref(false);
const filterClosed = ref(false);
const filterWon = ref(false);
const hasOpen = (fs: FuturesSymbol) => (fs.simulationStats?.open ?? 0) > 0;
const hasClosed = (fs: FuturesSymbol) => ((fs.simulationStats?.won ?? 0) + (fs.simulationStats?.loss ?? 0) + (fs.simulationStats?.mid ?? 0)) > 0;
const hasWon = (fs: FuturesSymbol) => (fs.simulationStats?.won ?? 0) > 0;
const filterCounts = computed(() => ({
    open: props.futureSymbols.filter(hasOpen).length,
    closed: props.futureSymbols.filter(hasClosed).length,
    won: props.futureSymbols.filter(hasWon).length,
}));
const filteredSymbols = computed(() => {
    if (!filterOpen.value && !filterClosed.value && !filterWon.value) return props.futureSymbols;
    return props.futureSymbols.filter(fs =>
        (filterOpen.value && hasOpen(fs)) || (filterClosed.value && hasClosed(fs)) || (filterWon.value && hasWon(fs)));
});
const showEntryHistory = ref(false);
const selectedSymbol = ref("");

const currentFutureSumbol = ref<FuturesSymbol>();
const visitedSymbols = ref<Set<string>>(new Set());

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** How many period fetches run at once (one 500-candle klines call per symbol). */
const PERIOD_FETCH_CONCURRENCY = 6;

/**
 * PERIODS - the trading model. From the start date, every `maxInitCandles`
 * (500) candles is one PERIOD: the candles that are tradable together.
 *
 * A period begins with only its candle 0 revealed. "next" reveals one more
 * candle; the analysis runs on that candle ONLY (resumed from the carry), and
 * the result is identical to running runAnalysis once over every revealed
 * candle (verified field-for-field, positions included). An entry can therefore
 * only ever open on the newest revealed candle. When the period is fully
 * revealed the next step is the NEXT PERIOD: whatever is still open is closed
 * (PERIOD_END) at the period's last candle, and the following 500 candles start
 * again from candle 0. Analysis starts fresh in every period - only the
 * period's own candles exist for it.
 *
 * The ledger keeps every position since "run all simulation", across periods,
 * so the stats count the whole run.
 */
interface PeriodState {
    /** The whole period's candles, raw, fetched up front. */
    all: CandleInfo[];
    /** SymbolInfo whose candle_15m is the REVEALED prefix of `all`. */
    symbolInfo: SymbolInfo;
    carry: AnalysisCarry | null;
    openPosition: PositionEntry | null;
    ledger: PositionEntry[];
    /** The stored copy (what the chart reads) is behind the revealed candles. */
    dirty: boolean;
}
const periodStates = new Map<string, PeriodState>();

/**
 * The newest revealed candle's conditions per symbol, for the scanner rows.
 * Kept HERE, not on the store's FuturesSymbol.conditionMet: they change on most
 * symbols every step, and every write to a store symbol is snapshotted by the
 * dev tools (~25 ms each) - a local reactive Map is not.
 */
const periodConditions = reactive(new Map<string, string>());
/** True while this batch holds periods (so rows show periodConditions). */
const periodMode = ref(false);

/** Row status text in period mode - local for the same reason as periodConditions. */
const periodStatus = reactive(new Map<string, string>());
function setPeriodStatus(futureSymbol: FuturesSymbol, status: string) {
    if (periodStatus.get(futureSymbol.symbol) !== status) periodStatus.set(futureSymbol.symbol, status);
}
/** The status text a row shows. */
function statusOf(futureSymbol: FuturesSymbol): string {
    return periodMode.value ? (periodStatus.get(futureSymbol.symbol) ?? "") : futureSymbol.status;
}

/** The conditions text a row shows. */
function conditionOf(futureSymbol: FuturesSymbol): string {
    return periodMode.value ? (periodConditions.get(futureSymbol.symbol) ?? "") : futureSymbol.conditionMet;
}

/** openTime of the current period's candle 0 (0 before the first scan). */
const periodStartMs = ref(0);

/** Drops every period this scanner holds (a fresh scan / capture rebuilds them). */
function clearPeriods() {
    for (const symbol of periodStates.keys()) setDisplayPreparer(symbol, null);
    periodStates.clear();
    periodConditions.clear();
    periodStatus.clear();
    periodMode.value = false;
}

/** The chart reads IndexedDB; a period window is only stored when it is looked at. */
async function storeWindowForDisplay(symbol: string): Promise<void> {
    const st = periodStates.get(symbol);
    if (!st || !st.dirty) return;
    await klineDbUtilityV2.storeSymbolInfo(st.symbolInfo);
    st.dirty = false;
}

/** Fetches one symbol's period: up to maxInitCandles candles from startMs (never past now). */
async function fetchPeriod(symbol: string, startMs: number): Promise<CandleInfo[]> {
    const to = Math.min(startMs + (props.maxInitCandles - 1) * FIFTEEN_MIN_MS, Date.now());
    if (to < startMs) return [];
    const raw = (await KlineUtility.getRecentKlinesByRange(symbol, props.interval, props.maxInitCandles, startMs, to))
        .filter(c => c.openTime >= startMs && c.openTime <= to);
    return SimulationUtilityV2.mapToInfo(raw);
}

function emptySymbolInfo(name: string, candles: CandleInfo[]): SymbolInfo {
    return {
        name, candle_15m: candles,
        candle_1h: [], candle_4h: [], candle_1d: [],
        oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
        ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
        trendstats_15m: null,
    };
}

function setStatusFromStats(futureSymbol: FuturesSymbol) {
    if (!chocoMintoStore.isManualSimulation) return;
    const s = futureSymbol.simulationStats;
    if (!s) return;
    const status = `${s.won}/${s.loss}/${s.open}-${s.mid}`;
    setPeriodStatus(futureSymbol, status);
}

/** Whether every symbol in this batch has revealed its whole period. */
function periodFullyRevealed(): boolean {
    for (const st of periodStates.values()) if (st.symbolInfo.candle_15m.length < st.all.length) return false;
    return true;
}

/** How far the batch is into the period: the most candles any symbol has revealed. */
function periodProgress(): { revealed: number; length: number } {
    let revealed = 0;
    for (const st of periodStates.values()) revealed = Math.max(revealed, st.symbolInfo.candle_15m.length);
    return { revealed, length: props.maxInitCandles };
}

/**
 * Loads the period starting at `startMs` for every symbol and reveals its
 * candle 0. `keepLedgers`: carry each symbol's ledger over (next period) or
 * start fresh (a new scan).
 */
async function loadPeriod(startMs: number, keepLedgers: boolean): Promise<void> {
    const ledgers = new Map<string, PositionEntry[]>();
    if (keepLedgers) for (const [s, st] of periodStates) ledgers.set(s, st.ledger);
    clearPeriods();
    periodStartMs.value = startMs;
    periodMode.value = true;

    const interestingSymbols = getStoredInterestingSymbols();
    const interestFilter = interestingSymbols.length > 0 ? new Set(interestingSymbols) : null;

    let cursor = 0, done = 0;
    const loading = new Set<string>();
    const worker = async (): Promise<void> => {
        while (true) {
            const i = cursor++;
            if (i >= props.futureSymbols.length) return;
            const futureSymbol = props.futureSymbols[i];
            if (futureSymbol.positionInteraction) futureSymbol.positionInteraction = null;
            // A symbol listed twice is loaded once.
            if (loading.has(futureSymbol.symbol)) { done++; continue; }
            loading.add(futureSymbol.symbol);
            try {
                if (interestFilter && !interestFilter.has(futureSymbol.symbol)) {
                    setPeriodStatus(futureSymbol, "skipped (not interesting)");
                    continue;
                }
                const all = await fetchPeriod(futureSymbol.symbol, startMs);
                if (!all.length) { setPeriodStatus(futureSymbol, "no candles in period"); continue; }

                const window = [all[0]];
                const symbolInfo = emptySymbolInfo(futureSymbol.symbol, window);
                const { openPosition, carry } = await SimulationUtilityV2.runMarketAnalysis(
                    symbolInfo, [], null, undefined, undefined, true, true, true, null
                );
                const ledger = ledgers.get(futureSymbol.symbol) ?? [];
                periodStates.set(futureSymbol.symbol, { all, symbolInfo, carry, openPosition, ledger, dirty: true });
                setDisplayPreparer(futureSymbol.symbol, () => storeWindowForDisplay(futureSymbol.symbol));
                updateStoreFutureSymbolSimulationStats(futureSymbol.symbol, window, ledger, futureSymbol);
                setStatusFromStats(futureSymbol);
                if (!chocoMintoStore.isManualSimulation) setPeriodStatus(futureSymbol, "-");
            } catch (error) {
                console.error("loadPeriod", futureSymbol.symbol, error);
                setPeriodStatus(futureSymbol, "period load failed");
            } finally {
                done++;
                progressCounter.value = done;
            }
        }
    };
    try {
        await Promise.all(Array.from({ length: PERIOD_FETCH_CONCURRENCY }, worker));
    } finally {
        progressCounter.value = 0;
    }
}

/** "run all simulation": period 1, from the start date (or the latest full period without one). */
async function runInitialScan() {
    console.log("runInitialScan", props.futureSymbols.length);
    let startMs = props.simulationStart ?? 0;
    if (!startMs) {
        // No start date: the most recent `maxInitCandles` closed candles.
        const lastClosed = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
        startMs = lastClosed - (props.maxInitCandles - 1) * FIFTEEN_MIN_MS;
    }
    await loadPeriod(startMs, false);
    emit('onCompleted');
}

/**
 * The interaction a step produced on a symbol's newest candle: a position
 * opened on it, or one closed on it (never both - no entry on a closing candle).
 */
function interactionOnNewest(futureSymbol: FuturesSymbol, candles: CandleInfo[]): PositionInteraction | null {
    const newestIdx = candles.length - 1;
    const newest = candles[newestIdx];
    const pe = newest?.positionEntry;
    if (!pe) return null;
    const base = { symbol: futureSymbol.symbol, side: pe.side, entryPrice: pe.entryPrice, sl: pe.sl, tp: pe.tp, openTime: pe.openTime, candleOpenTime: newest.openTime };
    if (pe.openTime === newest.openTime) return { ...base, kind: "OPENED" };
    if (pe.status !== "OPEN" && pe.closeGi === newestIdx) {
        return {
            ...base, kind: "CLOSED", status: pe.status, closeReason: pe.closeReason ?? null,
            exitPrice: pe.exitPrice ?? null,
            netPnl: pe.pnl == null ? null : pe.pnl - (pe.entryFee ?? 0) - (pe.exitFee ?? 0),
        };
    }
    return null;
}

/**
 * Reveals up to `count` more candles of the current period for every symbol
 * (Infinity = the rest of the period), analysing only the newly revealed
 * candles. Interactions are reported for the LAST revealed candle (a single
 * "next"), or counted across all of them (reveal all).
 */
async function revealCandles(count: number): Promise<{
    advanced: number; lastOpenTime: number | null; interactions: PositionInteraction[];
    openedCount: number; closedCount: number; periodComplete: boolean; revealed: number; periodLength: number;
}> {
    let advanced = 0, openedCount = 0, closedCount = 0;
    let lastOpenTime: number | null = null;
    let lastYieldAt = performance.now();
    const interactions: PositionInteraction[] = [];
    for (const fs of props.futureSymbols) if (fs.positionInteraction) fs.positionInteraction = null;

    const stepped = new Set<string>();
    for (let i = 0; i < props.futureSymbols.length; i++) {
        const futureSymbol = props.futureSymbols[i];
        const st = periodStates.get(futureSymbol.symbol);
        if (i % 25 === 0) progressCounter.value = i + 1;
        // A symbol listed twice is revealed once per step.
        if (!st || stepped.has(futureSymbol.symbol)) continue;
        stepped.add(futureSymbol.symbol);
        const window = st.symbolInfo.candle_15m;
        const from = window.length;
        const to = Math.min(st.all.length, from + count);
        if (to <= from) continue;
        try {
            const ledgerBefore = st.ledger.length;
            const closedBefore = st.ledger.filter(p => p.status !== "OPEN").length;
            for (let k = from; k < to; k++) window.push(st.all[k]);
            currentFutureSumbol.value = futureSymbol;

            // Only the new candles are analysed (resume) - same result as one
            // runAnalysis over the whole revealed window. Entries are allowed on
            // every new candle: each is decided with only the candles up to it.
            const before = st.openPosition;
            const result = await SimulationUtilityV2.runMarketAnalysis(
                st.symbolInfo, [], before, undefined, undefined, true, true, true, null,
                st.carry ? { resume: st.carry } : {}
            );
            st.carry = result.carry;
            st.openPosition = result.openPosition;
            st.dirty = true;

            // Every position that opened among the new candles joins the ledger.
            const seen = new Set(st.ledger);
            for (let k = from; k < to; k++) {
                const pe = window[k].positionEntry;
                if (pe && !seen.has(pe)) { st.ledger.push(pe); seen.add(pe); }
            }
            openedCount += st.ledger.length - ledgerBefore;
            closedCount += st.ledger.filter(p => p.status !== "OPEN").length - closedBefore;

            // The newest candle's conditions, written once and only when they changed.
            const conditions = (window[window.length - 1].conditions_met ?? []).filter(c => !c.includes("TREND_")).join(", ");
            if (periodConditions.get(futureSymbol.symbol) !== conditions) periodConditions.set(futureSymbol.symbol, conditions);
            updateStoreFutureSymbolSimulationStats(futureSymbol.symbol, window, st.ledger, futureSymbol);
            setStatusFromStats(futureSymbol);

            const interaction = to - from === 1 ? interactionOnNewest(futureSymbol, window) : null;
            if (interaction) {
                futureSymbol.positionInteraction = interaction.kind;
                interactions.push(interaction);
            }
            advanced++;
            lastOpenTime = Math.max(lastOpenTime ?? 0, window[window.length - 1].openTime);
        } catch (error) {
            console.error("revealCandles", futureSymbol.symbol, error);
        }

        if (performance.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
            await yieldToBrowser();
            lastYieldAt = performance.now();
        }
    }

    progressCounter.value = 0;
    const { revealed, length } = periodProgress();
    return { advanced, lastOpenTime, interactions, openedCount, closedCount, periodComplete: periodFullyRevealed(), revealed, periodLength: length };
}

/** Where this batch is in its period (for the page's period display / buttons). */
function getPeriodInfo(): { startMs: number; revealed: number; length: number; complete: boolean; loaded: boolean } {
    const { revealed, length } = periodProgress();
    return { startMs: periodStartMs.value, revealed, length, complete: periodFullyRevealed(), loaded: periodStates.size > 0 };
}

/** "next": reveal one more candle of the current period. */
async function stepNextCandle() {
    return revealCandles(1);
}

/** "Reveal All Candles": the rest of the current period at once. */
async function revealAllCandles() {
    return revealCandles(Infinity);
}

/**
 * "Next Period": closes every position still open (PERIOD_END, at the period's
 * last revealed candle), then loads the following period and reveals its
 * candle 0. Returns what the closes were.
 */
async function startNextPeriod(): Promise<{ closed: PositionInteraction[]; periodStartMs: number }> {
    const closed: PositionInteraction[] = [];
    for (const futureSymbol of props.futureSymbols) {
        const st = periodStates.get(futureSymbol.symbol);
        if (!st?.openPosition || st.openPosition.status !== "OPEN") continue; // (a repeat finds it already closed)
        const window = st.symbolInfo.candle_15m;
        const lastIdx = window.length - 1;
        forceClosePosition(st.openPosition, window[lastIdx], lastIdx, "PERIOD_END");
        window[lastIdx].positionEntry = st.openPosition;
        const interaction = interactionOnNewest(futureSymbol, window);
        if (interaction) closed.push(interaction);
        st.openPosition = null;
        updateStoreFutureSymbolSimulationStats(futureSymbol.symbol, window, st.ledger, futureSymbol);
        setStatusFromStats(futureSymbol);
    }
    const nextStart = (periodStartMs.value || props.simulationStart || 0) + props.maxInitCandles * FIFTEEN_MIN_MS;
    await loadPeriod(nextStart, true);
    return { closed, periodStartMs: nextStart };
}

/** Yield to the browser at most this often while stepping (~a frame of work). */
const YIELD_INTERVAL_MS = 50;

/** One macrotask without setTimeout's ~4 ms clamp (MessageChannel), falling back to setTimeout. */
function yieldToBrowser(): Promise<void> {
    if (typeof MessageChannel === "undefined") return new Promise(resolve => setTimeout(resolve, 0));
    return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
        channel.port2.postMessage(null);
    });
}

/** `positions`, when given (a live run's ledger), is counted instead of the window's candles. */
function updateStoreFutureSymbolSimulationStats(symbol:string, candles:CandleInfo[], positions?: PositionEntry[], target?: FuturesSymbol){
    // `target`: the store's own object when the caller already has it - a batch's
    // futureSymbols ARE the store's objects - so a step does not search 800+.
    var storeFutureSymbol = target ?? chocoMintoStore.futureSymbols.find(s => s.symbol == symbol);
    if(storeFutureSymbol){
        // candle.positionEntry is the SAME mutated object reference on
        // every candle a position spans, from the candle it opened on
        // through every candle it stayed OPEN and the one it finally
        // resolved on (see updatePositionEntry: "mutates and returns the
        // SAME object"). Filtering/summing over candles directly, as this
        // did before, counts and sums each position once per candle it
        // was open for rather than once total — a position open 10
        // candles before winning was counted as 10 wins and its pnl
        // summed 10 times. Dedupe to one entry per distinct position
        // (openGi) FIRST, then count/sum over that.
        const seenOpenGis = new Set<number>();
        const distinctPositions: PositionEntry[] = positions ? [...positions] : [];
        if (!positions) for (const c of candles) {
            const pe = c.positionEntry;
            if (pe && !seenOpenGis.has(pe.openGi)) {
                seenOpenGis.add(pe.openGi);
                distinctPositions.push(pe);
            }
        }

        var won = distinctPositions.filter(p => p.status == "WON").length;
        var loss = distinctPositions.filter(p => p.status == "LOSS").length;
        var mid = distinctPositions.filter(p => p.status == "MID").length;
        var open = distinctPositions.filter(p => p.side && p.tp > 0 && p.sl > 0 && p.status == "OPEN").length;

        var takerFee = distinctPositions.reduce((sum, p) => sum + (p.entryFee ?? 0), 0);
        var closedPnl = distinctPositions.filter(p => p.status == "WON" || p.status == "LOSS").reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        var wonPnl = distinctPositions.filter(p => p.status == "WON").reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        var lossPnl = distinctPositions.filter(p => p.status == "LOSS").reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        var openPnl = distinctPositions.filter(p => p.side && p.tp > 0 && p.sl > 0 && p.status == "OPEN").reduce((sum, p) => sum + (p.pnl ?? 0), 0);

        var simulationStats: SimulationStats = {
            won,
            loss,
            open,
            mid,
            takerFee,
            closedPnl,
            openPnl,
            lossPnl,
            wonPnl
        }

        // Only when something changed: every write to a store symbol is recorded
        // by the dev tools (a snapshot of the whole store, ~25 ms per write), and
        // on most steps most symbols' stats do not change at all.
        const prev = storeFutureSymbol.simulationStats as unknown as Record<string, unknown> | undefined;
        const next = simulationStats as unknown as Record<string, unknown>;
        if (!prev || Object.keys(next).some(k => prev[k] !== next[k])) {
            storeFutureSymbol.simulationStats = simulationStats;
        }
    }
}

function setRecentFutureCandleData(candles: CandleInfo[]){
    var currentCandle = candles[candles.length - 1];
    if (currentCandle.conditions_met.length > 0) {
        currentFutureSumbol.value!.conditionMet = currentCandle.conditions_met.filter(condition => !condition.includes("TREND_")).join(", ")
    }
}

async function showEntryHistoryModal(futureSymbol: FuturesSymbol) {
    // In a live run the chart brings the window up to date itself before
    // loading it (prepareSymbolForDisplay), whichever way it is opened.
    showEntryHistory.value = true;
    selectedSymbol.value = futureSymbol.symbol;
    visitedSymbols.value.add(futureSymbol.symbol);
}

/** Retries for a range fetch that comes back short of the requested end. */
const CAPTURE_FETCH_RETRIES = 4; // waits 5, 10, 20, 40 s
const CAPTURE_RETRY_DELAY_MS = 5000;

/**
 * Minimum time per klines CALL, per batch. Each call of up to 1000 candles
 * costs weight 5. Four batches running unpaced reach ~2,800 weight/min on a
 * 30-day range - over Binance's 2,400 and into 429s (repeated 429s earn a 418
 * IP ban). 667 ms per call per batch caps the four at ~1,800 weight/min.
 * A 30-day range is 3 calls, so 2 s per symbol: ~3 minutes for 300 symbols.
 */
const CAPTURE_MIN_MS_PER_KLINES_CALL = 667;

/**
 * AUTO CAPTURE: every symbol's full [startMs, endMs] range, analyzed and
 * stored whole - nothing is dropped, unlike "next" which keeps the window at
 * maxInitCandles.
 *
 * WHY ONE runMarketAnalysis CALL PER SYMBOL IS "AUTO NEXT". runAnalysis walks
 * the candles forward one at a time and only ever reads candles up to the one
 * it is processing, so walking a range once produces exactly what pressing
 * "next" on a never-trimmed window would leave behind after the last press:
 * each press re-derives the same earlier candles identically, then the new
 * one. Doing it as one walk is the same result without re-deriving the
 * history thousands of times.
 *
 * The first stored candle is the one opening at startMs, so the first ~200
 * candles are indicator warm-up (EMA200 etc.) INSIDE the captured range.
 *
 * Symbols are processed one at a time per batch (the parent runs the four
 * batches together) - a 30-day window is several MB per symbol analyzed, so
 * nothing is kept in memory once it is stored. All symbols are captured; the
 * "interesting symbols" filter does not apply.
 *
 * A fetch that ends before endMs is retried (Binance answers a rate limit with
 * a non-array body, which getRecentKlinesByRange treats as "no more data").
 * A symbol that still ends early - delisted, or genuinely short - is stored
 * with what it has and says so in its status.
 */
async function autoCaptureRange(
    startMs: number,
    endMs: number,
    shouldStop: () => boolean,
    onSymbolDone?: () => void
): Promise<{ captured: number; candles: number; stopped: boolean }> {
    clearPeriods();

    // The last CLOSED candle's openTime, on a 15m boundary. Unaligned (e.g.
    // now - 15m = 14:22:37), no candle could ever reach it, so every complete
    // symbol was flagged "ends early" and refetched for nothing - and those
    // extra calls are what drew the rate limits that truncated real fetches.
    const lastClosedOpenTime = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - FIFTEEN_MIN_MS;
    const lastWantedOpenTime = Math.min(
        startMs + Math.floor((endMs - startMs) / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS,
        lastClosedOpenTime
    );
    const expected = Math.floor((lastWantedOpenTime - startMs) / FIFTEEN_MIN_MS) + 1;
    let captured = 0;
    let totalCandles = 0;
    const minMsPerSymbol = Math.ceil(expected / 1000) * CAPTURE_MIN_MS_PER_KLINES_CALL;

    for (let s = 0; s < props.futureSymbols.length; s++) {
        if (shouldStop()) {
            progressCounter.value = 0;
            return { captured, candles: totalCandles, stopped: true };
        }

        const futureSymbol = props.futureSymbols[s];
        progressCounter.value = s + 1;
        currentFutureSumbol.value = futureSymbol;
        const symbolStartedAt = Date.now();

        try {
            futureSymbol.status = "fetching";
            // A short fetch RESUMES from its last candle instead of refetching
            // the whole range: a rate-limited page cut the fetch at a page
            // boundary, and refetching all of it just asks for the same limit
            // again. The wait doubles on each retry so the limit can clear.
            let raw: Candle[] = [];
            for (let attempt = 0; attempt <= CAPTURE_FETCH_RETRIES; attempt++) {
                const from = raw.length ? raw[raw.length - 1].openTime + FIFTEEN_MIN_MS : startMs;
                const remaining = Math.floor((lastWantedOpenTime - from) / FIFTEEN_MIN_MS) + 1;
                const page = await KlineUtility.getRecentKlinesByRange(
                    futureSymbol.symbol, props.interval, remaining, from, lastWantedOpenTime);
                const lastSoFar = raw.length ? raw[raw.length - 1].openTime : -Infinity;
                raw.push(...page.filter(c => c.openTime > lastSoFar));
                const last = raw.length ? raw[raw.length - 1].openTime : 0;
                if (last >= lastWantedOpenTime || attempt === CAPTURE_FETCH_RETRIES) break;
                futureSymbol.status = `short fetch, retry ${attempt + 1}`;
                await new Promise(resolve => setTimeout(resolve, CAPTURE_RETRY_DELAY_MS * 2 ** attempt));
            }
            // <= lastWantedOpenTime also keeps the still-forming candle out.
            const candles = SimulationUtilityV2.mapToInfo(raw).filter(c => c.openTime >= startMs && c.openTime <= lastWantedOpenTime);
            if (candles.length < 2) {
                futureSymbol.status = "no data in range";
                continue;
            }

            let gaps = 0;
            for (let k = 1; k < candles.length; k++) {
                if (candles[k].openTime - candles[k - 1].openTime !== FIFTEEN_MIN_MS) gaps++;
            }

            const symbolInfo: SymbolInfo = {
                name: futureSymbol.symbol,
                candle_15m: candles,
                candle_1h: [], candle_4h: [], candle_1d: [],
                oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
                ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
                trendstats_15m: null,
            };

            futureSymbol.status = "processing";
            await SimulationUtilityV2.runMarketAnalysis(symbolInfo, []);

            // Awaited here (not fire-and-forget like the scan): the next
            // symbol's multi-MB window must not pile up behind pending writes.
            await klineDbUtilityV2.storeSymbolInfo(symbolInfo);
            setRecentFutureCandleData(symbolInfo.candle_15m);
            updateStoreFutureSymbolSimulationStats(symbolInfo.name, symbolInfo.candle_15m);

            captured++;
            totalCandles += candles.length;
            const endedEarly = candles[candles.length - 1].openTime < lastWantedOpenTime;
            const startedLate = candles[0].openTime > startMs;
            futureSymbol.status =
                `captured ${candles.length}`
                + (startedLate ? " (listed later)" : "")
                + (endedEarly ? " (ends early)" : "")
                + (gaps ? ` (${gaps} gap${gaps === 1 ? "" : "s"})` : "");
        } catch (error) {
            console.error("autoCaptureRange", futureSymbol.symbol, error);
            futureSymbol.status = "capture failed";
        } finally {
            onSymbolDone?.();
        }

        // Rate-limit pacing (see CAPTURE_MIN_MS_PER_KLINES_CALL); also lets
        // the page repaint and the other batches interleave.
        const elapsed = Date.now() - symbolStartedAt;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, minMsPerSymbol - elapsed)));
    }

    progressCounter.value = 0;
    return { captured, candles: totalCandles, stopped: false };
}

defineExpose({
    runInitialScan,
    stepNextCandle,
    revealAllCandles,
    startNextPeriod,
    getPeriodInfo,
    autoCaptureRange
});
</script>

<style scoped>
.market-scanner {
    overflow: hidden;
}

.market-scanner-body {
    padding: 6px 8px;
}

.scanner-progress {
    margin-bottom: 7px;
}

.scanner-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3px;

    font-size: 10px;
    line-height: 12px;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}

.scanner-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin-bottom: 6px;
    font-size: 11px;
}

.scanner-filters label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    opacity: 0.75;
    user-select: none;
}

.scanner-filters label.scanner-filter-active {
    opacity: 1;
    font-weight: 600;
}

.scanner-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.scanner-row {
    display: grid;
    grid-template-columns: 115px 1fr auto;
    align-items: center;

    min-height: 25px;
    padding: 2px 6px;

    border-radius: 3px;

    font-size: 11px;
    line-height: 15px;

    cursor: pointer;

    transition:
        background-color 0.1s ease,
        transform 0.1s ease;
}

.scanner-row:hover {
    background: rgba(128, 128, 128, 0.10);
}

.scanner-row:active {
    transform: translateY(1px);
}

.scanner-row-visited {
    color: #d99a32;
}

.scanner-row-processing {
    background: rgba(128, 128, 128, 0.08);
}

.scanner-row-hit {
    background: rgba(128, 128, 128, 0.06);
}

/* A position OPENED on this symbol's newest candle on the last "next". */
.scanner-row-position-opened {
    background: rgba(76, 175, 80, 0.28);
    box-shadow: inset 3px 0 0 #4caf50;
}

.scanner-row-position-opened .scanner-status-dot {
    background: #4caf50;
    box-shadow: 0 0 5px rgba(76, 175, 80, 0.8);
}

/* A position CLOSED on this symbol's newest candle on the last "next". */
.scanner-row-position-closed {
    background: rgba(229, 57, 53, 0.25);
    box-shadow: inset 3px 0 0 #e53935;
}

.scanner-row-position-closed .scanner-status-dot {
    background: #e53935;
    box-shadow: 0 0 5px rgba(229, 57, 53, 0.8);
}

.scanner-symbol {
    display: flex;
    align-items: center;
    gap: 5px;

    min-width: 0;
}

.symbol-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.scanner-status-dot {
    width: 5px;
    height: 5px;
    flex: 0 0 5px;

    border-radius: 50%;
    background: #777;
}

.scanner-row-processing .scanner-status-dot {
    background: #e0a020;
    box-shadow: 0 0 4px rgba(224, 160, 32, 0.6);
}

.scanner-row-hit .scanner-status-dot {
    background: #4caf50;
}

.scanner-condition {
    min-width: 0;
    overflow: hidden;
}

.condition-badge {
    display: inline-block;

    max-width: 100%;
    padding: 1px 5px;

    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 3px;

    font-size: 9px;
    line-height: 13px;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    background: rgba(128, 128, 128, 0.08);
}

.scanner-status {
    min-width: 55px;

    text-align: right;

    font-size: 10px;
    font-family: monospace;

    color: var(--text-secondary, #888);
}

.scanner-empty {
    padding: 12px;

    text-align: center;

    font-size: 10px;
    color: var(--text-secondary, #888);
}
</style>