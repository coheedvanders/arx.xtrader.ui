// Auction-style balance / imbalance, built on the session priceZone.
//
// Auction Market Theory reads a market as alternating between BALANCE
// (two-sided trade rotating around value) and IMBALANCE (one side takes
// control and price leaves value to find new value). The session priceZone
// plays the role of value here: it is the body-weighted range of the 24
// candles before the session, i.e. where trade actually happened.
//
//   acceptance  price leaves the zone and KEEPS closing out there -> the move
//               is being accepted, value is migrating (imbalance)
//   rejection   price probes beyond the zone and fails back inside -> the
//               other side responded, the market stays in balance
//   migration   the current zone vs the previous one (higher / lower /
//               overlapping / inside / outside) - Market Profile's value-area
//               relationships
//   prior prices where price sits against the previous session's zone and
//               its actual traded high/low, and how one-sided that session was
//
// OHLCV only, so there is no order-flow / delta here: acceptance is measured
// in consecutive closes and time spent outside, not volume at price.
//
// Causal: reads only movingCandles (which ends at the current candle), and
// every zone involved was fixed at its own session start.

import type {
    CandleImbalance,
    CandleInfo,
    DisplacementLeg,
    ImbalanceState,
    IMBALANCE_STATE,
    VALUE_AREA_RELATION,
} from "@/core/interfacesv2";
import type { PriceZone } from "@/core/interfaces";
import { getFairValueGap } from "./imbalance";

const CONFIG = {
    // Consecutive closes outside the zone for the move to count as
    // ACCEPTED. 3 x 15m = 45 minutes of holding outside value. ARBITRARY,
    // uncalibrated - the usual "a few bars / a couple of TPOs" rule.
    ACCEPT_CLOSES: 3,
    // A wick at least this many ATR beyond the zone that closes back inside
    // counts as a rejected probe even if no prior candle closed outside.
    REJECT_WICK_ATR: 0.25,
    // Safety cap on how far back a zone is walked (a 15m zone is 24 candles).
    MAX_WALKBACK: 500,
    // Score weights (sum of the absolute maxima = 100).
    W_LOCATION: 40,
    W_MIGRATION: 25,
    W_PREV_POSITION: 15,
    W_SESSION: 20,
};

// ── Per-candle imbalance score ─────────────────────────────────────────────
// How imbalanced THIS candle is: an abnormally large move (change z-score)
// on abnormal volume (volume z-score), closing far beyond value (the zone)
// in its own direction. Each part saturates at its FULL value.
// Calibrated on 0GUSDT 2026-01-03: the push into the 11:00 PHT peak scores
// 09:45 67, 10:30 80, 10:45 66, 11:00 100. At DETECT_SCORE 60 that is ~1.6
// candles per symbol per day over 30 symbols of Jan-Feb data.
const CANDLE_IMB = {
    CHANGE_Z_FULL: 4,
    VOLUME_Z_FULL: 4,
    DISTANCE_ATR_FULL: 5,
    W_CHANGE: 35,
    W_VOLUME: 30,
    W_DISTANCE: 35,
    DETECT_SCORE: 60,
};

/**
 * Needs the candle's candleStructure, volumeState, outsidePriceZoneMetrics
 * and atr already computed for THIS candle - call after all of them.
 */
export function getCandleImbalance(candle: CandleInfo): CandleImbalance | null {
    const cs = candle.candleStructure, vs = candle.volumeState, m = candle.outsidePriceZoneMetrics;
    if (!cs || !vs || !m || !(candle.atr > 0) || candle.close === candle.open) return null;
    const up = candle.close > candle.open;
    const changeZ = Math.max(0, cs.changePercentageZScore || 0);
    const volumeZ = Math.max(0, vs.dynamicZScore || 0);
    const distanceAtr = up ? Math.max(0, m.fromUpperAtr) : Math.max(0, -m.fromLowerAtr);
    const score = Math.round(
        CANDLE_IMB.W_CHANGE * Math.min(1, changeZ / CANDLE_IMB.CHANGE_Z_FULL)
        + CANDLE_IMB.W_VOLUME * Math.min(1, volumeZ / CANDLE_IMB.VOLUME_Z_FULL)
        + CANDLE_IMB.W_DISTANCE * Math.min(1, distanceAtr / CANDLE_IMB.DISTANCE_ATR_FULL)
    );
    return {
        direction: up ? "BULLISH" : "BEARISH",
        score, changeZ, volumeZ, distanceAtr,
        detected: score >= CANDLE_IMB.DETECT_SCORE,
    };
}

