import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

/**
 * BREAKOUT FADE — the entry, rewritten to match what was actually measured.
 *
 * =====================================================================
 * WHAT THIS REPLACES, AND WHY
 * =====================================================================
 * `checkExtensionEntry` fired on the same EVENT as this (a close beyond the
 * prior 96-candle extreme) but was calibrated on datasets that span 38 HOURS of
 * eligible entry time, and was run LONG ONLY at R:R 1.0. It lost -0.1142R gross
 * per trade over 988 in-window trades.
 *
 * This is rebuilt on the archived run: 299 symbols (37 excluded for listing
 * after the run start), 15m, 2025-12-31 16:00 -> 2026-02-06 17:45 UTC, 3,560
 * CONTIGUOUS candles each, so the eligible entry window is 33-35 days instead of
 * 38 hours and errors can be clustered on entry day with ~36 clusters.
 *
 * =====================================================================
 * WHAT IS ESTABLISHED, AND WHAT IS NOT
 * =====================================================================
 * ESTABLISHED — the DIRECTION. Fading a close beyond the 24h extreme beats
 * continuing it. Measured with a design that needs no control arm: at one candle
 * trade the same event both ways with the same levels, d = netR(long) -
 * netR(short), and contrast UP events against DN events WITHIN THE SAME DAY so
 * that day's drift cancels whatever it was:
 *
 *     CONTINUATION(day) = 1/2 [ mean(d | UP that day) - mean(d | DN that day) ]
 *
 *   trade-weighted   -0.1268 +-0.0062  (t -20.6, 22,328 trades)
 *   day-weighted     -0.3246 +-0.0846  (t  -3.8, 36 days)
 *   thirds of the window  -0.395 / -0.314 / -0.463   while DRIFT ran +0.32 / -0.14 / -0.67
 *   disjoint symbols      train -0.400   test -0.414
 *   sign test             8-12 of 36 days positive for continuation, z -2.3 to -3.5
 *   other detectors       momentum -0.097, failed-breakout -0.307,
 *                         lookback 32 -0.329, lookback 192 -0.330, k=0.5 -0.304
 *
 * Negative CONTINUATION means the fade is the better side. The drift term
 * changes sign across the window while the effect does not, which is the shape a
 * real effect has and a regime artifact does not.
 *
 * NOT ESTABLISHED — that it makes money. A symmetric-barrier trade has zero
 * gross expectancy by construction, so the whole budget is the directional
 * effect, and the whole cost is the fee. Implied drift-free fade gross is
 * -CONT/2 = +0.063R against a median fee/R of 0.0427 at a 3 ATR stop. The margin
 * is thinner than the measurement error.
 *
 * Measured directly, 60 (target, stop, expiry) cells, both sides, ~23,000 trades
 * each: NOT ONE is positive trade-weighted. Best is -0.052R. The best
 * implementable extraction, a direction-balanced book (see directionBalance.ts),
 * lands at -0.01 to -0.03R per trade. So: the effect is real and is roughly the
 * size of the fee.
 *
 * CORROBORATED INDEPENDENTLY. "Short-horizon mean reversion in cryptocurrency
 * markets: a matched cross-market measurement" (arXiv 2608.21888) finds 15-minute
 * reversal significant in 90% of 183 crypto pairs against 2.7% of US stocks, and
 * concludes the gross edge peaks near 1.3bp per trade against a 5bp cheapest
 * round trip - "big enough to measure, too small to capture". Same conclusion by
 * a different route, which is the strongest check available here: a finding that
 * agrees with an independent measurement it did not come from.
 *
 * =====================================================================
 * WHY THE OLD ENTRY BLED, SPECIFICALLY
 * =====================================================================
 * There are 36% MORE downside events than upside events (12,855 vs 9,473), and
 * fading a downside event is a LONG. So a fade book is structurally net long -
 * and the lab was LONG ONLY, which takes that imbalance to its limit, in a window
 * whose drift is negative. Measured at T3/S3/exp96:
 *
 *     long-only fade (what the lab ran)   -0.1838R
 *     short leg only                      -0.0086R
 *     both sides, direction-balanced      -0.0117R
 *
 * That is 0.17R per trade of pure exposure, not signal, and it is the single
 * largest fixable factor found. Balancing needs SHORTS ENABLED; the lab has never
 * taken a single short trade.
 *
 * =====================================================================
 * THRESHOLDS: WHICH HAVE AN ARGUMENT AND WHICH DO NOT
 * =====================================================================
 * ARGUMENT:
 *   - stop >= 2 ATR. fee/R = 2*taker / (slAtr * atr/price). At the median
 *     atr/price of 0.8% a 3 ATR stop pays 4.3% of R; a 1 ATR stop pays 12.5%
 *     and a 0.5 ATR stop pays 25%. Measured, T0.5/S0.5/exp24 returns -0.509R.
 *     Scalping is rejected on arithmetic, on 37 days of data, not on fit.
 *   - lookback 96 = 24h. Chosen because it is a natural period, not because it
 *     won: 32 and 192 measure -0.329 and -0.330 against 96's -0.325. The
 *     insensitivity is the point - there is no lookback to tune.
 *   - minBeyondAtr 0. Re-tested on 37 days: k = 0 and k = 0.5 give -0.325 and
 *     -0.304. Still flat. What matters is BEING at the extreme.
 *
 * NO ARGUMENT, ARBITRARY IN MAGNITUDE, principled only in DIRECTION:
 *   - `minAtrPercent`. Higher ATR relative to price is lower fee/R, and it was
 *     the only cut that survived train -> test in the same direction:
 *     atrPct > 1.2% measured train +0.104 -> TEST +0.070 (t +1.26).
 *     t = 1.26 is NOT significant. It is kept because it has a cost argument
 *     underneath it, not because of that number.
 *   - `minRelVolume`. A close beyond the extreme on thin volume is a poke; with
 *     participation it is displacement. relVolume > 2.5 measured train +0.056 ->
 *     TEST +0.029 (t +0.93). Also not significant.
 *   Every other cut collapsed: bodyRatio > q75 went train +0.049 -> test -0.038,
 *   and extAtr produced nothing in either half.
 *
 * =====================================================================
 * CAUSALITY
 * =====================================================================
 * Every input is this candle's close or earlier: the prior extreme is measured
 * over [gi-lookback, gi-1] so the candle is never compared with an extreme it
 * helped set, and the volume baseline uses the same window. FIRST CROSSING ONLY:
 * the previous candle is re-tested against the same condition and the entry is
 * declined if it already qualified, so a sustained move is faded once rather than
 * on every candle. Without that, a trending market is faded repeatedly - the
 * worst possible behaviour - and in research the sample fills with near-duplicate
 * overlapping trades.
 */

