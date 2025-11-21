<template>
    <div class="text-center text-secondary">
        <label>v1.45</label>
    </div>
    <SymbolSocketComponent 
        :symbol="MASTER_SYMBOL" 
        :interval="KLINE_INTERVAL" 
        @on-new-candle="onNewCandle"/>

    <div v-if="UI_STATE_INITIALIZING_FUTURE_SYMBOLS" class="text-center">
        {{ UI_STATE_INITIALIZING_FUTURE_SYMBOL_MESSAGE }}
    </div>

    <div class="pa-md">
        <SimulatedPositionSummaryComponent :margin="MARGIN" :starting-balance="STARTING_BALANCE" />
    </div>

    <div class="pa-md text-left">
        <ButtonComponent v-if="!isBotEnabled" @click="startChoco" color="primary" rounded class="mr-sm">start choco</ButtonComponent>
        <ButtonComponent v-else @click="isBotEnabled = false" color="danger" rounded class="mr-sm">stop choco</ButtonComponent>

        <ButtonComponent v-if="!isBotEnabled" @click="runManualSimulation" rounded class="mr-sm">run all simulation</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="tradeLogger.downloadBackTestLogs()" rounded class="mr-sm">download simulation</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="klineDbUtility.downloadAll()" rounded class="mr-sm">download candles</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="UI_SHOW_REPLAY = true" rounded>view replay</ButtonComponent>
        <ButtonComponent v-if="!isBotEnabled" @click="runStats" rounded class="ml-sm">run stats</ButtonComponent>

        
        <InputComponent v-model="chocoMintoStore.startingTimeStamp" />
        <label>{{ startingTimeStampLocal }}</label>

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
                <div class="divider"></div>
                <div v-if="UI_SYMBOL_OF_INTEREST_MESAGE">{{ UI_SYMBOL_OF_INTEREST_MESAGE }}</div>
                <div v-for="sym in symbolsOfInterest" @click="showEntryHistoryModal(sym)">
                    {{ sym }}
                </div>
            </CardBodyComponent>
        </CardComponent>
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

const chocoMintoStore = useChocoMintoStore();

const isBotEnabled = ref(false)

const MASTER_SYMBOL = "BTCUSDT";
const KLINE_INTERVAL = "15m"
const MAX_INIT_CANDLES = 106;
const SUPPORT_AND_RESISTANCE_PERIOD_LENGTH = 10;

const MARGIN = 1;
const TP_ROI = 3;
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

const futureSymbolBatches = ref<FuturesSymbol[][]>([])

const symbolsOfInterest = ref<string[]>([])

const onNewCandleBasketTriggerKey = ref(CommonHelperUtility.generateGuid());
const basketKey = ref(CommonHelperUtility.generateGuid());

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])
const selectedSymbol = ref("")

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

const startingTimeStampLocal = computed(() => {
  const ts = chocoMintoStore.startingTimeStamp;
  if (!ts) return '';

  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1); // months are 0-indexed
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12; // convert 0 to 12
  const hourStr = pad(hours);

  return `${day}/${month}/${year} ${hourStr}:${minutes}:${seconds} ${ampm}`;
});

onMounted(async () => {
    await BinanceMarginUtility.fetchAllFuturesBrackets();
    await initializeFutureSymbols();
})

function startChoco(){

    if(chocoMintoStore.startingTimeStamp == 0){
        var storageStartingTimeStamp = localStorage.getItem('start-time');
        if(storageStartingTimeStamp){
            chocoMintoStore.startingTimeStamp = parseInt(storageStartingTimeStamp)
        }else{
            var klineInt = parseInt(KLINE_INTERVAL.replace('m',''))
            chocoMintoStore.startingTimeStamp = Date.now() - (klineInt * 2) * 60 * 1000;
        }
    }

    localStorage.setItem('start-time',chocoMintoStore.startingTimeStamp.toString())

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

        //GET HIGHER LOSSES
        var countHits = candles.filter(c => c.pnl < -3).length;
        if(countHits > 1){
            symbolsOfInterest.value.push(symbol);
        }

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
</script>