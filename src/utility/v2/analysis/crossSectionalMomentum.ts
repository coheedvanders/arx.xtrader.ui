/**
 * CROSS-SECTIONAL MOMENTUM - the only entry with a measured signal.
 *
 * =====================================================================
 * WHY THIS MODULE EXISTS, AND WHY IT IS NOT A TRIGGER
 * =====================================================================
 * Every per-symbol trigger tested on a clean 35-day dataset landed within noise
 * of a random entry ON ITS OWN SIDE MIX. What DID measure is relative: rank the
 * universe by trailing return, buy the top decile and sell the bottom decile in
 * equal number. That cannot be expressed by `checkPositionEntry`, which sees one
 * symbol and cannot know how it ranks against the other 298. So this is a
 * PORTFOLIO decision, and it lives in its own module for the same reason the
 * position cap and the per-tick budget live in the lab component.
 *
 * It is market-neutral BY CONSTRUCTION - equal numbers of longs and shorts, at
 * the same instant, from the same universe. That is the point. The measured
 * result it replaces was dominated by one number: 2026-01-01 -> 02-06 is a
 * -23.7% median crash across 299 symbols with only 10% of them up, and a random
 * LONG entry in it earns -0.19R against a random SHORT's +0.13R. A long-only book
 * cannot be rescued by entry selection in a window like that, and a book that
 * takes equal sides has the move cancel inside every rebalance.
 *
 * =====================================================================
 * THE EVIDENCE, AND ITS LIMITS
 * =====================================================================
 * DATASET  299 archived Binance USDT-M symbols, 15m, 2026-01-01 -> 02-06, 3,560
 *          contiguous candles each, zero gaps. 37 symbols excluded because their
 *          archive begins later than the requested start (see windowIntegrity.ts).
 *          ATR recomputed at period 8 and validated exactly against all 275,054
 *          stored values.
 * BOOK     rank by trailing 96-candle return, long top 10% / short bottom 10%,
 *          hold 384 candles (4 days), exit at the close, no stop.
 * METRIC   netR against a FIXED 3-ATR risk unit for every variant, so a wider
 *          stop cannot look better merely by rescaling its own denominator.
 *
 *   arm            mean netR     paired control
 *   forward        +0.4397       -
 *   reversed       -0.5147       long the losers, short the winners
 *   shuffled       +0.0357       same legs, same dates, ranks shuffled
 *
 * The ranking therefore carries about +0.48R of information and the shuffled
 * control is flat. Robust to the rebalance clock: across 96 distinct rebalance
 * times of day, 98% of them give a positive mean (mean of means +0.3575, sd
 * 0.1769), so this is not an artifact of rebalancing at one hour.
 *
 * WHAT IT IS NOT. It rests on roughly 8-9 INDEPENDENT four-day periods inside a
 * single 38-day window in a single regime. The 33 rebalances quoted above are 4
 * intraday offsets over those same periods, so their forward windows overlap
 * heavily and the +-0.1499 standard error is optimistic; on the independent
 * count the effect is about t 1.5, not t 2.9. Cross-sectional momentum at
 * multi-day horizons is a documented crypto effect, which is a reason to take
 * this seriously and not a reason to treat it as established here.
 * NOT TESTED OUT OF SAMPLE IN TIME BEYOND 2026-02-06.
 *
 * =====================================================================
 * THE CONSTRAINT THAT DECIDES WHETHER ANY OF THIS IS TRADEABLE
 * =====================================================================
 * The edge needs room. Reimposing a stop at this horizon costs, measured on the
 * same rebalances:
 *
 *   stop   3 ATR  +0.1041      stop  15 ATR  +0.2161
 *   stop   6 ATR  +0.0531      stop  30 ATR  +0.4128
 *   stop   9 ATR  +0.1016      no stop       +0.4397
 *
 * And leverage caps the stop. At the median ATR of 0.659% of price, a move that
 * wipes out the margin is:
 *
 *   leverage  20x -> 5.0% move -> 7.6 ATR
 *   leverage  10x -> 10% move  -> 15.2 ATR
 *   leverage   5x -> 20% move  -> 30.4 ATR
 *
 * So AT 20x A STOP WIDER THAN ABOUT 7 ATR IS NOT A STOP, IT IS A LIQUIDATION,
 * and the table above says 6-9 ATR retains roughly a fifth of the measured edge.
 * The leverage is the binding constraint, not the entry. A book built on this
 * signal wants ~5x and many small positions, not 20x and a 3-ATR stop.
 *
 * The left tail is why that matters concretely. Unstopped, per position, in
 * 3-ATR units: sd 5.29, median +0.31, 5th percentile -6.67, 1st -11.68, worst
 * observed -84.6, and 20.7% of positions end worse than -3R. A "3-ATR risk
 * budget" with no stop is not a risk budget.
 *
 * =====================================================================
 * DESIGN
 * =====================================================================
 * Pure functions over plain data. No app types, no hidden state, runnable
 * against a parsed export exactly as simulationSummary.ts and fundingCost.ts
 * are. Causality is structural rather than promised: the caller hands in one
 * observation per symbol taken at the SAME candle, and nothing in this file can
 * see a later candle because nothing later is passed in.
 */

