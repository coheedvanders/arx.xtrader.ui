<template>
    <div class="text-center readable-text-muted">
        <label>v1.9 - test3</label>
    </div>
    <SymbolSocketComponent 
        :symbol="MASTER_SYMBOL" 
        :interval="KLINE_INTERVAL" 
        @on-new-candle="onNewCandle"/>

    <div v-if="UI_STATE_INITIALIZING_FUTURE_SYMBOLS" class="text-center readable-text">
        {{ UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE }}
    </div>

    <!-- COMMAND AREA - three rows:
         1. actions, grouped (Bot | Scan | Step | Capture | Tools);
         2. the settings those actions read (dates, cost, toggles);
         3. status, only while there is something to report.
         Step (PERIODS of 500 candles from the start date): "next" reveals one
         more candle of the period; "until pos int" = until a position opens or
         closes; "run x×" = x candles; "Reveal All Candles" = the rest of the
         period. When all 500 are revealed, "next" becomes "Next Period": open
         positions close (PERIOD_END) and the next 500 start from candle 0.
         Capture records the whole [start, end] range per symbol to IndexedDB. -->
    <div class="command-area pa-md">
        <div class="command-bar">
            <div class="command-group">
                <span class="command-label">Bot</span>
                <ButtonComponent v-if="!isBotEnabled" @click="startChoco" color="primary" rounded>start choco</ButtonComponent>
                <ButtonComponent v-else @click="isBotEnabled = false" color="danger" rounded>stop choco</ButtonComponent>
            </div>

            <div class="command-group">
                <span class="command-label">Scan</span>
                <ButtonComponent @click="runManualSimulation" :disabled="isBotEnabled || isSteppingCandle || isCapturing" rounded>run all simulation</ButtonComponent>
            </div>

            <div class="command-group">
                <span class="command-label">Step</span>
                <ButtonComponent @click="stepNextCandle" :disabled="!canStepCandle" rounded :color="periodComplete ? 'primary' : undefined"
                    :title="periodComplete ? 'Close all open positions and load the next 500 candles from candle 0' : 'Reveal the next candle of this period'">
                    {{ isSteppingCandle && !isAutoStepping ? stepProgressMessage : (periodComplete ? 'Next Period' : 'next') }}
                </ButtonComponent>
                <template v-if="!isAutoStepping">
                    <ButtonComponent @click="stepUntilPositionInteraction" :disabled="!canStepCandle || periodComplete" rounded
                        title="Keep pressing 'next' until a position opens or closes">
                        until pos int
                    </ButtonComponent>
                    <ButtonComponent @click="stepTimes" :disabled="!canStepCandle || !validRunTimes || periodComplete" rounded
                        title="Press 'next' this many times (set the count on the right)">
                        run {{ validRunTimes ? runTimesInput : 'x' }}×
                    </ButtonComponent>
                    <input type="number" min="1" step="1" v-model.number="runTimesInput" :disabled="isSteppingCandle"
                        class="command-number" title="How many times 'run x×' presses next" />
                </template>
                <ButtonComponent v-else @click="stopAutoStepRequested = true" :disabled="stopAutoStepRequested" color="danger" rounded>
                    {{ stopAutoStepRequested ? 'stopping…' : `stop (${stepProgressMessage})` }}
                </ButtonComponent>
                <ButtonComponent @click="revealAllCandles" :disabled="!canStepCandle || periodComplete" rounded
                    title="Reveal the rest of this period's 500 candles at once">
                    Reveal All Candles
                </ButtonComponent>
            </div>

            <div class="command-group">
                <span class="command-label">Capture</span>
                <ButtonComponent v-if="!isCapturing" @click="autoCapture" :disabled="!canAutoCapture" rounded>auto capture</ButtonComponent>
                <ButtonComponent v-else @click="stopCaptureRequested = true" :disabled="stopCaptureRequested" color="danger" rounded>
                    {{ downloadProgress ? 'downloading…' : stopCaptureRequested ? 'stopping…' : `stop capture (${capturedSymbolCount}/${chocoMintoStore.futureSymbols.length})` }}
                </ButtonComponent>
            </div>

            <div class="command-group command-group-end">
                <span class="command-label">Tools</span>
                <ButtonComponent @click="UI_SHOW_TRADE_REPLAY = true" rounded>trade replay</ButtonComponent>
                <ButtonComponent @click="UI_SHOW_ROLLING_SIMULATION = true" rounded>rolling simulation</ButtonComponent>
            </div>
        </div>

        <div class="command-settings">
            <label class="command-field" :title="`Periods start 1/1/${periodYear} 12:00 AM PHT. ${PERIOD_MIN_YEAR} to the current year.`">
                year
                <select v-model.number="periodYear" :disabled="isSteppingCandle || isCapturing" class="command-year">
                    <option v-for="y in periodYears" :key="y" :value="y">{{ y }}</option>
                </select>
            </label>
            <label class="command-field" title="500-candle periods of the year. 'run all simulation' loads the selected one; auto capture records it.">
                period (PHT)
                <select v-model.number="selectedPeriodIndex" :disabled="isSteppingCandle || isCapturing" class="command-period">
                    <option v-for="p in periods" :key="p.index" :value="p.index">
                        {{ p.index + 1 }}. {{ p.label }}{{ p.isCurrent ? '  (now)' : '' }}
                    </option>
                </select>
            </label>
            <label class="command-field">
                cost
                <InputComponent type="numeric" v-model="chocoMintoStore.orderCost" class="command-cost" />
            </label>
            <label class="command-field">
                <input type="checkbox" v-model="onlyInterestingSymbols" />
                only interesting symbols
            </label>
            <label class="command-field" title="When the capture finishes (or is stopped), download every captured symbol as slim, split zips - same as the chart's Download ALL">
                <input type="checkbox" v-model="autoDownloadAfterCapture" :disabled="isCapturing" />
                auto download capture
            </label>
        </div>

        <div class="command-status" v-if="periodNumber > 0 || captureSummary || downloadProgress">
            <span v-if="periodNumber > 0" class="command-badge" :class="{ 'command-badge-done': periodComplete }">
                Period {{ periodNumber }} · candle {{ periodRevealed }}/{{ periodLength }}<template v-if="periodComplete"> · complete</template>
            </span>
            <span v-if="periodNumber > 0 && periodStartOpenTime">
                from {{ new Date(periodStartOpenTime).toLocaleString() }}<template v-if="steppedToOpenTime && periodRevealed > 1"> · at {{ new Date(steppedToOpenTime).toLocaleString() }}</template>
            </span>
            <span v-if="captureSummary">{{ captureSummary }}</span>
            <span v-if="downloadProgress" :title="downloadProgress.label">
                <progress :value="downloadProgress.value" max="100" class="command-progress"></progress>
                {{ downloadProgress.label }}
            </span>
        </div>
    </div>

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
import type { PositionInteraction } from '@/utility/v2/liveDisplay';
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

