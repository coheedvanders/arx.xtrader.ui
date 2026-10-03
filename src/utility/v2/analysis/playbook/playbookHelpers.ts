import type { CandleInfo } from "@/core/interfacesv2";

// #####################################################################
// PLAYBOOK HELPERS - causal derived features and the regime.
// Every function reads only candles[gi-499 .. gi] (the bot's 500-candle window).
// Mirrors playbook/pipeline/features.py exactly (same lookbacks, same tie rules).
// #####################################################################

export const WINDOW = 500;
export const UNIT_N = 32;          // U = mean true range of the last 32 candles
export const RANK_N = 480;         // window-relative percentile lookback
export const REG_MEM = 48;         // regime hysteresis memory
export const SW_MAX = 449;         // swing visible if confirmed <= 449 candles ago (47 + 449 + 2 <= 500 for the regime)

export type Side = "LONG" | "SHORT";
export type Regime = "BULL" | "BEAR" | "RANGE";

export interface LimitOrderDecision {
    side: Side;
    limitPrice: number;
    sl: number;
    tp: number;
    expiryCandles: number;
    maxHoldCandles: number;
    setup: string;
}

const lo = (gi: number) => Math.max(0, gi - WINDOW + 1);
const has = (c: CandleInfo, tag: string) => (c.conditions_met ?? []).includes(tag);
const hasPattern = (c: CandleInfo, ...p: string[]) => (c.candleStructure?.patterns ?? []).some((x) => p.includes(x));
export { has, hasPattern };

export function trueRange(candles: CandleInfo[], i: number): number {
    const pc = i > 0 ? candles[i - 1].close : candles[i].close;
    return Math.max(candles[i].high, pc) - Math.min(candles[i].low, pc);
}

/** U: mean true range over the last 32 candles (incl. gi). The unit every offset/SL/TP uses. */
export function unitU(candles: CandleInfo[], gi: number): number {
    if (gi - UNIT_N + 1 < Math.max(1, lo(gi))) return NaN;
    let s = 0;
    for (let i = gi - UNIT_N + 1; i <= gi; i++) s += trueRange(candles, i);
    return s / UNIT_N;
}

/** pandas rolling(n).rank(pct=True) of the current value (average method for ties). */
export function rollRankPct(values: (i: number) => number, gi: number, n: number): number {
    if (gi - n + 1 < lo(gi)) return NaN;
    const x = values(gi);
    let less = 0, eq = 0;
    for (let i = gi - n + 1; i <= gi; i++) {
        const v = values(i);
        if (v < x) less++; else if (v === x) eq++;
    }
    return (less + (eq + 1) / 2) / n;
}

export const volRank = (candles: CandleInfo[], gi: number, n: number) => rollRankPct((i) => candles[i].volume, gi, n);

/** (close - SMA(close,20)) / U */
export function stretch20(candles: CandleInfo[], gi: number): number {
    if (gi - 19 < lo(gi)) return NaN;
    let s = 0;
    for (let i = gi - 19; i <= gi; i++) s += candles[i].close;
    return (candles[gi].close - s / 20) / unitU(candles, gi);
}

/** position of close inside the 96-candle (1 day) high-low range, 0..1 */
export function donchian96(candles: CandleInfo[], gi: number): number {
    if (gi - 95 < lo(gi)) return NaN;
    let hh = -Infinity, ll = Infinity;
    for (let i = gi - 95; i <= gi; i++) { hh = Math.max(hh, candles[i].high); ll = Math.min(ll, candles[i].low); }
    return (candles[gi].close - ll) / Math.max(hh - ll, 1e-300);
}

/**
 * Consolidation box with an ADAPTIVE lookback, measured at candle `at`:
 * N = the largest N in [1,96] such that the high-low range of the N candles BEFORE `at`
 * is <= 2.5 * U(at). Returns { n: N (0 if none), high, low }.
 */
export function consolidationBox(candles: CandleInfo[], at: number): { n: number; high: number; low: number } {
    const U = unitU(candles, at);
    let hh = -Infinity, ll = Infinity, n = 0, bh = NaN, bl = NaN;
    for (let N = 1; N <= 96; N++) {
        const j = at - N;
        if (j < lo(at)) break;
        hh = Math.max(hh, candles[j].high); ll = Math.min(ll, candles[j].low);
        if (hh - ll <= 2.5 * U) { n = N; bh = hh; bl = ll; } else break;
    }
    return { n, high: bh, low: bl };
}

/** Last CONFIRMED swing high / low (tag on t confirms the swing at t-2; price usable from t). */
export function lastSwing(candles: CandleInfo[], gi: number, kind: "HIGH" | "LOW"): { price: number; type: 1 | -1; age: number } | null {
    const tags = kind === "HIGH" ? ["CONFIRMATION_HH", "CONFIRMATION_LH"] : ["CONFIRMATION_HL", "CONFIRMATION_LL"];
    for (let t = gi; t >= Math.max(lo(gi), gi - SW_MAX); t--) {
        const c = candles[t];
        const isA = has(c, tags[0]), isB = has(c, tags[1]);
        if (isA || isB) {
            if (t - 2 < 0) return null;
            return { price: kind === "HIGH" ? candles[t - 2].high : candles[t - 2].low, type: isA ? 1 : -1, age: gi - t };
        }
    }
    return null;
}

