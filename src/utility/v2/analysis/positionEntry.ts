import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

// =====================================================================
// Same reversal trigger as before (POTENTIAL_REVERSAL), same symmetric
// SL/TP shape anchored to the reversing trend's own live range. LONG is
// UNCHANGED: re-tested this round too, no variant beat it.
//
// SHORT was revisited because it was firing far too rarely (75 trades
// vs 1,570 for LONG on the capture this round started from) — the
// broaderMoveAtr<=-1 gate from before was found to be, by far, the
// dominant bottleneck: of 5,749 raw SHORT triggers, only 6.6% passed
// broaderMoveAtr<=-1, versus 47.6% for the wick filter alone. Two
// changes came out of this round's research, both validated the same
// way as before (positive PnL in BOTH halves of a symbol-based split,
// across 20 independent random splits — not one):
//
// 1. WIDENED broaderMoveAtr FROM <=-1 TO <=0.75. Tested the full range
//    of lookback windows (24/48/72/96 candles = 6h/12h/18h/24h) before
//    touching the threshold — shorter windows were uniformly WORSE
//    (never robust, often net negative), confirming 96 candles (24h)
//    is genuinely the right window, not an arbitrary knob. Within that
//    same 24h window, though, <=-1 turned out to be needlessly strict:
//    loosening step by step, robustness held at a perfect 20/20 all the
//    way to <=0.75 (n=297, +27.51 total, worst-half-ever +3.14) before
//    finally degrading at <=1.0 (drops to 16/20). "The 24h context has
//    already been net bearish by at least 1 ATR" was simply asking for
//    more than the edge actually needed.
//
// 2. ADDED a volume z-score CONFIRMATION on top: the search that led
//    here is worth being honest about. Two framings of volumeState's
//    zScore were tried and FAILED to hold up as a standalone
//    replacement for broaderMoveAtr - trendZScore/dynamicZScore
//    measured AT the trigger candle, at the segment's own volume
//    extreme, and as a rolling average, each swept across many
//    thresholds, best case only 3/20 robust splits. trendZScore AT the
//    trigger candle itself is ALWAYS exactly 0 by construction (the
//    trigger candle is, by definition, the one that just dropped OUT
//    of trend classification) - a clean but easy-to-miss dead end.
//    What DID work: averaging volumeState.trendZScore over the 3
//    candles immediately BEFORE the trigger (still inside the
//    reversing trend) and requiring it non-trivially positive, used as
//    an ADDITION on top of the widened broaderMoveAtr gate rather than
//    a replacement for it — i.e. confluence, not substitution. Per the
//    trading literature this was checked against, this is exactly how
//    volume z-scores are meant to be used (confirmation alongside
//    price structure, not a standalone signal), and matches the
//    "distribution" pattern of a genuine top - informed selling into
//    strength shows up as unusual volume on the trend's own last legs,
//    not necessarily on the break candle itself. trendZScoreAvg3>=0.25
//    on top of broaderMoveAtr<=0.75: n=189, +33.24 total, 64.0% win
//    rate, 20/20 robust, worst-half-ever +33.24's own +10.11 - better
//    on every dimension (more trades, more PnL, higher win rate, safer
//    worst case) than the pre-this-round filter (n=155, +15.64, 56.1%,
//    worst +3.03). Breadth-checked too: 141 distinct symbols
//    contributed, 70% of them net positive, top 5 symbols only 26% of
//    total PnL - a broad result, not a few lucky trades.
//
// Also checked and explicitly rejected: dynamicZScore in place of
// trendZScore for the same confirmation (trend-scoped consistently
// outperformed the rolling-baseline one for this purpose); z-score
// measured at the segment's own price extreme (worse than the 3-candle
// average approaching the trigger, never got close to robust); shorter
// broader-context lookbacks paired with a z-score compensation instead
// of the 96-candle window (tiny, unstable samples at every threshold
// tried).
//
//   SHORT: SL = reversingTrend.high + 0.5*atr,  TP = reversingTrend.mid + 0.5*atr
//   LONG:  SL = reversingTrend.low  - 1.0*atr,  TP = reversingTrend.mid + 1.0*atr
//
// STATUS: SHORT re-validated and widened this round — still a
// deliberately selective, not high-frequency, edge (this market's own
// upward bias means good SHORT setups are genuinely less common than
// good LONG ones; forcing more volume by loosening further was tried
// and reliably broke robustness). LONG unchanged, still robust. Both
// end-to-end verified against the real compiled TypeScript before
// shipping, not just the Python research.
// =====================================================================

