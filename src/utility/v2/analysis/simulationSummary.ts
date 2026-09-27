// Intended location: src/utility/v2/analysis/simulationSummary.ts
//
// Pure, deterministic reporting over a finished (or paused) rolling
// simulation. No Vue, no DOM, no fetching, no hidden state - the same
// inputs always produce the same output, so it can be unit-tested and
// re-run over an exported JSON file offline.
//
// DELIBERATELY NOT A SCORE. Every field here is a raw observation or a
// standard descriptive statistic (counts, sums, extremes, ratios that
// have a plain arithmetic meaning). There is no weighting, no composite
// "health" number, and no threshold deciding whether a run is good -
// those judgements stay with the reader, who can see the components.

// ── Inputs ───────────────────────────────────────────────────────────────
// Structural minimums rather than imports of the component's own types,
// so this module can also be pointed at a parsed export file.

export interface SummarySnapshot {
    timestamp: number;
    won: number;
    loss: number;
    expired: number;
    open: number;
    totalTakerFee: number;
    totalClosedPnl: number;
    totalOpenPnl: number;
    marginBalance: number;
    balance: number;
    positionCap: number;
    /** Margin a NEW position would take at this tick. Optional so this
     *  module still reads exports made before sizing was dynamic. */
    marginPerPosition?: number;
}

export interface SummaryPosition {
    symbol: string;
    openTime: number;
    closeTime: number;
    side: "LONG" | "SHORT";
    entryPrice: number;
    margin: number;
    leverage: number;
    entryFee: number;
    /** Taker fee on the exit fill. Optional so this module still reads
     *  exports produced before exit fees were charged at all. */
    exitFee?: number | null;
    /** Funding paid over the position's life, positive = paid. */
    fundingPaid?: number;
    status: "WON" | "LOSS";
    /**
     * MUST stay in sync with PositionEntry["closeReason"] in
     * interfacesv2.ts. Duplicated rather than imported on purpose: this
     * module is meant to run standalone against a parsed export file,
     * with no dependency on the app's type graph. The cost of that is
     * exactly this - a reason added there and not here is a compile
     * error at the call site, so add new values in BOTH places.
     */
    closeReason?: "TP" | "SL" | "MID" | "EXPIRED" | "AUTO_CLOSE" | "LIQUIDATED" | "MANAGED" | null;
    /** ATR-normalized excursions from entry. Optional so this module
     *  still reads exports produced before they were captured. */
    mae?: number;
    mfe?: number;
    pnl: number | null;
}

export interface MarginTierRow {
    margin: number;
    trades: number;
    wins: number;
    winRate: number | null;
    grossPnl: number;
    cost: number;
    netPnl: number;
    avgNetPnl: number;
    /**
     * Net pnl per UNIT of margin committed.
     *
     * The column that actually answers "did the edge survive being
     * scaled". Comparing raw netPnl across tiers is misleading by
     * construction: a tier trading 6 USDT of margin produces roughly six
     * times the absolute pnl of a 1 USDT tier from the identical edge, so
     * the bigger tier always looks better. Dividing by margin puts every
     * tier on the same footing - if this number falls as margin rises,
     * scaling up is costing something real (worse fills, more
     * concentration, different market conditions), not just moving more
     * size through the same edge.
     */
    netPerMarginUnit: number | null;
}

export interface MarginProgression {
    /** Distinct per-position margins actually traded, ascending. */
    tiers: MarginTierRow[];
    /** The per-tick "margin a new position would take", over the run. */
    firstTickMargin: number | null;
    lastTickMargin: number | null;
    minTickMargin: number | null;
    maxTickMargin: number | null;
    /** True when the run traded more than one margin size - i.e. sizing
     *  actually moved, so the tier comparison below means something. */
    marginChanged: boolean;
    /** Ticks carrying marginPerPosition. 0 = an export from before
     *  sizing was recorded, so tick-level figures are unavailable. */
    tickMarginSampled: number;
}

export interface ExcursionPoint {
    mae: number;
    mfe: number;
    won: boolean;
}

export interface ExcursionBin {
    /** Inclusive lower edge, exclusive upper, both in ATR. */
    from: number;
    to: number;
    winners: number;
    losers: number;
}

