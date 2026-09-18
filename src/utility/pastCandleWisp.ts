// Intended location: src/utility/pastCandleWisp.ts
//
// The "intelligence" behind the past-scan preview feature.
//
// A "point candle" is a single candle whose OWN liquidityAnchor array
// carries BOTH a START and an END — the exact STRONG_LIQUIDITY_ANCHOR
// condition from simulationUtilityV2.ts, just generalized to find EVERY
// qualifying candle in the history, not only the most recent one.
//
// EACH point candle defines its OWN self-contained range — this is a
// correction from an earlier version of this module, which paired
// CONSECUTIVE point candles together ([P(i), P(i+1)]). That model was
// inconsistent with how the combo is actually placed on the chart
// (addDefaultComboOnLoad / findDefaultComboRange in the component), and
// verified wrong against real uploaded data. The correct model, verified
// against real data multiple times: a point candle carries BOTH a
// START-type and an END-type anchor, and each of those two anchors
// confirms independently, at whatever candle satisfied THAT anchor's own
// swing-confirmation lookback. A range's start is the point candle
// itself; its end is whichever of its own two anchors confirms LATER.
//
// The STORY for one range is what happened AFTER it closed (its own end),
// up to the NEXT point candle in the sequence — not a fixed window, not
// "the next anchor event of any kind", specifically the next point
// candle, since that's the next moment a full structural cycle confirms
// again.
//
// The LAST point candle's own range is the CURRENT reference setup — the
// one combo you've already placed before entering. It has no story of
// its own (there's no next point candle yet); every EARLIER range with a
// matching direction becomes one training sample for it.
//
// Deliberately iterative, not a single aggregate calculation: each past
// range is processed as one step (runPastCandleWispScan calls onIteration
// after each one), so a caller can drive a step-by-step animation — the
// "wisp" moving range to range across the chart — where each step is a
// genuine unit of the analysis actually happening, not a cosmetic delay.
//
// No look-ahead: a range's story only ever uses candles from that range's
// OWN end forward to the next point candle — never anything from the
// reference range's own future.

import type { CandleInfo, SIGNAL_DIRECTION } from "@/core/interfacesv2";
import { getLiqudationHeatmap } from "@/utility/v2/analysis/liquidationHeatmap";

export interface PointCandle {
    gi: number;
    openTime: number;
}

export interface PointCandleRange {
    /** Index into the points array this range's own point candle came from — lets a caller walk to the next point candle for story-window bounding. */
    pointIndex: number;
    /** The point candle's own gi — this IS the range's start. */
    startGi: number;
    /** The gi of whichever of the point candle's own two anchors (START-type, END-type) confirms LATER. */
    endGi: number;
    startOpenTime: number;
    endOpenTime: number;
    /** The point candle's own START-type anchor direction — the trend beginning at this point. */
    direction: SIGNAL_DIRECTION;
}

export interface RangeStory extends PointCandleRange {
    /** Cumulative volume-weighted typical price from the range's own start (the point candle) forward through its end — the EXACT same formula addAvwapAnchor uses in the component, just evaluated up to the range's own end instead of running to the present. This is genuinely an AVWAP value, not an approximation of one — an earlier version of this file called this field "poc" and it was mislabeled; it was never a volume-profile calculation. */
    avwap: number;
    /** The TRUE FRVP point of control — the same 24-bucket volume-profile algorithm addFrvpZone uses in the component (bucket the range's price span, distribute each candle's volume proportionally by price overlap, take the bucket with the highest total volume, POC is that bucket's midpoint). Null if the range's own high/low collapsed to zero height (shouldn't happen in practice, but stay defensive). */
    frvpPoc: number | null;
    /** The price of the SINGLE HOTTEST cell in getLiqudationHeatmap's own output over the range's candles — "the level where the red heatmap is seated," using the exact same computation the chart's own heatmap tool uses. Null if the heatmap computation returned nothing (e.g. too few candles). */
    redLevel: number | null;
    /** The range's own end candle close — the price a combo placed on this range would have been judging against. */
    referencePrice: number;
    /** How far price moved FAVORABLY (in the range's own direction) from referencePrice, measured forward to the next point candle. */
    mfe: number;
    /** How far price moved ADVERSELY from referencePrice, measured the same way. */
    mae: number;
    /** The gi the story's measurement window actually ended at — the next point candle's own gi. */
    measuredThroughGi: number;
}

