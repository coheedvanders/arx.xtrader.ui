<template>
    <div>
        <label class="mr-sm">start date/time
            <input type="datetime-local" v-model="startDateTimeInput" :disabled="isRunning" class="datetime-input" />
        </label>
        <ButtonComponent rounded color="ghost" @click="runRollingSimulation" :disabled="isRunning || !startDateTimeInput">run trade simulation</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="stopSimulation" :disabled="!isRunning">stop</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="resetRun" :disabled="isRunning">reset run</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="exportResult" :disabled="isRunning || (resolvedPositionsLog.length === 0 && openPositionsDisplay.length === 0)">export result</ButtonComponent>

        <label class="ml-sm">starting balance
            <InputComponent v-model.number="startingBalance" :disabled="isRunning" />
        </label>

        <div class="text-center">{{ statusMessage }}</div>
        <div class="text-center" v-if="completionEstimateDisplay">
            {{ completionEstimateDisplay.progressPercent.toFixed(1) }}% —
            <template v-if="completionEstimateDisplay.estimatedCompletionTimestamp != null">
                est. completion: {{ new Date(completionEstimateDisplay.estimatedCompletionTimestamp).toLocaleString() }}
            </template>
            <template v-else-if="completionEstimateDisplay.observedMsPerCandle != null">
                (processing slower than real time is passing — no finite estimate yet)
            </template>
            <template v-else>
                (measuring rate...)
            </template>
        </div>

        <div class="row">
            <div class="col-lg-3 col-md-3 pa-md">
                <div>Symbols Loaded: {{ symbolStates.size }}</div>
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
                <TabComponent v-model="selectedTab">
                    <TabListComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'Account'">Account Balance</TabTriggerComponent>
                        <TabTriggerComponent v-model="selectedTab" :value="'OpenPositions'">Open Positions</TabTriggerComponent>
                    </TabListComponent>

                    <TabContentComponent v-model="selectedTab" :value="'Account'">
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
                                    <tr v-for="snap in pagedSnapshots" :key="snap.timestamp">
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
                        <div class="text-center pa-sm">
                            <ButtonComponent color="ghost" :disabled="snapshotsPage <= 1" @click="snapshotsPage--">prev</ButtonComponent>
                            page {{ snapshotsPage }} / {{ totalSnapshotsPages }}
                            <ButtonComponent color="ghost" :disabled="snapshotsPage >= totalSnapshotsPages" @click="snapshotsPage++">next</ButtonComponent>
                        </div>
                    </TabContentComponent>

                    <TabContentComponent v-model="selectedTab" :value="'OpenPositions'">
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
                                    <th>PNL</th>
                                    <th>Why</th>
                                </TableHeaderComponent>
                            </template>
                            <template #body>
                                <TableBodyComponent>
                                    <tr v-for="row in pagedOpenPositions" :key="row.symbol">
                                        <td>{{ new Date(row.openTime).toLocaleString() }}</td>
                                        <td>{{ row.symbol }}</td>
                                        <td>{{ row.position.side }}</td>
                                        <td>{{ row.position.entryPrice }}</td>
                                        <td>{{ row.currentPrice }}</td>
                                        <td>{{ row.position.tp }}</td>
                                        <td>{{ row.position.sl }}</td>
                                        <td>{{ row.markToMarketPnl.toFixed(2) }}</td>
                                        <td>{{ row.position.entryReason.summary }}</td>
                                    </tr>
                                </TableBodyComponent>
                            </template>
                        </TableComponent>
                        <div class="text-center pa-sm">
                            <ButtonComponent color="ghost" :disabled="openPositionsPage <= 1" @click="openPositionsPage--">prev</ButtonComponent>
                            page {{ openPositionsPage }} / {{ totalOpenPositionsPages }} ({{ openPositionsDisplay.length }} total)
                            <ButtonComponent color="ghost" :disabled="openPositionsPage >= totalOpenPositionsPages" @click="openPositionsPage++">next</ButtonComponent>
                        </div>
                    </TabContentComponent>
                </TabComponent>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * Rolling-window "rigorous test" mode: fetches live from a chosen start
 * date, runs the real analysis pipeline on a bounded 500-candle window
 * per symbol, and walks forward exactly like a real bot would - unable
 * to hold unlimited history, sliding the window one candle at a time
 * as it catches up to the current real-world moment. No symbol-interest
 * filtering (there's no way to know a candle is "interesting" until
 * you've already analyzed it in this mode) - every known future symbol
 * is tested, deliberately, as a rigorous baseline.
 *
 * Distinct from the OTHER mode this component supports (loading
 * already-captured, already-analyzed data and replaying it) — this
 * mode does the fetching AND analyzing itself, live, as it goes.
 *
 * THE CENTRAL TECHNICAL PROBLEM this had to solve: a position can be
 * open when its own window shifts (oldest candle dropped, one new
 * candle appended). CandleInfo array indices (gi) are NOT stable
 * identities - candle.positionEntry.openGi means "index into THIS
 * PARTICULAR array", which changes meaning entirely once the array
 * shifts. Fixed by:
 *   1. simulationUtilityV2.ts's runAnalysis/runMarketAnalysis accepting
 *      an optional initialOpenPosition + returning the final state, so
 *      a position can be carried forward across calls instead of
 *      always starting fresh.
 *   2. Remapping openGi/closeGi by exactly -1 on every shift (the one
 *      offset every remaining candle's OWN index moved by).
 *   3. runAnalysis's own loop respecting a resumed position's (possibly
 *      already-remapped, possibly negative once its own opening candle
 *      has aged out of the window entirely) openGi - only calling
 *      updatePositionEntry once the loop actually reaches it, never
 *      before, which took a real bug fix to get right (see
 *      positionEntry.ts/simulationUtilityV2.ts's own comments).
 * Every one of these was verified with a dedicated test against the
 * real compiled logic, not just reasoned through - including the
 * negative-openGi case specifically, since that's the one most likely
 * to look "probably fine" without actually running it.
 */
import type { CandleInfo, SymbolInfo, PositionEntry } from '@/core/interfacesv2';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { SimulationUtilityV2 } from '@/utility/v2/simulationUtilityV2';
import { KlineUtility } from '@/utility/klineUtility';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';
import { estimateCompletion, FIFTEEN_MIN_MS, type CompletionEstimate } from '@/utility/v2/analysis/completionEstimate';
import { computed, onUnmounted, ref, watch } from 'vue';
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

const WINDOW_SIZE = 500;
const MAX_POSITION_DURATION_CANDLES = 250;
const PAGE_SIZE = 50;

const START_DATETIME_STORAGE_KEY = 'rolling-simulation-start-datetime';
const startDateTimeInput = ref(localStorage.getItem(START_DATETIME_STORAGE_KEY) ?? '');
watch(startDateTimeInput, (value) => {
    localStorage.setItem(START_DATETIME_STORAGE_KEY, value);
});
const startingBalance = ref(props.startingBalance);
const isRunning = ref(false);
const statusMessage = ref('');
const selectedTab = ref('Account');
let stopRequested = false;

interface SymbolRollingState {
    window: CandleInfo[];
    stagingCandles: CandleInfo[];
    lastFetchedOpenTime: number | null;
    openPosition: PositionEntry | null;
    // The ABSOLUTE openTime of the current openPosition, captured once
    // at the moment it opens and never recomputed afterward - openGi
    // alone can't answer "when did this actually open" once several
    // shifts have pushed its own opening candle out of the window
    // entirely (openGi can go negative; there's no candle left at that
    // index to read a timestamp from).
    openPositionOpenTime: number | null;
    exhausted: boolean; // true once a fetch returns nothing further - stop trying this symbol
}
const symbolStates = new Map<string, SymbolRollingState>();

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
const openPositionsPage = ref(1);
const totalOpenPositionsPages = computed(() => Math.max(1, Math.ceil(openPositionsDisplay.value.length / PAGE_SIZE)));
const pagedOpenPositions = computed(() => {
    const start = (openPositionsPage.value - 1) * PAGE_SIZE;
    return openPositionsDisplay.value.slice(start, start + PAGE_SIZE);
});

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
    walkingPnl: (number | null)[];
    entryReason: PositionEntry['entryReason'];
}
const resolvedPositionsLog = ref<ResolvedPositionRecord[]>([]);

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
    estimatedMaintenanceMargin: number;
}
const snapshots = ref<AccountSnapshot[]>([]);
const snapshotsPage = ref(1);
const totalSnapshotsPages = computed(() => Math.max(1, Math.ceil(snapshots.value.length / PAGE_SIZE)));
const pagedSnapshots = computed(() => {
    // Chronological (oldest first) - snapshots are already pushed in
    // this order as the walk proceeds. Unlike the old replay tool
    // (which browses a COMPLETED history, where most-recent-first
    // suits scanning back from the end), this one runs forward FROM a
    // chosen start date - page 1 should show that start date so it's
    // easy to confirm the run actually began where you asked it to.
    const start = (snapshotsPage.value - 1) * PAGE_SIZE;
    return snapshots.value.slice(start, start + PAGE_SIZE);
});

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

const completionEstimateDisplay = ref<CompletionEstimate | null>(null);
let runStartTimestamp = 0;
let runStartRealTimeMs = 0;
let candlesProcessedSoFar = 0;

function buildMinimalSymbolInfo(symbol: string, candles: CandleInfo[]): SymbolInfo {
    return {
        name: symbol,
        candle_15m: candles,
        candle_1h: [], candle_4h: [], candle_1d: [],
        // OI/LS deliberately not fetched for this mode - nothing in the
        // current entry logic reads candle.openInterest/longShort, and
        // this is already the heaviest-refetching mode in the app;
        // skipping them halves the network cost per window shift.
        // Binance's own ~30-day retention on those endpoints would
        // also make them mostly empty for anything older anyway.
        oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
        ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
        trendstats_15m: null,
    } as SymbolInfo;
}

function resetRun() {
    symbolStates.clear();
    stats.value = { won: 0, loss: 0, totalTakerFee: 0, totalClosedPnl: 0, totalOpenPnl: 0 };
    openPositionsDisplay.value = [];
    resolvedPositionsLog.value = [];
    snapshots.value = [];
    completionEstimateDisplay.value = null;
    statusMessage.value = '';
    openPositionsPage.value = 1;
    snapshotsPage.value = 1;
}

function stopSimulation() {
    stopRequested = true;
}

/** Fetches and analyzes the FIRST window for one symbol. */
async function initializeSymbol(symbol: string, startTimestamp: number): Promise<void> {
    const raw = await KlineUtility.getRecentKlinesByRange(symbol, '15m', WINDOW_SIZE, startTimestamp);
    if (!raw.length) {
        symbolStates.set(symbol, { window: [], stagingCandles: [], lastFetchedOpenTime: null, openPosition: null, openPositionOpenTime: null, exhausted: true });
        return;
    }
    const candles = SimulationUtilityV2.mapToInfo(raw);
    const symbolInfo = buildMinimalSymbolInfo(symbol, candles);
    const { openPosition } = await SimulationUtilityV2.runMarketAnalysis(symbolInfo, [], null, MAX_POSITION_DURATION_CANDLES);

    symbolStates.set(symbol, {
        window: candles,
        stagingCandles: [],
        lastFetchedOpenTime: candles[candles.length - 1].openTime,
        openPosition,
        openPositionOpenTime: openPosition ? candles[openPosition.openGi]?.openTime ?? null : null,
        exhausted: false,
    });
}

/**
 * Slides one symbol's window forward by exactly one candle: pulls the
 * next candle from the staging buffer (fetching a fresh batch first if
 * the staging buffer is empty), appends it, drops the oldest, remaps
 * the carried-over position's openGi/closeGi by the one-index shift
 * this causes, then re-runs analysis on the freshly shifted window.
 */
async function shiftSymbolWindow(symbol: string, state: SymbolRollingState): Promise<boolean> {
    if (!state.stagingCandles.length) {
        if (state.lastFetchedOpenTime == null) return false;
        const nextStart = state.lastFetchedOpenTime + FIFTEEN_MIN_MS;
        const raw = await KlineUtility.getRecentKlinesByRange(symbol, '15m', WINDOW_SIZE, nextStart);
        if (!raw.length) {
            state.exhausted = true;
            return false;
        }
        state.stagingCandles = SimulationUtilityV2.mapToInfo(raw);
        state.lastFetchedOpenTime = state.stagingCandles[state.stagingCandles.length - 1].openTime;
    }

    const nextCandle = state.stagingCandles.shift();
    if (!nextCandle) return false;

    state.window.push(nextCandle);
    state.window.shift();

    if (state.openPosition) {
        state.openPosition.openGi -= 1;
        if (state.openPosition.closeGi != null) state.openPosition.closeGi -= 1;
    }

    const wasOpenBefore = state.openPosition != null;
    const symbolInfo = buildMinimalSymbolInfo(symbol, state.window);
    const { openPosition } = await SimulationUtilityV2.runMarketAnalysis(
        symbolInfo, [], state.openPosition, MAX_POSITION_DURATION_CANDLES
    );

    if (openPosition && !wasOpenBefore) {
        // A brand new position opened during this shift's re-analysis -
        // openGi is still a valid, positive index into the CURRENT
        // window right now, so this is the one moment its true openTime
        // can be read directly.
        state.openPositionOpenTime = state.window[openPosition.openGi]?.openTime ?? null;
    }
    // Deliberately NOT cleared when openPosition becomes null - recordTick
    // (called right after this, for the same tick) still needs to read
    // this value to log the just-closed position's true open time. It
    // naturally becomes stale once state.openPosition is null, but
    // nothing reads it again until a genuinely new position opens and
    // overwrites it above.
    state.openPosition = openPosition;
    return true;
}

/**
 * Reads the state of every symbol's window into the shared
 * stats/open-positions/snapshot tracking, for one tick. By default
 * reads each symbol's own LAST candle (the main shift loop's use case
 * - every symbol has just been advanced to the same new point in
 * time). When indexOverride is given (used to walk the STATIC initial
 * 500-candle window before any shifting begins), reads that specific
 * index instead, and validates the candle's own openTime actually
 * matches nowTimestamp before processing it - necessary because a
 * symbol with incomplete early history (recently listed) won't have
 * real data at that index for an early tick, and must be skipped for
 * that tick rather than incorrectly attributed to it.
 */
function recordTick(nowTimestamp: number, settledKeys: Set<string>, indexOverride?: number) {
    const stillOpenRows: OpenPositionRow[] = [];
    let openPnlThisTick = 0;

    for (const [symbol, state] of symbolStates) {
        if (!state.window.length) continue;
        const idx = indexOverride ?? state.window.length - 1;
        if (idx < 0 || idx >= state.window.length) continue;
        const candle = state.window[idx];
        if (indexOverride != null && candle.openTime !== nowTimestamp) continue;
        const position = candle.positionEntry;
        if (!position) continue;

        if (position.status !== 'OPEN') {
            const posKey = symbol + ':' + position.openGi + ':' + position.closeGi;
            if (!settledKeys.has(posKey)) {
                settledKeys.add(posKey);
                if (position.status === 'WON') stats.value.won++;
                else if (position.status === 'LOSS') stats.value.loss++;
                stats.value.totalClosedPnl += position.pnl ?? 0;
                stats.value.totalTakerFee += position.entryFee ?? 0;

                resolvedPositionsLog.value.push({
                    symbol,
                    openTime: state.openPositionOpenTime ?? candle.openTime,
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
                    entryReason: position.entryReason,
                });
            }
        } else {
            const pnlPercent = ((candle.close - position.entryPrice) / position.entryPrice) * (position.side === 'LONG' ? 1 : -1) * position.leverage;
            const markToMarketPnl = position.margin * pnlPercent;
            openPnlThisTick += markToMarketPnl;
            stillOpenRows.push({ symbol, position, openTime: state.openPositionOpenTime ?? candle.openTime, currentPrice: candle.close, markToMarketPnl });
        }
    }

    openPositionsDisplay.value = stillOpenRows;
    stats.value.totalOpenPnl = openPnlThisTick;

    snapshots.value.push({
        timestamp: nowTimestamp,
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
}

async function runRollingSimulation() {
    resetRun();
    isRunning.value = true;
    stopRequested = false;

    const startTimestamp = new Date(startDateTimeInput.value).getTime();
    runStartTimestamp = startTimestamp;
    runStartRealTimeMs = Date.now();
    candlesProcessedSoFar = 0;

    const symbols = chocoMintoStore.futureSymbols.map((s: any) => s.symbol);

    try {
        for (let i = 0; i < symbols.length; i++) {
            if (stopRequested) return;
            statusMessage.value = `initializing: ${i + 1}/${symbols.length} [${symbols[i]}]`;
            await initializeSymbol(symbols[i], startTimestamp);
        }

        const settledKeys = new Set<string>();

        // Record the initial 500-candle window's own history FIRST -
        // without this, the log silently starts at candle 501 (the
        // first one added by a shift), skipping the entire requested
        // start date. candlesProcessedSoFar counts these too, so the
        // main loop's clock formula below doesn't need a separate
        // WINDOW_SIZE offset.
        for (let i = 0; i < WINDOW_SIZE; i++) {
            if (stopRequested) break;
            const tickTimestamp = startTimestamp + i * FIFTEEN_MIN_MS;
            recordTick(tickTimestamp, settledKeys, i);
            candlesProcessedSoFar++;
            if (i % 50 === 0) {
                statusMessage.value = `recording initial window: candle ${i + 1}/${WINDOW_SIZE}`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        while (!stopRequested) {
            // The authoritative clock - derived purely from the
            // requested start time and how many ticks have elapsed,
            // NEVER from any individual symbol's own fetched data. This
            // is deliberate: a symbol with incomplete early history
            // (e.g. recently listed, no candles before some later date)
            // would otherwise return data starting well after the
            // requested start, and if the clock were derived from
            // symbols' own last-candle timestamps (previously via
            // Math.max across all of them), that ONE symbol would drag
            // the entire simulation's displayed/recorded time forward
            // from the very first tick - which is exactly what was
            // producing snapshots starting months after the requested
            // date. Each symbol's own window still reflects whatever
            // data it actually has; this clock just no longer depends
            // on it. candlesProcessedSoFar already includes the initial
            // window's own 500 candles (recorded above), so no separate
            // WINDOW_SIZE offset is added here.
            const currentSimTime = startTimestamp + candlesProcessedSoFar * FIFTEEN_MIN_MS;

            // Caught up to the current real-world moment - stop here
            // rather than spinning forever waiting for candles that
            // haven't happened yet.
            if (currentSimTime >= Date.now() - FIFTEEN_MIN_MS) {
                statusMessage.value = 'caught up to current time — run complete';
                break;
            }

            let anyAdvanced = false;
            let symbolsAdvancedThisTick = 0;
            for (const [symbol, state] of symbolStates) {
                if (stopRequested) break;
                if (state.exhausted) continue;
                const advanced = await shiftSymbolWindow(symbol, state);
                if (advanced) anyAdvanced = true;
                symbolsAdvancedThisTick++;

                // shiftSymbolWindow's real work (re-running analysis on
                // the shifted window) is synchronous - it only awaits a
                // network fetch when the staging buffer is empty, which
                // is most of the time NOT the case. Without an explicit
                // yield here, a full pass over all symbols runs as one
                // unbroken synchronous block with no chance for the
                // browser to repaint or respond - this is what was
                // actually freezing the page after initialization
                // finished. setTimeout(0) hands control back to the
                // browser's own event loop for a moment before
                // continuing.
                if (symbolsAdvancedThisTick % 60 === 0) {
                    const candleDatePht = new Date(currentSimTime).toLocaleString('en-US', { timeZone: 'Asia/Manila' });
                    statusMessage.value = `candle ${candlesProcessedSoFar + 1} (${candleDatePht} PHT): symbol ${symbolsAdvancedThisTick}/${symbolStates.size} [${symbol}]`;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            if (!anyAdvanced) {
                statusMessage.value = 'no further data available from any symbol — stopping';
                break;
            }

            candlesProcessedSoFar++;
            recordTick(currentSimTime, settledKeys);

            if (candlesProcessedSoFar % 5 === 0) {
                completionEstimateDisplay.value = estimateCompletion(runStartTimestamp, runStartRealTimeMs, candlesProcessedSoFar);
                statusMessage.value = `running — ${candlesProcessedSoFar} candles processed`;
            }
        }
    } finally {
        isRunning.value = false;
        if (stopRequested) statusMessage.value = 'stopped';
    }
}

function buildExportPayload() {
    return {
        exportedAt: Date.now(),
        startingBalance: startingBalance.value,
        startTimestamp: runStartTimestamp,
        candlesProcessed: candlesProcessedSoFar,
        allKnownSymbols: chocoMintoStore.futureSymbols.map((s: any) => s.symbol),
        symbolsWithData: Array.from(symbolStates.entries()).filter(([, s]) => !s.exhausted || s.window.length > 0).map(([sym]) => sym),
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
            entryReason: row.position.entryReason,
        })),
        snapshots: snapshots.value,
    };
}

function exportResult() {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateLabel = new Date(payload.exportedAt).toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `rolling-trade-simulation-${dateLabel}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

onUnmounted(() => {
    stopRequested = true;
});

defineExpose({ buildExportPayload });
</script>

<style scoped>
.datetime-input {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  border-radius: 5px;
  outline: none;
  transition: border-color 0.2s;
  border: 1px solid #e4e4e7;
}

.datetime-input:focus {
  border-color: #929292;
}

.replay-snap-wrapper {
  max-height: 77vh;
  overflow-y: auto;
}
</style>