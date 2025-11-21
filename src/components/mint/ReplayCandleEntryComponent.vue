<template>
    <div>
        <ButtonComponent rounded color="ghost" @click="(async () => { await prepareCandleEntryData(); })">reset candles</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="(async () => { await runForwardSimulation(); })">run replay</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="(async () => { await clearRunData(); })">clear run data</ButtonComponent>
        <ButtonComponent rounded color="ghost" @click="(async () => { await tradeLogger.downloadLogs(); })">download data</ButtonComponent>
        <InputComponent v-model="startingTimeStamp" />

        <div class="text-center">{{ currentTimestampLocal }}</div>
        <div class="timestamps-container">
            <div v-for="timestamp in timestamps" :key="timestamp" class="timestamp-box" :class="{ passed: timestamp <= currentTimestamp }" @click="startingTimeStamp = timestamp">

            </div>
        </div>
        <div class="text-center">{{ (new Date(startingTimeStamp)).toLocaleString() }}</div>
        <div class="text-center">{{ UI_SIMULATION_MESSAGE }}</div>

        <div class="row">
            <div class="col-lg-3 col-md-3 pa-md">
                <div>Max Open Positions: {{ calculatedMaxOpenPosition }}</div>
                <div class="divider"></div>
                <div>Won: {{ simulationStats.won }}</div>
                <div>Loss: {{ simulationStats.loss }}</div>
                <div>Open: {{ simulationStats.open }}</div>
                <div class="divider"></div>
                <div>Taker Fee: {{ simulationStats.totalTakerFee.toFixed(2) }} USDT</div>
                <div>Closed PNL: {{ simulationStats.totalClosedPnl.toFixed(2) }} USDT</div>
                <div>Open PNL: {{ simulationStats.totalOpenPnl.toFixed(2) }} USDT</div>
                <div class="divider"></div>
                <div>Starting Balance: {{ startingBalance.toFixed(2) }} USDT</div>
                <div>Estimated Margin Used: {{ estimatedMarginUsed.toFixed(2) }}</div>
                <div>Margin Balance: {{ (balance + simulationStats.totalOpenPnl).toFixed(2) }} USDT</div>
                <div>Balance: {{ balance.toFixed(2) }} USDT</div>
            </div>
            <div class="col-lg-9 col-md-9 simulation-snap-wrapper pa-md">
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
                                    <th>Open Notional</th>
                                    <th>Maintenance</th>
                                    <th>Margin Balance</th>
                                    <th>Balance</th>
                                </TableHeaderComponent>
                            </template>

                            <template #body>
                                <TableBodyComponent>
                                    <tr v-for="stat in [...simulationStatsSnap].reverse()" :key="stat.timestamp">
                                        <td>{{ new Date(stat.timestamp).toLocaleString() }}</td>
                                        <td>{{ stat.open }}</td>
                                        <td>{{ stat.won }}</td>
                                        <td>{{ stat.loss }}</td>
                                        <td>{{ stat.totalTakerFee.toFixed(2) }}</td>
                                        <td>{{ stat.totalClosedPnl.toFixed(2) }}</td>
                                        <td>{{ stat.totalOpenPnl.toFixed(2) }}</td>
                                        <td>{{ stat.totalOpenNotional.toFixed(2) }}</td>
                                        <td>{{ stat.totalMaintenance.toFixed(2) }} ({{ ((stat.totalMaintenance / stat.marginBalance) * 100).toFixed(2) }}%)</td>
                                        <td>{{ stat.marginBalance.toFixed(2) }}</td>
                                        <td>{{ stat.balance.toFixed(2) }}</td>
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
                                    <th>TP (+ {{ props.targetTpRoi * 100 }}%)</th>
                                    <th>SL (- {{ props.targetSlRoi * 100 }}%)</th>
                                    <th>Margin</th>
                                    <th>Leverage</th>
                                    <th>PNL</th>
                                    <th>Status</th>
                                    <th>Condition Met</th>
                                </TableHeaderComponent>
                            </template>

                            <template #body>
                                <TableBodyComponent>
                                    <tr v-for="position in positionEntries" :key="position.candleOpenTime + 'pos'">
                                        <td>{{ new Date(position.candleOpenTime).toLocaleString() }}</td>
                                        <td>{{ position.symbol }}</td>
                                        <td>{{ position.side }}</td>
                                        <td>{{ position.currentPrice }}</td>
                                        <td>{{ position.tpsl.tp }}</td>
                                        <td>{{ position.tpsl.sl }}</td>
                                        <td>{{ position.margin }}</td>
                                        <td>{{ position.leverage }}</td>
                                        <td>{{ position.pnl }}</td>
                                        <td>{{ position.result }}</td>
                                        <td>{{ position.currentCandleData.conditionMet }}</td>
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
import type { CandleEntry, TradeLog } from '@/core/interfaces';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import { klineDbUtility } from '@/utility/klineDbUtility';
import { computed, onMounted, ref } from 'vue';
import TableComponent from '../shared/table/TableComponent.vue';
import TableHeaderComponent from '../shared/table/TableHeaderComponent.vue';
import TableBodyComponent from '../shared/table/TableBodyComponent.vue';
import TabComponent from '../shared/tab/TabComponent.vue';
import TabListComponent from '../shared/tab/TabListComponent.vue';
import TabTriggerComponent from '../shared/tab/TabTriggerComponent.vue';
import TabContentComponent from '../shared/tab/TabContentComponent.vue';
import { SimulationUtility } from '@/utility/simulationUtility';
import ButtonComponent from '../shared/form/ButtonComponent.vue';
import type { StringMappingType } from 'typescript';
import { tradeLogger } from '@/utility/tradeSignalLoggerUtility';

