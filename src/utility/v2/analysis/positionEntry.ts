import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PnlUtility } from "@/utility/PnlUtility";

// #####################################################################
// STATUS 2026-09-27, AFTER THE FIRST HONEST DATASET
// #####################################################################
// Everything in this file scales its levels by `candle.atr`. Two facts about
// that, and about what the levels were measured against, now govern the whole
// file and are recorded here rather than buried at each constant.
//
// ---------------------------------------------------------------------
// 1. THE ATR IS PERIOD 8, NOT 14
// ---------------------------------------------------------------------
// `CandleAnalyzerV2.calculateATR` DEFAULTS to 14, but the lab calls it with 8:
// recomputing the archive at period 8 reproduces all 275,054 stored ATR values
// to a relative error under 1e-12, while period 14 matches 0.29% of them. So
// every `* atr` in this file is eight candles of true range - two hours on 15m -
// which is a far noisier quantity than the comment "ATR" suggests, and a 3-ATR
// stop is correspondingly closer to the noise than it reads.
//
// ---------------------------------------------------------------------
// 2. BOTH ENTRIES IN THIS FILE ARE FALSIFIED ON CLEAN DATA
// ---------------------------------------------------------------------
// Measured on the run archive - 299 Binance USDT-M symbols, 15m, 3,560
// CONTIGUOUS candles each over 2026-01-01 -> 02-06, zero gaps, 37 window-leak
// symbols excluded, ~34 days of eligible entry time instead of the 38 hours
// every earlier offline result rested on:
//
//   entry hypothesis                        netR      t(day,35)
//   close beyond 96-candle extreme, FADE   -0.0735      -0.94
//   close beyond 96-candle extreme, WITH   -0.0120      -0.15
//   close beyond 24-candle extreme, FADE   -0.0395      -0.73
//   2sd of 96 closes, FADE                 -0.0508      -0.72
//   2 ATR from 96-candle VWAP, FADE        -0.0161      -0.35
//   8-candle move > 1 ATR, FADE            -0.0541      -2.30
//   RANDOM CANDLES (placebo)               -0.0476        -
//
// So no configuration of either entry is profitable, and none separates from a
// random entry in absolute terms.
//
// BUT THE DIRECTION IS NOT NOTHING, and a first pass at this comparison here got
// that wrong. Pooling every row and taking mean(FADE - CONT) gave -0.0616 and
// looked like "continuation is the better side". That estimator is contaminated:
// per row it is -d for an UP event and +d for a DOWN event, with
// d = netR(long) - netR(short), so pooling returns
//
//     ( n_dn * E[d|DN]  -  n_up * E[d|UP] ) / (n_up + n_dn)
//
// which equals the exhaustion term 1/2 (E[d|DN] - E[d|UP]) only when the counts
// match. There are 11,799 DOWN events against 9,339 UP, and the drift term is
// large in a -23.7% window, so the imbalance leaks DRIFT into the estimate.
// Contrasting UP against DOWN WITHIN each day, which cancels that day's drift
// whatever it was, flips the sign and is significant:
//
//   T3/S3/x96   exhaustion +0.3479 +-0.0791 (t +4.40), 80% of 35 days positive
//   T6/S3/x192  exhaustion +0.3954 +-0.1092 (t +3.62), 74% positive
//   T2/S2/x48   exhaustion +0.3357 +-0.0657 (t +5.11), 80% positive
//
// FADING IS THE BETTER SIDE. It survives thirds of the window while the drift
// term changes sign, disjoint symbols, a sign test, and four other detectors -
// see breakoutFadeEntry.ts, which is this event rebuilt on that dataset, and
// which also found the effect is about the SIZE OF THE FEE: not one of 60
// (target, stop, expiry) cells is positive trade-weighted, best -0.052R, and an
// independent measurement (arXiv 2608.21888) reaches the same conclusion for
// 15-minute reversal across 183 pairs.
//
// The live run agrees on the outcome. Over 2026-01-01 -> 02-27, in-window trades
// only, NET of fees and funding: EXTENSION_FADE 983 trades -0.1474R,
// POTENTIAL_REVERSAL 640 trades -0.3101R, together -168.61 USDT.
//
// ---------------------------------------------------------------------
// 3. WHAT WAS ACTUALLY LOSING THE MONEY
// ---------------------------------------------------------------------
// Not the entry. 2026-01-01 -> 02-06 is a -23.7% MEDIAN move across 299
// symbols with only 10% of them up, and in it a RANDOM entry earns
//
//    LONG  -0.1895R  (t(day) -2.15)        SHORT  +0.1323R  (t(day) +1.37)
//
// The lab runs LONG ONLY. That constraint, not the trigger, is the -168.61.
// `allowShort: false` is not a neutral default; it is a directional bet.
//
// And the stop is a cost here, not protection. Market-neutral so the regime
// cancels, identical rows, netR against a fixed 3-ATR risk unit:
//
//    stop 0.5 ATR -0.0500   3 ATR -0.0288   9 ATR +0.0236   none +0.0555
//
// monotone in stop width, in both time halves, present in the ranked book and
// absent in the shuffled one. It corroborates what the trade ledger already
// said: tightening the stop ran -0.160R at S=3 down to -0.621R at S=0.5. An
// 8-period ATR stop at 3 ATR is inside the noise it is meant to sit outside.
//
// ---------------------------------------------------------------------
// 4. WHERE THE ONE MEASURED SIGNAL LIVES, AND WHY NOT HERE
// ---------------------------------------------------------------------
// Rank the universe by trailing return and take the top decile long against the
// bottom decile short - market-neutral by construction - and the ranking is
// worth about +0.48R at a four-day horizon, with a shuffled-rank control at
// +0.04 and the reversed book at -0.51. That is RELATIVE information, so it
// cannot be computed by any function in this file: `checkPositionEntry` sees one
// symbol and cannot know how it ranks against the other 298. It lives in
// `crossSectionalMomentum.ts`, which is a PORTFOLIO decision in the same sense
// the position cap is.
//
// It also needs room this leverage does not have. At the median ATR of 0.659% of
// price, 20x is liquidated by a 7.6-ATR move, and the measured edge needs 15-30
// ATR. So the deployable form is ~5x with many small positions, and the leverage
// - not the entry - is the binding constraint.
//
// NOTHING BELOW HAS BEEN DELETED. Both entries are kept as the worked control,
// and both should be OFF by default in the lab until something replaces them.
// #####################################################################

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

