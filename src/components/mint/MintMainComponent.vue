<template>
    <div class="text-center text-secondary">
        <label>v1.81Z5-P4-1-N</label>
    </div>
    <SymbolSocketComponent 
        :symbol="MASTER_SYMBOL" 
        :interval="KLINE_INTERVAL" 
        @on-new-candle="onNewCandle"/>

    <div v-if="UI_STATE_INITIALIZING_FUTURE_SYMBOLS" class="text-center">
        {{ UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE }}
    </div>

    <div class="pa-md">
        <LiveAccountMonitoringComponent :margin="MARGIN" v-if="chocoMintoStore.isLive" />
        <SimulatedPositionSummaryComponent v-else :margin="MARGIN" :starting-balance="STARTING_BALANCE" />
    </div>

    <div class="pa-md text-left">
        <div>
            <CheckboxComponent v-model="chocoMintoStore.isLive">
                Is Live
            </CheckboxComponent>
            <CheckboxComponent v-model="chocoMintoStore.isRedeemerEnabled">
                Enable Redeemer
            </CheckboxComponent>
        </div>
        
        <ButtonComponent v-if="!isBotEnabled" @click="startChoco" color="primary" rounded class="mr-sm">start choco</ButtonComponent>
        <ButtonComponent v-else @click="isBotEnabled = false" color="danger" rounded class="mr-sm">stop choco</ButtonComponent>

        <ButtonComponent v-if="!isBotEnabled" @click="clearSessionRange" rounded class="mr-sm">clear session range</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="runManualSimulation" rounded class="mr-sm">run all simulation</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="tradeLogger.downloadBackTestLogs()" rounded class="mr-sm">download simulation</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="klineDbUtility.downloadAll()" rounded class="mr-sm">download candles</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="UI_SHOW_REPLAY = true" rounded>view replay</ButtonComponent>
        <ButtonComponent @click="runStats" rounded class="ml-sm">run stats</ButtonComponent>
        <ButtonComponent @click="indexDBLogger.download" rounded class="ml-sm">view logs</ButtonComponent>
        <ButtonComponent @click="clearLogs" rounded class="ml-sm">clear logs</ButtonComponent>

        
        <InputComponent type="numeric" v-model="chocoMintoStore.startingTimeStamp" />
        <div>{{ (new Date(botStartOn)).toLocaleString() }}</div>
        <div>{{ (new Date(chocoMintoStore.startingTimeStamp)).toLocaleString() }}</div>
        <div>{{ (new Date(chocoMintoStore.endingTimeStamp)).toLocaleString() }}</div>

        <div class="divider"></div>
        <div v-if="UI_SYMBOL_OF_INTEREST_MESAGE">{{ UI_SYMBOL_OF_INTEREST_MESAGE }}</div>
        <div v-for="sym in symbolsOfInterest" @click="showEntryHistoryModal(sym)">
            {{ sym }}
        </div>

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
    </div>

    <div class="text-center">
        Last Bal Check: {{ UI_BAL_CHECK }}
    </div>

    <div class="row pa-md" v-if="isBotEnabled || chocoMintoStore.isManualSimulation">
        <div class="text-center" v-if="UI_STATE_FORCE_CLOSE_MESSAGE != ''">
            {{ UI_STATE_FORCE_CLOSE_MESSAGE }}
        </div>
        <div v-for="(futureSymbolBatch,index) in futureSymbolBatches" class="col-lg-3 col-md-3">
            <SymbolBasketComponent 
                :key="basketKey"
                :future-symbols="futureSymbolBatch" 
                :margin="MARGIN"
                :interval="KLINE_INTERVAL"
                :support-and-resistance-period-length="SUPPORT_AND_RESISTANCE_PERIOD_LENGTH"
                :max-init-candles="MAX_INIT_CANDLES"
                :target-tp-roi="TP_ROI"
                :target-sl-roi="SL_ROI"
                :new-candle-trigger-key="onNewCandleBasketTriggerKey"
                :position-duration-median="POSITION_DURATION_MEDIAN"
                :max-open-positions="MAX_OPEN_POSITIONS"/>
        </div>
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