// ── PERIOD CALENDAR ─────────────────────────────────────────────────────
// A YEAR is chosen (2020 .. the current year, default the current year). Its
// periods are MAX_INIT_CANDLES (500) 15m candles each, laid end to end from
// 1/1/<year> 12:00 AM PHT; the dropdown lists every period that STARTS in that
// year (up to now). In the current year the period containing "now" is selected,
// otherwise the year's first. "run all simulation" loads the selected period,
// "Next Period" moves to the following one (its last period runs into the next
// year - that one is then appended to the list), auto capture records it.
const PERIOD_CANDLE_MS = 15 * 60 * 1000;
const PERIOD_SPAN_MS = MAX_INIT_CANDLES * PERIOD_CANDLE_MS;
const PERIOD_MIN_YEAR = 2020;

/** The current year in PHT. */
const currentPhtYear = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }));
/** 1/1/<year> 12:00 AM PHT (UTC+8) in epoch ms. */
const yearAnchorMs = (year: number) => Date.UTC(year - 1, 11, 31, 16, 0, 0);

/** Selected year - the current year on load. */
const periodYear = ref<number>(currentPhtYear());
/** The year dropdown: current year first, back to PERIOD_MIN_YEAR. */
const periodYears = computed(() => {
    const years: number[] = [];
    for (let y = currentPhtYear(); y >= PERIOD_MIN_YEAR; y--) years.push(y);
    return years;
});

interface PeriodOption { index: number; startMs: number; endMs: number; label: string; isCurrent: boolean }

