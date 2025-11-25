import type { Candle, CandleData, CandleEntry, OverboughtOversoldAnalysis, PastVolumeAnalysis, PriceZone, ReactionData, VolumeAnalysis, ZoneAnalysis } from "@/core/interfaces";

class CandlestickAnalyzer {

  static analyzeCandlestick(candles: Candle[], index:number, checkPast: boolean, pastCandleLookBack:number): CandleData {
    var candle = candles[index];
    var previousCandle = candles[index - 1];
    const o = candle.open;
    const h = candle.high;
    const l = candle.low;
    const c = candle.close;
    const v = candle.volume;
    const openTime = candle.openTime

    const size = Math.abs(h - l);
    const bodySize = Math.abs(o - c);
    const topWick = h - Math.max(o, c);
    const bottomWick = Math.min(o, c) - l;

    const bodyPercentage = size !== 0 ? (bodySize / size) * 100 : 0;
    const topWickPercentage = size !== 0 ? (topWick / size) * 100 : 0;
    const bottomWickPercentage = size !== 0 ? (bottomWick / size) * 100 : 0;

    const side: "bull" | "bear" = c > o ? "bull" : "bear";

    const strength =
      side === "bull"
        ? bottomWickPercentage + bodyPercentage
        : topWickPercentage + bodyPercentage;

    const changePercentage = ((c - o) / o) * 100;

    const volumeChangePercentage = parseFloat(
        (((candle.volume - previousCandle.volume) / previousCandle.volume) * 100).toFixed(2)
    );

    var isIndecisive = bodyPercentage < topWickPercentage || bodyPercentage < bottomWickPercentage;

    var previousCandleData: CandleData[] = []

    if(checkPast){
        for (let i = 1; i <= pastCandleLookBack; i++) {
            var pastCandleData = this.analyzeCandlestick(candles,index - i,false,0);
            previousCandleData.push(pastCandleData);
        }

        for (let i = 1; i <= pastCandleLookBack; i++) {
            var pastIndex = index - (pastCandleLookBack + i);
            if(pastIndex <= 1) break;

            var pastCandleData = this.analyzeCandlestick(candles,pastIndex,false,0);
            previousCandleData[previousCandleData.length - 1].previousCandleData?.push(pastCandleData);
        }
    }

    return {
      o,
      h,
      l,
      c,
      openTime,
      volume: v,
      volume_change_percentage: parseFloat(volumeChangePercentage.toFixed(2)),
      body_v: parseFloat(bodyPercentage.toFixed(2)),
      top_wick_v: parseFloat(topWickPercentage.toFixed(2)),
      bottom_wick_v: parseFloat(bottomWickPercentage.toFixed(2)),
      strength_v: parseFloat(strength.toFixed(2)),
      change_percentage_v: parseFloat(changePercentage.toFixed(2)),
      side,
      previousCandleData,
      ema200: 0,
      pastAboveEma: 0,
      pastBelowEma: 0,
      emaLevel: "above",
      volumeSpike: false,
      zoneInhabitantCount: 0,
      lookbackChangePercentage: 0,
      lookbackTrend: "",
      atr: 0,
      isNewZone:false,
      proximityToZoneEdge:"",
      atrVolatility: "",
      zoneSizePercentage: 0,
      extraInfo: "",
      isIndecisive: isIndecisive,
      isLongPotential:false,
        isShortPotential:false,
        conditionMet: "",
        priceMove:"",
        pastZoneOverStatePriceReaction: "",
        spaceTakenInZoneLevel: 0
    };
  }

static detectPriceMove(
    movingCandles: Candle[],
    entryIndex: number
): "shoots_up" | "dragged_down" | "normal" {
    
    if(movingCandles.length < 20) return "normal";
    if (entryIndex < 2) return "normal";

    const currentCandle = movingCandles[entryIndex];

    // Calculate actual body percentage move (close - open only, ignore wicks)
    const currentMove = ((currentCandle.close - currentCandle.open) / currentCandle.open) * 100;
    
    // Only consider candles with substantial body (not just wicks)
    const bodySize = Math.abs(currentMove);
    const wickRange = ((currentCandle.high - currentCandle.low) / currentCandle.open) * 100;
    
    // If body is less than 30% of the wick range, it's mostly wick - ignore
    if (bodySize < wickRange * 0.3) {
        return "normal";
    }
    
    // Calculate average move from last 20 candles (excluding current)
    const recentCandles = movingCandles.slice(Math.max(0, entryIndex - 8), entryIndex);
    const avgMove = recentCandles.reduce((sum, c) => sum + Math.abs((c.close - c.open) / c.open * 100), 0) / recentCandles.length;
    
    // Calculate standard deviation of moves
    const variance = recentCandles.reduce((sum, c) => {
        const move = ((c.close - c.open) / c.open) * 100;
        return sum + Math.pow(move - avgMove, 2);
    }, 0) / recentCandles.length;
    const stdDev = Math.sqrt(variance);
    
    // How many standard deviations is current move?
    const zScore = (currentMove - avgMove) / stdDev;
    
    // Capture obvious moves with substantial body
    if (zScore > 2.5 && currentMove > 0) {
        return "shoots_up";
    }
    
    if (zScore < -2.5 && currentMove < 0) {
        return "dragged_down";
    }
    
    return "normal";
}

static getPreviousSessionOverStatePriceReaction(movingCandles: CandleEntry[], overState: string): "up" | "down" | "neutral" {
    
    // Get all price zones
    const priceZones = movingCandles.filter(c => c.candleData && c.candleData.isNewZone);
    
    if (priceZones.length < 2) return "neutral"; // Need at least 2 zones
    
    // Current zone is last, previous zone is second to last
    const previousZone = priceZones[priceZones.length - 2];
    const currentZone = priceZones[priceZones.length - 1];
    
    // Find the index of previous zone in movingCandles
    const previousZoneIndex = movingCandles.indexOf(previousZone);
    const currentZoneIndex = movingCandles.indexOf(currentZone);
    
    // Get all candles in previous zone session
    const previousSessionCandles = movingCandles.slice(previousZoneIndex, currentZoneIndex);
    
    // Find candles with the specified overState in previous session
    const overStateCandles = previousSessionCandles.filter(c => 
        c.overboughSoldAnalysis?.extremeLevel === overState
    );
    
    if (overStateCandles.length === 0) return "neutral";
    
    // Get price at first overState occurrence
    const firstOverStatePrice = overStateCandles[0].close;
    
    // Get price at end of previous session (last candle before current zone)
    const endSessionPrice = previousSessionCandles[previousSessionCandles.length - 1].close;
    
    // Calculate reaction
    const priceChange = endSessionPrice - firstOverStatePrice;
    const changePercent = (priceChange / firstOverStatePrice) * 100;
    
    if (changePercent > 0.5) return "up";
    if (changePercent < -0.5) return "down";
    return "neutral";
}

static detectOverState(movingCandles: any[], windowSize = 30, threshold = 2) {
    if (movingCandles.length < windowSize + 1) return "";

    // Get the last windowSize candles (excluding current)
    const past = movingCandles.slice(-windowSize - 1, -1);
    const current = movingCandles[movingCandles.length - 1];

    // Calculate percentage changes manually from open/close
    const changes = past.map(c => {
        const open = c.open;
        const close = c.close;
        return ((close - open) / open) * 100;
    });
    
    if (changes.length === 0) return "";

    // Calculate mean and standard deviation
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / changes.length;
    const std = Math.sqrt(variance);

    // Avoid division by zero - if no volatility, return empty
    if (std === 0) return "";

    // Calculate z-score for current candle
    const currentOpen = current.open;
    const currentClose = current.close;
    const currentChange = ((currentClose - currentOpen) / currentOpen) * 100;
    const z = (currentChange - mean) / std;

    // Detect overbought/oversold based on z-score
    if (z > threshold) return "overbought";
    if (z < -threshold) return "oversold";
    return "";
}

static calculateCandleSpaceTakenInZoneLevel(
  candle: CandleEntry,
  zone: PriceZone
) {
  const close = candle.close

  let a = 0
  let b = 0

  if (close < zone.mid) {
    a = zone.lower
    b = zone.mid
  } else {
    a = zone.mid
    b = zone.upper
  }

  const span = b - a
  if (span <= 0) return 0

  const cHigh = Math.max(candle.open, candle.close, candle.high)
  const cLow  = Math.min(candle.open, candle.close, candle.low)

  const overlapHigh = Math.min(cHigh, b)
  const overlapLow  = Math.max(cLow,  a)
  const overlap = Math.max(0, overlapHigh - overlapLow)

  return (overlap / span) * 100
}

