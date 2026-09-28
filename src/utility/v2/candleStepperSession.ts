import type { CandleInfo, SymbolInfo, PositionEntry, MARKET_INTERVAL, SIGNAL_DIRECTION } from "@/core/interfacesv2";
import { KlineUtility } from "../klineUtility";
import { CandleAnalyzerV2 } from "./candleAnalyzerV2";
import { SimulationUtilityV2, remapCarry, remapCandleIndices, type AnalysisCarry } from "./simulationUtilityV2";

// #####################################################################
// MANUAL CANDLE STEPPER — one symbol, one candle at a time, by hand.
//
// WHAT THIS IS FOR. The rolling lab walks ~336 symbols forward
// automatically and reports aggregates. This does the same walk for ONE
// symbol, one candle per call, so the derived state at a single candle can
// be read before deciding whether that candle is an entry. It produces no
// statistics and no verdicts; it exposes exactly what `checkPositionEntry`
// is handed, at the moment it would be handed it.
//
// THREE PROPERTIES WORTH KNOWING BEFORE TRUSTING ANYTHING IT SHOWS
//
// 1. LOOK-AHEAD IS STRUCTURALLY IMPOSSIBLE HERE, not merely avoided. The
//    window is built by appending one candle at a time, so the array never
//    contains a candle after the current one. `candles[candles.length - 1]`
//    IS the present. That is a stronger guarantee than the lab's, where the
//    window is a slice of already-fetched history and causality rests on
//    `newEntryOnlyAtIndex`.
//
// 2. THE RESUMED WALK AND A FULL RE-DERIVE DISAGREE, and the resumed one is
//    the more faithful of the two. Four derivations thread state candle to
//    candle: ema200 (incremental), candleStructure (consecutive streaks),
//    volumeState (running trend-volume stats) and the trend tracker. A full
//    re-derive of a 500-candle window restarts all four from the window's
//    own first candle, so a trend segment that began 600 candles ago is
//    invisible to it and it reports a structure the market never had. The
//    resumed walk carries that state across the shift. The rolling lab
//    currently re-derives, so the two are NOT candle-for-candle identical -
//    `divergenceAgainstFullRederive` below measures the gap rather than
//    asking anyone to assume it is small.
//
// 3. WARM-UP OPENS NOTHING. `startSession` analyses its first window with
//    `allowNewEntry: false`, exactly as the lab's `initializeSymbol` does.
//    The first candle an entry may fire on is the first `stepSession`.
// #####################################################################

/** 15m in milliseconds. The one interval this stepper walks; stated as a
 *  constant so the continuity guard and the back-fill share one value. */
export const STEPPER_INTERVAL_MS = 15 * 60 * 1000;
export const STEPPER_INTERVAL: MARKET_INTERVAL = "15m";

/** Window length the walk holds. 500 to match the lab, and to match the
 *  memory a live bot would have. */
export const STEPPER_WINDOW_SIZE = 500;

/**
 * How many candles one staging fetch pulls ahead.
 *
 * Purely a latency setting: a step consumes one candle, and refilling on
 * every step would make each press of "next" a REST round trip. 200 means
 * one round trip per 200 steps. It cannot affect results - the candles
 * fetched are the same candles in the same order either way.
 */
export const STEPPER_STAGING_FETCH = 200;

export interface StepperSession {
    symbol: string;
    windowSize: number;
    /** SymbolInfo whose candle_15m IS the live window - the same array the
     *  analysis writes its derived fields into. */
    symbolInfo: SymbolInfo;
    /** Derivation state for the next step. Null only before the first
     *  analysis has run. */
    carry: AnalysisCarry | null;
    /** Candles fetched ahead of the walk, consumed one per step. */
    staging: CandleInfo[];
    /** openTime of the newest candle fetched (window or staging), which is
     *  where the next fetch continues from. */
    lastFetchedOpenTime: number | null;
    /** Set once the exchange returns nothing further, or a gap is found. */
    exhausted: boolean;
    /** Why the walk stopped, when it has. Reported, never patched over. */
    exhaustedReason: string | null;
    /** Successful steps taken since the session started. */
    stepped: number;
    /** Candles dropped off the front so far. window index + this = the
     *  candle's index counted from the session's very first candle, which is
     *  what makes a gi read off the screen meaningful across shifts. */
    shiftedOff: number;
    /** The position currently open, carried across shifts. */
    openPosition: PositionEntry | null;
    /** Positions that have resolved, newest last. Kept because a manual walk
     *  is exactly where a single trade is worth reading in full. */
    closedPositions: PositionEntry[];
    /** Duration cap handed to the engine, or undefined for none. */
    maxPositionDurationCandles?: number;
    /** Margin per position handed to the engine. */
    positionMargin: number;
}

