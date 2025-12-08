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
import { type BalanceResponse } from '@/core/interfaces';

const balanceResult = ref<BalanceResponse>()

onMounted(() => {
    startBalanceChecker();
})

async function startBalanceChecker(){
    var balanceInterval = setInterval(async () => {
        balanceResult.value = await OrderMakerUtility.getBalance();
    }, 5000);
}
</script>