import { candleAnalyzer } from '@/utility/candleAnalyzerUtility';
import { PnlUtility } from '@/utility/PnlUtility';
import InputComponent from '../shared/form/InputComponent.vue';
import { BinanceMarginUtility } from '@/utility/binanceMarginUtility';

const props = defineProps<{
    interval:string,
    maxCandles:number,
    supportAndResistanceLength:number,
    margin:number,
    startingBalance:number,
    positionDurationMedian:number,
    targetTpRoi:number,
    targetSlRoi:number,
    maxOpenPositions: number,
    targetGain: number
}>();

const chocoMintoStore = useChocoMintoStore();

const startingTimeStamp = ref(0)
const timestamps = ref<number[]>([]);
const currentTimestamp = ref(0)

const UI_SELECTED_TAB = ref('Account');
const UI_SIMULATION_MESSAGE = ref('');

const positionEntries = ref<TradeLog[]>([])

const openPositions = ref<CandleEntry[]>([]);
var simulationStats = ref<{
    won: number,
    loss: number,
    open: number,
    totalTakerFee: number,
    totalOpenPnl: number,
    totalOpenNotional: number,
    totalMaintenance: number,
    totalClosedPnl: number,
    walletBalance: number,
}>({won: 0, loss: 0, open: 0, totalTakerFee: 0, totalOpenPnl: 0, totalOpenNotional: 0, totalMaintenance:0, totalClosedPnl: 0, walletBalance: 0})

const simulationStatsSnap = ref<Array<{
  timestamp: number;
  won: number;
  loss: number;
  open: number;
  totalTakerFee: number;
  totalOpenPnl: number;
  totalOpenNotional: number;
  totalMaintenance: number;
  totalClosedPnl: number;
  marginBalance: number;
  balance: number;
}>>([])

var forceClosedPositions = ref<Array<{
    symbol: string,
    side: string,
    open_position_timestamp: number,
    open_position_closing_timestamp: number
}>>([])

