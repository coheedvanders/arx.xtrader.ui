import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

// #####################################################################
// WHAT IS LEFT IN THIS FILE, AND WHAT IT ASSUMES
// #####################################################################
// The entry logic has been cleared (see ENTRY — BLANK SLATE below). What
// remains is position MECHANISM: opening a valid position from a decision,
// advancing it one candle, resolving it, and the optional in-flight exit rules.
//
// THE ATR EVERYTHING SCALES BY IS PERIOD 8, NOT 14.
// `CandleAnalyzerV2.calculateATR` defaults to 14, but the lab calls it with 8:
// recomputing the run archive at period 8 reproduces all 275,054 stored ATR
// values to a relative error under 1e-12, while 14 matches 0.29% of them. So
// `candle.atr` is eight candles of true range - two hours on 15m - which is a
// far noisier quantity than the word "ATR" suggests. A 3-ATR stop sits much
// closer to the noise than it reads, and an entry written here should be
// chosen knowing that.
//
// TWO COST FACTS AN ENTRY CANNOT ARGUE WITH, both arithmetic rather than
// measurement, so they hold whatever the entry turns out to be:
//
//   fee / R = 2 x taker / (stopDistance / entryPrice)
//     At 0.05% taker a stop 1% from price pays 10% of R in fees; a stop 0.1%
//     from price pays 100% of R and cannot profit at any win rate. Some pairs
//     cannot pay their own fees at all - measured in ATR, the round trip
//     exceeds one full ATR on stablecoin, tokenised-gold and tokenised-equity
//     perps (USDC, XAUT, PAXG, SPY, EWY, COPPER, XPT).
//
//   breakeven reward:risk = (1 - p) / p
//     at a win rate p. Not a target to tune - a line any entry has to clear.
//
// LEVERAGE CAPS THE STOP. At leverage L a move of 1/L against the position
// consumes the margin, so a stop beyond that is a liquidation, not a stop. At
// the median ATR of 0.659% of price that is 7.6 ATR at 20x, 15 ATR at 10x and
// 30 ATR at 5x.
// #####################################################################

