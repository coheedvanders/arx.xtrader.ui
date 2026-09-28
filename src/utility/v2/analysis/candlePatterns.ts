// Named candlestick patterns for the LAST candle of `candles`.
//
// Causal: reads at most the last 3 candles plus a 5-candle lookback for
// trend context, never anything after the current candle.
//
// CRYPTO ADAPTATION. The textbook definitions of piercing line, dark cloud
// cover and the stars require price GAPS between sessions. Crypto trades
// 24/7, so each candle opens at (almost exactly) the previous close and those
// gaps never happen - requiring them would mean the patterns never fire. The
// gap conditions are dropped; the body relationships are kept.
//
// TREND CONTEXT. Hammer vs hanging man and inverted hammer vs shooting star
// are the SAME shape; only the move before them differs. "Prior trend" here =
// close[i-1] vs close[i-6], in ATR: >= +TREND_ATR is up, <= -TREND_ATR down.
//
// Thresholds are the conventional textbook ratios, not calibrated.

import type { CandleInfo } from "@/core/interfacesv2";

export type CandlePattern =
    // single candle
    | "DOJI"
    | "DRAGONFLY_DOJI"
    | "GRAVESTONE_DOJI"
    | "LONG_LEGGED_DOJI"
    | "SPINNING_TOP"
    | "BULLISH_MARUBOZU"
    | "BEARISH_MARUBOZU"
    | "HAMMER"
    | "HANGING_MAN"
    | "INVERTED_HAMMER"
    | "SHOOTING_STAR"
    // two candles
    | "BULLISH_ENGULFING"
    | "BEARISH_ENGULFING"
    | "BULLISH_HARAMI"
    | "BEARISH_HARAMI"
    | "PIERCING_LINE"
    | "DARK_CLOUD_COVER"
    | "TWEEZER_BOTTOM"
    | "TWEEZER_TOP"
    | "INSIDE_BAR"
    | "OUTSIDE_BAR"
    // three candles
    | "MORNING_STAR"
    | "EVENING_STAR"
    | "THREE_WHITE_SOLDIERS"
    | "THREE_BLACK_CROWS";

/** Which way each pattern points, for colouring and filtering. */
export const CANDLE_PATTERN_BIAS: Record<CandlePattern, "BULLISH" | "BEARISH" | "NEUTRAL"> = {
    DOJI: "NEUTRAL", DRAGONFLY_DOJI: "BULLISH", GRAVESTONE_DOJI: "BEARISH", LONG_LEGGED_DOJI: "NEUTRAL",
    SPINNING_TOP: "NEUTRAL", BULLISH_MARUBOZU: "BULLISH", BEARISH_MARUBOZU: "BEARISH",
    HAMMER: "BULLISH", HANGING_MAN: "BEARISH", INVERTED_HAMMER: "BULLISH", SHOOTING_STAR: "BEARISH",
    BULLISH_ENGULFING: "BULLISH", BEARISH_ENGULFING: "BEARISH", BULLISH_HARAMI: "BULLISH", BEARISH_HARAMI: "BEARISH",
    PIERCING_LINE: "BULLISH", DARK_CLOUD_COVER: "BEARISH", TWEEZER_BOTTOM: "BULLISH", TWEEZER_TOP: "BEARISH",
    INSIDE_BAR: "NEUTRAL", OUTSIDE_BAR: "NEUTRAL",
    MORNING_STAR: "BULLISH", EVENING_STAR: "BEARISH", THREE_WHITE_SOLDIERS: "BULLISH", THREE_BLACK_CROWS: "BEARISH",
};

const P = {
    DOJI_BODY: 0.10,            // body <= 10% of range
    DOJI_SHORT_WICK: 0.10,      // dragonfly / gravestone: the missing wick
    DOJI_LONG_WICK: 0.60,       // dragonfly / gravestone: the long wick
    LONG_LEGGED_WICK: 0.30,     // both wicks >= 30%
    SPINNING_BODY_MAX: 0.30,    // spinning top body 10-30% of range
    SPINNING_WICK_MIN: 0.25,    // both wicks >= 25%
    MARUBOZU_BODY: 0.90,        // body >= 90% of range
    PIN_BODY_MAX: 0.35,         // hammer family: small body
    PIN_WICK_MIN: 0.55,         // long wick >= 55% of range ...
    PIN_WICK_VS_BODY: 2.0,      // ... and >= 2x the body
    PIN_OTHER_WICK_MAX: 0.15,   // the other wick nearly absent
    MIN_RANGE_ATR: 0.3,         // ignore candles too small to mean anything
    LONG_BODY_ATR: 0.6,         // "long" candle body, in ATR
    STAR_BODY_VS_FIRST: 0.35,   // star body <= 35% of the first candle's body
    TWEEZER_TOL_ATR: 0.1,       // matching highs / lows within 0.1 ATR
    TREND_ATR: 1.0,             // prior 5-candle move needed for trend context
};

interface Shape {
    o: number; h: number; l: number; c: number;
    range: number; body: number; top: number; bottom: number;
    upper: number; lower: number; bull: boolean; bear: boolean; mid: number;
}

function shape(k: CandleInfo): Shape {
    const range = k.high - k.low;
    const top = Math.max(k.open, k.close), bottom = Math.min(k.open, k.close);
    return {
        o: k.open, h: k.high, l: k.low, c: k.close,
        range, body: top - bottom, top, bottom,
        upper: k.high - top, lower: bottom - k.low,
        bull: k.close > k.open, bear: k.close < k.open,
        mid: (k.open + k.close) / 2,
    };
}

