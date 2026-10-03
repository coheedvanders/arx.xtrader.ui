import type { CandleInfo, MARKET_INTERVAL, SymbolInfo, SIGNAL_DIRECTION, MarketStructureLabel } from "@/core/interfacesv2";
import type { Candle, CandleEntry, PriceZone } from "@/core/interfaces";
import { PriceZoneUtility } from "../priceZoneUtility";
import { getOutsidePriceZoneMetrics } from "./analysis/priceZoneMetrics";
import { SimulationUtility } from "../simulationUtility";
import { CandleAnalyzerV2 } from "./candleAnalyzerV2";
import { getCandleStructure } from "./analysis/candleStructure";
import { getAnchorDecision } from "./analysis/anchorDecisionEngine";
import { getOpenInterestState } from "./analysis/openInterestState";
import { getLongShortRatioState } from "./analysis/longShortRatioState";
import { getVolumeState } from "./analysis/volumeState";
import { KlineUtility } from "../klineUtility";
import { getMarketAlignment } from "./analysis/marketAlignment";
import { getConfluenceScore } from "./analysis/confluenceScore";
import { getPriceAction, getBreakoutEvents } from "./analysis/priceAction";
import { getLiquidationHeatmapStamp } from "./analysis/liquidationHeatmapStamp";
import { getLiquidityHeatmapAnchors } from "./analysis/liquidityHeatmapAnchor";
import { getLiquiditySweepInfo } from "./analysis/liquidationSweepInfo";
import { getImbalanceState } from "./analysis/imbalanceState";
import { checkSwingPoint, classifyMarketStructure } from "./analysis/marketStructure";
import { initTrendTracker, stepTrendTracker, type TrendTrackerState } from "./analysis/trendState";
import { checkPositionEntry, updatePositionEntry, forceClosePosition, DEFAULT_LEVERAGE } from "./analysis/positionEntry";

/** Price-zone session boundaries are at 00/06/12/18 in this UTC offset (PHT). */
export const PRICE_ZONE_UTC_OFFSET_HOURS = 8;

/**
 * Entry options for runAnalysis / runMarketAnalysis.
 *
 * Passed as ONE named object rather than more positional parameters. See the
 * note on runMarketAnalysis's `options` parameter for the bug that motivated
 * this. Every field is optional and every default reproduces the behaviour
 * that existed before the field was added, so `{}` and omitting the argument
 * are the same thing.
 */
/**
 * Options for runAnalysis / runMarketAnalysis.
 *
 * Passed as ONE named object rather than more positional parameters: the
 * positional list reached fourteen entries and the last addition to it silently
 * swapped two arguments, producing a run that created no positions at all while
 * looking entirely healthy. A named object cannot be mis-ordered, and an omitted
 * key is indistinguishable from the previous behaviour by construction.
 */
export interface EntryOptions {
    /**
     * Resume an earlier walk instead of re-deriving from candle 1.
     *
     * WHY THIS EXISTS, and it is a CORRECTNESS argument before it is a speed
     * one. The window holds 500 candles. Re-deriving a shifted window from
     * scratch cannot see anything that has aged out of it, so a trend segment
     * that began 600 candles ago is simply invisible and the walk reports a
     * different structure than it did one candle earlier. Carrying the state
     * forward keeps the derivation continuous across shifts - the tracker
     * remembers the segment even after its start has left the window.
     *
     * Omitted means "derive the whole array", which is exactly what every
     * existing caller already does.
     *
     * The returned carry is only valid for the NEXT step of the same walk. Hand
     * it back after shifting the window by one candle, and `shiftedBy` says how
     * far the indices moved so the carried gi-based state can be remapped.
     */
    resume?: AnalysisCarry | null;
}

/**
 * The derivation state that has to survive a window shift.
 *
 * Every field here is either a running accumulator or an INDEX INTO THE WINDOW.
 * Indices are the dangerous part: when the window shifts by one, every stored
 * index means one less than it did, and a carry applied without remapping
 * points at the wrong candle - silently, because a wrong index is still a valid
 * index. `remapCarry` does that remapping and is the only supported way to move
 * a carry across a shift.
 */
export interface AnalysisCarry {
    /** Window index the next step should begin at. */
    nextIndex: number;
    /** openTime of the last candle derived, so a caller can detect a mismatch. */
    lastOpenTime: number;
    trendTrackerState: TrendTrackerState;
    lastSwingHighPrice: number | null;
    lastSwingLowPrice: number | null;
    previousConsecutiveForStructure: { consecutiveBullish: number; consecutiveBearish: number };
    previousTrendCloud: { minLow: number; maxHigh: number } | null;
    lastKnownTrendSnapshot: { direction: string; startGi: number; endGi: number; confirmedOpenTime: number } | null;
    pocAvwapAnchors: { anchorGi: number; direction: SIGNAL_DIRECTION }[];
}

/**
 * Move a carry across a window shift of `by` candles.
 *
 * An index that falls below 0 has aged out of the window. It is CLAMPED to 0
 * rather than dropped, because the alternative is losing the segment entirely
 * and reporting a structure the market never had - and clamping is visible in
 * the exported startGi (it sits at 0 and stops moving) while a dropped segment
 * is not visible at all.
 */
export function remapCarry(carry: AnalysisCarry, by: number): AnalysisCarry {
    const shift = (n: number): number => Math.max(0, n - by);
    return {
        ...carry,
        nextIndex: Math.max(0, carry.nextIndex - by),
        lastKnownTrendSnapshot: carry.lastKnownTrendSnapshot
            ? { ...carry.lastKnownTrendSnapshot,
                startGi: shift(carry.lastKnownTrendSnapshot.startGi),
                endGi: shift(carry.lastKnownTrendSnapshot.endGi) }
            : null,
        pocAvwapAnchors: carry.pocAvwapAnchors.map(a => ({ ...a, anchorGi: shift(a.anchorGi) })),
        trendTrackerState: shiftTrendTrackerState(carry.trendTrackerState, by),
    };
}

