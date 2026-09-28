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
 * Narrates the touch -> rejection -> reclaim -> displacement ->
 * closeConfirmation sequence, now anchored to the project's own
 * research finding: AVWAP anchored at the TREND_START/TREND_SETTER
 * candles of the last 2 trend segments (see simulationUtilityV2.ts,
 * which maintains the running anchors and passes in each one's
 * CURRENT value every candle).
 *   - trigger:      the current candle's [low, high] range straddles
 *                    the CLOSEST active POC AVWAP (by distance from
 *                    close) — this replaces the old liquidity-sweep
 *                    trigger entirely; liquiditySweepInfo is no longer
 *                    read here at all.
 *   - direction:    the closest AVWAP's own carried direction — LONG
 *                    if it was anchored from an UP trend segment,
 *                    SHORT if DOWN (see simulationUtilityV2.ts's own
 *                    UP->LONG / DOWN->SHORT mapping when it builds
 *                    each anchor).
 *   - the level:    that AVWAP's own current value — a single moving
 *                    line, not a zone with high/low bounds, so there's
 *                    no hotZoneHigh/Low equivalent anymore.
 *   - displacement: candleStructure.isExpansion / .isBullish / .isBearish
 *                    / .strength (all already computed elsewhere) — unchanged
 *
 * The top-level field name `liquiditySweep` (from the PriceAction
 * interface) is kept as-is even though this module no longer detects
 * an actual liquidity-pool sweep — it now represents "the triggering
 * POC AVWAP touch happened", the same MOMENTARY-event role the field
 * always played in this module. Renaming the interface field wasn't
 * asked for and isn't done here.
 *
 * getPriceAction itself returns breakout/failedBreakout blank. They are a
 * distinct hypothesis (a clean break of structure with no touch/reject
 * drama), computed separately by getBreakoutEvents below and attached by
 * runAnalysis, which owns the confirmed swing levels they are measured
 * against.
 *
 * ── Field conventions (the interface doesn't specify these, so stating
 *    them explicitly rather than deciding silently) ──
 *   - liquiditySweep / rejection / displacement (top-level, PriceActionEvent):
 *     MOMENTARY — true only on the exact candle where that event happened.
 *   - reclaim (top-level, PriceActionReclaim):
 *     PERSISTENT once reached — level/penetration/closeDistance keep
 *     reflecting the tracked level on every subsequent candle until the
 *     sequence resets, since "where's the level and how is it holding" is
 *     an ongoing fact.
 *   - sequence.* booleans: CUMULATIVE — has this stage ever been reached
 *     in the currently-tracked sequence.
 *   - long / short: NOT independent scores. They just route `strength`
 *     into whichever side `dominant` is, so the fields aren't left at 0/0
 *     while implying two separately-evidenced numbers that don't exist.
 *
 * A new touch of a DIFFERENT active AVWAP always starts a fresh
 * sequence, overriding any still-pending unresolved one (logged in
 * `reasons`, not silently dropped) — same override behavior the old
 * sweep-based version had.
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
        strongAction: false,
        reasons,
    };
}