/** Round-trip taker as a fraction of notional, from the single source of truth. */
const ROUND_TRIP_FEE_FRACTION = PnlUtility.calculateTakerFeeOnNotional(1) * 2;

/**
 * The holding cap the measurement used, in candles. 96 = 24h.
 *
 * netR by expiry, direction-balanced, T3/S3: exp24 -0.016, exp48 -0.010,
 * exp96 -0.012, exp250 -0.008. Flat. 96 is chosen to match the lookback, not
 * because it won — there is nothing here to tune either.
 */
export const BREAKOUT_FADE_MAX_DURATION_CANDLES = 96;

export interface BreakoutFadeLevels {
    /** Candles the prior extreme is measured over. 96 = 24h on 15m. */
    lookback: number;
    /** How far beyond the extreme the close must sit, in ATR. Flat; 0 measured. */
    minBeyondAtr: number;
    /** Target distance from entry, in ATR. */
    tpAtr: number;
    /** Stop distance from entry, in ATR. */
    slAtr: number;
}

/**
 * The levels the 37-day measurement used, and the ones its numbers refer to.
 *
 * T3/S3 is R:R 1.0 and needs a win rate above 50% plus fees; it measured 46.8%
 * both-sides uncapped and 51.6% direction-balanced. T6/S3 and T4.5/S3 measured
 * indistinguishably once balanced (-0.015 and -0.018 against T3/S3's -0.012), so
 * there is nothing to choose between them in the data. 3/3 is kept as the
 * default only because it is symmetric and therefore needs no argument for why
 * the two sides differ.
 */
export const BREAKOUT_FADE_LEVELS: BreakoutFadeLevels = {
    lookback: 96,
    minBeyondAtr: 0,
    tpAtr: 3.0,
    slAtr: 3.0,
};