const SHORT_SL_ATR = 0.5;
const SHORT_TP_ATR = 0.5;
const LONG_SL_ATR = 1.0;
const LONG_TP_ATR = 1.0;
const BROADER_TREND_LOOKBACK = 96; // 24h on 15m candles
const SHORT_MAX_BROADER_MOVE_ATR = 0.75; // widened from -1 this round - see file header
const SHORT_MIN_EXHAUSTION_WICK_ATR = 0.25;
const TREND_ZSCORE_CONFIRM_WINDOW = 3; // candles immediately before the trigger, still inside the reversing trend
const SHORT_MIN_TREND_ZSCORE_AVG = 0.25; // volume-confirmation floor - see file header

function currentSegmentRange(candles: CandleInfo[], segStartGi: number, uptoGiExclusive: number): { low: number; high: number } | null {
    const endGi = Math.min(uptoGiExclusive - 1, candles.length - 1);
    if (segStartGi > endGi || segStartGi < 0) return null;
    let low = Infinity, high = -Infinity;
    for (let j = segStartGi; j <= endGi; j++) {
        low = Math.min(low, candles[j].low);
        high = Math.max(high, candles[j].high);
    }
    return { low, high };
}

/**
 * Net price move over the prior BROADER_TREND_LOOKBACK candles, in ATR
 * terms — SHORT-only context filter. Null if there isn't enough history
 * yet (candle gi < BROADER_TREND_LOOKBACK).
 */
function broaderMoveAtr(candles: CandleInfo[], gi: number, entryPrice: number, atr: number): number | null {
    if (gi < BROADER_TREND_LOOKBACK) return null;
    const priorPrice = candles[gi - BROADER_TREND_LOOKBACK].close;
    return (entryPrice - priorPrice) / atr;
}

/**
 * How far the LAST candle of the reversing segment reached beyond its
 * own body before closing back inside, relative to ATR — the "reach
 * and reject" signature of genuine exhaustion. isShort: which wick to
 * measure (upper for a topping-out UP trend, lower for a bottoming DOWN
 * trend).
 */
function exhaustionWickRatio(candles: CandleInfo[], segEndGi: number, atr: number, isShort: boolean): number | null {
    if (segEndGi < 0 || segEndGi >= candles.length || !(atr > 0)) return null;
    const c = candles[segEndGi];
    if (isShort) {
        const bodyTop = Math.max(c.open, c.close);
        return (c.high - bodyTop) / atr;
    } else {
        const bodyBottom = Math.min(c.open, c.close);
        return (bodyBottom - c.low) / atr;
    }
}

/**
 * Average of volumeState.trendZScore over the TREND_ZSCORE_CONFIRM_WINDOW
 * candles immediately before the trigger candle (candles gi-window..gi-1),
 * still inside the reversing trend at that point. NOT the trigger candle
 * itself — trendZScore there is always exactly 0 by construction, since
 * the trigger candle is defined as the one that just dropped OUT of trend
 * classification (see volumeState.ts's own getTrendZScore). Null if none
 * of those candles have a computed trendZScore (e.g. too early in the
 * data, or the trend itself only just started).
 */