   static hasVolumeSpike(
    candles: Candle[],
    lookbackPeriod: number = 20,
    multiplier: number = 1.8
    ): boolean {
    if (candles.length < lookbackPeriod + 1) return false;

    const currentVolume = candles[candles.length - 1].volume;
    if (!currentVolume || currentVolume === 0) return false;

    const pastCandles = candles.slice(-lookbackPeriod - 1, -1);
    const pastVolumes = pastCandles
        .map(c => c.volume)
        .filter(v => v && v > 0);

    if (pastVolumes.length === 0) return false;

    const avgVolume = pastVolumes.reduce((sum, v) => sum + v, 0) / pastVolumes.length;
    const maxVolume = Math.max(...pastVolumes);

    // Spike if: 1.8x average AND above recent max
    return currentVolume >= avgVolume * multiplier && currentVolume >= maxVolume;
    }

    private detectTopWickRejection(candle: Candle, previousCandle: Candle, bodyPercentage: number, topWickPercentage: number, side: "bull" | "bear"): boolean {
  const hasSignificantTopWick = topWickPercentage > bodyPercentage * 0.5; // Relaxed: wick only needs to be 50% of body
  const closeInLowerHalf = (candle.close - candle.low) / (candle.high - candle.low) < 0.5;
  const wickIsNotSmall = topWickPercentage > 5; // At least 5% top wick
  
  return hasSignificantTopWick && closeInLowerHalf && wickIsNotSmall;
}

private detectBottomWickRejection(candle: Candle, previousCandle: Candle, bodyPercentage: number, bottomWickPercentage: number, side: "bull" | "bear"): boolean {
  const hasSignificantBottomWick = bottomWickPercentage > bodyPercentage * 0.5; // Relaxed: wick only needs to be 50% of body
  const closeInUpperHalf = (candle.close - candle.low) / (candle.high - candle.low) > 0.5;
  const wickIsNotSmall = bottomWickPercentage > 5; // At least 5% bottom wick
  
  return hasSignificantBottomWick && closeInUpperHalf && wickIsNotSmall;
}

