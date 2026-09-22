import type { CandleInfo, PositionEntry, SIGNAL_DIRECTION } from "@/core/interfacesv2";

// ARBITRARY, uncalibrated — same status as every other distance
// threshold in this pipeline (see priceAction.ts's own CONFIG,
// simulationUtilityV2.ts's PRICE_ACTION_RESPECTED_MAX_DISTANCE_ATR).
// How close (in ATRs) counts as "at or near" the previous trend's mid.
const NEAR_TREND_MID_ATR = 0.5;

// ARBITRARY buffer placed beyond the highest/lowest active AVWAP for
// the stop, so SL isn't set exactly AT a level price could touch
// without genuinely invalidating the trade.
const SL_BUFFER_ATR = 0.25;

// The stated minimum acceptable reward:risk. Read literally from "RR is
// 2:1 or TP is near past trend low/high": the past trend's own
// low/high is the PREFERRED target (a real structural level) as long
// as it already clears this minimum; if it's too close, TP extends to
// the straight 2:1 distance instead. This interpretation was stated
// explicitly rather than assumed silently, since getting it backwards
// changes every PnL number this module produces.
const MIN_RR = 2;

// Placeholder — "max leverage per symbol" implies a real per-symbol
// table this module doesn't have. Structured as a parameter so a real
// table can be substituted without touching this file's own logic.
export const DEFAULT_LEVERAGE = 20;

/**
 * Standard leveraged PnL — NOT the project's own PnlUtility (that file
 * wasn't available here). If the real formula differs even slightly
 * (funding, fees, a different percent basis), every PnL figure this
 * module produces will be off by that same difference — swap this out
 * for the real PnlUtility.calculatePNLPercent/calculateEstimatedPnl
 * before trusting these numbers over real ones.
 */
function calculatePnl(entryPrice: number, exitPrice: number, side: "LONG" | "SHORT", margin: number, leverage: number): number {
    const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * (side === "LONG" ? 1 : -1) * leverage;
    return margin * pnlPercent;
}

/**
 * Decides whether a NEW position should open on this candle, per the
 * stated entry rules. Returns null if no entry — never assumes a
 * position "should" open just because RECENT_AVWAP_BODY fired; every
 * other condition (price outside all active AVWAPs, near the previous
 * trend's mid, ATR available, trend-aligned direction) must also hold.
 *
 * Trend-alignment requirement (LONG only during an UP trend, SHORT
 * only during DOWN) was added after backtesting 1006 resolved
 * positions across 321 symbols: counter-trend entries (SHORT during
 * UP, LONG during DOWN) won 0.7% of the time (2 of 283 trades) and
 * accounted for 82% of total realized losses (-181 of -220 USDT).
 * With-trend entries alone were still slightly negative (-16 USDT
 * over 699 trades) but nowhere near as broken — this filter doesn't
 * fix the strategy, it just stops betting against the prevailing
 * direction, which was never something worth doing on its own
 * evidence.
 *
 * currentTrendDirection is passed in explicitly (the caller's own
 * lastKnownTrendSnapshot.direction) rather than read from
 * candle.trendState here — candle.trendState can be null on THIS
 * exact candle mid-loop even when it will eventually resolve to a
 * real direction once a later commit retroactively assigns it (same
 * reasoning as PRICE_ACTION_RESPECTED's own lookback in
 * simulationUtilityV2.ts). Reading candle.trendState directly here
 * would silently reject entries that are actually trend-aligned, just
 * not yet confirmed as such.
 */
