<template>
    <div class="row">
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Balance</div>
                <div>{{ balanceResult?.balance }}</div>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Unrealized PNL</div>
                <div>{{ balanceResult?.unrealized_pnl }}</div>
                <div class="divider"></div>
                <button @click="calcEstTotalTradingAndExitFees">calc est entry and exit fee</button>
                <div>Open Positions</div>
                <div>{{ openPositions }}</div>
                <div>Entry Fees</div>
                <div>{{ totalEntryFees }}</div>
                <div>Exit Fees</div>
                <div>{{ totalExitFees }}</div>
                <div>Liquidity Buffer</div>
                <div>{{ liquidityBuffer }}</div>
                <div>Total Notional</div>
                <div>{{ totalNotional }}</div>
                <div>Target PNL</div>
                <div>{{ 5 + (totalEntryFees + totalExitFees + liquidityBuffer) }}</div>
            </CardComponent>
        </div>
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Margin</div>
                <div v-if="balanceResult">{{ balanceResult.balance + balanceResult.unrealized_pnl }}</div>
            </CardComponent>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import CardComponent from '../shared/card/CardComponent.vue';
import { OrderMakerUtility } from '@/utility/OrderMakerUtility';
import { type BalanceResponse, type Position } from '@/core/interfaces';

const balanceResult = ref<BalanceResponse>()

const totalEntryFees = ref(0)
const totalExitFees = ref(0)
const liquidityBuffer = ref(0)
const openPositions = ref(0)
const totalNotional = ref(0)

onMounted(() => {
    startBalanceChecker();
})

async function startBalanceChecker(){
    var balanceInterval = setInterval(async () => {
        balanceResult.value = await OrderMakerUtility.getBalance();
    }, 5000);
}

async function calcEstTotalTradingAndExitFees(){
    const positions = await OrderMakerUtility.getPositions();
    const fees = OrderMakerUtility.calculateTotalTradingFees(positions);
    openPositions.value = positions.length
    totalEntryFees.value = fees.entryFees
    totalExitFees.value = fees.exitFees
    totalNotional.value = fees.totalNotional
    liquidityBuffer.value = fees.liquidityBuffer
}


</script>