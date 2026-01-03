<template>
    <CardComponent class="pa-sm mr-sm">
        <!-- <button @click="updateCandleEntryWithLastCandle('PARTIUSDT')">test</button> -->
        <CardBodyComponent>
            <ProgressBarComponent v-if="progressCounter > 0" :max="futureSymbols.length" :value="progressCounter" />
            <div 
                v-for="futureSymbol in futureSymbols" 
                class="row" 
                @click="showEntryHistoryModal(futureSymbol)" 
                :style="{ color: visitedSymbols.has(futureSymbol.symbol) ? 'orange' : 'inherit' }">
                <div class="col-lg-8 col-md-8">
                    {{ futureSymbol.symbol }}
                </div>
                <div class="col-lg-4 col-md-4 text-right">
                    {{ futureSymbol.status }}
                </div>
            </div>
        </CardBodyComponent>
    </CardComponent>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
        <DialogHeaderComponent>
            {{ selectedSymbol }}
        </DialogHeaderComponent>
        <CandleEntryHistoryComponent :candle-entries="selectedSymbolCandleEntries"/>
    </DialogComponent>
</template>

<script setup lang=ts>
import type { Candle, CandleEntry, FuturesSymbol, SimulationStats } from '@/core/interfaces';
import CardComponent from '../shared/card/CardComponent.vue';
import CardBodyComponent from '../shared/card/CardBodyComponent.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { KlineUtility } from '@/utility/klineUtility';
import { candleAnalyzer } from '@/utility/candleAnalyzerUtility';
import { klineDbUtility } from '@/utility/klineDbUtility';
import { PnlUtility } from '@/utility/PnlUtility';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import DialogComponent from '../shared/dialog/DialogComponent.vue';
import CandleEntryHistoryComponent from './CandleEntryHistoryComponent.vue';
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue';
import { tradeLogger } from '@/utility/tradeSignalLoggerUtility';
import { indexDBLogger } from '@/utility/indexDbLoggerUtility';
import { useNotificationStore } from '@/stores/notificationStore';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import ProgressBarComponent from '../shared/ProgressBarComponent.vue';
import { SimulationUtility } from '@/utility/simulationUtility';

const chocoMintoStore = useChocoMintoStore();
const notificationStore = useNotificationStore();
const visitedSymbols = ref<Set<string>>(new Set()); 

const props = defineProps<{
  futureSymbols: FuturesSymbol[];
  margin:number
  interval: string,
  supportAndResistancePeriodLength:number,
  maxInitCandles:number,
  targetTpRoi:number,
  targetSlRoi:number,
  newCandleTriggerKey: string;
  positionDurationMedian: number;
  maxOpenPositions: number;
}>();

const showEntryHistory = ref(false);
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])
const selectedSymbol = ref("")

const progressCounter = ref(0)


const calculatedMaxOpenPosition = computed(() => {
  const mb = chocoMintoStore.marginBalance;
  const openPositionsIncrement = mb >= 200
    ? Math.floor((mb - 200) / 100) + 1
    : 0;
  return props.maxOpenPositions + (10 * openPositionsIncrement);
});

watch(
  () => props.newCandleTriggerKey,
  async () => {
    await onNewCandleSpawed(); 
  }
);


onMounted(async () => {
    await initializeFutureSymbolData();
})

async function showEntryHistoryModal(futureSymbol: FuturesSymbol){
    showEntryHistory.value = true;
    selectedSymbol.value = futureSymbol.symbol;
    visitedSymbols.value.add(futureSymbol.symbol);
    selectedSymbolCandleEntries.value = await klineDbUtility.getKlines(futureSymbol.symbol);
}

async function initializeFutureSymbolData(){
    progressCounter.value = 0;

    for (let i = 0; i <= props.futureSymbols.length - 1; i++) {
        try {
            progressCounter.value = i + 1;

            var futureSymbol = props.futureSymbols[i];
            futureSymbol.status = "processing"

            //if(futureSymbol.symbol != "xxx") continue;

            await runPositionEntry(futureSymbol.symbol, futureSymbol.maxLeverage, true);
            
            await new Promise(resolve => setTimeout(resolve, 400));

            if(chocoMintoStore.isManualSimulation){
                var storeFutureSymbol = chocoMintoStore.futureSymbols.find(f => f.symbol == futureSymbol.symbol);
                if(storeFutureSymbol){
                    futureSymbol.status = `${storeFutureSymbol.simulationStats.won}/${storeFutureSymbol.simulationStats.loss}/${storeFutureSymbol.simulationStats.open}`
                }
            }else{
                futureSymbol.status = "-"
            }   
        } catch (error) {
            console.error("initializeFutureSymbolData", error)
        }
    }

    progressCounter.value = 0;
}

