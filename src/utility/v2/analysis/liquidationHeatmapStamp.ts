// Intended location: src/utility/v2/analysis/liquidationHeatmapStamp.ts
// (sibling of liquidationHeatmap.ts and openInterestState.ts)

import type {
    CandleInfo,
    LiquidationHeatmapStamp,
    LiquiditySideStamp,
    POSITIONING_BEHAVIOR,
} from "@/core/interfacesv2";

/**
 * Decides, per candle, whether a long-side and/or short-side liquidity
 * anchor is currently building, confirmed/active, or has just ended.
 *
 * This is deliberately driven ONLY by OI positioning behavior (already
 * computed on each candle by openInterestState.ts /
 * positioningState.ts) — NOT by anything from the heatmap or sweep
 * measurement. Keeping the lifecycle decision independent of sweep
 * magnitude means "how much liquidity a candle swept" (see
 * liquiditySweepInfo.ts) stays a pure, unbiased observation rather than
 * something that could circularly influence the very anchor it's
 * measuring against.
 *
 * Long and short sides are tracked independently and can be ACTIVE
 * simultaneously, mirroring liquidationHeatmap.ts's own model of a
 * long-side pool and a short-side pool coexisting at all times.
 */
const CONFIG = {
    // Consecutive same-direction OI-buildup candles required before a
    // BUILDING run is confirmed ACTIVE. ARBITRARY, uncalibrated — same
    // status as the constants in positioningState.ts. Not validated
    // against data yet; a natural next experiment is checking whether 3
    // is too strict/loose by comparing resulting heatmap density and
    // subsequent price reaction across a few candidate values.
    MIN_BUILDUP_RUN_LENGTH: 3,
};

function emptySideStamp(): LiquiditySideStamp {
    return {
        status: "NONE",
        clusterId: null,
        eventOpenTime: null,
        eventCandleIndex: null,
        confirmedOpenTime: null,
        endOpenTime: null,
        runLength: 0,
    };
}

/**
 * Advances ONE side's (long or short) lifecycle by one candle. Pure
 * function: given the side's previous state and this candle's positioning
 * behavior, returns the new state. No access to the other side's state —
 * the two sides genuinely don't affect each other.
 */
function nextSideStamp(
    prev: LiquiditySideStamp,
    behavior: POSITIONING_BEHAVIOR,
    buildupBehavior: POSITIONING_BEHAVIOR,
    unwindBehavior: POSITIONING_BEHAVIOR,
    sideLabel: "long" | "short",
    candleOpenTime: number,
    candleIndex: number,
    reasons: string[]
): LiquiditySideStamp {

    // ENDED is a one-candle terminal marker on the candle where it
    // happened; the next candle evaluates fresh, as if starting from NONE.
    const effectivePrev: LiquiditySideStamp =
        prev.status === "ENDED" ? emptySideStamp() : prev;

    if (effectivePrev.status === "NONE") {
        if (behavior === buildupBehavior) {
            reasons.push(`${sideLabel} buildup run started`);
            return {
                status: "BUILDING",
                clusterId: `cluster-${sideLabel}-${candleOpenTime}`,
                eventOpenTime: candleOpenTime,
                eventCandleIndex: candleIndex,
                confirmedOpenTime: null,
                endOpenTime: null,
                runLength: 1,
            };
        }
        return effectivePrev;
    }

    if (effectivePrev.status === "BUILDING") {
        if (behavior === buildupBehavior) {
            const runLength = effectivePrev.runLength + 1;

            if (runLength >= CONFIG.MIN_BUILDUP_RUN_LENGTH) {
                reasons.push(
                    `${sideLabel} buildup confirmed after ${runLength} consecutive candles`
                );
                return {
                    ...effectivePrev,
                    status: "ACTIVE",
                    confirmedOpenTime: candleOpenTime,
                    runLength,
                };
            }

            return { ...effectivePrev, runLength };
        }

        // Any non-matching candle breaks an unconfirmed run. Strict, no
        // tolerance for a single noisy/neutral candle in the middle of a
        // run yet — a reasonable first cut, worth revisiting once we see
        // how often this discards runs that would otherwise have
        // confirmed.
        reasons.push(`${sideLabel} buildup run broken before confirmation`);
        return emptySideStamp();
    }

    if (effectivePrev.status === "ACTIVE") {
        if (behavior === unwindBehavior) {
            reasons.push(`${sideLabel} cluster ended — same-side unwind detected`);
            return {
                ...effectivePrev,
                status: "ENDED",
                endOpenTime: candleOpenTime,
            };
        }

        // Stays ACTIVE through neutral candles or opposite-side activity —
        // only a same-side unwind (the same positions that built this
        // cluster, closing) ends it.
        return effectivePrev;
    }

    return effectivePrev;
}

export function getLiquidationHeatmapStamp(
    movingCandles: CandleInfo[]
): LiquidationHeatmapStamp {

    if (!movingCandles.length) {
        return {
            long: emptySideStamp(),
            short: emptySideStamp(),
            timestamp: 0,
            reasons: ["No candle data available"],
        };
    }

    const currentIndex = movingCandles.length - 1;
    const currentCandle = movingCandles[currentIndex];
    const previousCandle = currentIndex > 0 ? movingCandles[currentIndex - 1] : null;

    // Previous candle's stamp is where lifecycle state is threaded through
    // — same idiom this codebase already uses for OI/volume history
    // (state lives explicitly on the candle array, not in a hidden
    // external variable).
    const previousStamp = previousCandle?.liquidationHeatmapStamp;
    const prevLong = previousStamp?.long ?? emptySideStamp();
    const prevShort = previousStamp?.short ?? emptySideStamp();

    const behavior: POSITIONING_BEHAVIOR =
        currentCandle.openInterest?.positioningState?.behavior ?? "INSUFFICIENT_DATA";

    const reasons: string[] = [];

    const long = nextSideStamp(
        prevLong,
        behavior,
        "LONG_BUILDUP",
        "LONG_UNWINDING",
        "long",
        currentCandle.openTime,
        currentIndex,
        reasons
    );

    const short = nextSideStamp(
        prevShort,
        behavior,
        "SHORT_BUILDUP",
        "SHORT_COVERING",
        "short",
        currentCandle.openTime,
        currentIndex,
        reasons
    );

    if (!reasons.length) {
        reasons.push("No liquidity anchor lifecycle change on this candle");
    }

    return {
        long,
        short,
        timestamp: currentCandle.openTime,
        reasons,
    };
}