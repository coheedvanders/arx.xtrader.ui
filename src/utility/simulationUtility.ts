import type { Candle, CandleEntry, PriceZone } from "@/core/interfaces";
import { candleAnalyzer } from "./candleAnalyzerUtility";
import { OrderMakerUtility } from "./OrderMakerUtility.ts";
import { KlineUtility } from "./klineUtility.ts";
import { klineDbUtility } from "./klineDbUtility.ts";
import { PriceZoneUtility } from "./priceZoneUtility.ts";
import { PnlUtility } from "./PnlUtility.ts";
import CandleEntryVisualizerComponent from "@/components/mint/CandleEntryVisualizerComponent.vue";

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
            zoneSizePercentage: 0
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
                }else{
                    if(
                        prevCandle.resistance 
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
                        var priceZones = movingCandles.filter(c => c.candleData && c.candleData.isNewZone );
                        

                        var lowerZoneEqualizerPrice = (candle.priceZone.lower + candle.priceZone.mid) / 2
                        var upperZoneEqualizerPrice = (candle.priceZone.upper + candle.priceZone.mid) / 2

                        lowerZoneEqualizerPrice = lowerZoneEqualizerPrice - (lowerZoneEqualizerPrice * 0.0005)
                        upperZoneEqualizerPrice = upperZoneEqualizerPrice - (upperZoneEqualizerPrice * 0.0005)

                        //LONG POSITION
                        var longEntry1 = prevCandle.close < prevCandle.priceZone.mid
                        && prevCandle.close > prevCandle.priceZone.lower
                        && prevCandle.open < prevCandle.priceZone.lower
                        && prevCandle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && closeAbsDistanceToMid > 1
                        && prevCandle.close < lowerZoneEqualizerPrice
                        && prevCandle.candleData.zoneSizePercentage > 3
                        && prevCandle.high < prevCandle.resistance.upper
                        //&& candle.candleData.zoneSizePercentage < 10
                        //&& movingCandles.slice(-8).filter(c => c.close < lowerZoneEqualizerPrice).length >= 6
                        //&& movingCandles.slice(-6).filter(c => c.breakthrough_support).length == 0
                        // && movingCandles.filter(c => c.priceZone == candle.priceZone && c.overboughSoldAnalysis && c.overboughSoldAnalysis.extremeLevel == "overbought").length == 1
                        && prevCandle.candleData.change_percentage_v > 1
                        //&& candle.candleData.strength_v > 70

                        var longEntry0 = candle.close < candle.priceZone.mid
                        && candle.close > candle.priceZone.lower
                        && candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && closeAbsDistanceToMid > 1
                        && candle.close < lowerZoneEqualizerPrice
                        && candle.high < candle.resistance.upper


                        //USE WHEN BALANCE IS > 500
                        var longEntry2 = candle.close < candle.priceZone.mid
                        && candle.high < candle.priceZone.mid
                        && candle.candleData.spaceTakenInZoneLevel > 50
                        && candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && priceZoneInhabitantCount > 10

                        var longEntry3 = movingCandles.slice(-3).filter(c => 
                            c.openTime < candle.openTime 
                            && c.candleData 
                            && c.candleData.priceMove == "dragged_down" 
                            && c.overboughSoldAnalysis 
                            && c.overboughSoldAnalysis.extremeLevel == "oversold" 
                            && c.priceZone 
                            && c.close < c.priceZone?.lower
                            && c.candleData.change_percentage_v > -4
                        ).length == 2
                        && candle.candleData.side == "bull"
                        && candle.close < candle.priceZone.mid
                        && candle.candleData.change_percentage_v >= 0.2

                        var longEntry4 = prevCandle.close > prevCandle.candleData.ema200
                        && prevCandle.open < prevCandle.candleData.ema200
                        && prevCandle.close > prevCandle.priceZone.upper
                        && prevCandle.priceZone.upper < prevCandle.candleData.ema200
                        && prevCandle.breakthrough_resistance

                        var longEntry5 = prevCandle.candleData.priceMove == "dragged_down"
                        && prevCandle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.close > candle.candleData.ema200
                        && candle.open < candle.candleData.ema200
                        && priceZoneInhabitantCount > 18

                        var longEntry6 = candle.close > candle.candleData.ema200
                        && candle.open < candle.candleData.ema200
                        && candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && candle.candleData.volumeSpike
                        && candle.volumeAnalysis.zScore >= 3
                        && candle.candleData.strength_v >= 55
                        && closeAbseDistanceToEma200 < 2
                        && movingCandles.slice(-24).filter(c => 
                            c.openTime < candle.openTime 
                            && c.candleData 
                            && c.close < c.candleData.ema200
                        ).length > 20
                        && movingCandles.slice(-6).filter(c => 
                            c.openTime < candle.openTime 
                            && c.candleData 
                            && c.priceZone
                            && c.candleData.side == "bull"
                            && c.low > c.priceZone.upper
                        ).length >= 4

                        var longEntry8 = candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && candle.close < candle.priceZone.lower
                        && candle.open < candle.priceZone.lower
                        && Math.abs(candle.candleData.change_percentage_v) > 0.5
                        && movingCandles.slice(-30).filter(c => 
                            c.priceZone 
                            && c.openTime < candle.openTime 
                            && c.breakthrough_support
                        ).length >= 10

                        var longEntry9 = candle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && candle.candleData.zoneSizePercentage < 3
                        && candle.close < candle.priceZone.lower
                        && candle.candleData.strength_v > 60
                        && closeAbsDistanceToLower > 1
                        && movingCandles.slice(-5).filter(c => 
                            c.candleData 
                            && c.volumeAnalysis
                            && c.overboughSoldAnalysis
                            && c.candleData.priceMove == "dragged_down"
                            && c.candleData.volumeSpike
                            && c.volumeAnalysis.zScore >= 3
                            && c.overboughSoldAnalysis.extremeLevel == "oversold"
                        ).length >= 1

                        var longEntry10 = candle.candleData.isNewZone
                        && movingCandles.filter(c => c.priceZone 
                            && c.priceZone == prevCandle.priceZone
                            && c.open < c.priceZone.mid
                            && c.close < c.priceZone.mid
                        ).length >= 18
                        && movingCandles.slice(-6).filter(c => c.priceZone 
                            && c.priceZone == prevCandle.priceZone
                            && c.open > c.priceZone.mid
                        ).length == 0
                        && candle.close > candle.priceZone.mid
                        && candle.open > candle.priceZone.mid
                        && candle.candleData.side == "bear"
                        && closeAbsDistanceToUpper > 3
                        && closeAbsDistanceToMid > 1
                        && candle.candleData.spaceTakenInZoneLevel < 50
                        && Math.abs(candle.candleData.change_percentage_v) > 1
                        && candle.priceZone.mid < candle.candleData.ema200
                        && candle.candleData.zoneSizePercentage > 5


                        if(longEntry0){
                            if(priceZones.length >= 2){
                                var prevPriceZone = priceZones[priceZones.length - 2];
                                var lowDiffPercentage = ((activePriceZone!.lower - prevPriceZone.priceZone!.lower) / prevPriceZone.priceZone!.lower) * 100
                                if(lowDiffPercentage < -3
                                    && candle.candleData.spaceTakenInZoneLevel > 45
                                    && candle.candleData.change_percentage_v > 3
                                    && candle.candleData.zoneSizePercentage > 15
                                    && prevCandle.candleData.zoneSizePercentage > 3
                                ){
                                    candle.candleData.isLongPotential = true
                                    candle.candleData.conditionMet = "LONG_0"

                                    candle.side = "LONG"
                                    candle.margin = margin * 3
                                    candle.slPrice = candle.open - (atr * 0.5)
                                    candle.tpPrice = candle.priceZone.mid
                                }
                            }
                        }


                        if(longEntry1){
                            if(priceZones.length >= 2){
                                // var prevPriceZone = priceZones[priceZones.length - 2];
                                // if(prevPriceZone.priceZone!.mid > activePriceZone!.mid
                                //     && prevPriceZone.priceZone!.upper > activePriceZone!.upper
                                //     && candle.candleData.side == 'bull'
                                //     && prevCandle.candleData.strength_v > 80
                                //     && !prevCandle.candleData.volumeSpike
                                // ){
                                //     candle.candleData.isLongPotential = true
                                //     candle.candleData.conditionMet = "LONG_1"

                                    
                                //     candle.margin = margin * 2
                                //     candle.slPrice = candle.support.lower - (atr)

                                //     if(candle.close > candle.priceZone.mid && candle.close < candle.priceZone.upper){
                                //         candle.side = "LONG"
                                //         candle.tpPrice = candle.priceZone.upper
                                //     }else if(candle.close < candle.priceZone.mid){
                                //         if(candle.candleData.zoneSizePercentage > 10){
                                //             candle.side = "LONG"
                                //             candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.2)
                                //         }else{
                                //             candle.side = "LONG"
                                //             candle.tpPrice = candle.priceZone.upper
                                //         }
                                //     }
                                // }
                            }
                            else{
                                // if(candle.candleData.change_percentage_v > 90){
                                //     candle.candleData.isLongPotential = true
                                //     candle.candleData.conditionMet = "LONG_1"

                                //     candle.side = "LONG"
                                //     candle.slPrice = candle.support.lower - (atr)
                                //     candle.tpPrice = candle.priceZone.mid
                                // }
                            }
                        } else if(longEntry2){
                            // candle.candleData.isLongPotential = true
                            // candle.candleData.conditionMet = "LONG_2"

                            // candle.side = "LONG"
                            // candle.slPrice = candle.support.lower - (atr)
                            // candle.tpPrice = candle.priceZone.upper
                        } else if(longEntry3){
                            candle.candleData.isLongPotential = true
                            candle.candleData.conditionMet = "LONG_3"
                        } else if(longEntry4){
                            // if(priceZones.length >= 2){
                            //     var prevPriceZone = priceZones[priceZones.length - 2];
                            //     var isPrevPriceZoneEmaInUpperZone = movingCandles
                            //     .filter(c => 
                            //         c.priceZone == prevPriceZone.priceZone 
                            //         && c.candleData 
                            //         && c.priceZone 
                            //         && c.candleData.ema200 < c.priceZone.upper 
                            //         && c.candleData.ema200 > c.priceZone.mid
                            //     ).length > 15

                            //     if(isPrevPriceZoneEmaInUpperZone 
                            //         && candle.close > candle.candleData.ema200
                            //         && candle.candleData.side == "bull"
                            //         && Math.abs(candle.candleData.change_percentage_v) > 1
                            //     ){
                            //         candle.candleData.isLongPotential = true
                            //         candle.candleData.conditionMet = "LONG_4"

                            //         candle.side = "LONG"
                            //         candle.margin = margin * 5
                            //         candle.slPrice = candle.priceZone.mid - (atr * 1.5)

                            //         //candle.tpPrice = candle.close + (atr * 1.5)
                            //     }else{
                            //         if(isPrevPriceZoneEmaInUpperZone 
                            //         && candle.close > candle.candleData.ema200
                            //         && candle.candleData.side == "bear"
                            //         && Math.abs(candle.candleData.change_percentage_v) > 5
                            //         && Math.abs(prevCandle.candleData.change_percentage_v) > 10){
                            //             candle.candleData.isLongPotential = true
                            //             candle.candleData.conditionMet = "LONG_SHORTFLIP_1"

                            //             candle.side = "SHORT"
                            //             candle.margin = margin * 5
                            //             candle.slPrice = prevCandle.high + (atr * 0.2)

                            //             candle.tpPrice = lowerZoneEqualizerPrice
                            //         }
                            //     }
                            // }
                        } else if(longEntry5){
                            // candle.candleData.isLongPotential = true
                            // candle.candleData.conditionMet = "LONG_5"

                            // candle.side = "LONG"
                            // candle.margin = margin * 2

                            // if(candle.candleData.ema200 > candle.priceZone.mid){
                            //     candle.slPrice = candle.priceZone.mid - (atr)
                            // }else{
                            //     candle.slPrice = candle.candleData.ema200 - (atr)
                            // }
                        } else if(longEntry6){
                            // candle.candleData.isLongPotential = true
                            // candle.candleData.conditionMet = "LONG_6"

                            // candle.side = "LONG"
                            // candle.margin = margin * 5
                            // candle.slPrice = candle.candleData.ema200 - (atr * 1.5)
                            // candle.tpPrice = candle.close + (atr * 2.5)
                        } else if(longEntry8){
                            candle.candleData.isLongPotential = true
                            candle.candleData.conditionMet = "LONG_8"
                            
                            candle.side = "LONG"
                            candle.margin = margin * 5
                            candle.slPrice = candle.open - (atr * 1.5)
                            candle.tpPrice = candle.close + (atr * 2.5)
                        }else if(longEntry9){
                            //GOOD RESULT! reserve this for high balance / maintenance margin
                            // candle.candleData.isLongPotential = true
                            // candle.candleData.conditionMet = "LONG_9"
                            
                            // candle.side = "LONG"
                            // candle.margin = margin * 3
                            // candle.slPrice = candle.open - (atr * 0.5)
                            // candle.tpPrice = lowerZoneEqualizerPrice
                        }else if(longEntry10){
                            candle.candleData.isLongPotential = true
                            candle.candleData.conditionMet = "LONG_10"
                            
                            candle.side = "LONG"
                            candle.margin = margin * 6
                            candle.slPrice = candle.priceZone.mid - (atr * 0.8)
                            candle.tpPrice = candle.priceZone.upper + (atr * 5)
                        }

                        if(prevCandle.candleData.conditionMet == "LONG_3"
                            && candle.candleData.side == 'bull'
                            && candle.close < upperZoneEqualizerPrice
                            && closeAbsDistanceToMid > 1
                        ){
                            candle.side = "LONG"
                            candle.margin = margin * 5
                            candle.slPrice = candle.support.lower - (atr * 0.5)
                            candle.tpPrice = upperZoneEqualizerPrice
                        }


                        //SHORT POSITION

                        var shortEntry1 = prevCandle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && prevCandle.close < prevCandle.priceZone.upper
                        && prevCandle.high > prevCandle.priceZone.upper
                        && prevCandle.candleData.volumeSpike
                        && prevCandle.candleData.priceMove == "shoots_up"
                        && prevCandle.breakthrough_resistance
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.close < prevCandle.resistance.upper
                        && candle.close > candle.priceZone.mid
                        && candle.close < candle.priceZone.upper
                        && candle.candleData.zoneSizePercentage > 3

                        var shortEntry2 = prevCandle.overboughSoldAnalysis.extremeLevel == "overbought"
                        && prevCandle.high > prevCandle.priceZone.upper
                        && prevCandle.close > prevCandle.priceZone.upper
                        && prevCandle.open < prevCandle.priceZone.upper
                        && prevCandle.candleData.volumeSpike
                        && prevCandle.volumeAnalysis.zScore >= 3
                        && prevCandle.breakthrough_resistance
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.close < prevCandle.resistance.upper
                        && candle.close > candle.priceZone.mid
                        && candle.close < candle.priceZone.upper
                        && candle.candleData.zoneSizePercentage > 2.5

                        pastCandleAverageChange = movingCandles.filter(c => c.openTime < prevCandle.openTime).slice(-20)
                        .map(c => c.candleData?.change_percentage_v ?? 0)
                        .map(Math.abs)
                        .reduce((sum, val) => sum + val, 0) / 20

                        var shortEntry4 = prevCandle.candleData.change_percentage_v > (pastCandleAverageChange * 3)
                        && prevCandle.candleData.strength_v < 80
                        && prevCandle.candleData.strength_v > 50
                        && prevCandle.candleData.volumeSpike
                        && prevCandle.close > candle.priceZone.upper
                        && prevCandle.open < candle.priceZone.upper
                        && candle.candleData.zoneSizePercentage > 2
                        && candle.candleData.side == "bear"
                        && candle.candleData.strength_v > 35
                        && candle.candleData.body_v > 10

                        var shortEntry5 = candle.close < candle.priceZone.lower
                        && candle.open < candle.priceZone.lower
                        && candle.open > candle.candleData.ema200
                        && candle.close < candle.candleData.ema200
                        && candle.breakthrough_support
                        && candle.candleData.side == 'bear'
                        && candle.candleData.volumeSpike
                        && candle.candleData.priceMove == "dragged_down"
                        && candle.volumeAnalysis.zScore >= 3
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && priceZoneInhabitantCount < 10

                        var shortEntry6 = prevCandle.close > prevCandle.priceZone.upper
                        && prevCandle.breakthrough_resistance
                        && prevCandle.resistance.upper > prevCandle.priceZone.upper
                        && prevCandle.open < prevCandle.priceZone.upper
                        && prevCandle.candleData.volumeSpike
                        && candle.close < candle.priceZone.upper
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.candleData.volumeSpike
                        && candle.candleData.priceMove == "dragged_down"

                        var shortEntry7 = candle.close < candle.candleData.ema200
                        && candle.open > candle.candleData.ema200
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"

                        var shortEntry8 = candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.close > candle.priceZone.upper
                        && closeAbsDistanceToUpper > 1
                        && candle.open > candle.priceZone.upper
                        && priceZoneInhabitantCount < 16
                        && movingCandles.slice(-30).filter(c => 
                            c.priceZone 
                            && c.openTime < candle.openTime 
                            && c.breakthrough_resistance
                        ).length >= 10
                        && movingCandles.slice(-30).filter(c => 
                            c.candleData
                            && c.candleData.side == 'bull'
                        ).length >= 20

                        var shortEntry9 = candle.close < prevCandle.resistance.upper
                        && candle.open > prevCandle.resistance.upper
                        && candle.close > candle.priceZone.upper
                        && candle.close > candle.priceZone.upper
                        && candle.candleData.change_percentage_v > -5
                        && closeAbsDistanceToUpper > 1
                        && candle.candleData.ema200 < candle.priceZone.upper
                        && candle.candleData.ema200 > candle.priceZone.mid
                        && movingCandles.slice(-8).filter(c => c.openTime < candle.openTime
                            && c.breakthrough_resistance
                        ).length >= 4
                        && movingCandles.slice(-8).filter(c => c.openTime < candle.openTime
                            && c.overboughSoldAnalysis
                            && c.overboughSoldAnalysis.extremeLevel == "overbought"
                        ).length >= 3

                        var shortEntry10 = candle.breakthrough_support
                        && movingCandles.slice(-5).filter(c => c.openTime < candle.openTime && candle.breakthrough_support).length >= 2
                        && candle.close > candle.priceZone.upper
                        && candle.candleData.priceMove == "dragged_down"
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.candleData.ema200 < candle.priceZone.mid
                        && candle.candleData.ema200 > 0


                        var shortEntry11 = candle.breakthrough_support
                        && candle.high > candle.priceZone.lower
                        && candle.close < candle.priceZone.lower
                        && candle.candleData.priceMove == "dragged_down"
                        && candle.candleData.volumeSpike
                        && candle.overboughSoldAnalysis.extremeLevel == "oversold"
                        && candle.candleData.change_percentage_v < -1.4


                        if(shortEntry1){
                            candle.candleData.isShortPotential = true
                            candle.candleData.conditionMet = "SHORT_1"

                            candle.side = "SHORT"
                            candle.margin = margin
                            candle.slPrice = candle.priceZone.upper + (atr)
                            candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.2)
                        }else if(shortEntry2){
                            // candle.candleData.isShortPotential = true
                            // candle.candleData.conditionMet = "SHORT_2"

                            // candle.side = "SHORT"
                            // candle.margin = margin  * 5
                            // candle.slPrice = candle.priceZone.upper + (atr)
                            // candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.2)
                        }else if(shortEntry4){
                            // candle.candleData.isShortPotential = true
                            // candle.candleData.conditionMet = "SHORT_4"

                            // candle.side = "SHORT"
                            // candle.slPrice = candle.resistance.upper + (atr * 0.5)

                            // if(candle.close > candle.priceZone.upper){
                            //     candle.tpPrice = candle.priceZone.mid + (atr * 0.25)
                            // }else if(candle.close < candle.priceZone.upper && candle.close > candle.priceZone.mid){
                            //     candle.tpPrice = candle.priceZone.lower - atr
                            // }else{
                            //     candle.tpPrice = candle.close - atr
                            // }
                        }else if(shortEntry5){
                            if(priceZones.length >= 2){
                                var prevPriceZone = priceZones[priceZones.length - 2];
                                var isPrevPriceZoneEmaInLowerZone = movingCandles
                                .filter(c => 
                                    c.priceZone == prevPriceZone.priceZone 
                                    && c.candleData 
                                    && c.priceZone 
                                    && c.candleData.ema200 < c.priceZone.mid 
                                    && c.candleData.ema200 > c.priceZone.lower
                                ).length > 15

                                if(isPrevPriceZoneEmaInLowerZone){
                                    candle.candleData.isLongPotential = true
                                    candle.candleData.conditionMet = "SHORT_5"

                                    candle.side = "SHORT"
                                    candle.margin = margin * 5
                                    candle.slPrice = candle.candleData.ema200 + (atr * 0.5)
                                }
                            }
                        }else if(shortEntry6){
                            var closeAbsDistanceToLower = Math.abs(((candle.close - candle.priceZone.lower) / candle.priceZone.lower) * 100)
                            if(closeAbsDistanceToMid > 1 
                                && closeAbsDistanceToLower > 1
                                && candle.close > candle.priceZone.lower
                            ){
                                candle.candleData.isLongPotential = true
                                candle.candleData.conditionMet = "SHORT_6"

                                candle.side = "SHORT"
                                candle.margin = margin * 6
                                candle.slPrice = candle.high + (atr)
                                candle.tpPrice = candle.priceZone.lower
                            }
                        }else if(shortEntry7){
                            if(
                                candle.candleData.ema200 < lowerZoneEqualizerPrice
                            ){
                                candle.candleData.isLongPotential = true
                                candle.candleData.conditionMet = "SHORT_7"
                            }
                        }else if(shortEntry8){
                            candle.candleData.isShortPotential = true
                            candle.candleData.conditionMet = "SHORT_8"

                            candle.side = "SHORT"
                            candle.margin = margin  * 5
                            candle.slPrice = candle.open + (atr * 1)
                            candle.tpPrice = candle.priceZone.upper + (atr * 0.25)
                            candle.candleData.extraInfo = candle.candleData.zoneInhabitantCount.toString()
                        }else if(shortEntry9){
                            candle.candleData.isShortPotential = true
                            candle.candleData.conditionMet = "SHORT_9"

                            candle.side = "SHORT"
                            candle.margin = margin  * 5
                            candle.slPrice = candle.close + (atr * 1.5)
                            candle.tpPrice = candle.priceZone.lower
                        }

                        if(prevCandle.candleData.conditionMet == "SHORT_7"){
                            if(candle.candleData.side == "bull" 
                                && candle.close < candle.candleData.ema200
                                && candle.candleData.change_percentage_v > 1
                                && candle.high > candle.candleData.ema200
                            ){
                                candle.candleData.isLongPotential = true
                                candle.candleData.conditionMet = "SHORT_7_CONT"
                                candle.candleData.extraInfo = closeAbseDistanceToEma200.toString()
                            }
                        }else if(shortEntry10){
                            candle.candleData.isLongPotential = true;
                            candle.candleData.conditionMet = "SHORT_10"

                            candle.side = "SHORT"
                            candle.margin = margin * 4
                            candle.slPrice = candle.open + (atr);
                            candle.tpPrice = candle.priceZone.mid
                        }else if(shortEntry11){
                            if(priceZones.length >= 2){
                                var prevPriceZone11 = priceZones[priceZones.length - 2].priceZone!;
                                if(
                                    candle.priceZone.lower > prevPriceZone11.lower
                                ){
                                    candle.candleData.isLongPotential = true;
                                    candle.candleData.conditionMet = "SHORT_11"

                                    candle.side = "SHORT"
                                    candle.margin = margin * 1.5
                                    candle.slPrice = candle.close + (atr * 1.5);
                                    candle.tpPrice = candle.close - (atr * 2.3)
                                }
                            }
                        }

                        if(prevCandle.candleData.conditionMet == "SHORT_7_CONT"){
                            if(candle.close < candle.candleData.ema200){
                                candle.side = "SHORT"
                                candle.margin = margin * 5
                                candle.slPrice = candle.candleData.ema200 + (atr)
                                candle.tpPrice = prevCandle.close - (prevCandle.candleData.atr * 2.5)
                            }
                        }

                        if(priceZones.length >= 2){
                            var previousCandleZoneStart = priceZones[priceZones.length - 2];

                            if(previousCandleZoneStart.candleData 
                                && previousCandleZoneStart.candleData.zoneSizePercentage > 3 
                                && candle.candleData.zoneSizePercentage > previousCandleZoneStart.candleData.zoneSizePercentage
                            ){
                                var zoneSizeZScore = candle.candleData.zoneSizePercentage / previousCandleZoneStart.candleData.zoneSizePercentage
                                var midDistanceToEma200 = Math.abs(((candle.priceZone.mid - candle.candleData.ema200) / candle.candleData.ema200) * 100)
                                var highAbsDistanceToUpper = Math.abs(((candle.high - candle.priceZone.upper) / candle.priceZone.upper) * 100)
                                
                                if(candle.candleData.isNewZone 
                                    && zoneSizeZScore >= 3
                                    && candle.high > candle.priceZone.upper
                                    && candle.close < candle.priceZone.upper
                                    && candle.close > upperZoneEqualizerPrice
                                    && candle.candleData.side == "bull"
                                    //&& candle.candleData.zoneSizePercentage > 60
                                    && candle.priceZone.mid > candle.candleData.ema200
                                    && midDistanceToEma200 > 1.5
                                    && closeAbsDistanceToUpper > 0.5
                                    && candle.candleData.change_percentage_v > 1.5
                                    && highAbsDistanceToUpper > 0.5
                                ){
                                    candle.candleData.isShortPotential = true
                                    candle.candleData.conditionMet = "SHORT_3"

                                    candle.side = "SHORT"
                                    candle.margin = margin * 5
                                    candle.slPrice = candle.priceZone.upper + (atr * 0.5)

                                    candle.tpPrice = candle.priceZone.mid + (atr * 0.3)
                                    candle.candleData.extraInfo = highAbsDistanceToUpper.toString()
                                }
                            }
                        }

                        if(prevCandle.candleData.conditionMet == "SHORT_3"
                            && candle.candleData.side == "bear"
                            && candle.close > candle.priceZone.mid
                            && closeAbsDistanceToMid
                            && candle.high > candle.priceZone.upper
                        ){
                            
                        }

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

                            var trapSlPnl = -(candle.margin * 4)
                            if(
                                candle.candleData.conditionMet != "SHORT_1"
                            ){
                                if(
                                    (candle.candleData.conditionMet == "SHORT_8" && estimatedSlPnl < trapSlPnl)
                                    || (candle.candleData.conditionMet == "LONG_10" && estimatedSlPnl < trapSlPnl)
                                    || (candle.candleData.conditionMet == "SHORT_6" && estimatedSlPnl < trapSlPnl)
                                    || (candle.candleData.conditionMet == "SHORT_3" && estimatedSlPnl < trapSlPnl)
                                    || (
                                        candle.candleData.conditionMet != "SHORT_6"
                                        && Math.abs(estimatedSlPnl) > estimatedTpPnl
                                    )
                                    || (
                                        candle.candleData.conditionMet != "SHORT_10"
                                        && Math.abs(estimatedSlPnl) > estimatedTpPnl
                                    )
                                ){
                                    candle.side = "";
                                    candle.tpPrice = 0;
                                    candle.slPrice = 0;
                                    candle.leverage = 0;
                                    candle.entryFee = 0;
                                    candle.margin = 0;
                                    candle.candleData.conditionMet = "IGNORED"
                                }else{
                                    if(candle.candleData.conditionMet == "SHORT_9"){
                                        candle.tpPrice = candle.close - (atr * 2.5)
                                    }
                                }
                            }
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