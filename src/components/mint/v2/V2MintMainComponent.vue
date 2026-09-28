<template>
    <div class="text-center text-secondary">
        <label>v1.9 - test3</label>
    </div>
    <SymbolSocketComponent 
        :symbol="MASTER_SYMBOL" 
        :interval="KLINE_INTERVAL" 
        @on-new-candle="onNewCandle"/>

    <div v-if="UI_STATE_INITIALIZING_FUTURE_SYMBOLS" class="text-center">
        {{ UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE }}
    </div>

    <div class="pa-md text-left">
        
        <ButtonComponent v-if="!isBotEnabled" @click="startChoco" color="primary" rounded class="mr-sm">start choco</ButtonComponent>
        <ButtonComponent v-else @click="isBotEnabled = false" color="danger" rounded class="mr-sm">stop choco</ButtonComponent>

        <ButtonComponent v-if="!isBotEnabled" @click="runManualSimulation" :disabled="isSteppingCandle || isCapturing" rounded class="mr-sm">run all simulation</ButtonComponent>

        <!-- Start date and next. The scan builds each symbol's window STARTING at
             the start date (500 candles forward), so "next" appends the candle after it and re-runs
             the same analysis on the shifted window. The display below is
             untouched: stepping writes through the same store the initial scan
             writes through. -->
        <label class="ml-sm mr-sm">
            start date (PHT)
            <input type="datetime-local" v-model="simulationStartTime" :disabled="isSteppingCandle || isCapturing" />
        </label>

        <ButtonComponent @click="stepNextCandle" :disabled="!canStepCandle" rounded class="mr-sm">
            {{ isSteppingCandle ? stepProgressMessage : 'next' }}
        </ButtonComponent>

        <!-- Auto capture: the whole [start, end] range per symbol, nothing
             dropped (unlike "next", which keeps the window at 500), stored
             in IndexedDB for export/analysis. The first stored candle is
             the one opening at the start date. -->
        <label class="ml-sm mr-sm">
            end date (PHT)
            <input type="datetime-local" v-model="simulationEndTime" :disabled="isCapturing" />
        </label>
        <ButtonComponent v-if="!isCapturing" @click="autoCapture" :disabled="!canAutoCapture" rounded class="mr-sm">auto capture</ButtonComponent>
        <ButtonComponent v-else @click="stopCaptureRequested = true" :disabled="stopCaptureRequested" color="danger" rounded class="mr-sm">
            {{ stopCaptureRequested ? 'stopping…' : `stop capture (${capturedSymbolCount}/${chocoMintoStore.futureSymbols.length})` }}
        </ButtonComponent>
        <label class="mr-sm" title="When the capture finishes (or is stopped), download every captured symbol as slim, split zips - same as the chart's Download ALL">
            <input type="checkbox" v-model="autoDownloadAfterCapture" :disabled="isCapturing" />
            auto download
        </label>
        <span class="mr-sm" v-if="captureSummary">{{ captureSummary }}</span>

        <span class="mr-sm" v-if="steppedCandleCount > 0">
            +{{ steppedCandleCount }} candle{{ steppedCandleCount === 1 ? '' : 's' }}
            <template v-if="steppedToOpenTime"> · {{ new Date(steppedToOpenTime).toLocaleString() }}</template>
        </span>

        <ButtonComponent @click="UI_SHOW_TRADE_REPLAY = true" color="ghost" rounded class="mr-sm">view trade replay</ButtonComponent>
        <ButtonComponent @click="UI_SHOW_ROLLING_SIMULATION = true" color="ghost" rounded class="mr-sm">run rolling simulation</ButtonComponent>

        <label class="ml-sm">
            <input type="checkbox" v-model="onlyInterestingSymbols" />
            only interesting symbols
        </label>
    </div>

    <label>Cost</label>
    <InputComponent type="numeric" v-model="chocoMintoStore.orderCost"/>

    <!-- tab nav -->
    <div class="pa-md text-left">
        <ButtonComponent
            v-for="tab in tabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            :color="activeTab === tab.id ? 'primary' : undefined"
            rounded
            class="mr-sm">
            {{ tab.label }}
        </ButtonComponent>
    </div>

    <!-- tab 1 -->
    <div class="row pa-md" v-show="activeTab === 1" v-if="isBotEnabled || chocoMintoStore.isManualSimulation">
        <div class="text-center" v-if="UI_STATE_FORCE_CLOSE_MESSAGE != ''">
            {{ UI_STATE_FORCE_CLOSE_MESSAGE }}
        </div>
        <div v-for="(futureSymbolBatch,index) in futureSymbolBatches" class="col-lg-3 col-md-3">
            <MarketScannerComponent ref="marketScannerRef"
                :future-symbols="futureSymbolBatch" 
                :margin="MARGIN"
                :interval="KLINE_INTERVAL"
                :support-and-resistance-period-length="SUPPORT_AND_RESISTANCE_PERIOD_LENGTH"
                :max-init-candles="MAX_INIT_CANDLES"
                :target-tp-roi="TP_ROI"
                :target-sl-roi="SL_ROI"
                :new-candle-trigger-key="onNewCandleBasketTriggerKey"
                :position-duration-median="POSITION_DURATION_MEDIAN"
                :max-open-positions="MAX_OPEN_POSITIONS"
                :simulation-start="simulationStartMs"
                @on-completed="symbolBasket_OnCompleted"
                />

        </div>
    </div>

    <!-- tab 2 -->
    <div v-show="activeTab === 2">
        <!-- <TrendRiderComponent ref="trendRiderRef"/> -->
        <ConditionMetComponent ref="conditionMetRef"/>
    </div>

    <!-- tab 3 -->
    <div v-show="activeTab === 3">
        <CardComponent v-if="chocoMintoStore.isManualSimulation">
            <CardHeaderComponent>
                Manual Simulation Stats
            </CardHeaderComponent>
            <CardBodyComponent>
                <div>Margin: {{ MARGIN }} USDT</div>
                <div>TP_ROI: + {{ TP_ROI * 100 }}%</div>
                <div>SL_ROI: - {{ SL_ROI * 100 }}%</div>
                <div class="divider"></div>
                <div>Won: {{ manualSimulationStats.won }} | {{ manualSimulationStats.wonPnl.toFixed(2) }}</div>
                <div>Loss: {{ manualSimulationStats.loss }} | {{ manualSimulationStats.lossPnl.toFixed(2) }}</div>
                <div>Open: {{ manualSimulationStats.open }}</div>
                <div>Mid: {{ manualSimulationStats.mid }}</div>
                <div class="divider"></div>
                <div>Total Taker Fee: {{ manualSimulationStats.takerFee.toFixed(2) }} USDT</div>
                <div>Total Closed PNL: {{ manualSimulationStats.closedPnl.toFixed(2) }} USDT</div>
                <div>Total Open PNL: {{ manualSimulationStats.openPnl.toFixed(2) }} USDT</div>
                <div class="divider"></div>
                <div>Starting Balance: {{ STARTING_BALANCE }} USDT</div>
                <div>Estimated Maintenance Margin: {{ estimatedMarginBalance.toFixed(2) }} USDT</div>
                <div>Estimated Margin Used: {{ estimatedMarginUsed.toFixed(2) }}</div>
                <div>Estimated Balance: {{ estimatedBalance.toFixed(2) }} USDT</div>
            </CardBodyComponent>
        </CardComponent>

        <TableComponent>
            <template #header>
                <TableHeaderComponent>
                    <th>Start</th>
                    <th>End</th>
                    <th>Starting Balance</th>
                    <th>Ending Balance</th>
                    <th>Margin Balance</th>
                    <th>Result</th>
                    <th>Open</th>
                    <th>Won</th>
                    <th>Loss</th>
                    <th>Open Value</th>
                    <th>Won Value</th>
                    <th>Loss Value</th>
                </TableHeaderComponent>
            </template>

            <template #body>
                <TableBodyComponent>
                    <tr v-for="(report, index) in simulationReport" :key="index">
                        <td>{{ report.start }}</td>
                        <td>{{ report.end }}</td>
                        <td>{{ report.starting_balance.toFixed(2) }}</td>
                        <td>{{ report.ending_balance.toFixed(2) }}</td>
                        <td>{{ report.margin_balance.toFixed(2) }}</td>
                        <td :class="report.result >= 0 ? 'text-green-500' : 'text-red-500'">
                            {{ report.result.toFixed(2) }}
                        </td>
                        <td>{{ report.open }}</td>
                        <td>{{ report.won }}</td>
                        <td>{{ report.loss }}</td>
                        <td>{{ report.open_value.toFixed(2) }}</td>
                        <td>{{ report.won_value.toFixed(2) }}</td>
                        <td>{{ report.loss_value.toFixed(2) }}</td>
                    </tr>
                </TableBodyComponent>
            </template>
        </TableComponent>
    </div>

    <!-- tab 6 -->
    <div v-show="activeTab === 4">
        <!-- <BtcProjectionCrossingComponent ref="btcProjectionCrossingRef"/> -->
         <RiskMeasureComponent />
    </div>

    <DialogComponent :model-value="UI_SHOW_REPLAY" width="95vw" @update:model-value="UI_SHOW_REPLAY = false">
        <DialogHeaderComponent>View Candle Entry Replay</DialogHeaderComponent>
        <ReplayCandleEntryComponent 
            :interval="KLINE_INTERVAL"
            :max-candles="MAX_INIT_CANDLES"
            :support-and-resistance-length="SUPPORT_AND_RESISTANCE_PERIOD_LENGTH"
            :starting-balance="STARTING_BALANCE" 
            :margin="MARGIN"
            :position-duration-median="POSITION_DURATION_MEDIAN"
            :target-tp-roi="TP_ROI"
            :target-sl-roi="SL_ROI"
            :max-open-positions="MAX_OPEN_POSITIONS"
            :target-gain="TARGET_GAIN"/>
    </DialogComponent>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
        <DialogHeaderComponent>
            {{ selectedSymbol }}
        </DialogHeaderComponent>
        <CandleEntryHistoryComponent :candle-entries="selectedSymbolCandleEntries"/>
    </DialogComponent>

    <DialogComponent v-model="UI_SHOW_TRADE_REPLAY" :width="'95vw'">
        <DialogHeaderComponent>Trade Replay</DialogHeaderComponent>
        <TradeReplayComponent :starting-balance="STARTING_BALANCE" />
    </DialogComponent>

    <DialogComponent v-model="UI_SHOW_ROLLING_SIMULATION" :width="'95vw'">
        <DialogHeaderComponent>Rolling Trade Simulation</DialogHeaderComponent>
        <RollingTradeSimulationComponent :starting-balance="STARTING_BALANCE" />
    </DialogComponent>

