// Intended location: src/utility/v2/analysis/liquidityHeatmapAnchor.ts
// (sibling of liquidationHeatmap.ts, positioningState.ts, priceAction.ts)

import type {
    CandleInfo,
    LiquidityHeatmapAnchor,
    SIGNAL_DIRECTION,
} from "@/core/interfacesv2";

/**
 * Identifies WHERE a liquidity heatmap should actually be anchored — not a
 * fixed lookback window, but the real START and END of a structural trend
 * segment, read off swing-point structure (classic HH/HL for an uptrend,
 * LH/LL for a downtrend).
 *
 * Deliberately recomputes the full swing history from scratch on every
 * call rather than threading incremental state through the candle array
 * — simpler and more robust than incremental state (no risk of drift),
 * and cheap enough for a research tool at typical dataset sizes (same
 * tradeoff already made elsewhere in this pipeline, e.g. liquiditySweepInfo's
 * per-candle heatmap recomputation).
 *
 * CONFIG.SWING_LOOKBACK is an ARBITRARY, uncalibrated constant — exactly
 * the kind of thing the LH Anchors toggle exists to let you visually
 * check and refine, not something to trust blindly.
 */
const CONFIG = {
    SWING_LOOKBACK: 3,
};

interface RawSwing {
    gi: number;
    type: "high" | "low";
    price: number;
}

interface LabeledSwing extends RawSwing {
    label: "HH" | "HL" | "LH" | "LL" | null; // null = first swing of its kind seen so far, nothing to compare against yet
}

/**
 * Causal fractal swing detection: candle i is a confirmed swing high once
 * SWING_LOOKBACK bars exist on both sides and none of them beat its high
 * (symmetric for lows). Confirmation necessarily lags the swing itself by
 * SWING_LOOKBACK bars — same event-time-vs-confirmation-time discipline
 * as every other module in this pipeline.
 */
function findConfirmedSwings(candles: CandleInfo[]): LabeledSwing[] {
    const lb = CONFIG.SWING_LOOKBACK;
    const raw: RawSwing[] = [];

    for (let i = lb; i < candles.length - lb; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = i - lb; j <= i + lb; j++) {
            if (j === i) continue;
            if (candles[j].high >= candles[i].high) isHigh = false;
            if (candles[j].low <= candles[i].low) isLow = false;
            if (!isHigh && !isLow) break;
        }
        if (isHigh) raw.push({ gi: i, type: "high", price: candles[i].high });
        if (isLow) raw.push({ gi: i, type: "low", price: candles[i].low });
    }

    const labeled: LabeledSwing[] = [];
    let lastHighPrice: number | null = null;
    let lastLowPrice: number | null = null;

    for (const r of raw) {
        if (r.type === "high") {
            const label: LabeledSwing["label"] = lastHighPrice === null ? null : (r.price > lastHighPrice ? "HH" : "LH");
            labeled.push({ ...r, label });
            lastHighPrice = r.price;
        } else {
            const label: LabeledSwing["label"] = lastLowPrice === null ? null : (r.price > lastLowPrice ? "HL" : "LL");
            labeled.push({ ...r, label });
            lastLowPrice = r.price;
        }
    }

    return labeled; // already in gi order, since raw was built by scanning candles in order
}

interface AnchorEvent {
    gi: number;            // the swing candle this anchor actually belongs to — may be well before confirmedGi
    confirmedGi: number;   // the candle index that confirmed it (gi + SWING_LOOKBACK, at minimum)
    type: "START" | "END";
    direction: SIGNAL_DIRECTION;
    price: number;
    swingType: "high" | "low";
    reasons: string[];
}

/**
 * Walks the confirmed-swing sequence and returns every trend segment's
 * START and END identified so far. START requires a full two-swing
 * pattern (HH then HL, or LL then LH); END only requires one swing that
 * breaks the current structure — so END is always faster to confirm than
 * the START of whatever comes next, which is exactly the gap your own
 * chart review showed between segments.
 */