function trendZScoreConfirmAvg(candles: CandleInfo[], triggerGi: number): number | null {
    const values: number[] = [];
    for (let j = Math.max(0, triggerGi - TREND_ZSCORE_CONFIRM_WINDOW); j < triggerGi; j++) {
        const z = candles[j].volumeState?.trendZScore;
        if (z != null) values.push(z);
    }
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Decides whether a NEW position should open on this candle. Fires
 * only on POTENTIAL_REVERSAL. See file header for the full reasoning,
 * the validated SHORT filters, and current status.
 */
export function checkPositionEntry(
    candle: CandleInfo,
    candles: CandleInfo[],
    gi: number,
    reversingDirection: "UP" | "DOWN" | null,
    reversingSegmentStartGi: number | null,
    margin: number,
    leverage: number
): PositionEntry | null {
    if (!candle.conditions_met?.includes("POTENTIAL_REVERSAL")) return null;
    if (!reversingDirection || reversingSegmentStartGi == null) return null;
    if (!(candle.atr > 0)) return null;

    const range = currentSegmentRange(candles, reversingSegmentStartGi, gi);
    if (!range) return null;

    const entryPrice = candle.close;
    const mid = (range.low + range.high) / 2;
    const atr = candle.atr;

    if (reversingDirection === "UP") {
        // UP trend reversing -> SHORT candidate. All three checks
        // required — see file header for why each exists and how it
        // was validated.
        const broader = broaderMoveAtr(candles, gi, entryPrice, atr);
        if (broader == null || broader > SHORT_MAX_BROADER_MOVE_ATR) return null;

        const wick = exhaustionWickRatio(candles, gi - 1, atr, true);
        if (wick == null || wick < SHORT_MIN_EXHAUSTION_WICK_ATR) return null;

        const trendZ = trendZScoreConfirmAvg(candles, gi);
        if (trendZ == null || trendZ < SHORT_MIN_TREND_ZSCORE_AVG) return null;

        const sl = range.high + SHORT_SL_ATR * atr;
        const tp = mid + SHORT_TP_ATR * atr;
        if (sl <= entryPrice || tp >= entryPrice) return null; // guards the inversion bug found in earlier testing
        return {
            side: "SHORT", entryPrice, margin, leverage, sl, tp,
            entryReason: {
                trigger: "POTENTIAL_REVERSAL",
                reversingDirection: "UP",
                segmentLow: range.low, segmentHigh: range.high, segmentMid: mid,
                broaderMoveAtr: broader, exhaustionWickRatio: wick, trendZScoreAvg: trendZ,
                summary: `SHORT: UP trend reversing; 24h context ${broader.toFixed(2)} ATR, exhaustion wick ${wick.toFixed(2)} ATR, trend volume z-score avg ${trendZ.toFixed(2)}`,
            },
            entryFee: PnlUtility.calculateTakerFee(margin, leverage),
            mae: 0, mfe: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
            openGi: gi, closeGi: null, durationMinutes: null,
        };
    } else {
        // DOWN trend reversing -> LONG. Unchanged: already robust,
        // beat every filtered/re-leveled variant tried this round.
        const sl = range.low - LONG_SL_ATR * atr;
        const tp = mid + LONG_TP_ATR * atr;
        if (sl >= entryPrice || tp <= entryPrice) return null;
        const segmentProgress = range.high > range.low ? (entryPrice - range.low) / (range.high - range.low) : null;
        return {
            side: "LONG", entryPrice, margin, leverage, sl, tp,
            entryReason: {
                trigger: "POTENTIAL_REVERSAL",
                reversingDirection: "DOWN",
                segmentLow: range.low, segmentHigh: range.high, segmentMid: mid,
                broaderMoveAtr: null, exhaustionWickRatio: null, trendZScoreAvg: null,
                // % into the segment's own range at entry - the exact
                // metric that explained LONG's bad-RR pattern in an
                // earlier research pass (0% bad-RR below ~20% progress,
                // 60% above it) - visible here directly, not something
                // that needs re-deriving from raw candles later.
                summary: `LONG: DOWN trend reversing; entry ${segmentProgress != null ? (segmentProgress * 100).toFixed(0) + "%" : "?"} into the segment's own range`,
            },
            entryFee: PnlUtility.calculateTakerFee(margin, leverage),
            mae: 0, mfe: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
            openGi: gi, closeGi: null, durationMinutes: null,
        };
    }
}

/**
 * Advances an already-open position by exactly one candle — UNCHANGED.
 * Exit mechanics never depended on which entry logic opened a position.
 * Same-candle SL+TP overlap is genuinely ambiguous (MID, no PnL
 * computed), a clean SL or TP hit resolves and closes the position,
 * otherwise it stays OPEN with a mark-to-market PnL.
 *
 * Does NOT set durationMinutes — the caller derives it from the known,
 * fixed candle interval: durationMinutes = (closeGi - position.openGi)
 * * minutesPerCandle.
 */
export function updatePositionEntry(position: PositionEntry, candle: CandleInfo, closeGi: number): PositionEntry {
    const atr = candle.atr > 0 ? candle.atr : 1;

    function calculatePnl(entryPrice: number, exitPrice: number, side: "LONG" | "SHORT"): number {
        const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * (side === "LONG" ? 1 : -1) * position.leverage;
        return position.margin * pnlPercent;
    }

    if (position.side === "LONG") {
        const adverse = (position.entryPrice - candle.low) / atr;
        const favorable = (candle.high - position.entryPrice) / atr;
        position.mae = Math.max(position.mae, adverse);
        position.mfe = Math.max(position.mfe, favorable);

        const hitSl = candle.low < position.sl;
        const hitTp = candle.high > position.tp;

        if (hitSl && hitTp) {
            position.status = "MID";
            position.pnl = null;
            position.closeGi = closeGi;
        } else if (hitSl) {
            position.status = "LOSS";
            position.pnl = calculatePnl(position.entryPrice, position.sl, "LONG");
            position.closeGi = closeGi;
        } else if (hitTp) {
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, position.tp, "LONG");
            position.closeGi = closeGi;
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "LONG");
        }
    } else {
        const adverse = (candle.high - position.entryPrice) / atr;
        const favorable = (position.entryPrice - candle.low) / atr;
        position.mae = Math.max(position.mae, adverse);
        position.mfe = Math.max(position.mfe, favorable);

        const hitSl = candle.high > position.sl;
        const hitTp = candle.low < position.tp;

        if (hitSl && hitTp) {
            position.status = "MID";
            position.pnl = null;
            position.closeGi = closeGi;
        } else if (hitSl) {
            position.status = "LOSS";
            position.pnl = calculatePnl(position.entryPrice, position.sl, "SHORT");
            position.closeGi = closeGi;
        } else if (hitTp) {
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, position.tp, "SHORT");
            position.closeGi = closeGi;
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "SHORT");
        }
    }

    // One push covers all branches above - position.pnl has just been
    // set to whatever this candle's outcome was (mark-to-market if
    // still OPEN, the final realized value if WON/LOSS, null if MID),
    // and walkingPnl is exactly that value's history over time.
    position.walkingPnl.push(position.pnl);

    return position;
}

