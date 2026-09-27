import type { CandleInfo, MARKET_INTERVAL, SymbolInfo, SIGNAL_DIRECTION, MarketStructureLabel } from "@/core/interfacesv2";
import type { Candle, PriceZone } from "@/core/interfaces";
import { CandleAnalyzerV2 } from "./candleAnalyzerV2";
import { getCandleStructure } from "./analysis/candleStructure";
import { getAnchorDecision } from "./analysis/anchorDecisionEngine";
import { getOpenInterestState } from "./analysis/openInterestState";
import { getLongShortRatioState } from "./analysis/longShortRatioState";
import { getVolumeState } from "./analysis/volumeState";
import { KlineUtility } from "../klineUtility";
import { getMarketAlignment } from "./analysis/marketAlignment";
import { getConfluenceScore } from "./analysis/confluenceScore";
import { getPriceAction } from "./analysis/priceAction";
import { getLiquidationHeatmapStamp } from "./analysis/liquidationHeatmapStamp";
import { getLiquidityHeatmapAnchors } from "./analysis/liquidityHeatmapAnchor";
import { getLiquiditySweepInfo } from "./analysis/liquidationSweepInfo";
import { getImbalanceState } from "./analysis/imbalance";
import { checkSwingPoint, classifyMarketStructure } from "./analysis/marketStructure";
import { initTrendTracker, stepTrendTracker, type TrendTrackerState } from "./analysis/trendState";
import { checkPositionEntry, updatePositionEntry, forceClosePosition, DEFAULT_LEVERAGE, MIN_REWARD_RISK, checkExtensionEntry, EXTENSION_LEVELS, type ExtensionLevels } from "./analysis/positionEntry";
import { checkBreakoutFadeEntry, type BreakoutFadeConfig } from "./analysis/breakoutFadeEntry";

/**
 * Entry options for runAnalysis / runMarketAnalysis.
 *
 * Passed as ONE named object rather than more positional parameters. See the
 * note on runMarketAnalysis's `options` parameter for the bug that motivated
 * this. Every field is optional and every default reproduces the behaviour
 * that existed before the field was added, so `{}` and omitting the argument
 * are the same thing.
 */
