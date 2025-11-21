import type { BreakoutStartScore, CandleEntry, PriceZone, PriceZoneInteraction } from "@/core/interfaces";

export class PriceZoneUtility {
    static generatePrizeZone(candles:CandleEntry[], lookBackLength:number): PriceZone{

        var highestPrice = Math.max(...candles.map(c => Math.max(c.open, c.close)));
        var lowestPrice = Math.min(...candles.map(c => Math.min(c.open, c.close)));

        var highestTopWickPrice = Math.max(...candles.map(c => c.high));
        var lowestBottomWickPrice = Math.min(...candles.map(c => c.low));

        var upperZone = highestPrice + ((highestTopWickPrice - highestPrice) / 2)
        var lowerZone = lowestPrice - ((lowestPrice - lowestBottomWickPrice) / 2)
        var midZone = (upperZone + lowerZone) / 2

        return {
            upper: upperZone,
            mid: midZone,
            lower: lowerZone
        }
    }

    static analyzeZoneInteraction(
        candles: CandleEntry[],
        priceZone: PriceZone,
        lookbackCandles: number
    ): PriceZoneInteraction {
        const currentCandle = candles[candles.length - 1];
        const recentCandles = candles.slice(-lookbackCandles);
        const zoneMidpoint = (priceZone.upper + priceZone.lower) / 2;
        const zoneHeight = priceZone.upper - priceZone.lower;
        
        let touchCount = 0;
        let bounceCount = 0;
        let breakoutCount = 0;
        let timeInZone = 0;
        let timeOutsideZone = 0;
        let totalDistanceFromCenter = 0;
        let upperTouches = 0;
        let lowerTouches = 0;
        let lastInteraction: "touch" | "bounce" | "breakout" | null = null;
        let volatilityInZone = 0;
        let volatilityOutsideZone = 0;
        let inZoneCount = 0;
        let outZoneCount = 0;
        let breakoutVelocities: number[] = [];
        let approachVelocities: number[] = [];
        let bullishBreakouts = 0;
        let bearishBreakouts = 0;
        let lastBreakoutChange = 0;

        // Analyze historical candles
        for (let i = 0; i < recentCandles.length; i++) {
            const candle = recentCandles[i];
            const prevCandle = i > 0 ? recentCandles[i - 1] : null;
            const close = candle.close;
            const range = candle.high - candle.low;

            const isInside = close > priceZone.lower && close < priceZone.upper;
            
            if (isInside) {
                timeInZone++;
                inZoneCount++;
                volatilityInZone += range;
                totalDistanceFromCenter += Math.abs(close - zoneMidpoint);
            } else {
                timeOutsideZone++;
                outZoneCount++;
                volatilityOutsideZone += range;
            }

            const touchesUpper = candle.high >= priceZone.upper && close < priceZone.upper;
            const touchesLower = candle.low <= priceZone.lower && close > priceZone.lower;
            
            if (touchesUpper || touchesLower) {
                touchCount++;
                if (touchesUpper) upperTouches++;
                if (touchesLower) lowerTouches++;
                lastInteraction = "touch";

                if (prevCandle) {
                    const distanceToBoundary = touchesUpper 
                        ? priceZone.upper - prevCandle.close 
                        : prevCandle.close - priceZone.lower;
                    const velocity = Math.abs(close - prevCandle.close) / Math.max(1, distanceToBoundary);
                    approachVelocities.push(velocity);
                }
            }

            if (prevCandle) {
                const prevClose = prevCandle.close;
                
                if (touchesUpper && close < prevClose) {
                    bounceCount++;
                    lastInteraction = "bounce";
                }
                
                if (touchesLower && close > prevClose) {
                    bounceCount++;
                    lastInteraction = "bounce";
                }
            }

            if (prevCandle) {
                const prevInside = prevCandle.close > priceZone.lower && prevCandle.close < priceZone.upper;
                const currentOutside = !isInside;
                
                if (prevInside && currentOutside) {
                    breakoutCount++;
                    lastInteraction = "breakout";

                    const distanceFromZone = close > priceZone.upper 
                        ? close - priceZone.upper 
                        : priceZone.lower - close;
                    const velocity = distanceFromZone / zoneHeight;
                    breakoutVelocities.push(velocity);

                    if (close > priceZone.upper) {
                        bullishBreakouts++;
                    } else {
                        bearishBreakouts++;
                    }
                }
            }
        }

        // Calculate averages
        const avgVolatilityInZone = inZoneCount > 0 ? volatilityInZone / inZoneCount : 0;
        const avgVolatilityOutsideZone = outZoneCount > 0 ? volatilityOutsideZone / outZoneCount : 0;
        const volatilityRatio = avgVolatilityOutsideZone > 0 
            ? avgVolatilityInZone / avgVolatilityOutsideZone 
            : 1;
        
        const avgBreakoutVelocity = breakoutVelocities.length > 0
            ? breakoutVelocities.reduce((a, b) => a + b) / breakoutVelocities.length
            : 0;
        
        const avgApproachVelocity = approachVelocities.length > 0
            ? approachVelocities.reduce((a, b) => a + b) / approachVelocities.length
            : 0;

        let momentumOnBreakout: "strong" | "moderate" | "weak" | null = null;
        if (avgBreakoutVelocity > 0.5) {
            momentumOnBreakout = "strong";
        } else if (avgBreakoutVelocity > 0.2) {
            momentumOnBreakout = "moderate";
        } else if (breakoutCount > 0) {
            momentumOnBreakout = "weak";
        }

        let pressureDirection: "bullish" | "bearish" | "neutral" = "neutral";
        if (bullishBreakouts > bearishBreakouts * 1.5) {
            pressureDirection = "bullish";
        } else if (bearishBreakouts > bullishBreakouts * 1.5) {
            pressureDirection = "bearish";
        }

        const timeInZoneRatio = timeInZone / (timeInZone + timeOutsideZone);
        const breakoutPenalty = Math.min(breakoutCount * 15, 40);
        const touchBonus = Math.min(touchCount * 5, 30);
        const strengthScore = Math.max(0, Math.min(100, 
            (timeInZoneRatio * 50) + touchBonus - breakoutPenalty
        ));

        // Distance to midpoint
        const distanceToMidpoint = Math.abs(currentCandle.close - zoneMidpoint);
        const distanceAsPercentOfZone = (distanceToMidpoint / zoneHeight) * 100;
        
        let proximityToMid: "very_close" | "close" | "mid" | "far";
        if (distanceAsPercentOfZone < 5) {
            proximityToMid = "very_close";
        } else if (distanceAsPercentOfZone < 15) {
            proximityToMid = "close";
        } else if (distanceAsPercentOfZone < 30) {
            proximityToMid = "mid";
        } else {
            proximityToMid = "far";
        }

        // Calculate last breakout change
        if (lastInteraction == 'breakout') {
            if (currentCandle.close > priceZone.upper) {
                lastBreakoutChange = ((currentCandle.close - priceZone.upper) / priceZone.upper) * 100;
            } else if (currentCandle.close < priceZone.lower) {
                lastBreakoutChange = ((currentCandle.close - priceZone.lower) / priceZone.lower) * 100;
            }
        }

        // Detect breakout type and score
        let breakoutType: "breakout_start" | "breakout_cont" | null = null;
        let breakoutStartScore: BreakoutStartScore | null = null;

        const isCurrentOpen = currentCandle.open > priceZone.lower && currentCandle.open < priceZone.upper;
        const isCurrentCloseOutside = currentCandle.close > priceZone.upper || currentCandle.close < priceZone.lower;
        const isCurrentOpenOutside = currentCandle.open > priceZone.upper || currentCandle.open < priceZone.lower;

        if (isCurrentOpen && isCurrentCloseOutside) {
            breakoutType = "breakout_start";
            breakoutStartScore = this.scoreBreakoutStart(currentCandle, recentCandles, priceZone, zoneHeight, candles);
        } else if (isCurrentOpenOutside && isCurrentCloseOutside) {
            breakoutType = "breakout_cont";
        }

        return {
            touchCount,
            bounceCount,
            breakoutCount,
            timeInZone,
            timeOutsideZone,
            avgDistanceFromCenter: recentCandles.length > 0 ? totalDistanceFromCenter / recentCandles.length : 0,
            extremePoint: upperTouches > lowerTouches ? "upper" : lowerTouches > upperTouches ? "lower" : null,
            strengthScore: Math.round(strengthScore),
            lastInteraction,
            volatilityInZone: Math.round(avgVolatilityInZone * 100) / 100,
            volatilityOutsideZone: Math.round(avgVolatilityOutsideZone * 100) / 100,
            volatilityRatio: Math.round(volatilityRatio * 100) / 100,
            breakoutVelocity: Math.round(avgBreakoutVelocity * 100) / 100,
            approachVelocity: Math.round(avgApproachVelocity * 100) / 100,
            momentumOnBreakout,
            pressureDirection,
            distanceToMid: proximityToMid,
            lastBreakoutChange: Math.round(lastBreakoutChange * 100) / 100,
            breakoutType,
            breakoutStartScore
        };
    }