export interface ExcursionPercentiles {
    p50: number | null;
    p75: number | null;
    p90: number | null;
    max: number | null;
}

export interface ExcursionStats {
    /** Rows that actually carried mae/mfe - older exports have none, and
     *  averaging over a smaller n than `tradesClosed` must be visible. */
    sampled: number;
    avgMae: number | null;
    avgMfe: number | null;
    avgMaeWinners: number | null;
    avgMfeWinners: number | null;
    avgMaeLosers: number | null;
    avgMfeLosers: number | null;
    /**
     * Losers whose MFE exceeded the average winner's MAE - i.e. trades
     * that went further in your favour than a typical winner ever went
     * against you, and still lost.
     *
     * This is the one number that says something about the EXIT rather
     * than the entry: a large share means the edge was there and the
     * take-profit never caught it. Null when there aren't enough winners
     * to establish the reference. It is a count, not a verdict - a
     * healthy strategy can have plenty of these.
     */
    losersThatWentFavorableFirst: number | null;
    /** The MAE threshold above, for reference. */
    winnerMaeReference: number | null;

    /**
     * Per-trade points for a scatter plot, capped by even stride so the
     * chart stays drawable - `scatterSampled` vs `sampled` says how many
     * were kept. Stride, not a random sample, so the same run always
     * produces the same picture.
     */
    scatter: ExcursionPoint[];
    scatterSampled: number;
    maxMae: number;
    maxMfe: number;

    /** Fixed-width bins over [0, max], split by outcome. */
    maeHistogram: ExcursionBin[];
    mfeHistogram: ExcursionBin[];

    /**
     * How much of the available room each side actually used. Both are
     * CENSORED distributions - see the note on buildExcursionStats - so
     * read these as "where the mass sits inside the boundary", never as
     * an estimate of what lies beyond it.
     */
    winnerMaePercentiles: ExcursionPercentiles;
    loserMfePercentiles: ExcursionPercentiles;
}

// ── Output shapes ────────────────────────────────────────────────────────

export interface DrawdownEpisode {
    peakIndex: number;
    peakTimestamp: number;
    peakEquity: number;
    troughIndex: number;
    troughTimestamp: number;
    troughEquity: number;
    /** Peak minus trough, in USDT. Always >= 0. */
    depthUsdt: number;
    /** depthUsdt / peakEquity. null when peakEquity <= 0, where a
     *  percentage has no meaningful denominator. */
    depthPercent: number | null;
    /** Ticks from the peak to the trough. */
    ticksToTrough: number;
    /** The tick equity first got back to the peak, or null if it never
     *  did within this run - an unrecovered drawdown is a materially
     *  different fact from a recovered one of the same depth. */
    recoveredIndex: number | null;
    recoveredTimestamp: number | null;
    /** True if equity reached or crossed zero during this episode. */
    wentNonPositive: boolean;
}

export interface TickMove {
    index: number;
    timestamp: number;
    equityBefore: number;
    equityAfter: number;
    changeUsdt: number;
    /** Open positions at the END of this tick. A large drop paired with
     *  a large fall in open count is the correlated mass-close pattern. */
    openBefore: number;
    openAfter: number;
    closedThisTick: number;
}

export interface ExitBreakdownRow {
    reason: string;
    count: number;
    /** Share of all resolved positions, 0-1. */
    share: number;
    totalPnl: number;
    avgPnl: number;
    /** Entry + exit fees + funding for this bucket. */
    totalCost: number;
    /** totalPnl - totalCost. A bucket can be gross-positive and
     *  net-negative; EXPIRED is the one most likely to be, since it
     *  carries the longest holds and therefore the most funding. */
    netPnl: number;
    wins: number;
    losses: number;
}

export interface SymbolContribution {
    symbol: string;
    trades: number;
    wins: number;
    losses: number;
    totalPnl: number;
}

export interface SideBreakdownRow {
    side: "LONG" | "SHORT";
    trades: number;
    wins: number;
    winRate: number | null;
    totalPnl: number;
    avgWin: number | null;
    avgLoss: number | null;
}

