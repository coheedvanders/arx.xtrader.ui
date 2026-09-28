import type {
    CandleInfo,
    VolumeState,
    VOLUME_STATE,
    TrendVolumeRunningStats,
} from "@/core/interfacesv2";

const CONFIG = {
    MIN_LOOKBACK: 5,
    NORMAL_LOOKBACK: 12,
    COMPRESSION_LOOKBACK: 20,
    MAX_LOOKBACK: 30,

    EXPANSION_LOOKBACK: 5,

    EXPANSION_THRESHOLD: 1.25,
    STRONG_EXPANSION_THRESHOLD: 2.0,

    CONTRACTION_THRESHOLD: 0.75,
    STRONG_CONTRACTION_THRESHOLD: 0.5,

    FLAT_CHANGE_THRESHOLD_PERCENT: 10,

    STRENGTH_MAX_RELATIVE_VOLUME: 3.0,
};

function getAdaptiveLookback(
    previousCandles: CandleInfo[]
): number {

    if (!previousCandles.length) {
        return CONFIG.NORMAL_LOOKBACK;
    }

    const recent = previousCandles.slice(
        Math.max(0, previousCandles.length - 3)
    );

    const hasCompression = recent.some(
        candle =>
            candle.candleStructure?.isCompression === true
    );

    const hasExpansion = recent.some(
        candle =>
            candle.candleStructure?.isExpansion === true
    );

    const hasDisplacement = recent.some(
        candle =>
            candle.priceAction?.displacement?.detected === true
    );

    const hasBreakout =
        recent.some(
            candle =>
                candle.priceAction?.breakout?.detected === true
        );

    const hasReclaim =
        recent.some(
            candle =>
                candle.priceAction?.reclaim?.detected === true
        );

    const hasLiquiditySweep =
        recent.some(
            candle =>
                candle.priceAction?.liquiditySweep?.detected === true
        );

    /*
     * A structural event means the market may have
     * transitioned into a new volume regime.
     *
     * Use a short baseline so the previous regime
     * does not dominate the calculation.
     */
    if (
        hasDisplacement ||
        hasBreakout ||
        hasReclaim ||
        hasLiquiditySweep
    ) {
        return CONFIG.EXPANSION_LOOKBACK;
    }

    /*
     * During expansion, volume can change rapidly.
     */
    if (hasExpansion) {
        return CONFIG.EXPANSION_LOOKBACK;
    }

    /*
     * Compression provides a more stable auction.
     * A longer baseline gives us a better estimate
     * of normal volume during the range.
     */
    if (hasCompression) {
        return CONFIG.COMPRESSION_LOOKBACK;
    }

    return CONFIG.NORMAL_LOOKBACK;
}

/**
 * Z-score of the current candle's volume against its OWN trend
 * segment's prior volume (trendState.startGi..endGi, excluding this
 * candle) - a structural baseline instead of a rolling one. Returns 0
 * when the candle isn't currently classified into a trend at all
 * (trendState null - e.g. an undetermined/retracement candle between
 * segments), or when the trend hasn't produced enough PRIOR candles
 * yet to have a baseline (e.g. this candle IS the trend's own start).
 *
 * Safe to trust trendState.endGi at face value here even though it
 * can retroactively extend as a live trend continues (see
 * TrendSegmentInfo's own doc comment) - this runs inside the same
 * forward-only loop that builds movingCandles, so endGi on the
 * CURRENT candle can never exceed the current index; nothing beyond
 * "now" has been processed yet to have extended it.
 */
