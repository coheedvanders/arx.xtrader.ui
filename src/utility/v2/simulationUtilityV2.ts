import type { CandleInfo, SymbolInfo } from "@/core/interfacesv2";
import { CandleAnalyzerV2 } from "./candleAnalyzerV2";
import { getCandleStructure } from "./analysis/candleStructure";
import { getAnchorDecision } from "./analysis/anchorDecisionEngine";

export class SimulationUtilityV2 {
    static async runMarketAnalysis(targetSymbol: SymbolInfo, mainMarket: SymbolInfo[]) {
        this.runAnalysis(targetSymbol.candle_15m);
        this.runAnalysis(targetSymbol.candle_1h);
        this.runAnalysis(targetSymbol.candle_4h);
        this.runAnalysis(targetSymbol.candle_1d);
    }

    static runAnalysis(candles: CandleInfo[]) {
        for (let i = 1; i <= candles.length - 1; i++) {
            var movingCandles = candles.slice(0, i + 1);
            var candle = candles[i];

            candle.atr = CandleAnalyzerV2.calculateATR(movingCandles, 8);
            candle.ema200 = CandleAnalyzerV2.calculateEMA(movingCandles, 200);

            candle.candleStructure = getCandleStructure(movingCandles);

            candle.anchors = getAnchorDecision(movingCandles);
        }
    }
}