export function getPriceAction(movingCandles: CandleInfo[], activePocAvwaps: { value: number; direction: SIGNAL_DIRECTION }[]): PriceAction {

    if (!movingCandles.length) {
        return blankPriceAction(["No candle data available"]);
    }

    const currentIndex = movingCandles.length - 1;
    const currentCandle = movingCandles[currentIndex];
    const previousCandle = currentIndex > 0 ? movingCandles[currentIndex - 1] : null;

    const prevPA = previousCandle?.priceAction ?? null;
    const atr = currentCandle.atr;

    const reasons: string[] = [];

    const hadPending = !!prevPA && prevPA.sequence.direction !== "NEUTRAL";

    let level: number | null = hadPending ? prevPA!.reclaim.level : null;
    let direction: SIGNAL_DIRECTION = hadPending ? prevPA!.sequence.direction : "NEUTRAL";
    let sequence: PriceActionSequence = hadPending ? { ...prevPA!.sequence } : blankSequence();

    let touchEvent = blankEvent();

    // ── Does this candle touch the CLOSEST active POC AVWAP? ──
    // "Touch" means the candle's [low, high] range straddles that
    // AVWAP's current value — the single-line equivalent of a sweep
    // reaching into a zone. "Closest" is by distance from this candle's
    // own close, among whichever anchors are currently active (see
    // simulationUtilityV2.ts — up to 4, from the last 2 trend segments).
    if (activePocAvwaps.length > 0) {
        let closest = activePocAvwaps[0];
        let closestDist = Math.abs(currentCandle.close - closest.value);
        for (const p of activePocAvwaps.slice(1)) {
            const d = Math.abs(currentCandle.close - p.value);
            if (d < closestDist) { closest = p; closestDist = d; }
        }

        const touched = currentCandle.low <= closest.value && currentCandle.high >= closest.value;

        if (touched && closest.direction !== "NEUTRAL") {
            // Strength here is "how far outside this candle's own range
            // the touch point sits relative to ATR" has no meaning since
            // touched implies the level IS inside [low, high] — instead,
            // strength reflects how close the level sits to this
            // candle's own close (a level right at the close is a more
            // decisive test than one just barely clipped by the wick),
            // normalized against ATR. No sweptRatio equivalent exists
            // for a single moving line, so this replaces it outright
            // rather than approximating it.
            const strength = atr > 0 ? Math.round(Math.max(0, 1 - closestDist / atr) * 100) : 0;

            touchEvent = {
                detected: true,
                direction: closest.direction,
                strength,
                reasons: [`Price touched the closest POC AVWAP (${closest.value.toFixed(4)}), anchored to a ${closest.direction} trend segment`],
            };

            if (hadPending) {
                reasons.push(
                    `New ${closest.direction} POC AVWAP touch overrides previous unresolved ${direction} sequence`
                );
            }

            level = closest.value;
            direction = closest.direction;
            sequence = {
                liquiditySweep: true,
                rejection: false,
                reclaim: false,
                displacement: false,
                closeConfirmation: false,
                completion: 0.2,
                direction: closest.direction,
            };
            reasons.push(`${closest.direction} POC AVWAP touch detected at level ${closest.value.toFixed(4)}`);
        }
    }

    // No sequence at all (nothing pending, and nothing new started).
    if (!sequence.liquiditySweep || level === null) {
        return blankPriceAction(
            reasons.length ? reasons : ["No active or new POC AVWAP touch"],
            touchEvent
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
            return blankPriceAction(reasons, touchEvent);
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
                strength: touchEvent.strength,
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
        touchEvent.strength;

    // A confirmed displacement is inherently the strongest signal this
    // pipeline produces (only reachable after the full touch->reject
    // ->reclaim chain already played out) — always strong on its own.
    // Unlike the old sweep-based version, a bare touch never counts as
    // "strong" by itself now: sweptRatio measured how much of an actual
    // liquidity pool got consumed, which had no equivalent for a single
    // moving AVWAP line, so that shortcut isn't approximated here —
    // simplified to require the full chain instead.
    const strongAction = displacementEvent.detected;

    return {
        displacement: displacementEvent,
        rejection: rejectionEvent,
        reclaim: reclaimEvent,
        breakout: blankBreakout(),
        failedBreakout: blankBreakout(),
        liquiditySweep: touchEvent,
        sequence,
        long: trackedDirection === "LONG" ? strength : 0,
        short: trackedDirection === "SHORT" ? strength : 0,
        dominant: trackedDirection,
        strength,
        strongAction,
        reasons: reasons.length ? reasons : ["Sequence pending, no new stage reached this candle"],
    };
}

/* ============================================================
 * BREAKOUT / FAILED BREAKOUT
 * ============================================================ */

const BREAKOUT_CONFIG = {
    // How far (in ATRs) the close must clear the level to count as a
    // breakout rather than a close that merely sits on it. Filters the
    // "closed 1 tick above" noise. ARBITRARY, uncalibrated.
    MIN_CLOSE_BEYOND_ATR: 0.1,

    // A breakout that closes back on the wrong side of its level within
    // this many candles is a failed breakout. ARBITRARY, uncalibrated.
    FAILED_LOOKBACK: 3,

    // strength = how far the close cleared the level, where this many ATRs
    // or more maps to 100. ARBITRARY.
    STRENGTH_MAX_ATR: 1.0,
};

/**
 * Breakout of CONFIRMED structure, and its failure.
 *
 * Level: the last confirmed, significant swing high (LONG) / swing low
 * (SHORT) as of this candle - the same reference runAnalysis keeps for
 * HH/HL/LH/LL classification (lastSwingHighPrice / lastSwingLowPrice).
 * Those only update once a swing is confirmed (2 candles after the swing
 * candle) and differs from the previous reference by >= 1 ATR, so nothing
 * here looks ahead.
 *
 *   breakout (MOMENTARY): the FIRST close beyond the level by at least
 *     MIN_CLOSE_BEYOND_ATR x ATR - previous close was not beyond it.
 *     LONG above the swing high, SHORT below the swing low.
 *   failedBreakout (MOMENTARY): a breakout within the previous
 *     FAILED_LOOKBACK candles, and THIS is the first close back on the
 *     other side of that breakout's level. Direction is the opposite of
 *     the breakout (a failed LONG breakout is a SHORT signal).
 *
 * volumeConfirmation = volumeState.relativeVolume (x normal volume);
 * displacementConfirmation = candleStructure.bodyAtrRatio. Both are raw
 * numbers, not scores, so they can be thresholded in analysis.
 *
 * Reads candleStructure/volumeState of the current candle and priceAction
 * of the previous ones, so it must run after those are computed.
 */
export function getBreakoutEvents(
    movingCandles: CandleInfo[],
    lastSwingHighPrice: number | null,
    lastSwingLowPrice: number | null
): { breakout: PriceActionBreakout; failedBreakout: PriceActionBreakout } {
    const breakout = blankBreakout();
    const failedBreakout = blankBreakout();

    const i = movingCandles.length - 1;
    if (i < 1) return { breakout, failedBreakout };

    const candle = movingCandles[i];
    const prev = movingCandles[i - 1];
    const atr = candle.atr;
    if (!(atr > 0)) return { breakout, failedBreakout };

    const volumeConfirmation = candle.volumeState?.relativeVolume ?? 0;
    const displacementConfirmation = candle.candleStructure?.bodyAtrRatio ?? 0;
    const minBeyond = BREAKOUT_CONFIG.MIN_CLOSE_BEYOND_ATR * atr;
    const strengthOf = (beyond: number) =>
        Math.round(Math.min(1, beyond / (BREAKOUT_CONFIG.STRENGTH_MAX_ATR * atr)) * 100);

    // ── Breakout ──
    if (lastSwingHighPrice !== null
        && candle.close >= lastSwingHighPrice + minBeyond
        && prev.close <= lastSwingHighPrice) {
        const beyond = candle.close - lastSwingHighPrice;
        Object.assign(breakout, {
            detected: true, direction: "LONG" as SIGNAL_DIRECTION, strength: strengthOf(beyond),
            level: lastSwingHighPrice, volumeConfirmation, displacementConfirmation,
            reasons: [`First close above confirmed swing high ${lastSwingHighPrice} by ${(beyond / atr).toFixed(2)}x ATR`],
        });
    } else if (lastSwingLowPrice !== null
        && candle.close <= lastSwingLowPrice - minBeyond
        && prev.close >= lastSwingLowPrice) {
        const beyond = lastSwingLowPrice - candle.close;
        Object.assign(breakout, {
            detected: true, direction: "SHORT" as SIGNAL_DIRECTION, strength: strengthOf(beyond),
            level: lastSwingLowPrice, volumeConfirmation, displacementConfirmation,
            reasons: [`First close below confirmed swing low ${lastSwingLowPrice} by ${(beyond / atr).toFixed(2)}x ATR`],
        });
    }

    // ── Failed breakout: most recent breakout in the lookback, first close back ──
    for (let k = i - 1; k >= Math.max(0, i - BREAKOUT_CONFIG.FAILED_LOOKBACK); k--) {
        const b = movingCandles[k].priceAction?.breakout;
        if (!b || !b.detected) continue;
        const failedLong = b.direction === "LONG" && prev.close >= b.level && candle.close < b.level;
        const failedShort = b.direction === "SHORT" && prev.close <= b.level && candle.close > b.level;
        if (failedLong || failedShort) {
            const back = Math.abs(candle.close - b.level);
            Object.assign(failedBreakout, {
                detected: true, direction: (failedLong ? "SHORT" : "LONG") as SIGNAL_DIRECTION,
                strength: strengthOf(back), level: b.level, volumeConfirmation, displacementConfirmation,
                reasons: [`${b.direction} breakout of ${b.level} from ${i - k} candle(s) ago closed back through the level`],
            });
        }
        break; // only the most recent breakout is judged
    }

    return { breakout, failedBreakout };
}