export interface EquityPoint {
    timestamp: number;
    equity: number;
}

export interface SimulationSummary {
    computedAt: number;
    /** True when built from a run that hadn't finished - every forward-
     *  looking figure below is a running state, not an outcome. */
    partial: boolean;

    ticks: number;
    firstTimestamp: number | null;
    lastTimestamp: number | null;

    startingBalance: number;
    finalEquity: number;
    /** finalEquity - startingBalance. */
    netPnl: number;
    /** finalEquity / startingBalance. null when startingBalance <= 0. */
    returnMultiple: number | null;

    tradesClosed: number;
    wins: number;
    losses: number;
    /** wins / tradesClosed, 0-1. null when nothing has closed. */
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    /** avgWin / |avgLoss| - how many losses one win pays for. Together
     *  with winRate this is the whole edge: a 37% win rate is profitable
     *  precisely when this exceeds ~1.7. */
    payoffRatio: number | null;
    /** Mean realized pnl per closed trade, fees excluded (fees are
     *  reported separately since they're charged at open, not exit). */
    expectancyPerTrade: number | null;
    grossProfit: number;
    grossLoss: number;
    /** entry + exit taker fees across all closed positions. */
    totalFees: number;
    totalEntryFees: number;
    totalExitFees: number;
    totalFunding: number;
    /**
     * Positions carrying an exitFee. Older exports have none, and a zero
     * exit-fee total is indistinguishable from "never charged" unless
     * the count is visible.
     */
    exitFeeSampled: number;

    /**
     * pnl MINUS that position's own entry fee, exit fee and funding.
     *
     * The `pnl` on a position is GROSS - price movement times leverage
     * times margin, nothing subtracted. Costs are applied at the account
     * level, so a trade can show a positive pnl and still have lost
     * money. These fields are the same statistics computed on the net
     * figure, and they are the ones that describe the strategy as it
     * would actually have been experienced.
     */
    netTotalPnl: number;
    netExpectancyPerTrade: number | null;
    /** Closed trades whose gross pnl was positive but net was not -
     *  "winners" that costs turned into losers. */
    grossWinnersLostToCosts: number;

    /** Largest peak-to-trough fall in equity over the whole run. */
    maxDrawdownUsdt: number;
    maxDrawdownPercent: number | null;
    maxDrawdownEpisode: DrawdownEpisode | null;
    /** Equity reached or crossed zero at some point - i.e. the account
     *  would have been liquidated in reality, and everything after that
     *  point is hypothetical. */
    equityWentNonPositive: boolean;
    firstNonPositiveTimestamp: number | null;

    peakEquity: number;
    peakEquityTimestamp: number | null;
    lowestEquity: number;
    lowestEquityTimestamp: number | null;

    maxOpenPositions: number;
    maxOpenPositionsTimestamp: number | null;
    /** Mean of `open` across every tick - how much of the book was
     *  actually in use, against the cap. */
    avgOpenPositions: number | null;

    topDrawdowns: DrawdownEpisode[];
    worstTicks: TickMove[];
    bestTicks: TickMove[];
    topWinningTrades: SummaryPosition[];
    topLosingTrades: SummaryPosition[];
    exitBreakdown: ExitBreakdownRow[];
    sideBreakdown: SideBreakdownRow[];
    excursions: ExcursionStats;
    marginProgression: MarginProgression;
    topSymbolsByProfit: SymbolContribution[];
    topSymbolsByLoss: SymbolContribution[];
    /** Downsampled equity curve for plotting - see buildEquityCurve. */
    equityCurve: EquityPoint[];
}

