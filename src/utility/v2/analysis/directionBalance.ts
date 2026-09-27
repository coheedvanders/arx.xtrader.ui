/**
 * PER-DAY DIRECTION BALANCE — the largest fixable factor found, worth ~0.17R
 * per trade, and it is a portfolio rule rather than an entry rule.
 *
 * =====================================================================
 * THE PROBLEM IT SOLVES
 * =====================================================================
 * The breakout-fade event family is not symmetric in COUNT. Over 299 symbols and
 * 37 days there were 12,855 downside events against 9,473 upside ones — 36% more
 * — and fading a downside event is a LONG. So a book that simply takes every
 * signal is structurally net long, and it then earns or loses the market's drift
 * on top of whatever the signal is worth. In a falling window that is a pure
 * loss, and it is not the signal's fault.
 *
 * Measured at target 3 ATR, stop 3 ATR, expiry 96, net of round-trip taker:
 *
 *     long-only (what the lab ran)          -0.1838R   (12,855 trades)
 *     short leg only                        -0.0086R   ( 9,473 trades)
 *     every signal, unbalanced              -0.1094R   (22,328 trades)
 *     direction-balanced, tolerance 20      -0.0117R   ( 6,402 trades)
 *
 * The balanced book is an order of magnitude closer to flat than the long-only
 * book while trading a third of the volume. It is still slightly NEGATIVE — this
 * is not a profitable configuration and must not be described as one — but 0.17R
 * per trade of the loss was exposure, not signal, and that part is removable.
 *
 * =====================================================================
 * WHY THIS IS CAUSAL
 * =====================================================================
 * The only thing consulted is what has ALREADY been opened today. No forward
 * candle, no knowledge of how many signals the rest of the day will bring, no
 * knowledge of the day's return. A live bot has exactly this information.
 *
 * Note what it cannot do: it cannot know that a long it refuses at 04:00 would
 * have been paired by a short at 19:00. It therefore refuses signals that a
 * perfect-foresight balancer would have taken, which is why the tolerance
 * matters — a tolerance of 1 forces strict alternation and throws away most of
 * the sample, while a loose tolerance lets the imbalance build back up.
 *
 *     tolerance   trades   pooled netR
 *         2        3,712     -0.0660
 *         5        4,469     -0.0553
 *        20        6,402     -0.0117
 *
 * ARBITRARY IN MAGNITUDE, and said plainly: 20 is where the measurement was
 * taken and there is no argument that picks it over 15 or 30. The DIRECTION has
 * an argument — an unbounded imbalance is an unhedged directional bet the signal
 * never asked for. A caller that prefers a hard cap on net exposure rather than a
 * count tolerance should say so; this models the count, because the count is what
 * the event asymmetry produces.
 *
 * =====================================================================
 * WHAT THIS DELIBERATELY IS NOT
 * =====================================================================
 * Not a hedge, not a market-neutral portfolio, and not a dollar-neutral one. It
 * balances the COUNT of open longs against open shorts, which is only
 * exposure-neutral if positions are equally sized — which they are in this lab,
 * because margin is frozen per tick and identical across symbols. If sizing ever
 * varies per symbol, this must be changed to balance notional, and the
 * measurement above must be re-taken.
 *
 * Pure functions over plain data, no dependency on the app's type graph, so it
 * runs against a parsed export exactly as simulationSummary.ts and fundingCost.ts
 * do.
 */

export const DAY_MS = 86_400_000;

export interface DirectionBalanceConfig {
    /**
     * How far |openLongs - openShorts| may go within one UTC day. 0 disables the
     * rule entirely (every signal allowed); 1 forces strict alternation.
     *
     * A value of 0 means OFF, not "perfectly balanced" — a tolerance of zero is
     * unsatisfiable, since the first trade of any day makes the difference 1. An
     * earlier version of this measurement passed 0 meaning strict and silently
     * produced zero trades in every cell.
     */
    tolerance: number;
    /** Optional ceiling on accepted signals per day. 0 disables. */
    maxPerDay: number;
    /**
     * Tolerance as a FRACTION of the day's accepted trades. 0 disables, which is
     * the previous behaviour exactly.
     *
     * WHY THIS EXISTS. `tolerance` is an absolute count, and 20 was measured on
     * the offline book - which took every signal across 299 symbols with no
     * position cap, thousands of trades a day, where 20 binds constantly. A
     * capped portfolio run produces about 29 trades a day, its median
     * |longs - shorts| is 14, and 20 then binds on 6 days out of 33. Measured on
     * a real run: `refusedForBalance` came back ZERO. The rule was configured,
     * reported as on, and never once fired.
     *
     * An absolute tolerance means a busy day is proportionally balanced and a
     * quiet day is wildly skewed, which is backwards - neutrality is a statement
     * about the RATIO. The effective tolerance is therefore
     *
     *     max(tolerance, ceil(toleranceFraction * accepted))
     *
     * so the absolute value governs while the day is young and the proportional
     * one takes over once there are enough trades for a ratio to mean anything.
     *
     * THE FRACTION IS ARBITRARY IN MAGNITUDE. The argument is only that the rule
     * should scale; nothing selects 0.2 over 0.15 or 0.25.
     */
    toleranceFraction: number;
}