/**
 * The tracker's own window indices.
 *
 * NAMED, NOT PATTERN-MATCHED, and this is a correction. The first version of
 * this function walked the state structurally and shifted "any numeric field
 * whose name ends in Gi", with a comment claiming that survived a rename in
 * trendState.ts. It matched NOTHING: the tracker's fields are `pivotIdx` and
 * `extremeIdx`, so the tracker was never shifted at all, and after N window
 * shifts its pivot pointed N candles away from the candle it meant.
 * `avgAtrOverRange(candles, pivotIdx, i)` then averaged the wrong range, which
 * is the denominator of the retracement test that decides where every segment
 * boundary falls. Nothing threw, and a wrong index is still a valid index.
 *
 * Typed as `keyof TrendTrackerState`, so renaming a field is now a COMPILE
 * error rather than a silent no-op, plus a runtime guard for a field ADDED
 * later that a compiler cannot notice.
 */
const TRACKER_INDEX_FIELDS: readonly (keyof TrendTrackerState)[] = ["pivotIdx", "extremeIdx"];

function shiftTrendTrackerState(state: TrendTrackerState, by: number): TrendTrackerState {
    for (const [k, v] of Object.entries(state)) {
        if ((TRACKER_INDEX_FIELDS as readonly string[]).includes(k)) continue;
        if (typeof v === "number" && /(Gi|Idx|Index)$/.test(k)) {
            throw new Error(
                `remapCarry: TrendTrackerState has an index field "${k}" that is not in `
                + "TRACKER_INDEX_FIELDS. Add it there - leaving it unshifted points the tracker "
                + "at the wrong candle without failing."
            );
        }
    }
    // Clamped, not allowed negative: both are read back as `candles[pivotIdx]`
    // inside the tracker's own ATR range, so a negative index there is an
    // immediate crash. Clamping truncates the segment at the window edge, which
    // is exactly what a full re-derive of the same window also does.
    //
    // Written out by name rather than looped, so renaming either field fails to
    // compile HERE as well as in TRACKER_INDEX_FIELDS above.
    return {
        ...state,
        pivotIdx: Math.max(0, state.pivotIdx - by),
        extremeIdx: Math.max(0, state.extremeIdx - by),
    };
}

/**
 * Re-indexes the index-bearing state ALREADY WRITTEN ONTO CANDLES, after the
 * window has shifted by `by`.
 *
 * WHY THIS IS NEEDED, and it only became needed when `resume` arrived. A full
 * re-derive rewrites every candle's fields from scratch each pass, so stale
 * indices cannot survive it. A resumed walk derives only the new candle and
 * leaves the other 499 exactly as they were - including the window indices
 * stored inside them, which now all mean one candle too many. Measured on a
 * 500-candle window stepped 200 times, a candle's reported segment start drifted
 * by one per step, up to 201 distinct answers for one candle.
 *
 * Three kinds of index live on a candle, and they are NOT treated alike:
 *
 *   trendState.startGi / endGi        CLAMPED at 0. `getVolumeState` sums
 *                                     volume over [startGi, ...] and the
 *                                     tracker averages ATR over it, so both
 *                                     index into candles.
 *   volumeState.trendVolumeRunningStats CLAMPED at 0, same reason - it is the
 *                                     running range those sums cover, threaded
 *                                     from the previous candle.
 *   positionEntry.openGi / closeGi    NOT clamped. `walkingPnl[gi - openGi]`
 *                                     and the duration cap are DIFFERENCES from
 *                                     openGi; clamping it at 0 would silently
 *                                     re-date the entry and shift every walking
 *                                     PnL reading. A negative openGi is the
 *                                     honest value for a position whose entry
 *                                     candle has aged out of the window, and it
 *                                     is what the rolling lab already produces.
 *
 * De-duplicated by object identity: each of these is ONE object shared by every
 * candle in its range, so shifting per candle would shift it 200 times.
 */
export function remapCandleIndices(candles: CandleInfo[], by: number): void {
    if (by === 0) return;
    const seen = new Set<object>();
    const once = (o: object | null | undefined): boolean => {
        if (!o || seen.has(o)) return false;
        seen.add(o);
        return true;
    };
    const clamp = (n: number): number => Math.max(0, n - by);

    for (const candle of candles) {
        const trend = candle.trendState;
        if (trend && once(trend)) {
            trend.startGi = clamp(trend.startGi);
            trend.endGi = clamp(trend.endGi);
        }
        const running = candle.volumeState?.trendVolumeRunningStats;
        if (running && once(running)) {
            running.trendStartGi = clamp(running.trendStartGi);
            running.upToGiInclusive = clamp(running.upToGiInclusive);
        }
        const position = candle.positionEntry;
        if (position && once(position)) {
            position.openGi -= by;
            if (position.closeGi != null) position.closeGi -= by;
        }
    }
}

import { computeTrendStats } from "./analysis/trendStats";
import type { PositionEntry } from "@/core/interfacesv2";

export class SimulationUtilityV2 {
    static async constructSymbolInfo(symbol:string,limit:number){
        var symbolInfo: SymbolInfo = {
            name: symbol,
            candle_15m: this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "15m", limit)),
            candle_1h:  [],//this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "1h", limit)),
            candle_4h: [], //this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "4h", limit)),
            candle_1d: [],//this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "1d", limit)),

            oi_15m: [], //await KlineUtility.getOIByRange(symbol, "15m", limit),
            oi_1h: [],//await KlineUtility.getOIByRange(symbol, "1h", limit),
            oi_4h: [], //await KlineUtility.getOIByRange(symbol, "4h", limit),
            oi_1d: [],//await KlineUtility.getOIByRange(symbol, "1d", limit),