export interface EntryOptions {
    /**
     * Try the POTENTIAL_REVERSAL entry. Default true - the incumbent.
     *
     * Exposed so it can be turned OFF, which as of 2026-09-27 is the only
     * change to this engine with evidence behind it. In the rolling run over
     * 2026-01-01 -> 02-27, restricted to the trades actually inside that
     * window, POTENTIAL_REVERSAL took 652 trades at a 17.0% win rate for
     * -0.2341R each and -61.51 net, t -2.16 clustered on entry day. Removing
     * it takes the run's in-window loss from -149.96 to -88.45.
     *
     * That is loss reduction, not profit. The remainder still loses.
     */
    allowReversalEntry?: boolean;
    /**
     * Level geometry for the extension entry. Defaults to EXTENSION_LEVELS,
     * the historical 3/3 (R:R 1.0) values, so existing runs reproduce.
     *
     * Pass EXTENSION_LEVELS_RR3 to run the 1:3 geometry. Note that with
     * minRewardRisk 3 the default geometry fires NOTHING - deliberately, see
     * ExtensionEntryConfig.minRewardRisk - so a run configured with
     * minRewardRisk 3 and allowExtensionEntry true must also pass the RR3
     * levels here or it will take no extension trades.
     */
    extensionLevels?: ExtensionLevels;
    /**
     * BREAKOUT_FADE — the rebuilt close-beyond-the-prior-extreme entry, measured
     * over 37 days instead of 38 hours. Absent or null means OFF, so every
     * existing caller is provably unchanged.
     *
     * Its config carries its own allowLong/allowShort and its own guards rather
     * than inheriting the positional ones, because its measured result depends on
     * taking BOTH sides and a silently inherited long-only toggle would turn a
     * -0.01R configuration into a -0.18R one without saying so. The caller states
     * it; nothing is supplied on its behalf.
     */
    breakoutFade?: BreakoutFadeConfig | null;
    /**
     * A portfolio-level veto on the SIDE about to be opened, consulted by the
     * entry checks at the candle the simulation has actually reached.
     *
     * WHY A CALLBACK. Direction balance (see directionBalance.ts) is worth ~0.17R
     * per trade and cannot live in an entry module: it depends on what the whole
     * book has already opened today, which runAnalysis has no knowledge of. It
     * also cannot be applied after the fact, because by then the position exists
     * and has been stamped. A veto consulted at creation time is the only place
     * it fits without breaking invariant 1.
     *
     * Absent means everything is allowed. Must be a PURE PREDICATE: the caller
     * commits its own state only once a position is actually returned, because
     * several gates can still refuse a candidate after this one passes.
     */
    canOpenSide?: (side: "LONG" | "SHORT") => boolean;
    /**
     * How much of the per-candle derivation to compute.
     *
     * "full" (the default) is the previous behaviour exactly, so every existing
     * caller is unchanged. "lean" computes ATR and nothing else.
     *
     * Lean is correct for every entry EXCEPT POTENTIAL_REVERSAL, which is the
     * only consumer of the heavy state - see the block it guards. Asking for
     * lean with the reversal entry enabled is refused rather than honoured,
     * because the alternative is a run that completes normally and takes no
     * reversal trades.
     */
    derive?: "full" | "lean";
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
        // Defaults to the policy floor rather than 0. These parameters are
        // passed EXPLICITLY down to checkPositionEntry, so a 0 here would
        // shadow that function's own default and leave the R:R gate inert
        // no matter what positionEntry.ts says. Pass 0 to disable.
        minRewardRisk: number = MIN_REWARD_RISK,
        minRiskPercent: number = 0,
        /**
         * When set, a NEW position may only be created at this one candle
         * index. Omit it (the default) and entries can fire at any candle,
         * which is what a one-pass historical walk wants.
         *
         * A ROLLING-WINDOW caller MUST set this to candles.length - 1.
         * runAnalysis re-walks the whole window on every shift, so without
         * it a gate decision made once per tick gets applied to all 500
         * candles: an entry the gate blocked at candle i (cap full, budget
         * short, interest gate failed) is RESURRECTED at candle i as soon
         * as the gate opens, hundreds of ticks later, at candle i's own
         * price - which is history by then. Measured on a real run that
         * produced 81 positions sharing a single openTime, true peak
         * concurrency of 190 against a cap of 100, and 21% of ticks over
         * cap. It is also look-ahead: the entry price predates the
         * decision. See the component's own call site.
         */
        newEntryOnlyAtIndex?: number | null,
        /**
         * Also try the EXTENSION FADE entry on each eligible candle.
         *
         * Defaults to false, so every existing caller is provably unchanged:
         * with it off, not a single additional entry can be created.
         *
         * The extension entry inherits allowLong / allowShort / minRiskPercent
         * from the arguments above rather than carrying its own copies - one
         * toggle, one meaning, whichever entry is firing.
         *
         * DECLARED LAST, and it must stay last. Added in the MIDDLE of this
         * positional list once, which silently swapped it with
         * newEntryOnlyAtIndex: the index landed in a boolean parameter and a
         * boolean in the index, so `i === newEntryOnlyAtIndex` compared a
         * number against `true` and NO entry was ever created - by EITHER
         * entry function. The run looked healthy and simply never traded.
         */
        allowExtensionEntry: boolean = false,
        /**
         * EVERY PARAMETER ADDED FROM HERE ON GOES IN THIS OBJECT, not after it.
         *
         * The positional list above reached fourteen entries and the last
         * addition to it silently swapped two arguments and produced a run that
         * created no positions at all while looking healthy. A named object
         * cannot be mis-ordered, and an omitted key is indistinguishable from
         * the old behaviour by construction. `{}` is exactly the previous
         * behaviour.
         */
        options: EntryOptions = {}
    ): Promise<{ openPosition: PositionEntry | null }> {
        const result = this.runAnalysis(targetSymbol, targetSymbol.candle_15m, '15m', mainMarkets, initialOpenPosition, maxPositionDurationCandles, positionMargin, allowNewEntry, allowLong, allowShort, minRewardRisk, minRiskPercent, newEntryOnlyAtIndex, allowExtensionEntry, options);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1h,'1h', mainMarkets);
        //this.runAnalysis(targetSymbol, targetSymbol.candle_4h,'4h', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1d,'1d', mainMarkets);

        //this.runTrendStats(targetSymbol, targetSymbol.candle_15m, '15m', mainMarkets);
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

    static runAnalysis(targetSymbol: SymbolInfo, candles: CandleInfo[], interval:MARKET_INTERVAL, mainMarkets: SymbolInfo[], initialOpenPosition: PositionEntry | null = null, maxPositionDurationCandles?: number, positionMargin?: number, allowNewEntry: boolean = true, allowLong: boolean = true, allowShort: boolean = true, minRewardRisk: number = MIN_REWARD_RISK, minRiskPercent: number = 0, newEntryOnlyAtIndex?: number | null, allowExtensionEntry: boolean = false, options: EntryOptions = {}): { openPosition: PositionEntry | null } {
        const allowReversalEntry = options.allowReversalEntry ?? true;
        const derive = options.derive ?? "full";
        if (derive === "lean" && allowReversalEntry) {
            throw new Error(
                "runAnalysis: derive 'lean' skips the trend and segment derivation that "
                + "POTENTIAL_REVERSAL depends on. Either set derive 'full' or turn the "
                + "reversal entry off - a lean run with it on would simply never trade."
            );
        }
        const extensionLevels = options.extensionLevels ?? EXTENSION_LEVELS;
        const breakoutFadeConfig = options.breakoutFade ?? null;
        const canOpenSide = options.canOpenSide;
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
        if (typeof newEntryOnlyAtIndex === "boolean" || typeof allowExtensionEntry === "number") {
            throw new Error(
                "runAnalysis: arguments are out of order - newEntryOnlyAtIndex must be number|null and "
                + `allowExtensionEntry boolean, got ${typeof newEntryOnlyAtIndex} and ${typeof allowExtensionEntry}`
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
        const movingCandlesAccum: CandleInfo[] = [candles[0]];

        for (let i = 1; i <= candles.length - 1; i++) {
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

            // ── HEAVY DERIVATION ──────────────────────────────────────
            // Everything in this block exists for ONE consumer: checkPositionEntry,
            // which reads the trend snapshot and the segment geometry. Nothing else
            // in the pipeline touches it. `updatePositionEntry` reads open/high/low/
            // close/atr; `checkExtensionEntry` and `detectBreakoutFade` read atr and
            // raw OHLCV; the cross-sectional book does not come through here at all.
            //
            // It is also almost all of the runtime, and two parts of it are
            // QUADRATIC in the window:
            //   - currentPocAvwapValues re-accumulates each of up to 4 AVWAP anchors
            //     from its anchor candle forward, once per candle. On a 500-candle
            //     window that is up to ~1,000,000 multiply-adds per symbol-tick, for
            //     four numbers.
            //   - getCandleStructure and calculateEMA are handed the whole growing
            //     array; whether they walk it depends on the build.
            //
            // So a run with the reversal entry OFF was paying for all of it and
            // reading none of it. `derive: "lean"` skips it. What lean runs lose,
            // stated plainly: conditions_met, extras, trendState, marketStructure,
            // volumeState, candleStructure, priceAction and ema200 are all left at
            // their reset values, so the archive keeps raw OHLCV + ATR and no signal
            // fields, and POTENTIAL_REVERSAL cannot fire - which is why asking for
            // both is refused outright at the top of this function rather than
            // quietly producing a run with no reversal trades.
            if (derive === "full") {
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

                candle.volumeState = getVolumeState(movingCandles, candles[i - 1]?.volumeState?.trendVolumeRunningStats ?? undefined)

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
                // `allowReversalEntry` already implies derive === "full" (the
                // guard at the top of this function refuses the other
                // combination), so this needs no second check - but the entry it
                // calls reads lastKnownTrendSnapshot, which lean never sets.
                if (allowReversalEntry) {
                    const newPosition = checkPositionEntry(
                        candle,
                        candles,
                        i,
                        (lastKnownTrendSnapshot?.direction as "UP" | "DOWN" | undefined) ?? null,
                        lastKnownTrendSnapshot?.startGi ?? null,
                        POSITION_MARGIN,
                        DEFAULT_LEVERAGE,
                        allowLong,
                        allowShort,
                        minRewardRisk,
                        minRiskPercent
                    );
                    if (newPosition && (!canOpenSide || canOpenSide(newPosition.side))) {
                        openPosition = newPosition;
                        candle.positionEntry = openPosition;
                    }
                }

                // EXTENSION FADE, tried only when the reversal entry did not
                // fire. Both are inside the same `allowNewEntry &&
                // newEntryOnlyAtIndex` guard, so invariant 1 holds for this
                // entry exactly as it does for the other one: a new position
                // can still only be created at the candle the simulation has
                // actually reached.
                //
                // REVERSAL FIRST is a fixed precedence, not a judgement that it
                // is the better entry - it is the incumbent, and a fixed order
                // makes the result deterministic. The two fire on different
                // events (POTENTIAL_REVERSAL closes INSIDE the range it fades;
                // this one closes BEYOND it - measured as never co-occurring
                // across 5,666 candidates), so this branch is reached on
                // essentially every extension event anyway.
                if (!openPosition && allowExtensionEntry) {
                    const extension = checkExtensionEntry(
                        candle,
                        candles,
                        i,
                        POSITION_MARGIN,
                        DEFAULT_LEVERAGE,
                        {
                            ...extensionLevels,
                            // Inherited, not re-decided here. The caller's
                            // toggles mean the same thing for both entries.
                            allowLong,
                            allowShort,
                            minRiskPercent,
                            // ONE R:R rule for both entries as of 2026-09-27.
                            // With the default 3/3 levels (R:R 1.0) and a
                            // minRewardRisk of 3 this rejects every extension
                            // entry - see ExtensionEntryConfig.minRewardRisk.
                            // That is the intended, visible consequence of the
                            // rule, not a regression.
                            minRewardRisk,
                        }
                    );
                    if (extension && (!canOpenSide || canOpenSide(extension.side))) {
                        openPosition = extension;
                        candle.positionEntry = openPosition;
                    }
                }

                // BREAKOUT_FADE, the rebuilt version of the same event. Tried
                // last, and only when nothing else fired, so precedence is fixed
                // and the result is deterministic. Inside the same
                // `allowNewEntry && newEntryOnlyAtIndex` guard, so invariant 1
                // holds for it exactly as for the other two.
                //
                // Running it alongside EXTENSION_FADE is possible but not
                // meaningful: both fade the same event, so whichever is tried
                // first takes every signal and the other reports nothing. Enable
                // one at a time.
                if (!openPosition && breakoutFadeConfig) {
                    const fade = checkBreakoutFadeEntry(
                        candle, candles, i, POSITION_MARGIN, DEFAULT_LEVERAGE,
                        breakoutFadeConfig
                    );
                    if (fade && (!canOpenSide || canOpenSide(fade.side))) {
                        openPosition = fade;
                        candle.positionEntry = openPosition;
                    }
                }
            }
        }

        return { openPosition };
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