import type { CandleInfo } from "@/core/interfacesv2"

export class CandleAnalyzerV2 {
    static calculateATR(candlesList: CandleInfo[], period = 14): number {
        if (candlesList.length < period + 1) return 0

        const trs = []
        for (let i = 1; i < candlesList.length; i++) {
            const c = candlesList[i]
            const prev = candlesList[i - 1]
            const tr = Math.max(
                c.high - c.low,
                Math.abs(c.high - prev.close),
                Math.abs(c.low - prev.close)
            )
            trs.push(tr)
        }

        const atrSlice = trs.slice(-period)
        const atr = atrSlice.reduce((a, b) => a + b, 0) / atrSlice.length
        return atr
    }

    static calculateEMA(candlesList: CandleInfo[], period: number): number {
        if (candlesList.length < period) return 0

        const k = 2 / (period + 1)

        // Start with SMA of first `period` candles
        let ema = 0
        for (let i = 0; i < period; i++) {
            ema += candlesList[i].close
        }
        ema = ema / period

        // Apply EMA formula to ALL candles from index `period` onwards to converge
        for (let i = period; i < candlesList.length; i++) {
            ema = (candlesList[i].close * k) + (ema * (1 - k))
        }

        return ema
    }
}