<template>
    <div class="row">
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Balance</div>
                <div v-if="showBalanceInfo">{{ balanceResult?.balance }}</div>
                <div>Transfer Earnings</div>
                <div>
                    <div>{{ transferCountdown }}</div>
                </div>
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
const transferCountdown = ref<string>('');

const totalEntryFees = ref(0)
const totalExitFees = ref(0)
const totalLiqBuff = ref(0)
const openPositions = ref(0)

//need another function call startEarningTransfer
//its an interval that runs once a day at 11:30PM
//make sure it only run once in a day

onMounted(() => {
    startEarningTransfer();
    updateTransferCountdown();
    setInterval(updateTransferCountdown, 1000);
})

async function startEarningTransfer() {
    // Check if transfer already ran today
    const lastTransferDate = localStorage.getItem('lastEarningTransferDate');
    const today = new Date().toDateString();
    
    if (lastTransferDate === today) {
        console.log('Earning transfer already ran today');
        return;
    }

    // Calculate time until 11:30 PM
    const now = new Date();
    const target = new Date();
    target.setHours(23, 30, 0, 0);

    // If it's already past 11:30 PM, schedule for tomorrow
    if (now > target) {
        target.setDate(target.getDate() + 1);
    }

    const timeUntilTransfer = target.getTime() - now.getTime();
    
    console.log(`Next earning transfer scheduled in ${Math.floor(timeUntilTransfer / 1000 / 60)} minutes`);

    // Set timeout for the scheduled time
    setTimeout(async () => {
        try {
            console.log('Starting earning transfer...');

            await OrderMakerUtility.closeAllOpenPositions();

            await OrderMakerUtility.transferEarnings(100);
            
        } catch (error) {
            console.error('Error during earning transfer:', error);
        }
    }, timeUntilTransfer);
}

function updateTransferCountdown() {
    const lastTransferDate = localStorage.getItem('lastEarningTransferDate');
    const today = new Date().toDateString();
    
    if (lastTransferDate === today) {
        transferCountdown.value = 'Transfer completed today';
        return;
    }

    const now = new Date();
    const target = new Date();
    target.setHours(23, 30, 0, 0);

    if (now > target) {
        target.setDate(target.getDate() + 1);
    }

    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    transferCountdown.value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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