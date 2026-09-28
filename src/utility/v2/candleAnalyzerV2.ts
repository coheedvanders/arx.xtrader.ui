import type { PriceZone, VolumeProfile, VolumeProfileBucket } from "@/core/interfaces"
import type { CandleInfo } from "@/core/interfacesv2"

export class CandleAnalyzerV2 {
    /**
     * CandleInfo port of candleAnalyzer.getCandleChangeZScore (old
     * candleAnalyzerUtility.ts). The old one read candleData.change_percentage_v,
     * which is ((close - open) / open) * 100 rounded to 2dp; CandleInfo has no
     * candleData, so that is computed here the same way. Returns the z-score of
     * the LAST candle's absolute change against the last `length` candles
     * (itself included), or 0 when there aren't `length` candles yet.
     */
    static getCandleChangeZScore(candles: CandleInfo[], length: number): number {
        if (candles.length < length) return 0;

        const absChange = (c: CandleInfo): number | null => {
            if (!c.open) return null;
            return Math.abs(parseFloat((((c.close - c.open) / c.open) * 100).toFixed(2)));
        };

        const absChanges = candles
            .slice(-length)
            .map(absChange)
            .filter((v): v is number => v !== null && Number.isFinite(v));

        if (absChanges.length === 0) return 0;

        const mean = absChanges.reduce((a, b) => a + b, 0) / absChanges.length;
        const variance = absChanges.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / absChanges.length;
        const stdDev = Math.sqrt(variance);

        const latestAbsChange = absChange(candles[candles.length - 1]);
        if (latestAbsChange === null || !Number.isFinite(latestAbsChange)) return 0;

        return stdDev === 0 ? 0 : (latestAbsChange - mean) / stdDev;
    }

    /**
     * CandleInfo port of candleAnalyzer.hasVolumeSpike (old
     * candleAnalyzerUtility.ts): the LAST candle in `candles` is a spike
     * when its volume is >= multiplier x the average of the previous
     * `lookbackPeriod` candles' (non-zero) volume AND >= their max.
     */
    static hasVolumeSpike(candles: CandleInfo[], lookbackPeriod: number = 20, multiplier: number = 1.8): boolean {
        if (candles.length < lookbackPeriod + 1) return false;

        const currentVolume = candles[candles.length - 1].volume;
        if (!currentVolume || currentVolume === 0) return false;

        const pastVolumes = candles
            .slice(-lookbackPeriod - 1, -1)
            .map(c => c.volume)
            .filter(v => v && v > 0);

        if (pastVolumes.length === 0) return false;

        const avgVolume = pastVolumes.reduce((sum, v) => sum + v, 0) / pastVolumes.length;
        const maxVolume = Math.max(...pastVolumes);

        return currentVolume >= avgVolume * multiplier && currentVolume >= maxVolume;
    }

    /**
     * Average true range: the mean of the last `period` true ranges.
     *
     * =====================================================================
     * O(period), NOT O(n). SAME NUMBER, MUCH LESS WORK.
     * =====================================================================
     * The previous form built a true range for EVERY candle in the list and
     * then threw all but the last `period` away. `runAnalysis` calls this once
     * per candle with the list grown to that candle, so across one 500-candle
     * pass the old form did
     *
     *     sum over i of (i - 1)  =  ~125,000 true-range computations
     *
     * to produce 500 numbers that need 4,000. One rolling run reported 158,647
     * analysed symbol-ticks, so that is roughly 20 BILLION discarded true
     * ranges in a single run - for a quantity whose definition only ever looks
     * at the last eight candles.
     *
     * THE OUTPUT IS IDENTICAL, not merely close, and that is checkable rather
     * than asserted. The old code took `trs.slice(-period)`, which is the true
     * ranges of candles n-period..n-1, and divided by `atrSlice.length`. The
     * early return guarantees n >= period + 1, so there are always at least
     * `period` true ranges available and that length is exactly `period` - the
     * same candles and the same divisor this loop uses. Verified two ways:
     * against the old implementation on real archive candles, and against the
     * 275,054 ATR values the lab itself stored.
     *
     * The guard still reads the FULL length, because "is there enough history"
     * is a question about the whole list, not about the window being summed.
     */
    static calculateATR(candlesList: CandleInfo[], period = 14): number {
        const n = candlesList.length
        if (n < period + 1) return 0

        let sum = 0
        for (let i = n - period; i < n; i++) {
            const c = candlesList[i]
            const prev = candlesList[i - 1]
            sum += Math.max(
                c.high - c.low,
                Math.abs(c.high - prev.close),
                Math.abs(c.low - prev.close)
            )
        }
        return sum / period
    }

