// Intended location: src/utility/wisp4hContext.ts
//
// The four prior tests (linear/nonlinear x original/extended features)
// all converged on R²≈0 — every feature so far described the 15M range
// in isolation. This module adds what none of them had: the 4H context
// the range occurred inside of, matching the project's own original
// brief ("4H provides context... major swings, major displacement,
// important ranges").
//
// Strictly causal: only ever uses a 4H candle that has FULLY CLOSED
// before the 15M range's own endOpenTime — never a 4H candle still
// forming at that moment, which would be look-ahead.

import type { CandleInfo } from "@/core/interfacesv2";
import type { PointCandleRange } from "./pastCandleWisp";

const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;

export interface FourHContext {
    /** How far price sat from the 4H EMA200 when the 15M range confirmed, in 4H-ATR units — signed positive above, negative below, NOT yet oriented to the range's own direction (that's alignedWithTrend below). */
    price4hEmaDistanceAtr: number;
    /** True if the 15M range's own direction agrees with "price above/below the 4H EMA200" — LONG+above or SHORT+below. */
    alignedWith4hTrend: boolean;
    /** True if the most recent CLOSED 4H candle's direction agrees with the 15M range's own direction. */
    alignedWith4hCandle: boolean;
    /** Consecutive same-direction 4H candles (momentum persistence), signed positive when that momentum agrees with the 15M range's own direction, negative when it opposes it — so the model sees "momentum FOR this trade" vs "momentum AGAINST it" directly, not just a raw streak length. */
    fourHMomentumForDirection: number;
    fourHOiExpanding: boolean;
    /** How large the most recent closed 4H candle was relative to its own ATR — was the broader timeframe itself in a displacement, or quiet. */
    fourHRangeAtrRatio: number;
}

/**
 * Finds the most recent 4H candle that had FULLY CLOSED (openTime +
 * 4H duration <= the reference time) — the causal boundary. Assumes
 * candles4h is sorted ascending by openTime, which it is straight from
 * the data source.
 */
function findClosedFourHCandle(candles4h: CandleInfo[], atOrBefore: number): CandleInfo | null {
    let result: CandleInfo | null = null;
    for (const c of candles4h) {
        if (c.openTime + FOUR_HOUR_MS <= atOrBefore) result = c;
        else break;
    }
    return result;
}

export function extractFourHContext(candles15m: CandleInfo[], candles4h: CandleInfo[], range: PointCandleRange): FourHContext | null {
    const rangeEndCandle = candles15m[range.endGi];
    if (!rangeEndCandle) return null;

    const fourHCandle = findClosedFourHCandle(candles4h, range.endOpenTime);
    if (!fourHCandle) return null; // not enough 4H history yet at this point in time
    if (!fourHCandle.candleStructure || !fourHCandle.openInterest || fourHCandle.atr <= 0) return null;

    const isLong = range.direction === "LONG";
    const priceAtConfirm = rangeEndCandle.close;
    const emaDistance = (priceAtConfirm - fourHCandle.ema200) / fourHCandle.atr;
    const priceAboveEma = priceAtConfirm > fourHCandle.ema200;

    const fourHBullish = fourHCandle.candleStructure.isBullish;
    const fourHBearish = fourHCandle.candleStructure.isBearish;
    const rawStreak = fourHBullish ? fourHCandle.candleStructure.consecutiveBullish : fourHBearish ? fourHCandle.candleStructure.consecutiveBearish : 0;
    const momentumAgreesWithRange = (isLong && fourHBullish) || (!isLong && fourHBearish);

    return {
        price4hEmaDistanceAtr: emaDistance,
        alignedWith4hTrend: isLong ? priceAboveEma : !priceAboveEma,
        alignedWith4hCandle: (isLong && fourHBullish) || (!isLong && fourHBearish),
        fourHMomentumForDirection: momentumAgreesWithRange ? rawStreak : -rawStreak,
        fourHOiExpanding: fourHCandle.openInterest.state === "RISING" || fourHCandle.openInterest.state === "EXPANDING",
        fourHRangeAtrRatio: fourHCandle.candleStructure.rangeAtrRatio,
    };
}

export const FOUR_H_FEATURE_NAMES = [
    "price4hEmaDistanceAtr",
    "alignedWith4hTrend",
    "alignedWith4hCandle",
    "fourHMomentumForDirection",
    "fourHOiExpanding",
    "fourHRangeAtrRatio",
] as const;

export function fourHContextToRow(f: FourHContext): number[] {
    return [
        f.price4hEmaDistanceAtr,
        f.alignedWith4hTrend ? 1 : 0,
        f.alignedWith4hCandle ? 1 : 0,
        f.fourHMomentumForDirection,
        f.fourHOiExpanding ? 1 : 0,
        f.fourHRangeAtrRatio,
    ];
}