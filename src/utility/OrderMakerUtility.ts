import type { BalanceResponse, Position } from "@/core/interfaces"

export class OrderMakerUtility {
    static async getMaxLeverage(symbol: string): Promise<number> {
        try {
            const response = await fetch(import.meta.env.VITE_ORDER_MAKER_API + `/get-max-leverage?symbol=${symbol}`)
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            
            const data = await response.json()
            return data.max_leverage
        } catch (error) {
            console.error('Error fetching max leverage:', error)
            throw error
        }
    }

    static async getPositions(): Promise<Position[]> {
        try {
            const response = await fetch(import.meta.env.VITE_ORDER_MAKER_API  + '/get-pos');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const positions: Position[] = await response.json();
            return positions;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error fetching positions:', errorMessage);
            throw error;
        }
    }

    static async getFuturesSymbols() : Promise<string[]> {
        try {
            const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + '/get-futures-ticker')
            const data = await res.json()

            const IGNORE_SYMBOLS = [
                "AGIXUSDT","CTKUSDT","CVXUSDT","DGBUSDT","GLMRUSDT","IDEXUSDT","KLAYUSDT",
                "MDTUSDT","OCEANUSDT","RADUSDT","SLPUSDT","SNTUSDT","STPTUSDT","STRAXUSDT",
                "UNFIUSDT","WAVESUSDT","1000WHYUSDT","1000CHEEMSUSDT","CHILLGUYUSDT",
                "MORPHOUSDT","THEUSDT","KEYUSDT","RENUSDT","ALPACAUSDT","ALPHAUSDT","AMBUSDT",
                "BALUSDT","BAKEUSDT","BLZUSDT","BNXUSDT","BONDUSDT","BSWUSDT","COMBOUSDT",
                "DARUSDT","DEFIUSDT","FTMUSDT","GIGGLEUSDT","HIFIUSDT","LEVERUSDT","LINAUSDT",
                "LOKAUSDT","LITUSDT","LOOMUSDT","MEMEFIUSDT","MKRUSDT","NEIROETHUSDT","OMNIUSDT",
                "ORBSUSDT","REEFUSDT","TROYUSDT","UXLINKUSDT","VIDTUSDT","XEMUSDT","BADGERUSDT",
                "NULSUSDT","OMGUSDT","STMXUSDT","AI16ZUSDT", "AIAUSDT"
            ]

            const futuresSymbols: string[] = data
            .filter((d: any) => d.symbol.endsWith("USDT") && !IGNORE_SYMBOLS.includes(d.symbol))
            .map((d: any) => d.symbol);

            return futuresSymbols
        } catch (err) {
            console.error(err)
            return []
        }
    }

    static async calculateTpSl(margin: number, symbol: string,side:string,currentPrice: string, targetTpRoi:number, targetSlRoi: number) {
        const maxRetries = 5;
        let attempt = 0;
        let lastError: any;

        while (attempt < maxRetries) {
            try {
                const response = await fetch(import.meta.env.VITE_ORDER_MAKER_API + `/calculate-tp-sl`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                        symbol,
                        side,
                        cost: margin.toString(),
                        tp_roi: targetTpRoi.toString(),
                        sl_roi: targetSlRoi.toString(),
                        tp: "0",
                        sl: "0",
                        current_price: currentPrice,
                    }),
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } catch (error) {
                lastError = error;
                attempt++;
                if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * attempt)); // exponential backoff
            }
        }

        throw lastError;
    }

    static async openOrder(symbol:string,margin:number,side:string,tp:number,sl:number) {
        const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + "/open-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                symbol: symbol,
                side: side,
                cost: margin.toString(),
                tp_roi: "0",
                sl_roi: "0",
                tp: tp.toString(),
                sl: sl.toString()
            })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    static async transferEarnings(baseBalance:number) {
        const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + "/transfer-earnings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                baseBalance: baseBalance
            })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    static async closeAllOpenPositions() {
        const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + "/close-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    static async getBalance(): Promise<BalanceResponse> {
        const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + "/get-bal", {
            method: "GET"
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BalanceResponse = await res.json();
        return data;
    }

    static calculateTotalTradingFees(
        positions: Position[],
        takerFeeRate: number = 0.0004
    ): { 
        entryFees: number; 
        exitFees: number; 
        totalFees: number;
        liquidityBuffer: number;
        totalNotional: number;
        targetProfit: number;
    } {
        let totalEntryFees = 0;
        let totalExitFees = 0;
        let totalNotional = 0;

        for (const position of positions) {
            const notional = Math.abs(parseFloat(position.notional));
            totalNotional += notional;
            
            // Entry fee (already paid when opening position)
            const entryFee = notional * takerFeeRate;
            totalEntryFees += entryFee;
            
            // Exit fee (will pay when closing position)
            const exitFee = notional * takerFeeRate;
            totalExitFees += exitFee;
        }

        const totalFees = totalEntryFees + totalExitFees;

        const liquidityBufferPercent = Math.pow(positions.length / 10, 1.5) * 0.001; // scales exponentially
        
        // Calculate liquidity buffer based on total notional
        const liquidityBuffer = totalNotional * liquidityBufferPercent;
        
        // Target profit to land clean 5 USDT
        const desiredProfit = 5;
        const targetProfit = desiredProfit + totalFees + liquidityBuffer;

        return {
            entryFees: totalEntryFees,
            exitFees: totalExitFees,
            totalFees,
            liquidityBuffer,
            totalNotional,
            targetProfit
        };
    }
}