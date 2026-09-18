import type { CandleInfo, MARKET_INTERVAL, SymbolInfo } from "@/core/interfacesv2";
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
import { detectTrendSegments } from "./analysis/trendState";

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
            ls_1d: []//await KlineUtility.getLSRatioByRange(symbol, "1d", limit),
        };

        return symbolInfo;
    }

    static async runMarketAnalysis(targetSymbol: SymbolInfo, mainMarkets: SymbolInfo[]) {
        this.runAnalysis(targetSymbol, targetSymbol.candle_15m,'15m', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1h,'1h', mainMarkets);
        //this.runAnalysis(targetSymbol, targetSymbol.candle_4h,'4h', mainMarkets);
        // this.runAnalysis(targetSymbol, targetSymbol.candle_1d,'1d', mainMarkets);
    }

    static runAnalysis(targetSymbol: SymbolInfo, candles: CandleInfo[], interval:MARKET_INTERVAL, mainMarkets: SymbolInfo[]) {
        var lastAvwap: PriceZone | null = null;
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

            // A swing at confirmIdx only becomes checkable once movingCandles
            // has grown to include confirmIdx + FRACTAL_WIDTH candles after it
            // — this is genuinely retroactive: confirmIdx is an EARLIER candle
            // than the one this loop iteration is otherwise processing, and
            // its label is only knowable now, not at its own event time.
            const confirmIdx = i - MARKET_STRUCTURE_FRACTAL_WIDTH;
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
                    }
                    if (result.updateReference) {
                        if (swingType === "HIGH") lastSwingHighPrice = price;
                        else lastSwingLowPrice = price;
                    }
                }
            }

            // candle.openInterest = getOpenInterestState(targetSymbol,movingCandles,interval);

            // candle.longShort = getLongShortRatioState(targetSymbol,movingCandles,interval);

            // candle.volumeState = getVolumeState(movingCandles)

            // const confirmedAnchors = getLiquidityHeatmapAnchors(movingCandles);
            // for (const { gi, anchor } of confirmedAnchors) {
            //     candles[gi].liquidityAnchor.push(anchor);
            // }


            //==========================
            //CONDITIONS
            //==========================
            
        }

        // trendState is derived PURELY from marketStructure, which is
        // already fully causal by the time the loop above finishes — so
        // this only needs to run once on the complete array, not per
        // candle inside the loop. Every candle within [startGi, endGi]
        // gets the SAME segment info object (not a copy per candle) so
        // the UI can render one shape per segment rather than stitching
        // together per-candle fragments.
        const trendSegments = detectTrendSegments(candles);
        for (const seg of trendSegments) {
            const info = { direction: seg.direction, startGi: seg.startGi, endGi: seg.endGi, confirmedOpenTime: seg.confirmedOpenTime };
            for (let i = seg.startGi; i <= seg.endGi; i++) {
                candles[i].trendState = info;
            }
        }

        //CONDITIONS

        for (let i = 1; i <= candles.length - 1; i++) {
            var movingCandles = candles.slice(0, i + 1);
            var candle = candles[i];

            if(i >= 2){
                var prevCandle = candles[i - 2]

                var hasRecentTrendSetter = movingCandles.slice(-8).filter(c => c.conditions_met && c.conditions_met.filter(condition => condition == "TREND_SETTER").length == 1).length > 0;
                if(hasRecentTrendSetter){
                    candle.conditions_met.push("RECENT_TREND_SETTER");
                }
                
                if((candle.trendState && candle.openTime == candle.trendState.confirmedOpenTime)
                    || (prevCandle.trendState && candle.openTime == prevCandle.trendState.confirmedOpenTime)
                ){
                    candle.conditions_met.push("TREND_SETTER")
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