const phtDateTime = (ms: number) => new Date(ms).toLocaleString('en-US', {
    timeZone: 'Asia/Manila', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** Index (0-based) of the period containing `ms`, counted from the selected year's anchor. */
const periodIndexAt = (ms: number) => Math.max(0, Math.floor((ms - yearAnchorMs(periodYear.value)) / PERIOD_SPAN_MS));

/**
 * Periods listed past the year's own - set when "Next Period" runs past the
 * last period that starts in the year, so the loaded one is still selectable.
 */
const periodsExtendedTo = ref(-1);

/** Every period that starts in the selected year (and not after now), plus any extension. */
const periods = computed<PeriodOption[]>(() => {
    const anchor = yearAnchorMs(periodYear.value);
    const yearEnd = yearAnchorMs(periodYear.value + 1);
    const now = Date.now();
    const current = Math.floor((now - anchor) / PERIOD_SPAN_MS);
    const list: PeriodOption[] = [];
    for (let i = 0; ; i++) {
        const startMs = anchor + i * PERIOD_SPAN_MS;
        if (startMs > now) break;
        if (startMs >= yearEnd && i > periodsExtendedTo.value) break;
        // The 500th candle's open time.
        const endMs = startMs + (MAX_INIT_CANDLES - 1) * PERIOD_CANDLE_MS;
        list.push({ index: i, startMs, endMs, label: `${phtDateTime(startMs)} → ${phtDateTime(endMs)}`, isCurrent: i === current });
    }
    return list;
});

/** The period to select for a year: the one containing now in the current year, else the first. */
const defaultPeriodIndex = () => periodYear.value === currentPhtYear() ? periodIndexAt(Date.now()) : 0;
const selectedPeriodIndex = ref(defaultPeriodIndex());
watch(periodYear, () => {
    periodsExtendedTo.value = -1;
    selectedPeriodIndex.value = defaultPeriodIndex();
});
const selectedPeriod = computed(() => periods.value[selectedPeriodIndex.value] ?? periods.value[periods.value.length - 1]);

/** Start of the selected period - what the scanner loads (and what auto capture starts at). */
const simulationStartMs = computed(() => selectedPeriod.value?.startMs ?? 0);
/** The selected period's last (500th) candle - where auto capture ends. */
const simulationEndMs = computed(() => selectedPeriod.value?.endMs ?? 0);

// Auto capture state. capturedRun blocks "next" afterwards: next trims every
// window back to MAX_INIT_CANDLES and writes it to IndexedDB, which would
// overwrite the captured range. A fresh "run all simulation" clears it.
const isCapturing = ref(false);
const stopCaptureRequested = ref(false);
const capturedSymbolCount = ref(0);
const capturedRun = ref(false);
const captureSummary = ref('');
/** Auto-download progress after a capture; null when no download is running. */
const downloadProgress = ref<{ value: number; label: string } | null>(null);
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

/** One entry per symbol, first occurrence kept. */
function uniqueBySymbol(list: FuturesSymbol[]): FuturesSymbol[] {
    const seen = new Set<string>();
    return list.filter(f => !seen.has(f.symbol) && !!seen.add(f.symbol));
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

        chocoMintoStore.futureSymbols = uniqueBySymbol(chocoMintoStore.futureSymbols);
        localStorage.setItem(LOCALSTORAGE_CACHED_FUTURES_SYMBOLS,JSON.stringify(chocoMintoStore.futureSymbols));

        UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = false;
    }else{
        // De-duplicated: a list built while the page was remounting mid-load could
        // hold a symbol several times, and every batch would then step it again.
        chocoMintoStore.futureSymbols = uniqueBySymbol(JSON.parse(localStorageFuturesMaxLeverage) as FuturesSymbol[])
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
    periodNumber.value = 0;

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
            // Reading the symbols out of IndexedDB is ~70% of the bar; the
            // last 30% is compressing the final part, the slow step. A part
            // flushed mid-way reports its own compression in the label only.
            downloadProgress.value = { value: 0, label: `reading 0/${symbols.length}` };
            const { parts } = await downloadSymbolInfoZip(symbols, {
                slim: true,
                onExportProgress: (p) => {
                    const readPct = (p.current / p.total) * 70;
                    const left = p.total - p.current;
                    if (p.phase === 'reading') {
                        downloadProgress.value = { value: readPct, label: `reading ${p.current}/${p.total} · ${left} left` };
                    } else if (p.phase === 'compressing') {
                        const isFinal = p.current === p.total;
                        downloadProgress.value = {
                            value: isFinal ? 70 + p.percent * 0.3 : readPct,
                            label: `compressing zip part ${p.part} · ${p.percent.toFixed(0)}%${isFinal ? '' : ` · ${left} symbols left`}`,
                        };
                    } else {
                        downloadProgress.value = { value: readPct, label: `saved zip part ${p.part}${left ? ` · ${left} symbols left` : ''}` };
                    }
                },
            });
            captureSummary.value = `${summary} · downloaded ${parts} zip${parts === 1 ? '' : 's'}`;
        }
    } catch (error) {
        console.error("autoCapture", error);
        notificationStore.showNotification("danger", "top-right", "Auto capture failed", String(error));
    } finally {
        isCapturing.value = false;
        stopCaptureRequested.value = false;
        downloadProgress.value = null;
    }
}