// =====================================================================
// ENTRY — BLANK SLATE
//
// `checkPositionEntry` is the ONE hook `runAnalysis` calls to open a position.
// It returns null. Everything that used to live here - the reversing-segment
// geometry, the SHORT confirmation filters, the R:R gate, the extension fade -
// has been removed so the entry can be written from observation rather than
// edited around what was already there.
//
// WHAT WAS REMOVED, so it is not rediscovered by accident: the POTENTIAL_REVERSAL
// trigger and its helpers (currentSegmentRange, broaderMoveAtr,
// exhaustionWickRatio, trendZScoreConfirmAvg), the LONG/SHORT ATR level
// constants, MIN_REWARD_RISK, and checkExtensionEntry with its levels and
// config. None of it had a demonstrated edge; all of it is in git if a piece of
// it is ever wanted back.
//
// WHAT WAS KEPT, because it is mechanism rather than hypothesis:
//   updatePositionEntry   advances an open position one candle, resolves at
//                         TP/SL/MID, gap-aware on both sides
//   forceClosePosition    duration cap, scheduled close, liquidation
//   position management   the in-flight exit rules, off by default
//   DEFAULT_LEVERAGE
//
// =====================================================================
// WHAT A POSITION NEEDS, SO THE NEXT ENTRY DOES NOT HAVE TO REDISCOVER IT
// =====================================================================
// A returned PositionEntry must satisfy the engine's invariants or the run's
// accounting is wrong in ways that do not announce themselves:
//
//   openGi MUST be `gi`, the candle the walk has actually reached. Anything
//     earlier is look-ahead: the entry price would predate the decision, and
//     the position cap and margin freeze would both be bypassed. This cost a
//     multi-hour run to find once.
//   openTime MUST be `candle.openTime`, stamped at creation and never changed.
//   atrAtEntry MUST be the entry candle's ATR. Excursions are recorded in PRICE
//     and normalised against this later; an ATR read at any other candle makes
//     MAE/MFE incomparable to the stop.
//   walkingPnl starts as [0] and is written BY INDEX thereafter, never appended -
//     the rolling caller re-walks the window, so appending grows it quadratically.
//   sl and tp must both be positive and on the correct side of entry. An
//     inverted or zero-width stop produces a position whose risk is undefined.
//
// `buildPositionEntry` below does all of that, so a new entry only has to decide
// SIDE, STOP and TARGET.
// =====================================================================

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
 * THE ENTRY. Returns null until an analysis is encoded here.
 *
 * Everything needed is already on the candles by the time this is called:
 * `candle.atr`, `candle.ema200`, `candle.candleStructure`, `candle.volumeState`,
 * `candle.priceAction`, `candle.marketStructure`, `candle.trendState`,
 * `candle.conditions_met`, and the whole `candles` array up to `gi`.
 *
 * CAUSALITY IS NOT CHECKED FOR YOU. `candles` is the full window, including
 * candles AFTER `gi`. Reading any of them is look-ahead and the run will look
 * excellent. Only read indices <= gi.
 *
 * `reversingDirection` and `reversingSegmentStartGi` are the trend snapshot
 * runAnalysis happens to have; they are passed for convenience and may be null.
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
    void candles; void reversingDirection; void reversingSegmentStartGi;
    void allowShort;

    // `trigger` is still "POTENTIAL_REVERSAL", which the old reversal entry also
    // used. Exports cannot be separated by entry while that is true; a distinct
    // value is one widening line on PositionEntryReason in interfacesv2.ts.

    // The caller's own toggle. Ignoring it makes the lab's LONG/SHORT settings
    // a lie about what the run actually did.
    if (!allowLong) return null;

    var entryPrice = candle.close;

    var hasExtraHigh = candle.extras.some(x => x.startsWith("HIGH:"));
    var hasExtraLow = candle.extras.some(x => x.startsWith("LOW:"));

    if(hasExtraHigh && hasExtraLow){
        if(candle.conditions_met?.includes("SUPPORT_POTENTIAL_REVERSAL_BREAK")){
            var extraInfoHigh = parseFloat(candle.extras.filter(e => e.includes("HIGH: "))[0].replace("HIGH: ",""));
            var extraInfoLow = parseFloat(candle.extras.filter(e => e.includes("LOW: "))[0].replace("LOW: ",""));

            // DOWN trend reversing -> LONG. The segment HIGH is the target and
            // the segment LOW is the stop.
            //
            // THIS WAS SWAPPED, and it is the whole reason nothing moved. With
            // sl = HIGH and tp = LOW, both levels sat on the wrong side of
            // entry, so on the very next candle updatePositionEntry saw
            // `candle.low < sl` AND `candle.high > tp` at the same time, which
            // is its MID branch: status MID, pnl null, closeGi set, position
            // closed. Every position was born and resolved immediately with no
            // PnL - which reads exactly like a position that never moves.
            const tp = extraInfoHigh;
            const sl = extraInfoLow;

            // Built through buildPositionEntry rather than returned as a literal.
            // That is the integration fix, not a style change - it is what sets
            // `atrAtEntry` from THIS candle's ATR (the literal hardcoded 0, which
            // makes every later R multiple a division by zero and makes
            // evaluatePositionManagement return early), stamps openGi/openTime,
            // starts walkingPnl at [0], and REFUSES levels on the wrong side of
            // entry instead of trading them - which is what would have caught
            // the swap above on the first run.
            //
            // It returns null when tp is at or below entry. That is a real case
            // here and not an error: tp is the segment's own high, so a candle
            // that has already closed above that high has no target left.
            return buildPositionEntry(
                {
                    side: "LONG",
                    sl,
                    tp,
                    reason: {
                        trigger: "POTENTIAL_REVERSAL",
                        reversingDirection: "DOWN",
                        // The segment the levels came from, so an export can be
                        // grouped by the geometry that produced the trade. These
                        // were hardcoded 0, which threw that away.
                        segmentLow: sl,
                        segmentHigh: tp,
                        segmentMid: (sl + tp) / 2,
                        broaderMoveAtr: null, exhaustionWickRatio: null, trendZScoreAvg: null,
                        summary: `bull close back through the last TREND_SETTER AVWAP, last POTENTIAL_REVERSAL bullish; tp = segment high ${tp}, sl = segment low ${sl}`,
                    },
                },
                candle, gi, margin, leverage
            );
        }
    }

    return null;
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
    reason: "EXPIRED" | "AUTO_CLOSE" | "LIQUIDATED" | "MANAGED" = "EXPIRED"
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