    /**
     * Exponential moving average of the closes.
     *
     * =====================================================================
     * THE THIRD PARAMETER IS NOT OPTIONAL SUGAR — IT WAS ALREADY BEING PASSED
     * =====================================================================
     * `runAnalysis` calls this as
     *
     *     calculateEMA(movingCandles, 200, candles[i - 1]?.ema200)
     *
     * and its comment says the previous value "lets calculateEMA take its
     * incremental path (one more step) instead of re-converging from index 200
     * every single candle". This function did not accept a third argument, so
     * JavaScript discarded it silently and the incremental path did not exist:
     * every candle re-converged the EMA over the whole growing window, which is
     * the same quadratic shape calculateATR had.
     *
     * A signature that cannot receive what a caller passes is the quiet kind of
     * bug — nothing errors, the numbers are right, and the run is slow for a
     * reason no measurement points at.
     *
     * BIT-IDENTICAL, not approximately equal. The full loop's last iteration is
     *     ema_i = close_i * k + ema_(i-1) * (1 - k)
     * and `previousEma` IS ema_(i-1), computed by this function on the same list
     * minus its last candle. The incremental path performs exactly that one
     * operation on exactly those operands, so it produces the same double.
     *
     * It falls back to the full computation whenever the previous value is
     * missing or not finite, so the first candle of a window, a NaN carried in
     * from anywhere, and every existing two-argument caller all behave as before.
     */
    static calculateEMA(candlesList: CandleInfo[], period: number, previousEma?: number): number {
        const n = candlesList.length
        if (n < period) return 0

        const k = 2 / (period + 1)

        // Incremental step. Requires n > period, because at exactly n === period
        // the value is the seed SMA and there is no step to take.
        if (previousEma !== undefined && Number.isFinite(previousEma) && n > period) {
            return (candlesList[n - 1].close * k) + (previousEma * (1 - k))
        }

        // Start with SMA of first `period` candles
        let ema = 0
        for (let i = 0; i < period; i++) {
            ema += candlesList[i].close
        }
        ema = ema / period

        // Apply EMA formula to ALL candles from index `period` onwards to converge
        for (let i = period; i < n; i++) {
            ema = (candlesList[i].close * k) + (ema * (1 - k))
        }

        return ema
    }

