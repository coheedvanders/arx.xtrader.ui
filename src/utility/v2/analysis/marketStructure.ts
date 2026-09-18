// Intended location: src/utility/v2/analysis/marketStructure.ts
//
// HH/HL/LH/LL classification. A swing high/low can only be CONFIRMED
// once the candles after it are known (the classic fractal definition:
// a swing high's high must exceed N candles on both sides) — so this
// is inherently a confirmation-lag concept, same discipline as
// liquidityAnchor's confirmedOpenTime elsewhere in this codebase.
// Never call this expecting same-candle confirmation; the swing at
// index i only becomes checkable once movingCandles has grown to
// include i + fractalWidth.

import type { CandleInfo, MarketStructureLabel } from "@/core/interfacesv2";

/**
 * Checks whether candles[idx] is a confirmed swing high or low, using
 * fractalWidth candles on EITHER side (the classic 2-sided fractal —
 * fractalWidth=2 is the standard 5-candle fractal, an arbitrary but
 * conventional choice, not derived from anything in this data).
 * Returns null if idx doesn't have fractalWidth candles available on
 * both sides yet (nothing to compare against — not confirmable), or if
 * the candle simply isn't a swing point.
 */
export function checkSwingPoint(candles: CandleInfo[], idx: number, fractalWidth: number): "HIGH" | "LOW" | null {
    if (idx - fractalWidth < 0 || idx + fractalWidth >= candles.length) return null;

    const pivotHigh = candles[idx].high;
    const pivotLow = candles[idx].low;
    let isSwingHigh = true;
    let isSwingLow = true;
    // The margin by which the pivot beats its CLOSEST call on each side —
    // this is the binding constraint for whether it counts as a swing at
    // all, so it's also the right basis for "how extreme is this swing"
    // when both sides qualify at once.
    let minHighMargin = Infinity;
    let minLowMargin = Infinity;

    for (let offset = 1; offset <= fractalWidth; offset++) {
        const leftHigh = candles[idx - offset].high;
        const rightHigh = candles[idx + offset].high;
        if (leftHigh >= pivotHigh || rightHigh >= pivotHigh) isSwingHigh = false;
        minHighMargin = Math.min(minHighMargin, pivotHigh - leftHigh, pivotHigh - rightHigh);

        const leftLow = candles[idx - offset].low;
        const rightLow = candles[idx + offset].low;
        if (leftLow <= pivotLow || rightLow <= pivotLow) isSwingLow = false;
        minLowMargin = Math.min(minLowMargin, leftLow - pivotLow, rightLow - pivotLow);
    }

    // The common case: only one side qualifies.
    if (isSwingHigh && !isSwingLow) return "HIGH";
    if (isSwingLow && !isSwingHigh) return "LOW";
    if (!isSwingHigh && !isSwingLow) return null;

    // Both sides qualify (a wide-range single candle beating every
    // neighbor's high AND every neighbor's low) — pick whichever side's
    // margin against its closest neighbor is larger. Both margins are
    // in the same price units from the same candle, so comparing them
    // directly is equivalent to normalizing both by this candle's ATR
    // first (the same divisor on both sides cancels out of the
    // comparison) — simpler and avoids an ATR=0 edge case for no
    // difference in outcome.
    return minHighMargin >= minLowMargin ? "HIGH" : "LOW";
}

export interface MarketStructureClassification {
    /** The HH/HL/LH/LL label — null if this is the very first swing of this type ever (nothing to compare against yet), OR if the swing wasn't significant enough relative to ATR to represent real structural change. */
    label: MarketStructureLabel | null;
    /**
     * Whether this swing's price should become the new reference point
     * for future comparisons. True for the first-ever swing (nothing
     * to compare against, so it becomes the baseline) and for any
     * swing that clears the significance bar. False for a swing too
     * close to the last one — the tracked reference stays at its old,
     * more significant level, so a string of small noisy wiggles can't
     * quietly drag the reference away from a real prior high/low.
     */
    updateReference: boolean;
}

/**
 * minSignificanceAtrMultiple is a stated, tunable threshold — how many
 * ATRs of difference from the prior swing of the same type are required
 * before a fractal swing counts as real structural change rather than
 * noise. There's no principled "correct" value here; it trades density
 * against responsiveness, and different timeframes/symbols may want
 * different values. 0 disables the filter entirely (every confirmed
 * fractal swing gets classified, the original behavior).
 */
export function classifyMarketStructure(
    swingType: "HIGH" | "LOW",
    price: number,
    lastSwingHighPrice: number | null,
    lastSwingLowPrice: number | null,
    atr: number,
    minSignificanceAtrMultiple: number = 0
): MarketStructureClassification {
    const lastPrice = swingType === "HIGH" ? lastSwingHighPrice : lastSwingLowPrice;
    if (lastPrice === null) {
        return { label: null, updateReference: true };
    }

    if (minSignificanceAtrMultiple > 0 && atr > 0) {
        const diff = Math.abs(price - lastPrice);
        if (diff < atr * minSignificanceAtrMultiple) {
            return { label: null, updateReference: false };
        }
    }

    if (swingType === "HIGH") {
        return { label: price >= lastPrice ? "HH" : "LH", updateReference: true };
    } else {
        return { label: price <= lastPrice ? "LL" : "HL", updateReference: true };
    }
}