const canStepCandle = computed(() =>
    !isSteppingCandle.value
    && !isCapturing.value
    && !capturedRun.value
    && chocoMintoStore.isManualSimulation
    && Array.isArray(marketScannerRef.value)
    && marketScannerRef.value.length > 0
    && periodNumber.value > 0
);

// ── PERIODS ─────────────────────────────────────────────────────────────
// From the start date, every 500 candles is one PERIOD. "run all simulation"
// loads period 1 and reveals its candle 0; "next" reveals one more candle (the
// analysis runs on that candle only, same result as a full runAnalysis over the
// revealed candles); once all 500 are revealed the button becomes "Next Period",
// which closes every open position (PERIOD_END) and loads the next 500 candles
// from their candle 0. "Reveal All Candles" reveals the rest of the period.
const periodNumber = ref(0);
const periodStartOpenTime = ref<number | null>(null);
const periodRevealed = ref(0);
const periodLength = ref(500);
const periodComplete = ref(false);

function scannersWith(method: string): any[] {
    return ((marketScannerRef.value ?? []) as any[]).filter((s) => s && typeof s[method] === 'function');
}

/** Reads every batch's period position back into the page's period display. */
function refreshPeriodInfo() {
    const infos = scannersWith('getPeriodInfo').map((s) => s.getPeriodInfo()).filter((i: any) => i?.loaded);
    if (!infos.length) { periodComplete.value = false; periodRevealed.value = 0; return; }
    periodStartOpenTime.value = infos[0].startMs;
    periodLength.value = infos[0].length;
    periodRevealed.value = Math.max(...infos.map((i: any) => i.revealed));
    periodComplete.value = infos.every((i: any) => i.complete);
}

/** One press of "next" across every scanner batch: one more candle of the period. */
async function stepOnce(): Promise<{ advanced: number; interactions: PositionInteraction[] }> {
    const results = await Promise.all(scannersWith('stepNextCandle').map((s) => s.stepNextCandle()));
    let advanced = 0;
    let reachedOpenTime: number | null = null;
    const interactions: PositionInteraction[] = [];
    for (const result of results) {
        advanced += result?.advanced ?? 0;
        if (result?.lastOpenTime != null) reachedOpenTime = Math.max(reachedOpenTime ?? 0, result.lastOpenTime);
        if (result?.interactions) interactions.push(...result.interactions);
    }
    if (advanced > 0) {
        steppedCandleCount.value++;
        steppedToOpenTime.value = reachedOpenTime;
    }
    refreshPeriodInfo();
    return { advanced, interactions };
}

function notifyNothingToStep() {
    notificationStore.showNotification(
        "warning", "top-right", "Nothing to step",
        "No symbol had a candle left to reveal. Run the scan first, or press Next Period."
    );
}

function notifyPeriodComplete() {
    notificationStore.showNotification(
        "success", "top-right", `Period ${periodNumber.value} complete`,
        `All ${periodLength.value} candles revealed. Press "Next Period" to close open positions and continue.`
    );
}

/** "3 opened, 1 closed" - the counts of a press's position interactions. */
function interactionCounts(interactions: PositionInteraction[]): string {
    const opened = interactions.filter(x => x.kind === "OPENED").length;
    const closed = interactions.filter(x => x.kind === "CLOSED").length;
    return [opened ? `${opened} opened` : '', closed ? `${closed} closed` : ''].filter(Boolean).join(', ');
}

/** The alert for a press's position interactions: counts only. */
function notifyPositionInteractions(interactions: PositionInteraction[]) {
    if (!interactions.length) return;
    // An alert (stays up until closed) - this is what the press, or "next until
    // new pos int", was waiting for. Counts only; the rows are highlighted in
    // the scanner (green opened, red closed) and the open/closed/won filters
    // list them.
    const counts = interactionCounts(interactions);
    notificationStore.showAlert(
        interactions.some(x => x.kind === "OPENED") ? "success" : "warning",
        `Position interaction: ${counts}`,
        `${new Date(interactions[0].candleOpenTime).toLocaleString()} - ${counts}`
    );
}