  static analyzePastVolumes(candles: Candle[], currentIndex: number, lookback: number = 5): PastVolumeAnalysis {
    
        if (currentIndex < lookback) {
            return {
                pastAvgVolume: 0,
                volumeTrend: "none",
                spikeFlag: false,
                dominantDirection: "mixed"
            };
        }
        
        const pastCandles = candles.slice(currentIndex - lookback, currentIndex);
        
        // Calculate average volume
        const pastAvgVolume = pastCandles.reduce((sum, c) => sum + c.volume, 0) / pastCandles.length;
        
        // Calculate volume trend
        const firstHalf = pastCandles.slice(0, Math.floor(pastCandles.length / 2));
        const secondHalf = pastCandles.slice(Math.floor(pastCandles.length / 2));
        
        const firstHalfAvg = firstHalf.reduce((sum, c) => sum + c.volume, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, c) => sum + c.volume, 0) / secondHalf.length;
        
        let volumeTrend: "increasing" | "decreasing" | "stable" = "stable";
        if (secondHalfAvg > firstHalfAvg * 1.1) {
            volumeTrend = "increasing";
        } else if (secondHalfAvg < firstHalfAvg * 0.9) {
            volumeTrend = "decreasing";
        }
        
        // Check for spike (sudden volume jump)
        const currentCandle = candles[currentIndex];
        const currentVolume = currentCandle.volume;
        const avgPastVolume = pastCandles.reduce((sum, c) => sum + c.volume, 0) / pastCandles.length;
        const spikeFlag = currentVolume > avgPastVolume * 2; // 2x volume = spike
        
        // Get dominant direction
        let bullCount = 0;
        let bearCount = 0;
        pastCandles.forEach(c => {
            if (c.close > c.open) bullCount++;
            else bearCount++;
        });
        
        let dominantDirection: "bull" | "bear" | "mixed" = "mixed";
        if (bullCount > bearCount) {
            dominantDirection = "bull";
        } else if (bearCount > bullCount) {
            dominantDirection = "bear";
        }
        