export interface SummaryOptions {
    startingBalance: number;
    partial: boolean;
    /** How many rows each "top N" list holds. Presentation only - it
     *  changes nothing that is computed, just how much is kept. */
    topN?: number;
    /** Target point count for the plotted curve. */
    curvePoints?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sum(values: number[]): number {
    let total = 0;
    for (const v of values) total += v;
    return total;
}

function mean(values: number[]): number | null {
    if (!values.length) return null;
    return sum(values) / values.length;
}

/**
 * Every peak-to-trough fall in equity, in chronological order.
 *
 * A new episode opens the first time equity drops below the running
 * peak, deepens while it keeps falling, and closes when equity gets back
 * to that peak. An episode still open at the end of the run is returned
 * too, with recoveredIndex null - that distinction matters more than the
 * depth, because an unrecovered drawdown is where the run actually
 * stands right now.
 *
 * Equity here is marginBalance: balance + margin committed + open pnl,
 * i.e. what the account is actually worth mid-flight. Using `balance`
 * instead would read as a fall every time a position OPENS (margin moves
 * out of balance), which is not a loss.
 */
export function findDrawdownEpisodes(snapshots: SummarySnapshot[]): DrawdownEpisode[] {
    const episodes: DrawdownEpisode[] = [];
    if (!snapshots.length) return episodes;

    let peakIndex = 0;
    let peakEquity = snapshots[0].marginBalance;
    let current: DrawdownEpisode | null = null;

    for (let i = 1; i < snapshots.length; i++) {
        const equity = snapshots[i].marginBalance;

        if (equity >= peakEquity) {
            if (current) {
                current.recoveredIndex = i;
                current.recoveredTimestamp = snapshots[i].timestamp;
                episodes.push(current);
                current = null;
            }
            peakEquity = equity;
            peakIndex = i;
            continue;
        }

        if (!current) {
            current = {
                peakIndex,
                peakTimestamp: snapshots[peakIndex].timestamp,
                peakEquity,
                troughIndex: i,
                troughTimestamp: snapshots[i].timestamp,
                troughEquity: equity,
                depthUsdt: peakEquity - equity,
                depthPercent: peakEquity > 0 ? (peakEquity - equity) / peakEquity : null,
                ticksToTrough: i - peakIndex,
                recoveredIndex: null,
                recoveredTimestamp: null,
                wentNonPositive: equity <= 0,
            };
        } else if (equity < current.troughEquity) {
            current.troughIndex = i;
            current.troughTimestamp = snapshots[i].timestamp;
            current.troughEquity = equity;
            current.depthUsdt = current.peakEquity - equity;
            current.depthPercent = current.peakEquity > 0 ? current.depthUsdt / current.peakEquity : null;
            current.ticksToTrough = i - current.peakIndex;
        }

        if (current && equity <= 0) current.wentNonPositive = true;
    }

    if (current) episodes.push(current);
    return episodes;
}

/** Tick-over-tick equity changes, with the open-position counts that
 *  frame them. The most negative of these is how a correlated mass-close
 *  shows up: a large drop and a large fall in open count on one tick. */
export function findTickMoves(snapshots: SummarySnapshot[]): TickMove[] {
    const moves: TickMove[] = [];
    for (let i = 1; i < snapshots.length; i++) {
        const prev = snapshots[i - 1];
        const cur = snapshots[i];
        moves.push({
            index: i,
            timestamp: cur.timestamp,
            equityBefore: prev.marginBalance,
            equityAfter: cur.marginBalance,
            changeUsdt: cur.marginBalance - prev.marginBalance,
            openBefore: prev.open,
            openAfter: cur.open,
            // won/loss are cumulative, so their increase is how many
            // positions actually resolved on this tick.
            closedThisTick: (cur.won + cur.loss) - (prev.won + prev.loss),
        });
    }
    return moves;
}

/**
 * Downsamples the equity curve for plotting while KEEPING the extremes.
 *
 * Plain striding (every Nth point) would skip straight past the trough
 * of a sharp drawdown, drawing a curve that looks smoother than the run
 * actually was. Bucketing and emitting each bucket's min AND max keeps
 * every spike visible at any sample rate - the standard approach for
 * drawing a long series in few pixels.
 */
export function buildEquityCurve(snapshots: SummarySnapshot[], targetPoints = 400): EquityPoint[] {
    if (snapshots.length <= targetPoints) {
        return snapshots.map(s => ({ timestamp: s.timestamp, equity: s.marginBalance }));
    }
    const buckets = Math.max(1, Math.floor(targetPoints / 2));
    const size = snapshots.length / buckets;
    const points: EquityPoint[] = [];

    for (let b = 0; b < buckets; b++) {
        const start = Math.floor(b * size);
        const end = Math.min(snapshots.length, Math.floor((b + 1) * size));
        if (end <= start) continue;

        let lo = snapshots[start];
        let hi = snapshots[start];
        for (let i = start + 1; i < end; i++) {
            if (snapshots[i].marginBalance < lo.marginBalance) lo = snapshots[i];
            if (snapshots[i].marginBalance > hi.marginBalance) hi = snapshots[i];
        }
        // Emit in the order they actually occurred, so the line doesn't
        // zig backwards in time within a bucket.
        const [first, second] = lo.timestamp <= hi.timestamp ? [lo, hi] : [hi, lo];
        points.push({ timestamp: first.timestamp, equity: first.marginBalance });
        if (second !== first) points.push({ timestamp: second.timestamp, equity: second.marginBalance });
    }
    return points;
}

function buildExitBreakdown(positions: SummaryPosition[]): ExitBreakdownRow[] {
    const groups = new Map<string, SummaryPosition[]>();
    for (const p of positions) {
        // An older record with no closeReason is "unknown", never folded
        // into a real bucket - silently counting it as TP/SL would
        // fabricate the exact fact this breakdown exists to establish.
        const key = p.closeReason ?? "UNKNOWN";
        const list = groups.get(key);
        if (list) list.push(p);
        else groups.set(key, [p]);
    }

    const total = positions.length;
    const rows: ExitBreakdownRow[] = [];
    for (const [reason, list] of groups) {
        const pnls = list.map(p => p.pnl ?? 0);
        rows.push({
            reason,
            count: list.length,
            share: total > 0 ? list.length / total : 0,
            totalPnl: sum(pnls),
            avgPnl: mean(pnls) ?? 0,
            totalCost: sum(list.map(positionCost)),
            netPnl: sum(list.map(netPnlOf)),
            wins: list.filter(p => p.status === "WON").length,
            losses: list.filter(p => p.status === "LOSS").length,
        });
    }
    return rows.sort((a, b) => b.count - a.count);
}

function buildSideBreakdown(positions: SummaryPosition[]): SideBreakdownRow[] {
    const sides: Array<"LONG" | "SHORT"> = ["LONG", "SHORT"];
    return sides.map(side => {
        const list = positions.filter(p => p.side === side);
        const wins = list.filter(p => p.status === "WON");
        const losses = list.filter(p => p.status === "LOSS");
        return {
            side,
            trades: list.length,
            wins: wins.length,
            winRate: list.length ? wins.length / list.length : null,
            totalPnl: sum(list.map(p => p.pnl ?? 0)),
            avgWin: mean(wins.map(p => p.pnl ?? 0)),
            avgLoss: mean(losses.map(p => p.pnl ?? 0)),
        };
    });
}

/** Linear-interpolated percentile over a sorted ascending array. */
function percentile(sorted: number[], q: number): number | null {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function percentilesOf(values: number[]): ExcursionPercentiles {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.9),
        max: sorted.length ? sorted[sorted.length - 1] : null,
    };
}

