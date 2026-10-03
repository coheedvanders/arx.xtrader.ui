import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

// #####################################################################
// POSITION ENTRY - BLANK SLATE
// #####################################################################
// checkPositionEntry is the ONE hook runAnalysis calls to open a position, and
// it returns null: no entry is encoded. Everything else here is MECHANISM, not
// hypothesis:
//   buildPositionEntry   turns a decision (side, stop, target) into a valid position
//   couldEnterAt         the rolling sim / live "next" pre-check (see its contract)
//   updatePositionEntry  advances an open position one candle (TP / SL / MID, gap-aware)
//   forceClosePosition   duration cap, scheduled close, liquidation
//   DEFAULT_LEVERAGE
// Earlier entries (slingshot dive, quick reversal, HH-above-zone short, ...) and
// the unused in-flight management rules are in git history.
//
// FACTS AN ENTRY HAS TO LIVE WITH:
//
// candle.atr IS PERIOD 8 (two hours on 15m), not 14 - far noisier than "ATR"
// suggests, so a 3-ATR stop sits closer to the noise than it reads.
//
// fee / R = 2 x taker / (stopDistance / entryPrice). At 0.05% taker a stop 1%
// from price pays 10% of R in fees; 0.1% from price pays 100% and cannot profit
// at any win rate.
//
// breakeven reward:risk = (1 - p) / p at a win rate p - a line to clear, not a
// target to tune.
//
// LEVERAGE CAPS THE STOP. At leverage L a move of 1/L against the position
// consumes the margin: at the median ATR of ~0.66% of price that is ~7.6 ATR at
// 20x. A stop beyond it is a liquidation, not a stop.
//
// A RETURNED POSITION MUST: open at `gi` (the candle the walk reached - anything
// earlier is look-ahead), carry candle.openTime, use the entry candle's ATR as
// atrAtEntry, start walkingPnl at [0], and have sl / tp positive and on the right
// side of entry. buildPositionEntry does all of that.
// #####################################################################

/** What an entry decides. Everything else is bookkeeping. */
export interface EntryDecision {
    side: "LONG" | "SHORT";
    /** Stop price. Must be below entry for a LONG, above for a SHORT. */
    sl: number;
    /** Target price. Must be above entry for a LONG, below for a SHORT. */
    tp: number;
    /** Free-form record of WHY, written into the export. */
    reason: Partial<PositionEntry["entryReason"]> & { trigger: PositionEntry["entryReason"]["trigger"] };
}

/**
 * Turn a decision into a valid PositionEntry, or null if the levels are not
 * usable.
 *
 * REFUSES rather than clamps. A stop on the wrong side of entry, at zero, or
 * below zero is a bug in the entry logic, and silently moving it would hide that
 * bug behind a position that trades with a risk nobody chose.
 */
export function buildPositionEntry(
    decision: EntryDecision,
    candle: CandleInfo,
    gi: number,
    margin: number,
    leverage: number
): PositionEntry | null {
    const { side, sl, tp } = decision;
    const entryPrice = candle.close;
    const atr = candle.atr;
    if (!(entryPrice > 0) || !(atr > 0)) return null;
    if (!(margin > 0) || !(leverage > 0)) return null;
    if (!(sl > 0) || !(tp > 0)) return null;
    if (side === "LONG" && !(sl < entryPrice && tp > entryPrice)) return null;
    if (side === "SHORT" && !(sl > entryPrice && tp < entryPrice)) return null;

    const risk = Math.abs(entryPrice - sl);
    const reward = Math.abs(tp - entryPrice);
    if (!(risk > 0) || !(reward > 0)) return null;

    return {
        side, entryPrice, margin, leverage, sl, tp,
        openTime: candle.openTime,
        entryReason: {
            reversingDirection: "UP",
            segmentLow: Math.min(entryPrice, sl, tp),
            segmentHigh: Math.max(entryPrice, sl, tp),
            segmentMid: entryPrice,
            broaderMoveAtr: null,
            exhaustionWickRatio: null,
            trendZScoreAvg: null,
            summary: "",
            ...decision.reason,
            // Derived, never supplied: these are what an export is audited
            // against, so they must come from the levels actually used.
            plannedRewardRisk: reward / risk,
            plannedRiskPercent: risk / entryPrice,
        },
        entryFee: PnlUtility.calculateTakerFee(margin, leverage),
        mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
        exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
        openGi: gi, closeGi: null, durationMinutes: null,
    };
}

/**
 * THE ENTRY. Returns null until an entry is encoded here.
 *
 * Everything needed is already on the candles by the time this is called:
 * candle.atr, ema200, candleStructure, volumeState, priceAction, priceZone,
 * imbalanceState, marketStructure, trendState, conditions_met, change_pct, and
 * the whole `candles` array up to `gi`.
 *
 * CAUSALITY IS NOT CHECKED FOR YOU. `candles` is the full window, including
 * candles AFTER `gi`. Reading any of them is look-ahead and the run will look
 * excellent. Only read indices <= gi.
 *
 * Open a position with buildPositionEntry(decision, candle, gi, margin, leverage),
 * honouring allowLong / allowShort.
 *
 * WHEN YOU ADD AN ENTRY, update couldEnterAt below to match it.
 */
