import type { Candle, CandleEntry, PriceZone } from "@/core/interfaces";
import { candleAnalyzer } from "./candleAnalyzerUtility";
import { OrderMakerUtility } from "./OrderMakerUtility.ts";
import { KlineUtility } from "./klineUtility.ts";
import { klineDbUtility } from "./klineDbUtility.ts";
import { PriceZoneUtility } from "./priceZoneUtility.ts";
import { PnlUtility } from "./PnlUtility.ts";

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

            if(candle.openTime < startingTimeStamp && candle.closeTime > startingTimeStamp){
                candle.side = "STARTING_POINT"
            }

            if(candle.openTime < startingTimeStamp) continue;
            
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
                
                candle.zoneAnalysis = zoneAnalysis;
                
                candle.volumeAnalysis = volumeAnalysis;
                candle.pastVolumeAnalysis = pastVolumeAnalysis;
                candle.overboughSoldAnalysis = overSoldBoughtAnalysis;
                candle.candleData = candleData;
                candle.candleData.priceMove = candleAnalyzer.detectPriceMove(movingCandles, movingCandles.length - 1)
                candle.candleData.volumeSpike = candleAnalyzer.hasVolumeSpike(movingCandles,50);
                candle.overboughSoldAnalysis.extremeLevel = candleAnalyzer.detectOverState(movingCandles,8);

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
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else if(candle.high > openPosition.tpPrice){
                            candle.status = "LONG_WON"
                            openPosition.status = "WON"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.tpPrice, "BUY", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else{
                            candle.status = "OPEN"

                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,candle.close, "BUY", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
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
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;
                            

                            openPosition = null
                        }else if (candle.low < openPosition.tpPrice){
                            candle.status = "SHORT_WON"
                            openPosition.status = "WON"
                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,openPosition.tpPrice, "SELL", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;

                            openPosition = null
                        }else{
                            candle.status = "OPEN"

                            _estimatedPnlPercentage = PnlUtility.calculatePNLPercent(openPosition!.close,candle.close, "SELL", _maxLeverage);
                            _estimatedPnl = PnlUtility.calculateEstimatedPnl(margin,_estimatedPnlPercentage, _maxLeverage);
                            
                            openPosition.pnl = _estimatedPnl;
                        }
                    }
                }else{
                    if(
                        prevCandle.resistance 
                        && prevCandle.support
                        && prevCandle.priceZone  
                        && candle.candleData
                        && candle.support
                        && candle.resistance 
                        && candle.priceZone){

                        var closeAbsDistanceToMid = Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100)
                        //LONG POSITION
                        var longEntry1 = candle.overboughSoldAnalysis.extremeLevel == 'overbought'
                        && candle.high < candle.priceZone.mid
                        && candle.open < candle.priceZone.mid
                        && closeAbsDistanceToMid >= 1
                        && movingCandles.slice(-10).filter(c => c.priceZone && c.openTime < candle.openTime && c.close < c.priceZone.mid && c.open < c.priceZone.mid).length <= 6
                        && movingCandles.slice(-7).filter(c => c.openTime < candle.openTime 
                            && c.candleData
                            && c.overboughSoldAnalysis
                            && c.volumeAnalysis
                            && c.overboughSoldAnalysis.extremeLevel == 'oversold'
                            && (
                                (c.candleData.volumeSpike && c.candleData.priceMove == 'dragged_down' && c.volumeAnalysis.zScore >= 3)
                                || (c.candleData.volumeSpike && c.candleData.priceMove == 'dragged_down')
                                || (c.candleData.volumeSpike && c.volumeAnalysis.zScore >= 3)
                                || (c.candleData.priceMove == 'dragged_down' && c.volumeAnalysis.zScore >= 3)
                            )
                        ).length >= 1


                        if(longEntry1){
                            candle.candleData.isLongPotential = true;
                            candle.candleData.conditionMet = "LONG_1"

                            candle.side = "LONG"
                            candle.slPrice = candle.support.lower - (atr * 1.5)
                            candle.tpPrice = candle.priceZone.mid
                        }

                        //SHORT POSITION

                        var shortEntry1 = candle.overboughSoldAnalysis.extremeLevel == 'overbought'
                        && candle.close > prevCandle.open
                        && candle.open < candle.priceZone.upper
                        && candle.open > candle.priceZone.lower
                        && prevCandle.overboughSoldAnalysis?.extremeLevel == 'oversold'
                        && prevCandle.candleData?.priceMove == 'dragged_down'
                        && prevCandle.open < prevCandle.priceZone.upper
                        && prevCandle.open > prevCandle.priceZone.lower
                        && movingCandles.slice(-5).filter(c => c.openTime < candle.openTime && c.candleData && c.candleData.isNewZone).length == 0

                        var shortEntry2 = candle.overboughSoldAnalysis.extremeLevel == 'overbought'
                        && candle.close < candle.priceZone.mid
                        && candle.high > candle.priceZone.mid
                        && candle.open < candle.priceZone.mid
                        && movingCandles.slice(-10).filter(c => c.priceZone && c.openTime < candle.openTime && c.close < c.priceZone.mid && c.open < c.priceZone.mid).length <= 6
                        && movingCandles.slice(-7).filter(c => c.openTime < candle.openTime 
                            && c.candleData
                            && c.overboughSoldAnalysis
                            && c.volumeAnalysis
                            && c.overboughSoldAnalysis.extremeLevel == 'oversold'
                            && (
                                (c.candleData.volumeSpike && c.candleData.priceMove == 'dragged_down' && c.volumeAnalysis.zScore >= 3)
                                || (c.candleData.volumeSpike && c.candleData.priceMove == 'dragged_down')
                                || (c.candleData.volumeSpike && c.volumeAnalysis.zScore >= 3)
                                || (c.candleData.priceMove == 'dragged_down' && c.volumeAnalysis.zScore >= 3)
                            )
                        ).length >= 1

                        var pastBreakThroughResistance = movingCandles.slice(-5).filter(c => c.openTime < candle.openTime && c.candleData && c.breakthrough_resistance); 
                        
                        var shortEntry3 = false
                        if(pastBreakThroughResistance.length >= 1){
                            var lastBreakCandle = pastBreakThroughResistance[pastBreakThroughResistance.length - 1]
                            shortEntry3 = candle.candleData.side == 'bear'
                            && !!lastBreakCandle.priceZone
                            && candle.close < lastBreakCandle.resistance!.upper
                            && lastBreakCandle.open > lastBreakCandle.priceZone!.mid
                            && lastBreakCandle.close > lastBreakCandle.priceZone!.mid
                            && candle.open > candle.priceZone.mid
                            && candle.close > candle.priceZone.mid
                            && movingCandles.slice(-5).filter(c => c.overboughSoldAnalysis && c.overboughSoldAnalysis.extremeLevel == 'overbought').length >= 1
                            && candle.candleData.zoneSizePercentage >= 2
                        }

                        if(shortEntry1){
                            candle.candleData.isShortPotential = true;
                            candle.candleData.conditionMet = "SHORT_1"

                            candle.side = "SHORT"
                            candle.slPrice = candle.priceZone.upper + (atr * 1.5)

                            if(candle.slPrice < candle.close){
                                candle.slPrice = candle.close + (atr * 1.5)
                            }

                            candle.tpPrice = candle.support.lower - (atr * 2.5)
                        }else if(shortEntry2){
                            candle.candleData.isShortPotential = true;
                            candle.candleData.conditionMet = "SHORT_2"

                            candle.side = "SHORT"
                            candle.slPrice = candle.priceZone.upper + (atr)
                            candle.tpPrice = candle.support.lower - (atr * 1.5)
                        }else if(shortEntry3){
                            candle.candleData.isShortPotential = true;
                            candle.candleData.conditionMet = "SHORT_3"

                            candle.side = "SHORT"
                            candle.slPrice = candle.high + (atr * 1.5)

                            if(candle.candleData.zoneSizePercentage < 5){
                                candle.tpPrice = candle.priceZone.lower - (atr * 1.5)
                            }else{
                                var closeDistanceToMid = Math.abs(((candle.close - candle.priceZone.mid) / candle.priceZone.mid) * 100)
                                if(closeDistanceToMid >= 0.8 || closeDistanceToMid <= 2.5){
                                    candle.tpPrice = candle.priceZone.mid
                                }else{
                                    candle.tpPrice = candle.priceZone.lower + (atr)
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

                            if(candle.tpPrice == 0){
                                var tpSl = await OrderMakerUtility.calculateTpSl(margin, symbol,_side,candle.close.toString(),targetTpRoi,targetSlRoi);
                                candle.tpPrice = tpSl.tp_price

                                if(candle.slPrice == 0){
                                    candle.slPrice = tpSl.sl_price
                                }
                            }

                            candle.margin = margin
                            candle.leverage = _maxLeverage
                            candle.entryFee = PnlUtility.calculateTakerFee(margin,_maxLeverage)
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