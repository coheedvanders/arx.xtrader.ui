// Intended location: src/utility/v2/analysis/checkTestPosition.ts

import type { CandleInfo } from "@/core/interfacesv2";
import type { TestPosition } from "@/utility/testPositionDb";
import { PnlUtility } from "@/utility/PnlUtility";

export interface TestPositionCheckResult {
    status: "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS";
    resolvedAt: number | null;
    resolvedPrice: number | null;
    pnlPercent: number | null;
    pnl: number | null;
}

/**
 * Scans candles from the position's own entryOpenTime forward, checking
 * whether TP or SL was reached first — same core logic as the reference
 * simulator this was built from, just expressed as "scan and return the
 * first hit" instead of "loop mutating state candle by candle", since
 * this only ever needs the FINAL outcome, not a per-candle history.
 *
 * AMBIGUOUS: if a single candle's range touches BOTH TP and SL (a large
 * wick), there's no way to know which happened first without intra-
 * candle data. This matches the reference simulator's own "MID" outcome
 * exactly: neither a definite win nor loss, and — also matching that
 * reference — no PnL is estimated for it either (the reference sets
 * status "MID" and clears the position without ever computing PnL for
 * that branch). This replaces an EARLIER version of this function that
 * resolved the same case as a conservative LOSS — that was this
 * function's own guess before the actual working reference was
 * available; now it matches the reference, not a guess.
 *
 * PnL estimation, via PnlUtility (the same utility a real position's own
 * PnL is computed with elsewhere in the app):
 *   - WIN: calculatePNLPercent/calculateEstimatedPnl marked against TP.
 *   - LOSS: same, marked against SL.
 *   - ACTIVE (still open): same, marked against the most recent candle's
 *     close — an unrealized estimate, exactly like the reference
 *     simulator's own "still OPEN" branch.
 *   - AMBIGUOUS: no PnL estimated, matching the reference.
 * `position.margin` and `position.maxLeverage` are the calculation basis
 * — captured once at creation time, not re-fetched here.
 */
export function checkTestPosition(position: TestPosition, candles: CandleInfo[]): TestPositionCheckResult {
    const relevant = candles.filter(c => c.openTime >= position.entryOpenTime);
    const apiSide = position.side === "LONG" ? "BUY" : "SELL";

    const estimate = (targetPrice: number): { pnlPercent: number; pnl: number } => {
        const pnlPercent = PnlUtility.calculatePNLPercent(position.entry, targetPrice, apiSide, position.maxLeverage);
        const pnl = PnlUtility.calculateEstimatedPnl(position.margin, pnlPercent, position.maxLeverage);
        return { pnlPercent, pnl };
    };

    for (const c of relevant) {
        const hitTp = position.side === "LONG" ? c.high >= position.tp : c.low <= position.tp;
        const hitSl = position.side === "LONG" ? c.low <= position.sl : c.high >= position.sl;

        if (hitTp && hitSl) {
            return { status: "AMBIGUOUS", resolvedAt: c.openTime, resolvedPrice: null, pnlPercent: null, pnl: null };
        }
        if (hitTp) {
            const { pnlPercent, pnl } = estimate(position.tp);
            return { status: "WIN", resolvedAt: c.openTime, resolvedPrice: position.tp, pnlPercent, pnl };
        }
        if (hitSl) {
            const { pnlPercent, pnl } = estimate(position.sl);
            return { status: "LOSS", resolvedAt: c.openTime, resolvedPrice: position.sl, pnlPercent, pnl };
        }
    }

    if (relevant.length > 0) {
        const last = relevant[relevant.length - 1];
        const { pnlPercent, pnl } = estimate(last.close);
        return { status: "ACTIVE", resolvedAt: null, resolvedPrice: null, pnlPercent, pnl };
    }

    // No candle at or after entryOpenTime was found — this happens when
    // the cached snapshot (klineDbUtilityV2.getSymbolInfo reads from
    // IndexedDB, not the live in-memory chart feed) hasn't caught up to
    // whatever candle the position was anchored to. That's a staleness
    // gap in the DATA, not a reason to refuse an estimate: an open
    // position should still get marked to whatever the freshest
    // available price actually is. Falls back to the very last candle in
    // the WHOLE array rather than giving up — confirmed this exact gap
    // via a reproduction before writing this fix, not assumed.
    if (candles.length > 0) {
        const last = candles[candles.length - 1];
        const { pnlPercent, pnl } = estimate(last.close);
        return { status: "ACTIVE", resolvedAt: null, resolvedPrice: null, pnlPercent, pnl };
    }

    return { status: "ACTIVE", resolvedAt: null, resolvedPrice: null, pnlPercent: null, pnl: null };
}