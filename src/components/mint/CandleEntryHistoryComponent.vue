<template>
    <div class="entry-history-wrapper">
        <div>Won: {{ candleEntries.filter(b => b.status.includes('_WON')).length }}</div>
        <div>Loss: {{ candleEntries.filter(b => b.status.includes('_LOSS')).length }}</div>
        
        <div class="divider"></div>

        <!-- <div class="text-right">
            <ButtonComponent :color="'primary'" rounded @click="openOrder('BUY')">BUY</ButtonComponent>
            <ButtonComponent :color="'danger'" rounded  @click="openOrder('SELL')">SELL</ButtonComponent>
        </div> -->

        <CandleEntryVisualizerComponent :symbol="symbol" :candles="candleEntries" />

        <TableComponent border-type="rows" :alternate-row-color="true" v-if="false">
            <template #header>
                <TableHeaderComponent>
                    <th>Time</th>
                    <!--<th>Timestamp</th>-->
                    <th>Open</th>
                    <!--<th>High</th>
                    <th>Low</th>-->
                    <th>Close</th> 
                    <!--<th>Side</th>-->
                    <th>TP</th>
                    <th>SL</th>
                    <th>Duration</th>
                    <th>Candle</th>
                    <th>Status</th>
                    <th>Trend</th>
                    <td>Trend Rate</td>
                    <th>Z-Upper</th>
                    <th>Z-Mid</th>
                    <th>Z-Lower</th>
                    <!-- <th>Zone Inhabitants</th>
                    <th>Breakout</th> -->
                    <!-- <th>Rest Brk Count</th>
                    <th>Supp Brk Count</th> -->
                    <th>Volume</th>
                    <th>Volume Spike</th>
                    <th>Dominant Side</th>
                    <th>ATR</th>
                    <th>EMA 9</th>
                    <th>Breakout</th>
                    <th>Zone Momentum</th>
                </TableHeaderComponent>
            </template>

            <template #body>
                <TableBodyComponent>
                    <tr v-for="c in reversedCandleEntries" :key="c.openTime" @click="selectRow(c.openTime)" :class="{ selected: selected === c.openTime }">
                        <td>{{ new Date(c.openTime).toLocaleString() }}</td>
                        <!-- <td>{{ c.openTime }}</td>-->
                        <td>{{ c.open }}</td>
                        <!--<td>{{ c.high }}</td>
                        <td>{{ c.low }}</td>-->
                        <td>{{ c.close }}</td> 
                        <td>{{ c.candleData?.side }}</td>
                        <!-- <td>{{ c.side }}</td>-->
                        <td>{{ c.tpPrice }}</td>
                        <td>{{ c.slPrice }}</td>
                        <td>{{ c.duration.toFixed(2) }}</td>
                        <td>{{ c.status }}</td>
                        <td>{{ c.candleData?.lookbackTrend}}</td>
                        <td>{{ c.candleData?.lookbackChangePercentage.toFixed(2) }} %</td>
                        <td>{{ c.priceZone?.upper }}</td>
                        <td>{{ c.priceZone?.mid }}</td>
                        <td>{{ c.priceZone?.lower }}</td>
                        <!-- <td>{{ c.candleData?.zoneInhabitantCount }}</td>
                        <td>{{ c.priceZoneInteraction?.breakoutType }}</td> -->
                        <!-- <td>{{ c.zoneAnalysis?.pastResistanceBreakCount }}</td>
                        <td>{{ c.zoneAnalysis?.pastSupportBreakCount }}</td> -->
                        <!-- <td>
                            <div>{{ c.support?.upper }}</div>
                            <div>{{ c.support?.lower }}</div>
                        </td>
                        <td>
                            <div>{{ c.resistance?.upper }}</div>
                            <div>{{ c.resistance?.lower }}</div>
                        </td> -->
                        <td>{{ c.candleData?.volume }}</td>
                        <td><span v-if="c.candleData?.volumeSpike">{{ c.candleData?.volumeSpike }}</span></td>
                        <td>{{ c.pastVolumeAnalysis?.dominantDirection }}</td>
                        <td>{{ c.candleData?.atr }}</td>
                        <td>{{ c.candleData?.ema200 }}</td>
                        <td>{{ c.priceZoneInteraction?.breakoutType }}</td>
                        <td>{{ c.zoneAnalysis?.momentum }}</td>
                    </tr>
                </TableBodyComponent>
            </template>
        </TableComponent>
    </div>
</template>

<script setup lang=ts>
import type { CandleEntry } from '@/core/interfaces';
import { computed, ref } from 'vue';
import TableComponent from '../shared/table/TableComponent.vue';
import TableHeaderComponent from '../shared/table/TableHeaderComponent.vue';
import TableBodyComponent from '../shared/table/TableBodyComponent.vue';
import CandleEntryVisualizerComponent from './CandleEntryVisualizerComponent.vue';
import ButtonComponent from '../shared/form/ButtonComponent.vue';
import { useNotificationStore } from '@/stores/notificationStore.ts';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility.ts';
import { useChocoMintoStore } from '@/stores/chocoMintoStore.ts';

const props = defineProps<{
  candleEntries: CandleEntry[],
  symbol?: string
}>()

const selected = ref<number|null>(null)
const reversedCandleEntries = computed(() => [...props.candleEntries].reverse())

function calcPastStrengthMean(strength1:number,strength2:number,strength3:number){
    var result = (strength1 + strength2 + strength3) / 3
    return result;
}

function selectRow(t:number){
  selected.value = t
}

function openOrder(side:string){
    useNotificationStore().showNotification("success","top-right","Order", side + " Order Created");
    OrderMakerUtility.openOrder(props.symbol!,useChocoMintoStore().orderCost,side,0,0);
}
</script>

<style scoped>
.entry-history-wrapper{
    max-height: 90vh;
    overflow-y: auto;
}

.selected {
  background: #d0d0d0 !important;
}

tr:hover {
    background: #f0f0f0 !important;
    cursor: pointer;
}
</style>