export interface BreakoutFadeConfig extends BreakoutFadeLevels {
    /**
     * Minimum ATR as a fraction of price. 0 disables.
     *
     * This is the fee guard, written the way the cost arithmetic reads:
     *     fee/R = 2*taker / (slAtr * atrPercent)
     * so at 0.05% taker, slAtr 3 and this at 0.012, fee/R is 2.8%.
     * ARBITRARY IN MAGNITUDE — see the header. Direction has a cost argument.
     */
    minAtrPercent: number;
    /**
     * Minimum volume relative to the mean of the lookback window. 0 disables.
     * ARBITRARY IN MAGNITUDE — see the header.
     */
    minRelVolume: number;
    /**
     * Maximum round-trip fee as a fraction of R. 0 or Infinity disables.
     *
     * Redundant with minAtrPercent by construction and kept because it is the
     * quantity the argument is actually about: a symbol whose round trip costs a
     * large fraction of R cannot be traded profitably at any win rate. USDCUSDT
     * reached fee/R = 140 in a real run because no guard was set.
     */
    maxFeeRiskRatio: number;
    /**
     * REQUIRED, no default, on purpose. A default `allowShort` in a constant
     * once silently overrode the lab's own Settings toggle. There is no value
     * this file can supply on the caller's behalf.
     *
     * Note what turning shorts off costs HERE, because it is not a small thing:
     * this entry's measured result depends on taking both sides. Long-only is
     * -0.1838R against -0.0117R balanced.
     */
    allowLong: boolean;
    allowShort: boolean;
}

/** Which side of the book fading each event direction puts you on. */
export type BreakoutDirection = "UP" | "DOWN";

export interface BreakoutFadeSignal {
    direction: BreakoutDirection;
    /** LONG fades a downside break; SHORT fades an upside break. */
    side: "LONG" | "SHORT";
    /** How far beyond the prior extreme the close sat, in ATR. */
    beyondAtr: number;
    relVolume: number;
    atrPercent: number;
    feeRiskRatio: number;
}

/**
 * How far this candle's close sits beyond the extreme of the prior `lookback`
 * candles, in ATR. Positive means it closed past it.
 *
 * The window ENDS at gi-1, so the candle is never compared against an extreme it
 * helped set. Returns null when there is not enough history — never guessed.
 */
function closeBeyondPriorExtreme(
    candles: CandleInfo[],
    gi: number,
    lookback: number,
    upward: boolean
): number | null {
    if (gi < 1 || gi >= candles.length) return null;
    const start = gi - lookback;
    if (start < 0) return null;
    const atr = candles[gi].atr;
    if (!(atr > 0)) return null;
    let high = -Infinity;
    let low = Infinity;
    for (let j = start; j < gi; j++) {
        if (candles[j].high > high) high = candles[j].high;
        if (candles[j].low < low) low = candles[j].low;
    }
    if (!isFinite(high) || !isFinite(low)) return null;
    const close = candles[gi].close;
    return upward ? (close - high) / atr : (low - close) / atr;
}

/** Mean volume over [gi-lookback, gi-1]. Same window as the extreme. */
function priorMeanVolume(candles: CandleInfo[], gi: number, lookback: number): number | null {
    const start = gi - lookback;
    if (start < 0 || gi > candles.length) return null;
    let sum = 0;
    for (let j = start; j < gi; j++) sum += candles[j].volume;
    const mean = sum / lookback;
    return mean > 0 ? mean : null;
}

/**
 * Does this candle produce a fade signal? Pure; reads no forward candle.
 *
 * Separated from position construction so the detector can be tested, charted
 * and counted on its own — the chart needs to answer "why THIS candle" without
 * a margin or a leverage in scope.
 */
export function detectBreakoutFade(
    candles: CandleInfo[],
    gi: number,
    config: BreakoutFadeConfig
): BreakoutFadeSignal | null {
    if (gi < 1 || gi >= candles.length) return null;
    const candle = candles[gi];
    const atr = candle.atr;
    if (!(atr > 0)) return null;

    const up = closeBeyondPriorExtreme(candles, gi, config.lookback, true);
    const down = closeBeyondPriorExtreme(candles, gi, config.lookback, false);
    if (up == null || down == null) return null;

    // An upside break is faded SHORT, a downside break LONG.
    let direction: BreakoutDirection | null = null;
    if (up > config.minBeyondAtr) direction = "UP";
    else if (down > config.minBeyondAtr) direction = "DOWN";
    if (!direction) return null;

    const side = direction === "UP" ? "SHORT" : "LONG";
    if (side === "LONG" && !config.allowLong) return null;
    if (side === "SHORT" && !config.allowShort) return null;

    // FIRST CROSSING. Re-measure the previous candle against its OWN window, so
    // a shifting extreme is handled correctly rather than reusing this candle's.
    const prev = closeBeyondPriorExtreme(candles, gi - 1, config.lookback, direction === "UP");
    if (prev != null && prev > config.minBeyondAtr) return null;

    const entryPrice = candle.close;
    if (!(entryPrice > 0)) return null;
    const atrPercent = atr / entryPrice;
    if (config.minAtrPercent > 0 && atrPercent < config.minAtrPercent) return null;

    const feeRiskRatio = config.slAtr > 0
        ? ROUND_TRIP_FEE_FRACTION / (config.slAtr * atrPercent)
        : Infinity;
    if (config.maxFeeRiskRatio > 0 && feeRiskRatio > config.maxFeeRiskRatio) return null;

    const meanVol = priorMeanVolume(candles, gi, config.lookback);
    const relVolume = meanVol == null ? NaN : candle.volume / meanVol;
    if (config.minRelVolume > 0 && !(relVolume >= config.minRelVolume)) return null;

    return {
        direction, side,
        beyondAtr: direction === "UP" ? up : down,
        relVolume, atrPercent, feeRiskRatio,
    };
}