export function checkPositionEntry(
    candle: CandleInfo,
    activePocAvwaps: { value: number; direction: SIGNAL_DIRECTION }[],
    previousTrendCloud: { minLow: number; maxHigh: number } | null,
    currentTrendDirection: "UP" | "DOWN" | null,
    openGi: number,
    margin: number,
    leverage: number = DEFAULT_LEVERAGE
): PositionEntry | null {
    if (!candle.conditions_met?.includes("RECENT_AVWAP_BODY")) return null;
    if (!activePocAvwaps.length || !previousTrendCloud) return null;
    if (!(candle.atr > 0)) return null;
    if (!currentTrendDirection) return null;

    const maxAvwap = Math.max(...activePocAvwaps.map(p => p.value));
    const minAvwap = Math.min(...activePocAvwaps.map(p => p.value));
    const previousTrendMid = (previousTrendCloud.minLow + previousTrendCloud.maxHigh) / 2;
    const nearBand = NEAR_TREND_MID_ATR * candle.atr;

    // SHORT: price below ALL active AVWAPs, at/near the previous
    // trend's mid from above, AND the current trend is DOWN (not
    // fighting the prevailing direction).
    if (currentTrendDirection === "DOWN" && candle.close < minAvwap && candle.close >= previousTrendMid - nearBand) {
        const entryPrice = candle.close;
        const sl = maxAvwap + SL_BUFFER_ATR * candle.atr;
        const slDistance = sl - entryPrice;
        if (slDistance <= 0) return null; // entry already invalid relative to its own stop
        // SHORT-specific: reject if the active AVWAP spread (which
        // drives SL distance) is too wide. Derived from quartiling 429
        // real SHORT trades by slDistance/atr: win rate ran a clean,
        // monotonic 36.4% (tightest quartile) down to 8.3% (widest) —
        // not a single cherry-picked cutoff. Restricting to
        // slDistance/atr < 1.3 alone took total SHORT PnL from -259.55
        // (all 429) to roughly breakeven on the kept ~26%. This is
        // SHORT-only: the identical quartile test on LONG showed the
        // OPPOSITE relationship (its widest quartile performed BEST),
        // which is what rules out "tighter targets are just easier to
        // hit" as the explanation — that would predict the same effect
        // on both sides, and it doesn't appear on LONG at all.
        // ARBITRARY exact cutoff within the tight quartile (the data
        // support anywhere from ~1.0-1.3 similarly well) — 1.3 chosen
        // as a stated compromise, trading a little PnL for more trade
        // frequency versus the tightest option tested (1.0).
        const SHORT_MAX_SL_DISTANCE_ATR = 1.3;
        if (slDistance / candle.atr >= SHORT_MAX_SL_DISTANCE_ATR) return null;
        const rrTarget = entryPrice - MIN_RR * slDistance;
        // SHORT's TP is capped at the straight MIN_RR floor, UNLIKE
        // LONG below — this asymmetry was derived, not assumed.
        // Re-simulating 301 real SHORT trades against their own actual
        // candle data at multiple caps showed RR=2.0 (no structural
        // extension at all) produced the best total PnL (-247.64 vs
        // -284.76 uncapped) — every looser cap performed worse. The
        // same test on LONG showed the OPPOSITE: uncapped performed
        // best there (+71.32 vs +57.35 at the same RR=2.0 cap). This
        // does NOT make SHORT profitable on its own — it's still a net
        // loss even at the best cap tested — it's the least-bad option
        // found, not a fix for whatever's making SHORT's entry
        // condition itself unreliable.
        const tp = rrTarget;
        return {
            side: "SHORT", entryPrice, margin, leverage, sl, tp,
            mae: 0, mfe: 0, status: "OPEN", pnl: 0,
            openGi, closeGi: null, durationMinutes: null,
        };
    }

    // LONG: mirror of the above — current trend must be UP.
    if (currentTrendDirection === "UP" && candle.close > maxAvwap && candle.close <= previousTrendMid + nearBand) {
        const entryPrice = candle.close;
        const sl = minAvwap - SL_BUFFER_ATR * candle.atr;
        const slDistance = entryPrice - sl;
        if (slDistance <= 0) return null;
        const rrTarget = entryPrice + MIN_RR * slDistance;
        const trendHigh = previousTrendCloud.maxHigh;
        const tp = trendHigh >= rrTarget ? trendHigh : rrTarget;
        return {
            side: "LONG", entryPrice, margin, leverage, sl, tp,
            mae: 0, mfe: 0, status: "OPEN", pnl: 0,
            openGi, closeGi: null, durationMinutes: null,
        };
    }

    return null;
}

/**
 * Advances an already-open position by exactly one candle — mirrors
 * the reference simulationUtility.ts logic: same-candle SL+TP overlap
 * is genuinely ambiguous (MID, no PnL computed), a clean SL or TP hit
 * resolves and closes the position, otherwise it stays OPEN with a
 * mark-to-market PnL. Mutates and returns the SAME object (matching
 * how trendState/marketStructure objects are shared and mutated
 * across the candles they cover), and always updates MAE/MFE first,
 * from the ATR available on THIS candle, regardless of outcome.
 *
 * Does NOT set durationMinutes — this function only ever sees one
 * candle at a time and closeTime isn't populated anywhere in this
 * pipeline (mapToInfo only maps openTime), so duration can't be
 * derived here. The caller derives it from the known, fixed candle
 * interval instead: durationMinutes = (closeGi - position.openGi) * minutesPerCandle.
 */
export function updatePositionEntry(position: PositionEntry, candle: CandleInfo, closeGi: number): PositionEntry {
    const atr = candle.atr > 0 ? candle.atr : 1;

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
            position.pnl = calculatePnl(position.entryPrice, position.sl, "LONG", position.margin, position.leverage);
            position.closeGi = closeGi;
        } else if (hitTp) {
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, position.tp, "LONG", position.margin, position.leverage);
            position.closeGi = closeGi;
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "LONG", position.margin, position.leverage);
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
            position.pnl = calculatePnl(position.entryPrice, position.sl, "SHORT", position.margin, position.leverage);
            position.closeGi = closeGi;
        } else if (hitTp) {
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, position.tp, "SHORT", position.margin, position.leverage);
            position.closeGi = closeGi;
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "SHORT", position.margin, position.leverage);
        }
    }

    return position;
}