/**
 * Z-score of the current candle's volume against its OWN trend
 * segment's prior volume (trendState.startGi..endGi, excluding this
 * candle) - a structural baseline instead of a rolling one. Returns 0
 * when the candle isn't currently classified into a trend at all
 * (trendState null - e.g. an undetermined/retracement candle between
 * segments), or when the trend hasn't produced enough PRIOR candles
 * yet to have a baseline (e.g. this candle IS the trend's own start).
 *
 * Safe to trust trendState.endGi at face value here even though it
 * can retroactively extend as a live trend continues (see
 * TrendSegmentInfo's own doc comment) - this runs inside the same
 * forward-only loop that builds movingCandles, so endGi on the
 * CURRENT candle can never exceed the current index; nothing beyond
 * "now" has been processed yet to have extended it.
 *
 * Maintains a running sum/sumSq/count instead of re-slicing and
 * re-summing [trendStartGi, trendEndGiExclusive] from scratch on every
 * call - that re-scan was a confirmed, significant cost (this was the
 * single largest remaining item in a full profiling pass), scaling
 * with how long the current segment has run so far. The incremental
 * path only fires when the previous stats are for the SAME segment and
 * cover exactly one candle less than needed now (previousStats.trendStartGi
 * matches, previousStats.upToGiInclusive === trendEndGiExclusive - 1) -
 * any other case (new segment, gap, no previous stats) falls back to a
 * fresh scan, so correctness never depends on the caller's own bookkeeping
 * being perfect. Variance computed via the sum-of-squares identity
 * (sumSq/n - mean^2) rather than the original two-pass form - verified
 * numerically safe for realistic volume magnitudes (max relative
 * difference ~1e-13 across 5000 randomized trials) before being used
 * here.
 */
function getTrendZScore(
    movingCandles: CandleInfo[],
    currentCandle: CandleInfo,
    currentVolume: number,
    previousStats?: TrendVolumeRunningStats,
    asOfTrendStartGi?: number | null
): { trendZScore: number; newStats: TrendVolumeRunningStats | null } {

    const currentGlobalIndex = movingCandles.length - 1;

    // Preferred: the as-of trend's pivot, passed by runAnalysis from the
    // trend tracker. That is known on EVERY candle once a direction exists,
    // including pullback candles - reading candle.trendState instead left
    // this at 0 on ~89% of candles, because trendState is only set on a
    // candle that extends or commits the trend at its own step.
    // Fallback (no caller passes it): the old candle.trendState read.
    let rawStartGi: number;
    let rawEndGi: number;
    if (asOfTrendStartGi !== undefined) {
        if (asOfTrendStartGi === null) return { trendZScore: 0, newStats: null };
        rawStartGi = asOfTrendStartGi;
        rawEndGi = currentGlobalIndex;
    } else {
        const trendState = currentCandle.trendState;
        if (!trendState) return { trendZScore: 0, newStats: null };
        rawStartGi = trendState.startGi;
        rawEndGi = trendState.endGi;
    }

    const trendStartGi = Math.max(0, rawStartGi);
    const trendEndGiExclusive =
        Math.min(rawEndGi, currentGlobalIndex) - 1;

    if (trendEndGiExclusive < trendStartGi) {
        return { trendZScore: 0, newStats: null };
    }

    let sum: number, sumSq: number, count: number;

    if (
        previousStats &&
        previousStats.trendStartGi === trendStartGi &&
        previousStats.upToGiInclusive === trendEndGiExclusive - 1
    ) {
        // Extend incrementally: exactly one new term, at the position
        // the range just grew into.
        const newTerm = movingCandles[trendEndGiExclusive].volume;
        sum = previousStats.sum + newTerm;
        sumSq = previousStats.sumSq + newTerm * newTerm;
        count = previousStats.count + 1;
    } else {
        // Fresh scan - new segment, a gap, or no usable previous stats.
        sum = 0; sumSq = 0; count = 0;
        for (let j = trendStartGi; j <= trendEndGiExclusive; j++) {
            const v = movingCandles[j].volume;
            sum += v;
            sumSq += v * v;
            count++;
        }
    }

    const newStats: TrendVolumeRunningStats = { trendStartGi, sum, sumSq, count, upToGiInclusive: trendEndGiExclusive };

    if (count === 0) {
        return { trendZScore: 0, newStats };
    }

    const trendMeanVolume = sum / count;

    if (trendMeanVolume <= 0) {
        return { trendZScore: 0, newStats };
    }

    const trendVariance = Math.max(0, (sumSq / count) - (trendMeanVolume * trendMeanVolume));
    const trendStdDev = Math.sqrt(trendVariance);

    const trendZScore = trendStdDev > 0
        ? (currentVolume - trendMeanVolume) / trendStdDev
        : 0;

    return { trendZScore, newStats };
}

