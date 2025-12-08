import type { BalanceResponse } from "@/core/interfaces"

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
                "NULSUSDT","OMGUSDT","STMXUSDT","AI16ZUSDT"
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

    static async getBalance(): Promise<BalanceResponse> {
        const res = await fetch(import.meta.env.VITE_ORDER_MAKER_API + "/get-bal", {
            method: "GET"
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BalanceResponse = await res.json();
        return data;
    }
}