const currentTimestampLocal = computed(() => {
  const ts = currentTimestamp.value;
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

const balance = computed(() => {
    return (props.startingBalance - (estimatedMarginUsed.value + simulationStats.value.totalTakerFee)) + simulationStats.value.totalClosedPnl
})

const estimatedMarginUsed = computed(() => {
    return (simulationStats.value.open) * props.margin;
})

const calculatedMaxOpenPosition = computed(() => {
    var marginBalance = (balance.value + (estimatedMarginUsed.value + simulationStats.value.totalOpenPnl))
    var openPositionsIncrement = marginBalance >= 200
    ? Math.floor((marginBalance - 200) / 100) + 1
    : 0;
    return props.maxOpenPositions + (10 * openPositionsIncrement)
})

onMounted(async () => {
  await getTimeStamps();

  //startReplayInterval();
});

async function prepareCandleEntryData(){
    for (let f = 0; f <= chocoMintoStore.futureSymbols.length - 1; f++) {
        UI_SIMULATION_MESSAGE.value = `preparing base candle entries: ${f + 1}/${chocoMintoStore.futureSymbols.length}`

        var futureSymbol = chocoMintoStore.futureSymbols[f];
        await SimulationUtility.initializePastCandleEntryData(
            futureSymbol.symbol,
            props.interval,
            props.maxCandles,
            props.supportAndResistanceLength);

        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

async function runForwardSimulation(){
    tradeLogger.clearAllLogs();

    const sortedTimestamps = [...timestamps.value].sort((a, b) => a - b);
    for (let i = props.supportAndResistanceLength - 1; i <= sortedTimestamps.length - 1; i++) {
        currentTimestamp.value = timestamps.value[i];
        
        //await forceTakePnl();

        await markAllEntries(i);

        //await replayTimeStamp(currentTimestamp.value);

        await getPositionEntries()

        await simulateOpenPositions();

        UI_SIMULATION_MESSAGE.value = "- - -"
    }
}

const candleMap = new Map<string, CandleEntry[]>();
async function markAllEntries(entryIndex: number) {
    const symbols = chocoMintoStore.futureSymbols;
    
    if (candleMap.size === 0) {
        UI_SIMULATION_MESSAGE.value = "loading candles into memory...";
        
        for (let i = 0; i < symbols.length; i++) {
            const candles = await klineDbUtility.getKlines(symbols[i].symbol);
            candleMap.set(symbols[i].symbol, candles);
        }
    }
    
    const chunkSize = 5;

    for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        
        await Promise.allSettled(
            chunk.map(async (futureSymbol, indexInChunk) => {
                const globalIndex = i + indexInChunk;
                UI_SIMULATION_MESSAGE.value = `marking entries: ${globalIndex + 1}/${symbols.length}`;
                
                const candles = candleMap.get(futureSymbol.symbol)!;
                
                if (candles.length < props.maxCandles - 2) return;
                
                await SimulationUtility.markPositionEntries(
                    props.margin,
                    props.positionDurationMedian,
                    props.targetTpRoi,
                    props.targetSlRoi,
                    futureSymbol.symbol,
                    candles,
                    futureSymbol.maxLeverage,
                    entryIndex,
                    startingTimeStamp.value
                );
                
                const lastCandle = candles[entryIndex];
                const hasOpenPos =
                    lastCandle.side !== "" &&
                    lastCandle.tpPrice > 0 &&
                    lastCandle.slPrice > 0 &&
                    lastCandle.status === "OPEN";
                
                if (hasOpenPos) {
                    //const openPositions = await tradeLogger.getOpenPositions();
                    //const openPosition = await tradeLogger.getOpenPosition(futureSymbol.symbol);

                    //if (!openPosition && openPositions.length <= calculatedMaxOpenPosition.value) {
                        tradeLogger.logSignal(
                            lastCandle.symbol,
                            lastCandle.side === "LONG" ? "BUY" : "SELL",
                            { lower: lastCandle.support!.lower, upper: lastCandle.support!.upper },
                            { lower: lastCandle.resistance!.lower, upper: lastCandle.resistance!.upper },
                            lastCandle.close,
                            { tp: lastCandle.tpPrice, sl: lastCandle.slPrice },
                            lastCandle.candleData!,
                            lastCandle.zoneAnalysis!,
                            props.margin,
                            futureSymbol!.maxLeverage,
                            PnlUtility.calculateTakerFee(props.margin, futureSymbol!.maxLeverage),
                            lastCandle.volumeAnalysis!,
                            currentTimestamp.value,
                            lastCandle.pastVolumeAnalysis!
                        );
                    //}
                }
            })
        );
    }
}


async function clearRunData() {
  const symbols = chocoMintoStore.futureSymbols;
  const chunkSize = 100;

  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);

    await Promise.allSettled(
      chunk.map(async (futureSymbol, indexInChunk) => {
        const globalIndex = i + indexInChunk;
        
        try {
          const candles = candleMap.get(futureSymbol.symbol)!;

          // Clear all candles
          for (let c = 0; c < candles.length; c++) {
            candles[c].tpPrice = 0;
            candles[c].slPrice = 0;
            candles[c].side = "";
            candles[c].margin = 0;
            candles[c].leverage = 0;
            candles[c].status = "";
          }

          //await klineDbUtility.initializeKlineData(futureSymbol.symbol, candles);
          candleMap.set(symbols[i].symbol, candles);
          
          // Update UI after each symbol completes
          UI_SIMULATION_MESSAGE.value = `Clearing ${globalIndex + 1}/${symbols.length}`;
        } catch (error) {
          console.error(`Failed to clear ${futureSymbol.symbol}:`, error);
        }
      })
    );
  }

  UI_SIMULATION_MESSAGE.value = "";
}

async function simulateOpenPositions(){
    var openPositions = await tradeLogger.getOpenPositions();

    for (let i = 0; i <= openPositions.length - 1; i++) {
        var openPosition = openPositions[i];

        var candles = await klineDbUtility.getCandleByTimestamp(currentTimestamp.value,openPosition.symbol);
        var candle = candles[0];

        var _estimatedPnlPercentage = 0;
        var _estimatedPnl = 0;
        if(candle.openTime > openPosition.candleOpenTime){
            openPosition.duration = (candle.closeTime - openPosition.candleOpenTime) / (1000 * 60)

            if(openPosition && openPosition.side == "BUY"){

                if(candle.low < openPosition.tpsl.sl){
                    openPosition.result = "LOSS"
                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,openPosition.tpsl.sl, "BUY", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
                    await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)

                    await tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.sl,"LOSS")

                }else if(candle.high > openPosition.tpsl.tp){
                    openPosition.result = "WON"
                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,openPosition.tpsl.tp, "BUY", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
                    await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)

                    await tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.tp,"WON")
                }else{
                    candle.status = "OPEN"

                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,candle.close, "BUY", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
                    await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)
                }

            }else if(openPosition && openPosition.side == "SELL"){

                if(candle.high > openPosition.tpsl.sl){
                    openPosition.result = "LOSS"
                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,openPosition.tpsl.sl, "SELL", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
                    await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)

                    await tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.tp,"LOSS")
                    
                }else if (candle.low < openPosition.tpsl.tp){
                    openPosition.result = "WON"
                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,openPosition.tpsl.tp, "SELL", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
                    await tradeLogger.updatePnl(openPosition.id!, _estimatedPnl)

                    await tradeLogger.closePosition(openPosition.id!,openPosition.tpsl.tp,"WON")
                }else{
                    candle.status = "OPEN"

                    _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.currentPrice,candle.close, "SELL", openPosition.leverage);
                    _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, openPosition.leverage);
                    
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
}