export interface WispIterationResult {
    iteration: number;
    totalIterations: number;
    story: RangeStory;
    /** Running aggregate AFTER incorporating this story — lets a caller show the suggestion converging step by step, not just appearing at the end. */
    runningMedianMfe: number;
    runningMedianMae: number;
    sampleSize: number;
}

export interface WispFinalResult {
    referenceRange: PointCandleRange;
    iterationsRun: number;
    /** The live price this suggestion was computed against — "entry is always the current price," so this is what suggestedTp/suggestedSl are actually anchored to, not the reference range's own (possibly stale) close. */
    currentPrice: number;
    /** Absolute suggested TP/SL prices — currentPrice already adjusted by direction, not a distance the caller has to sign-convert themselves. */
    suggestedTp: number;
    suggestedSl: number;
    /** The raw distances behind suggestedTp/suggestedSl, kept for anyone who wants the magnitude without the direction math baked in. AVWAP is the primary driver when it's favorable; FRVP POC and the heatmap red level are confluence, folded in alongside it — see where this is computed below. */
    suggestedTpDistance: number;
    suggestedSlDistance: number;
    medianMfe: number;
    medianMae: number;
    /** Median signed distance from each story's own referencePrice to that story's AVWAP, in the FAVORABLE direction (positive = AVWAP sat where the trade would have wanted price to go; negative = it sat the other way). This is the primary driver of suggestedTpDistance when positive. */
    medianAvwapDistance: number;
    /** Same idea, but for the TRUE bucketed FRVP point of control — confluence alongside AVWAP, not the primary driver. */
    medianFrvpPocDistance: number;
    /** Same idea, but for the single hottest heatmap cell — confluence alongside AVWAP, not the primary driver. */
    medianRedLevelDistance: number;
    /** 0–1 — how many of the training stories actually favored the direction (mfe > mae) at all, a rough "does this pattern have a real edge" read, not a statistical guarantee. */
    confidence: number;
    stories: RangeStory[];
    /** Which training path produced this result — set by the caller after aggregateStories runs, not by aggregateStories itself, so the two existing same-symbol callers don't need to change. Undefined for those; "catalog" for a cross-symbol nearest-signature match. */
    source?: "catalog" | "same-symbol";
}

/** Every candle carrying BOTH a START and an END anchor, in chronological order (candles are scanned in order, so no separate sort is needed). */
export function findPointCandles(candles: CandleInfo[]): PointCandle[] {
    const points: PointCandle[] = [];
    candles.forEach((c, gi) => {
        const anchors = c.liquidityAnchor ?? [];
        const hasStart = anchors.some(a => a.type === "START");
        const hasEnd = anchors.some(a => a.type === "END");
        if (hasStart && hasEnd) points.push({ gi, openTime: c.openTime });
    });
    return points;
}

/**
 * One self-contained range PER point candle — not per consecutive pair.
 * A point candle's range starts at itself and ends at whichever of its
 * own two anchors (START-type, END-type) confirms later. Verified
 * against real uploaded data multiple times; matches
 * findDefaultComboRange in the component exactly, which is what actually
 * places the combo on the chart — this function must never compute a
 * different answer than that one does.
 */
export function buildPointCandleRanges(candles: CandleInfo[], points: PointCandle[]): PointCandleRange[] {
    const ranges: PointCandleRange[] = [];
    points.forEach((point, pointIndex) => {
        const anchors = candles[point.gi].liquidityAnchor ?? [];
        const startAnchor = anchors.find(a => a.type === "START");
        const endAnchor = anchors.find(a => a.type === "END");
        if (!startAnchor || !endAnchor) return; // shouldn't happen given findPointCandles's own filter, but stay defensive

        const laterConfirmedOpenTime = Math.max(startAnchor.confirmedOpenTime, endAnchor.confirmedOpenTime);
        const endGi = candles.findIndex(c => c.openTime === laterConfirmedOpenTime);
        if (endGi === -1) return; // the confirming candle isn't in the currently loaded window

        ranges.push({
            pointIndex,
            startGi: point.gi,
            endGi,
            startOpenTime: point.openTime,
            endOpenTime: laterConfirmedOpenTime,
            direction: startAnchor.direction,
        });
    });
    return ranges;
}