/** +1 when last swing high is HH and last swing low HL, -1 when LH and LL, else 0. */
export function structure(candles: CandleInfo[], gi: number): number {
    const h = lastSwing(candles, gi, "HIGH"), l = lastSwing(candles, gi, "LOW");
    if (!h || !l) return 0;
    if (h.type === 1 && l.type === 1) return 1;
    if (h.type === -1 && l.type === -1) return -1;
    return 0;
}

/** as-of trend snapshot from extras: ["TREND_SNAPSHOT", dir, startGi, endGi, confirmedOpenTime, json, "<i>"]. */
export function trendSnapshot(candles: CandleInfo[], gi: number) {
    const e = candles[gi].extras ?? [];
    if (e[0] !== "TREND_SNAPSHOT") return null;
    const dir = e[1] === "UP" ? 1 : e[1] === "DOWN" ? -1 : 0;
    // indices in the snapshot share a frame with e[6] (this candle) -> map to our array
    const shift = gi - Number(e[6]);
    const start = Number(e[2]) + shift, end = Number(e[3]) + shift;
    const confOpen = Number(e[4]);
    let ageConf = NaN;
    for (let i = gi; i >= lo(gi); i--) if (candles[i].openTime <= confOpen) { ageConf = candles[i].openTime === confOpen ? gi - i : NaN; break; }
    const ok = start >= lo(gi) && start <= gi;
    const U = unitU(candles, gi);
    const s0 = ok ? candles[start].close : NaN, ex = ok && end >= lo(gi) ? candles[end].close : NaN;
    const leg = Math.abs(ex - s0);
    const c = candles[gi].close;
    return {
        dir, ageStart: ok ? gi - start : NaN, ageConf,
        legU: ok ? leg / U : NaN,
        retrace: ok && leg > 0 ? (dir > 0 ? ex - c : c - ex) / leg : NaN,
    };
}

/** regime score at candle i: 4 causal votes in {-1,0,1}. */
export function regimeScore(candles: CandleInfo[], i: number): number {
    const c = candles[i];
    const dEma = (c.close - c.ema200) / c.ema200 * 100;
    const vEma = dEma > 1.0 ? 1 : dEma < -1.0 ? -1 : 0;           // EMA200 with a 1% margin (ema200 is approximate)
    let vSlope = 0;
    if (i - 96 >= 0) {
        const sl = (c.ema200 - candles[i - 96].ema200) / c.ema200 * 100;
        vSlope = sl > 0.5 ? 1 : sl < -0.5 ? -1 : 0;
    }
    const e = c.extras ?? [];
    const vTr = e[1] === "UP" ? 1 : e[1] === "DOWN" ? -1 : 0;
    return vEma + vSlope + vTr + structure(candles, i);
}

/**
 * REGIME (bounded hysteresis): find the most recent candle in the last 48 (incl. gi) with |score| >= 3.
 * BULL if that score was >= 3 and every score since then (incl. gi) stayed >= 1; BEAR mirrored; else RANGE.
 */
export function regime(candles: CandleInfo[], gi: number): Regime {
    const sc: number[] = [];
    for (let i = gi; i >= Math.max(lo(gi), gi - REG_MEM + 1); i--) {
        const s = regimeScore(candles, i);
        sc.push(s);
        if (Math.abs(s) >= 3) {
            if (s >= 3 && sc.every((x) => x >= 1)) return "BULL";
            if (s <= -3 && sc.every((x) => x <= -1)) return "BEAR";
            return "RANGE";
        }
    }
    return "RANGE";
}

/** Order validity of section 5 (RR > 1, limit beyond close, min stop, < 5% stop). */
export function validOrder(o: LimitOrderDecision, close: number, tick: number): boolean {
    const { side, limitPrice: L, sl, tp } = o;
    if (![L, sl, tp].every(Number.isFinite)) return false;
    if (side === "LONG" && !(L < close && sl < L && L < tp)) return false;
    if (side === "SHORT" && !(L > close && tp < L && L < sl)) return false;
    const risk = Math.abs(L - sl);
    if (!(Math.abs(tp - L) / risk > 1)) return false;
    if (risk < 3 * ((0.0002 + 0.0005) * L + tick)) return false;
    if (risk / L >= 0.05) return false;
    return true;
}

/** Build a limit order from an anchor price and U multiples. */
export function makeOrder(setup: string, side: Side, anchor: number, U: number, off: number, slU: number, rr: number,
                          expiryCandles: number, maxHoldCandles: number): LimitOrderDecision {
    const s = side === "LONG" ? 1 : -1;
    const limitPrice = anchor - s * off * U;
    const sl = limitPrice - s * slU * U;
    const tp = limitPrice + s * rr * slU * U;
    return { side, limitPrice, sl, tp, expiryCandles, maxHoldCandles, setup };
}

/** window rank (pandas pct, 448 candles) of U/close - the volatility regime of this symbol. */
export function unitPctRank(candles: CandleInfo[], gi: number): number {
    const N = 448;   // 448 ranks of a 32-candle U (+1 previous close) stay inside the 500 window
    if (gi - N + 1 - UNIT_N < lo(gi)) return NaN;
    const cache = new Map<number, number>();
    const f = (i: number) => { let v = cache.get(i); if (v === undefined) { v = unitU(candles, i) / candles[i].close; cache.set(i, v); } return v; };
    return rollRankPct(f, gi, N);
}

/** hour of the candle open in PHT (UTC+8). */
export const hourPHT = (c: CandleInfo) => (Math.floor(c.openTime / 3600000) + 8) % 24;