/** One symbol's state at a single instant. Everything here is known at that candle's close. */
export interface CrossSectionObservation {
    symbol: string;
    /** Close of the ranking candle. */
    price: number;
    /** ATR at the ranking candle, same units as price. Must be > 0 to be eligible. */
    atr: number;
    /**
     * Trailing return over the lookback, as a fraction. See trailingReturn().
     * A symbol with insufficient history must be passed as null, not 0 - a
     * missing value ranked as zero lands in the middle of the book and is
     * silently traded.
     */
    trailingReturn: number | null;
}

export interface CrossSectionConfig {
    /**
     * Fraction of the eligible universe taken on EACH side. 0.10 measured; the
     * decile profile is monotone enough that nearby values behave similarly, and
     * this is not a calibrated optimum.
     */
    fraction: number;
    /**
     * Minimum eligible symbols before a book is formed at all. Below this the
     * deciles are too small for the cross-section to mean anything, and an
     * unbalanced book reimports the market move it exists to cancel.
     * 40 is ARBITRARY in magnitude; the argument is only that it must be
     * comfortably more than 2/fraction so both legs fill.
     */
    minEligible: number;
    /**
     * Reject a symbol when the round-trip taker fee exceeds this many ATR.
     * ARITHMETIC, not tuning: every level here is ATR-scaled, so a round trip
     * costing more than a fraction of an ATR cannot be paid for by an ATR-scaled
     * move. 0.25 is the working value; the pairs it removes (stablecoin,
     * tokenised gold and tokenised equity perps) cannot pay their own fees.
     */
    maxFeeAtr: number;
    /** Taker fee per side, as a fraction. 0.0005 on Binance USDT-M. */
    takerFee: number;
}

export const CROSS_SECTION_DEFAULTS: CrossSectionConfig = {
    fraction: 0.10,
    minEligible: 40,
    maxFeeAtr: 0.25,
    takerFee: 0.0005,
};

export type BookSide = "LONG" | "SHORT";

export interface BookLeg {
    symbol: string;
    side: BookSide;
    price: number;
    atr: number;
    trailingReturn: number;
    /** 0 = weakest trailing return in the eligible universe, 1 = strongest. */
    rankPercentile: number;
    feeAtr: number;
}

export interface CrossSectionBook {
    legs: BookLeg[];
    eligible: number;
    /** Symbols dropped, with the reason, so a thin book is explainable rather than mysterious. */
    rejected: { symbol: string; reason: "noReturn" | "badAtr" | "badPrice" | "feeTooHigh" }[];
    /** False when the universe was too thin; legs is then empty. */
    formed: boolean;
}

/**
 * Trailing return from a candle array, ending at index `gi`.
 *
 * Reads closes at gi and gi-lookback only, so it is causal by construction.
 * Returns null rather than 0 when the history is short, and when either close is
 * not a positive number - a zero here would rank as "flat" and be traded.
 */
export function trailingReturn(
    closes: readonly number[],
    gi: number,
    lookback: number
): number | null {
    if (!Number.isInteger(gi) || gi < 0 || gi >= closes.length) return null;
    const j = gi - lookback;
    if (j < 0) return null;
    const a = closes[j];
    const b = closes[gi];
    if (!(a > 0) || !(b > 0)) return null;
    return b / a - 1;
}

/**
 * Form the book for one rebalance.
 *
 * LEGS ARE EQUAL IN COUNT. `k = floor(eligible * fraction)` is applied to both
 * sides, so the book cannot drift long or short - which is the whole reason the
 * market move cancels. If the two sides could differ in size, this would become
 * a directional bet with extra steps, which is exactly the failure being
 * corrected.
 *
 * TIES. Symbols are ordered by trailing return ascending, then by symbol name,
 * so an exact tie resolves deterministically instead of by input order. Two runs
 * with the same data therefore produce the same book - the same requirement that
 * made the parallel initialiser commit in roster order.
 */