// =====================================================================
// IN-FLIGHT POSITION MANAGEMENT
//
// Deciding to close, or to move the stop on, a position that is already
// open — as opposed to the level geometry fixed at entry.
//
// EVERY RULE HERE DEFAULTS TO OFF, and that is not caution, it is the
// measured result. All five families below were tested offline against
// the recorded forward path of every POTENTIAL_REVERSAL candidate in
// the 2026-09-21 -> 2026-09-26 capture (336 Binance USDT-M symbols,
// 15m, 2,009 candidates with full 96-candle context and a round-trip
// fee under 0.25 ATR), replayed on the shipped levels with a 250-candle
// cap. Baseline, no management: netR +0.3825. Differences are paired
// ROW BY ROW - same candidate, same forward path, only the rule differs -
// with symbol-clustered standard errors.
//
//   BREAKEVEN_STOP     arm 0.5 ATR   -0.4680 +-0.0572   t  -8.2
//                      arm 3.0 ATR   -0.2731 +-0.0366   t  -7.5
//   TRAILING_GIVEBACK  arm 1.0/give 0.5  -0.4479 +-0.0549  t -8.2
//                      arm 3.0/give 1.5  -0.2882 +-0.0382  t -7.5
//   NO_PROGRESS        candle 16, <=0.5 ATR  -0.1526 +-0.0169  t -9.0
//                      candle 48, <=1.0 ATR  -0.0880 +-0.0105  t -8.4
//   EXTENSION_EXHAUSTION  >0.0 ATR   -0.0719 +-0.0107   t  -6.8
//                         >1.0 ATR   -0.0205 +-0.0048   t  -4.3
//   ADVERSE_STRUCTURE     >0.0 ATR   -0.0542 +-0.0222   t  -2.4
//                         >1.0 ATR   +0.0005 +-0.0005   t  +1.0
//
// Twenty-five configurations, not one of them positive. The best was
// indistinguishable from zero while firing on 18% of trades.
//
// WHY, and it is the same reason every time: THIS ENTRY IS EARLY. On the
// same capture, median adverse excursion beats median favourable
// excursion until roughly candle 48 - 1.17 ATR against 0.70 ATR within
// the first 8 candles. Large early drawdown is the NORMAL life of a
// winning trade here, so any rule that tightens on adverse movement
// (breakeven, trailing, no-progress) cuts the winners, and any rule that
// banks into strength (extension exhaustion) gives up the tail that has
// to pay for a 52% stop-out rate. Breakeven armed at 0.5 ATR turned 43.9%
// take-profits into 7.3%.
//
// So this exists as APPARATUS, deliberately inert: the mechanism to act
// on an open position, ready for a rule that earns its way on. Turning
// any of it on means re-running that comparison and beating zero.
//
// CAVEATS ON THOSE NUMBERS. One five-day window in one regime (a +9.27%
// median altcoin rally), and the baseline it is measured against is
// itself mostly that rally rather than edge. The comparisons are
// relative and perfectly paired, which makes them far more robust than
// the absolute level - but a January-February capture could still change
// the ordering, and nothing here has been tested out of sample in time.
// =====================================================================

/**
 * Which rule asked for the exit. Recorded so an export can be grouped by
 * it; `closeReason` alone only says MANAGED.
 *
 * DUPLICATED as a string union on PositionEntry["managedExit"] in
 * interfacesv2.ts, deliberately - the interfaces file must not import
 * from this one, which imports from it. Keep the two in sync.
 */