            ls_15m: [], //await KlineUtility.getLSRatioByRange(symbol, "15m", limit),
            ls_1h: [],//await KlineUtility.getLSRatioByRange(symbol, "1h", limit),
            ls_4h: [], //await KlineUtility.getLSRatioByRange(symbol, "4h", limit),
            ls_1d: [],//await KlineUtility.getLSRatioByRange(symbol, "1d", limit),

            // Only populated once runTrendStats runs, after runAnalysis
            // has fully processed candle_15m — see runMarketAnalysis.
            trendstats_15m: null,
        };

        return symbolInfo;
    }

    static async runMarketAnalysis(
        targetSymbol: SymbolInfo,
        mainMarkets: SymbolInfo[],
        initialOpenPosition: PositionEntry | null = null,
        maxPositionDurationCandles?: number,
        positionMargin?: number,
        allowNewEntry: boolean = true,
        allowLong: boolean = true,
        allowShort: boolean = true,
        /**
         * When set, a NEW position may only be created at this one candle
         * index. Omit it (the default) and entries can fire at any candle,
         * which is what a one-pass historical walk wants.
         *
         * A ROLLING-WINDOW CALLER MUST SET THIS to candles.length - 1.
         * runAnalysis re-walks the whole window on every shift, so without it a
         * gate decision made once per tick gets applied to all 500 candles: an
         * entry the gate blocked at candle i is RESURRECTED at candle i as soon
         * as the gate opens, hundreds of ticks later, at candle i's own price -
         * which is history by then. Measured on a real run that produced 81
         * positions sharing one openTime, peak concurrency of 190 against a cap
         * of 100, and 21% of ticks over cap.
         */
        newEntryOnlyAtIndex?: number | null,
        /**
         * EVERY PARAMETER ADDED FROM HERE ON GOES IN THIS OBJECT, not after it.
         *
         * This positional list reached fourteen entries once, and adding one to
         * the MIDDLE of it silently swapped two arguments: the index landed in a
         * boolean and the boolean in the index, so `i === newEntryOnlyAtIndex`
         * compared a number against `true` and no entry was ever created. The
         * run looked healthy and simply never traded. A named object cannot be
         * mis-ordered, and an omitted key is indistinguishable from the previous
         * behaviour by construction.
         */
        options: EntryOptions = {}
    ): Promise<{ openPosition: PositionEntry | null; carry: AnalysisCarry | null }> {
        const result = this.runAnalysis(targetSymbol, targetSymbol.candle_15m, '15m', mainMarkets, initialOpenPosition, maxPositionDurationCandles, positionMargin, allowNewEntry, allowLong, allowShort, newEntryOnlyAtIndex, options);
        return result;
    }

    /**
     * Must run AFTER runAnalysis above — computeTrendStats only reads
     * fields runAnalysis has already populated on each candle
     * (trendState, conditions_met, extras, openInterest, longShort,
     * volumeState); it never derives anything from raw OHLCV itself.
     * This is a post-hoc, hindsight-aware research summary — not part
     * of the causal walk-forward pipeline runAnalysis is (see
     * TrendStats' own doc comment in interfacesv2.ts) — its purpose is
     * feeding market-behavior-around-each-move back for review, to
     * refine positionEntry.ts's own rules, not to inform any live
     * entry decision itself.
     */
    static runTrendStats(targetSymbol: SymbolInfo, candles: CandleInfo[], interval: MARKET_INTERVAL, mainMarkets: SymbolInfo[]) {
        const stats = computeTrendStats(candles);
        if (interval === '15m') targetSymbol.trendstats_15m = stats;
    }

    static runAnalysis(targetSymbol: SymbolInfo, candles: CandleInfo[], interval:MARKET_INTERVAL, mainMarkets: SymbolInfo[], initialOpenPosition: PositionEntry | null = null, maxPositionDurationCandles?: number, positionMargin?: number, allowNewEntry: boolean = true, allowLong: boolean = true, allowShort: boolean = true, newEntryOnlyAtIndex?: number | null, options: EntryOptions = {}): { openPosition: PositionEntry | null; carry: AnalysisCarry | null } {
        // ARGUMENT-ORDER GUARD. This function takes fourteen positional
        // parameters, and inserting one into the MIDDLE of that list has
        // already produced a run that created no positions at all while
        // looking entirely healthy: the index went into a boolean and the
        // boolean into the index, so `i === newEntryOnlyAtIndex` compared a
        // number against `true` and never matched. TypeScript catches this at
        // a .ts call site, but a .vue template is NOT type-checked by a
        // transpile, which is how it escaped. Failing loudly on the first call
        // is the cheapest insurance available short of an options object,
        // which would change every existing caller's signature.
        if (typeof options !== "object" || options === null || Array.isArray(options)) {
            throw new Error(
                "runAnalysis: options must be an EntryOptions object - arguments are out of order, "
                + `got ${Array.isArray(options) ? "array" : typeof options}`
            );
        }
        if (typeof newEntryOnlyAtIndex === "boolean") {
            throw new Error(
                "runAnalysis: newEntryOnlyAtIndex must be number|null, got a boolean - arguments "
                + "are out of order. This exact mistake once produced a run that created no "
                + "positions at all while looking entirely healthy."
            );
        }
        // Classic 5-candle fractal (2 candles required on either side to
        // confirm a swing) — a standard, conventional choice, not derived
        // from anything in this data; arbitrary in the sense that other
        // widths are equally defensible, just less common.
        const MARKET_STRUCTURE_FRACTAL_WIDTH = 2;
        // Stated, tunable threshold, not a "correct" value — cuts label
        // density roughly in half against real data (25.8% -> 12.0% on a
        // DASHUSDT 15m sample) by requiring a new swing to differ from
        // the prior swing of the same type by at least this many ATRs
        // before counting as real structural change rather than noise.
        const MARKET_STRUCTURE_MIN_SIGNIFICANCE_ATR = 1.0;
        var lastSwingHighPrice: number | null = null;
        var lastSwingLowPrice: number | null = null;

        // trendState tracker — same algorithm as the old, separate
        // detectTrendSegments batch pass, walked forward one candle at a
        // time here instead. Verified byte-identical output between the
        // batch and incremental forms against real data before this was
        // wired in (see trendState.ts). The main loop below starts at
        // i=1 and never itself revisits candles[0], so seeding the
        // tracker from it here is safe.
        let trendTrackerState: TrendTrackerState = initTrendTracker(candles[0]);

        // Seeds the running consecutive-bullish/bearish-streak state as
        // if candle 0 had already been processed through
        // getCandleStructure's own logic - matches what every OLD batch
        // call to getCandleStructure(movingCandles) implicitly computed
        // for candles[0] internally as part of its own warm-up (index 0
        // of whatever slice got passed in), even though candles[0]
        // itself never gets its own PERSISTED candleStructure field
        // from this loop (which starts at i=1). Verified against the
        // batch version across many randomized trials including this
        // exact seeding edge case before being wired in.
        let previousConsecutiveForStructure: { consecutiveBullish: number; consecutiveBearish: number } =
            getCandleStructure([candles[0]]);

        // Separate from candle.trendState itself: THAT field gets
        // retroactively overwritten on earlier candles every time the
        // running extreme extends or a segment commits (see the
        // application loop below) — by the end of the full run, every
        // candle's trendState reflects the FINAL, hindsight-complete
        // segment it belongs to. This variable instead captures "what
        // was the most recently known segment AS OF processing this
        // exact candle" — a snapshot that never gets rewritten by later
        // candles, which is what playback actually needs: the real lag
        // between when a trend genuinely started (in hindsight) and
        // when it was actually confirmable at the time.
        let lastKnownTrendSnapshot: { direction: string; startGi: number; endGi: number; confirmedOpenTime: number } | null = null;

        // Position simulation state. previousTrendCloud is the LAST
        // FULLY COMPLETED trend segment's own price range (not the
        // current, still-ongoing one) — updated whenever a commit
        // happens, to the segment that JUST finished. This is what the
        // entry rules mean by "the previous trend['s mid/low/high]".
        //
        // openPosition starts from initialOpenPosition when provided -
        // lets a caller resume a position that was already open going
        // INTO this call (e.g. a rolling-window replay carrying a
        // position across a window shift), rather than always starting
        // fresh. The existing if(openPosition)/else branch below
        // already does exactly the right thing with this: if it's
        // non-null, checkPositionEntry is never called for this symbol
        // until the resumed position resolves, so a carried-over
        // position can never be silently overwritten by a new one.
        let openPosition: PositionEntry | null = initialOpenPosition;
        let previousTrendCloud: { minLow: number; maxHigh: number } | null = null;
        // Stated by the user directly (not arbitrary): 2 USDT margin per
        // position by default - now configurable via the positionMargin
        // parameter, defaulting to 2 so existing callers (that don't
        // pass it) see unchanged behavior.
        const POSITION_MARGIN = positionMargin ?? 2;

        // POC AVWAP anchors — the "edge" found through research: AVWAP
        // anchored at the TREND_START and TREND_SETTER candles of the
        // last 2 trend segments. Each commit contributes 2 new anchors
        // (the new segment's own pivot, and the candle that confirmed
        // it), carrying that segment's own direction. Pruned to the
        // last 4 (2 trends x 2 anchors each) — a completed segment's
        // pair ages out once a 3rd trend's worth of anchors arrives.
        interface PocAvwapAnchor { anchorGi: number; direction: SIGNAL_DIRECTION; }
        let pocAvwapAnchors: PocAvwapAnchor[] = [];

        // Same source of truth as the UI's own addAvwapAnchor — reuses
        // CandleAnalyzerV2.getAnchorVwap rather than reimplementing the
        // cumulative-volume-weighted formula a second time. Recomputes
        // each anchor's value from scratch every step rather than
        // maintaining incremental running sums — with at most 4 anchors
        // and ~500 candles, this is cheap, and it guarantees this can
        // never silently drift from the same calculation the chart uses.
        function currentPocAvwapValues(candles: CandleInfo[], anchors: PocAvwapAnchor[], uptoGi: number): { value: number; direction: SIGNAL_DIRECTION }[] {
            return anchors.map(a => {
                const zone = CandleAnalyzerV2.getAnchorVwap(candles.slice(a.anchorGi, uptoGi + 1));
                return { value: zone.mid, direction: a.direction };
            });
        }

        // Built by one push per iteration instead of candles.slice(0, i+1).
        // The contents are identical at every step (a prefix of a fixed
        // array), but slicing per candle is O(n^2) reference copies per
        // pass - about 125,000 for a 500-candle window - against O(n) here.
        // Measured at ~9.7x on the copying itself; that is only ~3% of a
        // full run's time, so this is a free win, not the answer to it.
        // Assigned after startIndex is known, because a resumed walk must begin
        // with the candles already derived behind it - the running window every
        // derivation reads is this array, and starting it at [candles[0]] after a
        // resume would hand candle 400 a two-candle history.
        let movingCandlesAccum: CandleInfo[] = [];

        // RESUME. With a carry, the derivation state is restored and the walk
        // starts at the first candle it has not seen. Without one it starts at 1
        // and derives the whole array, which is what every existing caller does.
        //
        // The carry's indices must already be remapped for this array - see
        // remapCarry. Nothing here can check that for you: a stale index is still
        // a valid index, and the walk would carry on pointing at the wrong candle.
        // What IS checked is that the carry belongs to this series at all.
        let startIndex = 1;
        if (options.resume) {
            const carry = options.resume;
            if (carry.nextIndex < 1 || carry.nextIndex > candles.length) {
                throw new Error(
                    `runAnalysis: resume carry nextIndex ${carry.nextIndex} is outside this `
                    + `${candles.length}-candle window. Remap it with remapCarry after shifting.`
                );
            }
            const priorIdx = carry.nextIndex - 1;
            if (priorIdx >= 0 && candles[priorIdx] && candles[priorIdx].openTime !== carry.lastOpenTime) {
                throw new Error(
                    "runAnalysis: resume carry does not line up with this window - the candle at "
                    + `nextIndex-1 opens at ${candles[priorIdx].openTime}, the carry last derived `
                    + `${carry.lastOpenTime}. Resuming anyway would derive from the wrong point.`
                );
            }
            trendTrackerState = carry.trendTrackerState;
            lastSwingHighPrice = carry.lastSwingHighPrice;
            lastSwingLowPrice = carry.lastSwingLowPrice;
            previousConsecutiveForStructure = carry.previousConsecutiveForStructure;
            previousTrendCloud = carry.previousTrendCloud;
            lastKnownTrendSnapshot = carry.lastKnownTrendSnapshot;
            pocAvwapAnchors = carry.pocAvwapAnchors;
            startIndex = carry.nextIndex;
        }
        movingCandlesAccum = candles.slice(0, Math.max(1, startIndex));

        var lastTrendSetterAvwap: PriceZone | null = null;

        // Session price zone. Not part of AnalysisCarry: on a resume the
        // zone in force is simply the one the last derived candle holds.
        let activePriceZone: PriceZone | null = startIndex > 1 ? (candles[startIndex - 1]?.priceZone ?? null) : null;

        for (let i = startIndex; i <= candles.length - 1; i++) {
            movingCandlesAccum.push(candles[i]);
            var movingCandles = movingCandlesAccum;
            var candle = candles[i];

            candle.atr = CandleAnalyzerV2.calculateATR(movingCandles, 8);

            candle.liquidityAnchor = [];
            candle.conditions_met = [];
            candle.extras = [];
            candle.marketStructure = null;
            candle.trendState = null;
            candle.positionEntry = null;

            // SESSION BASED PRICE ZONE — ported from SimulationUtility.
            // generatePrizeZone only reads open/close/high/low, which
            // CandleInfo has, hence the cast.
            // Boundaries pinned to UTC+8 (PHT: 00/06/12/18), not the browser's
            // local time, so the same data always yields the same zones.
            if (SimulationUtility.isNewZonePeriod(candle.openTime, PRICE_ZONE_UTC_OFFSET_HOURS)) {
                activePriceZone = PriceZoneUtility.generatePrizeZone(movingCandles.slice(-24) as unknown as CandleEntry[], 0);
            }
            candle.priceZone = activePriceZone;
            candle.outsidePriceZoneMetrics = getOutsidePriceZoneMetrics(candle, candles[i - 1]);

            // Threading the previous candle's own stored ema200 lets
            // calculateEMA take its incremental path (one more step)
            // instead of re-converging from index 200 every single
            // candle. candles[i-1].ema200 is undefined on the loop's
            // first iteration (candle 0 is never directly processed by
            // this loop) and calculateEMA correctly falls back to full
            // recomputation whenever the previous value isn't
            // available or trustworthy - see its own guard.
            candle.ema200 = CandleAnalyzerV2.calculateEMA(movingCandles, 200, candles[i - 1]?.ema200);

            candle.candleStructure = getCandleStructure(movingCandles, candles[i - 1], previousConsecutiveForStructure);
            previousConsecutiveForStructure = candle.candleStructure;


            // A swing at confirmIdx only becomes checkable once movingCandles
            // has grown to include confirmIdx + FRACTAL_WIDTH candles after it
            // — this is genuinely retroactive: confirmIdx is an EARLIER candle
            // than the one this loop iteration is otherwise processing, and
            // its label is only knowable now, not at its own event time.
            const confirmIdx = i - MARKET_STRUCTURE_FRACTAL_WIDTH;
            // Hoisted out of the block below so the conditions section
            // can know "a market structure swing was JUST confirmed this
            // step" without re-deriving it — this is the confirmation
            // MOMENT (this candle's own openTime), even though the label
            // itself lives on the earlier confirmIdx candle.
            let newlyConfirmedLabel: MarketStructureLabel | null = null;
            if (confirmIdx >= 0) {
                const swingType = checkSwingPoint(movingCandles, confirmIdx, MARKET_STRUCTURE_FRACTAL_WIDTH);
                if (swingType) {
                    const price = swingType === "HIGH" ? candles[confirmIdx].high : candles[confirmIdx].low;
                    const atr = candles[confirmIdx].atr;
                    const result = classifyMarketStructure(swingType, price, lastSwingHighPrice, lastSwingLowPrice, atr, MARKET_STRUCTURE_MIN_SIGNIFICANCE_ATR);
                    if (result.label) {
                        // confirmedOpenTime is THIS candle's own openTime (i),
                        // not confirmIdx's — this is the moment the swing at
                        // confirmIdx actually became knowable.
                        candles[confirmIdx].marketStructure = { label: result.label, confirmedOpenTime: candle.openTime };
                        newlyConfirmedLabel = result.label;
                        // Tagged on THIS candle - the one that confirms the
                        // swing - not on the swing candle, so the condition is
                        // causal (known at this candle's close).
                        candle.conditions_met.push(`CONFIRMATION_${result.label}`);
                    }
                    if (result.updateReference) {
                        if (swingType === "HIGH") lastSwingHighPrice = price;
                        else lastSwingLowPrice = price;
                    }
                }
            }

            // trendState — advance the tracker by exactly this one
            // candle. If the running extreme just extended (or an
            // initial direction was just established), re-apply the
            // active segment's info across its WHOLE range so far —
            // every candle in a segment shares the same endGi, which
            // just changed, so earlier candles in the range need the
            // update too, not only the newest one.
            const trendResult = stepTrendTracker(candles, i, trendTrackerState);
            trendTrackerState = trendResult.state;
            // Order matters: the just-finished segment and the newly-started
            // one share exactly one boundary candle (the pivot). The batch
            // version's "later segment in the array wins" behavior means
            // the NEW segment must be applied AFTER the old one here, or
            // the old segment's info would win at that shared candle instead.
            if (trendResult.committedSegment) {
                const seg = trendResult.committedSegment;
                const info = { direction: seg.direction, startGi: seg.startGi, endGi: seg.endGi, confirmedOpenTime: seg.confirmedOpenTime };
                for (let j = seg.startGi; j <= seg.endGi; j++) candles[j].trendState = info;

                // This segment just finished, so it becomes "the
                // previous trend" for whatever entry logic runs on
                // later candles, until the NEXT commit replaces it.
                let segMinLow = Infinity, segMaxHigh = -Infinity;
                for (let j = seg.startGi; j <= seg.endGi; j++) {
                    segMinLow = Math.min(segMinLow, candles[j].low);
                    segMaxHigh = Math.max(segMaxHigh, candles[j].high);
                }
                previousTrendCloud = { minLow: segMinLow, maxHigh: segMaxHigh };
            }
            if (trendResult.currentSegmentInfo) {
                const info = trendResult.currentSegmentInfo;
                for (let j = info.startGi; j <= info.endGi; j++) candles[j].trendState = info;
            }


            candle.openInterest = getOpenInterestState(targetSymbol,movingCandles,interval);

            candle.longShort = getLongShortRatioState(targetSymbol,movingCandles,interval);

            // As-of trend pivot from the tracker: known on pullback candles
            // too, unlike candle.trendState (null there at this step).
            candle.volumeState = getVolumeState(
                movingCandles,
                candles[i - 1]?.volumeState?.trendVolumeRunningStats ?? undefined,
                trendTrackerState.direction !== null ? trendTrackerState.pivotIdx : null
            )

            // Imbalance - AFTER candleStructure and volumeState, which its
            // per-candle score reads for THIS candle (change z, volume z).
            candle.imbalanceState = getImbalanceState(movingCandles);

            // VALUE ACCEPTED - an EVENT: the candle where the move is first
            // ACCEPTED outside value (state turns IMBALANCE_UP/DOWN on this
            // candle, i.e. the Nth consecutive close outside the zone) with the
            // overall bias agreeing. A continuation read.
            {
                const imb = candle.imbalanceState;
                const prevImbState = candles[i - 1]?.imbalanceState?.state;
                if (imb && imb.state !== prevImbState) {
                    if (imb.state === "IMBALANCE_UP" && imb.bias === "BULLISH") {
                        candle.conditions_met.push("BULLISH_VALUE_ACCEPTED");
                    } else if (imb.state === "IMBALANCE_DOWN" && imb.bias === "BEARISH") {
                        candle.conditions_met.push("BEARISH_VALUE_ACCEPTED");
                    }
                }
            }

            // IMBALANCE DETECTED - this candle's imbalance score (change z-score
            // 35 + volume z-score 30 + close beyond the zone in its own direction
            // 35) reached the threshold; see getCandleImbalance. Tagged on EVERY
            // qualifying candle, so a push shows as a cluster that ends at its
            // most imbalanced candle. Named by the candle's direction (ICT-style:
            // an up push is a bullish imbalance, the void sits below price).
            {
                const ci = candle.imbalanceState?.candleImbalance;
                if (ci?.detected) {
                    candle.conditions_met.push(ci.direction === "BULLISH" ? "BULLISH_IMBALANCE_DETECTED" : "BEARISH_IMBALANCE_DETECTED");
                }
            }

            // const confirmedAnchors = getLiquidityHeatmapAnchors(movingCandles);
            // for (const { gi, anchor } of confirmedAnchors) {
            //     candles[gi].liquidityAnchor.push(anchor);
            // }

            //==========================
            //CONDITIONS
            //==========================

            // RECENT_TREND_SETTER is checked BEFORE TREND_SETTER is pushed
            // below for this same candle — a candle's own, just-detected
            // TREND_SETTER should never count toward its own
            // RECENT_TREND_SETTER, matching how this worked as two
            // separate passes (the check always ran on strictly earlier
            // candles' already-finalized conditions_met there too).
            var hasRecentTrendSetter = movingCandles.slice(-8).some(c => c.conditions_met && c.conditions_met.includes("TREND_SETTER"));
            if (hasRecentTrendSetter) {
                candle.conditions_met.push("RECENT_TREND_SETTER");
            }

            if (trendResult.committedSegment) {
                candle.conditions_met.push("TREND_SETTER");
                // TREND_START goes on the PIVOT candle where the new
                // trend actually began, in hindsight — not this current
                // candle (which is the LATER, confirming one). That
                // pivot is trendResult.currentSegmentInfo.startGi, which
                // always exists alongside committedSegment (see
                // trendState.ts) and equals the just-finished segment's
                // own endGi — the boundary candle the two segments
                // share. Pushed retroactively since that pivot candle
                // was already fully processed earlier in this loop.
                const newSegmentStartGi = trendResult.currentSegmentInfo!.startGi;
                candles[newSegmentStartGi].conditions_met.push("TREND_START");

                //here push the 2 avwap to pocAvwaps[]
                //remove the 0 and 1 indexes
                const newDirection: SIGNAL_DIRECTION = trendResult.currentSegmentInfo!.direction === "UP" ? "LONG" : "SHORT";
                pocAvwapAnchors.push({ anchorGi: newSegmentStartGi, direction: newDirection }); // TREND_START
                pocAvwapAnchors.push({ anchorGi: i, direction: newDirection }); // TREND_SETTER (this candle itself)
                if (pocAvwapAnchors.length > 4) {
                    pocAvwapAnchors = pocAvwapAnchors.slice(pocAvwapAnchors.length - 4);
                }
            }

            const activePocAvwaps = currentPocAvwapValues(candles, pocAvwapAnchors, i);
            candle.priceAction = getPriceAction(movingCandles, activePocAvwaps);
            // Breakout of CONFIRMED swing structure - getPriceAction leaves
            // these blank; see getBreakoutEvents for the definition.
            {
                const { breakout, failedBreakout } = getBreakoutEvents(movingCandles, lastSwingHighPrice, lastSwingLowPrice);
                candle.priceAction.breakout = breakout;
                candle.priceAction.failedBreakout = failedBreakout;
            }

            if(candle.priceZone){
                if(candle.close > candle.priceZone.upper){
                    candle.conditions_met.push("ABOVE_ZONE");

                    if((candle.outsidePriceZoneMetrics?.fromUpperPct ?? 0) > 1){
                        candle.conditions_met.push("GOOD_DISTANCE_ABOVE_ZONE");
                    }
                }

                // Any TREND_SETTER among the candles of the CURRENT zone so far
                // (this candle included). A zone's candles are contiguous, so
                // walk back only until the zone changes instead of scanning the
                // whole history every candle. Zones are compared by value:
                // candles restored from IndexedDB each hold their own copy.
                const zone = candle.priceZone;
                let priceZoneHasTrendSetterCandle = false;
                for (let k = movingCandles.length - 1; k >= 0; k--) {
                    const pz = movingCandles[k].priceZone;
                    if (!pz || pz.upper !== zone.upper || pz.lower !== zone.lower || pz.mid !== zone.mid) break;
                    if (movingCandles[k].conditions_met?.includes("TREND_SETTER")) {
                        priceZoneHasTrendSetterCandle = true;
                        break;
                    }
                }
                if(priceZoneHasTrendSetterCandle){
                    candle.conditions_met.push("ZONE_HAS_TREND_SETTER");
                }
            }

            if(candle.candleStructure.closeAtrAbsChange > 1){
                candle.conditions_met.push("VOLATILE_ABS_ATR_CHANGE");
            }

            if(movingCandles.length > 10){
                var hasRecentStrongPriceAction = movingCandles.slice(-6).filter(c => c.priceAction.strongAction).length >= 1;
                if(hasRecentStrongPriceAction){
                    candle.conditions_met.push("RECENT_STRONG_PRICE_ACTION");
                }
            }
            var marketStructures = movingCandles.filter(c => c.marketStructure && c.marketStructure.label)

            if(marketStructures.length >= 6){
                var recentMarketStructure = marketStructures.slice(-5).map(c => c.marketStructure!.label);
                var isMarketConfirmationCandle = candle.conditions_met.some(c => c.startsWith("CONFIRMATION_"));
                if(isMarketConfirmationCandle){
                    candle.extras.push(JSON.stringify(recentMarketStructure))

                    // The last label is the swing THIS candle just confirmed; the structure
                    // counts as bearish when at least 3 of the 5 recent labels are LH or LL.
                    var isPrevMarketStructureBear = recentMarketStructure.filter(l => l === "LH" || l === "LL").length >= 3;
                    var lastMarketStructureIsBullish = ["HL"].includes(recentMarketStructure[recentMarketStructure.length - 1]);
                    if(isPrevMarketStructureBear && lastMarketStructureIsBullish){
                        candle.conditions_met.push("BULL_SLINGSHOT_DIVE");

                        // Every candle from the oldest of the 5 recent swings up to this one.
                        var recentStructureStart = marketStructures[marketStructures.length - 5].openTime;
                        var recentStructureCandles = movingCandles.filter(c => c.openTime >= recentStructureStart);

                        var lowestCandle = recentStructureCandles.reduce((lo, c) => c.low < lo.low ? c : lo);
                        var lowestCandleOpenTime = lowestCandle.openTime;
                        var highestAtr = Math.max(...recentStructureCandles.map(c => c.candleStructure?.closeAtrAbsChange ?? 0));

                        candle.extras.push(`lowestCandleOpenTime: ${lowestCandleOpenTime}`);
                        candle.extras.push(`highestAtr: ${highestAtr}`);
                    }
                }
            }

            // Playback snapshot — records, into extras (no new interface
            // fields), what the tracker's state looked like AS OF this
            // exact candle's own processing step. Updated whenever a
            // commit just happened or the running extreme just moved;
            // left UNCHANGED on an undetermined/retracement candle, so
            // playback shows "the last thing that was actually known"
            // rather than going blank the moment a pullback starts.
            // Tagged with a leading "TREND_SNAPSHOT" marker so this
            // reuses extras safely alongside anything else that might
            // get pushed into it elsewhere.
            if (trendResult.committedSegment) {
                const seg = trendResult.committedSegment;
                lastKnownTrendSnapshot = { direction: seg.direction, startGi: seg.startGi, endGi: seg.endGi, confirmedOpenTime: seg.confirmedOpenTime };
            }
            if (trendResult.currentSegmentInfo) {
                lastKnownTrendSnapshot = { ...trendResult.currentSegmentInfo };
            }
            if (lastKnownTrendSnapshot) {
                candle.extras.push(
                    "TREND_SNAPSHOT",
                    lastKnownTrendSnapshot.direction,
                    lastKnownTrendSnapshot.startGi.toString(),
                    lastKnownTrendSnapshot.endGi.toString(),
                    lastKnownTrendSnapshot.confirmedOpenTime.toString()
                );
            }

            candle.extras.push(JSON.stringify(candle.trendState))
            candle.extras.push(i.toString())

            if(i >= 2){
                var past3Candles = movingCandles.slice(-4).filter(c => c.openTime < candle.openTime);
                var past3CandlesHasTrend = past3Candles.filter(c => c.trendState && c.trendState.direction).length >= 3;
                var currentCandleDoesntHaveATrend = !candle.trendState
                if(currentCandleDoesntHaveATrend && past3CandlesHasTrend){
                    candle.conditions_met.push("POTENTIAL_REVERSAL");
                }
            }


            // Position simulation — one at a time, matching the
            // established pattern elsewhere in this pipeline. Advance
            // an already-open position first; only look for a new
            // entry once nothing is open. reversingDirection/
            // reversingSegmentStartGi come straight from
            // lastKnownTrendSnapshot — the trend that's actually
            // reversing right now, not the older previousTrendCloud
            // (see positionEntry.ts's own header for why that
            // distinction matters).
            if (openPosition && i > openPosition.openGi) {
                const intervalMinutes = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 }[interval];
                updatePositionEntry(openPosition, candle, i);

                // Only active when a caller explicitly passes this -
                // MarketScannerComponent's own existing call never does,
                // so its behavior is provably unchanged. A rolling-
                // window "rigorous test" replay is the one caller that
                // wants a hard cap on how long a single position can
                // occupy a symbol's one-at-a-time slot.
                // A position may carry its OWN cap, which wins. Added for the
                // cross-sectional book, whose measured result is specifically a
                // 384-candle hold while the segment entry's is 250: widening the
                // global cap to fit the longer one would silently change the
                // shorter one. `undefined` falls through to the caller's value,
                // so every existing position and caller is unchanged.
                const durationCap = openPosition.maxDurationCandles ?? maxPositionDurationCandles;
                if (
                    openPosition.status === "OPEN" &&
                    durationCap != null &&
                    (i - openPosition.openGi) >= durationCap
                ) {
                    forceClosePosition(openPosition, candle, i, "EXPIRED");
                }

                openPosition.durationMinutes = (i - openPosition.openGi) * intervalMinutes;
                candle.positionEntry = openPosition;
                if (openPosition.status !== "OPEN") {
                    openPosition = null;
                }
            } else if (openPosition) {
                // openPosition is set but this candle is AT OR BEFORE
                // its own openGi - only possible via a resumed position
                // whose (remapped) openGi lands later than index 0 in
                // THIS particular array. Do nothing here: not yet time
                // to update it, and definitely not a vacant slot to
                // open a new position into. Without this branch, a
                // naive re-run from i=0 on a resumed position would
                // call updatePositionEntry on candles BEFORE it ever
                // opened, corrupting walkingPnl with wrong/duplicate
                // entries on every subsequent window shift. Still just
                // set candle.positionEntry so this candle's own display
                // reflects the resumed position correctly either way.
                candle.positionEntry = openPosition;
            // newEntryOnlyAtIndex confines entry creation to a single
            // candle - see runMarketAnalysis's own parameter docs for the
            // rolling-window bug this exists to prevent. Null/undefined
            // preserves the original "any candle" behavior exactly, so
            // MarketScannerComponent is unaffected.
            } else if (allowNewEntry && (newEntryOnlyAtIndex == null || i === newEntryOnlyAtIndex)) {
                // THE ONE ENTRY HOOK. Everything else that used to be tried here
                // has been removed; this is the single place a position is
                // created, and it is where the entry gets encoded.
                //
                // INVARIANT 1 LIVES IN THE `else if` ABOVE, not in the entry.
                // `newEntryOnlyAtIndex` confines creation to the candle the
                // simulation has actually reached. Without it, a re-walk of the
                // whole window creates entries at PAST candles' prices the moment
                // a once-per-tick gate opens - which is look-ahead and bypasses
                // the position cap, the budget check and the margin freeze at
                // once. A real run showed 190 concurrent positions against a cap
                // of 100 and 81 entries sharing one openTime.
                const newPosition = checkPositionEntry(
                    candle,
                    candles,
                    i,
                    (lastKnownTrendSnapshot?.direction as "UP" | "DOWN" | undefined) ?? null,
                    lastKnownTrendSnapshot?.startGi ?? null,
                    POSITION_MARGIN,
                    DEFAULT_LEVERAGE,
                    allowLong,
                    allowShort
                );
                if (newPosition) {
                    // Refuse a position the entry built at the wrong candle,
                    // rather than trading it. openGi is what every later
                    // calculation indexes by - walkingPnl, the duration cap, the
                    // excursion window - so a wrong one is not a small error, and
                    // it is invisible in an export that looks otherwise normal.
                    if (newPosition.openGi !== i) {
                        throw new Error(
                            `checkPositionEntry returned openGi ${newPosition.openGi} at candle ${i}. `
                            + "A position may only open at the candle the walk has reached; "
                            + "anything else is look-ahead. Use buildPositionEntry, which sets it."
                        );
                    }
                    openPosition = newPosition;
                    candle.positionEntry = openPosition;
                }
            }
        }

        // The carry is what makes the next step resumable. `nextIndex` is one
        // past the last candle derived, in THIS array's indexing - a caller that
        // shifts the window must remap it with remapCarry before handing it back.
        const carry: AnalysisCarry = {
            nextIndex: candles.length,
            lastOpenTime: candles.length ? candles[candles.length - 1].openTime : 0,
            trendTrackerState,
            lastSwingHighPrice,
            lastSwingLowPrice,
            previousConsecutiveForStructure,
            previousTrendCloud,
            lastKnownTrendSnapshot,
            pocAvwapAnchors,
        };
        return { openPosition, carry };
    }

    //HELPERS
    static mapToInfo(rawCandles: Candle[]){ 
        return rawCandles.map(candle => {
            return {
                openTime: candle.openTime,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume
            } as CandleInfo;
        });
    }
}