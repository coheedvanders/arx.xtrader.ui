// Intended location: src/utility/v2/analysis/priceAction.ts
// (sibling of liquidationHeatmap.ts, liquidationHeatmapStamp.ts, liquiditySweepInfo.ts)

import type {
    CandleInfo,
    PriceAction,
    PriceActionEvent,
    PriceActionReclaim,
    PriceActionBreakout,
    PriceActionSequence,
    SIGNAL_DIRECTION,
} from "@/core/interfacesv2";

/**
 * Narrates the sweep -> rejection -> reclaim -> displacement ->
 * closeConfirmation sequence, reusing data this pipeline has already
 * computed rather than re-detecting anything:
 *   - trigger:      liquiditySweepInfo.behavior === 'SWEPT'
 *   - direction:    liquiditySweepInfo.measuredSides (which side's anchor
 *                    got swept), NOT guessed from price shape
 *   - the level:    liquiditySweepInfo.peakPrice (densest resting price
 *                    within the swept range)
 *   - displacement: candleStructure.isExpansion / .isBullish / .isBearish
 *                    / .strength (all already computed elsewhere)
 *
 * This module does NOT implement breakout/failedBreakout — deferred as a
 * separate pass since it's a distinct hypothesis (a clean break with no
 * sweep/reject drama) from the liquidity-anchor validation loop this
 * module answers. Both are returned as blank/false.
 *
 * ── Field conventions (the interface doesn't specify these, so stating
 *    them explicitly rather than deciding silently) ──
 *   - liquiditySweep / rejection / displacement (top-level, PriceActionEvent):
 *     MOMENTARY — true only on the exact candle where that event happened.
 *   - reclaim (top-level, PriceActionReclaim):
 *     PERSISTENT once reached — level/penetration/closeDistance keep
 *     reflecting the tracked level on every subsequent candle until the
 *     sequence resets, since "where's the level and how is it holding" is
 *     an ongoing fact (directly useful as an AVWAP anchor candidate).
 *   - sequence.* booleans: CUMULATIVE — has this stage ever been reached
 *     in the currently-tracked sequence.
 *   - long / short: NOT independent scores. They just route `strength`
 *     into whichever side `dominant` is, so the fields aren't left at 0/0
 *     while implying two separately-evidenced numbers that don't exist.
 *
 * A new single-side sweep always starts a fresh sequence, overriding any
 * still-pending unresolved one (logged in `reasons`, not silently dropped).
 * An ambiguous sweep (both sides hit at once) does not start a directional
 * sequence — reported honestly rather than guessing a side.
 */
const CONFIG = {
    // How far (in ATRs) price must close beyond the tracked level to
    // count as a confirmed RECLAIM rather than a bare REJECTION.
    // ARBITRARY, uncalibrated — same status as every other threshold in
    // this pipeline.
    RECLAIM_MIN_CLOSE_DISTANCE_ATR: 0.3,

    // Used only to scale reclaim.strength into a 0-100 range; a reclaim
    // this many ATRs beyond the level or more maps to 100. ARBITRARY.
    RECLAIM_STRENGTH_MAX_ATR: 1.0,

    // If price moves this many ATRs further past the level in the WRONG
    // direction without ever reclaiming, the pending sequence is
    // considered invalidated and reset. ARBITRARY, uncalibrated.
    INVALIDATION_DISTANCE_ATR: 2.0,
};

function blankEvent(): PriceActionEvent {
    return { detected: false, direction: "NEUTRAL", strength: 0, reasons: [] };
}

function blankReclaim(): PriceActionReclaim {
    return {
        detected: false, direction: "NEUTRAL", strength: 0, reasons: [],
        level: 0, penetration: 0, closeDistance: 0,
    };
}

function blankBreakout(): PriceActionBreakout {
    return {
        detected: false, direction: "NEUTRAL", strength: 0, reasons: [],
        level: 0, volumeConfirmation: 0, displacementConfirmation: 0,
    };
}

function blankSequence(): PriceActionSequence {
    return {
        liquiditySweep: false, rejection: false, reclaim: false,
        displacement: false, closeConfirmation: false,
        completion: 0, direction: "NEUTRAL",
    };
}