function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The TRUE FRVP point of control over a slice of candles — the exact
 * same 24-bucket volume-profile algorithm addFrvpZone uses in the
 * component: bucket the slice's price span into 24 rows, distribute
 * each candle's volume across the buckets it overlaps (weighted by how
 * much of the candle's own high-low range falls in each bucket), then
 * take the bucket with the highest total volume. POC is that bucket's
 * own midpoint. Returns null if the slice's high/low collapses to zero
 * height (can't build a profile from that).
 */
function computeFrvpPoc(slice: CandleInfo[]): number | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of slice) {
        lo = Math.min(lo, c.low);
        hi = Math.max(hi, c.high);
    }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;

    const buckets = 24;
    const bucketHeight = (hi - lo) / buckets;
    const raw = Array.from({ length: buckets }, (_, idx) => ({
        priceLow: lo + idx * bucketHeight,
        priceHigh: lo + (idx + 1) * bucketHeight,
        volume: 0,
    }));

    for (const c of slice) {
        const low = c.low;
        const high = c.high;
        const vol = c.volume ?? 0;
        if (vol <= 0 || high <= low) continue;
        for (const b of raw) {
            const overlapLow = Math.max(low, b.priceLow);
            const overlapHigh = Math.min(high, b.priceHigh);
            if (overlapHigh <= overlapLow) continue;
            b.volume += vol * ((overlapHigh - overlapLow) / (high - low));
        }
    }

    const pocIdx = raw.reduce((best, b, i) => (b.volume > raw[best].volume ? i : best), 0);
    return (raw[pocIdx].priceLow + raw[pocIdx].priceHigh) / 2;
}

/**
 * Measures one range's own AVWAP/FRVP-POC/red-level, then its story: how
 * price moved from the range's own end forward to the NEXT point candle
 * (nextPointGi). A range with no next point candle yet (the most recent
 * one — the reference range) has no story; callers should not call this
 * for that range at all.
 */
export interface RangeLevels {
    avwap: number;
    frvpPoc: number | null;
    redLevel: number | null;
    referencePrice: number;
}

/**
 * Just the three levels + reference price for a range — deliberately
 * split out from measureRangeStory because this part never depended on
 * knowing what happened afterward (mfe/mae need a nextPointGi to bound
 * the measurement; these don't). That makes this usable for a LIVE,
 * currently-unresolved reference range too — exactly what Ask Wisp's
 * catalog matching needs, since the live range has no outcome yet.
 */
export function measureRangeLevels(candles: CandleInfo[], range: Pick<PointCandleRange, "startGi" | "endGi" | "direction">): RangeLevels | null {
    const rangeCandles = candles.slice(range.startGi, range.endGi + 1);
    if (!rangeCandles.length) return null;

    let cumPV = 0;
    let cumVol = 0;
    for (const c of rangeCandles) {
        const typical = (c.high + c.low + c.close) / 3;
        cumPV += typical * (c.volume ?? 0);
        cumVol += c.volume ?? 0;
    }
    const avwap = cumVol > 0 ? cumPV / cumVol : rangeCandles[rangeCandles.length - 1].close;

    const frvpPoc = computeFrvpPoc(rangeCandles);

    const heatmap = getLiqudationHeatmap(rangeCandles);
    let redLevel: number | null = null;
    if (heatmap && heatmap.cells.length) {
        const hottest = heatmap.cells.reduce((best, c) => (c.intensity > best.intensity ? c : best), heatmap.cells[0]);
        redLevel = (hottest.priceLow + hottest.priceHigh) / 2;
    }

    const referencePrice = candles[range.endGi].close;

    return { avwap, frvpPoc, redLevel, referencePrice };
}

export function measureRangeStory(candles: CandleInfo[], range: PointCandleRange, nextPointGi: number): RangeStory | null {
    const levels = measureRangeLevels(candles, range);
    if (!levels) return null;
    const { avwap, frvpPoc, redLevel, referencePrice } = levels;

    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let i = range.endGi; i <= nextPointGi; i++) {
        maxHigh = Math.max(maxHigh, candles[i].high);
        minLow = Math.min(minLow, candles[i].low);
    }

    const mfe = range.direction === "LONG" ? maxHigh - referencePrice : referencePrice - minLow;
    const mae = range.direction === "LONG" ? referencePrice - minLow : maxHigh - referencePrice;

    return {
        ...range,
        avwap,
        frvpPoc,
        redLevel,
        referencePrice,
        mfe: Math.max(0, mfe),
        mae: Math.max(0, mae),
        measuredThroughGi: nextPointGi,
    };
}

/**
 * Walks every training range (past ranges matching the reference range's
 * own direction, excluding the reference itself) and measures each one's
 * story — the FRESH computation, purely from whatever candles are
 * currently loaded. Pulled out on its own so it can be combined with
 * previously-stored stories (see runPastCandleWispScanWithMemory below)
 * without duplicating the walk logic.
 */
