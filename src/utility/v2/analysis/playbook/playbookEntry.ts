import type { CandleInfo, PositionEntry } from "@/core/interfacesv2";
import { PLAYBOOK } from "./playbookSetups";
import { unitU, regime, type LimitOrderDecision } from "./playbookHelpers";

// #####################################################################
// PLAYBOOK ↔ APP INTEGRATION
//
// playbookSetups.ts / playbookHelpers.ts are the AI-generated, parity-tested
// files (ai_analysis/playbook/ts), copied unchanged. This module is the glue:
// it turns their LimitOrderDecision into a pending limit order, resolves that
// order candle by candle, and once filled represents it as an ordinary
// PositionEntry so every existing consumer (stats, chart, exports, rolling
// simulation) keeps working.
//
// The mechanics mirror ai_analysis/playbook/ts/playbookOrderEngine.ts, which
// was verified trade-by-trade against the Python engine the playbook was
// measured with:
//   place:   at the decision candle's close (the window's last candle)
//   fill:    LONG low <= limit - tick (trade THROUGH), SHORT high >= limit + tick;
//            fill price = limit exactly
//   cancel:  TP level reached (LONG high >= tp) on a candle before the fill
//   expire:  not filled within expiryCandles
//   fill candle (pessimistic): stop touched -> SL loss at min(open, sl) - tick;
//            TP touch ignored. appPure skips the fill candle instead.
//   after:   hitSl = low < sl, hitTp = high > tp (strict); both = MID (booked as
//            a loss, as measured); SL exit min(open, sl) - tick (taker),
//            TP exit max(open, tp) (maker), time exit at close -/+ tick (taker)
//            once candleIndex - fillIndex >= maxHoldCandles
//   slot:    one order OR position per symbol; a new order only on the candle
//            AFTER the slot frees (runAnalysis enforces this by never placing on
//            a candle where it just resolved something).
//   money:   margin 2, leverage 20 (caller's values), entry fee MAKER on the fill
//            notional, exit fee MAKER for TP / TAKER otherwise on the exit
//            notional, loss capped at the margin (20x liquidation).
//
// Pending orders are tracked by openTime, not by candle index, so they survive
// window shifts in the rolling simulation without remapping.
// #####################################################################

export const PLAYBOOK_MAKER_FEE = 0.0002;
export const PLAYBOOK_TAKER_FEE = 0.0005;

export type PlaybookPreset = "ALL" | "CONFIRMED_28";

/**
 * The 28 setups whose per-setup held-out result was positive in BOTH halves
 * (ai_analysis/playbook/REPORT.md §5). Note the report's caveat: they were
 * selected using the held-out weeks, so they have no clean out-of-sample number.
 */