var startingMargin = props.startingBalance;
async function getPositionEntries(){
    positionEntries.value = await tradeLogger.getAllLogs();

    var openPositions = positionEntries.value.filter(p => p.isOpen);
    var wonPositions = positionEntries.value.filter(p => p.result == "WON")
    var lossPositions = positionEntries.value.filter(p => p.result == "LOSS")

    var totalWonPnl = wonPositions.reduce((sum, s) => sum + s.pnl!, 0)
    var totalLossPnl = lossPositions.reduce((sum, s) => sum + s.pnl!, 0)

    simulationStats.value.won = wonPositions.length;
    simulationStats.value.loss = lossPositions.length;
    simulationStats.value.open = openPositions.length;

    simulationStats.value.totalOpenNotional = openPositions.reduce((sum, s) => sum + (s.leverage * s.margin), 0);
    simulationStats.value.totalMaintenance = openPositions.reduce((sum, s) => {
        const notional = s.leverage * s.margin;
        const maintenance = BinanceMarginUtility.calculateMaintenanceMargin(s.symbol, notional);
        return sum + maintenance;
    }, 0);

    simulationStats.value.totalTakerFee = positionEntries.value.reduce((sum, s) => sum + s.takerFee, 0);

    simulationStats.value.totalOpenPnl = openPositions.reduce((sum, s) => sum + s.pnl!, 0);

    simulationStats.value.totalClosedPnl = totalWonPnl + totalLossPnl;

    snapSimulationStat(currentTimestamp.value)

    // var targetMargin = startingMargin + props.targetGain;
    // var marginBalance = (balance.value + (estimatedMarginUsed.value + simulationStats.value.totalOpenPnl));
    // if(marginBalance >= targetMargin){
    //     await tradeLogger.forceCloseOpenPositions();
    //     startingMargin = marginBalance;
    //     startingTimeStamp.value = currentTimestamp.value;
    //     await clearRunData();
    // }
}