/**
 * Fixed-width bins over [0, max], each counting winners and losers
 * separately. Bin count is a presentation choice; the EDGES are derived
 * from the data's own max rather than fixed in ATR, so the histogram
 * always spans exactly the observed range instead of being mostly empty
 * or clipped.
 */
function histogram(
    positions: SummaryPosition[],
    pick: (p: SummaryPosition) => number,
    max: number,
    bins: number
): ExcursionBin[] {
    const width = max > 0 ? max / bins : 1;
    const out: ExcursionBin[] = [];
    for (let i = 0; i < bins; i++) {
        out.push({ from: i * width, to: (i + 1) * width, winners: 0, losers: 0 });
    }
    for (const p of positions) {
        const v = pick(p);
        // The top edge is inclusive for the max value only, which would
        // otherwise land in a bin that doesn't exist.
        const idx = Math.min(bins - 1, Math.floor(v / width));
        if (idx < 0) continue;
        if (p.status === "WON") out[idx].winners++;
        else out[idx].losers++;
    }
    return out;
}

/**
 * MAE/MFE aggregates, over ONLY the positions that carry them.
 *
 * A NOTE ON CENSORING, which governs how any of this may be read:
 * both distributions are truncated by the exits themselves. A trade
 * whose adverse excursion would have exceeded the stop was stopped out
 * and recorded as a LOSS, so winners' MAE cannot run much past the stop
 * distance. Symmetrically, a trade whose favorable excursion passed the
 * target hit it and was recorded as a WIN, so losers' MFE cannot run
 * much past the target. Neither tail is missing at random - it was
 * removed by the rule being evaluated.
 *
 * What survives this and IS readable: how much of the available room
 * each side actually uses, and how much mass piles up against the
 * boundary. Winners clustered at low MAE means the stop is wider than
 * winners need. Losers clustered just under the target means near-misses.
 * What is NOT readable: how many winners a wider stop would have saved -
 * those trades are in the loss bucket and indistinguishable from trades
 * that were simply wrong. Averaging
 * a missing value as 0 would quietly drag every figure toward zero and
 * make an old export look like a strategy with no adverse excursion at
 * all, so unpopulated rows are excluded and `sampled` reports how many
 * were actually used.
 */