</template>

<script setup lang="ts">
import type { Candle, CandleEntry, FuturesSymbol, SimulationReport, SimulationStats, TradeLog } from '@/core/interfaces';
import SymbolSocketComponent from '../SymbolSocketComponent.vue';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { CommonHelperUtility } from '@/utility/CommonHelperUtility';
import ButtonComponent from '../../shared/form/ButtonComponent.vue';
import CardComponent from '../../shared/card/CardComponent.vue';
import CardHeaderComponent from '../../shared/card/CardHeaderComponent.vue';
import CardBodyComponent from '../../shared/card/CardBodyComponent.vue';
import DialogComponent from '../../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../../shared/dialog/DialogHeaderComponent.vue';
import InputComponent from '../../shared/form/InputComponent.vue';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';
import CandleEntryHistoryComponent from '../CandleEntryHistoryComponent.vue';
import ReplayCandleEntryComponent from '../ReplayCandleEntryComponent.vue';
import TradeReplayComponent from './TradeReplayComponent.vue';
import RollingTradeSimulationComponent from './RollingTradeSimulationComponent.vue';
import { useNotificationStore } from '@/stores/notificationStore';
import TableBodyComponent from '../../shared/table/TableBodyComponent.vue';
import TableHeaderComponent from '../../shared/table/TableHeaderComponent.vue';
import TableComponent from '../../shared/table/TableComponent.vue';
import ConditionMetComponent from '../ConditionMetComponent.vue';
import { WalletSnifferUtility } from '@/utility/WalletSnifferUtility.ts';
import RiskMeasureComponent from '../RiskMeasureComponent.vue';
import MarketScannerComponent from './MarketScannerComponent.vue';
import { SimulationUtilityV2 } from '@/utility/v2/simulationUtilityV2.ts';
import { klineDbUtilityV2 } from '@/utility/v2/klineDbUtilityV2.ts';
import { downloadSymbolInfoZip } from '@/utility/v2/symbolInfoExport';
import { scanForInterestingSymbols, storeInterestingSymbols } from '@/utility/v2/analysis/symbolInterest';