export interface StepResult {
    session: StepperSession;
    /** The candle just appended and derived, or null when the walk could not
     *  advance (see `session.exhaustedReason`). */
    candle: CandleInfo | null;
    /** Its index in the window - always `window.length - 1` when non-null. */
    windowIndex: number;
    /** A position that opened on THIS step, if any. */
    opened: PositionEntry | null;
    /** A position that resolved on THIS step, if any. */
    closed: PositionEntry | null;
}

function buildStepperSymbolInfo(symbol: string, candles: CandleInfo[]): SymbolInfo {
    return {
        name: symbol,
        candle_15m: candles,
        candle_1h: [], candle_4h: [], candle_1d: [],
        // OI/LS left empty for the same reason the lab leaves them empty:
        // Binance retains ~30 days of both, so a window starting months back
        // would be mostly holes, and nothing in the entry path reads them.
        // An empty array is honest about that; a partially filled one is not.
        oi_15m: [], oi_1h: [], oi_4h: [], oi_1d: [],
        ls_15m: [], ls_1h: [], ls_4h: [], ls_1d: [],
        trendstats_15m: null,
    } as SymbolInfo;
}

export interface StartSessionOptions {
    windowSize?: number;
    positionMargin?: number;
    maxPositionDurationCandles?: number;
}

/**
 * Fetches the first window and derives it in full.
 *
 * `startMs` is the openTime of the window's FIRST candle, matching the
 * rolling lab's own start-date semantics: the window is warm-up history, so
 * the first candle an entry can fire on sits `windowSize` candles later.
 * That is deliberate - a walk whose first tradeable candle has two candles
 * of history behind it has no ATR, no EMA and no structure, and every early
 * decision it makes is an artifact of the window's edge.
 */
export async function startSession(
    symbol: string,
    startMs: number,
    options: StartSessionOptions = {}
): Promise<StepperSession> {
    const windowSize = Math.max(2, Math.floor(options.windowSize ?? STEPPER_WINDOW_SIZE));
    const positionMargin = options.positionMargin ?? 2;

    const raw = await KlineUtility.getRecentKlinesByRange(symbol, STEPPER_INTERVAL, windowSize, startMs);
    const candles = SimulationUtilityV2.mapToInfo(raw);

    const session: StepperSession = {
        symbol,
        windowSize,
        symbolInfo: buildStepperSymbolInfo(symbol, candles),
        carry: null,
        staging: [],
        lastFetchedOpenTime: candles.length ? candles[candles.length - 1].openTime : null,
        exhausted: candles.length < 2,
        exhaustedReason: candles.length < 2
            ? `only ${candles.length} candle(s) returned for ${symbol} from ${new Date(startMs).toISOString()}`
            : null,
        stepped: 0,
        shiftedOff: 0,
        openPosition: null,
        closedPositions: [],
        maxPositionDurationCandles: options.maxPositionDurationCandles,
        positionMargin,
    };
    if (session.exhausted) return session;

    // allowNewEntry HARD false: this window is history, not decisions. The
    // index is still passed so this call cannot behave differently from the
    // step path if that flag is ever changed.
    const { carry } = await SimulationUtilityV2.runMarketAnalysis(
        session.symbolInfo, [], null, session.maxPositionDurationCandles, positionMargin,
        false, true, true,
        candles.length - 1
    );
    session.carry = carry;
    return session;
}

