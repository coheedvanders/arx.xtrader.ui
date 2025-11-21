import type { Candle } from "@/core/interfaces"

export class KlineUtility{
    static async getRecentKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
        try {
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
            const res = await fetch(url)
            const data = await res.json()

            if (!Array.isArray(data) || !data.length) {
            throw new Error('No kline data received')
            }

            var candles = data.map((k: any) => ({
                openTime: k[0],
                open: +k[1],
                high: +k[2],
                low: +k[3],
                close: +k[4],
                volume: +k[7],
                closeTime: k[6],
                closed: true,
                breakthrough_resistance: false,
                breakthrough_support: false,
                support: null,
                resistance: null
            }))

            return candles.sort((a, b) => a.openTime - b.openTime)
        } catch (error) {
            console.error('Error fetching klines:', error)
            return []
        }
    }
}