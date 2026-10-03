import type { CandleInfo, PriceZoneState, PRICE_ZONE_EVENT, ZONE_OPEN_TYPE, PriceActionZoneContext } from "@/core/interfacesv2";

// #####################################################################
// PRICE ZONE STATE - the current zone SESSION's story, candle by candle.
//
// A session is one price-zone period (00/06/12/18 PHT; 24 candles on 15m).
// Its zone is the prior range (PriceZoneUtility.generatePrizeZone); this adds
// what happened inside the session against it, in Market Profile terms:
// session-to-date range and VWAP, time at price, edge touches / rejections,
// the first-hour initial balance and its extension, Dalton's opening type,
// the zone event on this candle, the 80%-rule re-entry context, and the
// previous session's volume value area.
//
// MEASURED BEFORE BUILT (41k Binance 15m sessions, 16 perps, Jan 2025 - Oct
// 2026, odd/even months, three threshold settings - see the type docs in
// interfacesv2.ts). What carried information: OPEN_TEST_DRIVE extremes (47% hold
// vs 40% for the IB-close rule), narrow IB -> trend, re-entry -> far edge (+14
// pts over random, still negative R). What did NOT: open location vs the range
// zone (always inside on a 24/7 market), Dalton day types, failed-auction fades,
// acceptance follow-through. The fields are descriptive; none is an entry.
//
// INCREMENTAL AND CAUSAL. Each candle's state is built from the previous
// candle's state plus this candle - O(1) per candle - and reads nothing after
// it. Passing the previous state in (rather than re-scanning the session) keeps
// a resumed walk identical to a full one.
// #####################################################################

/** Tolerance for "reaches the edge" / "beyond the edge", in session ATRs. */
const EDGE_TOL_ATR = 0.1;
/** Initial balance = the session's first hour. */
const IB_CANDLES = 4;
/** Opening range for the opening type = the first 30 minutes. */
const OR_CANDLES = 2;
/** The IB close must be this far from the open (session ATRs) for a drive / test drive / reversal. */
const OPEN_TYPE_MOVE_ATR = 0.5;
/** Consecutive closes outside = acceptance. */
const ACCEPT_CLOSES = 2;
/** Consecutive closes back inside that arm the 80% re-entry (two 30-min periods). */
const REENTRY_CLOSES = 4;
/** Within this many session ATRs of an edge / the mid counts as AT it. */
const AT_LEVEL_ATR = 0.25;
/** Value-area buckets and coverage. */
const VA_BUCKETS = 40;
const VA_COVERAGE = 0.7;

/**
 * The previous session's volume value area: each candle's volume spread evenly
 * over its low..high, the highest-volume bucket is the POC, and the area grows
 * to the side with more volume until it holds 70%.
 */
export function volumeValueArea(candles: CandleInfo[]): { lower: number; upper: number; poc: number } | null {
    if (candles.length < 2) return null;
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
    if (!(hi > lo)) return null;
    const step = (hi - lo) / VA_BUCKETS;
    const bins = new Array<number>(VA_BUCKETS).fill(0);
    for (const c of candles) {
        const a = Math.max(0, Math.floor((c.low - lo) / step));
        const b = Math.min(VA_BUCKETS - 1, Math.floor((c.high - lo) / step));
        const share = (c.volume || 0) / (b - a + 1);
        for (let k = a; k <= b; k++) bins[k] += share;
    }
    let poc = 0;
    for (let k = 1; k < VA_BUCKETS; k++) if (bins[k] > bins[poc]) poc = k;
    const total = bins.reduce((x, y) => x + y, 0);
    if (!(total > 0)) return null;
    let a = poc, b = poc, acc = bins[poc];
    while (acc < VA_COVERAGE * total && (a > 0 || b < VA_BUCKETS - 1)) {
        const up = b < VA_BUCKETS - 1 ? bins[b + 1] : -1;
        const dn = a > 0 ? bins[a - 1] : -1;
        if (up >= dn) acc += bins[++b]; else acc += bins[--a];
    }
    return { lower: lo + a * step, upper: lo + (b + 1) * step, poc: lo + (poc + 0.5) * step };
}