/**
 * Appends one candle, shifts the window if it is full, and derives ONLY the
 * appended candle.
 *
 * THE INDEX ARITHMETIC, because it is the part that breaks silently. Say the
 * window holds 500 and the carry's nextIndex is 500 (one past the last
 * derived candle, which sits at 499). Pushing puts the new candle at 500 and
 * shifting drops index 0, so the new candle lands at 499 and the previously
 * last-derived candle at 498. `remapCarry(carry, 1)` moves nextIndex to 499
 * and the resume check then requires `candles[498].openTime ===
 * carry.lastOpenTime`, which holds. The walk runs for exactly i = 499.
 *
 * Before the window is full there is no shift, so the remap is by 0 and the
 * carry passes through unchanged.
 */
export async function stepSession(session: StepperSession): Promise<StepResult> {
    const window = session.symbolInfo.candle_15m;
    const noStep = (reason: string | null): StepResult => {
        if (reason) { session.exhausted = true; session.exhaustedReason = reason; }
        return { session, candle: null, windowIndex: -1, opened: null, closed: null };
    };

    if (session.exhausted) return noStep(null);
    if (!session.carry) return noStep("stepSession called before startSession completed a first analysis");

    if (!session.staging.length) {
        await refillStaging(session);
        if (!session.staging.length) {
            return noStep(session.exhaustedReason ?? `no further candles available for ${session.symbol}`);
        }
    }

    const nextCandle = session.staging.shift();
    if (!nextCandle) return noStep(`staging buffer emptied unexpectedly for ${session.symbol}`);

    window.push(nextCandle);
    const shiftedBy = window.length > session.windowSize ? 1 : 0;
    if (shiftedBy) {
        window.shift();
        session.shiftedOff += 1;
        // EVERY index stored on a candle now means one candle too many, and a
        // resumed walk will not rewrite them because it only derives the new
        // candle. This covers trendState, the threaded volume running stats and
        // every position still referenced from the window - including the open
        // one, which is why this function does NOT shift `session.openPosition`
        // itself: the open position is referenced by the candle it was last seen
        // on, so the sweep reaches it exactly once. Shifting it here as well
        // would shift it twice.
        remapCandleIndices(window, shiftedBy);
    }

    const resume = remapCarry(session.carry, shiftedBy);
    const positionBefore = session.openPosition;
    const statusBefore = positionBefore?.status ?? null;

    const { openPosition, carry } = await SimulationUtilityV2.runMarketAnalysis(
        session.symbolInfo, [], session.openPosition,
        session.maxPositionDurationCandles, session.positionMargin,
        true, true, true,
        // A new position may only be created at the candle the walk has
        // reached. Here that is the only candle being walked at all, so this
        // is belt and braces - and it stays correct if the walk is ever asked
        // to cover more than one candle in a step.
        window.length - 1,
        { resume }
    );

    session.carry = carry;
    session.stepped += 1;

    const closed = positionBefore && statusBefore === "OPEN" && positionBefore.status !== "OPEN"
        ? positionBefore
        : null;
    if (closed) session.closedPositions.push(closed);
    const opened = openPosition != null && openPosition !== positionBefore ? openPosition : null;
    session.openPosition = openPosition;

    return { session, candle: window[window.length - 1], windowIndex: window.length - 1, opened, closed };
}

/**
 * Pulls the next batch of candles into staging.
 *
 * CONTINUITY IS CHECKED, NOT ASSUMED - same rule as the lab. A batch must
 * begin exactly one interval after the newest candle already held. Earlier
 * candles are overlap and are dropped; a genuine gap retires the session
 * rather than being stitched, because a window with a hole in it produces
 * ATR, trend and structure values for a price series that never existed.
 */
async function refillStaging(session: StepperSession): Promise<void> {
    const from = session.lastFetchedOpenTime;
    if (from == null) { session.exhausted = true; session.exhaustedReason = "no fetch cursor"; return; }

    const raw = await KlineUtility.getRecentKlinesByRange(
        session.symbol, STEPPER_INTERVAL, STEPPER_STAGING_FETCH, from + STEPPER_INTERVAL_MS
    );
    if (!raw.length) {
        session.exhausted = true;
        session.exhaustedReason = `${session.symbol}: exchange returned no candles after ${new Date(from).toISOString()}`;
        return;
    }
    const fetched = SimulationUtilityV2.mapToInfo(raw);
    const fresh = fetched.filter(c => c.openTime > from);
    if (!fresh.length) {
        session.exhausted = true;
        session.exhaustedReason = `${session.symbol}: nothing newer than ${new Date(from).toISOString()}`;
        return;
    }
    if (fresh[0].openTime !== from + STEPPER_INTERVAL_MS) {
        session.exhausted = true;
        session.exhaustedReason =
            `${session.symbol}: candle gap - expected ${new Date(from + STEPPER_INTERVAL_MS).toISOString()}, `
            + `got ${new Date(fresh[0].openTime).toISOString()}`;
        return;
    }
    session.staging.push(...fresh);
    session.lastFetchedOpenTime = fresh[fresh.length - 1].openTime;
}