</template>

<script setup lang="ts">
import type { Candle, CandleEntry, FuturesSymbol, SimulationStats, TradeLog } from '@/core/interfaces';
import SymbolSocketComponent from './SymbolSocketComponent.vue';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { computed, onMounted, ref } from 'vue';
import SymbolBasketComponent from './SymbolBasketComponent.vue';
import { CommonHelperUtility } from '@/utility/CommonHelperUtility';
import SimulatedPositionSummaryComponent from './SimulatedPositionSummaryComponent.vue';
import ButtonComponent from '../shared/form/ButtonComponent.vue';
import CheckboxComponent from '../shared/form/CheckboxComponent.vue';
import CardComponent from '../shared/card/CardComponent.vue';
import CardHeaderComponent from '../shared/card/CardHeaderComponent.vue';
import CardBodyComponent from '../shared/card/CardBodyComponent.vue';
import { tradeLogger } from '@/utility/tradeSignalLoggerUtility';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
// import ReplayCandleEntryComponent from './ReplayCandleEntryComponent.vue';
import { klineDbUtility } from '@/utility/klineDbUtility';
import InputComponent from '../shared/form/InputComponent.vue';
import { KlineUtility } from '@/utility/klineUtility';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import ReplayCandleEntryComponent from './ReplayCandleEntryComponent.vue';
import { useNotificationStore } from '@/stores/notificationStore';
import LiveAccountMonitoringComponent from './LiveAccountMonitoringComponent.vue';
import { indexDBLogger } from '@/utility/indexDbLoggerUtility';

const chocoMintoStore = useChocoMintoStore();
const notificationStore = useNotificationStore();

const isBotEnabled = ref(false)

const MASTER_SYMBOL = "BTCUSDT";
const KLINE_INTERVAL = "15m"
const MAX_INIT_CANDLES = 210;
const SUPPORT_AND_RESISTANCE_PERIOD_LENGTH = 10;

const MARGIN = 1.5;
const TP_ROI = 2;
const SL_ROI = 2.5;
const STARTING_BALANCE = 100;
const MAX_OPEN_POSITIONS = 20;
const TARGET_GAIN = 10;
const POSITION_DURATION_MEDIAN = 10;

const LOCALSTORAGE_CACHED_FUTURES_SYMBOLS = "CACHED_FUTURES_SYMBOLS";

const UI_STATE_INITIALIZING_FUTURE_SYMBOLS = ref(false);
const UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE = ref("")
const UI_STATE_FORCE_CLOSE_MESSAGE = ref('')
const UI_SHOW_REPLAY = ref(false)
const UI_SYMBOL_OF_INTEREST_MESAGE = ref('')
const UI_BAL_CHECK = ref('')

const futureSymbolBatches = ref<FuturesSymbol[][]>([])

const symbolsOfInterest = ref<string[]>([])

const onNewCandleBasketTriggerKey = ref(CommonHelperUtility.generateGuid());
const basketKey = ref(CommonHelperUtility.generateGuid());

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])
const selectedSymbol = ref("")