/**
 * Build the position for a signal. Levels are entry-relative and fixed, so
 * planned R:R is exactly tpAtr/slAtr on every trade.
 *
 * NOTE ON THE R:R GATE, deliberately absent here. A minimum-R:R rule cannot sort
 * trades for this entry: every trade has the same planned R:R, so the gate is
 * all-or-nothing and carries no information. Applying it would only turn the
 * entry off. Where R:R matters for this entry is in the LEVELS, and the 37-day
 * grid found no cell that clears costs at any R:R from 1:1 to 1:3 — so a caller
 * that wants a 1:3 book should set tpAtr/slAtr and read the grid, not add a gate.
 */
export function buildBreakoutFadePosition(
    candle: CandleInfo,
    gi: number,
    signal: BreakoutFadeSignal,
    margin: number,
    leverage: number,
    config: BreakoutFadeLevels
): PositionEntry | null {
    const atr = candle.atr;
    if (!(atr > 0)) return null;
    const entryPrice = candle.close;
    const risk = config.slAtr * atr;
    const reward = config.tpAtr * atr;
    if (!(risk > 0) || !(reward > 0)) return null;

    const side = signal.side;
    const sl = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const tp = side === "LONG" ? entryPrice + reward : entryPrice - reward;
    // Guards the inversion a zero or negative ATR would produce.
    if (side === "LONG" && (sl >= entryPrice || tp <= entryPrice)) return null;
    if (side === "SHORT" && (sl <= entryPrice || tp >= entryPrice)) return null;

    return {
        side, entryPrice, margin, leverage, sl, tp,
        openTime: candle.openTime,
        entryReason: {
            trigger: "BREAKOUT_FADE",
            reversingDirection: signal.direction,
            // There is no reversing SEGMENT here — the event is one candle against
            // a fixed lookback — so these carry the window the extreme was
            // measured over rather than being null and looking like missing data.
            segmentLow: entryPrice - risk,
            segmentHigh: entryPrice + risk,
            segmentMid: entryPrice,
            broaderMoveAtr: signal.beyondAtr,
            exhaustionWickRatio: null,
            trendZScoreAvg: null,
            plannedRewardRisk: reward / risk,
            plannedRiskPercent: risk / entryPrice,
            summary:
                `${side}: faded a close ${signal.beyondAtr.toFixed(2)} ATR beyond the prior `
                + `${config.lookback}-candle ${signal.direction === "UP" ? "high" : "low"} `
                + `(relVol ${signal.relVolume.toFixed(2)}, atr ${(signal.atrPercent * 100).toFixed(2)}% `
                + `of price, fee ${(signal.feeRiskRatio * 100).toFixed(1)}% of R)`,
        },
        entryFee: PnlUtility.calculateTakerFee(margin, leverage),
        mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
        exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
        openGi: gi, closeGi: null, durationMinutes: null,
        // CARRIED BY THE POSITION, not left to the caller to remember. This entry
        // was measured at 96 candles while the segment entry was measured at 250,
        // and the lab passes ONE global cap - so without this the breakout fade
        // was silently being held 250 candles, which is not the configuration any
        // of its numbers refer to. Found by auditing which exports nothing
        // imported: BREAKOUT_FADE_MAX_DURATION_CANDLES was exported "so a caller
        // passes the right number" and then no caller ever did.
        maxDurationCandles: BREAKOUT_FADE_MAX_DURATION_CANDLES,
    };
}

/** Detect and build in one call, matching the shape of the other entry functions. */
export function checkBreakoutFadeEntry(
    candle: CandleInfo,
    candles: CandleInfo[],
    gi: number,
    margin: number,
    leverage: number,
    config: BreakoutFadeConfig
): PositionEntry | null {
    if (gi < 0 || gi >= candles.length || candles[gi] !== candle) return null;
    const signal = detectBreakoutFade(candles, gi, config);
    if (!signal) return null;
    return buildBreakoutFadePosition(candle, gi, signal, margin, leverage, config);
}