    static getVolumeProfile(
      candles: CandleInfo[],
      numBuckets: number = 24,
      valueAreaPercent: number = 0.7,
    ): VolumeProfile | null {
      if (candles.length === 0) return null
    
      let rangeLow = Infinity
      let rangeHigh = -Infinity
      for (const c of candles) {
        if (c.low == null || c.high == null) continue
        if (c.low < rangeLow) rangeLow = c.low
        if (c.high > rangeHigh) rangeHigh = c.high
      }
      if (!isFinite(rangeLow) || !isFinite(rangeHigh) || rangeHigh <= rangeLow) return null
    
      const bucketHeight = (rangeHigh - rangeLow) / numBuckets
      const rawBuckets = Array.from({ length: numBuckets }, (_, i) => ({
        priceLow: rangeLow + i * bucketHeight,
        priceHigh: rangeLow + (i + 1) * bucketHeight,
        buyVolume: 0,
        sellVolume: 0,
      }))
    
      for (const c of candles) {
        const low = c.low
        const high = c.high
        const vol = c.volume ?? 0
        if (low == null || high == null || vol <= 0 || high <= low) continue
        const isBull = (c.close ?? 0) >= (c.open ?? 0)
        for (const b of rawBuckets) {
          const overlapLow = Math.max(low, b.priceLow)
          const overlapHigh = Math.min(high, b.priceHigh)
          if (overlapHigh > overlapLow) {
            const frac = (overlapHigh - overlapLow) / (high - low)
            const v = vol * frac
            if (isBull) b.buyVolume += v
            else b.sellVolume += v
          }
        }
      }
    
      let maxRowTotal = 0
      let pocIndex = 0
      rawBuckets.forEach((b, i) => {
        const total = b.buyVolume + b.sellVolume
        if (total > maxRowTotal) {
          maxRowTotal = total
          pocIndex = i
        }
      })
    
      const buckets: VolumeProfileBucket[] = rawBuckets.map((b, i) => ({
        priceLow: b.priceLow,
        priceHigh: b.priceHigh,
        buyVolume: b.buyVolume,
        sellVolume: b.sellVolume,
        totalVolume: b.buyVolume + b.sellVolume,
        isPoc: i === pocIndex,
      }))
    
      const pocBucket = buckets[pocIndex]
      const pocPrice = (pocBucket.priceLow + pocBucket.priceHigh) / 2
      const totalBuyVolume = buckets.reduce((s, b) => s + b.buyVolume, 0)
      const totalSellVolume = buckets.reduce((s, b) => s + b.sellVolume, 0)
      const totalVolume = totalBuyVolume + totalSellVolume
    
      // Value area: start at the POC and keep expanding outward to whichever
      // neighboring side (above/below) has more volume, until the accumulated
      // volume reaches valueAreaPercent of the total (standard TPO/VP method).
      let vaLowIndex = pocIndex
      let vaHighIndex = pocIndex
      let vaVolume = pocBucket.totalVolume
      const targetVolume = totalVolume * valueAreaPercent
    
      while (vaVolume < targetVolume && (vaLowIndex > 0 || vaHighIndex < buckets.length - 1)) {
        const belowVolume = vaLowIndex > 0 ? buckets[vaLowIndex - 1].totalVolume : -1
        const aboveVolume = vaHighIndex < buckets.length - 1 ? buckets[vaHighIndex + 1].totalVolume : -1
    
        if (aboveVolume >= belowVolume) {
          vaHighIndex++
          vaVolume += buckets[vaHighIndex].totalVolume
        } else {
          vaLowIndex--
          vaVolume += buckets[vaLowIndex].totalVolume
        }
      }
    
      return {
        rangeLowPrice: rangeLow,
        rangeHighPrice: rangeHigh,
        buckets,
        pocPrice,
        pocBucket,
        totalVolume,
        totalBuyVolume,
        totalSellVolume,
        valueAreaHigh: buckets[vaHighIndex].priceHigh,
        valueAreaLow: buckets[vaLowIndex].priceLow,
        valueAreaVolumePercent: totalVolume > 0 ? vaVolume / totalVolume : 0,
      }
    }

    static getAnchorVwapBandMultiplier(): number{
        return 2
    }
    
    static getAnchorVwap(candleEntries: CandleInfo[]): PriceZone {
      let cumPV = 0;   // Σ (typicalPrice * volume)
      let cumPV2 = 0;  // Σ (typicalPrice² * volume) — for weighted variance
      let cumVol = 0;  // Σ volume
     
      let mid = 0;
      let stdev = 0;
    
      let ANCHORED_VWAP_BAND_MULTIPLIER = 2;
     
      for (const c of candleEntries) {
        if (c.high == null || c.low == null || c.close == null) continue;
     
        const typical = (c.high + c.low + c.close) / 3;
        const vol = c.volume ?? 0;
     
        cumPV += typical * vol;
        cumPV2 += typical * typical * vol;
        cumVol += vol;
     
        if (cumVol <= 0) continue;
     
        mid = cumPV / cumVol;
        const variance = Math.max(cumPV2 / cumVol - mid * mid, 0);
        stdev = Math.sqrt(variance);
      }
     
      return {
        mid,
        upper: mid + stdev * this.getAnchorVwapBandMultiplier(),
        lower: mid - stdev * this.getAnchorVwapBandMultiplier(),
      };
    }
}