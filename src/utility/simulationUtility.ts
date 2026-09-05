import type { Candle, CandleEntry, CloseAbsDistanceToZone, PriceZone, PriceZoneEvaluation } from "@/core/interfaces";
import { candleAnalyzer } from "./candleAnalyzerUtility";
import { OrderMakerUtility } from "./OrderMakerUtility.ts";
import { KlineUtility } from "./klineUtility.ts";
import { klineDbUtility } from "./klineDbUtility.ts";
import { PriceZoneUtility } from "./priceZoneUtility.ts";
import { PnlUtility } from "./PnlUtility.ts";
import { totalFlowForCandle, getDominantFlowMovement } from '@/utility/flowMovementDb.ts'
import { identifyMarketState } from '@/utility/marketState'
import { GetConfluenceState } from "@/utility/confluenceState.ts"
import { support } from "jszip";
import { analyzeFrvps } from "./analyzeFrvps.ts";

type TrendDirection = "uptrend" | "downtrend";
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
            patternTrack: "",
            isPoint: false,
            isWeakening: false
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
        startingTimeStamp:number,
        btcCandles: CandleEntry[]
    ){

        let openPosition: CandleEntry | null = null;
        var activePriceZone: PriceZone | null = null;
        var basePriceZonePoint: number | null = null;
        var zoneOpenTime = 0
        var pointZone: PriceZone | null = null;
        var pointCandle: CandleEntry | null = null;
        var pointZoneChangePercentageAbs = 0;
        var pointZoneOpenTime = 0;

        var pointBearCandle: CandleEntry | null = null;
        var lastAvwap: PriceZone | null = null;
        var lastVoAvWap: PriceZone | null = null;
        var lastBtcAvWap: PriceZone | null = null;
        var priceZoneAvWaps = new Map<number, PriceZone>();
        var movementPocAvwaps = new Map<number, PriceZone>();
        var volatilityRatioSpikes: CandleEntry[] | null = null;

        var highestAvwapBand = 0;
        var lowestAvwapBand = 0;


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

                // var zoneAnalysis = candleAnalyzer.analyzeZoneInteraction(
                //     _side,
                //     candle.close,
                //     movingCandles,
                //     candle.support,
                //     candle.resistance,
                //     20,  // check last 20 candles for interactions
                //     10,  // check last 10 for trend
                //     5,    // check last 5 for momentum
                //     50
                // );


                //var volumeAnalysis = candleAnalyzer.computeVolumeAnalysis(movingCandles,candle.close,20);
                //var overSoldBoughtAnalysis = candleAnalyzer.detectOverboughtOversold(volumeAnalysis, zoneAnalysis, candles)
                var candleData = candleAnalyzer.analyzeCandlestick(movingCandles,i,true,5);
                const pastVolumeAnalysis = candleAnalyzer.analyzePastVolumes(candles, i, 20);
                var atr = candleAnalyzer.calculateATR(movingCandles,8);
                // var pastCandleAverageChange = movingCandles.slice(-20)
                //         .map(c => c.candleData?.change_percentage_v ?? 0)
                //         .map(Math.abs)
                //         .reduce((sum, val) => sum + val, 0) / 20

                // candle.zoneAnalysis = zoneAnalysis;

                //candle.volumeAnalysis = volumeAnalysis;
                //candle.pastVolumeAnalysis = pastVolumeAnalysis;
                //candle.overboughSoldAnalysis = overSoldBoughtAnalysis;
                candle.candleData = candleData;
                candle.candleData.priceMove = candleAnalyzer.detectPriceMove(movingCandles, movingCandles.length - 1)
                candle.candleData.volumeSpike = candleAnalyzer.hasVolumeSpike(movingCandles,20);
                //candle.overboughSoldAnalysis.extremeLevel = candleAnalyzer.detectOverState(movingCandles,8);
                //candle.candleData.pastCandleAverageChange = pastCandleAverageChange
                candle.candleData.atr = atr;
                //candle.isWeakening = candleAnalyzer.isWeakening(movingCandles);
                candle.candleData.ema200 = candleAnalyzer.calculateEMA(movingCandles, 200);
                //candle.candleData.ma200 = candleAnalyzer.calculateMovingAverage(movingCandles, 200)!;
                //candle.candleData.ma100 = candleAnalyzer.calculateMovingAverage(movingCandles, 100)!;
                //candle.candleData.crossedEma = (candle.open < candle.candleData.ema200 && candle.close > candle.candleData.ema200) || (candle.open > candle.candleData.ema200 && candle.close < candle.candleData.ema200);
                //candle.candleData.buyerInterestRate = candleAnalyzer.buyerInterestScore(movingCandles,24);

                if(candle.symbol != "BTCUSDT"){
                    candle.candleData.btcProjectionCandle = candleAnalyzer.getBtcProjectionCandle(movingCandles,btcCandles.slice(0, i + 1));
                }
                
                if(candle.candleData.volumeSpike){
                    candle.candleData.isAvwapPoint = true
                }
                

                if(i >= 26){
                    candle.candleData.changePercentageZScore = candleAnalyzer.getCandleChangeZScore(movingCandles,50);
                }

                // candle.isPoint = candle.candleData 
                // && candle.volumeAnalysis 
                // && candle.overboughSoldAnalysis 
                // && (candle.overboughSoldAnalysis.extremeLevel == "overbought" || candle.overboughSoldAnalysis.extremeLevel == "oversold")
                // && candle.candleData.volumeSpike
                // && candle.volumeAnalysis.zScore >= 3
                // && (candle.candleData.priceMove == "dragged_down" || candle.candleData.priceMove == "shoots_up")
                // && candle.candleData.changePercentageZScore > 3

                // if(candle.candleData.changePercentageZScore > 3){
                //     pointCandle = candle;
                //     pointZoneChangePercentageAbs = Math.abs(candle.candleData.change_percentage_v);
                //     pointZoneOpenTime = candle.openTime;

                //     if(candle.candleData.side == "bull"){
                //         pointZone = {
                //             upper: candle.close,
                //             mid: 0,
                //             lower: candle.open
                //         }
                //     }else{
                //         pointZone = {
                //             upper: candle.open,
                //             mid: 0,
                //             lower: candle.close
                //         }
                //     }
                // }
                

                // var isHighlyVolatile = false;
                // if(movingCandles.length > 20){
                //     isHighlyVolatile = candleAnalyzer.isVolatilityExpanding(movingCandles.slice(-14).filter(c => c.candleData).map(c => c.candleData!.atr))
                // }

                if(candle.candleData.side == "bear"){
                    candle.close_atr_adjusted = candle.close - atr;
                }else if(candle.candleData.side == "bull"){
                    candle.close_atr_adjusted = candle.close + atr;
                }

                candle.close_atr_abs_change = Math.abs(((candle.close - candle.close_atr_adjusted) / candle.close_atr_adjusted) * 100)

                // if(candle.overboughSoldAnalysis.extremeLevel != ""){
                //     candle.candleData.pastZoneOverStatePriceReaction = candleAnalyzer.getPreviousSessionOverStatePriceReaction(movingCandles,candle.overboughSoldAnalysis.extremeLevel)
                // }

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
                    
                    candle.priceZone = activePriceZone;

                    var zoneInhabitantCount = movingCandles.slice(-24).filter(c => c.priceZone && c.priceZone == candle.priceZone).length
                    candle.candleData.zoneInhabitantCount = zoneInhabitantCount

                    var zoneInteraction = PriceZoneUtility.analyzeZoneInteraction(movingCandles, activePriceZone, 50);
                    candle.priceZoneInteraction = zoneInteraction;
                    candle.candleData.zoneSizePercentage = ((activePriceZone.upper - activePriceZone.lower) / activePriceZone.lower) * 100

                    pastZoneChangeAverage = movingCandles
                    .filter(c => c.openTime < zoneOpenTime && c.candleData && c.candleData.isNewZone)
                    .slice(-3)
                    .reduce((sum, s) => sum + s.candleData!.zoneSizePercentage, 0) / 3

                    //candle.candleData.extraInfo = pastZoneChangeAverage.toFixed(2).toString();
                    candle.candleData.spaceTakenInZoneLevel = candleAnalyzer.calculateCandleSpaceTakenInZoneLevel(candle,activePriceZone);

                    var closeAbsDistanceToZone: CloseAbsDistanceToZone = {
                        upper: Math.abs(((candle.close - candle.priceZone.upper) / candle.priceZone.upper) * 100),
                        mid: Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100),
                        lower: Math.abs(((candle.close - candle.priceZone.lower) / candle.priceZone.lower) * 100)
                    }

                    candle.closeAbsDistanceToZone = closeAbsDistanceToZone

                    for (const [key, priceZone] of priceZoneAvWaps) {
                        priceZoneAvWaps.set(key, candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= key)));
                    }

                    if(candle.candleData.zoneInhabitantCount == 1){
                        priceZoneAvWaps.set(candle.openTime, candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= candle.openTime)));
                    }

                    // if(priceZoneAvWaps.size >= 7){
                    //     const firstKey = priceZoneAvWaps.keys().next().value;
                    //     if (firstKey !== undefined) {
                    //         priceZoneAvWaps.delete(firstKey);
                    //     }
                    // }

                    var crossedAvwapCounter = 0;
                    for (const [key, avwapZone] of priceZoneAvWaps) {
                        var _crossedAvwap = (candle.open < avwapZone!.mid && candle.close > avwapZone!.mid) || (candle.open > avwapZone!.mid && candle.close < avwapZone!.mid)
                        if(_crossedAvwap){
                            crossedAvwapCounter++;
                        }
                    }

                    if(priceZoneAvWaps.size > 0){
                        var highestAvWapMid = Array.from(priceZoneAvWaps.values()).reduce(
                            (max, zone) => Math.max(max, zone.mid),
                            -Infinity,
                            )
                        var lowestAvWapMid = Array.from(priceZoneAvWaps.values()).reduce(
                            (min, zone) => Math.min(min, zone.mid),
                            Infinity,
                            )

                        candle.candleData.breakHighestAvWapMid = (candle.open < highestAvWapMid && candle.close > highestAvWapMid) && candle.candleData.side == "bull";
                        candle.candleData.breakLowestAvWapMid = (candle.open > lowestAvWapMid && candle.close < lowestAvWapMid) && candle.candleData.side == "bear";

                        highestAvwapBand = highestAvWapMid;
                        lowestAvwapBand = lowestAvWapMid
                    }

                    candle.candleData.crossedAvwapCount = crossedAvwapCounter;
                    candle.candleData.avwapCount = priceZoneAvWaps.size;
                }

                //===============
                //LOOKBACK TREND
                //===============
                var lookbackChange = movingCandles.slice(-8);

                var lookbackBase = lookbackChange[0];
                var basePrice = 0;
                if(candle.close > lookbackBase.close){
                    basePrice = lookbackBase.candleData?.side == 'bull' ? lookbackBase.open : lookbackBase.close;
                }else{
                    basePrice = lookbackBase.candleData?.side == 'bear' ? lookbackBase.close : lookbackBase.open;
                }

                var lookbackChangePercentage = ((candle.close - basePrice) / basePrice) * 100

                candle.candleData.lookbackChangePercentage = lookbackChangePercentage;

                var trendDirection = this.getTrendDirection(movingCandles.slice(-2).filter(c => c.candleData).map(c => c.candleData!.lookbackChangePercentage), lookbackChangePercentage)

                candle.candleData.lookbackTrend = trendDirection;

                // var last20Candles = movingCandles.slice(-20);
                // candle.candleData.hasRecentPosition = last20Candles.filter(c => c.side).length > 0;
                // if(candle.candleData.hasRecentPosition){
                //     var lastPositions = last20Candles.filter(c => c.side);
                //     var lastPosition = lastPositions[lastPositions.length - 1];
                //     candle.candleData.recentPositionSide = lastPosition.side;
                // }

                // const totalMovementFlow = await totalFlowForCandle(candle.symbol, candle.openTime, 15 * 60 * 1000)
                // candle.candleData.totalFlowMovement = totalMovementFlow;

                // if(i >= 26){
                //     candle.candleData.totalFlowMovementZScore = candleAnalyzer.getZScore(totalMovementFlow,movingCandles.slice(-10).filter(c => c.candleData && c.open < candle.openTime).map(c => c.candleData!.totalFlowMovement))!;
                //     candle.candleData.dominantFlowMovement = await getDominantFlowMovement(candle.symbol, candle.openTime, 15 * 60 * 1000)
                // }

                // for (const [key, priceZone] of movementPocAvwaps) {
                //     movementPocAvwaps.set(key, candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= key)));
                // }

                // if(candle.candleData.totalFlowMovementZScore >= 2.5){
                //     movementPocAvwaps.set(candle.openTime, candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= candle.openTime)));
                //     candle.candleData.conditionMet = "zzz"
                // }

                // var crossedMovementPocAvwapCounter = 0;
                // for (const [key, avwapZone] of movementPocAvwaps) {
                //     var _crossedAvwap = (candle.open < avwapZone!.mid && candle.close > avwapZone!.mid) || (candle.open > avwapZone!.mid && candle.close < avwapZone!.mid)
                //     if(_crossedAvwap){
                //         crossedMovementPocAvwapCounter++;
                //     }
                // }

                //candle.candleData.crossedMovementPocCounter = crossedMovementPocAvwapCounter

                if(candle.priceZoneInteraction?.volatilityRatio! > prevCandle.priceZoneInteraction?.volatilityRatio!){
                    var volatilityRatioChange = (candle.priceZoneInteraction?.volatilityRatio! / prevCandle.priceZoneInteraction?.volatilityRatio!);
                    var hasVolatilityRationSpike = volatilityRatioChange > 2.3;

                    candle.candleData.volatilityRatioChange = volatilityRatioChange;
                    candle.candleData.hasVolatilityRationSpike = hasVolatilityRationSpike;
                }

                var recentPocMovementAvwapCrossing = movingCandles.slice(-3).filter(c => c.candleData && c.candleData.crossedMovementPocCounter > 1).length > 0
                candle.candleData.hasRecentCrossedMovementPoc = recentPocMovementAvwapCrossing

                var recentVolatilityRatioChangeSpike = movingCandles.slice(-24).filter(c => c.candleData && c.candleData.volatilityRatioChange >= 1.5).length > 0;
                candle.candleData.hasRecentVolatityRatioChangeSpike = recentVolatilityRatioChangeSpike

                if(movingCandles.length >= 50){
                    var marketState = identifyMarketState(
                        movingCandles.slice(-24),
                        Array.from(priceZoneAvWaps.values())
                    )

                    candle.candleData.marketState = marketState!;
                }

                // volatilityRatioSpikes = movingCandles.filter(c => c.candleData && c.candleData.hasVolatilityRationSpike)
                // if(volatilityRatioSpikes.length > 0){
                //     var lastVolatilityRatioSpike = volatilityRatioSpikes[volatilityRatioSpikes.length - 1];
                //     candle.candleData.confluenceState = GetConfluenceState(movingCandles,lastVolatilityRatioSpike.openTime,lastVolatilityRatioSpike.high,lastVolatilityRatioSpike.low)
                // }

                if(lastBtcAvWap){
                    lastBtcAvWap = candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= _lastBtcSpike.openTime))
                    candle.candleData.crossedBtcSpikeAvwap = (candle.close > lastBtcAvWap.mid && candle.open < lastBtcAvWap.mid) || (candle.close < lastBtcAvWap.mid && candle.open > lastBtcAvWap.mid);
                }

                if(btcCandles.length > 0){
                    var btcCandle = btcCandles[i];
                    if(btcCandle.candleData!.changePercentageZScore >= 3){
                        candle.candleData.btcSpikeEvent = true;
                        candle.candleData.btcSpikeSide = btcCandle.candleData?.side!

                        if(candle.candleData.btcSpikeEvent){
                            var _btcSpikeCandles = movingCandles.filter(c => c.candleData && c.candleData.btcSpikeEvent);
                            var _lastBtcSpike = _btcSpikeCandles[_btcSpikeCandles.length - 1];
                            lastBtcAvWap = candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= _lastBtcSpike.openTime))
                        }
                    }
                }

                // if(candle.candleData.ema200 > 0){
                //     var _highestAvWapMid = Array.from(priceZoneAvWaps.values()).reduce(
                //         (max, zone) => Math.max(max, zone.mid),
                //         -Infinity,
                //         )
                //     var _lowestAvWapMid = Array.from(priceZoneAvWaps.values()).reduce(
                //         (min, zone) => Math.min(min, zone.mid),
                //         Infinity,
                //         )
                //     candle.candleData.ema200Stretch = candleAnalyzer.getPriceStretchContext(candle,_highestAvWapMid,_lowestAvWapMid);
                // }

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
                        //&& prevCandle.overboughSoldAnalysis
                        //&& prevCandle.volumeAnalysis
                        && prevCandle.candleData
                        && candle.candleData
                        && candle.support
                        && candle.resistance
                        && candle.priceZone
                        && supportCandle.candleData
                        && supportCandle.priceZone){


                        var closeAbsDistanceToMid = Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100)
                        var closeAbsDistanceToUpper = Math.abs(((candle.close - candle.priceZone.upper) / candle.priceZone.upper) * 100)
                        var closeAbsDistanceToLower = Math.abs(((candle.close - candle.priceZone.lower) / candle.priceZone.lower) * 100)
                        var closeAbseDistanceToEma200 = Math.abs(((candle.close - candle.candleData.ema200) / candle.candleData.ema200) * 100)

                        var priceZoneInhabitantCount = movingCandles.slice(-24).filter(c => c.priceZone && c.priceZone == candle.priceZone).length
                        var priceZones = movingCandles
                            .filter(c => c.candleData && c.candleData.isNewZone)
                            .map(c => c.priceZone)
                            .filter((z): z is PriceZone => z !== null);

                        candle.candleData.isCandleInAbsorption = candleAnalyzer.isCandleInAbsorption(movingCandles, priceZones, {
                            lookbackPeriod: 20,
                            volumeMultiplier: 2,        // require 2x avg volume instead of 1.5x
                            maxBodyToRangeRatio: 0.25,  // stricter -- body must be even smaller relative to range
                        })

                        candle.candleData.isBuyingExhaustion = candleAnalyzer.isBuyingExhaustion(movingCandles, priceZones);
                        candle.candleData.isSellingExhaustion = candleAnalyzer.isSellingExhaustion(movingCandles, priceZones);

                        var ladderDirection = this.getLadderDirection(priceZones)!

                        //candle.candleData.extraInfo = ladderDirection;


                        var lowerZoneEqualizerPrice = (candle.priceZone.lower + candle.priceZone.mid) / 2
                        var upperZoneEqualizerPrice = (candle.priceZone.upper + candle.priceZone.mid) / 2

                        lowerZoneEqualizerPrice = lowerZoneEqualizerPrice - (lowerZoneEqualizerPrice * 0.0005)
                        upperZoneEqualizerPrice = upperZoneEqualizerPrice - (upperZoneEqualizerPrice * 0.0005)

                        //start

                        //ZONE SIZES
                        var currentPriceZoneHigh = Math.max(...movingCandles.filter(c => c.priceZone == candle.priceZone).map(c => c.high),candle.priceZone.upper,candle.priceZone.lower);
                        var currentPriceZoneLow = Math.min(...movingCandles.filter(c => c.priceZone == candle.priceZone).map(c => c.low),candle.priceZone.upper,candle.priceZone.lower);

                        var priceZoneHighLowChangeDiff = Math.abs(((currentPriceZoneHigh - currentPriceZoneLow) / currentPriceZoneLow) * 100);
                        
                        if(priceZoneHighLowChangeDiff > 20){
                            candle.candleData.conditionMet = "BIG_SPAN"
                        }

                        if(priceZoneHighLowChangeDiff < 20 && priceZoneHighLowChangeDiff > 10){
                            candle.candleData.conditionMet = "MEDIUM_SPAN"
                        }

                        if(priceZones.length >= 2 && !candle.candleData.conditionMet){
                            var lastCandleInZone = movingCandles.filter(c => c.priceZone == priceZones[priceZones.length - 2] && c.candleData && c.candleData.zoneInhabitantCount == 24)[0];
                            if(lastCandleInZone){
                                var pastPriceZoneConditionMet = lastCandleInZone.candleData?.conditionMet;
                                if(pastPriceZoneConditionMet && !pastPriceZoneConditionMet.includes("PREV") 
                                    && pastPriceZoneConditionMet != "SHORT" 
                                    && pastPriceZoneConditionMet != "SHORT_POC" 
                                    && pastPriceZoneConditionMet != "RECENT_SHORT_POC" 
                                    && pastPriceZoneConditionMet != "LONG_POC"
                                    && pastPriceZoneConditionMet != "RECENT_LONG_POC"
                                ){
                                    candle.candleData.conditionMet = "PREV_" + pastPriceZoneConditionMet.replace("PREV_","");
                                }
                            }
                        }

                        // if(supportCandle.candleData.btcSpikeEvent
                        //     && supportCandle.candleData.changePercentageZScore >= 3
                        //     && supportCandle.candleData.btcSpikeSide == "bear"
                        //     && prevCandle.candleData.side == "bear"
                        //     && candle.candleData.side == "bull"
                        // ){
                        //     candle.side = "LONG"
                        //     targetTpRoi = 3;
                        //     candle.margin = 1;
                        //     candle.slPrice = prevCandle.close_atr_adjusted
                        // }
                        
                        candle.candleData.conditionMet = ""

                        // var pastCrossingCandles = movingCandles.slice(-5)
                        // var recentBtcCrossings = pastCrossingCandles.filter(c => c.candleData && c.candleData.crossedBtcSpikeAvwap);
                        // var recentFlowMovementCrossings = pastCrossingCandles.filter(c => c.candleData && c.candleData.crossedMovementPocCounter >= 1);

                        // if(recentBtcCrossings.length > 0 || recentFlowMovementCrossings.length > 0){
                        //     var btcSpikeCandles = movingCandles.filter(c => c.candleData && c.candleData.btcSpikeEvent);
                        //     if(btcSpikeCandles.length > 0){
                        //         var lastBtcSpikeCandle = btcSpikeCandles[btcSpikeCandles.length - 1];
                        //         var candlesAfterBtcSpike = movingCandles.filter(c => c.openTime >= lastBtcSpikeCandle.openTime);
                                
                        //         //SHORT1
                        //         var SHORT1_BTCCANDLE_ABOVEEMA = lastBtcSpikeCandle.close > lastBtcSpikeCandle.candleData!.ema200
                        //         var SHORT1_BTCCANDLE_BELOWEMA = lastBtcSpikeCandle.close < lastBtcSpikeCandle.candleData!.ema200
                        //         var SHORT1_CURRENTCANDLE_BELOWEMA = candle.close < candle.candleData.ema200;
                        //         var SHORT1_CLOSE_NEAR_EMA200 = candle.candleData.ema200Stretch?.absCloseDistanceAtr! < 1.8
                        //         var SHORT1_CURRENT_CANDLE_BEAR = candle.candleData.side == "bear"
                        //         var SHORT1_BTCCANDLE_IS_RECENT = movingCandles.slice(-10).filter(c => c.candleData && c.candleData.btcSpikeEvent).length >= 1
                        //         var SHORT1_BTCCANDLE_IS_BEAR = lastBtcSpikeCandle.candleData?.side == "bear"
                                
                        //         if((SHORT1_BTCCANDLE_ABOVEEMA || SHORT1_BTCCANDLE_BELOWEMA)
                        //             && SHORT1_CLOSE_NEAR_EMA200
                        //             && SHORT1_CURRENTCANDLE_BELOWEMA
                        //             && SHORT1_CURRENT_CANDLE_BEAR
                        //             && SHORT1_BTCCANDLE_IS_RECENT
                        //             && SHORT1_BTCCANDLE_IS_BEAR
                        //         ){
                        //             candle.candleData.conditionMet = "SHORT_1"
                        //         }

                        //         //SHORT2
                        //         var SHORT2_ISCOMING_FROM_UPTREND = this.confirmTrend("uptrend",candlesAfterBtcSpike)
                        //         var SHORT2_CANDLE_DISTANCE_FROM_EMA_IS_GOOD = candle.candleData && candle.candleData && candle.candleData!.ema200Stretch && candle.candleData!.ema200Stretch!.absCloseDistanceAtr! > 2
                        //         var SHORT2_CURRENT_CANDLE_BEAR = candle.candleData.side == "bear"
                        //         var SHORT2_FLOW_MOVEMENT_IS_RECENT = movingCandles.slice(-10).filter(c => c.candleData && c.candleData.dominantFlowMovement).length >= 1
                        //         var SHORT2_CURRENTCANDLE_ABOVEEMA = candle.close > candle.candleData.ema200;

                        //         if(SHORT2_ISCOMING_FROM_UPTREND
                        //             && SHORT2_CANDLE_DISTANCE_FROM_EMA_IS_GOOD
                        //             && SHORT2_CURRENT_CANDLE_BEAR
                        //             && SHORT2_FLOW_MOVEMENT_IS_RECENT
                        //             && SHORT2_CURRENTCANDLE_ABOVEEMA
                        //         ){
                        //             candle.candleData.conditionMet = "SHORT_2"
                        //         }

                        //         //LONG1
                        //         var LONG1_ISCOMING_FROM_DOWNTREND = this.confirmTrend("downtrend",candlesAfterBtcSpike)
                        //         var LONG1_NEAR_LAST_BOTTOM_STRETCH = pastCrossingCandles.filter(c => c.candleData && c.candleData.ema200Stretch && c.candleData.ema200Stretch.absCloseDistanceAtr! > 4.5).length >= 1
                        //         var LONG1_CURRENT_CANDLE_BULL = candle.candleData.side == "bull"
                        //         var LONG1_BTCCANDLE_IS_RECENT = movingCandles.slice(-10).filter(c => c.candleData && c.candleData.btcSpikeEvent).length >= 1
                        //         var LONG1_BTCCANDLE_IS_BEAR = lastBtcSpikeCandle.candleData?.side == "bear"

                        //         if(LONG1_ISCOMING_FROM_DOWNTREND 
                        //             && LONG1_NEAR_LAST_BOTTOM_STRETCH 
                        //             && LONG1_CURRENT_CANDLE_BULL
                        //             && LONG1_BTCCANDLE_IS_RECENT
                        //             && LONG1_BTCCANDLE_IS_BEAR
                        //         ){
                        //             candle.candleData.conditionMet = "LONG_1"
                        //         }
                        //     }
                        // }

                        // var btcSpikeCandles = movingCandles.filter(c => c.candleData && c.candleData.btcSpikeEvent);
                        // if(btcSpikeCandles.length > 0){
                        //     var lastBtcSpikeCandle = btcSpikeCandles[btcSpikeCandles.length - 1];

                        //     if(candle.high > lastBtcSpikeCandle.close && candle.low < lastBtcSpikeCandle.close){
                        //         candle.candleData.conditionMet = "BREAKS_BTC_SPIKE_UP"
                        //     }else if(candle.high > lastBtcSpikeCandle.open && candle.low < lastBtcSpikeCandle.open){
                        //         candle.candleData.conditionMet = "BREAKS_BTC_SPIKE_DOWN"
                        //     } 
                        // }
                        

                        // if(candle.candleData.hasRecentCrossedMovementPoc){
                        //     candle.candleData.conditionMet = "MOVEMENT_POC_BREAK";
                        // }

                        // if(volatilityRatioSpikes.length > 0){
                        //     var _lastVolatilityRatioSpike = volatilityRatioSpikes[volatilityRatioSpikes.length - 1];
                        //     if((candle.high > _lastVolatilityRatioSpike.high && candle.low < _lastVolatilityRatioSpike.high
                        //         || (candle.high > _lastVolatilityRatioSpike.low && candle.low < _lastVolatilityRatioSpike.low)
                        //     )){
                        //         candle.candleData.conditionMet = "BREAKS_VS";
                        //     }
                        // }

                        // if(candle.candleData.crossedAvwapPoint){
                        //     candle.candleData.conditionMet = "CROSSED_LAST_AVWAP";
                        // }
                        
                        if(lastAvwap){
                            // var crossedAvwap = movingCandles.slice(-3).filter(c => c.candleData
                            //     && (
                            //         (c.open < lastAvwap!.mid && candle.close > lastAvwap!.mid) 
                            //         || (c.open > lastAvwap!.mid && candle.close < lastAvwap!.mid)
                            //     )
                            // ).length > 0;

                            var crossedAvwap = (candle.open < lastAvwap!.mid && candle.close > lastAvwap!.mid) || (candle.open > lastAvwap!.mid && candle.close < lastAvwap!.mid)
                            candle.candleData.crossedAvwapPoint = crossedAvwap
                        }

                        if(lastVoAvWap){
                            var crossedVoAvwap = (candle.open < lastVoAvWap!.mid && candle.close > lastVoAvWap!.mid) || (candle.open > lastVoAvWap!.mid && candle.close < lastVoAvWap!.mid)
                            candle.candleData.crossedVoAvwapPoint = crossedVoAvwap
                        }

                        var avwapPointCandles = movingCandles.filter(c => c.candleData && c.candleData.isAvwapPoint);
                        //if(candle.candleData.conditionMet){
                            if(avwapPointCandles.length >= 1){
                                var lastAvwapPointCandle = avwapPointCandles[avwapPointCandles.length - 1];
                                lastAvwap = candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= lastAvwapPointCandle.openTime))
                            }
                        //}

                        var voAvwapPointCandles = movingCandles.filter(c => c.candleData && c.candleData.hasVolatilityRationSpike);
                        if(voAvwapPointCandles.length >= 1){
                            var lastVoAvWapPointCandle = voAvwapPointCandles[voAvwapPointCandles.length - 1];
                            lastVoAvWap = candleAnalyzer.getAnchorVwap(movingCandles.filter(c => c.openTime >= lastVoAvWapPointCandle.openTime))
                        }

                        var lastXCandles = movingCandles.slice(-8);
                        var lastXCandleHigh = Math.max(...lastXCandles.map(c => c.high))
                        var lastXCandleLow = Math.min(...lastXCandles.map(c => c.low))
                        var lastXCandleSpan = Math.abs(((lastXCandleHigh - lastXCandleLow) / lastXCandleLow) * 100);
                        candle.candleData.lastXCandleSpan = lastXCandleSpan;


                        //ENTRY

                        
                        //if(candle.candleData.conditionMet){
                            var quickFrvp = candleAnalyzer.getVolumeProfile(movingCandles.filter(c => c.openTime >= prevCandle.openTime));

                            var past3CandlesIsBull = movingCandles.slice(-4).filter(c => c.openTime < candle.openTime && c.candleData?.side == "bull");
                            var currentCandleIsBear = candle.candleData.side = "bear";
                            var candlesAboveHighestBand = movingCandles.slice(-4).filter(c => c.close > highestAvwapBand).length == 4;
                            var candlesAboveUpperPriceZone = movingCandles.slice(-4).filter(c => c.priceZone && c.close > c.priceZone.upper).length == 4;
                            var candleBreakFrvpFromAbove = candle.open > quickFrvp?.pocPrice! && candle.close < quickFrvp?.pocPrice!
                            var isComingFromUptrend = this.confirmTrend("uptrend",movingCandles.slice(-10));
                            
                            if(past3CandlesIsBull
                                && currentCandleIsBear
                                && candlesAboveHighestBand
                                //&& candlesAboveUpperPriceZone
                                //&& candleBreakFrvpFromAbove
                                && isComingFromUptrend
                            ){
                                candle.candleData.conditionMet = "SHORT_SCALP"
                            }

                            // var hasRecentShortPOC = movingCandles.slice(-8).filter(c => c.candleData && c.candleData.extraInfo == "SHORT_POC").length > 0;
                            // if(hasRecentShortPOC){
                            //     candle.candleData.conditionMet = "RECENT_SHORT_POC"
                            // }


                            // var past3CandlesIsBear = movingCandles.slice(-4).filter(c => c.openTime < candle.openTime && c.candleData?.side == "bear");
                            // var currentCandleIsBull = candle.candleData.side = "bull";
                            // var candlesBelowLowestBand = movingCandles.slice(-4).filter(c => c.close < lowestAvwapBand).length == 4;
                            // var candlesBelowLowerPriceZone = movingCandles.slice(-4).filter(c => c.priceZone && c.close < c.priceZone.lower).length == 4;

                            // if(
                            //     past3CandlesIsBear
                            //     && currentCandleIsBull
                            //     && candlesBelowLowestBand
                            //     && candlesBelowLowerPriceZone
                            // ){
                            //     candle.candleData.extraInfo = "LONG_POC"
                            // }

                            var hasRecentLongPOC = movingCandles.slice(-8).filter(c => c.candleData && c.candleData.extraInfo == "LONG_POC").length > 0;
                            if(hasRecentLongPOC){
                                candle.candleData.conditionMet = "RECENT_LONG_POC"
                            }
                        //}

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

                            // if(estimatedSlPnl > (estimatedTpPnl * 1.5)
                            //     || estimatedSlPnl < -(margin * 3)
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

    static getLadderDirection(zones: PriceZone[]): 'laddering_up' | 'laddering_down' | null {
        if (zones.length < 2) return null;

        let ups = 0;
        let downs = 0;

        for (let i = zones.length - 1; i > 0; i--) {
            const curr = zones[i].mid;
            const prev = zones[i - 1].mid;
            if (curr > prev) ups++;
            else if (curr < prev) downs++;
        }

        const total = ups + downs;
        const threshold = 0.7; // 70% must agree

        if (downs / total >= threshold) return 'laddering_down';
        if (ups   / total >= threshold) return 'laddering_up';
        return null;
    }

    static confirmTrend(direction: TrendDirection, candles: CandleEntry[]): boolean {
        if (candles.length === 0) return false;

        // 1. Label agreement: majority of candles' lookbackTrend must match the direction
        const labelMatches = candles.filter(c => {
            const trend = c.candleData?.lookbackTrend;
            if (!trend) return false;
            return direction === "uptrend"
            ? trend === "strong_uptrend" || trend === "mild_uptrend"
            : trend === "strong_downtrend" || trend === "mild_downtrend";
        }).length;

        const labelConfirms = labelMatches / candles.length >= 0.5;

        // 2. Price action agreement: first candle's open vs last candle's close
        const first = candles[0];
        const last = candles[candles.length - 1];
        const netMove = last.close - first.open;

        const priceConfirms = direction === "uptrend" ? netMove > 0 : netMove < 0;

        // 3. Structure agreement: higher highs/higher lows (uptrend) or lower highs/lower lows (downtrend)
        let structureUp = 0;
        let structureDown = 0;
        for (let i = 1; i < candles.length; i++) {
            if (candles[i].high > candles[i - 1].high && candles[i].low > candles[i - 1].low) structureUp++;
            if (candles[i].high < candles[i - 1].high && candles[i].low < candles[i - 1].low) structureDown++;
        }
        const structureConfirms = direction === "uptrend"
            ? structureUp >= structureDown
            : structureDown >= structureUp;

        return labelConfirms && priceConfirms && structureConfirms;
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