const chocoMintoStore = useChocoMintoStore();
const notificationStore = useNotificationStore();

const isBotEnabled = ref(false)

const MASTER_SYMBOL = "BTCUSDT";
const KLINE_INTERVAL = "15m"
const MAX_INIT_CANDLES = 500;
const SUPPORT_AND_RESISTANCE_PERIOD_LENGTH = 10;

const MARGIN = 1.5;
const TP_ROI = 3;
const SL_ROI = 3;
const STARTING_BALANCE = 300;
const MAX_OPEN_POSITIONS = 20;
const TARGET_GAIN = 10;
const POSITION_DURATION_MEDIAN = 10;

const LOCALSTORAGE_CACHED_FUTURES_SYMBOLS = "CACHED_FUTURES_SYMBOLS";

const UI_STATE_INITIALIZING_FUTURE_SYMBOLS = ref(false);
const UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE = ref("")
const UI_STATE_FORCE_CLOSE_MESSAGE = ref('')
const UI_SHOW_REPLAY = ref(false)
const UI_SHOW_TRADE_REPLAY = ref(false)
const UI_SHOW_ROLLING_SIMULATION = ref(false)

// When on, a symbol pre-scan runs before the main simulation and the
// scanner only processes symbols that scan found interesting right now
// (see symbolInterest.ts). Persisted so the setting survives a reload.
const onlyInterestingSymbols = ref(localStorage.getItem('only-interesting-symbols') === 'true');
watch(onlyInterestingSymbols, (val) => {
    localStorage.setItem('only-interesting-symbols', val.toString());
    if (!val) {
        // Blank list means "run everything" downstream (MarketScannerComponent) -
        // clear it immediately so turning the checkbox off doesn't leave a
        // stale filter from the last time it was checked.
        storeInterestingSymbols([]);
    }
});