export function collectFreshTrainingStories(
    candles: CandleInfo[],
    points: PointCandle[],
    referenceRange: PointCandleRange
): RangeStory[] {
    const ranges = buildPointCandleRanges(candles, points);
    const trainingRanges = ranges.filter(
        r => r.direction === referenceRange.direction && r.startGi !== referenceRange.startGi
    );

    const stories: RangeStory[] = [];
    for (const range of trainingRanges) {
        // The next point candle in the sequence (not "+2" as an older
        // version of this file needed — that offset was an artifact of
        // the old pair-based model, where one range spanned TWO point
        // candles; now each range maps to exactly one point candle, so
        // the very next entry in points is genuinely the next one).
        const nextPoint = points[range.pointIndex + 1];
        if (!nextPoint) continue;
        const story = measureRangeStory(candles, range, nextPoint.gi);
        if (story) stories.push(story);
    }
    return stories;
}

/**
 * Aggregates an already-collected list of stories (fresh, stored, or a
 * combination — this function doesn't care where they came from) into a
 * final suggestion.
 *
 * AVWAP is treated as the strongest driver: when its median distance is
 * favorable, it anchors suggestedTpDistance directly (replacing MFE as
 * the base candidate). FRVP POC and the heatmap red level are confluence
 * — folded in alongside AVWAP via median only when they're ALSO
 * favorable, never overriding it on their own. When AVWAP isn't
 * favorable (or there's no data for it), MFE takes over as the base,
 * same as before AVWAP was added, so the suggestion never depends on a
 * factor that isn't actually supporting the trade.
 */
export function aggregateStories(
    referenceRange: PointCandleRange,
    currentPrice: number,
    stories: RangeStory[]
): WispFinalResult {
    const mfeValues = stories.map(s => s.mfe);
    const maeValues = stories.map(s => s.mae);
    const avwapDistances = stories.map(s =>
        s.direction === "LONG" ? s.avwap - s.referencePrice : s.referencePrice - s.avwap
    );
    const frvpPocDistances = stories
        .filter(s => s.frvpPoc !== null)
        .map(s => (s.direction === "LONG" ? s.frvpPoc! - s.referencePrice : s.referencePrice - s.frvpPoc!));
    const redLevelDistances = stories
        .filter(s => s.redLevel !== null)
        .map(s => (s.direction === "LONG" ? s.redLevel! - s.referencePrice : s.referencePrice - s.redLevel!));

    const medianMfe = median(mfeValues);
    const medianMae = median(maeValues);
    const medianAvwapDistance = median(avwapDistances);
    const medianFrvpPocDistance = median(frvpPocDistances);
    const medianRedLevelDistance = median(redLevelDistances);
    const favorableCount = stories.filter(s => s.mfe > s.mae).length;
    const confidence = stories.length ? favorableCount / stories.length : 0;

    // AVWAP is the strongest driver, but as a FLOOR on the base
    // candidate, never a replacement for it — verified against real
    // catalog data that treating it as a full replacement was
    // systematically under-suggesting: in ~15% of real entries, actual
    // MFE was 3x-40x larger than the AVWAP distance, because AVWAP (a
    // cumulative average) often sits much closer to price than price
    // actually went. So when AVWAP is favorable, the base is whichever
    // of MFE or the AVWAP distance is LARGER — AVWAP can still pull the
    // suggestion up past a small/unremarkable MFE, but can never pull it
    // down below what price actually, empirically did. FRVP POC and red
    // level remain confluence only — added alongside the base, never
    // used as the base themselves.
    const base = medianAvwapDistance > 0 ? Math.max(medianMfe, medianAvwapDistance) : medianMfe;
    const tpCandidates = [base];
    if (medianFrvpPocDistance > 0) tpCandidates.push(medianFrvpPocDistance);
    if (medianRedLevelDistance > 0) tpCandidates.push(medianRedLevelDistance);
    const suggestedTpDistance = median(tpCandidates);
    const suggestedSlDistance = medianMae;

    const suggestedTp = referenceRange.direction === "LONG" ? currentPrice + suggestedTpDistance : currentPrice - suggestedTpDistance;
    const suggestedSl = referenceRange.direction === "LONG" ? currentPrice - suggestedSlDistance : currentPrice + suggestedSlDistance;

    return {
        referenceRange,
        iterationsRun: stories.length,
        currentPrice,
        suggestedTp,
        suggestedSl,
        suggestedTpDistance,
        suggestedSlDistance,
        medianMfe,
        medianMae,
        medianAvwapDistance,
        medianFrvpPocDistance,
        medianRedLevelDistance,
        confidence,
        stories,
    };
}