const botStartOn = ref(0)

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
    botStartOn.value = (new Date()).getTime();

    var sessionRange = getSessionRange(new Date());
    console.log(sessionRange);

    if(chocoMintoStore.startingTimeStamp == 0){
        var storageStartingTimeStamp = localStorage.getItem('start-time');
        var storageEndingTimeStamp = localStorage.getItem('end-time');
        if(storageStartingTimeStamp && storageEndingTimeStamp){
            chocoMintoStore.startingTimeStamp = parseInt(storageStartingTimeStamp)
            chocoMintoStore.endingTimeStamp = parseInt(storageEndingTimeStamp)
        }else{
            var klineInt = parseInt(KLINE_INTERVAL.replace('m',''))
            chocoMintoStore.startingTimeStamp = sessionRange.start.getTime();
            chocoMintoStore.endingTimeStamp = sessionRange.end.getTime();
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
        for (let i = 0; i <= futureSymbols.length - 1; i++) {
            var symbol = futureSymbols[i];
            UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE.value = `Processing: ${i + 1} / ${futureSymbols.length} [${symbol}]`;

            var maxLeverage = (await OrderMakerUtility.getMaxLeverage(symbol));
            if(maxLeverage >= 50){
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
                    }
                })
            }
        }

        localStorage.setItem(LOCALSTORAGE_CACHED_FUTURES_SYMBOLS,JSON.stringify(chocoMintoStore.futureSymbols));

        UI_STATE_INITIALIZING_FUTURE_SYMBOLS.value = false;
    }else{
        chocoMintoStore.futureSymbols = JSON.parse(localStorageFuturesMaxLeverage) as FuturesSymbol[]
    }

    //chocoMintoStore.futureSymbols = chocoMintoStore.futureSymbols.slice(0,24);
    futureSymbolBatches.value = chocoMintoStore.splitFutureSymbols(4);
}

async function onNewCandle(candle:Candle){
    //send event to the SymbolBasketComponent
    if(chocoMintoStore.isLive && chocoMintoStore.isRedeemerEnabled){
        var balance = await OrderMakerUtility.getBalance();
        const positions = await OrderMakerUtility.getPositions();
        const fees = OrderMakerUtility.calculateTotalTradingFees(positions);
        var baseTarget = MARGIN * 5
        var targetProfit = baseTarget + fees.totalFees + fees.liquidityBuffer

        UI_BAL_CHECK.value = `T: ${targetProfit} => U: ${balance.unrealized_pnl}`
        
        if(balance && balance.unrealized_pnl > targetProfit){
            try {
                await OrderMakerUtility.closeAllOpenPositions();
            } catch (error) {
                const errorDetails = {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    name: error instanceof Error ? error.name : 'Unknown',
                    timestamp: new Date().toISOString(),
                    symbol: ""
                };
                indexDBLogger.writeLog(`[closing positions] Error: ${JSON.stringify(errorDetails)}`);
            }
        }
    }

    if(!chocoMintoStore.isManualSimulation){
        setTimeout(() => {
            onNewCandleBasketTriggerKey.value = CommonHelperUtility.generateGuid();
        }, 5000);
    }
}

function runManualSimulation(){
    chocoMintoStore.isManualSimulation = true;
    tradeLogger.clearBackTestLogs();
    basketKey.value = CommonHelperUtility.generateGuid();
}

function clearSessionRange(){
    localStorage.removeItem("start-time");
    localStorage.removeItem("end-time");
    notificationStore.showNotification("info","top-right","clear","Session range has been cleared");
}

function clearLogs(){
    indexDBLogger.clearLogs();
    notificationStore.showNotification("info","top-right","clear","Logs has been cleared");
}