const futureSymbolBatches = ref<FuturesSymbol[][]>([])

const onNewCandleBasketTriggerKey = ref(CommonHelperUtility.generateGuid());
const basketKey = ref(CommonHelperUtility.generateGuid());

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])
const selectedSymbol = ref("")

const simulationReport = ref<SimulationReport[]>([])

// The scan's start date. Was hardcoded "1/1/2026" and passed to
// MarketScannerComponent, which never declared the prop - so it did nothing and
// every scan used the most recent 500 candles. Now a datetime-local string,
// persisted so it survives a reload, converted to epoch ms for the scanner.
// Empty still means "most recent candles", which is exactly the old behaviour.
const simulationStartTime = ref(localStorage.getItem('simulation-start-time') ?? '');
watch(simulationStartTime, (val) => localStorage.setItem('simulation-start-time', val));

/**
 * datetime-local strings ("2026-01-01T00:00") are read as PHT (UTC+8), not
 * the browser's timezone, so a date typed here means the same candle on any
 * machine. 0 when empty/invalid.
 */
function phtInputToMs(value: string): number {
    if (!value) return 0;
    const withSeconds = value.length === 16 ? `${value}:00` : value;
    const ms = new Date(`${withSeconds}+08:00`).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

const simulationStartMs = computed(() => phtInputToMs(simulationStartTime.value));

const simulationEndTime = ref(localStorage.getItem('simulation-end-time') ?? '');
watch(simulationEndTime, (val) => localStorage.setItem('simulation-end-time', val));
const simulationEndMs = computed(() => phtInputToMs(simulationEndTime.value));

// Auto capture state. capturedRun blocks "next" afterwards: next trims every
// window back to MAX_INIT_CANDLES and writes it to IndexedDB, which would
// overwrite the captured range. A fresh "run all simulation" clears it.
const isCapturing = ref(false);
const stopCaptureRequested = ref(false);
const capturedSymbolCount = ref(0);
const capturedRun = ref(false);
const captureSummary = ref('');
const autoDownloadAfterCapture = ref(localStorage.getItem('auto-download-after-capture') !== 'false');
watch(autoDownloadAfterCapture, (val) => localStorage.setItem('auto-download-after-capture', String(val)));

// Candles advanced by "next" since the last full scan, and where the walk has
// reached. Reset by runManualSimulation, because a fresh scan rebuilds every
// window from the start date again.
const steppedCandleCount = ref(0);
const steppedToOpenTime = ref<number | null>(null);
const isSteppingCandle = ref(false);
const stepProgressMessage = ref('next');

const simulationRunningBalance = ref(300)

const completionCount = ref(0);

const conditionMetRef = ref()
const marketScannerRef = ref()

const activeTab = ref(1)
const tabs = [
    { id: 1, label: 'Scanner' },
    { id: 2, label: 'Hits' },
    { id: 3, label: 'Simulation Result' },
    { id: 4, label: 'Risk' },
]

const manualSimulationStats = computed(() => {
    var stats: SimulationStats = {
        won: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.won, 0),
        loss: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.loss, 0),
        open: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.open, 0),
        mid: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.mid, 0),
        takerFee: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.takerFee, 0),
        closedPnl: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.closedPnl, 0),
        wonPnl: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.wonPnl, 0),
        lossPnl: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.lossPnl, 0),
        openPnl: chocoMintoStore.futureSymbols.reduce((sum, s) => sum + s.simulationStats.openPnl, 0),
    }
    return stats;
})
const estimatedBalance = computed(() => {
    return (STARTING_BALANCE - (estimatedMarginUsed.value + manualSimulationStats.value.takerFee)) + manualSimulationStats.value.closedPnl
})

