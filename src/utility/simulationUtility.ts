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
                        var priceZoneInhabitantCount = movingCandles.slice(-24).filter(c => c.priceZone && c.priceZone == candle.priceZone).length
                        var priceZones = movingCandles.filter(c => c.candleData && c.candleData.isNewZone );
                        

                        var lowerZoneEqualizerPrice = (candle.priceZone.lower + candle.priceZone.mid) / 2
                        var upperZoneEqualizerPrice = (candle.priceZone.upper + candle.priceZone.mid) / 2

                        lowerZoneEqualizerPrice = lowerZoneEqualizerPrice - (lowerZoneEqualizerPrice * 0.0005)
                        upperZoneEqualizerPrice = upperZoneEqualizerPrice - (upperZoneEqualizerPrice * 0.0005)

                        //LONG POSITION
                        var longEntry1 = prevCandle.close < prevCandle.priceZone.mid
                        && prevCandle.close > prevCandle.priceZone.lower
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
                        ).length == 2
                        && candle.candleData.side == "bull"
                        && candle.close < candle.priceZone.mid

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
                                    candle.slPrice = candle.open - (atr * 0.2)
                                    candle.tpPrice = candle.priceZone.mid
                                }
                            }
                        }


                        if(longEntry1){
                            if(priceZones.length >= 2){
                                var prevPriceZone = priceZones[priceZones.length - 2];
                                if(prevPriceZone.priceZone!.mid > activePriceZone!.mid
                                    && prevPriceZone.priceZone!.upper > activePriceZone!.upper
                                    && candle.candleData.side == 'bull'
                                    && prevCandle.candleData.strength_v > 80
                                    && candle.close
                                ){
                                    candle.candleData.isLongPotential = true
                                    candle.candleData.conditionMet = "LONG_1"

                                    
                                    candle.margin = margin * 2
                                    candle.slPrice = candle.support.lower - (atr)

                                    if(candle.close > candle.priceZone.mid && candle.close < candle.priceZone.upper){
                                        candle.side = "LONG"
                                        candle.tpPrice = candle.priceZone.upper
                                    }else if(candle.close < candle.priceZone.mid){
                                        candle.side = "LONG"
                                        candle.tpPrice = candle.priceZone.mid
                                    }
                                }
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
                            // candle.candleData.conditionMet = "LONG_1"

                            // candle.side = "LONG"
                            // candle.slPrice = candle.support.lower - (atr)
                            // candle.tpPrice = candle.priceZone.upper
                        } else if(longEntry3){
                            // candle.candleData.isLongPotential = true
                            // candle.candleData.conditionMet = "LONG_3"

                            // candle.side = "LONG"
                            // candle.slPrice = candle.support.lower - (atr)
                            // candle.tpPrice = candle.priceZone.upper
                        } else if(longEntry4){
                            if(priceZones.length >= 2){
                                var prevPriceZone = priceZones[priceZones.length - 2];
                                var isPrevPriceZoneEmaInUpperZone = movingCandles
                                .filter(c => 
                                    c.priceZone == prevPriceZone.priceZone 
                                    && c.candleData 
                                    && c.priceZone 
                                    && c.candleData.ema200 < c.priceZone.upper 
                                    && c.candleData.ema200 > c.priceZone.mid
                                ).length > 15

                                if(isPrevPriceZoneEmaInUpperZone 
                                    && candle.close > candle.candleData.ema200
                                    && Math.abs(candle.candleData.change_percentage_v) > 1
                                ){
                                    candle.candleData.isLongPotential = true
                                    candle.candleData.conditionMet = "LONG_4"

                                    candle.side = "LONG"
                                    candle.margin = margin * 5
                                    candle.slPrice = candle.priceZone.mid - (atr)

                                    //candle.tpPrice = candle.close + (atr * 1.5)
                                }
                            }
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


                        if(shortEntry1){
                            candle.candleData.isShortPotential = true
                            candle.candleData.conditionMet = "SHORT_1"

                            candle.side = "SHORT"
                            candle.margin = margin  * 5
                            candle.slPrice = candle.priceZone.upper + (atr)
                            candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.2)
                        }else if(shortEntry2){
                            candle.candleData.isShortPotential = true
                            candle.candleData.conditionMet = "SHORT_2"

                            candle.side = "SHORT"
                            candle.margin = margin  * 5
                            candle.slPrice = candle.priceZone.upper + (atr)
                            candle.tpPrice = lowerZoneEqualizerPrice + (atr * 0.2)
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
                                    candle.slPrice = candle.candleData.ema200 + (atr)
                                }
                            }
                        }else if(shortEntry6){
                            if(closeAbsDistanceToMid > 1){
                                candle.candleData.isLongPotential = true
                                candle.candleData.conditionMet = "SHORT_5"

                                candle.side = "SHORT"
                                candle.margin = margin * 5
                                candle.slPrice = candle.high + (atr)
                                candle.tpPrice = candle.priceZone.lower
                            }
                        }

                        if(priceZones.length >= 2){
                            var previousCandleZoneStart = priceZones[priceZones.length - 2];

                            if(previousCandleZoneStart.candleData 
                                && previousCandleZoneStart.candleData.zoneSizePercentage > 3 
                                && candle.candleData.zoneSizePercentage > previousCandleZoneStart.candleData.zoneSizePercentage
                            ){
                                var zoneSizeZScore = candle.candleData.zoneSizePercentage / previousCandleZoneStart.candleData.zoneSizePercentage

                                
                                if(candle.candleData.isNewZone 
                                    && zoneSizeZScore >= 3
                                    && candle.high > candle.priceZone.upper
                                    && candle.close < candle.priceZone.upper
                                    && candle.close > upperZoneEqualizerPrice
                                    && candle.candleData.side == "bull"
                                    && candle.candleData.zoneSizePercentage > 60
                                ){
                                    candle.candleData.isShortPotential = true
                                    candle.candleData.conditionMet = "SHORT_3"

                                    candle.side = "SHORT"
                                    candle.margin = margin * 5
                                    candle.slPrice = candle.priceZone.upper + (atr * 1.5)
                                    candle.tpPrice = candle.priceZone.mid + (atr * 0.25)
                                }
                            }
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