// ── Liquidity void / displacement leg (ICT) ────────────────────────────────
// Calibrated on 0GUSDT 2026-01-03 10:30-11:00 PHT (the leg into the 11:00
// peak) plus 30 symbols of Jan-Feb data: ~1 leg per symbol per day.
const LEG = {
    // Consecutive same-direction candles needed.
    MIN_CANDLES: 3,
    // Each candle's body, in its own ATR.
    MIN_BODY_ATR: 0.4,
    // Close must sit in the outer 40% of the candle's range (small wick
    // against the move).
    MIN_CLOSE_LOCATION: 0.6,
    // How far a leg candle may dip back into the previous candle's range, as
    // a share of that range. NOT applied to the leg's first candle - the
    // launch candle always starts from the prior price action.
    MAX_OVERLAP: 0.6,
    // Whole leg, first open to last close, in ATR.
    MIN_MOVE_ATR: 1.5,
    // Safety cap on how far back a leg is walked.
    MAX_WALKBACK: 50,
};

function isLegCandle(c: CandleInfo, p: CandleInfo | undefined, dir: 1 | -1, isFirst: boolean): boolean {
    if (!p || !(c.atr > 0)) return false;
    if ((c.close - c.open) * dir < LEG.MIN_BODY_ATR * c.atr) return false;
    const range = c.high - c.low;
    if (!(range > 0)) return false;
    const closeLoc = (c.close - c.low) / range;
    if (dir === 1 ? closeLoc < LEG.MIN_CLOSE_LOCATION : closeLoc > 1 - LEG.MIN_CLOSE_LOCATION) return false;
    if ((c.close - p.close) * dir <= 0) return false;              // makes progress
    if (isFirst) return true;
    const pr = p.high - p.low;
    const overlap = dir === 1 ? p.high - c.low : c.high - p.low;
    return !(pr > 0) || overlap / pr <= LEG.MAX_OVERLAP;
}

/**
 * The displacement leg ENDING on the last candle of movingCandles, or null.
 * Walks back from the current candle while candles qualify, so it is
 * stateless (safe across resumed runs) and causal.
 */
export function getDisplacementLeg(movingCandles: CandleInfo[]): DisplacementLeg | null {
    const n = movingCandles.length;
    if (n < LEG.MIN_CANDLES + 1) return null;
    const last = movingCandles[n - 1];
    if (!(last.atr > 0)) return null;

    for (const dir of [1, -1] as const) {
        let count = 0;
        let k = n - 1;
        const stop = Math.max(1, n - LEG.MAX_WALKBACK);
        for (; k >= stop; k--) {
            const c = movingCandles[k], p = movingCandles[k - 1];
            if (isLegCandle(c, p, dir, false)) { count++; continue; }
            if (isLegCandle(c, p, dir, true)) count++;                // the launch candle ends the walk
            break;
        }
        if (count < LEG.MIN_CANDLES) continue;
        const startIdx = n - count;
        const first = movingCandles[startIdx];
        const moveAtr = (last.close - first.open) * dir / last.atr;
        if (moveAtr < LEG.MIN_MOVE_ATR) continue;

        let low = Infinity, high = -Infinity, gaps = 0;
        for (let j = startIdx; j < n; j++) {
            low = Math.min(low, movingCandles[j].low);
            high = Math.max(high, movingCandles[j].high);
            if (j >= 2 && (dir === 1 ? movingCandles[j - 2].high < movingCandles[j].low : movingCandles[j - 2].low > movingCandles[j].high)) gaps++;
        }
        const z = last.priceZone;
        const vsZone: DisplacementLeg["vsZone"] = !z ? "INSIDE" : last.close > z.upper ? "ABOVE" : last.close < z.lower ? "BELOW" : "INSIDE";
        return {
            direction: dir === 1 ? "BULLISH" : "BEARISH",
            candles: count, moveAtr, low, high,
            startOpenTime: first.openTime,
            fairValueGaps: gaps,
            vsZone,
        };
    }
    return null;
}

function sameZone(a: PriceZone | null | undefined, b: PriceZone | null | undefined): boolean {
    return !!a && !!b && a.upper === b.upper && a.lower === b.lower && a.mid === b.mid;
}

