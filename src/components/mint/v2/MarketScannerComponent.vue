<template>
    <CardComponent class="market-scanner pa-sm mr-sm">
        <CardBodyComponent class="market-scanner-body">

            <!-- Progress -->
            <div v-if="progressCounter > 0" class="scanner-progress">
                <div class="scanner-progress-header">
                    <span>Market Scan</span>
                    <span>{{ progressCounter }}/{{ futureSymbols.length }}</span>
                </div>

                <ProgressBarComponent
                    :max="futureSymbols.length"
                    :value="progressCounter"
                />
            </div>

            <!-- Symbols -->
            <div class="scanner-list">
                <div
                    v-for="futureSymbol in futureSymbols"
                    :key="futureSymbol.symbol"
                    class="scanner-row"
                    :class="{
                        'scanner-row-visited': visitedSymbols.has(futureSymbol.symbol),
                        'scanner-row-processing': futureSymbol.status === 'processing',
                        'scanner-row-hit': futureSymbol.conditionMet
                    }"
                    @click="showEntryHistoryModal(futureSymbol)"
                >
                    <!-- Symbol -->
                    <div class="scanner-symbol">
                        <span class="scanner-status-dot"></span>
                        <span class="symbol-name">
                            {{ futureSymbol.symbol }}
                        </span>
                    </div>

                    <!-- Condition -->
                    <div class="scanner-condition">
                        <span
                            v-if="futureSymbol.conditionMet"
                            class="condition-badge"
                        >
                            {{ futureSymbol.conditionMet }}
                        </span>
                    </div>

                    <!-- Status -->
                    <div class="scanner-status">
                        {{ futureSymbol.status }}
                    </div>
                </div>

                <div
                    v-if="futureSymbols.length === 0"
                    class="scanner-empty"
                >
                    No symbols
                </div>
            </div>

        </CardBodyComponent>
    </CardComponent>

    <DialogComponent v-model="showEntryHistory" :width="'95vw'">
        <DialogHeaderComponent>
            {{ selectedSymbol }}
        </DialogHeaderComponent>
    </DialogComponent>
</template>

<script setup lang="ts">
import CardBodyComponent from '@/components/shared/card/CardBodyComponent.vue';
import CardComponent from '@/components/shared/card/CardComponent.vue';
import type { Candle, FuturesSymbol } from '@/core/interfaces';
import { ref } from 'vue';
import { useChocoMintoStore } from '@/stores/chocoMintoStore';
import ProgressBarComponent from '@/components/shared/ProgressBarComponent.vue';
import DialogComponent from '@/components/shared/dialog/DialogComponent.vue';
import DialogHeaderComponent from '@/components/shared/dialog/DialogHeaderComponent.vue';
import type { CandleInfo, SymbolInfo } from '@/core/interfacesv2';
import { KlineUtility } from '@/utility/klineUtility';
import { klineDbUtilityV2 } from '@/utility/v2/klineDbUtilityV2';
import { CandleAnalyzerV2 } from '@/utility/v2/candleAnalyzerV2';
import { SimulationUtilityV2 } from '@/utility/v2/simulationUtilityV2';

const chocoMintoStore = useChocoMintoStore();

const props = defineProps<{
    futureSymbols: FuturesSymbol[];
    margin: number;
    interval: string;
    supportAndResistancePeriodLength: number;
    maxInitCandles: number;
    targetTpRoi: number;
    targetSlRoi: number;
    maxOpenPositions: number;
    newCandleTriggerKey: string;
    positionDurationMedian: number;
}>();

const emit = defineEmits(['onCompleted']);

const progressCounter = ref(0);
const showEntryHistory = ref(false);
const selectedSymbol = ref("");

const currentFutureSumbol = ref<FuturesSymbol>();
const visitedSymbols = ref<Set<string>>(new Set());