/** "next" - or "Next Period" once the period is fully revealed. */
async function stepNextCandle() {
    if (!canStepCandle.value) return;
    if (periodComplete.value) return goToNextPeriod();
    isSteppingCandle.value = true;
    stepProgressMessage.value = 'stepping…';
    try {
        const { advanced, interactions } = await stepOnce();
        if (advanced === 0) notifyNothingToStep();
        else notifyPositionInteractions(interactions);
    } finally {
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

/** "Next Period": closes everything still open and loads the next 500 candles from candle 0. */
async function goToNextPeriod() {
    if (!canStepCandle.value) return;
    isSteppingCandle.value = true;
    stepProgressMessage.value = 'loading next period…';
    try {
        const results = await Promise.all(scannersWith('startNextPeriod').map((s) => s.startNextPeriod()));
        const closed = results.flatMap((r: any) => r?.closed ?? []) as PositionInteraction[];
        steppedCandleCount.value = 0;
        steppedToOpenTime.value = null;
        refreshPeriodInfo();
        // Keep the dropdown and the badge on the period now loaded (adding it to
        // the list if time has moved into a new one).
        const loadedIndex = periodIndexAt(periodStartOpenTime.value ?? 0);
        if (!periods.value[loadedIndex]) periodsExtendedTo.value = loadedIndex;
        selectedPeriodIndex.value = loadedIndex;
        periodNumber.value = loadedIndex + 1;
        const net = closed.reduce((a, p) => a + (p.netPnl ?? 0), 0);
        notificationStore.showNotification(
            "success", "top-right", `Period ${periodNumber.value} started`,
            (closed.length ? `${closed.length} position${closed.length === 1 ? '' : 's'} closed at period end (net ${net.toFixed(3)} USDT). ` : 'Nothing was open. ')
            + (periodStartOpenTime.value ? `From ${new Date(periodStartOpenTime.value).toLocaleString()}.` : '')
        );
    } finally {
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

/** "Reveal All Candles": the rest of the current period at once. */
async function revealAllCandles() {
    if (!canStepCandle.value || periodComplete.value) return;
    isSteppingCandle.value = true;
    stepProgressMessage.value = 'revealing…';
    try {
        const results = await Promise.all(scannersWith('revealAllCandles').map((s) => s.revealAllCandles()));
        const opened = results.reduce((a: number, r: any) => a + (r?.openedCount ?? 0), 0);
        const closed = results.reduce((a: number, r: any) => a + (r?.closedCount ?? 0), 0);
        const reached = Math.max(0, ...results.map((r: any) => r?.lastOpenTime ?? 0));
        if (reached) steppedToOpenTime.value = reached;
        refreshPeriodInfo();
        notificationStore.showNotification(
            "success", "top-right", `Period ${periodNumber.value}: all ${periodLength.value} candles revealed`,
            (opened || closed) ? [opened ? `${opened} opened` : '', closed ? `${closed} closed` : ''].filter(Boolean).join(', ') : 'No position opened or closed.'
        );
    } finally {
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

const isAutoStepping = ref(false);
const stopAutoStepRequested = ref(false);

/** Presses "next" until a press opens or closes a position, the period ends, or stop is pressed. */
async function stepUntilPositionInteraction() {
    if (!canStepCandle.value || periodComplete.value) return;
    isSteppingCandle.value = true;
    isAutoStepping.value = true;
    stopAutoStepRequested.value = false;
    let presses = 0;
    try {
        while (!stopAutoStepRequested.value) {
            stepProgressMessage.value = `${presses} candle${presses === 1 ? '' : 's'}…`;
            const { advanced, interactions } = await stepOnce();
            if (advanced === 0) { notifyNothingToStep(); break; }
            presses++;
            if (interactions.length) { notifyPositionInteractions(interactions); break; }
            if (periodComplete.value) { notifyPeriodComplete(); break; }
        }
    } finally {
        isAutoStepping.value = false;
        stopAutoStepRequested.value = false;
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

/** How many presses "run x times" makes. Remembered across sessions. */
const RUN_TIMES_KEY = 'v2-mint-run-times';
const storedRunTimes = Number(localStorage.getItem(RUN_TIMES_KEY));
const runTimesInput = ref<number>(Number.isInteger(storedRunTimes) && storedRunTimes >= 1 ? storedRunTimes : 10);
watch(runTimesInput, (v) => { if (Number.isInteger(v) && v >= 1) localStorage.setItem(RUN_TIMES_KEY, String(v)); });
const validRunTimes = computed(() => Number.isInteger(runTimesInput.value) && runTimesInput.value >= 1);

/** Presses "next" runTimesInput times (stops at the period's end, or on stop). */
async function stepTimes() {
    if (!canStepCandle.value || !validRunTimes.value || periodComplete.value) return;
    const total = runTimesInput.value;
    isSteppingCandle.value = true;
    isAutoStepping.value = true;
    stopAutoStepRequested.value = false;
    const all: PositionInteraction[] = [];
    let presses = 0;
    try {
        while (presses < total && !stopAutoStepRequested.value) {
            stepProgressMessage.value = `${presses}/${total}…`;
            const { advanced, interactions } = await stepOnce();
            if (advanced === 0) { notifyNothingToStep(); break; }
            presses++;
            all.push(...interactions);
            if (periodComplete.value) break;
        }
        // No modal for a batch run - a short toast with the counts.
        if (presses > 0) {
            notificationStore.showNotification("success", "top-right",
                `Ran ${presses} candle${presses === 1 ? '' : 's'}${periodComplete.value ? ' - period complete' : ''}`,
                all.length ? `${interactionCounts(all)}` : "No position opened or closed.");
        }
    } finally {
        isAutoStepping.value = false;
        stopAutoStepRequested.value = false;
        isSteppingCandle.value = false;
        stepProgressMessage.value = 'next';
    }
}

async function runManualSimulation() {
    // A fresh scan rebuilds every window from the start date, so the step
    // counter no longer describes anything.
    steppedCandleCount.value = 0;
    steppedToOpenTime.value = null;
    periodNumber.value = 0;
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
        refreshPeriodInfo();
        // The calendar number (1 = the period starting 1/1/2025), as in the dropdown.
        periodNumber.value = periodIndexAt(periodStartOpenTime.value ?? simulationStartMs.value) + 1;
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

<style scoped>
/* The page inherits black text; on the dark theme that is unreadable. */
.readable-text {
    color: var(--command-text, #1a1a1a);
    --command-text: #1a1a1a;
    font-weight: 600;
}

.readable-text-muted {
    --command-text: #1a1a1a;
    color: var(--command-text);
    font-size: 12px;
}

.command-area {
    /* Solid, high-contrast text: near-white on the dark theme, near-black on
       light (see the media query below). The page itself inherits black, and the
       theme text color is a faded 64% - both were unreadable here. */
    --command-text: #1a1a1a;
    color: var(--command-text);
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
}

/* Row 1: actions. Groups sit side by side, separated by a divider. */
.command-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    row-gap: 8px;
}

.command-group {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border-left: 1px solid rgba(128, 128, 128, 0.35);
}

.command-group:first-child {
    padding-left: 0;
    border-left: none;
}

.command-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--command-text);
    margin-right: 2px;
}

/* Tools sit at the right end of the bar. */
.command-group-end {
    margin-left: auto;
}

.command-number {
    width: 4.5em;
}

/* Row 2: settings. */
.command-settings {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 18px;
    padding-top: 8px;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
}

.command-field input[type="checkbox"] {
    width: 15px;
    height: 15px;
}

.command-field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--command-text);
    white-space: nowrap;
}

/* Form controls have a white background: give them dark text, whatever the
   theme (the area text is near-white on dark, which vanished on white). */
.command-area select,
.command-area input[type="number"],
.command-area input[type="text"],
.command-area option {
    background: #ffffff;
    color: #1a1a1a;
    border: 1px solid rgba(128, 128, 128, 0.6);
    border-radius: 4px;
    padding: 2px 4px;
    font-weight: 500;
}

.command-year {
    width: 5.5em;
}

.command-period {
    max-width: 100%;
}

.command-cost {
    width: 6em;
}

/* Row 3: status. */
.command-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    font-size: 14px;
    font-weight: 600;
    color: var(--command-text);
}

.command-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(76, 175, 80, 0.2);
}

.command-badge-done {
    background: rgba(255, 193, 7, 0.25);
}

.command-progress {
    width: 140px;
    vertical-align: middle;
}

/* Dark theme - LAST, so it overrides the light defaults above. */
@media (prefers-color-scheme: dark) {
    .command-area,
    .readable-text,
    .readable-text-muted {
        --command-text: #f2f2f2;
    }
}
</style>
