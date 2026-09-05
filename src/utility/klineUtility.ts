import type { Candle } from "@/core/interfaces"
import type { LongShortRatioEntry, OpenInterestEntry, OpenInterestHistEntry } from "@/core/interfacesv2"


// All kline intervals Binance supports, for ms conversion. Superset of
// what the OI/LS "stats" endpoints support (they're missing 1m/3m/8h).
const KLINE_INTERVAL_MS_MAP: Record<string, number> = {
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '6h': 21_600_000,
    '8h': 28_800_000,
    '12h': 43_200_000,
    '1d': 86_400_000
}

// Periods supported by Binance Futures' openInterestHist / globalLongShortAccountRatio
// endpoints. Note this is NOT the same set as kline intervals (no 1m/3m/8h).
const statsPeriodMsMap: Record<string, number> = {
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '6h': 21_600_000,
    '12h': 43_200_000,
    '1d': 86_400_000
}

const OI_SUPPORTED_PERIODS = Object.keys(statsPeriodMsMap)

/**
 * Binance's OI-history/LS-ratio endpoints only support a fixed set of
 * periods (no 1m/3m/8h). If a caller passes a kline interval outside that
 * set, snap to whichever supported period is closest in duration instead
 * of throwing — so you can pass your candle interval straight through
 * without having to know Binance's stats-endpoint quirks up front.
 */
function resolveStatsPeriod(interval: string): string {
    if (OI_SUPPORTED_PERIODS.includes(interval)) return interval

    const wantedMs = KLINE_INTERVAL_MS_MAP[interval]
    if (!wantedMs) throw new Error(`Unsupported interval: ${interval}`)

    let best = OI_SUPPORTED_PERIODS[0]
    let bestDiff = Infinity
    for (const period of OI_SUPPORTED_PERIODS) {
        const diff = Math.abs(statsPeriodMsMap[period] - wantedMs)
        if (diff < bestDiff) {
            bestDiff = diff
            best = period
        }
    }
    return best
}

// Binance caps these "data" stats endpoints at 500 per request (vs 1000/1500 for klines).
const STATS_MAX_BATCH = 500

// Binance only retains ~30 days of history for openInterestHist / globalLongShortAccountRatio.
// A startTime older than this is rejected outright (-1130), not just returned empty.
const STATS_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/** Clamps a requested startTime so it never falls before Binance's retention floor. */
function clampStatsStartTime(startTime: number): number {
    const earliestAllowed = Date.now() - STATS_MAX_LOOKBACK_MS
    return Math.max(startTime, earliestAllowed)
}

export class KlineUtility {
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

