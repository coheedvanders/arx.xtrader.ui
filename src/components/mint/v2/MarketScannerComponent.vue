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

            <!-- Symbols -->
            <div class="scanner-list">
                <div
                    v-for="futureSymbol in futureSymbols"
                    :key="futureSymbol.symbol"
                    class="scanner-row"
                    :class="{
                        'scanner-row-visited': visitedSymbols.has(futureSymbol.symbol),
                        'scanner-row-processing': futureSymbol.status === 'processing',
                        'scanner-row-hit': futureSymbol.conditionMet
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
                            v-if="futureSymbol.conditionMet"
                            class="condition-badge"
                        >
                            {{ futureSymbol.conditionMet }}
                        </span>
                    </div>

                    <!-- Status -->
                    <div class="scanner-status">
                        {{ futureSymbol.status }}
                    </div>
                </div>

                <div
                    v-if="futureSymbols.length === 0"
                    class="scanner-empty"
                >
                    No symbols
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
import { ref } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import ProgressBarComponent from '@/components/shared/ProgressBarComponent.vue';
import DialogComponent from '@/components/shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '@/components/shared/dialog/DialogHeaderComponent.vue';
import type { CandleInfo, SymbolInfo, PositionEntry } from '@/core/interfacesv2';
import { KlineUtility } from '@/utility/klineUtility';
import { klineDbUtilityV2 } from '@/utility/v2/klineDbUtilityV2';
import { CandleAnalyzerV2 } from '@/utility/v2/candleAnalyzerV2';
import { SimulationUtilityV2 } from '@/utility/v2/simulationUtilityV2';
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
const showEntryHistory = ref(false);
const selectedSymbol = ref("");

const currentFutureSumbol = ref<FuturesSymbol>();
const visitedSymbols = ref<Set<string>>(new Set());

async function runInitialScan() {
    console.log("runInitialScan", props.futureSymbols.length);

    // A fresh scan rebuilds every window from the start date, so both the
    // windows and the candles buffered against them are from the wrong place in
    // history.
    stepBuffers.clear();
    symbolWindows.clear();

    // var mainMarkets = [
    //     (await klineDbUtilityV2.getSymbolInfo("BTCUSDT"))!,
    //     (await klineDbUtilityV2.getSymbolInfo("ETHUSDT"))!,
    //     (await klineDbUtilityV2.getSymbolInfo("SOLUSDT"))!,
    // ]

    // A blank/empty stored list means "run everything" - same feature,
    // same loop, same progress bar (bounds stay against the full
    // futureSymbols array either way; only the per-symbol work below is
    // skipped for symbols not on the list, matching MarketScanner's own
    // "only loop/run those that are interesting" requirement without
    // needing a separate progress-bar total).
    const interestingSymbols = getStoredInterestingSymbols();
    const interestFilter = interestingSymbols.length > 0 ? new Set(interestingSymbols) : null;

    for (let i = 0; i < props.futureSymbols.length; i++) {
        try {
            
            const futureSymbol = props.futureSymbols[i];

            //TARGET SYMBOL ANALYSIS
            //if (futureSymbol.symbol != "LTCUSDT") continue;

            progressCounter.value = i + 1;

            if (interestFilter && !interestFilter.has(futureSymbol.symbol)) {
                futureSymbol.status = "skipped (not interesting)";
                continue;
            }

            futureSymbol.status = "constructing info";
            var symbolInfo = await constructWindow(futureSymbol.symbol);

            currentFutureSumbol.value = futureSymbol;
            futureSymbol.status = "processing";

            await SimulationUtilityV2.runMarketAnalysis(symbolInfo,[]);

            klineDbUtilityV2.storeSymbolInfo(symbolInfo);

            // Kept in memory so "next" does not have to read it back out of
            // IndexedDB. That read was the slow part of a step: a 500-candle
            // SymbolInfo carrying every derived field, deserialized once per
            // symbol per press. The rolling lab holds its windows in memory for
            // exactly this reason.
            symbolWindows.set(symbolInfo.name, symbolInfo);

            setRecentFutureCandleData(symbolInfo.candle_15m);

            updateStoreFutureSymbolSimulationStats(symbolInfo.name,symbolInfo.candle_15m);

            await new Promise(resolve => setTimeout(resolve, 400));

            if (chocoMintoStore.isManualSimulation) {
                const storeFutureSymbol = chocoMintoStore.futureSymbols.find(f => f.symbol === futureSymbol.symbol);

                if (storeFutureSymbol) {
                    futureSymbol.status =
                        `${storeFutureSymbol.simulationStats.won}/` +
                        `${storeFutureSymbol.simulationStats.loss}/` +
                        `${storeFutureSymbol.simulationStats.open}-` +
                        `${storeFutureSymbol.simulationStats.mid}`;
                }
            } else {
                futureSymbol.status = "-";
            }
        } catch (error) {
            console.error("initializeFutureSymbolData", error);
        }
    }

    emit('onCompleted');
    progressCounter.value = 0
}