const vsRange = (price: number, r: { lower: number; upper: number } | null): 'ABOVE' | 'BELOW' | 'INSIDE' | null =>
    !r ? null : price > r.upper ? 'ABOVE' : price < r.lower ? 'BELOW' : 'INSIDE';

/**
 * This candle's PriceZoneState.
 *
 * @param movingCandles  every candle up to and including this one
 * @param prev           the previous candle's state, or null at a session start / window start
 * @param sessionStart   this candle opens a new zone session (PRICEZONE_START)
 */
export function getPriceZoneState(
    movingCandles: CandleInfo[],
    prev: PriceZoneState | null | undefined,
    sessionStart: boolean
): PriceZoneState | null {
    const i = movingCandles.length - 1;
    const c = movingCandles[i];
    const zone = c.priceZone;
    if (!zone || !(zone.upper > zone.lower)) return null;

    const fresh = sessionStart || !prev;
    // The session's ATR unit: the candle before the session (known at its open),
    // falling back to this candle's when there is none.
    const sessionAtr = fresh
        ? ((movingCandles[i - 1]?.atr ?? 0) > 0 ? movingCandles[i - 1].atr : c.atr)
        : prev!.sessionAtr;
    const atr = sessionAtr > 0 ? sessionAtr : (c.atr > 0 ? c.atr : 0);
    const tol = EDGE_TOL_ATR * atr;

    const base: PriceZoneState = fresh
        ? {
            sessionCandle: 0, partialSession: !sessionStart, sessionStartOpenTime: c.openTime, sessionAtr: atr,
            sessionOpen: c.open, sessionHigh: -Infinity, sessionLow: Infinity, sessionRangeAtr: 0, rangeVsZone: 0,
            sessionVwap: c.close, closeVsVwapAtr: 0,
            candlesAbove: 0, candlesInside: 0, candlesBelow: 0,
            touchesUpper: 0, touchesLower: 0, rejectionsUpper: 0, rejectionsLower: 0, midCrosses: 0,
            closesAbove: 0, closesBelow: 0,
            orHigh: -Infinity, orLow: Infinity,
            ibHigh: -Infinity, ibLow: Infinity, ibComplete: false, ibWidthAtr: 0, ibCloseDirection: null,
            ibExtension: 'NONE', ibExtensionUpX: 0, ibExtensionDownX: 0,
            openType: null, openTypeDirection: null, openTypeExtreme: null, openTypeExtremeHeld: null,
            event: 'NONE', reentry: null,
            // The PREVIOUS session = the 24 candles before this one.
            valueArea: volumeValueArea(movingCandles.slice(Math.max(0, i - 24), i)),
            vsValueArea: null, sessionOpenVsValueArea: null,
            vwapPriceVolume: 0, vwapVolume: 0,
            tradedAboveZone: false, tradedBelowZone: false, excursionHigh: null, excursionLow: null, insideRun: 0,
        }
        : { ...prev!, reentry: prev!.reentry ? { ...prev!.reentry } : null };
    const s = base;
    if (fresh) s.sessionOpenVsValueArea = vsRange(c.open, s.valueArea);

    // ── session to date ──
    s.sessionCandle += 1;
    s.sessionHigh = Math.max(s.sessionHigh, c.high);
    s.sessionLow = Math.min(s.sessionLow, c.low);
    s.sessionRangeAtr = atr > 0 ? (s.sessionHigh - s.sessionLow) / atr : 0;
    s.rangeVsZone = (s.sessionHigh - s.sessionLow) / (zone.upper - zone.lower);
    const typical = (c.high + c.low + c.close) / 3;
    s.vwapPriceVolume += typical * (c.volume || 0);
    s.vwapVolume += c.volume || 0;
    s.sessionVwap = s.vwapVolume > 0 ? s.vwapPriceVolume / s.vwapVolume : typical;
    s.closeVsVwapAtr = atr > 0 ? (c.close - s.sessionVwap) / atr : 0;

    // ── time at price / runs outside ──
    const prevClosesAbove = fresh ? 0 : prev!.closesAbove;
    const prevClosesBelow = fresh ? 0 : prev!.closesBelow;
    const above = c.close > zone.upper, below = c.close < zone.lower, inside = !above && !below;
    if (above) s.candlesAbove++; else if (below) s.candlesBelow++; else s.candlesInside++;
    s.closesAbove = above ? prevClosesAbove + 1 : 0;
    s.closesBelow = below ? prevClosesBelow + 1 : 0;

    // ── edge interactions ──
    const touchUp = c.high >= zone.upper - tol, touchDn = c.low <= zone.lower + tol;
    if (touchUp) s.touchesUpper++;
    if (touchDn) s.touchesLower++;
    const rejectUp = inside && prevClosesAbove === 0 && c.high >= zone.upper + tol;
    const rejectDn = inside && prevClosesBelow === 0 && c.low <= zone.lower - tol;
    if (rejectUp) s.rejectionsUpper++;
    if (rejectDn) s.rejectionsLower++;
    const midUp = c.open < zone.mid && c.close > zone.mid, midDn = c.open > zone.mid && c.close < zone.mid;
    if (midUp || midDn) s.midCrosses++;

    // ── the zone event (priority order) ──
    let event: PRICE_ZONE_EVENT = 'NONE';
    if (above && s.closesAbove === ACCEPT_CLOSES) event = 'ACCEPT_ABOVE';
    else if (below && s.closesBelow === ACCEPT_CLOSES) event = 'ACCEPT_BELOW';
    else if (above && prevClosesAbove === 0) event = 'BREAK_UP';
    else if (below && prevClosesBelow === 0) event = 'BREAK_DOWN';
    else if (!above && prevClosesAbove >= ACCEPT_CLOSES && inside) event = 'REENTRY_FROM_ABOVE';
    else if (!below && prevClosesBelow >= ACCEPT_CLOSES && inside) event = 'REENTRY_FROM_BELOW';
    else if (!above && prevClosesAbove > 0) event = 'FAILED_BREAK_UP';
    else if (!below && prevClosesBelow > 0) event = 'FAILED_BREAK_DOWN';
    else if (rejectUp) event = 'REJECT_UPPER';
    else if (rejectDn) event = 'REJECT_LOWER';
    else if (inside && touchUp) event = 'TEST_UPPER';
    else if (inside && touchDn) event = 'TEST_LOWER';
    else if (midUp) event = 'MID_RECLAIM';
    else if (midDn) event = 'MID_LOSS';
    s.event = event;

    // ── initial balance and opening type ──
    if (s.partialSession) {
        // No real first hour to measure - IB / opening type stay unset.
    } else if (s.sessionCandle <= IB_CANDLES) {
        s.ibHigh = Math.max(s.ibHigh, c.high);
        s.ibLow = Math.min(s.ibLow, c.low);
        if (s.sessionCandle <= OR_CANDLES) {
            s.orHigh = Math.max(s.orHigh, c.high);
            s.orLow = Math.min(s.orLow, c.low);
        }
        if (s.sessionCandle === IB_CANDLES) {
            s.ibComplete = true;
            const t = classifyOpen(s.sessionOpen, { high: s.orHigh, low: s.orLow }, s.ibHigh, s.ibLow, c.close, atr);
            s.openType = t.type; s.openTypeDirection = t.direction; s.openTypeExtreme = t.extreme;
            s.openTypeExtremeHeld = t.extreme == null ? null : true;
            s.ibCloseDirection = c.close >= (s.ibHigh + s.ibLow) / 2 ? 'UP' : 'DOWN';
        }
    } else if (s.openTypeExtreme != null && s.openTypeExtremeHeld) {
        s.openTypeExtremeHeld = s.openTypeDirection === 'UP' ? c.low >= s.openTypeExtreme : c.high <= s.openTypeExtreme;
    }
    s.ibWidthAtr = atr > 0 && Number.isFinite(s.ibHigh) ? (s.ibHigh - s.ibLow) / atr : 0;
    if (s.ibComplete) {
        const w = s.ibHigh - s.ibLow;
        s.ibExtensionUpX = w > 0 ? Math.max(0, s.sessionHigh - s.ibHigh) / w : 0;
        s.ibExtensionDownX = w > 0 ? Math.max(0, s.ibLow - s.sessionLow) / w : 0;
        s.ibExtension = s.ibExtensionUpX > 0 && s.ibExtensionDownX > 0 ? 'BOTH'
            : s.ibExtensionUpX > 0 ? 'UP' : s.ibExtensionDownX > 0 ? 'DOWN' : 'NONE';
    }

    // ── 80% re-entry context ──
    if (c.high > zone.upper) { s.tradedAboveZone = true; s.excursionHigh = s.excursionHigh == null ? c.high : Math.max(s.excursionHigh, c.high); }
    if (c.low < zone.lower) { s.tradedBelowZone = true; s.excursionLow = s.excursionLow == null ? c.low : Math.min(s.excursionLow, c.low); }
    const outsideNow = c.high > zone.upper || c.low < zone.lower;
    s.insideRun = inside && !outsideNow ? s.insideRun + 1 : 0;
    if (s.reentry && !s.reentry.targetHit) {
        s.reentry.targetHit = s.reentry.from === 'ABOVE' ? c.low <= s.reentry.target : c.high >= s.reentry.target;
    }
    if (s.insideRun === REENTRY_CLOSES) {
        if (s.tradedAboveZone && c.close > zone.mid) s.reentry = { from: 'ABOVE', target: zone.lower, excursionExtreme: s.excursionHigh, triggeredOpenTime: c.openTime, targetHit: false };
        else if (s.tradedBelowZone && c.close < zone.mid) s.reentry = { from: 'BELOW', target: zone.upper, excursionExtreme: s.excursionLow, triggeredOpenTime: c.openTime, targetHit: false };
    }

    s.vsValueArea = vsRange(c.close, s.valueArea);
    return s;
}

