/**
 * Estimates how much longer a rolling-window replay has left, walking
 * forward from a fixed start timestamp until it catches up to the
 * CURRENT real-world time. Two things make this trickier than a plain
 * progress bar:
 *
 * 1. The target moves. "Now" keeps advancing while the run is still
 *    going, so a naive estimate based on "candles between start and
 *    now-at-launch" is systematically too optimistic — by the time
 *    you'd finish that original target, more candles have since
 *    arrived that also need processing. This solves for the real
 *    finish time algebraically instead of ignoring that effect.
 *
 * 2. The rate isn't assumed, it's measured. No fixed "X ms per candle"
 *    guess — this uses the actual observed throughput so far, which
 *    means the estimate gets MORE accurate as the run progresses
 *    (early on, with few data points, expect it to be rough).
 */

export const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export interface CompletionEstimate {
    /** Candles between the run's start timestamp and "now" AT THE MOMENT this estimate is computed — the target as of right now, not accounting for future arrivals. */
    candlesToNowAsOfEstimate: number;
    candlesProcessedSoFar: number;
    /** Against candlesToNowAsOfEstimate — how far along the run is against the CURRENTLY known target. Not the same as "done", since the target keeps moving. */
    progressPercent: number;
    /** Observed ms per candle, based on actual elapsed real time vs. candles processed so far. Null until at least one candle has been processed (nothing to measure yet). */
    observedMsPerCandle: number | null;
    /**
     * Additional real-world ms estimated to finish, ACCOUNTING for new
     * candles that will arrive during that remaining time (see file
     * header). Null if the observed rate isn't yet fast enough to ever
     * catch up (i.e. processing slower than one candle per 15 real
     * minutes) — that's a real, worth-surfacing state, not just an
     * edge case to hide.
     */
    estimatedRemainingMs: number | null;
    /** Date.now() + estimatedRemainingMs, or null under the same condition as estimatedRemainingMs. */
    estimatedCompletionTimestamp: number | null;
}

export function estimateCompletion(
    startTimestamp: number,
    runStartRealTimeMs: number,
    candlesProcessedSoFar: number,
    nowMs: number = Date.now(),
    intervalMs: number = FIFTEEN_MIN_MS
): CompletionEstimate {
    const candlesToNowAsOfEstimate = Math.max(0, Math.floor((nowMs - startTimestamp) / intervalMs));
    const elapsedRealMs = Math.max(0, nowMs - runStartRealTimeMs);

    const observedMsPerCandle = candlesProcessedSoFar > 0 ? elapsedRealMs / candlesProcessedSoFar : null;
    const progressPercent = candlesToNowAsOfEstimate > 0
        ? Math.min(100, (candlesProcessedSoFar / candlesToNowAsOfEstimate) * 100)
        : 100;

    const remainingAsOfNow = Math.max(0, candlesToNowAsOfEstimate - candlesProcessedSoFar);

    let estimatedRemainingMs: number | null = null;
    let estimatedCompletionTimestamp: number | null = null;

    if (observedMsPerCandle != null && remainingAsOfNow > 0) {
        const observedRate = 1 / observedMsPerCandle; // candles per ms
        const arrivalRate = 1 / intervalMs; // new candles per ms, from real time passing
        const netRate = observedRate - arrivalRate;
        if (netRate > 0) {
            estimatedRemainingMs = remainingAsOfNow / netRate;
            estimatedCompletionTimestamp = nowMs + estimatedRemainingMs;
        }
        // netRate <= 0 means processing isn't even keeping pace with new
        // candles arriving in real time - genuinely can't converge, left
        // as null rather than reporting a misleadingly finite number.
    } else if (remainingAsOfNow === 0) {
        estimatedRemainingMs = 0;
        estimatedCompletionTimestamp = nowMs;
    }

    return {
        candlesToNowAsOfEstimate,
        candlesProcessedSoFar,
        progressPercent,
        observedMsPerCandle,
        estimatedRemainingMs,
        estimatedCompletionTimestamp,
    };
}