export const PLAYBOOK_CONFIRMED_28: ReadonlySet<string> = new Set([
    "LONG_BEAR_REJECTED_IMBALANCE__sessionNight_00_08PHT",
    "LONG_BULL_STRETCH_EXHAUSTION",
    "LONG_BEAR_RANGE_EDGE_BOUNCE__volumeHigh",
    "LONG_BULL_ZONE_SWEEP_RECLAIM__sessionAsia_08_16PHT",
    "LONG_BULL_VOLUME_SPIKE_REJECTION__zoneCheapSide",
    "SHORT_BEAR_STRONG_PRICE_ACTION__volatHigh",
    "LONG_BEAR_RECLAIM__volatHigh",
    "LONG_BULL_VALUE_SHIFT_PULLBACK__volatHigh",
    "SHORT_RANGE_REJECTED_IMBALANCE__unitPctGE10",
    "LONG_BEAR_OUTSIDE_ZONE_REVERT__sessionEuUs_16_24PHT",
    "LONG_BULL_SWING_RETEST__unitPctGE10",
    "SHORT_RANGE_EMA_PULLBACK__unitPctGE10",
    "LONG_BULL_RECLAIM__zoneCheapSide",
    "SHORT_BEAR_FIB_PULLBACK__volumeHigh",
    "LONG_RANGE_HL_CONFIRM_LOWZONE__sessionEuUs_16_24PHT",
    "SHORT_BULL_SWING_RETEST__volatHigh",
    "LONG_BULL_REJECTED_IMBALANCE__unitPctGE10",
    "LONG_BEAR_COMPRESSION_BREAK__sessionNight_00_08PHT",
    "LONG_RANGE_CAPITULATION_VOLUME__volatHigh",
    "LONG_BEAR_INSIDE_BAR_BREAK__sessionNight_00_08PHT",
    "SHORT_BULL_HL_CONFIRM__unitPctGE10",
    "SHORT_BULL_OUTSIDE_ZONE_REVERT__sessionAsia_08_16PHT",
    "SHORT_BULL_HL_CONFIRM_LOWZONE__volatLow",
    "LONG_RANGE_REVERSAL_PATTERN_AT_ZONE__unitPctGE10",
    "SHORT_BEAR_VOLUME_SPIKE_REJECTION__stretchedWith",
    "LONG_RANGE_OUTSIDE_ZONE_REVERT__volatHigh",
    "LONG_RANGE_INSIDE_BAR_BREAK__stretchedAgainst",
    "SHORT_BEAR_STRETCH_EXHAUSTION__unitPctGE06",
]);

/** A placed, not yet resolved limit order. Plain data: safe to carry across calls. */
export interface PendingPlaybookOrder {
    order: LimitOrderDecision;
    /** openTime of the candle whose close placed the order. */
    placedOpenTime: number;
}

/** What happened to a playbook order on a candle - stamped on candle.playbookOrder. */
export interface PlaybookOrderEvent {
    event: "PLACED" | "FILLED" | "CANCELLED_BY_TP" | "EXPIRED";
    setup: string;
    side: "LONG" | "SHORT";
    limitPrice: number;
    sl: number;
    tp: number;
    expiryCandles: number;
    maxHoldCandles: number;
    placedOpenTime: number;
}

export function orderEvent(event: PlaybookOrderEvent["event"], p: PendingPlaybookOrder): PlaybookOrderEvent {
    const o = p.order;
    return {
        event, setup: o.setup, side: o.side, limitPrice: o.limitPrice, sl: o.sl, tp: o.tp,
        expiryCandles: o.expiryCandles, maxHoldCandles: o.maxHoldCandles, placedOpenTime: p.placedOpenTime,
    };
}

/**
 * The symbol's price tick, estimated exactly as the Python pipeline did
 * (limitcore.tick_size): the smallest positive step between distinct traded
 * prices. The pipeline used the whole capture; inside a 500-candle window the
 * estimate can only be equal or slightly coarser (slightly more conservative).
 */
export function estimateTick(candles: CandleInfo[]): number {
    const set = new Set<number>();
    for (const c of candles) {
        for (const v of [c.open, c.high, c.low, c.close]) {
            if (v > 0) set.add(Math.round(v * 1e12) / 1e12);
        }
    }
    const p = Array.from(set).sort((a, b) => a - b);
    let best = Infinity;
    for (let k = 1; k < p.length; k++) {
        const d = p[k] - p[k - 1];
        if (d > p[k - 1] * 1e-9 && d < best) best = d;
    }
    return Number.isFinite(best) ? best : (p.length ? p[0] * 1e-4 : 0);
}

/**
 * The highest-priority playbook setup that fires at candles[gi], honouring the
 * preset and the caller's LONG/SHORT toggles. A setup that fires but is
 * filtered out does NOT block lower-priority setups.
 *
 * Same entry conditions as checkPlaybookEntry in playbookSetups.ts (needs a
 * full 500-candle window, U > 0, atr > 0); reads only candles[gi-499..gi].
 */