export type ManagedExitRule =
    | "BREAKEVEN_STOP"
    | "TRAILING_GIVEBACK"
    | "EXTENSION_EXHAUSTION"
    | "ADVERSE_STRUCTURE"
    | "NO_PROGRESS";

export interface PositionManagementConfig {
    /**
     * Once the position's best favourable excursion (as of the PREVIOUS
     * candle) exceeds this many ATR, move the stop to entry plus the
     * round-trip taker fee. 0 disables.
     *
     * Entry itself is NOT breakeven: exiting at the entry price still
     * pays two taker fees. The level used is the one that actually
     * returns zero.
     */
    breakevenArmAtr: number;
    /**
     * Once the best favourable excursion (as of the PREVIOUS candle)
     * exceeds trailArmAtr, keep the stop trailGiveBackAtr below that
     * peak. 0 on either disables.
     */
    trailArmAtr: number;
    trailGiveBackAtr: number;
    /**
     * Close at this candle's close when it closes more than this many
     * ATR beyond the prior `extremeLookback` extreme in the position's
     * OWN favourable direction - bank into the extension. null disables.
     */
    extensionExitAtr: number | null;
    /**
     * Close at this candle's close when it closes more than this many
     * ATR beyond the prior `extremeLookback` extreme AGAINST the
     * position - the structure the trade was taken on has broken.
     * null disables.
     */
    adverseStructureAtr: number | null;
    /**
     * At exactly this many candles after entry, close if the best
     * favourable excursion so far has not exceeded noProgressMinFavAtr.
     * Evaluated once, on that candle only. 0 disables.
     */
    noProgressCandles: number;
    noProgressMinFavAtr: number;
    /**
     * Lookback for the prior extreme used by the two extension rules.
     * 96 candles = 24h on 15m. Measured: shorter windows were uniformly
     * worse for the entry filters, and the extension research found the
     * effect flat in threshold, so this is the one structural parameter
     * here with any support behind it.
     */
    extremeLookback: number;
}

/**
 * Every rule off. This is the default, so a caller that does not pass a
 * config is provably unchanged from before this section existed.
 */
export const POSITION_MANAGEMENT_OFF: PositionManagementConfig = {
    breakevenArmAtr: 0,
    trailArmAtr: 0,
    trailGiveBackAtr: 0,
    extensionExitAtr: null,
    adverseStructureAtr: null,
    noProgressCandles: 0,
    noProgressMinFavAtr: 0,
    extremeLookback: 96,
};

export interface PositionManagementDecision {
    /**
     * A new stop price, or null to leave the stop alone. Only ever moves
     * the stop in the position's favour, so applying it twice for the
     * same candle is idempotent - which matters, because the rolling
     * simulation re-walks its whole window on every shift and will
     * evaluate the same candle many times.
     */
    stopTo: number | null;
    /** A close-now instruction, or null. Fills at this candle's close. */
    exit: { rule: ManagedExitRule; detail: string } | null;
}

/**
 * Best favourable excursion in ATR, over candles openGi+1 .. gi
 * INCLUSIVE.
 *
 * Including candle `gi` is not look-ahead. By the time this runs, candle
 * `gi` is complete - updatePositionEntry has already resolved it against
 * the stop and target in force for it - and any stop this arms applies
 * from candle gi+1 onward. The within-candle ordering problem (a candle
 * carries a high, a low and a close but no sequence) only bites a rule
 * that acts on candle gi's extreme DURING candle gi, which this does
 * not. An earlier version of this function stopped at gi-1 and armed
 * every stop one candle late, which did not match the offline
 * measurement the header quotes.
 *
 * NOT read from position.mfe / position.mfePrice even though mfePrice
 * holds exactly this value after updatePositionEntry: deriving it from
 * the candle array makes the function independent of call order and of
 * the shared mutable PositionEntry (engine invariant 5), so it cannot
 * silently read a stale or a future peak. position.mfe would be wrong
 * outright - it re-normalises by each candle's own ATR, so it is not
 * comparable to a fixed price level (invariant 4).
 *
 * Normalised by ATR AT ENTRY, so it is comparable to sl and tp, which
 * are fixed prices derived from entry ATR.
 */
