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
import { checkPositionEntry, updatePositionEntry, DEFAULT_LEVERAGE } from "./analysis/positionEntry";
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

    static async runMarketAnalysis(targetSymbol: SymbolInfo, mainMarkets: SymbolInfo[]) {
        this.runAnalysis(targetSymbol, targetSymbol.candle_15m,'15m', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1h,'1h', mainMarkets);
        //this.runAnalysis(targetSymbol, targetSymbol.candle_4h,'4h', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1d,'1d', mainMarkets);

        //this.runTrendStats(targetSymbol, targetSymbol.candle_15m, '15m', mainMarkets);
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

    static runAnalysis(targetSymbol: SymbolInfo, candles: CandleInfo[], interval:MARKET_INTERVAL, mainMarkets: SymbolInfo[]) {
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
        let openPosition: PositionEntry | null = null;
        let previousTrendCloud: { minLow: number; maxHigh: number } | null = null;
        // Stated by the user directly (not arbitrary): 2 USDT margin per position.
        const POSITION_MARGIN = 2;

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

        for (let i = 1; i <= candles.length - 1; i++) {
            var movingCandles = candles.slice(0, i + 1);
            var candle = candles[i];

            candle.atr = CandleAnalyzerV2.calculateATR(movingCandles, 8);
            candle.ema200 = CandleAnalyzerV2.calculateEMA(movingCandles, 200);

            candle.candleStructure = getCandleStructure(movingCandles);

            candle.liquidityAnchor = [];
            candle.conditions_met = [];
            candle.extras = [];
            candle.marketStructure = null;
            candle.trendState = null;
            candle.positionEntry = null;

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

            candle.volumeState = getVolumeState(movingCandles)

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

            // Position simulation — one at a time, matching the
            // established pattern elsewhere in this pipeline. Advance
            // an already-open position first; only look for a new
            // entry once nothing is open. reversingDirection/
            // reversingSegmentStartGi come straight from
            // lastKnownTrendSnapshot — the trend that's actually
            // reversing right now, not the older previousTrendCloud
            // (see positionEntry.ts's own header for why that
            // distinction matters).
            if (openPosition) {
                const intervalMinutes = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 }[interval];
                updatePositionEntry(openPosition, candle, i);
                openPosition.durationMinutes = (i - openPosition.openGi) * intervalMinutes;
                candle.positionEntry = openPosition;
                if (openPosition.status !== "OPEN") {
                    openPosition = null;
                }
            } else {
                const newPosition = checkPositionEntry(
                    candle,
                    candles,
                    i,
                    (lastKnownTrendSnapshot?.direction as "UP" | "DOWN" | undefined) ?? null,
                    lastKnownTrendSnapshot?.startGi ?? null,
                    POSITION_MARGIN,
                    DEFAULT_LEVERAGE
                );
                if (newPosition) {
                    openPosition = newPosition;
                    candle.positionEntry = openPosition;
                }
            }
        }
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