async function runInitialScan() {
    console.log("runInitialScan", props.futureSymbols.length);

    for (let i = 0; i < props.futureSymbols.length; i++) {
        try {
            
            const futureSymbol = props.futureSymbols[i];

            if (futureSymbol.symbol != "LTCUSDT") continue;

            var symbolInfo: SymbolInfo = {
                name: futureSymbol.symbol,
                candle_15m: mapToInfo(await KlineUtility.getRecentKlines(futureSymbol.symbol, "15m", props.maxInitCandles)),
                candle_1h: mapToInfo(await KlineUtility.getRecentKlines(futureSymbol.symbol, "1h", props.maxInitCandles)),
                candle_4h: mapToInfo(await KlineUtility.getRecentKlines(futureSymbol.symbol, "4h", props.maxInitCandles)),
                candle_1d: mapToInfo(await KlineUtility.getRecentKlines(futureSymbol.symbol, "1d", props.maxInitCandles)),

                oi_15m: await KlineUtility.getOIByRange(futureSymbol.symbol, "15m", props.maxInitCandles),
                oi_1h: await KlineUtility.getOIByRange(futureSymbol.symbol, "1h", props.maxInitCandles),
                oi_4h: await KlineUtility.getOIByRange(futureSymbol.symbol, "4h", props.maxInitCandles),
                oi_1d: await KlineUtility.getOIByRange(futureSymbol.symbol, "1d", props.maxInitCandles),

                ls_15m: await KlineUtility.getLSRatioByRange(futureSymbol.symbol, "15m", props.maxInitCandles),
                ls_1h: await KlineUtility.getLSRatioByRange(futureSymbol.symbol, "1h", props.maxInitCandles),
                ls_4h: await KlineUtility.getLSRatioByRange(futureSymbol.symbol, "4h", props.maxInitCandles),
                ls_1d: await KlineUtility.getLSRatioByRange(futureSymbol.symbol, "1d", props.maxInitCandles),
            };


            progressCounter.value = i + 1;
            

            currentFutureSumbol.value = futureSymbol;
            futureSymbol.status = "processing";

            await SimulationUtilityV2.runMarketAnalysis(symbolInfo,[]);

            klineDbUtilityV2.storeSymbolInfo(symbolInfo);

            await new Promise(resolve => setTimeout(resolve, 400));

            if (chocoMintoStore.isManualSimulation) {
                const storeFutureSymbol = chocoMintoStore.futureSymbols.find(f => f.symbol === futureSymbol.symbol);

                if (storeFutureSymbol) {
                    futureSymbol.status =
                        `${storeFutureSymbol.simulationStats.won}/` +
                        `${storeFutureSymbol.simulationStats.loss}/` +
                        `${storeFutureSymbol.simulationStats.open}-` +
                        `${storeFutureSymbol.simulationStats.mid}`;
                }
            } else {
                futureSymbol.status = "-";
            }
        } catch (error) {
            console.error("initializeFutureSymbolData", error);
        }
    }

    emit('onCompleted');
    progressCounter.value = 0
}


async function onNewCandleSpawned() {
}

function mapToInfo(rawCandles: Candle[]){ 
    return rawCandles.map(candle => {
        return {
            openTime: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume
        } as CandleInfo;
    });
}

async function showEntryHistoryModal(futureSymbol: FuturesSymbol) {
    showEntryHistory.value = true;
    selectedSymbol.value = futureSymbol.symbol;
    visitedSymbols.value.add(futureSymbol.symbol);
}

defineExpose({
    runInitialScan,
    onNewCandleSpawned
});
</script>

<style scoped>
.market-scanner {
    overflow: hidden;
}

.market-scanner-body {
    padding: 6px 8px;
}

.scanner-progress {
    margin-bottom: 7px;
}

.scanner-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3px;

    font-size: 10px;
    line-height: 12px;
    color: var(--text-secondary, #888);
    text-transform: uppercase;
    letter-spacing: 0.3px;
}

.scanner-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.scanner-row {
    display: grid;
    grid-template-columns: 115px 1fr auto;
    align-items: center;

    min-height: 25px;
    padding: 2px 6px;

    border-radius: 3px;

    font-size: 11px;
    line-height: 15px;

    cursor: pointer;

    transition:
        background-color 0.1s ease,
        transform 0.1s ease;
}

.scanner-row:hover {
    background: rgba(128, 128, 128, 0.10);
}

.scanner-row:active {
    transform: translateY(1px);
}

.scanner-row-visited {
    color: #d99a32;
}

.scanner-row-processing {
    background: rgba(128, 128, 128, 0.08);
}

.scanner-row-hit {
    background: rgba(128, 128, 128, 0.06);
}

.scanner-symbol {
    display: flex;
    align-items: center;
    gap: 5px;

    min-width: 0;
}

.symbol-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.scanner-status-dot {
    width: 5px;
    height: 5px;
    flex: 0 0 5px;

    border-radius: 50%;
    background: #777;
}

.scanner-row-processing .scanner-status-dot {
    background: #e0a020;
    box-shadow: 0 0 4px rgba(224, 160, 32, 0.6);
}

.scanner-row-hit .scanner-status-dot {
    background: #4caf50;
}

.scanner-condition {
    min-width: 0;
    overflow: hidden;
}

.condition-badge {
    display: inline-block;

    max-width: 100%;
    padding: 1px 5px;

    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 3px;

    font-size: 9px;
    line-height: 13px;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    background: rgba(128, 128, 128, 0.08);
}

.scanner-status {
    min-width: 55px;

    text-align: right;

    font-size: 10px;
    font-family: monospace;

    color: var(--text-secondary, #888);
}

.scanner-empty {
    padding: 12px;

    text-align: center;

    font-size: 10px;
    color: var(--text-secondary, #888);
}
</style>