export function checkPositionEntry(
    candle: CandleInfo,
    candles: CandleInfo[],
    gi: number,
    reversingDirection: "UP" | "DOWN" | null,
    reversingSegmentStartGi: number | null,
    margin: number,
    leverage: number,
    allowLong: boolean = true,
    allowShort: boolean = true
): PositionEntry | null {
    void candle; void candles; void gi; void reversingDirection; void reversingSegmentStartGi;
    void margin; void leverage; void allowLong; void allowShort;
    return null;
}

/**
 * CHEAP PRE-CHECK for checkPositionEntry, from raw OHLCV only: can an entry
 * possibly fire at `gi`? The rolling simulation and the live-run "next" skip
 * the full 500-candle analysis on candles where this is false - that is most of
 * their speed.
 *
 * CONTRACT - keep it in step with checkPositionEntry:
 *   false must mean checkPositionEntry cannot return a position at gi.
 *   It may say true when no entry fires (a superset is fine); it must never say
 *   false when one would, or those runs silently miss the trade.
 *
 * Returns true (shortcut OFF - always correct, just slower) until an entry is
 * written. Then make it the cheapest NECESSARY condition of that entry - e.g.
 * for an entry tagged on a volume-spike candle:
 *   CandleAnalyzerV2.hasVolumeSpike(candles.slice(0, gi + 1), CANDLE_STRUCTURE_CONFIG.VOLUME_SPIKE_LOOKBACK)
 */