const estimatedMarginBalance = computed(() => {
    var mb = estimatedBalance.value + (estimatedMarginUsed.value + manualSimulationStats.value.openPnl)
    chocoMintoStore.marginBalance = mb;
    return mb
})

const estimatedMarginUsed = computed(() => {
    return manualSimulationStats.value.open * MARGIN;
})

onMounted(async () => {
    await BinanceMarginUtility.fetchAllFuturesBrackets();
    await initializeFutureSymbols();
})

function startChoco(){
    completionCount.value = 0;

    if(chocoMintoStore.startingTimeStamp == 0){
        var storageStartingTimeStamp = localStorage.getItem('start-time');
        var storageEndingTimeStamp = localStorage.getItem('end-time');
        if(storageStartingTimeStamp && storageEndingTimeStamp){
            chocoMintoStore.startingTimeStamp = parseInt(storageStartingTimeStamp)
            chocoMintoStore.endingTimeStamp = parseInt(storageEndingTimeStamp)
        }
    }

    localStorage.setItem('start-time',chocoMintoStore.startingTimeStamp.toString())
    localStorage.setItem('end-time',chocoMintoStore.endingTimeStamp.toString())

    isBotEnabled.value = true;
}

async function initializeFutureSymbols(){
    var localStorageFuturesMaxLeverage = localStorage.getItem(LOCALSTORAGE_CACHED_FUTURES_SYMBOLS);
    if(!localStorageFuturesMaxLeverage){
        UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = true;

        var futureSymbols = await OrderMakerUtility.getFuturesSymbols(); 
        var tokenMaps = await WalletSnifferUtility.getTokenMap();

        for (let i = 0; i <= futureSymbols.length - 1; i++) {
            var symbol = futureSymbols[i];
            UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = `Processing: ${i + 1} / ${futureSymbols.length} [${symbol}]`;

            var maxLeverage = (await OrderMakerUtility.getMaxLeverage(symbol));
            if(maxLeverage >= 50){
                var tokenMap = tokenMaps[symbol];

                
                //if(!tokenMap || (tokenMap && tokenMap.chain != "ethereum")) continue;

                chocoMintoStore.futureSymbols.push({
                    symbol,
                    maxLeverage,
                    status: "ready",
                    simulationStats: {
                        won: 0,
                        loss: 0,
                        open: 0,
                        mid: 0,
                        takerFee: 0,
                        closedPnl: 0,
                        openPnl: 0,
                        wonPnl: 0,
                        lossPnl: 0
                    },
                    conditionMet: "",
                    usdtValue: 0,
                    trend: "",
                    lookbackTrend: "",
                    change: 0,
                    candlesAboveCount: 0,
                    candlesBelowCount: 0,
                    crossedMa: false,
                    changeZScore: 0,
                    bidWall: 0,
                    askWall: 0,
                    g1CandleCount: 0,
                    zoneSize: 0,
                    crossedLastAvwap: false,
                    lastXCandleSpan: 0,
                    positionSide: "",
                    tpPrice: 0,
                    slPrice: 0,
                    hasRecentPosition: false,
                    recentPositionSide: "",
                    networkChain: "",
                    hasRecentCrossedMovementPoc: false,
                    hasRecentVolatilityChangeSpike:false
                })
            }
        }

        localStorage.setItem(LOCALSTORAGE_CACHED_FUTURES_SYMBOLS,JSON.stringify(chocoMintoStore.futureSymbols));

        UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = false;
    }else{
        chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage) as FuturesSymbol[]
    }

    //chocoMintoStore.futureSymbols = chocoMintoStore.futureSymbols.slice(0,24);
    //chocoMintoStore.futureSymbols = chocoMintoStore.futureSymbols.filter(s => s.symbol == "BTCUSDT")
    
    futureSymbolBatches.value = chocoMintoStore.splitFutureSymbols(4);
}