        return {
            pastAvgVolume,
            volumeTrend,
            spikeFlag,
            dominantDirection
        };
    }

  static analyzeZoneInteraction(
        side: string,
        currentPrice: number,
        candles: Candle[],
        support: PriceZone,
        resistance: PriceZone,
        pastInteractionLength: number,
        pastCandleTrendLength: number,
        momentumLength: number,
        breakthroughLength: number): ZoneAnalysis {
        const zone = side === 'BUY' ? support : resistance;
        const zoneWidth = Math.abs(zone.upper - zone.lower) || 1e-8;

        // 1. Price proximity normalization
        const distanceFromZone =
            currentPrice > zone.upper
                ? currentPrice - zone.upper
                : currentPrice < zone.lower
                ? zone.lower - currentPrice
                : 0;

        const priceProximityCloseToZone = Math.min(100, (distanceFromZone / zoneWidth) * 100);
        const proximityScore = 100 - priceProximityCloseToZone;

        // 2. Proximity confidence (proper exponential decay)
        const normalizedDistance = distanceFromZone / zoneWidth;
        const proximityConfidence =
            currentPrice >= zone.lower && currentPrice <= zone.upper
                ? 1
                : Math.exp(-2.5 * normalizedDistance);
            
        // Past Breakthrough candles
        const breakthroughCandles = candles.slice(0, -1).slice(-breakthroughLength);
        let pastResistanceBreakCount = 0
        let pastSupportBreakCount = 0
        for(const candle of breakthroughCandles){
            if(candle.breakthrough_resistance){
                pastResistanceBreakCount++;
            }

            if(candle.breakthrough_support){
                pastSupportBreakCount++;
            }
        }

        // 3. Past interaction untouched
        const pastInteractionCandles = candles.slice(0, -1).slice(-pastInteractionLength);
        let pastInteractionsToZoneCount = 0;
        for (const candle of pastInteractionCandles) {
            if (
                side === 'SELL' &&
                ((candle.high > resistance.lower && candle.low < resistance.lower) ||
                    (candle.high > resistance.upper && candle.low < resistance.lower) ||
                    (candle.high > resistance.upper &&
                        candle.low > resistance.lower &&
                        candle.low < resistance.upper))
            )
                pastInteractionsToZoneCount++;

            if (
                side === 'BUY' &&
                ((candle.high > support.upper && candle.low < support.upper) ||
                    (candle.high > support.upper && candle.low < support.lower) ||
                    (candle.low < support.lower &&
                        candle.high > support.lower &&
                        candle.high < support.upper))
            )
                pastInteractionsToZoneCount++;
        }

        // 4. Trend detection normalization
        const trendCandles = candles.slice(-pastCandleTrendLength - 1, -1);
        const bullishCount = trendCandles.filter(c => c.close > c.open).length;
        const bearishCount = trendCandles.filter(c => c.close < c.open).length;

        let pastTrend: 'sideways' | 'bearish' | 'bullish' = 'sideways';
        if (bullishCount > bearishCount * 1.4) pastTrend = 'bullish';
        else if (bearishCount > bullishCount * 1.4) pastTrend = 'bearish';

        // 5. Momentum normalization (Z-score method) — INCREASED SENSITIVITY
        const momentumCandles = candles.slice(-momentumLength);
        const candleSizes = momentumCandles.map(c => Math.abs(c.close - c.open));
        const avgSize = candleSizes.reduce((a, b) => a + b, 0) / candleSizes.length;
        const stdSize =
            Math.sqrt(
                candleSizes.reduce((a, b) => a + Math.pow(b - avgSize, 2), 0) / candleSizes.length
            ) || 1e-8;

        const currentCandle = momentumCandles[momentumCandles.length - 1];
        const currentSize = Math.abs(currentCandle.close - currentCandle.open);
        const zScore = (currentSize - avgSize) / stdSize;
        const momentum = Math.max(0, Math.min(100, 50 + zScore * 50)); // 2× sensitivity

        // 6. Volume normalization (avoid anomalies)
        const recentVolumes = momentumCandles.map(c => c.volume);
        const avgVolume =
            recentVolumes.reduce((a, b) => a + b, 0) / Math.max(1, recentVolumes.length);
        const stdVolume =
            Math.sqrt(
                recentVolumes.reduce((a, b) => a + Math.pow(b - avgVolume, 2), 0) /
                    Math.max(1, recentVolumes.length)
            ) || 1e-8;
        const volumeZ = (currentCandle.volume - avgVolume) / stdVolume;
        const volumeConfluence = Math.max(0.2, Math.min(3, 1 + volumeZ * 0.3));

        // 7. Velocity correlation — normalized per zone width per minute
        const reactionVelocity =
            Math.abs(currentCandle.close - currentCandle.open) / zoneWidth /
            ((currentCandle.closeTime - currentCandle.openTime) / 60000 || 1);
        const normalizedVelocity = Math.min(1, reactionVelocity / 2);

        // 8. Zone detection flag fix
        const zoneTouchDetected =
            currentPrice >= zone.lower && currentPrice <= zone.upper && pastInteractionsToZoneCount > 0;

        // 9. Volatility normalization
        const recentPrices = candles.slice(-10).map(c => c.close);
        const meanPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        const volatilityScore = Math.min(
            1,
            Math.sqrt(
                recentPrices.reduce((a, b) => a + Math.pow(b - meanPrice, 2), 0) / recentPrices.length
            ) / zoneWidth
        );

        // 10. Confidence aggregation — WEIGHTED instead of averaged
        const zoneStrength = Math.min(1, Math.max(0.1, pastInteractionsToZoneCount / 5));
        const signalConfidence = Math.min(
            1,
            ((zoneStrength * 0.25 + (momentum / 100) * 0.4 + (volumeConfluence / 2) * 0.35)) * proximityConfidence
        );

        // 11. Time correlation
        const timeInZoneMs =
            candles.filter(c => c.low <= zone.upper && c.high >= zone.lower).length * 60000;

        const breakoutProbability = Math.min(
            1,
            (momentum / 100 * 0.5 + volumeConfluence * 0.2 + volatilityScore * 0.3)
        );

        // 12. Bias normalization — WEIGHTED SCORING approach
        let overallBias: 'long' | 'short' | 'neutral' = 'neutral';
        
        if (side === 'BUY') {
            // Long signal: support zone with bearish rejection + momentum
            const longScore = 
                (proximityConfidence * 0.25) +
                (pastTrend === 'bearish' ? 0.35 : pastTrend === 'sideways' ? 0.15 : 0) +
                ((momentum / 100) * 0.25) +
                (zoneTouchDetected ? 0.15 : 0);
            
            // Short signal: breakout probability above zone
            const shortScore =
                (breakoutProbability * 0.4) +
                (proximityConfidence < 0.4 ? 0.35 : 0) +
                ((momentum / 100) * 0.25);
            
            if (longScore > 0.60) {
                overallBias = 'long';
            } else if (shortScore > 0.60) {
                overallBias = 'short';
            }
        } else {
            // Short signal: resistance zone with bullish rejection + momentum
            const shortScore = 
                (proximityConfidence * 0.25) +
                (pastTrend === 'bullish' ? 0.35 : pastTrend === 'sideways' ? 0.15 : 0) +
                ((momentum / 100) * 0.25) +
                (zoneTouchDetected ? 0.15 : 0);
            
            // Long signal: breakout probability below zone
            const longScore =
                (breakoutProbability * 0.4) +
                (proximityConfidence < 0.4 ? 0.35 : 0) +
                ((momentum / 100) * 0.25);
            
            if (shortScore > 0.60) {
                overallBias = 'short';
            } else if (longScore > 0.60) {
                overallBias = 'long';
            }
        }

        // 13. Strength metrics recalibrated
        const interactionStrength =
            (pastInteractionsToZoneCount * proximityScore * (momentum / 100)) / 100;
        const momentumStrength = momentum * volumeConfluence * normalizedVelocity;

        return {
            priceProximityCloseToZone,
            pastInteractionsToZoneCount,
            pastTrend,
            momentum,
            zoneWidth,
            zoneType: side === 'BUY' ? 'support' : 'resistance',
            zoneStrength,
            zoneTouchDetected,
            reactionVelocity: normalizedVelocity,
            volumeConfluence,
            currentCandleReversal:
                (side === 'BUY' && currentCandle.close > currentCandle.open) ||
                (side === 'SELL' && currentCandle.close < currentCandle.open),
            volatilityScore,
            proximityScore,
            proximityConfidence,
            signalConfidence,
            interactionStrength,
            momentumStrength,
            timeInZoneMs,
            breakoutProbability,
            overallBias,
            pastResistanceBreakCount,
            pastSupportBreakCount
        };
    }

    static computeVolumeAnalysis(
        candles: Candle[],
        currentPrice: number,
        lookback: number = 20
    ): VolumeAnalysis {
            if (candles.length < 2) throw new Error("Insufficient candles");

            const last = candles[candles.length - 1];
            const prev = candles[candles.length - 2];

            // Estimate buy/sell volume via candle delta
            const deltaPrice = last.close - prev.close;
            const totalVolume = last.volume;
            const deltaRatio = deltaPrice === 0 ? 0 : deltaPrice / last.close;
            const buyVolume = deltaPrice > 0 ? totalVolume * (0.5 + Math.min(Math.abs(deltaRatio) * 10, 0.5)) : totalVolume * 0.4;
            const sellVolume = totalVolume - buyVolume;
            const deltaVolume = buyVolume - sellVolume;

            // Rolling average and z-score
            const volumes = candles.slice(-lookback).map(c => c.volume);
            const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const variance = volumes.reduce((a, b) => a + Math.pow(b - avgVolume, 2), 0) / volumes.length;
            const stdDev = Math.sqrt(variance);
            const zScore = stdDev === 0 ? 0 : (last.volume - avgVolume) / stdDev;
            const spikeFlag = Math.abs(zScore) > 1;

            // Derived metrics
            const absorptionIndex = totalVolume / Math.max(Math.abs(deltaPrice), 0.000001);
            const deltaAlignment = deltaPrice * deltaVolume >= 0;
            const vwap = (last.high + last.low + last.close) / 3;
            const vwapDeviationPercent = ((currentPrice - vwap) / vwap) * 100;

            // Correlation volume-momentum (rudimentary)
            const returns = candles.slice(-lookback).map((c, i, arr) => i === 0 ? 0 : (c.close - arr[i - 1].close) / arr[i - 1].close);
            const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const meanVol = avgVolume;
            const cov = returns.map((r, i) => (r - meanReturn) * (candles[i].volume - meanVol)).reduce((a, b) => a + b, 0);
            const varR = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0);
            const corrVolumeMomentum = cov / Math.sqrt(varR * (volumes.reduce((a, b) => a + Math.pow(b - meanVol, 2), 0)));

            // Simplified pressure = cumulative delta
            const volumePressure = candles.slice(-lookback).reduce((a, c, i) => {
                if (i === 0) return a;
                const prevC = candles[i - 1];
                return a + (c.close - prevC.close) * c.volume;
            }, 0);

            return {
                totalVolume,
                buyVolume,
                sellVolume,
                deltaVolume,
                deltaRatio,
                avgVolumeLookback20: avgVolume,
                zScore,
                spikeFlag,
                absorptionIndex,
                deltaAlignment,
                corrVolumeMomentum: isNaN(corrVolumeMomentum) ? 0 : corrVolumeMomentum,
                vwap,
                vwapDeviationPercent,
                volumePressure
            };
        }

        static calculateATR(candlesList: Candle[], period = 14): number {
            if (candlesList.length < period + 1) return 0

            const trs = []
            for (let i = 1; i < candlesList.length; i++) {
                const c = candlesList[i]
                const prev = candlesList[i - 1]
                const tr = Math.max(
                    c.high - c.low,
                    Math.abs(c.high - prev.close),
                    Math.abs(c.low - prev.close)
                )
                trs.push(tr)
            }

            const atrSlice = trs.slice(-period)
            const atr = atrSlice.reduce((a, b) => a + b, 0) / atrSlice.length
            return atr
        }

        static computeSupportResistance(
            candlesList: Candle[],
            windowLength: number = 50
        ): { support: { lower: number; upper: number, mid: 0 }; resistance: { lower: number; upper: number, mid: number } } {
            if (!candlesList.length) return {
                support: { lower: 0, upper: 0, mid: 0 },
                resistance: { lower: 0, upper: 0, mid: 0 }
            }

            const WINDOW = Math.min(windowLength, candlesList.length)
            const recentCandles = candlesList.slice(-WINDOW - 1, -1)
            if (recentCandles.length === 0) return {
                support: { lower: 0, upper: 0, mid: 0 },
                resistance: { lower: 0, upper: 0, mid: 0 }
            }

            const swingLow = Math.min(...recentCandles.map(c => c.low))
            const swingHigh = Math.max(...recentCandles.map(c => c.high))

            let atr = this.calculateATR(recentCandles)
            if (!Number.isFinite(atr) || atr <= 0) atr = (swingHigh - swingLow) * 0.05

            const zoneBuffer = Math.abs(atr * 0.5)

            let supportLower = swingLow - zoneBuffer
            let supportUpper = swingLow + zoneBuffer
            let resistanceLower = swingHigh - zoneBuffer
            let resistanceUpper = swingHigh + zoneBuffer

            // Clamp negatives
            supportLower = Math.max(0, supportLower)
            supportUpper = Math.max(0, supportUpper)
            resistanceLower = Math.max(0, resistanceLower)
            resistanceUpper = Math.max(0, resistanceUpper)

            // Enforce proper ordering
            if (supportUpper > resistanceLower) {
                const mid = (supportUpper + resistanceLower) / 2
                supportUpper = mid * 0.99
                resistanceLower = mid * 1.01
            }

            return {
                support: { lower: supportLower, upper: supportUpper, mid: 0 },
                resistance: { lower: resistanceLower, upper: resistanceUpper, mid: 0 }
            }
        }

        static initializePastCandlesSupportResistance(_candles: Candle[], initSRLength: number, srPeriod:number) {
            for (let i = 1; i <= initSRLength; i++) {
                var candleIndex = (_candles.length - 1) - i;
                var history = _candles.slice(0,candleIndex + 1);
                const { support, resistance } = this.computeSupportResistance(history, srPeriod);

                _candles[candleIndex].support = Object.freeze({ lower: support.lower, upper: support.upper, mid: 0 });
                _candles[candleIndex].resistance = Object.freeze({ lower: resistance.lower, upper: resistance.upper, mid: 0 });

                const close = _candles[candleIndex].close ?? 0;

                _candles[candleIndex].breakthrough_resistance = close > resistance.upper;
                _candles[candleIndex].breakthrough_support = close < support.lower;
            }
        }

        static detectOverboughtOversold(
            volumeAnalysis: VolumeAnalysis,
            zoneAnalysis: ZoneAnalysis,
            candles: Candle[],
            lookback: number = 20
        ): OverboughtOversoldAnalysis {
            
            const {
                vwapDeviationPercent,
                corrVolumeMomentum,
                zScore,
                spikeFlag,
                deltaAlignment
            } = volumeAnalysis;

            const {
                proximityConfidence,
                momentum,
                volatilityScore,
                pastTrend
            } = zoneAnalysis;

            const signals: string[] = [];
            let score = 0; // -100 to +100

            // ========== COMPONENT 1: VWAP DEVIATION ==========
            // Measures how far price has deviated from volume-weighted average
            // Extreme deviations (>0.5%) suggest exhaustion (overbought/oversold)
            // LOWERED thresholds to catch oversold/overbought more easily
            
            const vwapDeviation = Math.abs(vwapDeviationPercent);
            let vwapComponent = 0;
            
            if (vwapDeviation > 1.0) {
                vwapComponent = vwapDeviationPercent > 0 ? 40 : -40; // Extreme
                signals.push(`Extreme VWAP deviation: ${vwapDeviationPercent.toFixed(2)}%`);
            } else if (vwapDeviation > 0.5) {
                vwapComponent = vwapDeviationPercent > 0 ? 25 : -25; // Moderate
                signals.push(`Notable VWAP deviation: ${vwapDeviationPercent.toFixed(2)}%`);
            } else if (vwapDeviation > 0.2) {
                vwapComponent = vwapDeviationPercent > 0 ? 12 : -12; // Slight
                signals.push(`Minor VWAP deviation: ${vwapDeviationPercent.toFixed(2)}%`);
            }

            // ========== COMPONENT 2: VOLUME-MOMENTUM CORRELATION ==========
            // High correlation = conviction (buyers/sellers backing it up)
            // Low/negative correlation = potential reversal (price moved but volume didn't follow)
            
            let volumeMomentumComponent = 0;
            
            if (corrVolumeMomentum < -0.3) {
                // Negative correlation: price moved WITHOUT volume support
                volumeMomentumComponent = vwapComponent > 0 ? -30 : 30; // Works against extreme
                signals.push(`Volume-Momentum divergence (${corrVolumeMomentum.toFixed(3)}): Weak conviction`);
            } else if (corrVolumeMomentum > 0.3) {
                // Positive correlation: volume confirms price move
                volumeMomentumComponent = vwapComponent > 0 ? 20 : -20; // Reinforces extreme
                signals.push(`Volume-Momentum alignment (${corrVolumeMomentum.toFixed(3)}): Strong conviction`);
            } else {
                // Near-zero correlation (like your data)
                signals.push(`Volume-Momentum uncorrelated (${corrVolumeMomentum.toFixed(3)}): Neutral signal`);
            }

            // ========== COMPONENT 3: MOMENTUM Z-SCORE ==========
            // How extreme is current candle momentum vs historical average?
            
            let momentumComponent = 0;
            
            if (Math.abs(zScore) > 2.5) {
                momentumComponent = zScore > 0 ? 35 : -35; // Extreme momentum
                signals.push(`Extreme momentum spike (z=${zScore.toFixed(2)}): ${zScore > 0 ? 'Overbought' : 'Oversold'}`);
            } else if (Math.abs(zScore) > 1.5) {
                momentumComponent = zScore > 0 ? 20 : -20; // Notable momentum
                signals.push(`Notable momentum (z=${zScore.toFixed(2)})`);
            } else if (spikeFlag) {
                momentumComponent = zScore > 0 ? 10 : -10; // Spike detected
                signals.push(`Volume spike detected but moderate momentum`);
            }

            // ========== COMPONENT 4: DELTA ALIGNMENT ==========
            // Does price direction match buy/sell pressure?
            // Misalignment = potential exhaustion
            
            let alignmentComponent = 0;
            
            if (!deltaAlignment) {
                // Price went up but more selling pressure, or vice versa
                alignmentComponent = vwapComponent > 0 ? -15 : 15; // Works against extreme
                signals.push(`Delta misalignment: Price and volume pressure diverging`);
            } else {
                alignmentComponent = 5; // Minor reinforcement
            }

            // ========== COMPONENT 5: TREND EXHAUSTION ==========
            // Long runs in one direction without pullback = exhaustion risk
            
            let exhaustionComponent = 0;
            const recentCandles = candles.slice(-lookback);
            const bullishCandles = recentCandles.filter(c => c.close > c.open).length;
            const bearishCandles = recentCandles.filter(c => c.close < c.open).length;
            
            if (bullishCandles > lookback * 0.75) {
                // 75%+ bullish candles = strong bullish exhaustion risk
                exhaustionComponent = Math.min(30, (bullishCandles / lookback) * 50);
                signals.push(`Bullish exhaustion: ${bullishCandles}/${lookback} candles up`);
            } else if (bearishCandles > lookback * 0.75) {
                // 75%+ bearish candles = strong bearish exhaustion risk
                exhaustionComponent = Math.min(-30, -(bearishCandles / lookback) * 50);
                signals.push(`Bearish exhaustion: ${bearishCandles}/${lookback} candles down`);
            }

            // ========== COMPONENT 6: VOLATILITY CONTRACTION ==========
            // Low volatility after big moves = setup for reversal
            
            let volatilityComponent = 0;
            
            if (volatilityScore < 0.2 && Math.abs(vwapComponent) > 20) {
                volatilityComponent = vwapComponent > 0 ? -10 : 10; // Low vol after extreme = reversal risk
                signals.push(`Low volatility (${volatilityScore.toFixed(2)}) after extreme move: Reversal likely`);
            } else if (volatilityScore > 0.8) {
                volatilityComponent = 5; // High vol supports continuation
            }

            // ========== AGGREGATE SCORE ==========
            score = 
                vwapComponent * 0.25 +           // VWAP is primary signal
                volumeMomentumComponent * 0.20 + // Divergence is critical
                momentumComponent * 0.20 +       // Extreme momentum
                alignmentComponent * 0.15 +      // Confirmation
                exhaustionComponent * 0.15 +     // Trend fatigue
                volatilityComponent * 0.05;      // Context

            // Clamp to -100 to +100
            score = Math.max(-100, Math.min(100, score));

            // ========== CLASSIFY LEVEL ==========
            let extremeLevel: 'extreme_overbought' | 'overbought' | 'neutral' | 'oversold' | 'extreme_oversold';
            
            if (score > 60) {
                extremeLevel = 'extreme_overbought';
            } else if (score > 30) {
                extremeLevel = 'overbought';
            } else if (score > -30 && score <= 30) {
                extremeLevel = 'neutral';
            } else if (score > -60) {
                extremeLevel = 'oversold';
            } else {
                extremeLevel = 'extreme_oversold';
            }

            // ========== REJECTION PROBABILITY ==========
            // Higher extreme level + lower momentum conviction = higher pullback probability
            
            const rejectionProbability = 
                Math.abs(score) / 100 * 0.6 +                    // Extreme level contributes 60%
                (Math.abs(corrVolumeMomentum) < 0.2 ? 0.25 : 0) + // Uncorrelated contributes 25%
                (volatilityScore < 0.3 ? 0.15 : 0);              // Low volatility contributes 15%

            // ========== CONFIDENCE IN THIS ASSESSMENT ==========
            // More signals = higher confidence
            
            const confidence = Math.min(1, signals.length / 5); // Max at 5+ signals

            return {
                extremeLevel,
                score,
                signals,
                confidence,
                rejectionProbability: Math.min(1, rejectionProbability)
            };
        }

        static capturePastReaction(
            candles: CandleEntry[],
            currentIndex: number,
            lookBackCandles: number = 5
        ): ReactionData | null {
            
            // Get the PAST X candles BEFORE current (backwards in time)
            const startIndex = Math.max(0, currentIndex - lookBackCandles);
            const pastCandles = candles.slice(startIndex, currentIndex);
            
            // Need enough candles to analyze
            if (pastCandles.length < lookBackCandles) {
                return null; // Not enough past candles
            }
            
            const currentCandle = candles[currentIndex];
            const baselinePrice = currentCandle.close;
            const baselineVolume = currentCandle.volume;
            
            // Analyze past candles (leading up to this zone interaction)
            let upCount = 0;
            let downCount = 0;
            let totalBodyStrength = 0;
            let highestPrice = baselinePrice;
            let lowestPrice = baselinePrice;
            let totalMomentum = 0;
            let totalVolume = 0;
            
            for (const candle of pastCandles) {
                const open = candle.open;
                const close = candle.close;
                const high = candle.high;
                const low = candle.low;
                const volume = candle.volume;
                const momentum = candle.zoneAnalysis?.momentum || 0;
                
                // Direction
                if (close > open) {
                    upCount++;
                } else {
                    downCount++;
                }
                
                // Body strength
                const range = high - low;
                if (range > 0) {
                    const bodySize = Math.abs(close - open);
                    totalBodyStrength += (bodySize / range) * 100;
                }
                
                // Price extremes
                highestPrice = Math.max(highestPrice, high);
                lowestPrice = Math.min(lowestPrice, low);
                
                // Volume and momentum
                totalVolume += volume;
                totalMomentum += momentum;
            }
            
            // Calculate summary
            const priceRange = highestPrice - lowestPrice;
            const avgMomentum = totalMomentum / pastCandles.length;
            const avgVolume = totalVolume / pastCandles.length;
            const volumeIncreased = avgVolume > baselineVolume;
            
            // Determine direction (what was the trend LEADING INTO this interaction?)
            let direction: "UP" | "DOWN" | "MIXED" = "MIXED";
            if (upCount > downCount + 1) {
                direction = "UP";  // Was trending UP before hitting zone
            } else if (downCount > upCount + 1) {
                direction = "DOWN"; // Was trending DOWN before hitting zone
            }
            
            // Calculate strength (0-100%)
            const strength = Math.abs((upCount - downCount) / pastCandles.length) * 100;
            
            return {
                direction,
                strength,
                highest_price: highestPrice,
                lowest_price: lowestPrice,
                price_range: priceRange,
                avg_momentum: avgMomentum,
                volume_increased: volumeIncreased
            };
        }

        static CalculateVolatility(candles: Candle[]): number {
            if (!candles || candles.length === 0) return 0;

            // Candle-to-candle close percentage changes
            const pctChanges = candles
                .slice(1)
                .map((c, i) => Math.abs((c.close - candles[i].close) / candles[i].close));

            // Intra-candle range volatility (high-low relative to open)
            const rangeVols = candles.map(c => (c.high - c.low) / c.open);

            // Average both components
            const avgPctChange = pctChanges.reduce((a, b) => a + b, 0) / pctChanges.length || 0;
            const avgRangeVol = rangeVols.reduce((a, b) => a + b, 0) / rangeVols.length || 0;

            // Final combined volatility metric
            return (avgPctChange + avgRangeVol) / 2;
        }
}
export const candleAnalyzer = CandlestickAnalyzer;