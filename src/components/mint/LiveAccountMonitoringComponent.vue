<template>
    <div class="row">
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Balance</div>
                <div v-if="showBalanceInfo">{{ balanceResult?.balance }}</div>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div v-if="showBalanceInfo">Unrealized PNL</div>
                <div>{{ balanceResult?.unrealized_pnl }}</div>
                <div class="divider"></div>
                <button @click="calculateBalance">get balance</button>
                <button @click="calcEstTotalTradingAndExitFees">calc est entry and exit fee</button>
                <div>Open Positions</div>
                <div>{{ openPositions }}</div>
                <div>Entry Fees</div>
                <div>{{ totalEntryFees }}</div>
                <div>Exit Fees</div>
                <div>{{ totalExitFees }}</div>
                <div>Target PNL</div>
                <div>{{ ((margin * 5) + (totalEntryFees + totalExitFees)) + totalLiqBuff }}</div>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Margin</div>
                <div v-if="balanceResult && showBalanceInfo">{{ balanceResult.balance + balanceResult.unrealized_pnl }}</div>
            </CardComponent>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import CardComponent from '../shared/card/CardComponent.vue';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import { type BalanceResponse, type Position } from '@/core/interfaces';
import { RefSymbol } from '@vue/reactivity';

const props = defineProps<{
  margin: number
}>()

const showBalanceInfo = ref(false);
const balanceResult = ref<BalanceResponse>()

const totalEntryFees = ref(0)
const totalExitFees = ref(0)
const totalLiqBuff = ref(0)
const openPositions = ref(0)

onMounted(() => {
    //startBalanceChecker();
})

async function startBalanceChecker(){
    var balanceInterval = setInterval(async () => {
        balanceResult.value = await OrderMakerUtility.getBalance();
    }, 60000);
}

async function calculateBalance(){
    balanceResult.value = await OrderMakerUtility.getBalance();
    showBalanceInfo.value = true;
    setInterval(() => {
        showBalanceInfo.value = false;
    }, 5000);
}

async function calcEstTotalTradingAndExitFees(){
    const positions = await OrderMakerUtility.getPositions();
    const fees = OrderMakerUtility.calculateTotalTradingFees(positions);
    openPositions.value = positions.length
    totalEntryFees.value = fees.entryFees
    totalExitFees.value = fees.exitFees
    totalLiqBuff.value = fees.liquidityBuffer
}


</script>