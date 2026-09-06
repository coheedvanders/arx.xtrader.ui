import type { PriceZone, VolumeProfile, VolumeProfileBucket } from "@/core/interfaces"
import type { CandleInfo } from "@/core/interfacesv2"

export class CandleAnalyzerV2 {
    static calculateATR(candlesList: CandleInfo[], period = 14): number {
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

    static calculateEMA(candlesList: CandleInfo[], period: number): number {
        if (candlesList.length < period) return 0

        const k = 2 / (period + 1)

        // Start with SMA of first `period` candles
        let ema = 0
        for (let i = 0; i < period; i++) {
            ema += candlesList[i].close
        }
        ema = ema / period

        // Apply EMA formula to ALL candles from index `period` onwards to converge
        for (let i = period; i < candlesList.length; i++) {
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