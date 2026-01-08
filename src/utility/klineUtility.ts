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

    // static async getRecentKlines(
    //     symbol: string,
    //     interval: string,
    //     limit: number
    // ): Promise<Candle[]> {

    //     const intervalMsMap: Record<string, number> = {
    //         '1m': 60_000,
    //         '3m': 180_000,
    //         '5m': 300_000,
    //         '15m': 900_000,
    //         '30m': 1_800_000,
    //         '1h': 3_600_000,
    //         '2h': 7_200_000,
    //         '4h': 14_400_000,
    //         '6h': 21_600_000,
    //         '8h': 28_800_000,
    //         '12h': 43_200_000,
    //         '1d': 86_400_000
    //     }

    //     const intervalMs = intervalMsMap[interval]
    //     if (!intervalMs) throw new Error('Unsupported interval')

    //     const candles: Candle[] = []
    //     let startTime = Date.now() - limit * intervalMs

    //     try {
    //         while (candles.length < limit) {
    //             const remaining = limit - candles.length
    //             const batchLimit = Math.min(1000, remaining)

    //             const url =
    //                 `https://fapi.binance.com/fapi/v1/klines` +
    //                 `?symbol=${symbol.toUpperCase()}` +
    //                 `&interval=${interval}` +
    //                 `&startTime=${startTime}` +
    //                 `&limit=${batchLimit}`

    //             const res = await fetch(url)
    //             const data = await res.json()

    //             if (!Array.isArray(data) || data.length === 0) break

    //             const batch = data.map((k: any) => ({
    //                 openTime: k[0],
    //                 open: +k[1],
    //                 high: +k[2],
    //                 low: +k[3],
    //                 close: +k[4],
    //                 volume: +k[7],
    //                 closeTime: k[6],
    //                 closed: true,
    //                 breakthrough_resistance: false,
    //                 breakthrough_support: false,
    //                 support: null,
    //                 resistance: null
    //             }))

    //             candles.push(...batch)

    //             const lastOpenTime = data[data.length - 1][0]
    //             startTime = lastOpenTime + intervalMs

    //             if (data.length < batchLimit) break
    //         }

    //         return candles
    //             .slice(-limit)
    //             .sort((a, b) => a.openTime - b.openTime)

    //     } catch (error) {
    //         console.error('Error fetching klines:', error)
    //         return []
    //     }
    // }
}