function peakFavourableAtr(position: PositionEntry, candles: CandleInfo[], gi: number): number {
    const atr = position.atrAtEntry > 0 ? position.atrAtEntry : 0;
    if (!(atr > 0)) return 0;
    let best = 0;
    for (let j = position.openGi + 1; j <= gi && j < candles.length; j++) {
        const reach = position.side === "LONG"
            ? candles[j].high - position.entryPrice
            : position.entryPrice - candles[j].low;
        if (reach > best) best = reach;
    }
    return best / atr;
}

/**
 * How far this candle's close sits beyond the prior `lookback` extreme,
 * in ATR at entry. Positive means it closed past it.
 *
 * `favourable` picks which extreme: for a LONG, the favourable side is
 * the prior high (price broke out upward) and the adverse side is the
 * prior low. Mirrored for a SHORT. The window ENDS at gi-1, so the
 * current candle is never part of the extreme it is being compared to.
 */
function closeBeyondExtremeAtr(
    position: PositionEntry,
    candles: CandleInfo[],
    gi: number,
    lookback: number,
    favourable: boolean
): number | null {
    const atr = position.atrAtEntry > 0 ? position.atrAtEntry : 0;
    if (!(atr > 0) || gi < 1) return null;
    const start = Math.max(0, gi - lookback);
    if (start >= gi) return null;
    let high = -Infinity;
    let low = Infinity;
    for (let j = start; j < gi; j++) {
        if (candles[j].high > high) high = candles[j].high;
        if (candles[j].low < low) low = candles[j].low;
    }
    if (!isFinite(high) || !isFinite(low)) return null;
    const close = candles[gi].close;
    const upward = position.side === "LONG" ? favourable : !favourable;
    return upward ? (close - high) / atr : (low - close) / atr;
}

/**
 * Decides what to do with an ALREADY-OPEN position on candle `gi`.
 * Pure: reads, never mutates. Returns nulls when nothing applies.
 *
 * CALL ORDER MATTERS. Call this AFTER updatePositionEntry for the same
 * candle, and only while `position.status === "OPEN"`. A stop or target
 * touched on this candle takes precedence over any discretionary exit -
 * that is how the offline replay resolved it, and resolving it the other
 * way would let a managed exit rescue a trade that had already been
 * stopped out, which is look-ahead in the most expensive direction.
 *
 * A returned `stopTo` applies from the NEXT candle, because this candle
 * has already been evaluated against the stop that was in force for it.
 *
 * Every input is candle `gi`'s close or earlier.
 */