/**
 * MINIMUM PLANNED REWARD:RISK. A setup whose target is less than this
 * many times its stop distance is not taken at all.
 *
 * WHY A FLOOR EXISTS, and it is an argument rather than a fitted number:
 * a strategy breaks even when its payoff equals (1 - p) / p. Measured on
 * the 2026-09-21 -> 2026-09-26 capture (336 Binance USDT-M symbols, 15m,
 * 2,416 eligible candidates, shipped levels, 250-candle cap), the
 * sub-1.5 R:R cohorts realised a payoff of 1.12 and 1.54 against
 * breakeven requirements of 1.03 and 1.45. They sit ON their own
 * breakeven line, which means they are not an edge - they are a coin
 * flip that any adverse shift in win rate turns negative. Below roughly
 * 2.0 there is no margin at all.
 *
 * WHY 3 AND NOT 2. Net R per trade rises monotonically with the gate,
 * and the ordering holds inside both halves of the window and inside the
 * range-position control, so it is not an artifact of entering lower in
 * a rally:
 *
 *   min R:R   trades   netR/trade   total R   win%   payoff   breakeven
 *      none     2416      +0.2922     705.9   45.0     1.84        1.22
 *       2.0     1161      +0.5450     632.8   37.6     3.02        1.66
 *       3.0      637      +0.7292     464.5   34.9     3.83        1.87
 *       4.0      343      +0.7237     248.2   29.7     4.64        2.36
 *
 * In the harder half of that window - the only block where the strategy
 * loses money overall - the >=3 cohort is the ONLY one that is not
 * negative (+0.04 +-0.19, against -0.19 and -0.17 for the cohorts below
 * it). That is the case for 3 over 2.
 *
 * WHAT IT COSTS, stated plainly: trade count falls 2,416 -> 637 and
 * symbol coverage 328 -> 208, and TOTAL R falls 706 -> 465. Per-trade
 * quality roughly doubles while the aggregate drops by a third. So this
 * floor is right when the position cap BINDS - quality per slot is what
 * matters then - and 2.0 would be better if slots were going unfilled.
 * The cap did bind in the runs to date (it bound 32-37% through).
 *
 * 3 IS ALSO A ROUND NUMBER CHOSEN UP FRONT, not an optimum read off the
 * sample; 3.5 measured marginally better and 4.0 marginally worse, both
 * inside the error bars. The data does not contradict 3, and choosing it
 * a priori is safer than choosing the sample's maximum.
 *
 * CAVEAT: one five-day window in one regime (a +9.27% median altcoin
 * rally), so the LEVELS above are mostly that rally rather than edge.
 * The monotone ORDERING is the part with support - it is an established
 * finding that survived time slices on the earlier multi-month run too.
 *
 * Set to 0 to disable the gate entirely.
 */
