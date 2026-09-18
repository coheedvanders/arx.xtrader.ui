// Intended location: src/utility/wispExtendedFeatures.ts
//
// The original profile features (AVWAP/FRVP/heatmap distance, favorable
// count, spread) showed essentially zero predictive power for MFE/MAE —
// confirmed by BOTH a linear model and a nonlinear one, ruling out
// "wrong model type" as the explanation. This module tries "wrong
// features" instead: OI, long/short positioning, volume, and candle
// structure — data the project's own original brief explicitly named
// ("was positioning increasing? did OI expand during displacement?")
// but that the wisp pipeline never actually used.
//
// Strictly causal: every value read is at startGi or endGi (the
// combo's own boundaries), nothing from after the range confirms —
// same no-look-ahead discipline as the rest of this pipeline.

import type { CandleInfo } from "@/core/interfacesv2";
import type { PointCandleRange } from "./pastCandleWisp";

export interface ExtendedFeatures {
    // OI change over the range — directly answers "did OI expand during
    // this displacement" rather than a single-point snapshot.
    oiChangePercent: number;
    oiRisingAtEnd: boolean;

    // Long/short positioning change over the range.
    lsRatioChangePercent: number;
    lsLongDominantAtEnd: boolean;

    // Volume behavior at the confirming candle.
    relativeVolumeAtEnd: number;
    volumeExpandingAtEnd: boolean;

    // Candle structure of the confirming candle itself — how forceful
    // was the move that actually confirmed this range.
    rangeAtrRatioAtEnd: number;
    bodyRatioAtEnd: number;
    closeLocationAtEnd: number;

    // How long the range took to confirm, in candles — a raw,
    // previously-unused structural fact about the setup.
    rangeDurationCandles: number;

    isLong: boolean;
}

function pctChange(from: number, to: number): number {
    if (from === 0) return 0;
    return (to - from) / Math.abs(from);
}

/**
 * Pulls the extended feature set for one range from the underlying
 * candles. Returns null if the candles don't actually carry the
 * OI/long-short/volume analysis (e.g. a symbol where that data was
 * never fetched) — callers should skip the entry rather than silently
 * feed zeros into training, which would look like real "no positioning
 * change" data rather than "we don't know."
 */
export function extractExtendedFeatures(candles: CandleInfo[], range: PointCandleRange): ExtendedFeatures | null {
    const start = candles[range.startGi];
    const end = candles[range.endGi];
    if (!start || !end) return null;
    if (!start.openInterest || !end.openInterest || !start.longShort || !end.longShort || !end.volumeState || !end.candleStructure) return null;

    return {
        oiChangePercent: pctChange(start.openInterest.value, end.openInterest.value),
        oiRisingAtEnd: end.openInterest.state === "RISING" || end.openInterest.state === "EXPANDING",

        lsRatioChangePercent: pctChange(start.longShort.ratio, end.longShort.ratio),
        lsLongDominantAtEnd: end.longShort.state === "LONG_DOMINANT",

        relativeVolumeAtEnd: end.volumeState.relativeVolume,
        volumeExpandingAtEnd: end.volumeState.state === "EXPANDING",

        rangeAtrRatioAtEnd: end.candleStructure.rangeAtrRatio,
        bodyRatioAtEnd: end.candleStructure.bodyRatio,
        closeLocationAtEnd: end.candleStructure.closeLocation,

        rangeDurationCandles: range.endGi - range.startGi,
        isLong: range.direction === "LONG",
    };
}

/** Feature vector order — training and prediction must build rows the same way, this is the single source of truth for that order. */
export const EXTENDED_FEATURE_NAMES = [
    "oiChangePercent",
    "oiRisingAtEnd",
    "lsRatioChangePercent",
    "lsLongDominantAtEnd",
    "relativeVolumeAtEnd",
    "volumeExpandingAtEnd",
    "rangeAtrRatioAtEnd",
    "bodyRatioAtEnd",
    "closeLocationAtEnd",
    "rangeDurationCandles",
    "isLong",
] as const;

export function extendedFeaturesToRow(f: ExtendedFeatures): number[] {
    return [
        f.oiChangePercent,
        f.oiRisingAtEnd ? 1 : 0,
        f.lsRatioChangePercent,
        f.lsLongDominantAtEnd ? 1 : 0,
        f.relativeVolumeAtEnd,
        f.volumeExpandingAtEnd ? 1 : 0,
        f.rangeAtrRatioAtEnd,
        f.bodyRatioAtEnd,
        f.closeLocationAtEnd,
        f.rangeDurationCandles,
        f.isLong ? 1 : 0,
    ];
}