// =====================================================================
// READOUT — what the entry is actually handed
// =====================================================================

/**
 * The two arguments `checkPositionEntry` receives beyond the candle itself,
 * plus the rest of the trend snapshot they come from.
 *
 * `reversingSegmentStartGi` is a WINDOW index, so it only means anything
 * alongside the window it was read from. Two readers exist for this shape and
 * they are not interchangeable: `entryInputsFromCarry` for the live walk, and
 * `readEntryInputs` for a candle out of an export. Each says why.
 */
export interface EntryInputs {
    reversingDirection: "UP" | "DOWN" | null;
    reversingSegmentStartGi: number | null;
    snapshotEndGi: number | null;
    snapshotConfirmedOpenTime: number | null;
    /** Candles between the segment's own pivot and the candle that confirmed
     *  it. Always >= 0 - this is exactly how much hindsight the label needed. */
    confirmationLagCandles: number | null;
}

/**
 * The entry inputs for the candle the walk has just reached, taken from the
 * CARRY rather than from the candle.
 *
 * USE THIS FOR THE LIVE READOUT, not `readEntryInputs`. The snapshot recorded in
 * a candle's `extras` is a window index frozen as a STRING at the moment that
 * candle was derived, and `remapCandleIndices` cannot fix a string - so on a
 * candle that has since been shifted, the index in extras is stale by exactly
 * the number of shifts. The carry's copy is remapped on every shift, which makes
 * it the only version that still points at the right candle.
 */
export function entryInputsFromCarry(session: StepperSession): EntryInputs {
    const snapshot = session.carry?.lastKnownTrendSnapshot ?? null;
    if (!snapshot) {
        return { reversingDirection: null, reversingSegmentStartGi: null,
                 snapshotEndGi: null, snapshotConfirmedOpenTime: null, confirmationLagCandles: null };
    }
    const direction = snapshot.direction === "UP" || snapshot.direction === "DOWN" ? snapshot.direction : null;
    return {
        reversingDirection: direction,
        reversingSegmentStartGi: snapshot.startGi,
        snapshotEndGi: snapshot.endGi,
        snapshotConfirmedOpenTime: snapshot.confirmedOpenTime,
        confirmationLagCandles: Math.max(0, snapshot.endGi - snapshot.startGi),
    };
}

/**
 * True when a segment start of `startGi` is the window's own edge rather than
 * the segment's pivot.
 *
 * Any geometry measured from a truncated start - segment high, low, mid, the
 * position of the entry within the segment - describes the part of the segment
 * that happens to still be in the window, not the segment. Both this walk and a
 * full re-derive truncate the same way; neither can do better with 500 candles.
 * Worth showing rather than hiding, because a truncated start reads exactly like
 * a real one.
 */
export function segmentStartTruncated(session: StepperSession, startGi: number | null): boolean {
    return startGi === 0 && session.shiftedOff > 0;
}

/** One POC AVWAP anchor as the engine currently holds it, with its value. */
export interface AnchorReadout {
    /** Window index of the anchor candle. */
    anchorGi: number;
    /** Index counted from the session's first candle, stable across shifts. */
    absoluteGi: number;
    direction: SIGNAL_DIRECTION;
    anchorOpenTime: number | null;
    /** The AVWAP from the anchor through the current candle. */
    value: number;
    /** Current close minus the AVWAP, in ATRs. Null without a usable ATR. */
    distanceAtr: number | null;
    /** True when the anchor candle itself has aged out and the AVWAP is being
     *  accumulated from the window's edge instead of from the event. */
    truncated: boolean;
}

