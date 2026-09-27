/**
 * DATE-WINDOW INTEGRITY for a range-bounded run.
 *
 * ---------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO CATCH
 * ---------------------------------------------------------------------
 * Binance returns a symbol's EARLIEST AVAILABLE klines when the requested
 * startTime precedes its listing date. It does not error and it does not
 * return an empty array - it returns 500 perfectly valid candles from a
 * completely different calendar period.
 *
 * So a run configured 2026-01-01 -> 2026-02-27 quietly simulated 24 symbols
 * over March through August, because those symbols did not exist in January.
 * Measured on the rolling run exported 2026-09-27: 330 of 1,970 resolved
 * positions (16.8%) opened outside the configured window, spread across six
 * months, and they were the ONLY profitable cohort in the run (+0.1073R
 * against the in-window -0.1618R). Every conclusion drawn from that run was
 * therefore drawn from a mixture of periods, with the wrong sign contributed
 * by the part that should not have been there.
 *
 * Why it matters more than a 17% data-quality nuisance:
 *
 *   1. THE PORTFOLIO IS NOT A PORTFOLIO. The rolling engine advances all
 *      symbols by tick INDEX. Two positions counted against the same cap,
 *      the same per-tick budget and the same liquidation check can be five
 *      months apart in real time. Concurrency, correlation and drawdown are
 *      then measuring a market that never existed.
 *   2. FUNDING IS ATTRIBUTED TO THE WRONG MOMENT. fundingCost.ts accrues
 *      against each symbol's OWN settlement timestamps, so the per-symbol
 *      arithmetic stays correct and the integrity block still reconciles.
 *      This defect is invisible to that check - which is the point of
 *      "reconciliation between two values written by the same code path
 *      proves nothing", one layer out again.
 *   3. IT MIXES REGIMES BY CONSTRUCTION, which is the time confounding the
 *      measurement discipline warns about, arriving through the data loader
 *      rather than through the analysis.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------
 * It reports. It does not silently drop symbols, because a silent drop is
 * how the problem arrived. The caller decides between excluding a symbol,
 * truncating it, or running anyway with the leak recorded in the export.
 *
 * Pure functions over plain data, no dependency on the app's type graph, so
 * it runs against a parsed export file exactly as simulationSummary.ts and
 * fundingCost.ts do.
 */

/** Milliseconds in one 15-minute candle. */
export const CANDLE_MS = 15 * 60 * 1000;

/** The minimum a caller must give us: a symbol name and its candle opens. */
export interface SymbolWindow {
    symbol: string;
    /** openTime of the FIRST candle actually returned, in ms. */
    firstOpenTime: number;
    /** openTime of the LAST candle actually returned, in ms. */
    lastOpenTime: number;
    candleCount: number;
}

export interface WindowRequest {
    /** Inclusive lower bound, ms. */
    startMs: number;
    /**
     * Exclusive upper bound, ms. A run with no configured end date should
     * pass Number.POSITIVE_INFINITY rather than a sentinel, so the
     * comparisons below stay ordinary comparisons.
     */
    endMs: number;
    /**
     * How far after `startMs` a symbol's first candle may sit before it is
     * treated as a listing-date substitution rather than as the ordinary
     * fact that 15m candles do not begin at exactly the requested instant.
     *
     * ARBITRARY IN MAGNITUDE, and said plainly: there is no argument that
     * picks 8 candles over 4 or 40. The DIRECTION has one - a symbol listed
     * inside the requested range is a real symbol with a short history,
     * while a symbol whose data begins months later is a different period
     * wearing the same name - and any tolerance small relative to the range
     * separates those two cases identically. Two hours is chosen as "long
     * enough to absorb an exchange-side alignment or a brief gap, short
     * enough that no realistic listing delay hides inside it".
     */
    toleranceMs?: number;
}

export type WindowVerdict =
    /** Data begins and ends inside the requested range. Nothing to report. */
    | "IN_WINDOW"
    /**
     * Data begins later than requested by more than the tolerance, but still
     * overlaps the range. Usually a symbol listed mid-range: legitimate, and
     * worth knowing about because its history is shorter than every other
     * symbol's and it joins the portfolio partway through.
     */
    | "LATE_START"
    /**
     * Data does not overlap the requested range at all. This is the listing
     * substitution: the loader asked for January and was handed May.
     */
    | "OUT_OF_WINDOW"
    /** Data extends past the requested end. Truncation was not applied. */
    | "OVERRUNS_END"
    /** No candles at all. */
    | "EMPTY";

export interface SymbolVerdict extends SymbolWindow {
    verdict: WindowVerdict;
    /** How late the first candle is relative to startMs, in ms. Negative = early. */
    startLagMs: number;
    /** Candles that fall inside [startMs, endMs). Bounded by candleCount. */
    candlesInWindow: number;
}