            return candles
        } catch (error) {
            console.error('Error fetching klines:', error)
            return []
        }
    }

    static async getRecentKlinesByRange(
        symbol: string,
        interval: string,
        limit: number,
        startTime?: number,
        endTime?: number
    ): Promise<Candle[]> {

        const intervalMs = KLINE_INTERVAL_MS_MAP[interval]
        if (!intervalMs) throw new Error('Unsupported interval')

        const candles: Candle[] = []
        let currentStart = startTime ?? Date.now() - limit * intervalMs
        const resolvedEnd = endTime ?? Date.now()

        try {
            while (candles.length < limit) {
                const remaining = limit - candles.length
                const batchLimit = Math.min(1000, remaining)

                let url =
                    `https://fapi.binance.com/fapi/v1/klines` +
                    `?symbol=${symbol.toUpperCase()}` +
                    `&interval=${interval}` +
                    `&startTime=${currentStart}` +
                    `&endTime=${resolvedEnd}` +
                    `&limit=${batchLimit}`

                const res = await fetch(url)
                const data = await res.json()

                if (!Array.isArray(data) || data.length === 0) break

                const batch = data.map((k: any) => ({
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

                candles.push(...batch)

                const lastOpenTime = data[data.length - 1][0]
                currentStart = lastOpenTime + intervalMs

                if (data.length < batchLimit || currentStart >= resolvedEnd) break
            }

            return candles
                .slice(-limit)
                .sort((a, b) => a.openTime - b.openTime)

        } catch (error) {
            console.error('Error fetching klines:', error)
            return []
        }
    }

    /**
     * Latest open interest for a symbol AT A GIVEN PERIOD (e.g. '15m', '1h').
     * Uses openInterestHist with limit=1 under the hood, so the value/timestamp
     * reflect that period's granularity — same shape/period semantics as
     * getLSRatio, so the two line up when captured for the same timeframe.
     */
    static async getOI(symbol: string, period: string = '5m'): Promise<OpenInterestHistEntry | null> {
        try {
            const resolvedPeriod = resolveStatsPeriod(period)

            const url =
                `https://fapi.binance.com/futures/data/openInterestHist` +
                `?symbol=${symbol.toUpperCase()}` +
                `&period=${resolvedPeriod}` +
                `&limit=1`

            const res = await fetch(url)
            const data = await res.json()

            if (!Array.isArray(data) || !data.length) {
                throw new Error('No open interest data received')
            }

            const latest = data[data.length - 1]

            return {
                symbol: latest.symbol,
                sumOpenInterest: +latest.sumOpenInterest,
                sumOpenInterestValue: +latest.sumOpenInterestValue,
                timestamp: latest.timestamp
            }
        } catch (error) {
            console.error('Error fetching open interest:', error)
            return null
        }
    }

    /**
     * True live open interest snapshot (Binance's /fapi/v1/openInterest —
     * no period/history, just "right now"). Use getOI(symbol, period) instead
     * when you need a value on the same period grid as candles/LS ratio.
     */
    static async getCurrentOI(symbol: string): Promise<OpenInterestEntry | null> {
        try {
            const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol.toUpperCase()}`
            const res = await fetch(url)
            const data = await res.json()

            if (!data || typeof data.openInterest === 'undefined') {
                throw new Error('No open interest data received')
            }

            return {
                symbol: data.symbol,
                openInterest: +data.openInterest,
                time: data.time
            }
        } catch (error) {
            console.error('Error fetching current open interest:', error)
            return null
        }
    }

    /**
     * Current (most recent) global long/short account ratio for a symbol.
     */
    static async getLSRatio(symbol: string, period: string = '5m'): Promise<LongShortRatioEntry | null> {
        try {
            const resolvedPeriod = resolveStatsPeriod(period)

            const url =
                `https://fapi.binance.com/futures/data/globalLongShortAccountRatio` +
                `?symbol=${symbol.toUpperCase()}` +
                `&period=${resolvedPeriod}` +
                `&limit=1`

            const res = await fetch(url)
            const data = await res.json()

            if (!Array.isArray(data) || !data.length) {
                throw new Error('No long/short ratio data received')
            }

            const latest = data[data.length - 1]

            return {
                symbol: latest.symbol,
                longShortRatio: +latest.longShortRatio,
                longAccount: +latest.longAccount,
                shortAccount: +latest.shortAccount,
                timestamp: latest.timestamp
            }
        } catch (error) {
            console.error('Error fetching long/short ratio:', error)
            return null
        }
    }

    /**
     * Historical open interest (sumOpenInterest) over a time range, paginated
     * the same way as getRecentKlinesByRange. Binance only retains ~30 days
     * of history for this endpoint regardless of range requested.
     */
    static async getOIByRange(
        symbol: string,
        period: string,
        limit: number,
        startTime?: number,
        endTime?: number
    ): Promise<OpenInterestHistEntry[]> {

        const resolvedPeriod = resolveStatsPeriod(period)
        const periodMs = statsPeriodMsMap[resolvedPeriod]

        const entries: OpenInterestHistEntry[] = []
        let currentStart = clampStatsStartTime(startTime ?? Date.now() - limit * periodMs)
        const resolvedEnd = endTime ?? Date.now()

        try {
            while (entries.length < limit) {
                const remaining = limit - entries.length
                const batchLimit = Math.min(STATS_MAX_BATCH, remaining)

                const url =
                    `https://fapi.binance.com/futures/data/openInterestHist` +
                    `?symbol=${symbol.toUpperCase()}` +
                    `&period=${resolvedPeriod}` +
                    `&startTime=${currentStart}` +
                    `&endTime=${resolvedEnd}` +
                    `&limit=${batchLimit}`

                const res = await fetch(url)
                const data = await res.json()

                if (!Array.isArray(data) || data.length === 0) break

                const batch: OpenInterestHistEntry[] = data.map((d: any) => ({
                    symbol: d.symbol,
                    sumOpenInterest: +d.sumOpenInterest,
                    sumOpenInterestValue: +d.sumOpenInterestValue,
                    timestamp: d.timestamp
                }))

                entries.push(...batch)

                const lastTimestamp = data[data.length - 1].timestamp
                currentStart = lastTimestamp + periodMs

                if (data.length < batchLimit || currentStart >= resolvedEnd) break
            }

            return entries
                .slice(-limit)
                .sort((a, b) => a.timestamp - b.timestamp)

        } catch (error) {
            console.error('Error fetching open interest history:', error)
            return []
        }
    }

    /**
     * Historical global long/short account ratio over a time range, paginated
     * the same way as getRecentKlinesByRange. Binance only retains ~30 days
     * of history for this endpoint regardless of range requested.
     */
    static async getLSRatioByRange(
        symbol: string,
        period: string,
        limit: number,
        startTime?: number,
        endTime?: number
    ): Promise<LongShortRatioEntry[]> {

        const resolvedPeriod = resolveStatsPeriod(period)
        const periodMs = statsPeriodMsMap[resolvedPeriod]

        const entries: LongShortRatioEntry[] = []
        let currentStart = clampStatsStartTime(startTime ?? Date.now() - limit * periodMs)
        const resolvedEnd = endTime ?? Date.now()

        try {
            while (entries.length < limit) {
                const remaining = limit - entries.length
                const batchLimit = Math.min(STATS_MAX_BATCH, remaining)

                const url =
                    `https://fapi.binance.com/futures/data/globalLongShortAccountRatio` +
                    `?symbol=${symbol.toUpperCase()}` +
                    `&period=${resolvedPeriod}` +
                    `&startTime=${currentStart}` +
                    `&endTime=${resolvedEnd}` +
                    `&limit=${batchLimit}`

                const res = await fetch(url)
                const data = await res.json()

                if (!Array.isArray(data) || data.length === 0) break

                const batch: LongShortRatioEntry[] = data.map((d: any) => ({
                    symbol: d.symbol,
                    longShortRatio: +d.longShortRatio,
                    longAccount: +d.longAccount,
                    shortAccount: +d.shortAccount,
                    timestamp: d.timestamp
                }))

                entries.push(...batch)

                const lastTimestamp = data[data.length - 1].timestamp
                currentStart = lastTimestamp + periodMs

                if (data.length < batchLimit || currentStart >= resolvedEnd) break
            }

            return entries
                .slice(-limit)
                .sort((a, b) => a.timestamp - b.timestamp)

        } catch (error) {
            console.error('Error fetching long/short ratio history:', error)
            return []
        }
    }

    /**
     * Aligns a timestamped series (OI or LS ratio) to a candle array by time,
     * returning one entry per candle so index i in the result always
     * corresponds to candles[i] — never by assuming the two arrays' indices
     * already line up, since gaps/pagination/rate limits can desync them.
     *
     * For each candle, picks the LATEST series entry whose timestamp is
     * <= candle.openTime (i.e. "what was OI/LS as of this candle opening").
     * If no series entry exists yet at that point (e.g. series history
     * starts later than the candles), the slot is null — never a guess.
     *
     * Both `candles` and `series` must be pre-sorted ascending by time,
     * which is what getRecentKlinesByRange / getOIByRange / getLSRatioByRange
     * already return.
     */
    static matchByTimestamp<T extends { timestamp: number }>(
        candles: Candle[],
        series: T[]
    ): (T | null)[] {
        const matched: (T | null)[] = []
        let seriesIndex = 0

        for (const candle of candles) {
            while (
                seriesIndex + 1 < series.length &&
                series[seriesIndex + 1].timestamp <= candle.openTime
            ) {
                seriesIndex++
            }

            const candidate = series[seriesIndex]
            matched.push(candidate && candidate.timestamp <= candle.openTime ? candidate : null)
        }

        return matched
    }

    /**
     * Convenience wrapper: fetches OI history for the given range and aligns
     * it 1:1 to the provided candles by timestamp.
     */
    static async getOIMatchedToKlines(
        candles: Candle[],
        symbol: string,
        period: string
    ): Promise<(OpenInterestHistEntry | null)[]> {
        if (!candles.length) return []

        const startTime = candles[0].openTime
        const endTime = candles[candles.length - 1].openTime
        const resolvedPeriod = resolveStatsPeriod(period)
        const periodMs = statsPeriodMsMap[resolvedPeriod]

        const limit = Math.ceil((endTime - startTime) / periodMs) + 1
        const oiSeries = await KlineUtility.getOIByRange(symbol, resolvedPeriod, limit, startTime, endTime)

        return KlineUtility.matchByTimestamp(candles, oiSeries)
    }

    /**
     * Convenience wrapper: fetches LS ratio history for the given range and
     * aligns it 1:1 to the provided candles by timestamp.
     */
    static async getLSRatioMatchedToKlines(
        candles: Candle[],
        symbol: string,
        period: string
    ): Promise<(LongShortRatioEntry | null)[]> {
        if (!candles.length) return []

        const startTime = candles[0].openTime
        const endTime = candles[candles.length - 1].openTime
        const resolvedPeriod = resolveStatsPeriod(period)
        const periodMs = statsPeriodMsMap[resolvedPeriod]

        const limit = Math.ceil((endTime - startTime) / periodMs) + 1
        const lsSeries = await KlineUtility.getLSRatioByRange(symbol, resolvedPeriod, limit, startTime, endTime)

        return KlineUtility.matchByTimestamp(candles, lsSeries)
    }
}