export function selectBook(
    observations: readonly CrossSectionObservation[],
    config: CrossSectionConfig = CROSS_SECTION_DEFAULTS
): CrossSectionBook {
    const rejected: CrossSectionBook["rejected"] = [];
    const ok: { o: CrossSectionObservation; r: number; feeAtr: number }[] = [];

    for (const o of observations) {
        if (!(o.price > 0)) { rejected.push({ symbol: o.symbol, reason: "badPrice" }); continue; }
        if (!(o.atr > 0)) { rejected.push({ symbol: o.symbol, reason: "badAtr" }); continue; }
        if (o.trailingReturn == null || !Number.isFinite(o.trailingReturn)) {
            rejected.push({ symbol: o.symbol, reason: "noReturn" }); continue;
        }
        const feeAtr = (2 * config.takerFee * o.price) / o.atr;
        if (!(feeAtr <= config.maxFeeAtr)) {
            rejected.push({ symbol: o.symbol, reason: "feeTooHigh" }); continue;
        }
        ok.push({ o, r: o.trailingReturn, feeAtr });
    }

    const eligible = ok.length;
    const k = Math.floor(eligible * config.fraction);
    if (eligible < config.minEligible || k < 1) {
        return { legs: [], eligible, rejected, formed: false };
    }

    ok.sort((a, b) => (a.r - b.r) || a.o.symbol.localeCompare(b.o.symbol));

    const legs: BookLeg[] = [];
    const push = (e: typeof ok[number], side: BookSide, i: number) => legs.push({
        symbol: e.o.symbol, side, price: e.o.price, atr: e.o.atr,
        trailingReturn: e.r,
        rankPercentile: eligible > 1 ? i / (eligible - 1) : 0.5,
        feeAtr: e.feeAtr,
    });
    for (let i = 0; i < k; i++) push(ok[i], "SHORT", i);
    for (let i = eligible - k; i < eligible; i++) push(ok[i], "LONG", i);

    return { legs, eligible, rejected, formed: true };
}

/*
 * REMOVED 2026-09-27: `maxStopAtr` and `leverageForStop`.
 *
 * They existed to make the leverage constraint visible at the call site, and were
 * superseded by `leverageForRiskBudget` below, which answers the question that
 * actually matters - what leverage gives every leg the same risk - rather than the
 * weaker one they answered. An audit of which exports nothing imports found them
 * unreferenced, which is exactly what a superseded helper looks like, so they are
 * deleted rather than left as vocabulary. The arithmetic they held survives in
 * leverageForRiskBudget and in the liquidation-reachability guard inside
 * createCrossSectionalPosition.
 */

/**
 * ATR as the lab computes it: the simple mean of the last `period` true ranges.
 *
 * WHY THIS IS HERE. The caller cannot rely on the derived `candle.atr` the
 * analysis pass attaches, because the lab SKIPS that pass for any symbol with no
 * open position and no permission to open one - which is most symbols on most
 * ticks, and exactly the symbols a ranking needs to see. So the ranking computes
 * its own from raw OHLC.
 *
 * PERIOD 8, NOT 14. `CandleAnalyzerV2.calculateATR` defaults to 14 but the lab
 * calls it with 8; recomputing the archive at 8 reproduces all 275,054 stored
 * values to a relative error under 1e-12, while 14 matches 0.29%. Using 14 here
 * would make every ATR-scaled stop in this book differ from the one measured.
 *
 * TR[k] = max(h[k]-l[k], |h[k]-c[k-1]|, |l[k]-c[k-1]|), and the candle at index 0
 * has no previous close so it contributes no true range - which is why this needs
 * `gi >= period`, not `gi >= period - 1`.
 *
 * Returns null when the history is short or any input is not finite, rather than
 * 0: a zero ATR would make feeAtr infinite and the symbol would be dropped for
 * the wrong reason, or worse, produce a zero-width stop.
 */
const LAB_ATR_PERIOD = 8;

export function simpleAtr(
    highs: readonly number[],
    lows: readonly number[],
    closes: readonly number[],
    gi: number,
    period: number = LAB_ATR_PERIOD
): number | null {
    if (!Number.isInteger(gi) || !Number.isInteger(period) || period < 1) return null;
    if (gi < period || gi >= closes.length) return null;
    if (highs.length !== closes.length || lows.length !== closes.length) return null;
    let sum = 0;
    for (let k = gi - period + 1; k <= gi; k++) {
        const h = highs[k], l = lows[k], prev = closes[k - 1];
        if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(prev)) return null;
        sum += Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
    }
    const atr = sum / period;
    return atr > 0 ? atr : null;
}

/**
 * Split a book into LONG/SHORT PAIRS, ordered strongest-signal-first.
 *
 * WHY PAIRING MATTERS MORE THAN IT LOOKS. The lab's position cap and per-tick
 * budget can stop the book partway through. If the legs are opened in list order,
 * a truncated book is whatever half happened to come first - and a half book is a
 * directional bet, which is precisely the thing this whole approach exists to
 * remove. Opening in pairs means a book cut off at any point is still balanced.
 *
 * Pairs are formed by pairing the strongest long with the weakest short, so a
 * truncated book keeps the most extreme ranks rather than the middling ones. If
 * the two sides differ in length - which selectBook does not produce, but a
 * caller filtering afterwards could - the surplus is dropped rather than opened
 * unpaired.
 */