export function getVolumeState(
    movingCandles: CandleInfo[],
    previousTrendVolumeStats?: TrendVolumeRunningStats,
    /** As-of trend pivot index (see getTrendZScore). null = no trend known yet. Omit for the old candle.trendState behaviour. */
    asOfTrendStartGi?: number | null
): VolumeState {

    if (!movingCandles.length) {
        return {
            value: 0,
            averageVolume: 0,
            relativeVolume: 0,
            dynamicZScore: 0,
            trendZScore: 0,
            volumeChange: 0,
            volumeChangePercent: 0,
            state: "NEUTRAL",
            strength: 0,
            timestamp: 0,
            reasons: [
                "No candle data available",
            ],
        };
    }

    const currentCandle =
        movingCandles[movingCandles.length - 1];

    const currentVolume =
        currentCandle.volume;

    if (currentVolume <= 0) {
        return {
            value: currentVolume,
            averageVolume: 0,
            relativeVolume: 0,
            dynamicZScore: 0,
            trendZScore: 0,
            volumeChange: 0,
            volumeChangePercent: 0,
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                "Volume data unavailable",
            ],
        };
    }

    /*
     * IMPORTANT:
     *
     * The current candle is excluded from the baseline.
     * This prevents a volume spike from increasing its
     * own reference average.
     */
    // Only the tail is ever read (lookback <= MAX_LOOKBACK, plus the last 3
    // for getAdaptiveLookback), so copy just that instead of the whole
    // history - on a long captured run a full copy per candle is O(n^2).
    const previousCandles =
        movingCandles.slice(
            Math.max(0, movingCandles.length - 1 - (CONFIG.MAX_LOOKBACK + 3)),
            movingCandles.length - 1
        );

    if (!previousCandles.length) {
        return {
            value: currentVolume,
            averageVolume: currentVolume,
            relativeVolume: 1,
            dynamicZScore: 0,
            trendZScore: 0,
            volumeChange: 0,
            volumeChangePercent: 0,
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                "Insufficient volume history",
            ],
        };
    }

    const lookback =
        Math.min(
            CONFIG.MAX_LOOKBACK,
            Math.max(
                CONFIG.MIN_LOOKBACK,
                getAdaptiveLookback(previousCandles)
            )
        );

    const baselineCandles =
        previousCandles.slice(
            Math.max(
                0,
                previousCandles.length - lookback
            )
        );

    if (!baselineCandles.length) {
        return {
            value: currentVolume,
            averageVolume: currentVolume,
            relativeVolume: 1,
            dynamicZScore: 0,
            trendZScore: 0,
            volumeChange: 0,
            volumeChangePercent: 0,
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                "Insufficient volume baseline",
            ],
        };
    }

    const averageVolume =
        baselineCandles.reduce(
            (sum, candle) =>
                sum + candle.volume,
            0
        ) / baselineCandles.length;

    if (averageVolume <= 0) {
        return {
            value: currentVolume,
            averageVolume: 0,
            relativeVolume: 0,
            dynamicZScore: 0,
            trendZScore: 0,
            volumeChange: 0,
            volumeChangePercent: 0,
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                "Unable to calculate volume baseline",
            ],
        };
    }

    const relativeVolume =
        currentVolume / averageVolume;

    /*
     * Same dynamically sized baselineCandles used for
     * averageVolume/relativeVolume above - NOT a separate fixed
     * window. relativeVolume says how many times normal;
     * dynamicZScore says how statistically unusual, which needs the
     * baseline's own spread, not just its mean. A short
     * (expansion/displacement) baseline naturally produces a noisier
     * dynamicZScore than a long (compression) one - that's
     * intentional, matching getAdaptiveLookback's own reasoning that
     * a fresh volume regime shouldn't be judged against a stale one.
     */
    const baselineVariance =
        baselineCandles.reduce(
            (sum, candle) =>
                sum + Math.pow(candle.volume - averageVolume, 2),
            0
        ) / baselineCandles.length;

    const baselineStdDev = Math.sqrt(baselineVariance);

    const dynamicZScore =
        baselineStdDev > 0
            ? (currentVolume - averageVolume) / baselineStdDev
            : 0;

    const { trendZScore, newStats: trendVolumeRunningStats } =
        getTrendZScore(movingCandles, currentCandle, currentVolume, previousTrendVolumeStats, asOfTrendStartGi);

    const previousVolume =
        previousCandles[
            previousCandles.length - 1
        ].volume;

    const volumeChange =
        currentVolume - previousVolume;

    const volumeChangePercent =
        previousVolume !== 0
            ? (
                volumeChange /
                previousVolume
            ) * 100
            : 0;

    let state: VOLUME_STATE;

    if (
        relativeVolume >=
        CONFIG.STRONG_EXPANSION_THRESHOLD
    ) {
        state = "EXPANDING";
    }
    else if (
        relativeVolume >=
        CONFIG.EXPANSION_THRESHOLD
    ) {
        state = "EXPANDING";
    }
    else if (
        relativeVolume <=
        CONFIG.STRONG_CONTRACTION_THRESHOLD
    ) {
        state = "CONTRACTING";
    }
    else if (
        relativeVolume <=
        CONFIG.CONTRACTION_THRESHOLD
    ) {
        state = "CONTRACTING";
    }
    else {
        state = "NORMAL";
    }

    /*
     * Strength represents how abnormal the volume
     * is relative to the selected structural baseline.
     */
    const strength =
        Math.min(
            100,
            Math.max(
                0,
                (
                    Math.abs(relativeVolume - 1) /
                    (
                        CONFIG.STRENGTH_MAX_RELATIVE_VOLUME - 1
                    )
                ) * 100
            )
        );

    const reasons: string[] = [];

    reasons.push(
        `Volume ${relativeVolume.toFixed(2)}x structural baseline`
    );

    reasons.push(
        `Baseline uses ${baselineCandles.length} candles`
    );

    if (
        relativeVolume >=
        CONFIG.STRONG_EXPANSION_THRESHOLD
    ) {
        reasons.push(
            "Strong volume expansion"
        );
    }
    else if (
        relativeVolume >=
        CONFIG.EXPANSION_THRESHOLD
    ) {
        reasons.push(
            "Volume expansion"
        );
    }
    else if (
        relativeVolume <=
        CONFIG.STRONG_CONTRACTION_THRESHOLD
    ) {
        reasons.push(
            "Strong volume contraction"
        );
    }
    else if (
        relativeVolume <=
        CONFIG.CONTRACTION_THRESHOLD
    ) {
        reasons.push(
            "Volume contraction"
        );
    }
    else {
        reasons.push(
            "Volume within normal structural range"
        );
    }

    if (
        Math.abs(dynamicZScore) >= 2
    ) {
        reasons.push(
            `Volume dynamic z-score ${dynamicZScore >= 0 ? "+" : ""}${dynamicZScore.toFixed(2)} - statistically unusual vs its own baseline`
        );
    }

    if (
        currentCandle.trendState &&
        Math.abs(trendZScore) >= 2
    ) {
        reasons.push(
            `Volume trend z-score ${trendZScore >= 0 ? "+" : ""}${trendZScore.toFixed(2)} - statistically unusual vs this trend's own volume`
        );
    }

    if (
        Math.abs(volumeChangePercent) >
        CONFIG.FLAT_CHANGE_THRESHOLD_PERCENT
    ) {
        reasons.push(
            `Volume changed ${
                volumeChangePercent >= 0
                    ? "+"
                    : ""
            }${volumeChangePercent.toFixed(2)}% from previous candle`
        );
    }

    /*
     * Add structural context to the explanation.
     */
    if (
        currentCandle.candleStructure?.isCompression
    ) {
        reasons.push(
            "Current price structure is compressed"
        );
    }

    if (
        currentCandle.candleStructure?.isExpansion
    ) {
        reasons.push(
            "Current price structure is expanding"
        );
    }

    if (
        currentCandle.priceAction?.displacement?.detected
    ) {
        reasons.push(
            "Displacement detected"
        );
    }

    if (
        currentCandle.priceAction?.breakout?.detected
    ) {
        reasons.push(
            "Breakout detected"
        );
    }

    if (
        currentCandle.priceAction?.reclaim?.detected
    ) {
        reasons.push(
            "Reclaim detected"
        );
    }

    if (
        currentCandle.priceAction?.liquiditySweep?.detected
    ) {
        reasons.push(
            "Liquidity sweep detected"
        );
    }

    return {
        value: currentVolume,
        averageVolume,
        relativeVolume,
        dynamicZScore,
        trendZScore,
        trendVolumeRunningStats,
        volumeChange,
        volumeChangePercent,
        state,
        strength,
        timestamp: currentCandle.openTime,
        reasons,
    };
}