export function couldEnterAt(candles: CandleInfo[], gi: number): boolean {
    void candles; void gi;
    return true;
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
        // PRICE excursions, tracked alongside the ATR-relative ones above
        // because those two are NOT comparable to a fixed price level.
        // `atr` here is THIS candle's, so mae/mfe get re-normalized every
        // candle while sl/tp stay fixed at their entry-derived prices.
        // Measured against a real run, 24% of take-profit winners had an
        // MAE larger than their own stop distance - arithmetically
        // impossible, since a TP winner never touched its stop. The price
        // figures have no such problem and are what any stop/target
        // question has to be asked in.
        position.maePrice = Math.max(position.maePrice, position.entryPrice - candle.low);
        position.mfePrice = Math.max(position.mfePrice, candle.high - position.entryPrice);

        const hitSl = candle.low < position.sl;
        const hitTp = candle.high > position.tp;

        if (hitSl && hitTp) {
            position.status = "MID";
            position.pnl = null;
            position.closeGi = closeGi;
            position.closeReason = "MID";
        } else if (hitSl) {
            // GAP-AWARE FILL. Filling at exactly `sl` assumes the stop
            // was always reachable at its own price - but if this candle
            // OPENED past the stop, the market gapped through it while no
            // trading happened at that level, and a resting stop fills at
            // the open instead, worse. Alt perps gap on news and on
            // thin-liquidity hours, so this is not a rare edge case.
            // Math.min(open, sl) resolves to sl in the ordinary case and to the
            // open only when the gap actually happened.
            const fill = Math.min(candle.open, position.sl);
            position.status = "LOSS";
            position.pnl = calculatePnl(position.entryPrice, fill, "LONG");
            position.exitPrice = fill;
            position.closeGi = closeGi;
            position.closeReason = "SL";
        } else if (hitTp) {
            // Same treatment on the favorable side, for symmetry and
            // honesty: a candle that opened past the target fills THERE,
            // which is better than the target. Modelling only the adverse
            // gap and not this one would bias the result downward.
            const fill = Math.max(candle.open, position.tp);
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, fill, "LONG");
            position.exitPrice = fill;
            position.closeGi = closeGi;
            position.closeReason = "TP";
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "LONG");
        }
    } else {
        const adverse = (candle.high - position.entryPrice) / atr;
        const favorable = (position.entryPrice - candle.low) / atr;
        position.mae = Math.max(position.mae, adverse);
        position.mfe = Math.max(position.mfe, favorable);
        // See the LONG branch for why price excursions are tracked too.
        position.maePrice = Math.max(position.maePrice, candle.high - position.entryPrice);
        position.mfePrice = Math.max(position.mfePrice, position.entryPrice - candle.low);

        const hitSl = candle.high > position.sl;
        const hitTp = candle.low < position.tp;

        if (hitSl && hitTp) {
            position.status = "MID";
            position.pnl = null;
            position.closeGi = closeGi;
            position.closeReason = "MID";
        } else if (hitSl) {
            // GAP-AWARE FILL. Filling at exactly `sl` assumes the stop
            // was always reachable at its own price - but if this candle
            // OPENED past the stop, the market gapped through it while no
            // trading happened at that level, and a resting stop fills at
            // the open instead, worse. Alt perps gap on news and on
            // thin-liquidity hours, so this is not a rare edge case.
            // Math.max(open, sl) resolves to sl in the ordinary case and to the
            // open only when the gap actually happened.
            const fill = Math.max(candle.open, position.sl);
            position.status = "LOSS";
            position.pnl = calculatePnl(position.entryPrice, fill, "SHORT");
            position.exitPrice = fill;
            position.closeGi = closeGi;
            position.closeReason = "SL";
        } else if (hitTp) {
            // Same treatment on the favorable side, for symmetry and
            // honesty: a candle that opened past the target fills THERE,
            // which is better than the target. Modelling only the adverse
            // gap and not this one would bias the result downward.
            const fill = Math.min(candle.open, position.tp);
            position.status = "WON";
            position.pnl = calculatePnl(position.entryPrice, fill, "SHORT");
            position.exitPrice = fill;
            position.closeGi = closeGi;
            position.closeReason = "TP";
        } else {
            position.status = "OPEN";
            position.pnl = calculatePnl(position.entryPrice, candle.close, "SHORT");
        }
    }

    // Exit taker fee, charged on the EXIT notional (quantity x exit
    // price), not the entry notional - a position that moved pays a
    // different fee out than it paid in. Previously never charged at all,
    // which understated round-trip cost by almost exactly half.
    //
    // ASSIGNED, not accumulated: the rolling simulation re-runs this same
    // analysis over its whole window on every shift, so a `+=` here would
    // grow without bound - the same trap walkingPnl's index-based write
    // exists to avoid. Assignment is idempotent; a repeat pass writes the
    // identical value.
    if (position.status !== "OPEN" && position.exitPrice != null) {
        const quantity = (position.margin * position.leverage) / position.entryPrice;
        position.exitFee = PnlUtility.calculateTakerFeeOnNotional(Math.abs(quantity * position.exitPrice));
    }

    // walkingPnl[k] is the pnl as of candle (openGi + k), so this
    // candle's own slot is exactly (closeGi - openGi). WRITING to that
    // index rather than blindly appending is what makes this safe to
    // call more than once for the same candle.
    //
    // That matters because the rolling simulation re-runs the whole
    // analysis over its entire 500-candle window on every window shift,
    // so every candle from openGi to the window's end gets
    // updatePositionEntry called again on each pass. The old
    // unconditional push therefore appended (windowEnd - openGi)
    // entries per shift instead of one, growing quadratically with a
    // position's age - real exports showed walkingPnl reaching 31,376
    // entries against a true ceiling of 251 (the 250-candle duration
    // cap plus the entry candle's own leading 0). Indexing makes a
    // repeat pass overwrite the same slot with the same value instead.
    //
    // A gap can only appear if this were called with candles skipped,
    // which the walk-forward loop never does; filling with null rather
    // than leaving holes keeps the array dense either way, and null is
    // already a valid walkingPnl entry (it's what MID status records).
    const walkingIndex = closeGi - position.openGi;
    if (walkingIndex >= 0) {
        while (position.walkingPnl.length < walkingIndex) {
            position.walkingPnl.push(null);
        }
        position.walkingPnl[walkingIndex] = position.pnl;
    }

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
export function forceClosePosition(
    position: PositionEntry,
    candle: CandleInfo,
    closeGi: number,
    // WHY this force-close happened. Defaults to EXPIRED because the
    // duration cap is the only caller that existed when this function
    // was written; a scheduled portfolio-wide close passes AUTO_CLOSE.
    // Recorded because status alone can't carry it - see
    // PositionEntry.closeReason. A WON here means "closed above water",
    // NOT "the strategy's take-profit was reached".
    reason: "EXPIRED" | "AUTO_CLOSE" | "LIQUIDATED" | "MANAGED" | "PERIOD_END" = "EXPIRED"
): PositionEntry {
    const pnlPercent = ((candle.close - position.entryPrice) / position.entryPrice) * (position.side === "LONG" ? 1 : -1) * position.leverage;
    const pnl = position.margin * pnlPercent;

    position.status = pnl >= 0 ? "WON" : "LOSS";
    position.pnl = pnl;
    position.closeGi = closeGi;
    position.closeReason = reason;
    // A force-close is a market exit at this candle's close - so it pays
    // a taker fee exactly like any other exit. LIQUIDATED included: a
    // liquidation is still a fill, and in reality costs more than this.
    position.exitPrice = candle.close;
    const quantity = (position.margin * position.leverage) / position.entryPrice;
    position.exitFee = PnlUtility.calculateTakerFeeOnNotional(Math.abs(quantity * candle.close));
    // Same index-based write as updatePositionEntry (which this is
    // called immediately after, on the SAME candle) - so the forced
    // value lands in that candle's own slot, superseding the
    // mark-to-market value already written there rather than adding a
    // second entry for the same candle. Previously this overwrote the
    // LAST element, which was only correct while walkingPnl was built
    // by appending; with index-based writes the last element is not
    // necessarily this candle's slot.
    const walkingIndex = closeGi - position.openGi;
    if (walkingIndex >= 0) {
        while (position.walkingPnl.length < walkingIndex) {
            position.walkingPnl.push(null);
        }
        position.walkingPnl[walkingIndex] = pnl;
    }

    return position;
}

export const DEFAULT_LEVERAGE = 20;