export const MIN_REWARD_RISK = 3;

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
    leverage: number,
    allowLong: boolean = true,
    allowShort: boolean = true,
    /**
     * Minimum planned reward:risk, measured at entry as
     * (tp - entry) / (entry - sl) for a LONG, mirrored for a SHORT.
     * Fully causal - every input is known at the entry candle's close.
     *
     * 0 disables the filter (the previous behavior, so existing callers
     * that don't pass it are unchanged).
     *
     * WHY THIS AND NOT A TUNED NUMBER: at a win rate p, a strategy breaks
     * even when reward:risk equals (1 - p) / p. Measured over 10,724
     * LONG trades the win rate was 34.4%, which puts breakeven at 1.91.
     * So requiring R:R >= ~2 is requiring each trade to be individually
     * above its own breakeven at the win rate actually observed - a
     * principled bar rather than a threshold fitted to a sample. In that
     * data the sub-1.5 cohort was 25.7% of trades and contributed
     * -9,738 net while the whole run netted +767, and the effect was
     * monotonic inside each third of the run (so not a time artifact).
     */
    minRewardRisk: number = MIN_REWARD_RISK,
    /**
     * Minimum stop distance as a FRACTION OF ENTRY PRICE, e.g. 0.01 = the
     * stop must sit at least 1% away. 0 disables.
     *
     * WHY IT EXISTS - and this part is arithmetic, not a fitted threshold:
     * the round-trip taker fee is a fixed 2 x 0.05% of NOTIONAL, while the
     * risk unit R is the stop distance. So
     *     fee / R = 2 x taker / (stopDistance / entryPrice)
     * As the stop tightens toward price, fee/R diverges. Measured over 5,375
     * real candidates, 42 of them had fee > 1.0R - the round trip cost MORE
     * THAN THE ENTIRE RISK UNIT, so they could not profit whatever price did.
     * Almost all were USDCUSDT (a stablecoin pair, near-zero ATR), plus
     * SPYUSDT and TRXUSDT. The worst was 615R.
     *
     * The existing `sl >= entryPrice` guard rejects an INVERTED stop but not
     * one sitting a hair below price, which is how those got through.
     *
     * Excluding just the impossible ones moved mean net from -1.0046R to
     * -0.0310R per candidate. At 0.05% taker, 0.01 here means fee <= 0.10R.
     * Note honestly: only the fee > 1.0R exclusion is proven by arithmetic;
     * where exactly to put the floor below that is a judgement call and the
     * measured differences between 0.002, 0.005 and 0.01 were inside noise.
     */
    minRiskPercent: number = 0
): PositionEntry | null {
    if (!candle.conditions_met?.includes("POTENTIAL_REVERSAL")) return null;
    if (!reversingDirection || reversingSegmentStartGi == null) return null;
    if (!(candle.atr > 0)) return null;

    // An UP trend reversing produces a SHORT; a DOWN trend reversing
    // produces a LONG. Bail out before doing any of that side's work
    // when its own flag is off. Both default to true, so existing
    // callers that don't pass them behave exactly as before.
    if (reversingDirection === "UP" && !allowShort) return null;
    if (reversingDirection === "DOWN" && !allowLong) return null;

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
        // Risk and reward are both distances from entry, so the ratio is
        // unitless and comparable across symbols and volatility regimes.
        // Computed unconditionally, not only when a gate is on, so the
        // value stamped on the position is always the real planned R:R
        // and an export can confirm the gate held.
        const risk = sl - entryPrice;
        const reward = entryPrice - tp;
        const plannedRewardRisk = risk > 0 ? reward / risk : 0;
        const plannedRiskPercent = risk / entryPrice;
        if (minRiskPercent > 0 && plannedRiskPercent < minRiskPercent) return null;
        if (minRewardRisk > 0 && (!(risk > 0) || plannedRewardRisk < minRewardRisk)) return null;
        return {
            side: "SHORT", entryPrice, margin, leverage, sl, tp,
            openTime: candle.openTime,
            entryReason: {
                trigger: "POTENTIAL_REVERSAL",
                reversingDirection: "UP",
                segmentLow: range.low, segmentHigh: range.high, segmentMid: mid,
                broaderMoveAtr: broader, exhaustionWickRatio: wick, trendZScoreAvg: trendZ,
                plannedRewardRisk, plannedRiskPercent,
                summary: `SHORT: UP trend reversing; 24h context ${broader.toFixed(2)} ATR, exhaustion wick ${wick.toFixed(2)} ATR, trend volume z-score avg ${trendZ.toFixed(2)}`,
            },
            entryFee: PnlUtility.calculateTakerFee(margin, leverage),
            mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
            exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
            openGi: gi, closeGi: null, durationMinutes: null,
        };
    } else {
        // DOWN trend reversing -> LONG. Unchanged: already robust,
        // beat every filtered/re-leveled variant tried this round.
        const sl = range.low - LONG_SL_ATR * atr;
        const tp = mid + LONG_TP_ATR * atr;
        if (sl >= entryPrice || tp <= entryPrice) return null;
        // See the SHORT branch: computed unconditionally so the stamp is
        // always the real planned R:R.
        const risk = entryPrice - sl;
        const reward = tp - entryPrice;
        const plannedRewardRisk = risk > 0 ? reward / risk : 0;
        const plannedRiskPercent = risk / entryPrice;
        if (minRiskPercent > 0 && plannedRiskPercent < minRiskPercent) return null;
        if (minRewardRisk > 0 && (!(risk > 0) || plannedRewardRisk < minRewardRisk)) return null;
        const segmentProgress = range.high > range.low ? (entryPrice - range.low) / (range.high - range.low) : null;
        return {
            side: "LONG", entryPrice, margin, leverage, sl: entryPrice - (reward / 2), tp,
            openTime: candle.openTime,
            entryReason: {
                trigger: "POTENTIAL_REVERSAL",
                reversingDirection: "DOWN",
                segmentLow: range.low, segmentHigh: range.high, segmentMid: mid,
                broaderMoveAtr: null, exhaustionWickRatio: null, trendZScoreAvg: null,
                plannedRewardRisk, plannedRiskPercent,
                // % into the segment's own range at entry - the exact
                // metric that explained LONG's bad-RR pattern in an
                // earlier research pass (0% bad-RR below ~20% progress,
                // 60% above it) - visible here directly, not something
                // that needs re-deriving from raw candles later.
                summary: `LONG: DOWN trend reversing; entry ${segmentProgress != null ? (segmentProgress * 100).toFixed(0) + "%" : "?"} into the segment's own range`,
            },
            entryFee: PnlUtility.calculateTakerFee(margin, leverage),
            mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
            exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
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

// =====================================================================
// EXTENSION FADE — a second, independent entry
//
// EVENT: the candle CLOSES beyond the extreme of the prior
// EXTENSION_LOOKBACK candles. An upside extension is faded SHORT, a
// downside extension faded LONG. First crossing only.
//
// This is not a variation of POTENTIAL_REVERSAL. That trigger fires on a
// candle whose close is still INSIDE the range it fades - measured across
// 5,666 candidates, `close beyond the prior extreme` occurred exactly 0
// times - so the two never fire on the same bar for the same reason.
//
// =====================================================================
// STATUS 2026-09-27: THE MEASUREMENT THAT PUT THESE LEVELS HERE WAS
// INVALID, AND THE ENTRY IS FALSIFIED ON THE ONLY HONEST SAMPLE WE HAVE.
//
// This block used to report an exhaustion effect of +0.445 +-0.072 (t 6.2)
// in a rising window and +0.931 +-0.063 (t 14.8) in a falling one, a
// level grid that "chose" T3/S3, and a holding-time curve that chose 96.
// Every one of those numbers came from the same defective sampling and
// none of them is evidence. They are recorded here rather than deleted,
// because the shape of the error is the useful part.
//
// THE DEFECT. The offline datasets were built from 500-candle symbol
// exports and required HORIZON=250 candles of forward path, with a
// 96-candle lookback before the event. So an event could only occur at
// candle index 97..249:
//
//     max_gi = len(candles) - HORIZON - 1 = 500 - 250 - 1 = 249
//     min_gi = LOOKBACK + 1               = 97
//
// 153 candles = 38 HOURS of eligible entry time. Verified directly on the
// stored datasets: paths.npz 5,666 rows span 2026-09-21 09:15 ->
// 09-23 21:30; extension.npz spans 2026-09-22 07:30 -> 09-23 21:30;
// extension_jf.npz collapses to three days with 988 of its 1,310 events
// on 2026-02-03 ALONE.
//
// WHY SYMBOL CLUSTERING DID NOT SAVE IT. Clustering by symbol removes
// correlation WITHIN a symbol. It does nothing about correlation ACROSS
// symbols at the same instant, and 300 alt perps at the same timestamp
// are the same trade. So "817 events" was one market-wide move on
// 2026-02-03 measured 817 times. Re-clustering the identical rows on
// entry time:
//
//   FADE, T3/S3, expiry 96,  n=1310, mean +0.4672
//     t(iid)    +19.97
//     t(symbol) +15.41     <- what was reported
//     t(4h)      +5.04     <- 6 buckets, far too few to be trusted
//     t(day)     +7.22     <- 3 clusters; not a statistic at all
//
// With three days of market there is no standard error on this dataset
// that means anything, in EITHER direction. The measurement is not wrong
// so much as uninformative, and the project's own rule - "check every
// cross-sectional finding for time confounding" - is exactly the rule I
// failed to apply to my own work. Same class of error as the margin-tier
// artifact, one layer further out: the wrong denominator.
//
// THE DEFECT IS INHERITED. build_paths.py, build_placebo.py and
// build_exitctx.py share the 500-candle / HORIZON-250 construction, so
// the X/Y calibration surface, the exhaustion/drift 2x2 decomposition and
// the "opposite drift regime test" all rest on ~60 hours of market each.
// None of them is evidence for anything. The regime test in particular
// compared one market event against one other market event.
//
// SECONDARY DEFECT, smaller: 33 of the 336 symbol files in the February
// capture were listed AFTER 2026-02-06, so Binance returned their
// earliest available candles instead (March-August, including the
// tokenised equities GOOGL/EWY/COPPER/CRCL, which are not crypto perps).
// Those rows were pooled in without being noticed.
//
// --------------------------------------------------------------------
// WHAT THE PORTFOLIO ENGINE MEASURED INSTEAD
// --------------------------------------------------------------------
// Rolling run, 336 Binance USDT-M symbols, 15m, configured
// 2026-01-01 -> 2026-02-27, LONG only, 20x, R:R gate 3, balance 200 ->
// 29.04. This is 57 days of entries rather than 38 hours, so it has
// enough distinct days to cluster on:
//
//   cohort                n     win    meanR    t(sym)  t(day)   netPnl
//   ALL                1970   36.1%   -0.1168   -3.62   -1.80   -129.32
//   EXTENSION_FADE     1250   46.9%   -0.0645   -2.18   -0.98    -67.69
//   POTENTIAL_REVERSAL  720   17.5%   -0.2075   -2.94   -2.16    -61.63
//
// and 16.8% of those trades were themselves outside the configured window
// (see windowIntegrity.ts - the lab has the same listing-date leak). The
// out-of-window trades are the ONLY positive cohort in the run, +0.1073R
// over 330 trades, so the in-window truth is worse than the headline:
//
//   IN-WINDOW ONLY      1640   33.4%   -0.1618           -149.96
//     EXTENSION_FADE     988   44.2%   -0.1142            -88.45
//     POTENTIAL_REVERSAL 652   17.0%   -0.2341            -61.51
//
// EXTENSION_FADE by ISO week inside the window: 8 weeks, 2 positive.
// At t(day) -0.98 it is not distinguishable from zero - it is not proven
// to lose either. What it is NOT is a +0.93R effect.
//
// --------------------------------------------------------------------
// WHY R:R = 1.0 IS A STRUCTURAL PROBLEM, INDEPENDENT OF ANY SAMPLE
// --------------------------------------------------------------------
// T3/S3 is planned R:R 1.0 on every trade. Breakeven win rate at R:R 1
// is 50% plus fees. The realised win rate was 44.2% in-window. That is
// arithmetic, not a regime: this geometry needs a >50% hit rate and did
// not have one.
//
// It also silently bypassed the 1:3 requirement that MIN_REWARD_RISK
// exists to enforce. The old note here argued the R:R gate "does not
// apply to this entry, deliberately", because with fixed T/S the gate
// could only be all-or-nothing. That argument was backwards: all-or-
// nothing is the CORRECT answer when the geometry fails the rule. The
// gate is now applied (see ExtensionEntryConfig.minRewardRisk), so
// running EXTENSION_LEVELS with minRewardRisk 3 rejects every extension
// entry - visibly, at the call site, instead of quietly trading 1:1 next
// to a gate that says 3:1.
//
// EXTENSION_LEVELS_RR3 is the 1:3 geometry that satisfies the rule. It is
// a HYPOTHESIS, not a calibration, and it is not yet testable: widening a
// target is a BOUNDED counterfactual, not a computable one. Of the 1,250
// recorded extension trades, 570 closed AT the 3-ATR target, so whether
// they would have continued to 9 ATR is simply unobserved; the bound on a
// 1:3 win rate from this export is [0%, 45.6%] against a 25% breakeven,
// which answers nothing. Forward paths over many months are required, and
// that is what the run archive is for.
//
// --------------------------------------------------------------------
// WHAT WOULD MAKE ANY OF THIS TESTABLE
// --------------------------------------------------------------------
// A dataset whose ENTRIES span months, not hours. Concretely: forward
// paths taken from the archived run rather than from 500-candle exports,
// with the horizon bounded by EXTENSION_MAX_DURATION_CANDLES (96) instead
// of 250 so the eligible entry window is 403 candles rather than 153, and
// every reported error bar clustered on entry time with enough distinct
// days to support it. Until then the honest statement about this entry is
// that it has no demonstrated edge, and the same is true of
// POTENTIAL_REVERSAL, which has now been falsified on entry, on levels,
// on management, and again here.
// =====================================================================

/** Candles of history the extreme is measured over. 96 = 24h on 15m. */
const EXTENSION_LOOKBACK = 96;
/**
 * How far beyond the prior extreme the close must sit, in ATR.
 *
 * ZERO ON PURPOSE. The dose-response is flat, so any positive value trades
 * sample size for nothing. Exposed so the flatness can be re-tested on new
 * data rather than taken on trust.
 */
const EXTENSION_MIN_ATR = 0;
/**
 * Target and stop, in ATR from entry.
 *
 * THESE ARE THE SHIPPED VALUES, NOT CALIBRATED ONES. The grid that appeared
 * to select 3/3 came from 38 hours of market time - see the status block
 * above. They are kept as the historical default only so that a run made
 * before 2026-09-27 can be reproduced exactly. 3/3 is planned R:R 1.0 and
 * fails the 1:3 requirement; with minRewardRisk 3 it fires nothing.
 */
const EXTENSION_TP_ATR = 3.0;
const EXTENSION_SL_ATR = 3.0;

/** The level geometry. Nothing here is decided by the caller's portfolio. */
export interface ExtensionLevels {
    lookback: number;
    minBeyondAtr: number;
    tpAtr: number;
    slAtr: number;
}

/**
 * HISTORICAL DEFAULT. Reproduces pre-2026-09-27 behaviour. R:R = 1.0.
 * Measured at -0.1142R over 988 in-window trades in the rolling run.
 */
export const EXTENSION_LEVELS: ExtensionLevels = {
    lookback: EXTENSION_LOOKBACK,
    minBeyondAtr: EXTENSION_MIN_ATR,
    tpAtr: EXTENSION_TP_ATR,
    slAtr: EXTENSION_SL_ATR,
};

/**
 * The 1:3 geometry, so the extension entry can satisfy the same rule the
 * reversal entry does.
 *
 * UNTESTED, AND LABELLED AS SUCH. The stop is unchanged at 3 ATR, which is
 * the only part with an argument behind it: fee/R = feeAtr / slAtr, and at
 * the median feeAtr of 0.11 a 3 ATR stop pays 3.7% of R in round-trip
 * taker while a 1 ATR stop pays 11%. The TARGET at 9 ATR is chosen purely
 * to make planned R:R equal MIN_REWARD_RISK - it is the requirement
 * expressed as a level, not a measured optimum.
 *
 * Its breakeven win rate is 1/(1+3) = 25% plus fees. Whether the real hit
 * rate clears that is NOT computable from any run made with 3/3 levels:
 * the trades that closed at the 3 ATR target carry no information about
 * what they would have done at 9. Do not report a number for this
 * configuration that did not come from a run that actually used it.
 */
export const EXTENSION_LEVELS_RR3: ExtensionLevels = {
    lookback: EXTENSION_LOOKBACK,
    minBeyondAtr: EXTENSION_MIN_ATR,
    tpAtr: 9.0,
    slAtr: 3.0,
};

/**
 * Levels plus the part the CALLER decides. There is deliberately no default
 * for this type and no default argument on checkExtensionEntry.
 *
 * WHY, and this was a real mistake worth not repeating: an earlier version
 * carried `allowShort: true` in a default config here, on the evidence that
 * fading an upside extension is half this entry's measured effect. Meanwhile
 * the lab's own Settings toggle said shorts were off - a conclusion about the
 * REVERSAL entry, where shorts measured as contributing nothing. Two sources
 * of truth for the same-sounding flag, disagreeing silently, with the one
 * buried in a constant winning by default. Requiring the caller to state it
 * makes that impossible: there is no value this file can supply on the
 * caller's behalf.
 *
 * Note what that costs, so the choice is made with open eyes: with shorts off
 * this entry trades only the long leg of a symmetric result, which is the leg
 * that agrees with a rising regime. In the falling February capture the short
 * leg earned +0.393R over 594 events against the long leg's +0.473R.
 */
export interface ExtensionEntryConfig extends ExtensionLevels {
    /**
     * Minimum stop distance as a fraction of price; 0 disables.
     *
     * THIS IS THE FEE GUARD, and it is the same constraint as a cap on
     * fee/R, inverted:
     *
     *     fee / R = 2 x taker / (stopDistance / price)
     *     so  minRiskPercent = p  <=>  fee/R <= 2 x taker / p
     *
     * At 0.05% taker, 0.01 here means fee <= 0.10R. A separate
     * maxFeeRiskRatio parameter was considered and rejected as the same
     * number written twice.
     *
     * It is worth knowing how little this rescues. In the in-window rolling
     * run the loss by fee/R bucket was: [0,0.05) n=1068 -108.17,
     * [0.05,0.10) n=476 -37.02, [0.10,0.20) n=78 -4.98, above 0.20 n=17
     * -0.2. 91% of the loss sits BELOW fee/R 0.10, so no setting of this
     * makes a losing entry profitable. What it does do is exclude the
     * degenerate pairs - USDCUSDT reached fee/R 140, i.e. the round-trip
     * fee was 140 times the risk - which were traded in that run because
     * this was left at 0.
     */
    minRiskPercent: number;
    /**
     * Minimum planned reward:risk; 0 disables.
     *
     * REQUIRED, and new as of 2026-09-27. Previously this entry was exempt
     * from the R:R rule on the argument that fixed T/S makes the gate
     * all-or-nothing. All-or-nothing is the right answer when the geometry
     * fails the rule: with EXTENSION_LEVELS (R:R 1.0) and a value of 3 here
     * this entry correctly fires nothing, which is visible, rather than
     * trading 1:1 beside a gate that claims 3:1, which was not.
     *
     * Pass the SAME value the reversal entry is given. One rule, one number.
     */
    minRewardRisk: number;
    allowLong: boolean;
    allowShort: boolean;
}

/**
 * How far this candle's close sits beyond the extreme of the prior
 * `lookback` candles, in ATR. Positive means it closed past it.
 *
 * The window ENDS at gi-1, so the candle is never compared against an
 * extreme it helped set. Returns null when there is not enough history.
 */
function closeBeyondPriorExtreme(
    candles: CandleInfo[],
    gi: number,
    lookback: number,
    upward: boolean
): number | null {
    if (gi < 1 || gi >= candles.length) return null;
    const start = gi - lookback;
    if (start < 0) return null;                 // not enough history - never guessed
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

/**
 * Decides whether this candle opens an extension fade.
 *
 * FIRST CROSSING ONLY. A strong extension qualifies on many consecutive
 * candles. Without this the same move is faded again and again, which in a
 * sustained trend is the worst possible behaviour - and in research it fills
 * the sample with near-duplicate overlapping trades and makes every error bar
 * a lie. The previous candle is re-tested against the same threshold and the
 * entry is declined if it already qualified.
 *
 * CAUSAL: every input is this candle's close or earlier.
 */
export function checkExtensionEntry(
    candle: CandleInfo,
    candles: CandleInfo[],
    gi: number,
    margin: number,
    leverage: number,
    // REQUIRED. See ExtensionEntryConfig for why there is no default.
    config: ExtensionEntryConfig
): PositionEntry | null {
    const atr = candle.atr;
    if (!(atr > 0)) return null;
    if (gi < 1 || gi >= candles.length || candles[gi] !== candle) return null;

    const up = closeBeyondPriorExtreme(candles, gi, config.lookback, true);
    const down = closeBeyondPriorExtreme(candles, gi, config.lookback, false);
    if (up == null || down == null) return null;

    // An upside extension is faded SHORT, a downside extension LONG.
    let side: "LONG" | "SHORT" | null = null;
    if (up > config.minBeyondAtr) side = "SHORT";
    else if (down > config.minBeyondAtr) side = "LONG";
    if (!side) return null;
    if (side === "LONG" && !config.allowLong) return null;
    if (side === "SHORT" && !config.allowShort) return null;

    // First crossing: decline if the previous candle already qualified on the
    // same side. Measured on its own window, so a shifting extreme is handled.
    const prevSame = side === "SHORT"
        ? closeBeyondPriorExtreme(candles, gi - 1, config.lookback, true)
        : closeBeyondPriorExtreme(candles, gi - 1, config.lookback, false);
    if (prevSame != null && prevSame > config.minBeyondAtr) return null;

    const entryPrice = candle.close;
    const risk = config.slAtr * atr;
    const reward = config.tpAtr * atr;
    if (!(risk > 0) || !(reward > 0)) return null;
    if (config.minRiskPercent > 0 && risk / entryPrice < config.minRiskPercent) return null;

    // The R:R rule, applied to this entry as of 2026-09-27. Planned R:R here
    // is tpAtr/slAtr and does not vary per candle, so this gate is
    // all-or-nothing by construction - which is the point. See the note on
    // ExtensionEntryConfig.minRewardRisk.
    const plannedRewardRisk = reward / risk;
    if (config.minRewardRisk > 0 && plannedRewardRisk < config.minRewardRisk) return null;

    const sl = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const tp = side === "LONG" ? entryPrice + reward : entryPrice - reward;
    // Guards the inversion that a zero or negative ATR would produce.
    if (side === "LONG" && (sl >= entryPrice || tp <= entryPrice)) return null;
    if (side === "SHORT" && (sl <= entryPrice || tp >= entryPrice)) return null;

    const beyond = side === "SHORT" ? up : down;
    return {
        side, entryPrice, margin, leverage, sl, tp,
        openTime: candle.openTime,
        entryReason: {
            // Distinct trigger, so an export can separate the two entries
            // without inferring it from the level geometry.
            trigger: "EXTENSION_FADE",
            reversingDirection: side === "SHORT" ? "UP" : "DOWN",
            // There is no reversing SEGMENT here - the event is a single
            // candle against a fixed lookback - so the segment fields carry
            // the window the extreme was measured over rather than being
            // left null and looking like missing data.
            segmentLow: candles[gi - config.lookback].low,
            segmentHigh: candles[gi - 1].high,
            segmentMid: entryPrice,
            broaderMoveAtr: beyond,
            exhaustionWickRatio: null,
            trendZScoreAvg: null,
            plannedRewardRisk,
            plannedRiskPercent: risk / entryPrice,
            summary: `${side}: faded a close ${beyond.toFixed(2)} ATR beyond the prior ${config.lookback}-candle ${side === "SHORT" ? "high" : "low"}`,
        },
        entryFee: PnlUtility.calculateTakerFee(margin, leverage),
        mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
        exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
        openGi: gi, closeGi: null, durationMinutes: null,
    };
}

/**
 * The holding time the calibration selected, in candles. 96 = 24h on 15m.
 * Exported so a caller passes the number this entry was measured with
 * instead of inheriting the reversal entry's 250.
 */
export const EXTENSION_MAX_DURATION_CANDLES = 96;

// =====================================================================
// CROSS-SECTIONAL BOOK — position construction only
//
// The DECISION (which symbols, which side) is made in
// crossSectionalMomentum.ts, which stays free of app types so it can run
// against a parsed export. What it cannot do is build a PositionEntry, because
// that needs PnlUtility and the app's own type. So the split is: that module
// ranks, this function constructs.
//
// This is NOT a trigger. `checkPositionEntry` and `checkExtensionEntry` decide
// from one symbol's candles; nothing here looks at a candle at all beyond the
// entry price and ATR handed in, because the reason this position exists is how
// its symbol ranked against 298 others.
// =====================================================================

export interface CrossSectionalPositionInput {
    side: "LONG" | "SHORT";
    /** The ranking candle - the position opens at its close. */
    candle: CandleInfo;
    /** Index of that candle in the caller's current window. */
    gi: number;
    /** ATR at entry, same units as price. The caller computes it; see simpleAtr. */
    atr: number;
    margin: number;
    /**
     * Leverage for THIS position, which is deliberately not DEFAULT_LEVERAGE.
     * A 30-ATR stop needs the stop to be reachable before liquidation, and at a
     * 0.659% ATR that means about 5x. See crossSectionalMomentum.leverageForStop.
     */
    leverage: number;
    /** Stop distance in ATR. Measured at 30; 20x cannot support more than ~7.6. */
    stopAtr: number;
    /** Holding time in candles. Measured at 384 (4 days) and meaningless elsewhere. */
    holdCandles: number;
    /** Trailing return that produced the ranking, and where it ranked. Recorded, not used. */
    trailingReturn: number;
    rankPercentile: number;
}

/**
 * Build a cross-sectional position.
 *
 * NO TAKE-PROFIT. The measured exit is time, not a level, so `tp` is placed far
 * enough away that `updatePositionEntry` can never reach it. It is not set to
 * Infinity because that would propagate through the R:R and pnl arithmetic and
 * into the export as a non-finite number; a concrete level keeps every downstream
 * calculation finite and the intent readable.
 *
 * THE SENTINEL IS A PRICE FRACTION, NOT AN ATR MULTIPLE, and a test is what
 * forced that. An ATR-multiple sentinel large enough to be unreachable for a LONG
 * put every SHORT's target BELOW ZERO - 1,000 ATR below a price of 100 at an ATR
 * of 0.659 is -559 - so the factory refused every short it was handed and the
 * book could only ever have opened its long legs. That is exactly the
 * one-sided book this whole approach exists to prevent, and it would have shown
 * up as a plausible-looking run rather than an error.
 *
 * A LONG's target is 11x the entry and a SHORT's is 1% of it. Both are far beyond
 * any four-day move, both are finite and positive, and neither depends on ATR. A
 * position that reached either inside four days would be a data error worth
 * seeing, not a target worth honouring.
 *
 * `plannedRewardRisk` is therefore NOT meaningful for this trigger - it is the
 * distance to a sentinel - and the R:R gate does not apply to a book whose exit
 * is time. It is still stamped, because the field is not optional and a
 * recognisably absurd number is better than a plausible wrong one.
 *
 * Returns null rather than an invalid position when the inputs cannot produce
 * one, so a caller cannot open a position with an inverted or zero-width stop.
 */
const CROSS_SECTIONAL_NO_TARGET_LONG = 11;    // x entry price
const CROSS_SECTIONAL_NO_TARGET_SHORT = 0.01; // x entry price

export function createCrossSectionalPosition(
    input: CrossSectionalPositionInput
): PositionEntry | null {
    const { side, candle, gi, atr, margin, leverage, stopAtr, holdCandles } = input;
    if (!(atr > 0) || !(margin > 0) || !(leverage > 0)) return null;
    if (!(stopAtr > 0) || !(holdCandles >= 1)) return null;
    const entryPrice = candle.close;
    if (!(entryPrice > 0)) return null;

    // THE STOP MUST BE REACHABLE BEFORE LIQUIDATION. Defence in depth: the caller
    // is expected to derive leverage from the risk budget
    // (crossSectionalMomentum.leverageForRiskBudget), but a fixed leverage passed
    // by hand can easily put the stop past the liquidation price, and then the
    // position is not risking what it was sized to risk - it is risking the whole
    // margin. Measured on real archive candles, a fixed 5x with a 30-ATR stop put
    // the widest stop at 70.9% of price against a 20% liquidation distance.
    // Refused rather than clamped, because clamping would silently change the risk
    // the book was sized for.
    const stopMove = (stopAtr * atr) / entryPrice;
    if (!(stopMove > 0) || stopMove >= 1 / leverage) return null;

    const risk = stopAtr * atr;
    const sl = side === "LONG" ? entryPrice - risk : entryPrice + risk;
    const tp = side === "LONG"
        ? entryPrice * CROSS_SECTIONAL_NO_TARGET_LONG
        : entryPrice * CROSS_SECTIONAL_NO_TARGET_SHORT;
    const reward = Math.abs(tp - entryPrice);
    // A stop 30 ATR away can sit below zero on a low-priced asset, which would
    // make the position unclosable at its stop and its risk unbounded. Rejected
    // rather than clamped: clamping would silently change the risk the book was
    // sized for.
    if (!(sl > 0) || !(tp > 0)) return null;
    if (side === "LONG" && (sl >= entryPrice || tp <= entryPrice)) return null;
    if (side === "SHORT" && (sl <= entryPrice || tp >= entryPrice)) return null;

    return {
        side, entryPrice, margin, leverage, sl, tp,
        openTime: candle.openTime,
        maxDurationCandles: holdCandles,
        entryReason: {
            trigger: "CROSS_SECTIONAL",
            // The book's own direction language: a LONG is a winner, a SHORT a
            // loser. Mapped onto the existing field rather than left arbitrary.
            reversingDirection: side === "LONG" ? "UP" : "DOWN",
            // There is no reversing segment. These carry the only geometry that
            // exists here - the entry and its stop - instead of being left null
            // and reading as missing data.
            segmentLow: Math.min(entryPrice, sl),
            segmentHigh: Math.max(entryPrice, sl),
            segmentMid: entryPrice,
            broaderMoveAtr: input.trailingReturn,
            exhaustionWickRatio: null,
            trendZScoreAvg: input.rankPercentile,
            plannedRewardRisk: reward / risk,
            plannedRiskPercent: risk / entryPrice,
            summary: `${side}: cross-sectional rank ${(input.rankPercentile * 100).toFixed(0)}%`
                + ` (trailing ${(input.trailingReturn * 100).toFixed(2)}%),`
                + ` stop ${stopAtr} ATR, hold ${holdCandles} candles at ${leverage}x`,
        },
        entryFee: PnlUtility.calculateTakerFee(margin, leverage),
        mae: 0, mfe: 0, maePrice: 0, mfePrice: 0, atrAtEntry: atr,
        exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
        openGi: gi, closeGi: null, durationMinutes: null,
    };
}