async function runPositionEntry(symbol: string, maxLeverage: number, isFreshRun:boolean){
    var candles : CandleEntry[] = [];
    const raw: Candle[] = []
    if(isFreshRun){
        const raw = await KlineUtility.getRecentKlines(symbol, props.interval, props.maxInitCandles);
        if(raw.length < props.maxInitCandles) {
            candles = [];
            return
        }

        candleAnalyzer.initializePastCandlesSupportResistance(raw,props.maxInitCandles - props.supportAndResistancePeriodLength,props.supportAndResistancePeriodLength);

        candles = [];
        candles = raw.map(c => ({
            ...c,
            close_atr_abs_change: 0,
            close_atr_adjusted: 0,
            symbol: symbol,
            status: '',
            side: '',
            tpPrice: 0,
            duration: 0,
            slPrice: 0,
            zoneAnalysis: null,
            volumeAnalysis: null,
            overboughSoldAnalysis: null,
            pastVolumeAnalysis: null,
            candleData: null,
            priceZone: null,
            priceZoneInteraction: null,
            pnl: 0,
            leverage: 0,
            margin: 0,
            entryFee: 0,
            zoneSizePercentage: 0,
            closeAbsDistanceToZone: null,
            priceZoneEvaluation: null,
            patternTrack: ""
        }));

    }else{
        candles = await klineDbUtility.getKlines(symbol)
    }

    candleAnalyzer.trackSwingPatterns(candles);

    await SimulationUtility.markPositionEntries(
        props.margin,
        props.positionDurationMedian,
        props.targetTpRoi,
        props.targetSlRoi,
        symbol,
        candles,
        maxLeverage,
        candles.length - 1,
        chocoMintoStore.startingTimeStamp);

    if(chocoMintoStore.isManualSimulation){
        updateStoreFutureSymbolSimulationStats(symbol,candles);

        var closedPositions = candles.filter(b => b.status == "WON" || b.status == "LOSS");
        for (let p = 0; p <= closedPositions.length - 1; p++) {
            tradeLogger.logBackTestResult(closedPositions[p]);
        }
    }

    klineDbUtility.initializeKlineData(symbol,candles.slice(0, -1));
}

