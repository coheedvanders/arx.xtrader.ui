import { type FuturesSymbol } from "@/core/interfaces";
import { defineStore } from "pinia";
import { ref } from "vue";

export const useChocoMintoStore = defineStore('choco-minto-store', () => {

    // --- State ---
    const futureSymbols = ref<FuturesSymbol[]>([])
    const isManualSimulation = ref(false);
    const startingTimeStamp = ref(0);
    const marginBalance = ref(0)

    // --- Actions ----
    function splitFutureSymbols(batches: number): FuturesSymbol[][] {
        if (batches <= 0) return [];

        const total = futureSymbols.value.length;
        const base = Math.floor(total / batches);
        const remainder = total % batches; // distribute +1 to first `remainder` buckets

        const result: FuturesSymbol[][] = [];
        let index = 0;

        for (let i = 0; i < batches; i++) {
            const size = base + (i < remainder ? 1 : 0);
            result.push(futureSymbols.value.slice(index, index + size));
            index += size;
        }

        return result;
    }

    return ({
        futureSymbols,
        isManualSimulation,
        startingTimeStamp,
        marginBalance,

        splitFutureSymbols
    })
});
    