/**
 * The anchors the walk is carrying, valued at the current candle.
 *
 * Uses `CandleAnalyzerV2.getAnchorVwap` - the same function the engine and the
 * chart both call - rather than recomputing the cumulative volume-weighted
 * formula a third time, so this cannot drift from what the engine sees.
 */
export function readAnchors(session: StepperSession): AnchorReadout[] {
    const window = session.symbolInfo.candle_15m;
    const anchors = session.carry?.pocAvwapAnchors ?? [];
    if (!window.length || !anchors.length) return [];
    const current = window[window.length - 1];
    const upto = window.length - 1;
    return anchors.map(a => {
        const zone = CandleAnalyzerV2.getAnchorVwap(window.slice(a.anchorGi, upto + 1));
        const atr = current.atr;
        return {
            anchorGi: a.anchorGi,
            absoluteGi: a.anchorGi + session.shiftedOff,
            direction: a.direction,
            anchorOpenTime: window[a.anchorGi]?.openTime ?? null,
            value: zone.mid,
            distanceAtr: atr > 0 ? (current.close - zone.mid) / atr : null,
            truncated: a.anchorGi === 0 && session.shiftedOff > 0,
        };
    });
}

/**
 * The snapshot as recorded on a candle itself.
 *
 * FOR AN EXPORT OR AN ARCHIVE, where no shifting has happened since the candle
 * was written. For the live walk use `entryInputsFromCarry` - see its note on
 * why the index in `extras` goes stale.
 *
 * Read from `extras` rather than from `candle.trendState`, because that field is
 * retroactively OVERWRITTEN on earlier candles every time a segment's extreme
 * extends - so by the end of a walk it reflects the final, hindsight-complete
 * segment, not what was knowable at the candle. The snapshot in extras is never
 * rewritten, which is the whole reason it exists.
 */
export function readEntryInputs(candle: CandleInfo): EntryInputs {
    const empty: EntryInputs = {
        reversingDirection: null, reversingSegmentStartGi: null,
        snapshotEndGi: null, snapshotConfirmedOpenTime: null, confirmationLagCandles: null,
    };
    const extras = candle.extras ?? [];
    const at = extras.indexOf("TREND_SNAPSHOT");
    if (at < 0 || at + 4 >= extras.length) return empty;

    const direction = extras[at + 1];
    const startGi = Number(extras[at + 2]);
    const endGi = Number(extras[at + 3]);
    const confirmedOpenTime = Number(extras[at + 4]);
    if (direction !== "UP" && direction !== "DOWN") return empty;
    if (!Number.isFinite(startGi) || !Number.isFinite(endGi)) return empty;

    return {
        reversingDirection: direction,
        reversingSegmentStartGi: startGi,
        snapshotEndGi: endGi,
        snapshotConfirmedOpenTime: Number.isFinite(confirmedOpenTime) ? confirmedOpenTime : null,
        confirmationLagCandles: Number.isFinite(endGi) ? Math.max(0, endGi - startGi) : null,
    };
}

/**
 * Round-trip taker fee as a fraction of R, for a stop `stopAtr` ATRs wide.
 *
 *   fee / R = 2 * taker / (stopDistance / entryPrice)
 *
 * Arithmetic, not measurement, so it holds whatever the entry turns out to
 * be. At 0.05% taker a stop 1% from price pays 10% of R in fees; a stop
 * 0.1% from price pays 100% of R and cannot profit at any win rate. Shown
 * per candle because ATR is period 8 here - two hours on 15m - and a
 * "3 ATR stop" is far closer to the noise than the words suggest.
 *
 * Returns null when the candle has no usable ATR or price.
 */
export function feePerR(candle: CandleInfo, stopAtr: number, takerFee = 0.0005): number | null {
    const price = candle.close;
    const atr = candle.atr;
    if (!(price > 0) || !(atr > 0) || !(stopAtr > 0)) return null;
    const riskFraction = (stopAtr * atr) / price;
    if (!(riskFraction > 0)) return null;
    return (2 * takerFee) / riskFraction;
}

/** Breakeven reward:risk at a win rate `p`: (1 - p) / p. A line any entry
 *  has to clear, not a target to tune. Null outside 0 < p < 1. */