function updateStoreFutureSymbolSimulationStats(symbol:string, candle:CandleEntry[]){
    
    var storeFutureSymbol = chocoMintoStore.futureSymbols.find(s => s.symbol == symbol);
    if(storeFutureSymbol){
        var won = candle.filter(p => p.status == "WON").length;
        var loss = candle.filter(p => p.status == "LOSS").length;
        var mid = candle.filter(p => p.status == "MID").length;
        var open = candle.filter(p => p.side && p.tpPrice > 0 && p.slPrice > 0 && p.status == "OPEN").length;

        var takerFee = candle.reduce((sum, s) => sum + s.entryFee, 0);
        var closedPnl = candle.filter(p => p.status == "WON" || p.status == "LOSS").reduce((sum, s) => sum + s.pnl, 0);
        var wonPnl = candle.filter(p => p.status == "WON").reduce((sum, s) => sum + s.pnl, 0);
        var lossPnl = candle.filter(p => p.status == "LOSS").reduce((sum, s) => sum + s.pnl, 0);
        var openPnl = candle.filter(p => p.side && p.tpPrice > 0 && p.slPrice > 0 && p.status == "OPEN").reduce((sum, s) => sum + s.pnl, 0);

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

async function onNewCandleSpawed(){
    progressCounter.value = 0;

    for (let i = 0; i <= props.futureSymbols.length - 1; i++) {
        progressCounter.value = i + 1;

        var futureSymbol = props.futureSymbols[i];

        await updateCandleEntryWithLastCandle(futureSymbol.symbol);
    }

    progressCounter.value = 0;

    props.futureSymbols.forEach(f => {
        f.status = "resetting..."
    });

    setTimeout(() => {
        initializeFutureSymbolData()
    }, 30000);
}

async function updateCandleEntryWithLastCandle(symbol:string){
    var futureSymbol = props.futureSymbols.find(f => f.symbol == symbol)!;

    futureSymbol.status = "scanning"

    var pastKlineEntries = await klineDbUtility.getKlines(symbol);
    pastKlineEntries = pastKlineEntries.sort((a, b) => a.openTime - b.openTime)

    //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: last item of pastKlineEntries: ${JSON.stringify(pastKlineEntries[pastKlineEntries.length - 1])}`);

    if(pastKlineEntries.length < props.maxInitCandles - 2)
    {
        futureSymbol.status = "-";
        return;
    }

    var latest2Candle = await KlineUtility.getRecentKlines(symbol,props.interval,2);
    var previousCandle = latest2Candle[0];
    //var previousCandle: Candle = {"openTime":1766889900000,"open":0.1068,"high":0.10683,"low":0.1059,"close":0.10603,"volume":70149.82308,"closeTime":1766890799999,"closed":true,"breakthrough_resistance":false,"breakthrough_support":false,"support":null,"resistance":null}

    //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: latest2Candle previousCandle: ${JSON.stringify(previousCandle)}`);

    var entryCandle: CandleEntry = {
        ...previousCandle,
        close_atr_abs_change: 0,
        close_atr_adjusted: 0,
        symbol: symbol,
        duration: 0,
        status: '',
        side: '',
        tpPrice: 0,
        slPrice: 0,
        zoneAnalysis: null,
        volumeAnalysis: null,
        overboughSoldAnalysis: null,
        pastVolumeAnalysis: null,
        candleData: null,
        priceZone: null,
        priceZoneInteraction: null,
        pnl: 0,
        leverage: 0,
        margin: 0,
        entryFee: 0,
        closeAbsDistanceToZone: null,
        priceZoneEvaluation: null,
        patternTrack: ""
    }

    
    pastKlineEntries.push(entryCandle);
    pastKlineEntries = pastKlineEntries.sort((a, b) => a.openTime - b.openTime)

    var {support,resistance} = candleAnalyzer.computeSupportResistance(pastKlineEntries,props.supportAndResistancePeriodLength);

    entryCandle.support = support;
    entryCandle.resistance = resistance;

    entryCandle.breakthrough_resistance = entryCandle.close > resistance.upper;
    entryCandle.breakthrough_support = entryCandle.close < support.lower;

    //await klineDbUtility.insertNewKline(symbol, entryCandle)

    await SimulationUtility.markPositionEntries(
        props.margin,
        props.positionDurationMedian,
        props.targetTpRoi,
        props.targetSlRoi,
        symbol,
        pastKlineEntries,
        futureSymbol!.maxLeverage,
        pastKlineEntries.length - 1,
        chocoMintoStore.startingTimeStamp);

    //klineDbUtility.initializeKlineData(symbol,pastKlineEntries);

    var prevKlineEntry = pastKlineEntries[pastKlineEntries.length - 1];

    //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: prevKlineEntry: ${JSON.stringify(prevKlineEntry)}`);

    const pastKlineCandles: Candle[] = pastKlineEntries.map(e => ({
        openTime: e.openTime,
        open: e.open,
        high: e.high,
        low: e.low,
        close: e.close,
        volume: e.volume,
        closeTime: e.closeTime,
        closed: e.closed,
        support: e.support,
        resistance: e.resistance,
        breakthrough_resistance: e.breakthrough_resistance,
        breakthrough_support: e.breakthrough_support,
    }));
    
    const pastVolumeAnalysis = candleAnalyzer.analyzePastVolumes(pastKlineCandles, pastKlineCandles.length - 1, 6);

    var isPrevCandleTriggeredOpen = prevKlineEntry.status == "OPEN"
    if(isPrevCandleTriggeredOpen){
        //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: isPrevCandleTriggeredOpen==true, prevKlineEntry.side=${prevKlineEntry.side}`);

        if(prevKlineEntry.side == "SHORT"){
            if(chocoMintoStore.isLive){
                await OrderMakerUtility.openOrder(
                    symbol,
                    prevKlineEntry.margin,
                    "SELL",
                    prevKlineEntry.tpPrice,
                    prevKlineEntry.slPrice);

                //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: SHORT order created`);
            }else{
                await tradeLogger.logSignal(
                    symbol,
                    "SELL",
                    { lower: prevKlineEntry.support!.lower, upper: prevKlineEntry.support!.upper },
                    { lower: prevKlineEntry.resistance!.lower, upper: prevKlineEntry.resistance!.upper },
                    prevKlineEntry.close,
                    { tp: prevKlineEntry.tpPrice, sl: prevKlineEntry.slPrice },
                    prevKlineEntry.candleData!,
                    prevKlineEntry.zoneAnalysis!,
                    prevKlineEntry.margin,
                    futureSymbol!.maxLeverage,
                    PnlUtility.calculateTakerFee(prevKlineEntry.margin,futureSymbol!.maxLeverage),
                    prevKlineEntry.volumeAnalysis!,
                    pastKlineCandles[pastKlineCandles.length - 1].openTime,
                    pastVolumeAnalysis
                );
            }

            notificationStore.showNotification('success', 'top-right', "SELL", 'order has been created');
            notificationStore.sendNotification(symbol,"SELL");
        }else if(prevKlineEntry.side == "LONG"){
            if(chocoMintoStore.isLive){
                await OrderMakerUtility.openOrder(
                    symbol,
                    prevKlineEntry.margin,
                    "BUY",
                    prevKlineEntry.tpPrice,
                    prevKlineEntry.slPrice);
                
                //indexDBLogger.writeLog(`[updateCandleEntryWithLastCandle][${symbol}]: LONG order created`);
            }else{
                await tradeLogger.logSignal(
                    symbol,
                    "BUY",
                    { lower: prevKlineEntry.support!.lower, upper: prevKlineEntry.support!.upper },
                    { lower: prevKlineEntry.resistance!.lower, upper: prevKlineEntry.resistance!.upper },
                    prevKlineEntry.close,
                    { tp: prevKlineEntry.tpPrice, sl: prevKlineEntry.slPrice },
                    prevKlineEntry.candleData!,
                    prevKlineEntry.zoneAnalysis!,
                    prevKlineEntry.margin,
                    futureSymbol!.maxLeverage,
                    PnlUtility.calculateTakerFee(prevKlineEntry.margin,futureSymbol!.maxLeverage),
                    prevKlineEntry.volumeAnalysis!,
                    pastKlineCandles[pastKlineCandles.length - 1].openTime,
                    pastVolumeAnalysis
                );
            }

            notificationStore.showNotification('success', 'top-right', "BUY", 'order has been created');
            notificationStore.sendNotification(symbol,"BUY");
        }
    }else{
        await checkOpenPosition(symbol, prevKlineEntry,futureSymbol.maxLeverage);
    }

    futureSymbol.status = "-"
}

async function checkOpenPosition(symbol:string,previousCandle:CandleEntry,maxLeverage:number){
    var openPosition = await tradeLogger.getOpenPosition(symbol);
    
    if(openPosition){
        var _estimatedPnlPercentage = 0
        var _estimatedPnl = 0

        if(openPosition.side == "BUY"){
            if(previousCandle.high > openPosition.tpsl.tp){
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,openPosition.tpsl.tp, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
                tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.tp,"WON")

            }else if(previousCandle.low < openPosition.tpsl.sl){
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,openPosition.tpsl.sl, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
                tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.sl,"LOSS")
            }else{
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,previousCandle.close, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
            }
        }else if (openPosition.side == "SELL"){
            if(previousCandle.low < openPosition.tpsl.tp){
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,openPosition.tpsl.tp, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
                tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.tp,"WON")
            }else if(previousCandle.high > openPosition.tpsl.sl){
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,openPosition.tpsl.sl, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
                tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.sl,"LOSS")
            }else{
                _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition.currentPrice,previousCandle.close, openPosition.side.toUpperCase(), maxLeverage);
                _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, maxLeverage);

                await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
            }
        }

        if(_estimatedPnlPercentage > openPosition.pnlPercentage.highest){
            await tradeLogger.scheduleHighestUpdate(openPosition.id!,_estimatedPnlPercentage);
        }

        if(_estimatedPnlPercentage < openPosition.pnlPercentage.lowest){
            await tradeLogger.scheduleLowestUpdate(openPosition.id!,_estimatedPnlPercentage);
        }
    }
}

</script>

<style scoped>

</style>