    private static scoreBreakoutStart(
        currentCandle: CandleEntry,
        recentCandles: CandleEntry[],
        priceZone: { upper: number; lower: number },
        zoneHeight: number,
        allCandles: CandleEntry[]
    ): BreakoutStartScore {
        // 1. MOMENTUM SCORE (0-25)
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        const totalRange = currentCandle.high - currentCandle.low;
        const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;
        const penetrationDistance = currentCandle.close > priceZone.upper
            ? currentCandle.close - priceZone.upper
            : priceZone.lower - currentCandle.close;
        const penetrationPercent = (penetrationDistance / priceZone.upper) * 100;
        const momentumScore = Math.min(25, (penetrationPercent / 2) + (bodyRatio * 10));

        // LOOK-AHEAD: Check if next 3 candles continue in breakout direction
        const currentIndex = allCandles.indexOf(currentCandle);
        let continuationScore = 0;
        let nextCandlesContinue = 0;
        
        if (currentIndex !== -1 && currentIndex < allCandles.length - 1) {
            const nextCandles = allCandles.slice(currentIndex + 1, Math.min(currentIndex + 4, allCandles.length));
            const breakoutDirection = currentCandle.close > priceZone.upper ? 'up' : 'down';
            
            for (const nextCandle of nextCandles) {
                if (breakoutDirection === 'up' && nextCandle.close > currentCandle.close) {
                    nextCandlesContinue++;
                } else if (breakoutDirection === 'down' && nextCandle.close < currentCandle.close) {
                    nextCandlesContinue++;
                }
            }
            
            // Continuation bonus: if 2+ candles continue, boost score
            continuationScore = nextCandlesContinue >= 2 ? 15 : nextCandlesContinue === 1 ? 8 : 0;
        }

        // 2. SUSTAINABILITY SCORE (0-25)
        let sustainabilityScore = 12;
        
        // Check if previous candles show consistent direction
        if (recentCandles.length >= 2) {
            const prevCandleIdx = Math.max(0, recentCandles.length - 2);
            const prevCandle = recentCandles[prevCandleIdx];
            
            if (prevCandle?.priceZoneInteraction) {
                const prevIA = prevCandle.priceZoneInteraction;
                
                // Check direction consistency
                if (prevIA.pressureDirection !== 'neutral') {
                    const isConsistent = 
                        (currentCandle.close > priceZone.upper && prevIA.pressureDirection === 'bullish') ||
                        (currentCandle.close < priceZone.lower && prevIA.pressureDirection === 'bearish');
                    
                    sustainabilityScore = isConsistent ? 22 : 8;
                }
            }
        }

        // 3. VOLUME PROFILE SCORE (0-20)
        const volumeScore = Math.min(20, (penetrationDistance / zoneHeight) * 40);

        // 4. REJECTION STRENGTH SCORE (0-15)
        const upperWick = currentCandle.high - currentCandle.close;
        const lowerWick = currentCandle.close - currentCandle.low;
        const rejectionScore = currentCandle.close > priceZone.upper
            ? Math.max(0, 15 - (upperWick / totalRange) * 25)
            : Math.max(0, 15 - (lowerWick / totalRange) * 25);

        const compositeScore = momentumScore + sustainabilityScore + volumeScore + rejectionScore;

        let recommendation: "strong_buy" | "moderate_buy" | "weak_buy" | "skip";
        if (compositeScore >= 70) {
            recommendation = "strong_buy";
        } else if (compositeScore >= 55) {
            recommendation = "moderate_buy";
        } else if (compositeScore >= 40) {
            recommendation = "weak_buy";
        } else {
            recommendation = "skip";
        }

        return {
            momentumScore: Math.round(momentumScore * 100) / 100,
            sustainabilityScore: Math.round(sustainabilityScore * 100) / 100,
            volumeProfile: Math.round(volumeScore * 100) / 100,
            rejectionStrength: Math.round(rejectionScore * 100) / 100,
            compositeScore: Math.round(compositeScore * 100) / 100,
            recommendation
        };
    }
    
}