export const DIRECTION_BALANCE_OFF: DirectionBalanceConfig = {
    tolerance: 0,
    maxPerDay: 0,
    toleranceFraction: 0,
};

/** The measured configuration. See the header for why 20 is arbitrary. */
export const DIRECTION_BALANCE_MEASURED: DirectionBalanceConfig = {
    tolerance: 4,
    maxPerDay: 0,
    toleranceFraction: 0.2,
};

/** Running state for one day. Reset when the day rolls over. */
export interface DirectionBalanceState {
    dayKey: number;
    longs: number;
    shorts: number;
    accepted: number;
    /** Signals refused by the balance rule, for the run's own bookkeeping. */
    refusedForBalance: number;
    refusedForCap: number;
}

export function newDirectionBalanceState(timestampMs: number): DirectionBalanceState {
    return {
        dayKey: Math.floor(timestampMs / DAY_MS),
        longs: 0, shorts: 0, accepted: 0,
        refusedForBalance: 0, refusedForCap: 0,
    };
}

/**
 * Roll the state over when the UTC day changes. Returns the state to use.
 *
 * Counts are per DAY and are NOT carried across the boundary, deliberately: the
 * quantity being neutralised is the day's drift, so the accounting period has to
 * be the day. A position opened yesterday and still open today is not counted
 * again — the rule governs what is OPENED, which is the only thing a causal gate
 * can govern.
 */
export function rollDirectionBalanceDay(
    state: DirectionBalanceState,
    timestampMs: number
): DirectionBalanceState {
    const key = Math.floor(timestampMs / DAY_MS);
    return key === state.dayKey ? state : newDirectionBalanceState(timestampMs);
}

export interface DirectionBalanceDecision {
    allowed: boolean;
    /** Why not, for the export. Empty when allowed. */
    reason: "" | "IMBALANCE" | "DAY_CAP" | "DISABLED_NEVER_BLOCKS";
    /** |longs - shorts| that would result if this were accepted. */
    projectedImbalance: number;
}

/**
 * May a position on `side` be opened now, given what today has already opened?
 *
 * Does NOT mutate. Call `commitDirectionBalance` once the position is actually
 * created, and only then — the two are separate because the lab evaluates several
 * gates per candidate and any of them can still refuse it after this one passes.
 * A decide-and-mutate function would count refused candidates.
 */
export function decideDirectionBalance(
    state: DirectionBalanceState,
    side: "LONG" | "SHORT",
    config: DirectionBalanceConfig
): DirectionBalanceDecision {
    if (!(config.tolerance > 0) && !(config.maxPerDay > 0) && !(config.toleranceFraction > 0)) {
        return { allowed: true, reason: "DISABLED_NEVER_BLOCKS", projectedImbalance: 0 };
    }
    if (config.maxPerDay > 0 && state.accepted >= config.maxPerDay) {
        return {
            allowed: false, reason: "DAY_CAP",
            projectedImbalance: Math.abs(state.longs - state.shorts),
        };
    }
    const longs = side === "LONG" ? state.longs + 1 : state.longs;
    const shorts = side === "SHORT" ? state.shorts + 1 : state.shorts;
    const projected = Math.abs(longs - shorts);
    // The looser of the two, so setting only one of them behaves as it always
    // did and setting both means "at least this many, and at least this share".
    const effective = Math.max(
        config.tolerance > 0 ? config.tolerance : 0,
        config.toleranceFraction > 0 ? Math.ceil(config.toleranceFraction * state.accepted) : 0
    );
    if (effective > 0 && projected > effective) {
        return { allowed: false, reason: "IMBALANCE", projectedImbalance: projected };
    }
    return { allowed: true, reason: "", projectedImbalance: projected };
}

/** Record an accepted position. Mutates and returns the same object. */
export function commitDirectionBalance(
    state: DirectionBalanceState,
    side: "LONG" | "SHORT"
): DirectionBalanceState {
    if (side === "LONG") state.longs += 1;
    else state.shorts += 1;
    state.accepted += 1;
    return state;
}

/** Record a refusal, so the export can show how much the rule turned away. */
export function recordDirectionBalanceRefusal(
    state: DirectionBalanceState,
    reason: DirectionBalanceDecision["reason"]
): DirectionBalanceState {
    if (reason === "IMBALANCE") state.refusedForBalance += 1;
    else if (reason === "DAY_CAP") state.refusedForCap += 1;
    return state;
}