async function startReplayInterval() {
    for (let i = 148; i < timestamps.value.length; i++) {
        currentTimestamp.value = timestamps.value[i];
        await replayTimeStamp(currentTimestamp.value);
    }
}


async function replayTimeStamp(_timeStamp:number){
    const concurrency = 30;
    const symbols = chocoMintoStore.futureSymbols;
    const candleEntries: CandleEntry[] = [];

    for (let i = 0; i < symbols.length; i += concurrency) {
        const batch = symbols.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
            batch.map(f =>
                klineDbUtility.getCandleByTimestamp(_timeStamp, f.symbol)
            )
        );

        for (const r of batchResults) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                candleEntries.push(...r.value);
            }
        }
    }
    
    simulationStats.value.totalOpenPnl = 0;
    for (let i = 0; i <= candleEntries.length - 1; i++) {
        var candle = candleEntries[i];
        var hasSupportAndResistance = candle.support && candle.resistance;
        if(hasSupportAndResistance){
            // var hasOpenedPosition = candle.side != "" && candle.tpPrice > 0 && candle.slPrice > 0;
            // if(hasOpenedPosition){
            //     openPositions.value.push(candle);
            //     simulationStats.value.totalTakerFee += candle.entryFee;
            // }

            if(candle.status.includes("_")){
                if(candle.status.includes("_WON")){
                    simulationStats.value.won++
                }else if(candle.status.includes("_LOSS")){
                    simulationStats.value.loss++
                }

                simulationStats.value.totalClosedPnl += candle!.pnl;
                simulationStats.value.totalTakerFee += candle!.entryFee;

                openPositions.value = openPositions.value.filter(p => p.symbol != candle.symbol);
            }else if(candle.status == "OPEN"){
                
                simulationStats.value.totalOpenPnl += candle.pnl;
            }
        }
    }

    snapSimulationStat(_timeStamp);
}

function snapSimulationStat(_timestamp:number) {
  simulationStatsSnap.value.push({
    timestamp: _timestamp,
    won: simulationStats.value.won,
    loss: simulationStats.value.loss,
    open: simulationStats.value.open,
    totalTakerFee: simulationStats.value.totalTakerFee,
    totalOpenPnl: simulationStats.value.totalOpenPnl,
    totalOpenNotional: simulationStats.value.totalOpenNotional,
    totalMaintenance: simulationStats.value.totalMaintenance,
    totalClosedPnl: simulationStats.value.totalClosedPnl,
    marginBalance: (balance.value + (estimatedMarginUsed.value + simulationStats.value.totalOpenPnl)),
    balance: balance.value
  });
}

async function getTimeStamps() {
  timestamps.value = await klineDbUtility.getFirstTimestamps();
}
</script>

<style scoped>
.timestamps-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px; /* spacing between boxes */
}

.timestamp-box {
  background-color: #ccc;
  padding: 2px 2px;
  border-radius: 2px;
  font-size: 0.75rem;
  white-space: nowrap;
  flex: 1 1 auto; /* grow/shrink smartly */
  text-align: center;
  min-width: 10px; /* minimum size */
  max-width: 40px; /* prevent too wide boxes */
}

.timestamp-box.passed {
  background-color: #4ea855; /* light green */
}

.simulation-snap-wrapper{
    max-height: 77vh;
    overflow-y: auto;
}
</style>
