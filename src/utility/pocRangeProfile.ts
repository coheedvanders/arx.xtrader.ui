// Intended location: src/utility/pocRangeProfile.ts
//
// A "POC Range" is the combination of the three levels a range story
// already carries: AVWAP, FRVP POC, and the heatmap's red (hottest) level.
// This module classifies that combination two different ways, for two
// different purposes:
//
// 1. DISCRETE PROFILE TYPE — a small set of human-readable categories
//    (which level sits where relative to price, how many sit in the
//    favorable direction, how tightly clustered they are). This is what
//    Train Wisp's catalog groups by, and what the training visual in
//    WispMonitorComponent displays. Deliberately categorical, not a
//    score — two ranges either land in the same bucket or they don't.
//
// 2. CONTINUOUS SIGNATURE — the same three underlying distances, kept as
//    actual numbers (normalized by ATR, so a tight small-cap cluster and
//    a wide BTC cluster are comparable on the same footing). This is
//    ONLY used for Ask Wisp's "closest match" lookup at decision time —
//    nearest-neighbor retrieval, never used to grade or rank a profile's
//    quality. Naming this distinction explicitly because "not scored"
//    (true for classification) and "closest match" (true for retrieval)
//    are two different operations that could otherwise look
//    contradictory.
//
// Every threshold in here (spread tight/wide, reaction continuation/
// reversal/pin) is a stated, arbitrary cutoff in units of ATR — not a
// "correct" number, just a starting default meant to be tuned once real
// training data shows how these should actually split.

import type { SIGNAL_DIRECTION } from "@/core/interfacesv2";
import type { RangeStory } from "@/utility/pastCandleWisp";

export type LevelName = "AVWAP" | "FRVP" | "HEAT";

export interface ProfileSignature {
    /** Signed distance from the range's own referencePrice to each level, normalized by that range's ATR — positive means the level sits in the FAVORABLE direction for the trade, negative means it sits against it. Same sign convention aggregateStories already uses for pocDistance/redLevelDistance, just per-level and ATR-normalized here instead of raw price. Null for a level that has no reading (e.g. redLevel was null because the heatmap had no cells). */
    avwapDistance: number;
    frvpPocDistance: number | null;
    redLevelDistance: number | null;
    /** The ATR this signature was normalized by — kept alongside the signature so a caller can tell how much raw-price magnitude one "unit" of distance represents for this particular range. */
    atr: number;
}

export interface ProfileType {
    /** The three levels that have a reading, ordered from most favorable to least favorable (or most adverse). A level with a null distance is left out of the ordering entirely rather than guessed at. */
    ordering: LevelName[];
    /** How many of the (present) levels sit in the favorable direction — 0 through the number of present levels. */
    favorableCount: number;
    /** How many levels are actually present (redLevel/frvpPoc can be null) — kept alongside favorableCount so "2 of 2 favorable" and "2 of 3 favorable" aren't silently conflated. */
    presentCount: number;
    /** Whether the present levels sit tightly clustered or spread apart, relative to ATR. See SPREAD_TIGHT_THRESHOLD_ATR below for the exact, stated cutoff. */
    spread: "tight" | "wide";
}

export type ReactionCategory = "continuation" | "reversal" | "pin";

// ---- Stated, arbitrary thresholds — starting defaults, meant to be
// revisited once real training data shows how these should actually
// split, not claimed as correct. ----

/** Above this many ATRs apart (max pairwise distance among present levels), a profile is classified "wide" rather than "tight". */
export const SPREAD_TIGHT_THRESHOLD_ATR = 1.0;

/** MFE/MAE below this many ATRs doesn't count as a real move either way — stays classified "pin" regardless of which of mfe/mae was larger. */
export const REACTION_MOVE_THRESHOLD_ATR = 1.0;

function signedDistance(direction: SIGNAL_DIRECTION, referencePrice: number, level: number): number {
    return direction === "LONG" ? level - referencePrice : referencePrice - level;
}

/**
 * Builds the continuous signature for one story. atr must be > 0 for the
 * normalized distances to mean anything — callers should skip stories
 * whose reference candle has no usable ATR (too little history) rather
 * than pass 0 in and divide by it.
 */
export function computeProfileSignature(story: Pick<RangeStory, "direction" | "referencePrice" | "avwap" | "frvpPoc" | "redLevel">, atr: number): ProfileSignature | null {
    if (!(atr > 0)) return null;
    return {
        avwapDistance: signedDistance(story.direction, story.referencePrice, story.avwap) / atr,
        frvpPocDistance: story.frvpPoc !== null ? signedDistance(story.direction, story.referencePrice, story.frvpPoc) / atr : null,
        redLevelDistance: story.redLevel !== null ? signedDistance(story.direction, story.referencePrice, story.redLevel) / atr : null,
        atr,
    };
}