function blankPriceAction(reasons: string[], liquiditySweep: PriceActionEvent = blankEvent()): PriceAction {
    return {
        displacement: blankEvent(),
        rejection: blankEvent(),
        reclaim: blankReclaim(),
        breakout: blankBreakout(),
        failedBreakout: blankBreakout(),
        liquiditySweep,
        sequence: blankSequence(),
        long: 0,
        short: 0,
        dominant: "NEUTRAL",
        strength: 0,
        reasons,
    };
}

export function getPriceAction(movingCandles: CandleInfo[]): PriceAction {

    if (!movingCandles.length) {
        return blankPriceAction(["No candle data available"]);
    }

    const currentIndex = movingCandles.length - 1;
    const currentCandle = movingCandles[currentIndex];
    const previousCandle = currentIndex > 0 ? movingCandles[currentIndex - 1] : null;

    const prevPA = previousCandle?.priceAction ?? null;
    const sweepInfo = currentCandle.liquiditySweepInfo;
    const atr = currentCandle.atr;

    const reasons: string[] = [];

    const hadPending = !!prevPA && prevPA.sequence.direction !== "NEUTRAL";

    let level: number | null = hadPending ? prevPA!.reclaim.level : null;
    let direction: SIGNAL_DIRECTION = hadPending ? prevPA!.sequence.direction : "NEUTRAL";
    let sequence: PriceActionSequence = hadPending ? { ...prevPA!.sequence } : blankSequence();

    let sweepEvent = blankEvent();

    // ── Does this candle's own sweep start (or override) a sequence? ──
    if (sweepInfo?.behavior === "SWEPT") {
        const sides = sweepInfo.measuredSides;
        const sweepDirection: SIGNAL_DIRECTION =
            sides.length === 1 ? (sides[0] === "LONG" ? "LONG" : "SHORT") : "NEUTRAL";

        sweepEvent = {
            detected: true,
            direction: sweepDirection,
            strength: Math.round(sweepInfo.sweptRatio * 100),
            reasons: [`Swept ${(sweepInfo.sweptRatio * 100).toFixed(1)}% of ${sides.join("+")} anchor pool`],
        };

        if (sweepDirection !== "NEUTRAL") {
            if (hadPending) {
                reasons.push(
                    `New ${sweepDirection} sweep overrides previous unresolved ${direction} sequence`
                );
            }
            const newLevel = sweepInfo.peakPrice
                ?? (sweepDirection === "LONG" ? currentCandle.low : currentCandle.high);

            level = newLevel;
            direction = sweepDirection;
            sequence = {
                liquiditySweep: true,
                rejection: false,
                reclaim: false,
                displacement: false,
                closeConfirmation: false,
                completion: 0.2,
                direction: sweepDirection,
            };
            reasons.push(`${sweepDirection} liquidity sweep detected at level ${newLevel.toFixed(2)}`);
        } else {
            reasons.push("Sweep detected but both sides were hit — ambiguous, not starting a directional sequence");
        }
    }

    // No sequence at all (nothing pending, and nothing new started).
    if (!sequence.liquiditySweep || level === null) {
        return blankPriceAction(
            reasons.length ? reasons : ["No active or new liquidity sweep sequence"],
            sweepEvent
        );
    }

    const trackedLevel = level;
    const trackedDirection = direction;

    // ── Invalidation: gave up too much ground without ever reclaiming ──
    if (!sequence.reclaim && atr > 0) {
        const distanceAtr = trackedDirection === "LONG"
            ? (trackedLevel - currentCandle.close) / atr
            : (currentCandle.close - trackedLevel) / atr;

        if (distanceAtr >= CONFIG.INVALIDATION_DISTANCE_ATR) {
            reasons.push(
                `Sequence invalidated — price moved ${distanceAtr.toFixed(2)}x ATR further from level ${trackedLevel.toFixed(2)} without reclaiming`
            );
            return blankPriceAction(reasons, sweepEvent);
        }
    }

    // ── Rejection: closed back on the correct side of the level ──
    let rejectionEvent = blankEvent();
    if (!sequence.rejection) {
        const rejected = trackedDirection === "LONG"
            ? currentCandle.close > trackedLevel
            : currentCandle.close < trackedLevel;

        if (rejected) {
            const msg = `Closed back ${trackedDirection === "LONG" ? "above" : "below"} level ${trackedLevel.toFixed(2)}`;
            rejectionEvent = {
                detected: true,
                direction: trackedDirection,
                strength: sweepEvent.strength || Math.round((sweepInfo?.sweptRatio ?? 0) * 100),
                reasons: [msg],
            };
            sequence = { ...sequence, rejection: true, completion: Math.max(sequence.completion, 0.4) };
            reasons.push(msg);
        }
    }

    // ── Reclaim: decisive close beyond the level by a meaningful ATR margin ──
    let reclaimEvent: PriceActionReclaim = { ...blankReclaim(), level: trackedLevel };
    if (sequence.rejection && !sequence.reclaim && atr > 0) {
        const closeDistanceAtr = trackedDirection === "LONG"
            ? (currentCandle.close - trackedLevel) / atr
            : (trackedLevel - currentCandle.close) / atr;

        if (closeDistanceAtr >= CONFIG.RECLAIM_MIN_CLOSE_DISTANCE_ATR) {
            const penetration = trackedDirection === "LONG"
                ? Math.max(0, trackedLevel - currentCandle.low)
                : Math.max(0, currentCandle.high - trackedLevel);

            const msg = `Closed ${closeDistanceAtr.toFixed(2)}x ATR beyond level ${trackedLevel.toFixed(2)} — confirmed reclaim`;
            reclaimEvent = {
                detected: true,
                direction: trackedDirection,
                strength: Math.round(
                    Math.min(1, closeDistanceAtr / CONFIG.RECLAIM_STRENGTH_MAX_ATR) * 100
                ),
                reasons: [msg],
                level: trackedLevel,
                penetration,
                closeDistance: currentCandle.close - trackedLevel,
            };
            sequence = { ...sequence, reclaim: true, completion: Math.max(sequence.completion, 0.6) };
            reasons.push(msg);
        }
    } else if (sequence.reclaim) {
        // Persist the reclaim record — see field-conventions note above.
        reclaimEvent = {
            detected: true,
            direction: trackedDirection,
            strength: prevPA?.reclaim.strength ?? 0,
            reasons: ["Reclaim previously confirmed — level still being tracked"],
            level: trackedLevel,
            penetration: prevPA?.reclaim.penetration ?? 0,
            closeDistance: currentCandle.close - trackedLevel,
        };
    }

    // ── Displacement: genuine expansion move away from the level ──
    let displacementEvent = blankEvent();
    if (sequence.reclaim && !sequence.displacement) {
        const structure = currentCandle.candleStructure;
        const matchesDirection = trackedDirection === "LONG" ? structure?.isBullish : structure?.isBearish;

        if (structure?.isExpansion && matchesDirection) {
            const msg = `${trackedDirection} expansion candle displacing away from ${trackedLevel.toFixed(2)}`;
            displacementEvent = {
                detected: true,
                direction: trackedDirection,
                strength: structure.strength,
                reasons: [msg],
            };
            sequence = { ...sequence, displacement: true, completion: Math.max(sequence.completion, 0.8) };
            reasons.push(msg);
        }
    }

    // ── Close confirmation: the candle AFTER displacement still holds beyond the level ──
    // Checked against prevPA (not this candle's own `sequence`) so
    // displacement and closeConfirmation can never fire on the same
    // candle — confirmation is specifically about the FOLLOW-THROUGH.
    if (prevPA?.sequence.displacement && !sequence.closeConfirmation) {
        const holds = trackedDirection === "LONG"
            ? currentCandle.close > trackedLevel
            : currentCandle.close < trackedLevel;

        if (holds) {
            sequence = { ...sequence, closeConfirmation: true, completion: 1 };
            reasons.push(`Follow-through candle still holding beyond ${trackedLevel.toFixed(2)} — sequence confirmed`);
        }
    }

    const strength =
        displacementEvent.detected ? displacementEvent.strength :
        reclaimEvent.detected ? reclaimEvent.strength :
        sweepEvent.strength;

    return {
        displacement: displacementEvent,
        rejection: rejectionEvent,
        reclaim: reclaimEvent,
        breakout: blankBreakout(),
        failedBreakout: blankBreakout(),
        liquiditySweep: sweepEvent,
        sequence,
        long: trackedDirection === "LONG" ? strength : 0,
        short: trackedDirection === "SHORT" ? strength : 0,
        dominant: trackedDirection,
        strength,
        reasons: reasons.length ? reasons : ["Sequence pending, no new stage reached this candle"],
    };
}