async function runStats(){
    symbolsOfInterest.value = [];
    for (let i = 0; i <= chocoMintoStore.futureSymbols.length - 1; i++) {
        var symbol = chocoMintoStore.futureSymbols[i].symbol;

        UI_SYMBOL_OF_INTEREST_MESAGE.value = `${symbol} ${i + 1}/${chocoMintoStore.futureSymbols.length}`

        var candles = await klineDbUtility.getKlines(symbol);

        //==GET WIDE ZONES
        // var zones = candles.filter(c => c.candleData && c.candleData.isNewZone)
        // var countHits = zones.slice(-3).filter(c => c.candleData && c.candleData.zoneSizePercentage > 10).length;
        // if(countHits > 1){
        //     symbolsOfInterest.value.push(symbol);
        // }

        const grouped = candles.reduce((acc : any, { side }) => {
            acc[side] = (acc[side] || 0) + 1
            return acc
        }, {})

        // var hit = candles[candles.length - 1].patternTrack != ""
        // if(hit){
        //     symbolsOfInterest.value.push(symbol);
        // }

        //==GET POSITION OPENED AFTER LIVE
        var countHits = candles.filter(c => c.openTime >= chocoMintoStore.startingTimeStamp && (c.side == "SHORT" || c.side == "LONG")).length;
        if(countHits >= 1){
            symbolsOfInterest.value.push(symbol);
        }

        //GET HIGHER LOSSES
        // var countHits = candles.filter(c => c.pnl < -3).length;
        // if(countHits > 1){
        //     symbolsOfInterest.value.push(symbol);
        // }

        //==GET moderate_buy / strong_buy
        // var countHits = candles.filter(c => c.priceZoneInteraction && (c.priceZoneInteraction.breakoutStartScore?.recommendation == 'strong_buy')).length;
        // if(countHits > 1){
        //     symbolsOfInterest.value.push(symbol);
        // }

        //==GET JUST BREAKOUT
        // var justBreakoutStarted = candles[candles.length - 1].priceZoneInteraction!.breakoutType == 'breakout_start'

        // if(justBreakoutStarted){
        //     symbolsOfInterest.value.push(symbol);
        // }

        //==GET PEAK BREAKOUTS
        // var countHits = candles.filter(c => c.priceZoneInteraction && c.priceZoneInteraction.lastBreakoutChange > 10).length;

        // if(countHits > 1){
        //     symbolsOfInterest.value.push(symbol);
        // }
    }

    UI_SYMBOL_OF_INTEREST_MESAGE.value = "";
}

async function showEntryHistoryModal(symbol: string){
    showEntryHistory.value = true;
    selectedSymbol.value = symbol;
    selectedSymbolCandleEntries.value = await klineDbUtility.getKlines(symbol);
}

function getSessionRange(ts: Date) {
    const d = new Date(ts);
    const m = d.getHours() * 60 + d.getMinutes();

    // Session boundaries (where a timestamp belongs)
    const bounds = [
        { label: "00", min: 0 },       // 12am–6am
        { label: "06", min: 360 },     // 6am–12pm
        { label: "12", min: 720 },     // 12pm–6pm
        { label: "18", min: 1080 }     // 6pm–12am
    ];

    // Start times by index (0→12am session, 1→6am session, etc.)
    const startTimes = [
        { hh: 9, mm: 15, prev: true },  // for 12am session → 9:15pm previous day
        { hh: 12,  mm: 15, prev: false }, // for 6am session
        { hh: 9,  mm: 15, prev: false }, // for 12pm session
        { hh: 12, mm: 15, prev: false }  // for 6pm session
    ];

    // End times by index (all next day)
    const endTimes = [
        { hh: 0,  mm: 0 },  // next day 12am
        { hh: 6,  mm: 0 },  // next day 6am
        { hh: 12, mm: 0 },  // next day 12pm
        { hh: 18, mm: 0 }   // next day 6pm
    ];

    function mk(base: Date, hh: number, mm: number) {
        return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
    }

    // Determine which session the timestamp falls into
    let idx = 0;
    for (let i = 0; i < bounds.length; i++) {
        const cur = bounds[i];
        const next = bounds[(i + 1) % bounds.length];
        const upper = next.min === 0 ? 1440 : next.min;
        if (m >= cur.min && m < upper) {
            idx = i;
            break;
        }
    }

    // Compute start
    const s = startTimes[idx];
    const startBase = s.prev
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
        : d;
    const start = mk(startBase, s.hh, s.mm);

    // Compute end (always next day relative to timestamp)
    const e = endTimes[idx];
    const endBase = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const end = mk(endBase, e.hh, e.mm);

    return { start, end };
}

</script>