export interface WindowIntegrityReport {
    request: Required<WindowRequest>;
    symbols: SymbolVerdict[];
    counts: Record<WindowVerdict, number>;
    /**
     * Symbols the caller should exclude for a clean measurement. OUT_OF_WINDOW
     * and EMPTY only - LATE_START symbols are real and excluding them would
     * throw away every recently listed perp, which is a sampling choice the
     * caller should make knowingly rather than inherit from a helper.
     */
    excludeSymbols: string[];
    /** True when nothing needs excluding. Check this, then read the rest. */
    clean: boolean;
}

const DEFAULT_TOLERANCE_MS = 8 * CANDLE_MS; // two hours; see WindowRequest

/**
 * Classify one symbol's returned data against the requested range.
 *
 * Deliberately total: every combination of the three comparisons produces a
 * verdict, so there is no input for which this returns undefined and the
 * caller silently treats it as fine.
 */
export function classifySymbolWindow(
    win: SymbolWindow,
    req: Required<WindowRequest>
): SymbolVerdict {
    const { startMs, endMs, toleranceMs } = req;
    const startLagMs = win.firstOpenTime - startMs;

    if (!(win.candleCount > 0)) {
        return { ...win, verdict: "EMPTY", startLagMs, candlesInWindow: 0 };
    }

    // Candles inside the range. Computed from the bounds rather than counted,
    // because the caller may only have the endpoints - and a contiguous 15m
    // series makes the two identical. A series with internal gaps overstates
    // here; that is a separate defect and is not what this module claims to
    // detect.
    const lo = Math.max(win.firstOpenTime, startMs);
    const hi = Math.min(win.lastOpenTime, endMs - 1);
    const candlesInWindow = hi >= lo
        ? Math.min(win.candleCount, Math.floor((hi - lo) / CANDLE_MS) + 1)
        : 0;

    // No overlap at all - the listing substitution. Checked FIRST: a symbol
    // whose data is months late is also "late starting", and reporting it as
    // LATE_START would understate it to exactly the reader who needs to know.
    if (win.firstOpenTime >= endMs || win.lastOpenTime < startMs) {
        return { ...win, verdict: "OUT_OF_WINDOW", startLagMs, candlesInWindow: 0 };
    }
    if (startLagMs > toleranceMs) {
        return { ...win, verdict: "LATE_START", startLagMs, candlesInWindow };
    }
    if (win.lastOpenTime >= endMs) {
        return { ...win, verdict: "OVERRUNS_END", startLagMs, candlesInWindow };
    }
    return { ...win, verdict: "IN_WINDOW", startLagMs, candlesInWindow };
}

export function checkWindowIntegrity(
    windows: SymbolWindow[],
    req: WindowRequest
): WindowIntegrityReport {
    const full: Required<WindowRequest> = {
        startMs: req.startMs,
        endMs: req.endMs,
        toleranceMs: req.toleranceMs ?? DEFAULT_TOLERANCE_MS,
    };
    const symbols = windows.map((w) => classifySymbolWindow(w, full));
    const counts: Record<WindowVerdict, number> = {
        IN_WINDOW: 0, LATE_START: 0, OUT_OF_WINDOW: 0, OVERRUNS_END: 0, EMPTY: 0,
    };
    for (const s of symbols) counts[s.verdict] += 1;
    const excludeSymbols = symbols
        .filter((s) => s.verdict === "OUT_OF_WINDOW" || s.verdict === "EMPTY")
        .map((s) => s.symbol);
    return { request: full, symbols, counts, excludeSymbols, clean: excludeSymbols.length === 0 };
}

/**
 * The same check applied AFTER a run, to the positions it produced.
 *
 * Two reasons this exists alongside the candle-level check rather than being
 * folded into it. First, an existing export can be audited without re-running
 * anything, which is how the 16.8% figure above was found. Second, the two can
 * disagree: candles inside the window can still produce an out-of-window
 * position if a symbol's series has an internal gap, and a disagreement is
 * information rather than a contradiction.
 */
export interface PositionWindowAudit {
    total: number;
    inWindow: number;
    outOfWindow: number;
    outOfWindowFraction: number;
    /** Symbols contributing at least one out-of-window position. */
    offendingSymbols: string[];
    /** Earliest and latest out-of-window openTime, ms, or null when none. */
    outOfWindowRange: { firstMs: number; lastMs: number } | null;
}

export function auditPositionWindows(
    positions: { symbol: string; openTime: number }[],
    req: WindowRequest
): PositionWindowAudit {
    const { startMs, endMs } = req;
    const out = positions.filter((p) => p.openTime < startMs || p.openTime >= endMs);
    const times = out.map((p) => p.openTime);
    return {
        total: positions.length,
        inWindow: positions.length - out.length,
        outOfWindow: out.length,
        outOfWindowFraction: positions.length ? out.length / positions.length : 0,
        offendingSymbols: Array.from(new Set(out.map((p) => p.symbol))).sort(),
        outOfWindowRange: times.length
            ? { firstMs: Math.min(...times), lastMs: Math.max(...times) }
            : null,
    };
}