export function pairLegs(book: CrossSectionBook): { long: BookLeg; short: BookLeg }[] {
    const longs = book.legs.filter((l) => l.side === "LONG")
        .sort((a, b) => b.trailingReturn - a.trailingReturn);
    const shorts = book.legs.filter((l) => l.side === "SHORT")
        .sort((a, b) => a.trailingReturn - b.trailingReturn);
    const n = Math.min(longs.length, shorts.length);
    const out: { long: BookLeg; short: BookLeg }[] = [];
    for (let i = 0; i < n; i++) out.push({ long: longs[i], short: shorts[i] });
    return out;
}

/**
 * How many LONG/SHORT pairs the portfolio can actually fund and hold.
 *
 * EXTRACTED SO IT CAN BE TESTED. The balance property - a truncated book is still
 * balanced - is the whole reason this approach removes the regime, and it is
 * decided entirely by this arithmetic. Left inline in the opening loop it would
 * only ever be asserted in a comment.
 *
 * Both limits are PAIR-WISE on purpose. A pair costs two margins and two cap
 * slots, so a book that can fund an odd number of legs funds one fewer pair
 * rather than opening the spare leg unpaired.
 *
 * `openCount` and `budget` must be the RUNNING within-tick totals, not values
 * derived from `balance` or an open-positions list - those update once per tick,
 * after every symbol has been processed, and a gate reading them is already
 * wrong. That failure recurred three times at three different layers.
 */
export function planCrossSectionOpens(args: {
    /** Pairs available from pairLegs(). */
    pairsAvailable: number;
    /** Concurrency cap in force for this tick. */
    cap: number;
    /** Positions already opened this tick, running. */
    openCount: number;
    /** Free budget remaining this tick, running. */
    budget: number;
    /** Margin per position, frozen for this tick. */
    margin: number;
}): number {
    const { pairsAvailable, cap, openCount, budget, margin } = args;
    if (!(pairsAvailable > 0)) return 0;
    if (!(margin > 0)) return 0;
    const bySlots = Math.floor(Math.max(0, cap - openCount) / 2);
    const byBudget = Math.floor(Math.max(0, budget) / (2 * margin));
    return Math.max(0, Math.min(pairsAvailable, bySlots, byBudget));
}

/**
 * Leverage that makes a `stopAtr`-wide stop cost exactly `riskFraction` of the
 * position's margin.
 *
 * WHY THIS EXISTS, and it was a real defect. The book was first wired with a
 * FIXED leverage of 5x and a fixed 30-ATR stop, on the reasoning that at the
 * MEDIAN ATR of 0.659% of price a 30-ATR move is 19.8% and so sits inside 5x's
 * 20% liquidation distance. The median was the wrong statistic: on real archive
 * candles the widest 30-ATR stop in a single book was 70.9% of price, three and a
 * half times past its own liquidation point. Those positions would have been
 * liquidated instead of stopped, at a loss of the whole margin, and the run would
 * have looked like a strategy failing rather than a sizing bug.
 *
 * The fix is not a wider tolerance, it is the right variable. Every measurement
 * behind this book is in R - return per unit of RISK - so the deployable form is
 * constant risk per position, which means leverage must fall as volatility rises:
 *
 *     lossAtStop = margin * leverage * stopAtr * (atr / price)
 *     so  leverage = riskFraction / (stopAtr * atr / price)
 *     gives  lossAtStop = margin * riskFraction, the same for every symbol.
 *
 * And because liquidation sits at a move of 1/leverage while the stop sits at
 * stopAtr*atr/price, any riskFraction below 1 puts the stop strictly inside
 * liquidation - by construction, not by luck.
 *
 * `maxLeverage` is a ceiling for low-volatility symbols, where the formula would
 * otherwise ask for more leverage than an exchange offers.
 */
export function leverageForRiskBudget(
    atr: number,
    price: number,
    stopAtr: number,
    riskFraction: number,
    maxLeverage: number
): number | null {
    if (!(atr > 0) || !(price > 0) || !(stopAtr > 0)) return null;
    if (!(riskFraction > 0) || !(riskFraction < 1)) return null;
    if (!(maxLeverage > 0)) return null;
    const stopMove = (stopAtr * atr) / price;
    if (!(stopMove > 0)) return null;
    // A stop wider than the whole price cannot exist for a long, and cannot be
    // funded for a short either - refuse rather than return a leverage below 1.
    if (stopMove >= 1) return null;
    const lev = riskFraction / stopMove;
    if (!(lev > 0) || !Number.isFinite(lev)) return null;
    return Math.min(lev, maxLeverage);
}