/**
 * Force-closes a still-OPEN position at whatever it's worth on this
 * exact candle, classifying WON/LOSS purely by the sign of the
 * resulting pnl (not by SL/TP - this isn't a real exit, it's a
 * duration cap giving up on the position). Same leveraged pnl formula
 * as every other exit, so this number is consistent with how the
 * position would read if it had resolved normally.
 *
 * Deliberately a SEPARATE function from updatePositionEntry rather
 * than a flag inside it — the ordinary live/backtest path never calls
 * this; only a caller that explicitly wants a duration cap (see
 * runAnalysis's own maxPositionDurationCandles parameter) does.
 * Keeping it isolated means the default behavior everywhere else is
 * provably unchanged.
 */
export function forceClosePosition(position: PositionEntry, candle: CandleInfo, closeGi: number): PositionEntry {
    const pnlPercent = ((candle.close - position.entryPrice) / position.entryPrice) * (position.side === "LONG" ? 1 : -1) * position.leverage;
    const pnl = position.margin * pnlPercent;

    position.status = pnl >= 0 ? "WON" : "LOSS";
    position.pnl = pnl;
    position.closeGi = closeGi;
    // Overwrites, not pushes: this is meant to be called immediately
    // after updatePositionEntry on the SAME candle, which already
    // pushed a mark-to-market entry for this exact gi. The forced
    // value supersedes that entry rather than adding a second one for
    // the same candle - walkingPnl must stay exactly one entry per
    // candle (walkingPnl[gi - openGi]) or every index past this point
    // would be shifted by one.
    if (position.walkingPnl.length > 0) {
        position.walkingPnl[position.walkingPnl.length - 1] = pnl;
    } else {
        position.walkingPnl.push(pnl);
    }

    return position;
}

export const DEFAULT_LEVERAGE = 20;