<template>
    <div class="row">
        <div class="col-lg-4 col-md-4 px-sm">
            <CardComponent class="text-center">
                <h3>WON</h3>
                <h4>{{ simulationStats.won }}</h4>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4 px-sm">
            <CardComponent class="text-center">
                <h3>LOSS</h3>
                <h4>{{ simulationStats.loss }}</h4>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4 px-sm">
            <CardComponent class="text-center">
                <h3>OPEN</h3>
                <h4>{{ simulationStats.open }}</h4>
            </CardComponent>
        </div>
    </div>

    <div class="row mt-md">
        <div class="col-lg-3 col-md-3 px-sm">
            <CardComponent class="text-center">
                <h3>Total Taker Fee</h3>
                <h4>{{ simulationStats.totalTakerFee.toFixed(2) }}</h4>
            </CardComponent>
        </div>
        <div class="col-lg-3 col-md-3 px-sm">
            <CardComponent class="text-center">
                <h3>Total Open PNL</h3>
                <h4>{{ simulationStats.totalOpenPnl.toFixed(2) }}</h4>
            </CardComponent>
        </div>
        <div class="col-lg-3 col-md-3 px-sm">
            <CardComponent class="text-center">
                <h3>Total Closed PNL</h3>
                <h4>{{ simulationStats.totalClosedPnl.toFixed(2) }}</h4>
            </CardComponent>
        </div>
        <div class="col-lg-3 col-md-3 px-sm">
            <CardComponent class="text-center">
                <h3>Estimated Margin Balance</h3>
                <h4>{{ estimatedMarginBalance.toFixed(2) }}</h4>
                <div class="divider"></div>
                <h3>Estimated Balance</h3>
                <h4>{{ estimatedBalance.toFixed(2) }}</h4>
            </CardComponent>
        </div>
    </div>
    <div class="row mt-sm">
        <div class="col-lg-4 col-md-4 px-sm">
            <TradeSimulationHistoryComponent />
        </div>
        <div class="col-lg-4 col-md-4 px-sm text-center">
            <span v-if="UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE">
                {{ UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE }}
            </span>
            <ButtonComponent @click="getCurrentOpenSimulationPnl" color="ghost" rounded>calculate</ButtonComponent>
        </div>
        <div class="col-lg-4 col-md-4 px-sm"></div>
    </div>
</template>

<script setup lang="ts">
import { type TradeLog } from '@/core/interfaces';
import { tradeLogger } from '@/utility/tradeSignalLoggerUtility';
import { onMounted, ref } from 'vue';
import CardComponent from '../shared/card/CardComponent.vue';
import { KlineUtility } from '@/utility/klineUtility';
import { PnlUtility } from '@/utility/PnlUtility';
import TradeSimulationHistoryComponent from './TradeSimulationHistoryComponent.vue';
import ButtonComponent from '../shared/form/ButtonComponent.vue';

const props = defineProps<{
    margin: number,
    startingBalance:number
}>();

var simulatedPositions = ref<TradeLog[]>([]);
var UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE = ref("")

var estimatedMarginBalance = ref(0);
var estimatedBalance = ref(0);

var simulationStats = ref<{
    won: number,
    loss: number,
    open: number,
    totalTakerFee: number,
    totalOpenPnl: number,
    totalClosedPnl: number
}>({won: 0, loss: 0, open: 0, totalTakerFee: 0, totalOpenPnl: 0, totalClosedPnl: 0})

onMounted(async () => {
    var isProcessing = false
    setInterval(async () => {
        if(!isProcessing){
            isProcessing = true;
            await getSimulatedPositions()
            isProcessing = false;
        }
    }, 10000);
})


async function getSimulatedPositions(){
    simulatedPositions.value = await tradeLogger.getAllLogs();

    var wonPositions = simulatedPositions.value.filter(s => !s.isOpen && s.result == "WON");
    var lossPositions = simulatedPositions.value.filter(s => !s.isOpen && s.result == "LOSS")
    var openPositions = simulatedPositions.value.filter(s => s.isOpen && s.result == "")

    simulationStats.value.won = wonPositions.length;
    simulationStats.value.loss = lossPositions.length;
    simulationStats.value.open = openPositions.length;

    var totalWonPnl = wonPositions.reduce((sum, s) => sum + s.pnl!, 0);
    var totalLossPnl = lossPositions.reduce((sum, s) => sum + s.pnl! , 0);
    var totalOpenPnl = openPositions.reduce((sum, s) => sum + s.pnl! , 0);

    simulationStats.value.totalTakerFee = simulatedPositions.value.reduce((sum, s) => sum + s.takerFee, 0);

    simulationStats.value.totalOpenPnl = totalOpenPnl
    

    simulationStats.value.totalClosedPnl = totalWonPnl + totalLossPnl

    var estimatedMarginUsed = simulationStats.value.open * props.margin;
    estimatedBalance.value = (props.startingBalance - (simulationStats.value.totalTakerFee + estimatedMarginUsed)) + simulationStats.value.totalClosedPnl;
    estimatedMarginBalance.value = estimatedBalance.value + simulationStats.value.totalOpenPnl + estimatedMarginUsed;
}

async function getCurrentOpenSimulationPnl(){
    var openPositions = simulatedPositions.value.filter(p => p.isOpen);

    
    for (let i = 0; i <= openPositions.length - 1; i++) {
        var position = openPositions[i];

        UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE.value = `[${i}/${openPositions.length}]: ${position.symbol}`;

        var currentCandle = await KlineUtility.getRecentKlines(position.symbol,"15m",1);
        if(currentCandle.length == 1){
            var _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(position.currentPrice,currentCandle[0].close, position.side.toUpperCase(), position.leverage);
            var _estimatedPnl = PnlUtility.calculateEstimatedPnl(position.margin,_estimatedPnlPercentage, position.leverage);

            await tradeLogger.schedulePnlUpdate(position.id!, _estimatedPnl)

            if(_estimatedPnlPercentage > position.pnlPercentage.highest){
                position.pnlPercentage.highest = _estimatedPnlPercentage;
                await tradeLogger.scheduleHighestUpdate(position.id!,_estimatedPnlPercentage);
            }

            if(_estimatedPnlPercentage < position.pnlPercentage.lowest){
                position.pnlPercentage.lowest = _estimatedPnlPercentage
                await tradeLogger.scheduleLowestUpdate(position.id!,_estimatedPnlPercentage);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE.value = "updating simulated positions. . .";

    await getSimulatedPositions()

    UI_STATE_CURRENT_OPEN_POSITION_PNL_MESSAGE.value = "";
}
</script>