export function evaluatePositionManagement(
    position: PositionEntry,
    candles: CandleInfo[],
    gi: number,
    config: PositionManagementConfig = POSITION_MANAGEMENT_OFF
): PositionManagementDecision {
    const none: PositionManagementDecision = { stopTo: null, exit: null };
    if (position.status !== "OPEN") return none;
    if (gi <= position.openGi || gi >= candles.length) return none;
    const atr = position.atrAtEntry > 0 ? position.atrAtEntry : 0;
    if (!(atr > 0)) return none;

    const isLong = position.side === "LONG";
    const peak = peakFavourableAtr(position, candles, gi);

    // ---- stop moves. Both only ever tighten, and only in the
    // position's favour, so repeated evaluation of the same candle
    // converges on the same value.
    let stopTo: number | null = null;
    const proposeStop = (price: number): void => {
        const better = isLong ? price > position.sl : price < position.sl;
        if (!better) return;
        // NO "wrong side of current price" GUARD, deliberately. An earlier
        // version refused to move the stop past the current close, which
        // sounds prudent and is wrong twice over: it silently blocks
        // arming in exactly the case a breakeven stop exists for - price
        // spiked, armed the rule, then gave it all back before the candle
        // closed - and it made this code stop matching the offline
        // measurement the header quotes (46 of 2,612 breakeven trades and
        // 140 of 2,604 trailing trades diverged, all in the rule's favour,
        // which is the direction that flatters a backtest).
        //
        // A stop that lands on the wrong side of price is a stop the
        // market has already passed. updatePositionEntry then closes the
        // position on the next candle at min(open, sl) for a LONG - the
        // gap-aware fill - which is what happens to a resting stop placed
        // through the market. The approximation is that a real exchange
        // would trigger it on this candle rather than the next; next
        // open is normally within a tick of this close.
        if (stopTo == null || (isLong ? price > stopTo : price < stopTo)) stopTo = price;
    };

    if (config.breakevenArmAtr > 0 && peak > config.breakevenArmAtr) {
        // round trip as a fraction of notional, taken from PnlUtility so
        // the rate lives in exactly one place
        const roundTripFraction = PnlUtility.calculateTakerFeeOnNotional(1) * 2;
        const offset = position.entryPrice * roundTripFraction;
        proposeStop(isLong ? position.entryPrice + offset : position.entryPrice - offset);
    }
    if (config.trailArmAtr > 0 && config.trailGiveBackAtr > 0 && peak > config.trailArmAtr) {
        const peakPrice = isLong
            ? position.entryPrice + peak * atr
            : position.entryPrice - peak * atr;
        const give = config.trailGiveBackAtr * atr;
        proposeStop(isLong ? peakPrice - give : peakPrice + give);
    }

    // ---- discretionary exits, all filling at this candle's close.
    // First match wins; the order is fixed so the result is
    // deterministic, and the reason recorded is the rule that fired.
    let exit: PositionManagementDecision["exit"] = null;

    if (exit == null && config.extensionExitAtr != null) {
        const beyond = closeBeyondExtremeAtr(position, candles, gi, config.extremeLookback, true);
        if (beyond != null && beyond > config.extensionExitAtr) {
            exit = {
                rule: "EXTENSION_EXHAUSTION",
                detail: `closed ${beyond.toFixed(2)} ATR beyond the prior ${config.extremeLookback}-candle extreme, in favour`,
            };
        }
    }
    if (exit == null && config.adverseStructureAtr != null) {
        const beyond = closeBeyondExtremeAtr(position, candles, gi, config.extremeLookback, false);
        if (beyond != null && beyond > config.adverseStructureAtr) {
            exit = {
                rule: "ADVERSE_STRUCTURE",
                detail: `closed ${beyond.toFixed(2)} ATR beyond the prior ${config.extremeLookback}-candle extreme, against`,
            };
        }
    }
    if (exit == null && config.noProgressCandles > 0 && gi - position.openGi === config.noProgressCandles) {
        // peak already includes candle gi, so the check at candle N sees
        // exactly N candles of evidence
        if (peak <= config.noProgressMinFavAtr) {
            exit = {
                rule: "NO_PROGRESS",
                detail: `best reach ${peak.toFixed(2)} ATR after ${config.noProgressCandles} candles`,
            };
        }
    }

    return { stopTo, exit };
}

/**
 * Applies a decision from evaluatePositionManagement.
 *
 * A stop move is written straight onto the position. An exit closes it
 * at this candle's close, reusing forceClosePosition so the pnl formula,
 * the exit taker fee and the index-based walkingPnl write are the single
 * shared implementation rather than a second copy that can drift.
 *
 * Returns true when the position was CLOSED, so the caller can stop
 * advancing it.
 */
export function applyPositionManagement(
    position: PositionEntry,
    candle: CandleInfo,
    closeGi: number,
    decision: PositionManagementDecision
): boolean {
    if (decision.stopTo != null) position.sl = decision.stopTo;
    if (decision.exit == null) return false;
    forceClosePosition(position, candle, closeGi, "MANAGED");
    // The rule that asked for it. closeReason only says MANAGED, and an
    // export that cannot tell a trailing stop from a structure break
    // cannot be used to judge either.
    position.managedExit = { rule: decision.exit.rule, detail: decision.exit.detail };
    return true;
}