/** Derives the discrete, human-readable profile type from a signature — deterministic, no distance/nearest-neighbor logic here, just sorting and counting. */
export function computeProfileType(sig: ProfileSignature): ProfileType {
    const present: { name: LevelName; distance: number }[] = [{ name: "AVWAP", distance: sig.avwapDistance }];
    if (sig.frvpPocDistance !== null) present.push({ name: "FRVP", distance: sig.frvpPocDistance });
    if (sig.redLevelDistance !== null) present.push({ name: "HEAT", distance: sig.redLevelDistance });

    present.sort((a, b) => b.distance - a.distance);
    const ordering = present.map(p => p.name);
    const favorableCount = present.filter(p => p.distance > 0).length;

    let maxPairwise = 0;
    for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
            maxPairwise = Math.max(maxPairwise, Math.abs(present[i].distance - present[j].distance));
        }
    }
    const spread: "tight" | "wide" = maxPairwise > SPREAD_TIGHT_THRESHOLD_ATR ? "wide" : "tight";

    return { ordering, favorableCount, presentCount: present.length, spread };
}

/** Canonical string key for grouping profile types in a catalog/table — two ProfileTypes with the same key are the same discrete bucket. */
export function profileTypeKey(type: ProfileType): string {
    return `${type.ordering.join(">")}|${type.favorableCount}/${type.presentCount}fav|${type.spread}`;
}

/**
 * Categorizes what actually happened after the range, from its own
 * mfe/mae (already causal — measured forward from the range's own end,
 * see measureRangeStory) and the same ATR the signature was normalized
 * by, so "a real move" means the same thing here as it does in the
 * spread classification above.
 */
export function computeReactionCategory(story: RangeStory, atr: number): ReactionCategory {
    if (!(atr > 0)) return "pin";
    const mfeAtr = story.mfe / atr;
    const maeAtr = story.mae / atr;
    if (mfeAtr >= REACTION_MOVE_THRESHOLD_ATR && mfeAtr > maeAtr) return "continuation";
    if (maeAtr >= REACTION_MOVE_THRESHOLD_ATR && maeAtr > mfeAtr) return "reversal";
    return "pin";
}

/**
 * Distance between two signatures, for Ask Wisp's nearest-neighbor
 * lookup ONLY — this is retrieval, not grading. Missing levels (null)
 * are excluded from the comparison rather than treated as zero, so a
 * story missing its heatmap reading doesn't get penalized as if the
 * heatmap sat exactly at price. Returns null if the two signatures have
 * no comparable levels in common at all.
 */
export function signatureDistance(a: ProfileSignature, b: ProfileSignature): number | null {
    const diffs: number[] = [a.avwapDistance - b.avwapDistance];
    if (a.frvpPocDistance !== null && b.frvpPocDistance !== null) diffs.push(a.frvpPocDistance - b.frvpPocDistance);
    if (a.redLevelDistance !== null && b.redLevelDistance !== null) diffs.push(a.redLevelDistance - b.redLevelDistance);
    if (!diffs.length) return null;
    const sumSquares = diffs.reduce((s, d) => s + d * d, 0);
    return Math.sqrt(sumSquares);
}

/**
 * "Close enough" for Ask Wisp's retrieval isn't a number we invent — it's
 * derived from how tightly the catalog itself actually clusters. This
 * computes, for every signature, its distance to its Kth-nearest OTHER
 * signature in the set (not just the single nearest — that distance is
 * inherently too tight to capture more than 1-2 entries, defeating the
 * point of pooling several similar historical instances), then returns
 * the median of those. A dense, tightly-clustered catalog gets a tight
 * threshold; a sparse one gets a looser one, automatically, rather than
 * one fixed cutoff pretending to fit catalogs of very different density.
 * minSampleSize sets K — "how many similar entries should a typical
 * match actually pull in." O(n²) — fine for the catalog sizes this
 * produces (rare point-candle ranges × a few hundred symbols, not
 * millions of rows), but not meant for arbitrary scale.
 */
export function deriveCloseMatchThreshold(signatures: ProfileSignature[], minSampleSize: number = 5): number | null {
    if (signatures.length < minSampleSize + 1) return null;
    const kthDistances: number[] = [];
    for (let i = 0; i < signatures.length; i++) {
        const distances: number[] = [];
        for (let j = 0; j < signatures.length; j++) {
            if (i === j) continue;
            const d = signatureDistance(signatures[i], signatures[j]);
            if (d !== null) distances.push(d);
        }
        if (distances.length < minSampleSize) continue;
        distances.sort((a, b) => a - b);
        kthDistances.push(distances[minSampleSize - 1]);
    }
    if (!kthDistances.length) return null;
    const sorted = [...kthDistances].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Every candidate whose signature falls within threshold of liveSignature —
 * generic over anything carrying a .signature field (a CatalogEntry, most
 * likely) so this module stays independent of the storage layer's own
 * shape, no import cycle back to pocRangeCatalogDb.ts.
 */
export function findCloseMatches<T extends { signature: ProfileSignature }>(
    liveSignature: ProfileSignature,
    candidates: T[],
    threshold: number
): T[] {
    return candidates.filter(c => {
        const d = signatureDistance(liveSignature, c.signature);
        return d !== null && d <= threshold;
    });
}