function buildExcursionStats(positions: SummaryPosition[]): ExcursionStats {
    const withData = positions.filter(p => typeof p.mae === "number" && typeof p.mfe === "number");
    const wins = withData.filter(p => p.status === "WON");
    const losses = withData.filter(p => p.status === "LOSS");

    const avgMaeWinners = mean(wins.map(p => p.mae as number));
    const losersThatWentFavorableFirst = avgMaeWinners != null
        ? losses.filter(p => (p.mfe as number) > avgMaeWinners).length
        : null;

    const maes = withData.map(p => p.mae as number);
    const mfes = withData.map(p => p.mfe as number);
    const maxMae = maes.length ? Math.max(...maes) : 0;
    const maxMfe = mfes.length ? Math.max(...mfes) : 0;

    const SCATTER_CAP = 2000;
    const stride = Math.max(1, Math.ceil(withData.length / SCATTER_CAP));
    const scatter: ExcursionPoint[] = [];
    for (let i = 0; i < withData.length; i += stride) {
        const p = withData[i];
        scatter.push({ mae: p.mae as number, mfe: p.mfe as number, won: p.status === "WON" });
    }

    return {
        sampled: withData.length,
        scatter,
        scatterSampled: scatter.length,
        maxMae,
        maxMfe,
        maeHistogram: histogram(withData, p => p.mae as number, maxMae, 20),
        mfeHistogram: histogram(withData, p => p.mfe as number, maxMfe, 20),
        winnerMaePercentiles: percentilesOf(wins.map(p => p.mae as number)),
        loserMfePercentiles: percentilesOf(losses.map(p => p.mfe as number)),
        avgMae: mean(withData.map(p => p.mae as number)),
        avgMfe: mean(withData.map(p => p.mfe as number)),
        avgMaeWinners,
        avgMfeWinners: mean(wins.map(p => p.mfe as number)),
        avgMaeLosers: mean(losses.map(p => p.mae as number)),
        avgMfeLosers: mean(losses.map(p => p.mfe as number)),
        losersThatWentFavorableFirst,
        winnerMaeReference: avgMaeWinners,
    };
}

/** Total cost carried by one position: both taker fees plus funding.
 *  Missing fields count as 0 here deliberately - unlike the excursion
 *  stats, a cost that was never charged genuinely WAS zero in that run's
 *  accounting, and exitFeeSampled reports how many were priced. */
function positionCost(p: SummaryPosition): number {
    return (p.entryFee ?? 0) + (p.exitFee ?? 0) + (p.fundingPaid ?? 0);
}

function netPnlOf(p: SummaryPosition): number {
    return (p.pnl ?? 0) - positionCost(p);
}

/**
 * Groups closed trades by the margin each was actually opened at.
 *
 * Keyed on the position's OWN margin, not the tick margin: a book can
 * hold several sizes at once, because a position keeps whatever margin
 * it opened with while newer ones size up. That mix is the whole point
 * of the grouping.
 */