async function onNewCandle(candle:Candle){
    completionCount.value = 0;

    if(!chocoMintoStore.isManualSimulation){
        setTimeout(() => {
            onNewCandleBasketTriggerKey.value = CommonHelperUtility.generateGuid();
        }, 500);
    }
}

function symbolBasket_OnCompleted(){
    completionCount.value++;
    console.log("completionCount",completionCount.value);
    if(completionCount.value >= 4){
        notificationStore.showNotification("success","top-right","Scan Complete","The market scan has been completed.");
        conditionMetRef.value.shoutAvCrosses();

        completionCount.value = 0;
    }
}

const canAutoCapture = computed(() =>
    !isSteppingCandle.value
    && !isCapturing.value
    && simulationStartMs.value > 0
    && simulationEndMs.value > simulationStartMs.value
    && chocoMintoStore.futureSymbols.length > 0
);

/**
 * Captures [start, end] for every symbol across all four scanner batches at
 * once (each processes its own symbols one at a time - see
 * MarketScannerComponent.autoCaptureRange). Replaces whatever IndexedDB held,
 * the same way "run all simulation" does.
 */
async function autoCapture() {
    if (!canAutoCapture.value) return;
    isCapturing.value = true;
    stopCaptureRequested.value = false;
    capturedSymbolCount.value = 0;
    captureSummary.value = '';
    steppedCandleCount.value = 0;
    steppedToOpenTime.value = null;

    try {
        chocoMintoStore.isManualSimulation = true;
        UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = "clearing previously captured data...";
        await klineDbUtilityV2.clearAllSymbolInfo();
        UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = "";
        await nextTick();

        const scanners = ((marketScannerRef.value ?? []) as any[]).filter(
            (scanner) => scanner && typeof scanner.autoCaptureRange === 'function'
        );
        const startedAt = Date.now();
        const results = await Promise.all(scanners.map((scanner) => scanner.autoCaptureRange(
            simulationStartMs.value,
            simulationEndMs.value,
            () => stopCaptureRequested.value,
            () => { capturedSymbolCount.value++; }
        )));

        const captured = results.reduce((sum, r) => sum + (r?.captured ?? 0), 0);
        const candles = results.reduce((sum, r) => sum + (r?.candles ?? 0), 0);
        const stopped = results.some((r) => r?.stopped);
        const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
        capturedRun.value = captured > 0;
        captureSummary.value = `${stopped ? 'stopped' : 'captured'}: ${captured} symbols, ${candles.toLocaleString()} candles, ${minutes} min`;
        notificationStore.showNotification(
            stopped ? "warning" : "success", "top-right",
            stopped ? "Auto capture stopped" : "Auto capture complete",
            captureSummary.value
        );

        if (autoDownloadAfterCapture.value && captured > 0) {
            // Everything captured is in IndexedDB now; export it with the
            // same slim, split-zip download the chart's "Download ALL" uses.
            // Symbols that were not captured (stopped early, no data) are
            // simply absent from the zips.
            const symbols = chocoMintoStore.futureSymbols.map((f) => f.symbol);
            const summary = captureSummary.value;
            const { parts } = await downloadSymbolInfoZip(symbols, {
                slim: true,
                onProgress: (current, total) => { captureSummary.value = `${summary} · zipping ${current}/${total}`; },
            });
            captureSummary.value = `${summary} · downloaded ${parts} zip${parts === 1 ? '' : 's'}`;
        }
    } catch (error) {
        console.error("autoCapture", error);
        notificationStore.showNotification("danger", "top-right", "Auto capture failed", String(error));
    } finally {
        isCapturing.value = false;
        stopCaptureRequested.value = false;
    }
}

const canStepCandle = computed(() =>
    !isSteppingCandle.value
    && !isCapturing.value
    && !capturedRun.value
    && chocoMintoStore.isManualSimulation
    && Array.isArray(marketScannerRef.value)
    && marketScannerRef.value.length > 0
);