function detectAnchorEvents(swings: LabeledSwing[]): AnchorEvent[] {
    const lb = CONFIG.SWING_LOOKBACK;
    const events: AnchorEvent[] = [];
    let bias: SIGNAL_DIRECTION = "NEUTRAL";

    let lastHigh: LabeledSwing | null = null;
    let lastLow: LabeledSwing | null = null;

    for (const s of swings) {
        const confirmedGi = s.gi + lb;

        if (s.type === "high") {
            // A higher high breaks a downtrend's structure.
            if (bias === "SHORT" && s.label === "HH" && lastLow) {
                events.push({
                    gi: lastLow.gi, confirmedGi, type: "END", direction: "SHORT",
                    price: lastLow.price, swingType: "low",
                    reasons: [`Downtrend structure broken: new high ${s.price} exceeds the prior high — the downtrend's last low is its end`],
                });
                bias = "NEUTRAL";
            }
            // A lower high, once a lower low already sits behind it, confirms
            // a fresh downtrend — origin is lastHigh, the swing immediately
            // BEFORE this confirming one (the high the whole move actually
            // came down from), not some earlier swing two steps back.
            if (bias !== "SHORT" && s.label === "LH" && lastLow?.label === "LL" && lastHigh) {
                events.push({
                    gi: lastHigh.gi, confirmedGi, type: "START", direction: "SHORT",
                    price: lastHigh.price, swingType: "high",
                    reasons: [`Downtrend confirmed: lower low (${lastLow.price}) followed by lower high (${s.price})`],
                });
                bias = "SHORT";
            }
            lastHigh = s;
        } else {
            // A lower low breaks an uptrend's structure.
            if (bias === "LONG" && s.label === "LL" && lastHigh) {
                events.push({
                    gi: lastHigh.gi, confirmedGi, type: "END", direction: "LONG",
                    price: lastHigh.price, swingType: "high",
                    reasons: [`Uptrend structure broken: new low ${s.price} undercuts the prior low — the uptrend's last high is its end`],
                });
                bias = "NEUTRAL";
            }
            // A higher low, once a higher high already sits behind it,
            // confirms a fresh uptrend — origin is lastLow (same reasoning
            // as above), not a swing two steps back.
            if (bias !== "LONG" && s.label === "HL" && lastHigh?.label === "HH" && lastLow) {
                events.push({
                    gi: lastLow.gi, confirmedGi, type: "START", direction: "LONG",
                    price: lastLow.price, swingType: "low",
                    reasons: [`Uptrend confirmed: higher high (${lastHigh.price}) followed by higher low (${s.price})`],
                });
                bias = "LONG";
            }
            lastLow = s;
        }
    }

    return events;
}

interface PairMeta {
    pairId: string;
    sequenceIndex: number;
}

/**
 * Pairs each START with its eventual END (same direction, chronological
 * order) and numbers segments in the order they were confirmed. Purely
 * derived from the (deterministic) events array, so re-running this over
 * a growing candle history always assigns the SAME ids to earlier events
 * — no external state needs to be threaded across calls.
 */
function assignPairsAndSequence(events: AnchorEvent[]): Map<AnchorEvent, PairMeta> {
    const meta = new Map<AnchorEvent, PairMeta>();
    let seq = 0;
    const open: Record<SIGNAL_DIRECTION, PairMeta | null> = { LONG: null, SHORT: null, NEUTRAL: null };

    for (const e of events) {
        if (e.type === "START") {
            seq += 1;
            const info: PairMeta = { pairId: `seg-${e.direction}-${e.gi}`, sequenceIndex: seq };
            open[e.direction] = info;
            meta.set(e, info);
        } else {
            const existing = open[e.direction];
            const info: PairMeta = existing ?? { pairId: `seg-${e.direction}-${e.gi}-orphan`, sequenceIndex: ++seq };
            open[e.direction] = null;
            meta.set(e, info);
        }
    }

    return meta;
}

/**
 * Returns every anchor NEWLY confirmed as of the current (last) candle in
 * movingCandles — each tagged with the candle index (gi) it actually
 * belongs to, which is very likely earlier than the current candle, since
 * confirmation requires hindsight. The caller is responsible for writing
 * each returned anchor onto candles[gi].liquidityAnchor (a retroactive,
 * but still fully causal, write — see the module comment above).
 */
export function getLiquidityHeatmapAnchors(
    movingCandles: CandleInfo[]
): Array<{ gi: number; anchor: LiquidityHeatmapAnchor }> {
    const lb = CONFIG.SWING_LOOKBACK;
    if (movingCandles.length < lb * 2 + 1) return [];

    const swings = findConfirmedSwings(movingCandles);
    const events = detectAnchorEvents(swings);
    const meta = assignPairsAndSequence(events);

    const currentGi = movingCandles.length - 1;
    const confirmedNow = events.filter(e => e.confirmedGi === currentGi);

    return confirmedNow.map(e => {
        const m = meta.get(e)!;
        return {
            gi: e.gi,
            anchor: {
                type: e.type,
                direction: e.direction,
                price: e.price,
                swingType: e.swingType,
                pairId: m.pairId,
                sequenceIndex: m.sequenceIndex,
                confirmedOpenTime: movingCandles[currentGi].openTime,
                anchorOpenTime: movingCandles[e.gi].openTime,
                reasons: e.reasons,
            },
        };
    });
}