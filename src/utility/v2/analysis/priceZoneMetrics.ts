import type { CandleInfo, OutsidePriceZoneMetrics } from "@/core/interfacesv2";

/**
 * Where the close sits relative to the candle's session price zone, in
 * units that compare across symbols: ATR (volatility), percent of price,
 * and zone widths. Raw price distances are not comparable between a
 * $60,000 coin and a $0.002 coin; these are.
 *
 * Sign convention for fromUpper / fromLower: close MINUS the boundary.
 * Positive = close is above that boundary, negative = below it.
 *
 * outside* are 0 while the close is inside [lower, upper], otherwise the
 * distance beyond the NEAREST boundary, positive above the zone and
 * negative below it.
 *
 * Causal: the zone is fixed at the session's first candle and ATR is this
 * candle's own, so everything here is known at this candle's close.
 *
 * Returns null when there is no zone yet, ATR is not usable, or the zone
 * has zero width.
 */
export function getOutsidePriceZoneMetrics(
    candle: CandleInfo,
    previousCandle: CandleInfo | undefined
): OutsidePriceZoneMetrics | null {
    const zone = candle.priceZone;
    const atr = candle.atr;
    const close = candle.close;
    if (!zone || !(atr > 0) || !(close > 0)) return null;

    const width = zone.upper - zone.lower;
    if (!(width > 0)) return null;

    const fromUpper = close - zone.upper;
    const fromLower = close - zone.lower;
    const position: OutsidePriceZoneMetrics["position"] =
        close > zone.upper ? "ABOVE" : close < zone.lower ? "BELOW" : "INSIDE";
    const outside = position === "ABOVE" ? fromUpper : position === "BELOW" ? fromLower : 0;

    // Furthest the candle's WICK reached outside the zone this candle,
    // regardless of where it closed - a close back inside after a probe
    // shows up here but not in outside*.
    const wickAbove = Math.max(0, candle.high - zone.upper);
    const wickBelow = Math.max(0, zone.lower - candle.low);

    // Consecutive closes outside on the same side, this candle included.
    // Resets on a close inside, a side flip, or a new zone.
    const prev = previousCandle?.outsidePriceZoneMetrics;
    // By value, not reference: candles restored from IndexedDB each hold
    // their own copy of the zone object.
    const pz = previousCandle?.priceZone;
    const sameZone = !!pz && pz.upper === zone.upper && pz.lower === zone.lower && pz.mid === zone.mid;
    const candlesOutside = position === "INSIDE"
        ? 0
        : sameZone && prev && prev.position === position ? prev.candlesOutside + 1 : 1;

    const pct = (v: number) => (v / close) * 100;

    return {
        position,
        positionInZone: fromLower / width,

        fromUpperAtr: fromUpper / atr,
        fromLowerAtr: fromLower / atr,
        fromUpperPct: pct(fromUpper),
        fromLowerPct: pct(fromLower),

        outsideAtr: outside / atr,
        outsidePct: pct(outside),
        outsideZoneWidths: outside / width,

        wickAboveAtr: wickAbove / atr,
        wickBelowAtr: wickBelow / atr,

        zoneWidthAtr: width / atr,
        zoneWidthPct: pct(width),

        candlesOutside,
    };
}