function valueRelation(cur: PriceZone, prev: PriceZone): VALUE_AREA_RELATION {
    if (cur.lower > prev.upper) return "HIGHER";
    if (cur.upper < prev.lower) return "LOWER";
    if (cur.upper <= prev.upper && cur.lower >= prev.lower) return "INSIDE";
    if (cur.upper >= prev.upper && cur.lower <= prev.lower) return "OUTSIDE";
    return cur.mid > prev.mid ? "OVERLAPPING_HIGHER" : "OVERLAPPING_LOWER";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function getImbalanceState(movingCandles: CandleInfo[]): ImbalanceState | null {
    const n = movingCandles.length;
    if (n === 0) return null;
    const candle = movingCandles[n - 1];
    const zone = candle.priceZone;
    const atr = candle.atr;
    if (!zone || !(atr > 0)) return null;
    const width = zone.upper - zone.lower;
    if (!(width > 0)) return null;

    const reasons: string[] = [];
    const close = candle.close;
    const location: ImbalanceState["location"] =
        close > zone.upper ? "ABOVE" : close < zone.lower ? "BELOW" : "INSIDE";

    // ── walk the current zone's candles (contiguous), newest first ──
    let k = n - 1;
    let sessionCandles = 0, above = 0, below = 0;
    let closesOutside = 0, runOpen = true;
    const limit = Math.max(0, n - CONFIG.MAX_WALKBACK);
    for (; k >= limit && sameZone(movingCandles[k].priceZone, zone); k--) {
        const c = movingCandles[k].close;
        sessionCandles++;
        if (c > zone.upper) above++;
        else if (c < zone.lower) below++;
        // consecutive closes on THIS candle's side, from the current candle back
        if (runOpen) {
            const onSide = location === "ABOVE" ? c > zone.upper : location === "BELOW" ? c < zone.lower : false;
            if (onSide) closesOutside++; else runOpen = false;
        }
    }
    const accepted = closesOutside >= CONFIG.ACCEPT_CLOSES;

    // ── previous zone and the prices traded while it was in force ──
    let prevZone: PriceZone | null = null;
    let prevHigh = -Infinity, prevLow = Infinity, prevAbove = 0, prevBelow = 0, prevCount = 0;
    if (k >= limit && movingCandles[k]?.priceZone) {
        prevZone = movingCandles[k].priceZone!;
        for (; k >= limit && sameZone(movingCandles[k].priceZone, prevZone); k--) {
            const pc = movingCandles[k];
            prevHigh = Math.max(prevHigh, pc.high);
            prevLow = Math.min(prevLow, pc.low);
            if (pc.close > prevZone.upper) prevAbove++;
            else if (pc.close < prevZone.lower) prevBelow++;
            prevCount++;
        }
    }

    // ── rejection on this candle: a probe beyond the zone that failed back ──
    const prev = n >= 2 ? movingCandles[n - 2] : null;
    const prevClosedAbove = !!prev && sameZone(prev.priceZone, zone) && prev.close > zone.upper;
    const prevClosedBelow = !!prev && sameZone(prev.priceZone, zone) && prev.close < zone.lower;
    const rejectedUp = close <= zone.upper
        && (prevClosedAbove || candle.high - zone.upper >= CONFIG.REJECT_WICK_ATR * atr);
    const rejectedDown = close >= zone.lower
        && (prevClosedBelow || zone.lower - candle.low >= CONFIG.REJECT_WICK_ATR * atr);

    // ── state ──
    let state: IMBALANCE_STATE;
    if (location === "ABOVE") {
        state = accepted ? "IMBALANCE_UP" : "PROBING_UP";
        reasons.push(`${closesOutside} close(s) above zone upper ${zone.upper}` + (accepted ? " - accepted" : " - not yet accepted"));
    } else if (location === "BELOW") {
        state = accepted ? "IMBALANCE_DOWN" : "PROBING_DOWN";
        reasons.push(`${closesOutside} close(s) below zone lower ${zone.lower}` + (accepted ? " - accepted" : " - not yet accepted"));
    } else if (rejectedUp && !rejectedDown) {
        state = "REJECTED_UP";
        reasons.push(prevClosedAbove ? "Closed back inside after closing above the zone" : "Wick above the zone rejected back inside");
    } else if (rejectedDown && !rejectedUp) {
        state = "REJECTED_DOWN";
        reasons.push(prevClosedBelow ? "Closed back inside after closing below the zone" : "Wick below the zone rejected back inside");
    } else {
        state = "BALANCE";
        reasons.push("Close inside the zone");
    }

    // ── previous-zone context ──
    let relation: VALUE_AREA_RELATION = "UNKNOWN";
    let valueShiftAtr: number | null = null;
    let zoneOverlap: number | null = null;
    let positionInPrevZone: number | null = null;
    let prevSessionBias: number | null = null;
    let vsPrevSessionRange: ImbalanceState["vsPrevSessionRange"] = null;
    if (prevZone) {
        const pw = prevZone.upper - prevZone.lower;
        relation = valueRelation(zone, prevZone);
        valueShiftAtr = (zone.mid - prevZone.mid) / atr;
        const ov = Math.max(0, Math.min(zone.upper, prevZone.upper) - Math.max(zone.lower, prevZone.lower));
        const narrow = Math.min(width, pw);
        zoneOverlap = narrow > 0 ? ov / narrow : null;
        positionInPrevZone = pw > 0 ? (close - prevZone.lower) / pw : null;
        prevSessionBias = prevCount > 0 ? (prevAbove - prevBelow) / prevCount : null;
        vsPrevSessionRange = close > prevHigh ? "ABOVE" : close < prevLow ? "BELOW" : "INSIDE";
        reasons.push(`Value ${relation.toLowerCase().replace("_", " ")} vs previous zone (${valueShiftAtr >= 0 ? "+" : ""}${valueShiftAtr.toFixed(2)} ATR)`);
        if (vsPrevSessionRange !== "INSIDE") reasons.push(`Close ${vsPrevSessionRange.toLowerCase()} the previous session's traded range`);
    }

    // ── score ──
    // location / acceptance: full weight when accepted outside, half while
    // probing, a counter-push when a probe was just rejected.
    let sLoc = 0;
    if (state === "IMBALANCE_UP") sLoc = 1;
    else if (state === "IMBALANCE_DOWN") sLoc = -1;
    else if (state === "PROBING_UP") sLoc = 0.5;
    else if (state === "PROBING_DOWN") sLoc = -0.5;
    else if (state === "REJECTED_UP") sLoc = -0.5;
    else if (state === "REJECTED_DOWN") sLoc = 0.5;

    const migration: Record<VALUE_AREA_RELATION, number> = {
        HIGHER: 1, OVERLAPPING_HIGHER: 0.5, INSIDE: 0, OUTSIDE: 0, OVERLAPPING_LOWER: -0.5, LOWER: -1, UNKNOWN: 0,
    };
    const sMig = migration[relation];
    // beyond the previous zone counts, clamped to one zone-width either side
    const sPrev = positionInPrevZone == null ? 0
        : positionInPrevZone > 1 ? clamp(positionInPrevZone - 1, 0, 1)
        : positionInPrevZone < 0 ? -clamp(-positionInPrevZone, 0, 1) : 0;
    const sSession = sessionCandles > 0 ? (above - below) / sessionCandles : 0;

    const score = Math.round(clamp(
        sLoc * CONFIG.W_LOCATION + sMig * CONFIG.W_MIGRATION + sPrev * CONFIG.W_PREV_POSITION + sSession * CONFIG.W_SESSION,
        -100, 100
    ));
    const bias: ImbalanceState["bias"] = score >= 20 ? "BULLISH" : score <= -20 ? "BEARISH" : "NEUTRAL";

    const candleImbalance = getCandleImbalance(candle);
    if (candleImbalance?.detected) {
        reasons.push(`${candleImbalance.direction} imbalance candle: score ${candleImbalance.score} `
            + `(change z ${candleImbalance.changeZ.toFixed(2)}, volume z ${candleImbalance.volumeZ.toFixed(2)}, ${candleImbalance.distanceAtr.toFixed(2)} ATR beyond the zone)`);
    }

    const displacement = getDisplacementLeg(movingCandles);
    if (displacement) {
        reasons.push(`${displacement.direction} displacement: ${displacement.candles} candles, ${displacement.moveAtr.toFixed(2)} ATR, `
            + `void ${displacement.low}-${displacement.high}, ${displacement.fairValueGaps} FVG(s), close ${displacement.vsZone.toLowerCase()} the zone`);
    }

    return {
        state,
        bias,
        score,
        location,
        closesOutside,
        accepted,
        sessionCandles,
        sessionShareAbove: sessionCandles ? above / sessionCandles : 0,
        sessionShareBelow: sessionCandles ? below / sessionCandles : 0,
        valueRelation: relation,
        valueShiftAtr,
        zoneOverlap,
        positionInPrevZone,
        prevSessionBias,
        vsPrevSessionRange,
        fairValueGap: getFairValueGap(movingCandles),
        displacement,
        candleImbalance,
        reasons,
    };
}