const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * How many candles one refill pulls ahead of the walk.
 *
 * Purely a latency setting - a step consumes ONE candle, and refetching per
 * symbol per press would make every "next" 300-odd REST round trips. It cannot
 * change results: the candles fetched are the same candles in the same order
 * either way.
 */
const STEP_FETCH_AHEAD = 200;

/** Candles fetched ahead of the walk, per symbol, consumed one per step. */
const stepBuffers = new Map<string, CandleInfo[]>();

/**
 * Builds one symbol's initial window.
 *
 * With no start date this is exactly the old call, so nothing changes. With one,
 * the window STARTS at that date: its first candle is the one opening at the
 * start date, and it runs maxInitCandles forward (capped at now), so the data
 * begins where the date says - same as Auto Capture. "next" then continues
 * after the window's last candle. (It used to END at the start date, which put
 * the first candle ~5 days earlier.) The first ~200 candles are indicator
 * warm-up inside the window.
 */
async function constructWindow(symbol: string): Promise<SymbolInfo> {
    const startMs = props.simulationStart ?? 0;
    if (!startMs) {
        return await SimulationUtilityV2.constructSymbolInfo(symbol, props.maxInitCandles);
    }
    const to = Math.min(startMs + (props.maxInitCandles - 1) * FIFTEEN_MIN_MS, Date.now());
    const raw = (await KlineUtility.getRecentKlinesByRange(symbol, props.interval, props.maxInitCandles, startMs, to))
        .filter(c => c.openTime >= startMs);
    // Built here rather than by calling constructSymbolInfo and overwriting its
    // candles, which would spend a second REST call fetching a window that is
    // then thrown away. The empty arrays are what constructSymbolInfo sets too.
    return {
        name: symbol,
        candle_15m: SimulationUtilityV2.mapToInfo(raw),
        candle_1h: [], candle_4h: [], candle_1d: [],
        oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
        ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
        trendstats_15m: null,
    };
}

/**
 * Windows held in memory between steps, keyed by symbol.
 *
 * Populated by runInitialScan. A step reads from here rather than from
 * IndexedDB; the store is still written (fire and forget) so the chart dialog
 * shows the stepped state.
 */
const symbolWindows = new Map<string, SymbolInfo>();

/** How many refill fetches run at once. Binance allows 2,400 request weight per
 *  minute per IP and a 200-candle klines call costs 2, so a batch of ~84 symbols
 *  refilling costs ~168 - nowhere near the limit. 6 matches the lab's own
 *  initialization concurrency; going high enough to trip the limit earns a 418. */
const STEP_FETCH_CONCURRENCY = 6;

/** Symbols processed between yields back to the browser. Without this the whole
 *  batch runs in one synchronous block: the four batches cannot interleave and
 *  the page cannot repaint, so a press looks like a freeze. */
const YIELD_EVERY_SYMBOLS = 10;

