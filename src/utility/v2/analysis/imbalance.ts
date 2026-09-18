// Intended location: src/utility/v2/analysis/imbalance.ts
//
// "Imbalance" here means a Fair Value Gap (FVG) — a 3-candle pattern
// where the first candle's high doesn't overlap the third candle's low
// (bullish) or the first candle's low doesn't overlap the third
// candle's high (bearish). The middle candle is the displacement that
// created the gap. This is the standard meaning in ICT/SMC-style
// analysis, which matches the vocabulary already in use here
// (liquidityAnchor, STRONG_LIQUIDITY_ANCHOR).
//
// Causal: only ever looks at the last 3 candles of movingCandles (the
// slice already stops at the current candle), so this never uses
// future data — same discipline as getCandleStructure and the other
// analysis/ modules.
//
// Note: this is a PRICE imbalance (a gap in traded price levels), not
// an order-flow / buy-sell volume imbalance — that would need
// tick-level or footprint data, which isn't available from OHLCV
// candles. If that's what you meant, this isn't it — flag it and I'll
// rebuild against whatever data source would actually support that.

import type { CandleInfo } from "@/core/interfacesv2";

export interface ImbalanceZone {
    direction: "BULLISH" | "BEARISH";
    /** Top of the gap. */
    high: number;
    /** Bottom of the gap. */
    low: number;
    size: number;
    /** openTime of the candle whose CLOSE confirmed this imbalance (the third candle) — when this became knowable, for the same reason liquidityAnchor tracks confirmedOpenTime separately from the event itself. */
    confirmedOpenTime: number;
}

export function getImbalanceState(movingCandles: CandleInfo[]): ImbalanceZone | null {
    const n = movingCandles.length;
    if (n < 3) return null;

    const first = movingCandles[n - 3];
    const last = movingCandles[n - 1];

    if (first.high < last.low) {
        return {
            direction: "BULLISH",
            high: last.low,
            low: first.high,
            size: last.low - first.high,
            confirmedOpenTime: last.openTime,
        };
    }
    if (first.low > last.high) {
        return {
            direction: "BEARISH",
            high: first.low,
            low: last.high,
            size: first.low - last.high,
            confirmedOpenTime: last.openTime,
        };
    }
    return null;
}