<template>
    <div class="row">
        <div class="col-lg-4 col-md-4">
            <CardComponent class="text-center">
                <div>Balance</div>
                <div v-if="showBalanceInfo">{{ balanceResult?.balance }}</div>
                <div>Transfer Earnings</div>
                <div>
                    <div>{{ transferCountdown }}</div>
                    <div>{{ transferMessage }}</div>
                </div>
                <div style="margin-top: 10px; font-size: 12px;">
                    <label>Next Run Time:</label>
                    <input 
                        v-model="nextRunTimeInput" 
                        type="text" 
                        placeholder="MM/dd/yyyy hh:mm AM/PM"
                        @change="updateNextRunTime"
                        style="width: 100%; padding: 5px; margin-top: 5px;"
                    />
                    <label>Checkpoint Time:</label>
                    <div>{{ chocoMintoStore.checkpointTime.toLocaleString() }}</div>
                    <div v-if="nextRunTimeError" style="color: red; font-size: 11px;">{{ nextRunTimeError }}</div>
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
import { useChocoMintoStore } from '@/stores/chocoMintoStore';

const props = defineProps<{
  margin: number
}>()

const chocoMintoStore = useChocoMintoStore();

const showBalanceInfo = ref(false);
const balanceResult = ref<BalanceResponse>()
const transferCountdown = ref<string>('');
const transferMessage = ref("- - -")
const nextRunTimeInput = ref<string>('');
const nextRunTimeError = ref<string>('');

const totalEntryFees = ref(0)
const totalExitFees = ref(0)
const totalLiqBuff = ref(0)
const openPositions = ref(0)

let nextRunTime: Date | null = null;
let transferTimeout: NodeJS.Timeout | null = null;

onMounted(() => {
    // Load saved next run time from localStorage
    const savedNextRunTime = localStorage.getItem('nextEarningTransferTime');
    const checkPointTimeLocal = localStorage.getItem("checkPointTime");


    if (savedNextRunTime) {
        nextRunTime = new Date(savedNextRunTime);
        nextRunTimeInput.value = formatDateForInput(nextRunTime);
    } else {
        // Set default to tomorrow at 11:25 PM
        nextRunTime = new Date();
        nextRunTime.setDate(nextRunTime.getDate() + 1);
        nextRunTime.setHours(23, 25, 0, 0);
        nextRunTimeInput.value = formatDateForInput(nextRunTime);
        localStorage.setItem('nextEarningTransferTime', nextRunTime.toISOString());
    }

    chocoMintoStore.checkpointTime = new Date(`${checkPointTimeLocal}`);
    chocoMintoStore.startingTimeStamp = chocoMintoStore.checkpointTime.getTime();

    startEarningTransfer();
    updateTransferCountdown();
    setInterval(updateTransferCountdown, 1000);
})

function formatDateForInput(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');
    
    return `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
}

function parseInputDate(input: string): Date | null {
    // MM/dd/yyyy hh:mm AM/PM
    const regex = /^(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}):(\d{2})\s(AM|PM)$/i;
    const match = input.match(regex);
    
    if (!match) {
        return null;
    }

    let month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const year = parseInt(match[3]);
    let hours = parseInt(match[4]);
    const minutes = parseInt(match[5]);
    const ampm = match[6].toUpperCase();

    // Convert to 24-hour format
    if (ampm === 'PM' && hours !== 12) {
        hours += 12;
    } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
    }

    // Validate month
    if (month < 1 || month > 12) {
        return null;
    }

    const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
    
    // Validate day
    if (date.getMonth() !== month - 1) {
        return null;
    }

    return date;
}

function updateNextRunTime() {
    const parsed = parseInputDate(nextRunTimeInput.value);
    
    if (!parsed) {
        nextRunTimeError.value = 'Invalid format. Use MM/dd/yyyy hh:mm AM/PM';
        return;
    }

    const now = new Date();
    if (parsed <= now) {
        nextRunTimeError.value = 'Time must be in the future';
        return;
    }

    nextRunTimeError.value = '';
    nextRunTime = parsed;
    localStorage.setItem('nextEarningTransferTime', nextRunTime.toISOString());
    
    // Restart the transfer scheduler
    if (transferTimeout) {
        clearTimeout(transferTimeout);
    }
    startEarningTransfer();
    
    console.log(`Next transfer scheduled for: ${nextRunTime.toLocaleString()}`);
}

async function startEarningTransfer() {
    if (!nextRunTime) return;

    const now = new Date();
    const timeUntilTransfer = nextRunTime.getTime() - now.getTime();
    
    if (timeUntilTransfer <= 0) {
        console.log('Next run time is in the past');
        return;
    }

    console.log(`Next earning transfer scheduled in ${Math.floor(timeUntilTransfer / 1000 / 60)} minutes`);

    // Set timeout for the scheduled time
    transferTimeout = setTimeout(async () => {
        try {
            const baseBalance = 200;

            balanceResult.value = await OrderMakerUtility.getBalance();
            const margin = balanceResult.value.balance + balanceResult.value.unrealized_pnl;

            chocoMintoStore.checkpointTime = new Date();
            chocoMintoStore.startingTimeStamp = chocoMintoStore.checkpointTime.getTime();
            localStorage.setItem("checkPointTime",chocoMintoStore.checkpointTime.toLocaleString());

            await OrderMakerUtility.closeAllOpenPositions();
            
            if (margin > baseBalance) {
                await OrderMakerUtility.transferEarnings(baseBalance);
                transferMessage.value = "last transfer: " + (new Date()).toLocaleString();
            } else {
                transferMessage.value = `last transfer (none) balance (${margin}): ` + (new Date()).toLocaleString();
            }

            // Schedule next transfer 2 days from now
            if (nextRunTime) {
                nextRunTime.setDate(nextRunTime.getDate() + 2);
                nextRunTimeInput.value = formatDateForInput(nextRunTime);
                localStorage.setItem('nextEarningTransferTime', nextRunTime.toISOString());
                startEarningTransfer();
            }

        } catch (error) {
            transferMessage.value = `Last transfer error (${(new Date()).toLocaleString()}): ${error instanceof Error ? error.message : String(error)}`;
            console.error('Error during earning transfer:', error);
        }
    }, timeUntilTransfer);
}

function updateTransferCountdown() {
    if (!nextRunTime) {
        transferCountdown.value = 'No transfer scheduled';
        return;
    }

    const now = new Date();
    const diff = nextRunTime.getTime() - now.getTime();

    if (diff <= 0) {
        transferCountdown.value = 'Transfer pending...';
        return;
    }

    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    transferCountdown.value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function startBalanceChecker(){
    setInterval(async () => {
        balanceResult.value = await OrderMakerUtility.getBalance();
    }, 60000);
}

async function calculateBalance(){
    balanceResult.value = await OrderMakerUtility.getBalance();
    showBalanceInfo.value = true;
    setTimeout(() => {
        showBalanceInfo.value = false;
    }, 5000);
}

async function calcEstTotalTradingAndExitFees(){
    const positions = await OrderMakerUtility.getPositions();
    const fees = OrderMakerUtility.calculateTotalTradingFees(positions);
    openPositions.value = positions.length;
    totalEntryFees.value = fees.entryFees;
    totalExitFees.value = fees.exitFees;
    totalLiqBuff.value = fees.liquidityBuffer;
}
</script>