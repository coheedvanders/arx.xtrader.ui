import type { CandleInfo, MARKET_INTERVAL, SymbolInfo } from "@/core/interfacesv2";
import type { Candle } from "@/core/interfaces";
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

export class SimulationUtilityV2 {
    static async constructSymbolInfo(symbol:string,limit:number){
        var symbolInfo: SymbolInfo = {
            name: symbol,
            candle_15m: this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "15m", limit)),
            candle_1h:  [],//this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "1h", limit)),
            candle_4h: [],//this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "4h", limit)),
            candle_1d: [],//this.mapToInfo(await KlineUtility.getRecentKlines(symbol, "1d", limit)),

            oi_15m: await KlineUtility.getOIByRange(symbol, "15m", limit),
            oi_1h: [],//await KlineUtility.getOIByRange(symbol, "1h", limit),
            oi_4h: [], //await KlineUtility.getOIByRange(symbol, "4h", limit),
            oi_1d: [],//await KlineUtility.getOIByRange(symbol, "1d", limit),

            ls_15m: await KlineUtility.getLSRatioByRange(symbol, "15m", limit),
            ls_1h: [],//await KlineUtility.getLSRatioByRange(symbol, "1h", limit),
            ls_4h: [], //await KlineUtility.getLSRatioByRange(symbol, "4h", limit),
            ls_1d: []//await KlineUtility.getLSRatioByRange(symbol, "1d", limit),
        };

        return symbolInfo;
    }

    static async runMarketAnalysis(targetSymbol: SymbolInfo, mainMarkets: SymbolInfo[]) {
        this.runAnalysis(targetSymbol, targetSymbol.candle_15m,'15m', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1h,'1h', mainMarkets);
        this.runAnalysis(targetSymbol, targetSymbol.candle_4h,'4h', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1d,'1d', mainMarkets);
    }

    static runAnalysis(targetSymbol: SymbolInfo, candles: CandleInfo[], interval:MARKET_INTERVAL, mainMarkets: SymbolInfo[]) {
        for (let i = 1; i <= candles.length - 1; i++) {
            var movingCandles = candles.slice(0, i + 1);
            var candle = candles[i];

            candle.atr = CandleAnalyzerV2.calculateATR(movingCandles, 8);
            candle.ema200 = CandleAnalyzerV2.calculateEMA(movingCandles, 200);

            candle.candleStructure = getCandleStructure(movingCandles);

            // Default empty at this candle's own turn — entries may be
            // pushed RETROACTIVELY by a later iteration once enough future
            // bars confirm this candle was actually a trend START/END
            // (swing confirmation always requires hindsight; see
            // liquidityHeatmapAnchor.ts's module comment). A candle can
            // collect more than one entry — e.g. a clean reversal point is
            // both the END of one segment and the START of the next.
            // Still fully causal: nothing is written before it's genuinely
            // known.
            candle.liquidityAnchor = [];
            candle.conditions_met = [];

            //candle.anchors = getAnchorDecision(movingCandles);

            candle.openInterest = getOpenInterestState(targetSymbol,movingCandles,interval);

            candle.longShort = getLongShortRatioState(targetSymbol,movingCandles,interval);

            candle.volumeState = getVolumeState(movingCandles)

            //candle.marketAlignment = getMarketAlignment(movingCandles,mainMarkets,interval);

            // Lifecycle stamp is driven only by candle.openInterest.positioningState,
            // already set above — must run AFTER openInterest.
            candle.liquidationHeatmapStamp = getLiquidationHeatmapStamp(movingCandles);

            // Independent of everything above — only needs high/low/openTime.
            // Each returned anchor targets its OWN candle index (gi), which
            // is almost always earlier than the current one, since
            // confirming a swing requires bars after it. Must run BEFORE
            // liquiditySweepInfo below, which reads candle.liquidityAnchor
            // to find the previous confirmed segment to measure against.
            const confirmedAnchors = getLiquidityHeatmapAnchors(movingCandles);
            for (const { gi, anchor } of confirmedAnchors) {
                candles[gi].liquidityAnchor.push(anchor);
            }

            // Reads liquidityAnchor (just populated above, on this and
            // earlier candles) to find the most recently CLOSED segment —
            // never the one currently forming — and measures this candle's
            // sweep against that segment's hot (yellow/red) liquidity. No
            // longer reads liquidationHeatmapStamp at all.
            candle.liquiditySweepInfo = getLiquiditySweepInfo(movingCandles);

            // Narrates sweep -> rejection -> reclaim -> displacement using
            // the current candle's liquiditySweepInfo (just set above) and
            // the previous candle's priceAction (its pending sequence
            // state) — must run AFTER liquiditySweepInfo.
            candle.priceAction = getPriceAction(movingCandles);

            // if(interval == "15m"){
            //     candle.confluenceScore = getConfluenceScore(targetSymbol,movingCandles,mainMarkets)!;
            // }

            //CONDITIONS
            var pastMovingCandles = movingCandles.slice(-8);
            var pastOpenTimes = new Set(pastMovingCandles.map(c => c.openTime));

            //var hasRecentEndHeatmapAnchor = pastMovingCandles.filter(c => c.liquidityAnchor && c.liquidityAnchor.length >= 1 && c.liquidityAnchor.filter(l => l.type == "END").length >= 1).length >= 1
            // if(hasRecentEndHeatmapAnchor){
            //     candle.conditions_met.push("RECENT_LIQUIDITY_END");
            //     console.log(movingCandles.length);
            // }

            // Distinct from the check above: that one only catches an anchor
            // whose EVENT candle (anchorOpenTime) falls in the last 8 bars.
            // But an anchor is written onto its event candle, which can sit
            // well BEFORE the last 8 bars even when it was only just
            // CONFIRMED now — confirmation lag is exactly the gap the LH
            // Anchors staple connector visualizes, and it isn't bounded by
            // this 8-candle window. This checks confirmedOpenTime instead,
            // searching every candle's own liquidityAnchor entries (not just
            // the recent ones, since the anchor data itself can live far
            // earlier) for any anchor confirmed within the recent window.
            var hasRecentLiquidityAnchorConfirmation = movingCandles.some(c =>
                c.liquidityAnchor && c.liquidityAnchor.some(l => pastOpenTimes.has(l.confirmedOpenTime))
            );
            // if (hasRecentLiquidityAnchorConfirmation) {
            //     candle.conditions_met.push("RECENT_LIQUIDITY_ANCHOR_CONFIRMATION");
            // }

            // The LAST liquidity heatmap anchor (highest sequenceIndex seen
            // so far — segments are numbered in the order their START
            // confirms) having BOTH a START and an END means that segment
            // is fully closed, not still ongoing — a stronger signal than
            // a segment that's only been opened. START and END anchors can
            // sit on completely different candles (sometimes far apart),
            // so this scans every candle's liquidityAnchor entries, not
            // just the recent window, to find every anchor belonging to
            // that one specific segment.
            var allAnchorCandles = movingCandles.filter(c => c.liquidityAnchor && c.liquidityAnchor.length >= 1);
            if(allAnchorCandles.length >= 1){
                var lastAnchorCandle = allAnchorCandles[allAnchorCandles.length - 1]
                var latestAnchorIsStrong = lastAnchorCandle.liquidityAnchor.length == 2
                if (latestAnchorIsStrong && hasRecentLiquidityAnchorConfirmation) {
                    candle.conditions_met.push("STRONG_LIQUIDITY_ANCHOR");
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