export function breakevenRewardRisk(p: number): number | null {
    if (!(p > 0) || !(p < 1)) return null;
    return (1 - p) / p;
}

// =====================================================================
// DIVERGENCE — resumed walk vs. full re-derive
// =====================================================================

export interface FieldDivergence {
    field: string;
    resumed: number | string | null;
    rederived: number | string | null;
    /** |a - b| for numbers, null for anything compared as a string. */
    absoluteDifference: number | null;
}

/**
 * Re-derives the SAME window from scratch and reports where the current
 * candle's values differ from the resumed walk's.
 *
 * WHY THIS IS HERE RATHER THAN AN ASSURANCE IN A COMMENT. The resumed walk
 * and the rolling lab's full re-derive are not the same computation, and the
 * lab is what any entry designed here will eventually be measured by. The
 * size of that gap is a measurable quantity, so it is measured. An empty
 * result means the two agree at this candle; a populated one says exactly
 * which fields to distrust when carrying a threshold from one to the other.
 *
 * COSTS A FULL 500-CANDLE PASS and allocates a second copy of the window, so
 * it is a diagnostic to run at a candle of interest, not on every step. It
 * mutates nothing: the copy carries raw OHLCV only and the live window is
 * never passed in.
 */
export async function divergenceAgainstFullRederive(session: StepperSession): Promise<FieldDivergence[]> {
    const window = session.symbolInfo.candle_15m;
    if (window.length < 2) return [];

    // RAW OHLCV ONLY. Copying the derived fields too would hand the
    // re-derive the answers it is supposed to produce independently, and the
    // comparison would be vacuous. Built the same way mapToInfo builds a
    // fresh CandleInfo - the remaining fields are assigned by the walk.
    const copy: CandleInfo[] = window.map(c => ({
        openTime: c.openTime, open: c.open, high: c.high, low: c.low,
        close: c.close, volume: c.volume, closeTime: c.closeTime,
    } as CandleInfo));
    const copyInfo = buildStepperSymbolInfo(session.symbol, copy);

    // No entries, no carry: this is the lab's own warm-up call, which is
    // exactly the computation being compared against.
    await SimulationUtilityV2.runMarketAnalysis(
        copyInfo, [], null, session.maxPositionDurationCandles, session.positionMargin,
        false, true, true, copy.length - 1
    );

    const a = window[window.length - 1];
    const b = copy[copy.length - 1];
    const out: FieldDivergence[] = [];

    const num = (field: string, x: number | null | undefined, y: number | null | undefined): void => {
        const av = x ?? null, bv = y ?? null;
        if (av === bv) return;
        if (av != null && bv != null && Math.abs(av - bv) <= 1e-12) return;
        out.push({
            field, resumed: av, rederived: bv,
            absoluteDifference: av != null && bv != null ? Math.abs(av - bv) : null,
        });
    };
    const str = (field: string, x: string | null, y: string | null): void => {
        if (x === y) return;
        out.push({ field, resumed: x, rederived: y, absoluteDifference: null });
    };

    num("atr", a.atr, b.atr);
    num("ema200", a.ema200, b.ema200);
    num("candleStructure.consecutiveBullish", a.candleStructure?.consecutiveBullish, b.candleStructure?.consecutiveBullish);
    num("candleStructure.consecutiveBearish", a.candleStructure?.consecutiveBearish, b.candleStructure?.consecutiveBearish);
    num("volumeState.relativeVolume", a.volumeState?.relativeVolume, b.volumeState?.relativeVolume);
    str("trendState.direction", a.trendState?.direction ?? null, b.trendState?.direction ?? null);
    num("trendState.startGi", a.trendState?.startGi, b.trendState?.startGi);
    num("trendState.endGi", a.trendState?.endGi, b.trendState?.endGi);
    str("conditions_met", (a.conditions_met ?? []).join(","), (b.conditions_met ?? []).join(","));

    const ia = readEntryInputs(a), ib = readEntryInputs(b);
    str("entryInputs.reversingDirection", ia.reversingDirection, ib.reversingDirection);
    num("entryInputs.reversingSegmentStartGi", ia.reversingSegmentStartGi, ib.reversingSegmentStartGi);

    return out;
}