import type { CandleInfo, MARKET_INTERVAL, SymbolInfo } from "@/core/interfacesv2";
import type { Candle } from "@/core/interfaces";
import { CandleAnalyzerV2 } from "./candleAnalyzerV2";
import { getCandleStructure } from "./analysis/candleStructure";
import { getAnchorDecision } from "./analysis/anchorDecisionEngine";
import { getPriceAction } from "./analysis/priceAction";
import { getOpenInterestState } from "./analysis/openInterestState";
import { getLongShortRatioState } from "./analysis/longShortRatioState";
import { getVolumeState } from "./analysis/volumeState";
import { KlineUtility } from "../klineUtility";
import { getMarketAlignment } from "./analysis/marketAlignment";
import { getConfluenceScore } from "./analysis/confluenceScore";
import { getLiquidationHeatmapStamp } from "./analysis/liquidationHeatmapStamp";
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

            //candle.anchors = getAnchorDecision(movingCandles);

            //candle.priceAction = getPriceAction(movingCandles);

            candle.openInterest = getOpenInterestState(targetSymbol,movingCandles,interval);

            candle.longShort = getLongShortRatioState(targetSymbol,movingCandles,interval);

            candle.volumeState = getVolumeState(movingCandles);

            candle.liquidationHeatmapStamp = getLiquidationHeatmapStamp(movingCandles);
            
            candle.liquiditySweepInfo = getLiquiditySweepInfo(movingCandles);

            //candle.marketAlignment = getMarketAlignment(movingCandles,mainMarkets,interval);

            // if(interval == "15m"){
            //     candle.confluenceScore = getConfluenceScore(targetSymbol,movingCandles,mainMarkets)!;
            // }
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