export function detectCandlePatterns(candles: CandleInfo[]): CandlePattern[] {
    const n = candles.length;
    if (n === 0) return [];
    const cur = candles[n - 1];
    const atr = cur.atr > 0 ? cur.atr : 0;
    const s = shape(cur);
    const out: CandlePattern[] = [];
    if (!(s.range > 0)) return out;

    const big = atr > 0 ? s.range >= P.MIN_RANGE_ATR * atr : true;
    const longBody = (x: Shape) => atr > 0 && x.body >= P.LONG_BODY_ATR * atr;

    let trend: "UP" | "DOWN" | null = null;
    if (n >= 7 && atr > 0) {
        const move = (candles[n - 2].close - candles[n - 7].close) / atr;
        trend = move >= P.TREND_ATR ? "UP" : move <= -P.TREND_ATR ? "DOWN" : null;
    }

    // ── single candle ──
    const bodyR = s.body / s.range, upR = s.upper / s.range, loR = s.lower / s.range;
    if (big) {
        if (bodyR <= P.DOJI_BODY) {
            out.push("DOJI");
            if (upR <= P.DOJI_SHORT_WICK && loR >= P.DOJI_LONG_WICK) out.push("DRAGONFLY_DOJI");
            else if (loR <= P.DOJI_SHORT_WICK && upR >= P.DOJI_LONG_WICK) out.push("GRAVESTONE_DOJI");
            else if (upR >= P.LONG_LEGGED_WICK && loR >= P.LONG_LEGGED_WICK) out.push("LONG_LEGGED_DOJI");
        } else if (bodyR <= P.SPINNING_BODY_MAX && upR >= P.SPINNING_WICK_MIN && loR >= P.SPINNING_WICK_MIN) {
            out.push("SPINNING_TOP");
        }
        if (bodyR >= P.MARUBOZU_BODY) {
            if (s.bull) out.push("BULLISH_MARUBOZU");
            else if (s.bear) out.push("BEARISH_MARUBOZU");
        }
        const pinBody = bodyR > P.DOJI_BODY && bodyR <= P.PIN_BODY_MAX;
        const lowerPin = pinBody && loR >= P.PIN_WICK_MIN && s.lower >= P.PIN_WICK_VS_BODY * s.body && upR <= P.PIN_OTHER_WICK_MAX;
        const upperPin = pinBody && upR >= P.PIN_WICK_MIN && s.upper >= P.PIN_WICK_VS_BODY * s.body && loR <= P.PIN_OTHER_WICK_MAX;
        if (lowerPin && trend === "DOWN") out.push("HAMMER");
        if (lowerPin && trend === "UP") out.push("HANGING_MAN");
        if (upperPin && trend === "DOWN") out.push("INVERTED_HAMMER");
        if (upperPin && trend === "UP") out.push("SHOOTING_STAR");
    }

    // ── two candles ──
    if (n >= 2) {
        const p = shape(candles[n - 2]);
        if (p.bear && s.bull && s.top >= p.top && s.bottom <= p.bottom && s.body > p.body) out.push("BULLISH_ENGULFING");
        if (p.bull && s.bear && s.top >= p.top && s.bottom <= p.bottom && s.body > p.body) out.push("BEARISH_ENGULFING");
        if (longBody(p) && p.bear && s.bull && s.top < p.top && s.bottom > p.bottom) out.push("BULLISH_HARAMI");
        if (longBody(p) && p.bull && s.bear && s.top < p.top && s.bottom > p.bottom) out.push("BEARISH_HARAMI");
        // piercing / dark cloud without the (impossible in crypto) opening gap:
        // closes past the previous body's midpoint but not through it
        if (longBody(p) && p.bear && s.bull && s.c > p.mid && s.c < p.o && s.o <= p.c) out.push("PIERCING_LINE");
        if (longBody(p) && p.bull && s.bear && s.c < p.mid && s.c > p.o && s.o >= p.c) out.push("DARK_CLOUD_COVER");
        if (atr > 0) {
            if (trend === "DOWN" && p.bear && s.bull && Math.abs(s.l - p.l) <= P.TWEEZER_TOL_ATR * atr) out.push("TWEEZER_BOTTOM");
            if (trend === "UP" && p.bull && s.bear && Math.abs(s.h - p.h) <= P.TWEEZER_TOL_ATR * atr) out.push("TWEEZER_TOP");
        }
        if (s.h < p.h && s.l > p.l) out.push("INSIDE_BAR");
        if (s.h > p.h && s.l < p.l) out.push("OUTSIDE_BAR");
    }

    // ── three candles ──
    if (n >= 3) {
        const a = shape(candles[n - 3]), b = shape(candles[n - 2]);
        const smallStar = a.body > 0 && b.body <= P.STAR_BODY_VS_FIRST * a.body;
        if (longBody(a) && a.bear && smallStar && s.bull && s.c > a.mid) out.push("MORNING_STAR");
        if (longBody(a) && a.bull && smallStar && s.bear && s.c < a.mid) out.push("EVENING_STAR");
        const soldier = (x: Shape, prev: Shape) =>
            x.bull && longBody(x) && x.c > prev.c && x.o >= prev.bottom && x.o <= prev.top && x.upper <= 0.3 * x.range;
        const crow = (x: Shape, prev: Shape) =>
            x.bear && longBody(x) && x.c < prev.c && x.o <= prev.top && x.o >= prev.bottom && x.lower <= 0.3 * x.range;
        if (a.bull && longBody(a) && soldier(b, a) && soldier(s, b)) out.push("THREE_WHITE_SOLDIERS");
        if (a.bear && longBody(a) && crow(b, a) && crow(s, b)) out.push("THREE_BLACK_CROWS");
    }

    return out;
}