/**
 * Advances every symbol's window by exactly one candle and re-runs the analysis.
 *
 * ALL FOUR BATCHES AT ONCE. Each batch owns a disjoint slice of the symbol list
 * (chocoMintoStore.splitFutureSymbols) and touches only its own symbols' store
 * entries, so there is nothing for them to contend over. Run sequentially they
 * simply added up - four times the fetch latency and four times the wait before
 * the display finished updating.
 *
 * They interleave rather than truly parallelize: JavaScript is one thread, so the
 * analysis still runs one symbol at a time. What overlaps is the waiting - the
 * REST fetches, and the yields each batch takes every few symbols.
 *
 * A scanner that has not scanned yet steps nothing and reports 0 - pressing
 * "next" before "run all simulation" is a no-op rather than an error.
 */
async function stepNextCandle() {
    if (!canStepCandle.value) return;
    isSteppingCandle.value = true;
    stepProgressMessage.value = 'stepping…';
    try {
        const scanners = (marketScannerRef.value as any[]).filter(
            (scanner) => scanner && typeof scanner.stepNextCandle === 'function'
        );
        const results = await Promise.all(
            scanners.map((scanner) => scanner.stepNextCandle())
        );

        let advanced = 0;
        let reachedOpenTime: number | null = null;
        for (const result of results) {
            advanced += result?.advanced ?? 0;
            if (result?.lastOpenTime != null) {
                reachedOpenTime = Math.max(reachedOpenTime ?? 0, result.lastOpenTime);
            }
        }
        if (advanced > 0) {
            steppedCandleCount.value++;
            steppedToOpenTime.value = reachedOpenTime;
        } else {
            notificationStore.showNotification(
                "warning", "top-right", "Nothing to step",
                "No symbol had a next candle available. Run the scan first, or the windows have caught up to now."
            );
        }
    } finally {
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

async function runManualSimulation() {
    // A fresh scan rebuilds every window from the start date, so the step
    // counter no longer describes anything.
    steppedCandleCount.value = 0;
    steppedToOpenTime.value = null;
    capturedRun.value = false;
    captureSummary.value = '';

    // UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = "ANALYZING MAIN MARKETS"
    // await analyzeMainMarkets();

    chocoMintoStore.isManualSimulation = true;

    // Wipe everything captured from a previous run FIRST - before the
    // interest pre-scan or the main scan, both of which would otherwise
    // read stale data left over from last time.
    UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = "clearing previously captured data...";
    await klineDbUtilityV2.clearAllSymbolInfo();

    if (onlyInterestingSymbols.value) {
        await runInterestingSymbolsPreScan();
    }

    // Ensure the template ref array exists and has components loaded
    await nextTick();
    
    UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = ""
    if (marketScannerRef.value && marketScannerRef.value.length > 0) {
        // Trigger runInitialScan on all batches simultaneously
        const scanPromises = marketScannerRef.value.map((scanner: any) => {
            if (scanner && typeof scanner.runInitialScan === 'function') {
                return scanner.runInitialScan();
            }
        });
        
        await Promise.all(scanPromises);
    }
}

/**
 * Cheap pre-scan (raw klines/OI/long-short, not the full simulation
 * pipeline) across every known futures symbol, run before the main
 * scan whenever "only interesting symbols" is checked. Stores the
 * resulting symbol list via symbolInterest.ts; MarketScannerComponent
 * reads it back and only loops over that set. An empty result (or the
 * checkbox being off) means downstream falls back to running everything.
 */
async function runInterestingSymbolsPreScan() {
    UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = true;
    try {
        const interesting = await scanForInterestingSymbols(
            chocoMintoStore.futureSymbols,
            undefined,
            (current, total, symbol) => {
                UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = `Checking interest: ${current} / ${total} [${symbol}]`;
            }
        );
        storeInterestingSymbols(interesting);
    } finally {
        UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = false;
        UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = "";
    }
}

async function analyzeMainMarkets(){

    //CONSTRUCT AND ANALYZE MAIN MARKET
    var mainMarkets = [
        await SimulationUtilityV2.constructSymbolInfo("BTCUSDT",MAX_INIT_CANDLES),
        await SimulationUtilityV2.constructSymbolInfo("SOLUSDT",MAX_INIT_CANDLES),
        await SimulationUtilityV2.constructSymbolInfo("ETHUSDT",MAX_INIT_CANDLES)
    ]

    await mainMarkets.forEach(async (mainMarketSymbol) => {
        await SimulationUtilityV2.runMarketAnalysis(mainMarketSymbol,[]);

        klineDbUtilityV2.storeSymbolInfo(mainMarketSymbol);
    })
}
</script>