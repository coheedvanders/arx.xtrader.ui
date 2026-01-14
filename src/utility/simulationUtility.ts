import type { Candle, CandleEntry, CloseAbsDistanceToZone, PriceZone, PriceZoneEvaluation } from "@/core/interfaces";
import { candleAnalyzer } from "./candleAnalyzerUtility";
import { OrderMakerUtility } from "./OrderMakerUtility.ts";
import { KlineUtility } from "./klineUtility.ts";
import { klineDbUtility } from "./klineDbUtility.ts";
import { PriceZoneUtility } from "./priceZoneUtility.ts";
import { PnlUtility } from "./PnlUtility.ts";
import { TypePredicateKind } from "typescript";

export class SimulationUtility {
    static async initializePastCandleEntryData(symbol: string, interval:string,maxCandles:number, supportAndResistancePeriodLength: number){
        var candles : CandleEntry[] = [];
        const raw = await KlineUtility.getRecentKlines(symbol, interval, maxCandles);
        if(raw.length < maxCandles) {
            candles = [];
            return
        }

        candleAnalyzer.initializePastCandlesSupportResistance(raw,maxCandles - supportAndResistancePeriodLength,supportAndResistancePeriodLength);

        candles = [];
        candles = raw.map(c => ({
            ...c,
            close_atr_adjusted: 0,
            close_atr_abs_change: 0,
            symbol: symbol,
            status: '',
            side: '',
            tpPrice: 0,
            duration: 0,
            slPrice: 0,
            zoneAnalysis: null,
            volumeAnalysis: null,
            overboughSoldAnalysis: null,
            pastVolumeAnalysis: null,
            candleData: null,
            priceZone: null,
            priceZoneInteraction: null,
            pnl: 0,
            leverage: 0,
            margin: 0,
            entryFee: 0,
            zoneSizePercentage: 0,
            closeAbsDistanceToZone: null,
            priceZoneEvaluation: null,
            patternTrack: ""

        }));

        klineDbUtility.initializeKlineData(symbol,candles.slice(0, -1));
    }

