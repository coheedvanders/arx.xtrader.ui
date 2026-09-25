// Intended location: src/utility/v2/analysis/fundingCost.ts
//
// Pure funding-cost accounting for perpetual futures. No fetching, no
// Vue, no state - it takes a symbol's already-fetched funding history and
// answers "what did this position pay between these two moments".
//
// WHY THIS EXISTS AS REAL DATA rather than a flat assumption: funding is
// charged on NOTIONAL, not margin, so at 20x it is 20x larger than a
// margin-based guess would suggest. Its sign and size also vary per
// symbol and per settlement - a crowded alt long in a bull run can pay
// many times Binance's 0.01% baseline, while a symbol in backwardation
// pays the short side instead. A single flat rate would systematically
// misprice exactly the trades that matter most (long, in an uptrend,
// held to the duration cap).
//
// CAUSALITY: a funding settlement at time T is only charged to a
// position that was open AT T. Nothing here reads a rate stamped later
// than the moment being evaluated - see accrueFundingForInterval.

export interface FundingRateEntry {
    /** Settlement time in ms. Binance settles at fixed wall-clock times
     *  (00:00/08:00/16:00 UTC by default), NOT on candle boundaries. */
    fundingTime: number;
    /** Signed rate for this settlement, as a fraction (0.0001 = 0.01%).
     *  POSITIVE means longs pay shorts; negative means the reverse. */
    fundingRate: number;
}

export interface FundingCharge {
    fundingTime: number;
    fundingRate: number;
    notional: number;
    /** Signed USDT. POSITIVE = the position PAID. Negative = it received. */
    amount: number;
}

/**
 * Funding settlements strictly after `afterTime` and at or before
 * `untilTime`.
 *
 * Half-open on purpose: the rolling loop calls this once per tick with
 * (previousTickTime, currentTickTime], so consecutive ticks can never
 * both claim the same settlement, and none is skipped between them. A
 * closed interval on both ends would double-charge every settlement that
 * landed exactly on a tick boundary - and since Binance settles on the
 * hour and 15m candles also land on the hour, that is EVERY settlement,
 * not a rare edge case.
 */
export function fundingEntriesInWindow(
    history: FundingRateEntry[],
    afterTime: number,
    untilTime: number
): FundingRateEntry[] {
    if (!history.length || untilTime <= afterTime) return [];
    const out: FundingRateEntry[] = [];
    for (const entry of history) {
        if (entry.fundingTime > afterTime && entry.fundingTime <= untilTime) out.push(entry);
    }
    return out;
}

/**
 * What one open position owes for the settlements in
 * (afterTime, untilTime].
 *
 * notional is recomputed per settlement from the mark price at that
 * moment (passed in as `priceAtSettlement`), because funding is charged
 * on the position's CURRENT notional, not its entry notional - a long
 * that has doubled pays roughly twice as much per settlement as it did
 * at entry. Using entry notional throughout would understate the cost on
 * winners and overstate it on losers, which is precisely the wrong
 * direction for judging whether the strategy's winners actually clear
 * their carrying cost.
 *
 * Sign convention: the returned `amount` is POSITIVE when the position
 * pays. A LONG pays when the rate is positive; a SHORT pays when it is
 * negative. So amount = notional * rate * (side === "LONG" ? 1 : -1).
 */
export function accrueFundingForInterval(params: {
    history: FundingRateEntry[];
    side: "LONG" | "SHORT";
    quantity: number;
    priceAtSettlement: number;
    afterTime: number;
    untilTime: number;
}): { charges: FundingCharge[]; totalPaid: number } {
    const { history, side, quantity, priceAtSettlement, afterTime, untilTime } = params;
    const entries = fundingEntriesInWindow(history, afterTime, untilTime);

    const charges: FundingCharge[] = [];
    let totalPaid = 0;

    for (const entry of entries) {
        const notional = Math.abs(quantity * priceAtSettlement);
        const amount = notional * entry.fundingRate * (side === "LONG" ? 1 : -1);
        charges.push({
            fundingTime: entry.fundingTime,
            fundingRate: entry.fundingRate,
            notional,
            amount,
        });
        totalPaid += amount;
    }

    return { charges, totalPaid };
}

/**
 * Position size in base units, from the margin/leverage/entry price the
 * rest of the pipeline already works in. quantity = notional / entryPrice
 * and stays FIXED for the life of the position - it's the notional that
 * moves with price, not the size.
 */
export function positionQuantity(margin: number, leverage: number, entryPrice: number): number {
    if (!(entryPrice > 0)) return 0;
    return (margin * leverage) / entryPrice;
}

export interface FundingCoverage {
    symbol: string;
    entries: number;
    firstFundingTime: number | null;
    lastFundingTime: number | null;
    /** Median gap between settlements, in hours. Binance's default is 8,
     *  but some symbols are on 4h - derived from the data rather than
     *  assumed, since assuming 8h for a 4h symbol halves its real cost. */
    intervalHours: number | null;
    avgRate: number | null;
    /** Share of settlements where longs paid (rate > 0). In a sustained
     *  uptrend this runs well above 0.5, which is exactly why a LONG-only
     *  strategy cannot treat funding as noise that averages out. */
    longPaysShare: number | null;
    maxRate: number | null;
    minRate: number | null;
}

/** Descriptive coverage for one symbol's fetched history, so a run can
 *  report what it actually priced rather than implying full coverage. */
export function summarizeFundingCoverage(symbol: string, history: FundingRateEntry[]): FundingCoverage {
    if (!history.length) {
        return {
            symbol, entries: 0, firstFundingTime: null, lastFundingTime: null,
            intervalHours: null, avgRate: null, longPaysShare: null, maxRate: null, minRate: null,
        };
    }

    const sorted = [...history].sort((a, b) => a.fundingTime - b.fundingTime);
    const rates = sorted.map(e => e.fundingRate);

    let intervalHours: number | null = null;
    if (sorted.length > 1) {
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            gaps.push(sorted[i].fundingTime - sorted[i - 1].fundingTime);
        }
        // Median, not mean: a single gap across a listing pause or a
        // missing batch would drag a mean badly, while the median still
        // reports the schedule the symbol actually runs on.
        gaps.sort((a, b) => a - b);
        const mid = Math.floor(gaps.length / 2);
        const medianMs = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
        intervalHours = medianMs / 3_600_000;
    }

    return {
        symbol,
        entries: sorted.length,
        firstFundingTime: sorted[0].fundingTime,
        lastFundingTime: sorted[sorted.length - 1].fundingTime,
        intervalHours,
        avgRate: rates.reduce((a, b) => a + b, 0) / rates.length,
        longPaysShare: rates.filter(r => r > 0).length / rates.length,
        maxRate: Math.max(...rates),
        minRate: Math.min(...rates),
    };
}