export function selectPlaybookOrder(
    candle: CandleInfo,
    candles: CandleInfo[],
    gi: number,
    tick: number,
    opts: { preset: PlaybookPreset; allowLong: boolean; allowShort: boolean }
): LimitOrderDecision | null {
    if (gi < 499) return null;
    const U = unitU(candles, gi);
    if (!(U > 0) || !(candle.atr > 0)) return null;
    const ctx = { c: candle, C: candles, gi, close: candle.close, U, reg: regime(candles, gi) };
    for (const setup of PLAYBOOK) {
        const o = setup(ctx, tick);
        if (!o) continue;
        if (opts.preset === "CONFIRMED_28" && !PLAYBOOK_CONFIRMED_28.has(o.setup)) continue;
        if (o.side === "LONG" && !opts.allowLong) continue;
        if (o.side === "SHORT" && !opts.allowShort) continue;
        return o;
    }
    return null;
}

export type PendingResult =
    | { kind: "PENDING" }
    | { kind: "CANCELLED_BY_TP" }
    | { kind: "EXPIRED" }
    | { kind: "FILLED"; position: PositionEntry };

/** Resolve a pending order on `candle` (call only for candles AFTER the placement candle). */
export function advancePendingOrder(
    p: PendingPlaybookOrder,
    candle: CandleInfo,
    gi: number,
    tick: number,
    appPure: boolean,
    intervalMs: number,
    margin: number,
    leverage: number
): PendingResult {
    const o = p.order;
    const L = o.side === "LONG";
    const fill = L ? candle.low <= o.limitPrice - tick : candle.high >= o.limitPrice + tick;
    if (fill) {
        const position = buildPlaybookPosition(p, candle, gi, margin, leverage, appPure);
        if (!appPure && (L ? candle.low < o.sl : candle.high > o.sl)) {
            const ep = L ? Math.min(candle.open, o.sl) - tick : Math.max(candle.open, o.sl) + tick;
            closePlaybookPosition(position, ep, "SL", false, gi);
        }
        return { kind: "FILLED", position };
    }
    if (L ? candle.high >= o.tp : candle.low <= o.tp) return { kind: "CANCELLED_BY_TP" };
    const age = Math.round((candle.openTime - p.placedOpenTime) / intervalMs);
    if (age >= o.expiryCandles) return { kind: "EXPIRED" };
    return { kind: "PENDING" };
}

function buildPlaybookPosition(p: PendingPlaybookOrder, fillCandle: CandleInfo, gi: number,
                               margin: number, leverage: number, appPure: boolean): PositionEntry {
    const o = p.order;
    const notional = margin * leverage;
    const entry = o.limitPrice;
    const risk = Math.abs(entry - o.sl);
    const reward = Math.abs(o.tp - entry);
    return {
        side: o.side, entryPrice: entry, margin, leverage, sl: o.sl, tp: o.tp,
        openTime: fillCandle.openTime,
        entryReason: {
            trigger: "PLAYBOOK",
            reversingDirection: o.side === "LONG" ? "DOWN" : "UP",
            segmentLow: Math.min(entry, o.sl, o.tp),
            segmentHigh: Math.max(entry, o.sl, o.tp),
            segmentMid: entry,
            broaderMoveAtr: null, exhaustionWickRatio: null, trendZScoreAvg: null,
            plannedRewardRisk: reward / risk,
            plannedRiskPercent: risk / entry,
            summary: `${o.setup}: limit ${entry}, SL ${o.sl}, TP ${o.tp}, expiry ${o.expiryCandles}, hold ${o.maxHoldCandles}`,
        },
        entryFee: notional * PLAYBOOK_MAKER_FEE,
        mae: 0, mfe: 0, maePrice: 0, mfePrice: 0,
        atrAtEntry: fillCandle.atr,
        exitFee: null, fundingPaid: 0, status: "OPEN", pnl: 0, walkingPnl: [0],
        openGi: gi, closeGi: null, durationMinutes: null,
        maxDurationCandles: o.maxHoldCandles,
        playbook: {
            setup: o.setup, limitPrice: o.limitPrice, expiryCandles: o.expiryCandles,
            maxHoldCandles: o.maxHoldCandles, placedOpenTime: p.placedOpenTime,
            fillOpenTime: fillCandle.openTime, appPure,
        },
    };
}