function buildMarginProgression(
    positions: SummaryPosition[],
    snapshots: SummarySnapshot[]
): MarginProgression {
    const groups = new Map<number, SummaryPosition[]>();
    for (const p of positions) {
        const list = groups.get(p.margin);
        if (list) list.push(p);
        else groups.set(p.margin, [p]);
    }

    const tiers: MarginTierRow[] = [];
    for (const [margin, list] of groups) {
        const wins = list.filter(p => p.status === "WON").length;
        const grossPnl = sum(list.map(p => p.pnl ?? 0));
        const cost = sum(list.map(positionCost));
        const netPnl = grossPnl - cost;
        const marginCommitted = margin * list.length;
        tiers.push({
            margin,
            trades: list.length,
            wins,
            winRate: list.length ? wins / list.length : null,
            grossPnl,
            cost,
            netPnl,
            avgNetPnl: netPnl / list.length,
            netPerMarginUnit: marginCommitted > 0 ? netPnl / marginCommitted : null,
        });
    }
    tiers.sort((a, b) => a.margin - b.margin);

    const tickMargins = snapshots
        .map(s => s.marginPerPosition)
        .filter((m): m is number => typeof m === "number");

    return {
        tiers,
        firstTickMargin: tickMargins.length ? tickMargins[0] : null,
        lastTickMargin: tickMargins.length ? tickMargins[tickMargins.length - 1] : null,
        minTickMargin: tickMargins.length ? Math.min(...tickMargins) : null,
        maxTickMargin: tickMargins.length ? Math.max(...tickMargins) : null,
        marginChanged: tiers.length > 1,
        tickMarginSampled: tickMargins.length,
    };
}

function buildSymbolContributions(positions: SummaryPosition[]): SymbolContribution[] {
    const map = new Map<string, SymbolContribution>();
    for (const p of positions) {
        let row = map.get(p.symbol);
        if (!row) {
            row = { symbol: p.symbol, trades: 0, wins: 0, losses: 0, totalPnl: 0 };
            map.set(p.symbol, row);
        }
        row.trades++;
        if (p.status === "WON") row.wins++;
        else if (p.status === "LOSS") row.losses++;
        row.totalPnl += p.pnl ?? 0;
    }
    return Array.from(map.values());
}

// ── Main entry point ─────────────────────────────────────────────────────