/**
 * The main entry point. Finds every point candle in `candles`, gives
 * each one its own self-contained range, and treats the LAST point
 * candle's range as the current reference setup. Every EARLIER range
 * whose direction matches the reference range's own becomes one training
 * story, processed oldest-first with onIteration fired after each one.
 *
 * currentPrice is the live price at call time — "entry is always the
 * current price," so the returned distances are meant to be applied to
 * THAT, not to the reference range's own close.
 *
 * This version only ever trains on what's freshly computable from
 * `candles` right now — see runPastCandleWispScanWithMemory below for the
 * version that also draws on previously stored stories.
 */
export function runPastCandleWispScan(
    candles: CandleInfo[],
    currentPrice: number,
    onIteration?: (result: WispIterationResult) => void
): WispFinalResult | null {
    const points = findPointCandles(candles);
    if (points.length < 1) return null;
    const ranges = buildPointCandleRanges(candles, points);
    if (!ranges.length) return null;
    const referenceRange = ranges[ranges.length - 1];

    const stories = collectFreshTrainingStories(candles, points, referenceRange);
    const mfeRunning: number[] = [];
    const maeRunning: number[] = [];
    stories.forEach((story, idx) => {
        mfeRunning.push(story.mfe);
        maeRunning.push(story.mae);
        onIteration?.({
            iteration: idx + 1,
            totalIterations: stories.length,
            story,
            runningMedianMfe: median(mfeRunning),
            runningMedianMae: median(maeRunning),
            sampleSize: idx + 1,
        });
    });

    return aggregateStories(referenceRange, currentPrice, stories);
}

/**
 * The actual learning path: combines FRESHLY computed stories (from
 * whatever candle window is currently loaded) with PREVIOUSLY STORED
 * ones (see wispMemoryDb.ts) for the same symbol, so a symbol you've
 * scanned before has a training set that's grown beyond whatever's
 * visible in this one session's candle window — older ranges that have
 * scrolled out of the loaded history aren't lost, they're remembered.
 *
 * De-duplication: a range identified by the same startOpenTime/endOpenTime
 * pair counts once. When both a fresh and a stored version exist for the
 * same range, the FRESH one wins — it was just re-verified against live
 * data, so it's strictly more trustworthy than whatever was cached.
 *
 * Iterates the MERGED set oldest-first (by endOpenTime) for onIteration,
 * so the animation visually walks through remembered ranges alongside
 * newly-discovered ones in one coherent pass, not two separate batches.
 *
 * Scoped to one symbol only, deliberately — mixing a pattern learned on
 * one symbol into another symbol's suggestion is a bigger claim than this
 * makes on its own; expanding scope is a separate decision, not a default
 * silently baked in here.
 */
export function runPastCandleWispScanWithMemory(
    candles: CandleInfo[],
    currentPrice: number,
    storedStories: RangeStory[],
    onIteration?: (result: WispIterationResult) => void
): WispFinalResult | null {
    const points = findPointCandles(candles);
    if (points.length < 1) return null;
    const ranges = buildPointCandleRanges(candles, points);
    if (!ranges.length) return null;
    const referenceRange = ranges[ranges.length - 1];

    const freshStories = collectFreshTrainingStories(candles, points, referenceRange);

    const byKey = new Map<string, RangeStory>();
    for (const story of storedStories) {
        if (story.direction !== referenceRange.direction) continue;
        byKey.set(`${story.startOpenTime}:${story.endOpenTime}`, story);
    }
    // Fresh stories overwrite stored ones sharing the same key — a
    // re-verified-against-live-data story is strictly more trustworthy
    // than whatever was cached from an earlier session.
    for (const story of freshStories) {
        byKey.set(`${story.startOpenTime}:${story.endOpenTime}`, story);
    }

    const merged = [...byKey.values()].sort((a, b) => a.endOpenTime - b.endOpenTime);

    const mfeRunning: number[] = [];
    const maeRunning: number[] = [];
    merged.forEach((story, idx) => {
        mfeRunning.push(story.mfe);
        maeRunning.push(story.mae);
        onIteration?.({
            iteration: idx + 1,
            totalIterations: merged.length,
            story,
            runningMedianMfe: median(mfeRunning),
            runningMedianMae: median(maeRunning),
            sampleSize: idx + 1,
        });
    });

    return aggregateStories(referenceRange, currentPrice, merged);
}