/**
 * Advances every scanned symbol in this batch by exactly ONE candle.
 *
 * TWO PHASES, and the split is the point. Phase 1 makes sure every symbol has
 * its next candle in memory, fetching only the symbols whose buffer has run dry,
 * and fetching those in parallel. Phase 2 then walks the symbols with no network
 * and no IndexedDB reads at all: take the candle from the buffer, shift the
 * in-memory window, re-run the same analysis the initial scan runs, and write the
 * stats through the same two functions. That is why the display does not change -
 * nothing new reports anything.
 *
 * Interleaved, the way it was before, a press cost one REST round trip plus one
 * IndexedDB read per symbol, serialized. Now a press costs at most
 * ceil(symbols / 6) round trips, and only on the one press in every
 * STEP_FETCH_AHEAD that actually runs dry.
 *
 * runMarketAnalysis re-derives every field on the whole window on every call, so
 * a shifted window needs no special handling - nothing is carried between calls
 * to get wrong. It is also the floor on how fast a press can be: every scanned
 * symbol has to be re-derived for its stats to update, and unlike the rolling lab
 * there is nothing here that can be skipped.
 */
async function stepNextCandle(): Promise<{ advanced: number; lastOpenTime: number | null }> {
    // ── phase 1: every symbol's next candle, into memory, in parallel ────
    const pending: FuturesSymbol[] = [];
    for (const futureSymbol of props.futureSymbols) {
        const window = await resolveWindow(futureSymbol.symbol);
        if (!window || !window.candle_15m.length) continue;
        pending.push(futureSymbol);
    }

    const needsFetch = pending.filter(fs => !hasNextCandle(fs.symbol));
    if (needsFetch.length) {
        let cursor = 0;
        let done = 0;
        const worker = async (): Promise<void> => {
            while (true) {
                const i = cursor++;
                if (i >= needsFetch.length) return;
                const symbol = needsFetch[i].symbol;
                try {
                    await refillBuffer(symbol);
                } catch (error) {
                    console.error("refillBuffer", symbol, error);
                }
                done++;
                progressCounter.value = done;
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(STEP_FETCH_CONCURRENCY, needsFetch.length) }, worker)
        );
    }

    // ── phase 2: process, no network, no IndexedDB reads ────────────────
    let advanced = 0;
    let lastOpenTime: number | null = null;

    for (let i = 0; i < pending.length; i++) {
        const futureSymbol = pending[i];
        progressCounter.value = i + 1;
        try {
            const symbolInfo = symbolWindows.get(futureSymbol.symbol);
            if (!symbolInfo) continue;

            const nextCandle = takeNextCandle(futureSymbol.symbol, symbolInfo.candle_15m);
            if (!nextCandle) { futureSymbol.status = "no further candle"; continue; }

            symbolInfo.candle_15m.push(nextCandle);
            while (symbolInfo.candle_15m.length > props.maxInitCandles) symbolInfo.candle_15m.shift();

            currentFutureSumbol.value = futureSymbol;

            await SimulationUtilityV2.runMarketAnalysis(symbolInfo, []);

            // NOT awaited, matching runInitialScan. The chart dialog reads this
            // back, so it has to be written; nothing in the step path reads it,
            // so waiting for the write would only slow the press down.
            klineDbUtilityV2.storeSymbolInfo(symbolInfo);
            setRecentFutureCandleData(symbolInfo.candle_15m);
            updateStoreFutureSymbolSimulationStats(symbolInfo.name, symbolInfo.candle_15m);

            advanced++;
            lastOpenTime = Math.max(lastOpenTime ?? 0, nextCandle.openTime);

            if (chocoMintoStore.isManualSimulation) {
                const storeFutureSymbol = chocoMintoStore.futureSymbols.find(f => f.symbol === futureSymbol.symbol);
                if (storeFutureSymbol) {
                    futureSymbol.status =
                        `${storeFutureSymbol.simulationStats.won}/` +
                        `${storeFutureSymbol.simulationStats.loss}/` +
                        `${storeFutureSymbol.simulationStats.open}-` +
                        `${storeFutureSymbol.simulationStats.mid}`;
                }
            }
        } catch (error) {
            console.error("stepNextCandle", futureSymbol.symbol, error);
        }

        if ((i + 1) % YIELD_EVERY_SYMBOLS === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    progressCounter.value = 0;
    return { advanced, lastOpenTime };
}

/**
 * This symbol's window, from memory, falling back to IndexedDB once.
 *
 * The fallback covers a reload after a scan: the store still has the windows but
 * this component's Map is empty. It happens at most once per symbol per session,
 * not once per press.
 */
async function resolveWindow(symbol: string): Promise<SymbolInfo | null> {
    const held = symbolWindows.get(symbol);
    if (held) return held;
    const stored = await klineDbUtilityV2.getSymbolInfo(symbol);
    // No stored window means this symbol was never scanned (skipped as not
    // interesting, or the scan has not run). Stepping it would have to invent a
    // window, so it is left alone.
    if (!stored || !stored.candle_15m.length) return null;
    symbolWindows.set(symbol, stored);
    return stored;
}

/** Whether the buffer already holds a candle after the window's last one. */
function hasNextCandle(symbol: string): boolean {
    const window = symbolWindows.get(symbol)?.candle_15m;
    if (!window || !window.length) return false;
    const lastOpenTime = window[window.length - 1].openTime;
    return (stepBuffers.get(symbol) ?? []).some(c => c.openTime > lastOpenTime);
}

/**
 * Fetches the next batch of candles for one symbol into its buffer.
 *
 * Anything at or before where the window already sits is overlap and is dropped.
 * Continuity itself is checked at consumption time - see takeNextCandle.
 */
async function refillBuffer(symbol: string): Promise<void> {
    const window = symbolWindows.get(symbol)?.candle_15m;
    if (!window || !window.length) return;
    const lastOpenTime = window[window.length - 1].openTime;
    const raw = await KlineUtility.getRecentKlinesByRange(
        symbol, props.interval, STEP_FETCH_AHEAD, lastOpenTime + FIFTEEN_MIN_MS
    );
    stepBuffers.set(symbol, SimulationUtilityV2.mapToInfo(raw).filter(c => c.openTime > lastOpenTime));
}

/**
 * Takes the next candle off the buffer. SYNCHRONOUS - phase 1 has already put it
 * there, so phase 2 never waits on the network.
 *
 * CONTINUITY IS CHECKED, NOT ASSUMED. The candle must open exactly one interval
 * after the one already held; a genuine gap returns null rather than being
 * stitched, because a window with a hole in it produces ATR, trend and structure
 * values for a price series that never existed.
 */
function takeNextCandle(symbol: string, window: CandleInfo[]): CandleInfo | null {
    const lastOpenTime = window[window.length - 1].openTime;
    const buffer = (stepBuffers.get(symbol) ?? []).filter(c => c.openTime > lastOpenTime);
    stepBuffers.set(symbol, buffer);

    if (!buffer.length) return null;
    if (buffer[0].openTime !== lastOpenTime + FIFTEEN_MIN_MS) {
        console.warn(
            `${symbol}: candle gap - expected ${new Date(lastOpenTime + FIFTEEN_MIN_MS).toISOString()},`
            + ` got ${new Date(buffer[0].openTime).toISOString()}. Not stepping this symbol.`
        );
        return null;
    }
    return buffer.shift() ?? null;
}

function updateStoreFutureSymbolSimulationStats(symbol:string, candles:CandleInfo[]){
    var storeFutureSymbol = chocoMintoStore.futureSymbols.find(s => s.symbol == symbol);
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
        const distinctPositions: PositionEntry[] = [];
        for (const c of candles) {
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

        storeFutureSymbol.simulationStats = simulationStats;
    }
}

function setRecentFutureCandleData(candles: CandleInfo[]){
    var currentCandle = candles[candles.length - 1];
    if (currentCandle.conditions_met.length > 0) {
        currentFutureSumbol.value!.conditionMet = currentCandle.conditions_met.filter(condition => !condition.includes("TREND_")).join(", ")
    }
}

async function showEntryHistoryModal(futureSymbol: FuturesSymbol) {
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
    stepBuffers.clear();
    symbolWindows.clear();

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