export function buildSimulationSummary(
    snapshots: SummarySnapshot[],
    positions: SummaryPosition[],
    options: SummaryOptions
): SimulationSummary {
    const topN = options.topN ?? 10;
    const last = snapshots.length ? snapshots[snapshots.length - 1] : null;

    const wins = positions.filter(p => p.status === "WON");
    const losses = positions.filter(p => p.status === "LOSS");
    const winPnls = wins.map(p => p.pnl ?? 0);
    const lossPnls = losses.map(p => p.pnl ?? 0);
    const allPnls = positions.map(p => p.pnl ?? 0);

    const avgWin = mean(winPnls);
    const avgLoss = mean(lossPnls);

    const episodes = findDrawdownEpisodes(snapshots);
    const moves = findTickMoves(snapshots);

    // Sorted by PERCENT depth, not USDT: on a compounding account a later
    // drawdown is larger in USDT almost by construction, which would make
    // the list say nothing except "the account grew". Percent is what
    // actually damages compounding. Both figures are on every row.
    // Episodes with a non-positive peak have no percent, and sort last.
    const topDrawdowns = [...episodes]
        .sort((a, b) => (b.depthPercent ?? -1) - (a.depthPercent ?? -1))
        .slice(0, topN);

    const deepestByUsdt = episodes.reduce<DrawdownEpisode | null>(
        (worst, e) => (!worst || e.depthUsdt > worst.depthUsdt ? e : worst), null
    );

    let peakEquity = -Infinity;
    let peakEquityTimestamp: number | null = null;
    let lowestEquity = Infinity;
    let lowestEquityTimestamp: number | null = null;
    let maxOpen = 0;
    let maxOpenTimestamp: number | null = null;
    let firstNonPositiveTimestamp: number | null = null;

    for (const s of snapshots) {
        if (s.marginBalance > peakEquity) { peakEquity = s.marginBalance; peakEquityTimestamp = s.timestamp; }
        if (s.marginBalance < lowestEquity) { lowestEquity = s.marginBalance; lowestEquityTimestamp = s.timestamp; }
        if (s.open > maxOpen) { maxOpen = s.open; maxOpenTimestamp = s.timestamp; }
        if (firstNonPositiveTimestamp === null && s.marginBalance <= 0) firstNonPositiveTimestamp = s.timestamp;
    }

    const finalEquity = last ? last.marginBalance : options.startingBalance;
    const symbolRows = buildSymbolContributions(positions);

    return {
        computedAt: Date.now(),
        partial: options.partial,

        ticks: snapshots.length,
        firstTimestamp: snapshots.length ? snapshots[0].timestamp : null,
        lastTimestamp: last ? last.timestamp : null,

        startingBalance: options.startingBalance,
        finalEquity,
        netPnl: finalEquity - options.startingBalance,
        returnMultiple: options.startingBalance > 0 ? finalEquity / options.startingBalance : null,

        tradesClosed: positions.length,
        wins: wins.length,
        losses: losses.length,
        winRate: positions.length ? wins.length / positions.length : null,
        avgWin,
        avgLoss,
        payoffRatio: avgWin != null && avgLoss != null && avgLoss !== 0
            ? avgWin / Math.abs(avgLoss)
            : null,
        expectancyPerTrade: mean(allPnls),
        grossProfit: sum(winPnls),
        grossLoss: sum(lossPnls),
        // Computed from the positions themselves rather than read off
        // the last snapshot, so the split is available and the figure
        // describes exactly the trades in this payload.
        totalFees: sum(positions.map(p => (p.entryFee ?? 0) + (p.exitFee ?? 0))),
        totalEntryFees: sum(positions.map(p => p.entryFee ?? 0)),
        totalExitFees: sum(positions.map(p => p.exitFee ?? 0)),
        totalFunding: sum(positions.map(p => p.fundingPaid ?? 0)),
        exitFeeSampled: positions.filter(p => typeof p.exitFee === "number").length,
        netTotalPnl: sum(positions.map(netPnlOf)),
        netExpectancyPerTrade: mean(positions.map(netPnlOf)),
        grossWinnersLostToCosts: positions.filter(p => (p.pnl ?? 0) > 0 && netPnlOf(p) <= 0).length,

        maxDrawdownUsdt: deepestByUsdt ? deepestByUsdt.depthUsdt : 0,
        maxDrawdownPercent: topDrawdowns.length ? topDrawdowns[0].depthPercent : null,
        maxDrawdownEpisode: topDrawdowns.length ? topDrawdowns[0] : null,
        equityWentNonPositive: firstNonPositiveTimestamp !== null,
        firstNonPositiveTimestamp,

        peakEquity: snapshots.length ? peakEquity : options.startingBalance,
        peakEquityTimestamp,
        lowestEquity: snapshots.length ? lowestEquity : options.startingBalance,
        lowestEquityTimestamp,

        maxOpenPositions: maxOpen,
        maxOpenPositionsTimestamp: maxOpenTimestamp,
        avgOpenPositions: mean(snapshots.map(s => s.open)),

        topDrawdowns,
        worstTicks: [...moves].sort((a, b) => a.changeUsdt - b.changeUsdt).slice(0, topN),
        bestTicks: [...moves].sort((a, b) => b.changeUsdt - a.changeUsdt).slice(0, topN),
        topWinningTrades: [...positions].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)).slice(0, topN),
        topLosingTrades: [...positions].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0)).slice(0, topN),
        exitBreakdown: buildExitBreakdown(positions),
        sideBreakdown: buildSideBreakdown(positions),
        excursions: buildExcursionStats(positions),
        marginProgression: buildMarginProgression(positions, snapshots),
        topSymbolsByProfit: [...symbolRows].sort((a, b) => b.totalPnl - a.totalPnl).slice(0, topN),
        topSymbolsByLoss: [...symbolRows].sort((a, b) => a.totalPnl - b.totalPnl).slice(0, topN),
        equityCurve: buildEquityCurve(snapshots, options.curvePoints ?? 400),
    };
}