/**
 * Dalton's opening types on the first hour, with the thresholds measured in
 * the study: a move of OPEN_TYPE_MOVE_ATR from the open by the IB close, and
 * EDGE_TOL_ATR as "did not trade back through the open".
 */
function classifyOpen(
    open: number, or: { high: number; low: number }, ibHigh: number, ibLow: number, ibClose: number, atr: number
): { type: ZONE_OPEN_TYPE; direction: 'UP' | 'DOWN' | null; extreme: number | null } {
    const k = OPEN_TYPE_MOVE_ATR * atr, tol = EDGE_TOL_ATR * atr;
    if (open - ibLow <= tol && ibClose - open >= k) return { type: 'OPEN_DRIVE', direction: 'UP', extreme: ibLow };
    if (ibHigh - open <= tol && open - ibClose >= k) return { type: 'OPEN_DRIVE', direction: 'DOWN', extreme: ibHigh };
    if (or.low < open - tol && ibClose - open >= k && ibHigh > or.high) return { type: 'OPEN_TEST_DRIVE', direction: 'UP', extreme: ibLow };
    if (or.high > open + tol && open - ibClose >= k && ibLow < or.low) return { type: 'OPEN_TEST_DRIVE', direction: 'DOWN', extreme: ibHigh };
    if (or.high - open >= k && ibClose < open - tol) return { type: 'OPEN_REJECTION_REVERSE', direction: 'DOWN', extreme: or.high };
    if (open - or.low >= k && ibClose > open + tol) return { type: 'OPEN_REJECTION_REVERSE', direction: 'UP', extreme: or.low };
    return { type: 'OPEN_AUCTION', direction: null, extreme: null };
}

/** Where a candle's close sits vs its zone, for priceAction.zone. */
export function priceActionZoneContext(c: CandleInfo, state: PriceZoneState | null | undefined): PriceActionZoneContext | null {
    const z = c.priceZone;
    if (!z || !state) return null;
    const near = AT_LEVEL_ATR * (state.sessionAtr || c.atr || 0);
    const location: PriceActionZoneContext['location'] =
        c.close > z.upper + near ? 'ABOVE'
        : c.close < z.lower - near ? 'BELOW'
        : Math.abs(c.close - z.upper) <= near ? 'AT_UPPER'
        : Math.abs(c.close - z.lower) <= near ? 'AT_LOWER'
        : Math.abs(c.close - z.mid) <= near ? 'AT_MID'
        : 'INSIDE';
    return { location, event: state.event };
}