    static async markPositionEntries(
        margin:number,
        positionDurationMedian:number, 
        targetTpRoi:number,
        targetSlRoi:number,
        symbol: string, 
        candles: CandleEntry[],
        _maxLeverage:number,
        entryIndex:number,
        startingTimeStamp:number
    ){

        let openPosition: CandleEntry | null = null;
        var activePriceZone: PriceZone | null = null;
        var basePriceZonePoint: number | null = null;
        var zoneOpenTime = 0


        for (let i = 1; i <= entryIndex; i++) {
            var movingCandles = candles.slice(0, i + 1);
            var candle = candles[i];

            // if(candle.openTime < startingTimeStamp && candle.closeTime > startingTimeStamp){
            //     candle.side = "STARTING_POINT"
            // }

            // if(candle.openTime < startingTimeStamp) continue;
            
            var prevCandle = candles[i - 1];
            var supportCandle = candles[i - 2];

            if(candle && candle.support && candle.resistance){
                var _side = candle.close > candle.open ? "BUY" : "SELL";

                var zoneAnalysis = candleAnalyzer.analyzeZoneInteraction(
                    _side,
                    candle.close,
                    movingCandles,
                    candle.support,
                    candle.resistance,
                    20,  // check last 20 candles for interactions
                    10,  // check last 10 for trend
                    5,    // check last 5 for momentum
                    50
                );

                
                var volumeAnalysis = candleAnalyzer.computeVolumeAnalysis(movingCandles,candle.close,20);
                var overSoldBoughtAnalysis = candleAnalyzer.detectOverboughtOversold(volumeAnalysis, zoneAnalysis, candles)
                var candleData = candleAnalyzer.analyzeCandlestick(movingCandles,i,true,5);
                const pastVolumeAnalysis = candleAnalyzer.analyzePastVolumes(candles, i, 20);
                var atr = candleAnalyzer.calculateATR(movingCandles,8);
                var pastCandleAverageChange = movingCandles.slice(-20)
                        .map(c => c.candleData?.change_percentage_v ?? 0)
                        .map(Math.abs)
                        .reduce((sum, val) => sum + val, 0) / 20
                
                candle.zoneAnalysis = zoneAnalysis;
                
                candle.volumeAnalysis = volumeAnalysis;
                candle.pastVolumeAnalysis = pastVolumeAnalysis;
                candle.overboughSoldAnalysis = overSoldBoughtAnalysis;
                candle.candleData = candleData;
                candle.candleData.priceMove = candleAnalyzer.detectPriceMove(movingCandles, movingCandles.length - 1)
                candle.candleData.volumeSpike = candleAnalyzer.hasVolumeSpike(movingCandles,20);
                candle.overboughSoldAnalysis.extremeLevel = candleAnalyzer.detectOverState(movingCandles,8);
                candle.candleData.pastCandleAverageChange = pastCandleAverageChange
                candle.candleData.atr = atr;

                var isHighlyVolatile = false;
                if(movingCandles.length > 20){
                    isHighlyVolatile = candleAnalyzer.isVolatilityExpanding(movingCandles.slice(-14).filter(c => c.candleData).map(c => c.candleData!.atr))
                }

                if(candle.candleData.side == "bear"){
                    candle.close_atr_adjusted = candle.close - atr;
                }else if(candle.candleData.side == "bull"){
                    candle.close_atr_adjusted = candle.close + atr;
                }

                candle.close_atr_abs_change = Math.abs(((candle.close - candle.close_atr_adjusted) / candle.close_atr_adjusted) * 100)

                candle.candleData.ema200 = candleAnalyzer.calculateEMA(movingCandles, 200);

                if(candle.overboughSoldAnalysis.extremeLevel != ""){
                    candle.candleData.pastZoneOverStatePriceReaction = candleAnalyzer.getPreviousSessionOverStatePriceReaction(movingCandles,candle.overboughSoldAnalysis.extremeLevel)
                }

                //===============
                //SESSION BASED PRICE ZONE
                //===============
                var isNewSessionPriceZone = this.isNewZonePeriod(candle.openTime);
                var pastZoneChangeAverage = 0;
                if(isNewSessionPriceZone){
                    const pointOfInterestPriceZoneCandles = movingCandles.slice(-24);

                    var _calculatedPriceZone = PriceZoneUtility.generatePrizeZone(pointOfInterestPriceZoneCandles,0);

                    activePriceZone = _calculatedPriceZone;
                    zoneOpenTime = candle.openTime;
                    candle.status = "ZONE_START"
                    candle.candleData.isNewZone = true;
                }

                if(activePriceZone){
                    var zoneInhabitantCount = movingCandles.filter(c => 
                        c.openTime >= zoneOpenTime!
                        && (c.close > activePriceZone!.lower && c.close < activePriceZone!.upper) 
                        && (c.open > activePriceZone!.lower && c.open < activePriceZone!.upper)
                    ).length
                    candle.priceZone = activePriceZone;
                    candle.candleData.zoneInhabitantCount = zoneInhabitantCount

                    var zoneInteraction = PriceZoneUtility.analyzeZoneInteraction(movingCandles, activePriceZone, 50);
                    candle.priceZoneInteraction = zoneInteraction;
                    candle.candleData.zoneSizePercentage = ((activePriceZone.upper - activePriceZone.lower) / activePriceZone.lower) * 100

                    pastZoneChangeAverage = movingCandles
                    .filter(c => c.openTime < zoneOpenTime && c.candleData && c.candleData.isNewZone)
                    .slice(-3)
                    .reduce((sum, s) => sum + s.candleData!.zoneSizePercentage, 0) / 3

                    candle.candleData.extraInfo = pastZoneChangeAverage.toFixed(2).toString();
                    candle.candleData.spaceTakenInZoneLevel = candleAnalyzer.calculateCandleSpaceTakenInZoneLevel(candle,activePriceZone);

                    var closeAbsDistanceToZone: CloseAbsDistanceToZone = {
                        upper: Math.abs(((candle.close - candle.priceZone.upper) / candle.priceZone.upper) * 100),
                        mid: Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100),
                        lower: Math.abs(((candle.close - candle.priceZone.lower) / candle.priceZone.lower) * 100)
                    }

                    candle.closeAbsDistanceToZone = closeAbsDistanceToZone
                }

                //===============
                //LOOKBACK TREND
                //===============
                var lookbackChange = movingCandles.slice(-50);
                
                var lookbackBase = lookbackChange[0];
                var basePrice = 0;
                if(candle.close > lookbackBase.close){
                    basePrice = lookbackBase.candleData?.side == 'bull' ? lookbackBase.open : lookbackBase.close;
                }else{
                    basePrice = lookbackBase.candleData?.side == 'bear' ? lookbackBase.close : lookbackBase.open;
                }

                var lookbackChangePercentage = ((candle.close - basePrice) / basePrice) * 100

                candle.candleData.lookbackChangePercentage = lookbackChangePercentage;

                var trendDirection = this.getTrendDirection(movingCandles.slice(-25).filter(c => c.candleData).map(c => c.candleData!.lookbackChangePercentage), lookbackChangePercentage)

                candle.candleData.lookbackTrend = trendDirection;
                
                if(prevCandle.status == "OPEN"){

                    var _estimatedPnlPercentage = 0
                    var _estimatedPnl = 0

                    if(openPosition && openPosition.side == "LONG"){
                        openPosition.duration = (candle.closeTime - openPosition.openTime) / (1000 * 60)

                        if(candle.low < openPosition.slPrice && candle.high > openPosition.tpPrice){
                            candle.status = "LONG_MID"
                            openPosition.status = "MID"

                            openPosition = null

                        } else if(candle.low < openPosition.slPrice){
                            candle.status = "LONG_LOSS"
                            openPosition.status = "LOSS"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.slPrice, "BUY", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else if(candle.high > openPosition.tpPrice){
                            candle.status = "LONG_WON"
                            openPosition.status = "WON"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.tpPrice, "BUY", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else{
                            candle.status = "OPEN"

                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,candle.close, "BUY", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;
                        }

                    }else if(openPosition && openPosition.side == "SHORT"){
                        openPosition.duration = (candle.closeTime - openPosition.openTime) / (1000 * 60)

                        if(candle.high > openPosition.slPrice && candle.low < openPosition.tpPrice){
                            candle.status = "SHORT_MID"
                            openPosition.status = "MID"

                            openPosition = null
                        }
                        else if(candle.high > openPosition.slPrice){
                            candle.status = "SHORT_LOSS"
                            openPosition.status = "LOSS"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.slPrice, "SELL", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;
                            

                            openPosition = null
                        }else if (candle.low < openPosition.tpPrice){
                            candle.status = "SHORT_WON"
                            openPosition.status = "WON"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.tpPrice, "SELL", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else{
                            candle.status = "OPEN"

                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,candle.close, "SELL", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(openPosition.margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;
                        }
                    }
                }else {
                    if(prevCandle.resistance 
                        && prevCandle.support
                        && prevCandle.priceZone  
                        && prevCandle.overboughSoldAnalysis
                        && prevCandle.volumeAnalysis
                        && prevCandle.candleData
                        && candle.candleData
                        && candle.support
                        && candle.resistance 
                        && candle.priceZone){


                        var closeAbsDistanceToMid = Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100)
                        var closeAbsDistanceToUpper = Math.abs(((candle.close - candle.priceZone.upper) / candle.priceZone.upper) * 100)
                        var closeAbsDistanceToLower = Math.abs(((candle.close - candle.priceZone.lower) / candle.priceZone.lower) * 100)
                        var closeAbseDistanceToEma200 = Math.abs(((candle.close - candle.candleData.ema200) / candle.candleData.ema200) * 100)

                        var priceZoneInhabitantCount = movingCandles.slice(-24).filter(c => c.priceZone && c.priceZone == candle.priceZone).length
                        var priceZones = movingCandles.filter(c => c.candleData && c.candleData.isNewZone ).map(c => c.priceZone);
                        

                        var lowerZoneEqualizerPrice = (candle.priceZone.lower + candle.priceZone.mid) / 2
                        var upperZoneEqualizerPrice = (candle.priceZone.upper + candle.priceZone.mid) / 2

                        lowerZoneEqualizerPrice = lowerZoneEqualizerPrice - (lowerZoneEqualizerPrice * 0.0005)
                        upperZoneEqualizerPrice = upperZoneEqualizerPrice - (upperZoneEqualizerPrice * 0.0005)


                        // if(candle.patternTrack == "hl"){
                        //     var previousPatternTracks = movingCandles.filter(c => c.openTime < candle.openTime && c.patternTrack != "");
                        //     if(previousPatternTracks.length >= 2){
                        //         var lastPatternTrack = previousPatternTracks[previousPatternTracks.length - 1].patternTrack;
                        //         if(lastPatternTrack == "lh"){
                        //             if(closeAbsDistanceToUpper > 1
                        //                 && candle.close < candle.priceZone.upper
                        //             ){
                        //                 candle.side = "LONG"
                        //                 candle.tpPrice = candle.priceZone.upper

                        //                 if(candle.candleData.zoneSizePercentage > 20 && candle.close < upperZoneEqualizerPrice){
                        //                     candle.tpPrice = upperZoneEqualizerPrice
                        //                 }

                        //                 if(candle.close < candle.priceZone.lower && candle.open < candle.priceZone.lower && candle.candleData.zoneSizePercentage > 8){
                        //                     candle.tpPrice = candle.priceZone.mid - (atr * 0.3)
                        //                 }

                        //                 if(candle.close < candle.priceZone.lower && candle.open < candle.priceZone.lower && candle.candleData.zoneSizePercentage < 3){
                        //                     candle.tpPrice = candle.priceZone.mid - (atr * 0.3)
                        //                 }

                        //                 if(candle.close < candle.priceZone.lower && candle.open < candle.priceZone.lower && candle.candleData.zoneSizePercentage < 2 && closeAbsDistanceToLower > 2.5){
                        //                     candle.tpPrice = candle.close + (atr * 3)
                        //                 }

                        //                 candle.slPrice = candle.open - (atr * 2.5)

                        //                 if(candle.open < candle.priceZone.mid && candle.open > candle.priceZone.lower && candle.candleData.zoneSizePercentage < 4){
                        //                     candle.slPrice = candle.priceZone.lower - (atr * 2.5)
                        //                 }
                        //             }
                        //         }
                        //     }
                        // }

                        /*
                        ======================================
                        ========CRAZY CANDLE CHANGES==========
                        ======================================
                        */

                        var xPastCandles = movingCandles.slice(-5);
                        var lowestOpen = Math.min(...xPastCandles.map(c => c.open))
                        var highestClose = Math.max(...xPastCandles.map(c => c.close))

                        var highestLowestChangeDiff = ((highestClose - lowestOpen) / lowestOpen) * 100
                        candle.candleData.extraInfo = highestLowestChangeDiff.toString()
                        if(highestLowestChangeDiff > 20
                            && movingCandles.slice(-20).filter(c => c.candleData && c.candleData.conditionMet == "SHORT_CRAZY").length == 0
                            && candle.close > candle.priceZone.upper
                            && xPastCandles.filter(c => c.priceZone && c.open > candle.priceZone!.upper).length >= 3
                        ) {
                            candle.candleData.conditionMet = "SHORT_CRAZY_1"
                            candle.side = "SHORT"
                            candle.margin = margin * 3
                            candle.tpPrice = candle.close - (atr * 3)
                            candle.slPrice = Math.max(...xPastCandles.map(c => c.high)) + (atr * 0.3)
                        }

                        if(candle.candleData.change_percentage_v < -30 && candle.candleData.change_percentage_v > -50){
                            candle.candleData.conditionMet = "LONG_CRAZY_1"
                            candle.side = "LONG"
                            candle.margin = margin * 3
                            candle.tpPrice = candle.close + (atr * 1.5)
                            candle.slPrice = candle.low
                        }

                        if(candle.candleData.change_percentage_v < -50){
                            candle.candleData.conditionMet = "SHORT_CRAZY_2"
                            candle.side = "SHORT"
                            candle.margin = margin * 3
                            candle.tpPrice = candle.close - (atr)
                            candle.slPrice = candle.close + atr
                        }

                        if(movingCandles.slice(-24).filter(c => c.openTime < candle.openTime && c.candleData && Math.abs(c.candleData.change_percentage_v) < 2 ).length >= 20
                            && movingCandles.slice(-24).filter(c => c.openTime < candle.openTime && c.candleData && c.candleData.volumeSpike).length < 3
                            && candle.candleData.change_percentage_v > 15
                        ){
                            if(movingCandles.slice(-24).filter(c => c.openTime < candle.openTime && c.volumeAnalysis && c.volumeAnalysis.zScore >= 3).length <= 1){
                                
                                candle.tpPrice = candle.close + (atr * 1.5)
                                candle.slPrice = candle.high - (atr * 2.5)
                                
                                if(candle.slPrice < candle.close){
                                    candle.candleData.conditionMet = "LONG_CRAZY_2"
                                    candle.side = "LONG"
                                    candle.margin = margin * 3
                                }else{
                                    candle.tpPrice = 0
                                    candle.slPrice = 0
                                }
                            }else{
                                candle.candleData.conditionMet = "SHORT_CRAZY_3"
                                candle.side = "SHORT"
                                candle.margin = margin * 3
                                candle.tpPrice = candle.close - (atr * 2.5)
                                candle.slPrice = candle.high + (atr * 0.5)
                            }
                        }

                        if(movingCandles.slice(-5).filter(c => c.candleData && c.candleData.side == "bull").length == 5
                        && movingCandles.slice(-5).filter(c => c.candleData && c.candleData.side == "bull" && c.overboughSoldAnalysis && c.overboughSoldAnalysis.extremeLevel == "overbought").length >= 4
                        && movingCandles.slice(-5).filter(c => c.candleData && c.candleData.side == "bull" && c.candleData.volumeSpike).length >= 4
                        && highestLowestChangeDiff > 10
                        ){
                            candle.candleData.conditionMet = "SHORT_CRAZY_4"
                            candle.side = "SHORT"
                            candle.margin = margin * 3
                            candle.tpPrice = candle.close - (atr * 2)
                            candle.slPrice = Math.max(...xPastCandles.map(c => c.high)) + (atr)
                        }

                        if(supportCandle.candleData && supportCandle.candleData.change_percentage_v > 1
                            && prevCandle.candleData.top_wick_v > 50
                            && prevCandle.candleData.change_percentage_v < 0.5
                            && prevCandle.candleData.side == "bull"
                            && candle.candleData.side == "bear"
                            && candle.close > supportCandle.open
                            && candle.candleData.change_percentage_v < -1
                            && supportCandle.open > candle.priceZone.upper
                            && movingCandles.slice(-15).filter(c => c.candleData && c.candleData.side == "bull").length >= 9
                            && movingCandles.slice(-10).filter(c => c.openTime < supportCandle.openTime && c.close > supportCandle.open).length == 0
                        ){
                            var _xPastCandles = movingCandles.slice(-15);
                            var _lowestOpen = Math.min(..._xPastCandles.map(c => c.open))
                            var _highestClose = Math.max(..._xPastCandles.map(c => c.close))

                            var _highestLowestChangeDiff = ((_highestClose - _lowestOpen) / _lowestOpen) * 100

                            if(_highestLowestChangeDiff > 10){
                                candle.candleData.isShortPotential = true

                                candle.candleData.conditionMet = "SHORT_CRAZY_5"
                                candle.side = "SHORT"
                                candle.margin = margin * 3
                                candle.tpPrice = candle.close - atr * 2
                                candle.slPrice = Math.max(supportCandle.high, prevCandle.high, candle.high) + (atr * 3)

                                candle.candleData.extraInfo = _highestLowestChangeDiff.toString()
                            }
                        }

                        if(candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        ){
                            var __xPastCandles = movingCandles.slice(-15);
                            var __lowestClose = Math.min(...__xPastCandles.map(c => c.close))
                            var __highestOpen = Math.max(...__xPastCandles.map(c => c.open))

                            var __highestLowestChangeDiff = ((__lowestClose - __highestOpen) / __highestOpen) * 100

                            if(__highestLowestChangeDiff < -6
                                && __xPastCandles.filter(c => c.openTime < candle.openTime && c.candleData && c.candleData.side == 'bear' && c.candleData.change_percentage_v < -0.5).length > 8
                                && candle.close < candle.priceZone.lower
                                && prevCandle.candleData.priceMove == "dragged_down"
                                && prevCandle.overboughSoldAnalysis.extremeLevel == "oversold"
                                && movingCandles.slice(-15).filter(c => c.priceZone && c.open < c.priceZone.lower && c.close < c.priceZone.lower).length >= 7
                               && prevCandle.candleData.volumeSpike
                                && candle.candleData.change_percentage_v > 2
                                && prevCandle.volumeAnalysis.zScore >= 3
                            ){
                                candle.candleData.conditionMet = "LONG_CRAZY_3"
                                candle.side = "LONG"
                                candle.margin = margin * 3
                                candle.tpPrice = candle.close + (atr * 1.8)
                                candle.slPrice = Math.min(prevCandle.low, candle.low) + (atr * 0.5)

                                candle.candleData.extraInfo = __highestLowestChangeDiff.toString()
                            }
                        }

                        if(candle.candleData.change_percentage_v < -22){
                            candle.candleData.conditionMet = "LONG_CRAZY_4"
                            candle.side = "LONG"
                            //candle.margin = margin * 3
                            candle.tpPrice = candle.close + (atr * 1.5)
                            candle.slPrice = candle.close - (atr * 0.3)
                        }


                        /*
                        ======================================
                        ========LONGS=========================
                        ======================================
                        */

                        var long1 = candle.breakthrough_resistance
                        && candle.close < candle.priceZone.mid
                        && movingCandles.slice(-24).filter(c => 
                            c.priceZone 
                            && c.close < c.priceZone.lower 
                            && c.breakthrough_support
                        ).length >= 4

                        if(long1){
                            var hasVolumePresenceBelowPriceZone = movingCandles.slice(-24).filter(c => 
                                c.openTime < candle.openTime 
                                && c.candleData 
                                && c.priceZone
                                && c.candleData.side == "bear"
                                && c.candleData.volumeSpike
                                && c.open < c.priceZone.lower
                                && c.close < c.priceZone.lower
                                && c.breakthrough_support
                            ).length >= 1

                            var earlyPhaseOfZone = priceZoneInhabitantCount < 10
                            var isFinalPhaseOfZoneAndGoodChange = priceZoneInhabitantCount > 15 && candle.candleData.change_percentage_v > 1.5
                            var presenceOfDojis = movingCandles.slice(-9).filter(c => {
                                c.openTime < candle.openTime 
                                && c.overboughSoldAnalysis
                                && c.overboughSoldAnalysis.extremeLevel == "oversold"
                            }).length == 0

                            if(hasVolumePresenceBelowPriceZone
                                //&& noPresenceOfOversold
                                && (earlyPhaseOfZone || isFinalPhaseOfZoneAndGoodChange)
                            ){
                                candle.candleData.isLongPotential = true;
                                candle.candleData.conditionMet = "LONG_1"

                                candle.side = "LONG"
                                candle.margin = margin * 1.5

                                candle.tpPrice = candle.priceZone.upper - (atr * 0.2)

                                if(candle.open > candle.priceZone.lower){
                                    candle.slPrice = candle.priceZone.lower - (atr)
                                }else{
                                    candle.slPrice = candle.open - (atr * 1.5)
                                }
                            }
                        }


                        /*
                        ======================================
                        ========SHORTS========================
                        ======================================
                        */

                        var short1 = candle.candleData.side == "bear"
                        && candle.candleData.change_percentage_v <= -1.5
                        && candle.close > candle.priceZone.upper
                        && candle.close_atr_adjusted > candle.priceZone.mid
                        && closeAbsDistanceToUpper > 5
                        && movingCandles.slice(-6).filter(c => c.openTime < candle.openTime && c.close_atr_abs_change > 2).length >= 3

                        var short2 = candle.candleData.side == "bear"
                        && candle.close_atr_adjusted > candle.priceZone.mid
                        && candle.close_atr_abs_change > 2
                        && priceZoneInhabitantCount < 6
                        && candle.open < candle.priceZone.upper
                        && candle.candleData.change_percentage_v < -1

                        if(short1){
                            var past5TouchesOrCloseNearTheZoneUpper = movingCandles.slice(-6).filter(c => (c.priceZone && c.low < c.priceZone.upper) || (c.closeAbsDistanceToZone && c.closeAbsDistanceToZone.upper < 1)).length >= 1
                            var hasBuyPressure = movingCandles.slice(-24).filter(c => c.candleData && c.candleData.side == "bull" && c.candleData.volumeSpike && c.breakthrough_resistance).length >= 5


                            if(!hasBuyPressure){
                                candle.candleData.isShortPotential = true;
                                candle.candleData.conditionMet = "SHORT_1";

                                candle.side = "SHORT";
                                

                                candle.margin = margin * 1.5
                                candle.tpPrice = candle.close - (atr * 1)

                                if(past5TouchesOrCloseNearTheZoneUpper && candle.tpPrice > candle.priceZone.upper){
                                    candle.tpPrice = candle.priceZone.upper
                                }
                                
                                candle.slPrice = candle.open + (atr * 6)
                            }
                        }else if(short2){
                            if(priceZones.length >= 2){
                                var previousZone = priceZones[priceZones.length - 2]
                                var previousZoneDoesntTouchMid = movingCandles.filter(c => 
                                    c.priceZone == previousZone 
                                    && c.priceZone
                                    && c.close > c.priceZone.mid
                                    && c.open > c.priceZone.mid
                                ).length == 24

                                var hasStrongVolumePush = movingCandles.slice(-24).filter(c => 
                                    c.openTime < candle.openTime
                                    && c.candleData
                                    && c.candleData.volumeSpike
                                    && c.breakthrough_resistance
                                ).length >= 5

                                var fewerVolumeSpikes = movingCandles.slice(-24).filter(c => 
                                    c.openTime < candle.openTime
                                    && c.candleData
                                    && c.candleData.volumeSpike
                                ).length <= 3

                                var fewerResistanceBreaks = movingCandles.slice(-24).filter(c => 
                                    c.openTime < candle.openTime
                                    && c.candleData
                                    && c.breakthrough_resistance
                                ).length <= 3

                                var mostCandlesAboveZone = movingCandles.slice(-24).filter(c => 
                                    c.priceZone == previousZone 
                                    && c.priceZone
                                    && c.close > c.priceZone.upper
                                ).length > 14
                                
                                if(//previousZoneDoesntTouchMid 
                                //     && !hasStrongVolumePush
                                    fewerResistanceBreaks
                                    && mostCandlesAboveZone
                                ){
                                    candle.candleData.isShortPotential = true;
                                    candle.candleData.conditionMet = "SHORT_2";

                                    candle.side = "SHORT";
                                    
                                    candle.margin = margin * 1.5
                                    candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.3)
                                    candle.slPrice = candle.priceZone.upper + (atr * 6)
                                }
                            }
                        }

                        //end
                    }


                    //======================================================================
                    if (!openPosition) {
                        if(candle.side != ""){
                            candle.status = 'OPEN'   
                            openPosition = candle;

                            _side = candle.side == "LONG" ? "BUY" : "SELL";

                            if(candle.margin == 0){
                                candle.margin = margin
                            }

                            if(candle.tpPrice == 0){
                                var tpSl = await OrderMakerUtility.calculateTpSl(candle.margin, symbol,_side,candle.close.toString(),targetTpRoi,targetSlRoi);
                                candle.tpPrice = tpSl.tp_price

                                if(candle.slPrice == 0){
                                    candle.slPrice = tpSl.sl_price
                                }
                            }

                            candle.leverage = _maxLeverage
                            candle.entryFee = PnlUtility.calculateTakerFee(candle.margin,_maxLeverage)

                            var estimatedTpPnlPercentage = PnlUtility.calculatePNLPercent(candle.close,candle.tpPrice, _side, _maxLeverage);
                            var estimatedTpPnl = PnlUtility.calculateEstimatedPnl(candle.margin,estimatedTpPnlPercentage, _maxLeverage);

                            var estimatedSlPnlPercentage = PnlUtility.calculatePNLPercent(candle.close,candle.slPrice, _side, _maxLeverage);
                            var estimatedSlPnl = PnlUtility.calculateEstimatedPnl(candle.margin,estimatedSlPnlPercentage, _maxLeverage);

                            var trapSlPnl = -(candle.margin * 3)

                            //candle.candleData.extraInfo = estimatedSlPnl.toString();
                            
                            // if(estimatedSlPnl < trapSlPnl
                            //    //|| estimatedSlPnl < -20
                            // ){
                            //     candle.status = ''
                            //     candle.side = "";
                            //     candle.tpPrice = 0;
                            //     candle.slPrice = 0;
                            //     candle.leverage = 0;
                            //     candle.entryFee = 0;
                            //     candle.margin = 0;
                            //     candle.candleData.conditionMet = "IGNORED"
                            //     openPosition = null
                                
                            // }
                        }
                    }
                }
            }
        }
    }

    static getTrendDirection(
        lookbackChanges: number[], // last 20-30 lookback values
        currentChange: number
        ) {
        // Calculate standard deviation of lookback changes
        const mean = lookbackChanges.reduce((a, b) => a + b, 0) / lookbackChanges.length;
        const variance = lookbackChanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lookbackChanges.length;
        const stdDev = Math.sqrt(variance);

        // Thresholds based on standard deviation
        const strongThreshold = stdDev * 1.5;
        const mildThreshold = stdDev * 0.5;

        if (currentChange > strongThreshold) return 'strong_uptrend';
        if (currentChange > mildThreshold) return 'mild_uptrend';
        if (currentChange < -strongThreshold) return 'strong_downtrend';
        if (currentChange < -mildThreshold) return 'mild_downtrend';
        return 'ranging';
    }

    static isNewZonePeriod(timestamp: number, timezoneOffset?: number): boolean {
        // Convert timestamp (ms) to Date
        const date = new Date(timestamp);
        
        // Get hour in local time (or apply custom timezone offset if provided)
        let hour: number;
        
        if (timezoneOffset !== undefined) {
            // Apply custom timezone offset (in hours)
            const utcHour = date.getUTCHours();
            hour = (utcHour + timezoneOffset + 24) % 24;
        } else {
            // Use browser's local time
            hour = date.getHours();
        }
        
        const minutes = date.getMinutes();
        
        // Zone boundaries (in local hours): 0, 6, 12, 18
        const zoneBoundaries = [0, 6, 12, 18];
        
        // Check if we're at the start of a new zone (hour matches boundary and minutes are 0)
        return zoneBoundaries.includes(hour) && minutes === 0;
    }

    static checkProximity(
        side: string,
        close: number,
        upper: number,
        lower: number,
        candles: CandleEntry[]
    ): 'CLOSE' | 'FAR' {
        // Calculate volatility from the candles (ATR-like measure)
        const candle_range = candles.map(c => c.high - c.low)
        const avgRange = candle_range.reduce((a, b) => a + b, 0) / candle_range.length
        
        // Zone height
        const zoneHeight = upper - lower
        
        // Dynamic threshold based on volatility
        // Higher volatility = wider proximity threshold
        const volatilityRatio = avgRange / zoneHeight
        const proximityThreshold = Math.max(5, Math.min(20, volatilityRatio * 100))

        if (side === 'LONG') {
            // For LONG, we care about distance to upper (TP)
            const distanceToUpper = upper - close
            const percentDistance = (distanceToUpper / zoneHeight) * 100
            return percentDistance <= proximityThreshold ? 'CLOSE' : 'FAR'
        } else {
            // For SHORT, we care about distance to lower (TP)
            const distanceToLower = close - lower
            const percentDistance = (distanceToLower / zoneHeight) * 100
            return percentDistance <= proximityThreshold ? 'CLOSE' : 'FAR'
        }
    }

    static checkAtrVolatility(candles: CandleEntry[]): 'NEUTRAL' | 'AWAKE' {
        // Find candles in current zone (not ZONE_START)
        const zoneCandles = candles.filter(c => c.status !== 'ZONE_START' && c.priceZone)
        
        if (zoneCandles.length < 2) {
            return 'NEUTRAL' // Not enough data
        }

        // Get ATR values from zone candles
        const atrValues = zoneCandles
            .map(c => c.candleData?.atr)
            .filter(atr => atr !== undefined && atr !== null) as number[]

        if (atrValues.length < 2) {
            return 'NEUTRAL'
        }

        // Calculate ATR change percentage
        const firstAtr = atrValues[0]
        const lastAtr = atrValues[atrValues.length - 1]
        const atrChangePercent = ((lastAtr - firstAtr) / firstAtr) * 100

        // Analyze price position within zone
        const zonePrice = zoneCandles[zoneCandles.length - 1]
        const priceZone = zonePrice.priceZone!
        const zoneHeight = priceZone.upper - priceZone.lower

        // Check if all recent prices stayed within zone
        const allPricesInZone = zoneCandles.every(c => 
            c.close >= priceZone.lower && c.close <= priceZone.upper
        )

        // Volatility is AWAKE if:
        // 1. ATR increased significantly (>15%) OR
        // 2. ATR is expanding AND price broke zone
        const volatilityExpanding = atrChangePercent > 15
        const priceBreakingOut = !allPricesInZone

        // If ATR expanding with breakout = AWAKE
        if (volatilityExpanding && priceBreakingOut) {
            return 'AWAKE'
        }

        // If ATR contracting AND price contained = NEUTRAL
        if (atrChangePercent < -10 && allPricesInZone) {
            return 'NEUTRAL'
        }

        // Mixed signals: check recent momentum
        const recentAtrs = atrValues.slice(-5) // Last 5 ATRs
        const greenCount = recentAtrs.filter((atr, i) => 
            i > 0 && atr > recentAtrs[i - 1]
        ).length

        // If more than 50% of recent candles show increasing ATR = AWAKE
        return greenCount > recentAtrs.length / 2 ? 'AWAKE' : 'NEUTRAL'
    }

}