/** Book an exit: gross pnl (capped at the margin), maker/taker exit fee, status by net. */
function closePlaybookPosition(pos: PositionEntry, exitPrice: number, reason: "TP" | "SL" | "MID" | "EXPIRED",
                               makerExit: boolean, gi: number): void {
    const notional = pos.margin * pos.leverage;
    const s = pos.side === "LONG" ? 1 : -1;
    const pnl = Math.max(notional * (exitPrice - pos.entryPrice) / pos.entryPrice * s, -pos.margin);
    const exitFee = notional * exitPrice / pos.entryPrice * (makerExit ? PLAYBOOK_MAKER_FEE : PLAYBOOK_TAKER_FEE);
    const net = pnl - pos.entryFee - exitFee;
    pos.pnl = pnl;
    pos.exitFee = exitFee;
    pos.exitPrice = exitPrice;
    pos.closeGi = gi;
    pos.closeReason = reason;
    // MID is booked as a loss at the stop, exactly as the playbook was measured
    // (the app's legacy MID leaves pnl null instead).
    pos.status = net > 0 ? "WON" : "LOSS";
    const k = gi - pos.openGi;
    if (k >= 0) {
        while (pos.walkingPnl.length < k) pos.walkingPnl.push(null);
        pos.walkingPnl[k] = pnl;
    }
}

/**
 * Advance a filled playbook position by one candle (call only for candles after
 * the fill candle). `callerCap` is the caller's own maxPositionDurationCandles,
 * applied only if it is shorter than the setup's hold.
 */
export function advancePlaybookPosition(pos: PositionEntry, candle: CandleInfo, gi: number, tick: number,
                                        callerCap?: number): void {
    if (pos.status !== "OPEN") return;
    const L = pos.side === "LONG";
    const atr = candle.atr > 0 ? candle.atr : 1;
    const adverse = L ? pos.entryPrice - candle.low : candle.high - pos.entryPrice;
    const favorable = L ? candle.high - pos.entryPrice : pos.entryPrice - candle.low;
    pos.mae = Math.max(pos.mae, adverse / atr);
    pos.mfe = Math.max(pos.mfe, favorable / atr);
    pos.maePrice = Math.max(pos.maePrice, adverse);
    pos.mfePrice = Math.max(pos.mfePrice, favorable);

    const hitSl = L ? candle.low < pos.sl : candle.high > pos.sl;
    const hitTp = L ? candle.high > pos.tp : candle.low < pos.tp;
    if (hitSl) {
        closePlaybookPosition(pos, L ? Math.min(candle.open, pos.sl) - tick : Math.max(candle.open, pos.sl) + tick,
            hitTp ? "MID" : "SL", false, gi);
        return;
    }
    if (hitTp) {
        closePlaybookPosition(pos, L ? Math.max(candle.open, pos.tp) : Math.min(candle.open, pos.tp), "TP", true, gi);
        return;
    }
    const hold = pos.playbook?.maxHoldCandles ?? pos.maxDurationCandles ?? Infinity;
    const cap = callerCap != null ? Math.min(hold, callerCap) : hold;
    if (gi - pos.openGi >= cap) {
        closePlaybookPosition(pos, candle.close - (L ? tick : -tick), "EXPIRED", false, gi);
        return;
    }
    // still open: mark to market (no exit fee yet)
    const notional = pos.margin * pos.leverage;
    pos.pnl = notional * (candle.close - pos.entryPrice) / pos.entryPrice * (L ? 1 : -1);
    const k = gi - pos.openGi;
    if (k >= 0) {
        while (pos.walkingPnl.length < k) pos.walkingPnl.push(null);
        pos.walkingPnl[k] = pos.pnl;
    }
}
