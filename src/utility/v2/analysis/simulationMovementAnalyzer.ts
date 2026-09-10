// Intended location: src/utility/v2/analysis/simulationMovementAnalyzer.ts
//
// Post-hoc research instrument, NOT part of the causal simulation.
// SimulationUtilityV2 must never see the future; this file's entire job is
// the opposite — given a FINISHED CandleInfo[] (already fully simulated),
// measure what actually happened, including using future candles relative
// to any given point. That's correct here: this answers "Outcome", the
// fifth thing the project's own no-lookahead rules require tracking
// alongside event/confirmation/anchor time and first interaction.
//
// DYNAMIC HORIZONS: every "how far forward do we look" window is DISCOVERED
// from a real boundary already present in the data (a category run ending,
// a lifecycle reaching ENDED, a sequence hitting a new sweep or a full
// retrace) — never a fixed candle count. MOVE_OUTCOME's STRONG/WEAK/CHOP
// split is likewise computed from this dataset's own percentile
// distribution of |forwardReturnAtr|, not a fixed ATR cutoff. The handful
// of constants that remain genuinely arbitrary (magnet touch tolerance,
// minimum combination sample size) are called out at their use site.

import type {
    CandleInfo,
    MARKET_INTERVAL,
    SIGNAL_DIRECTION,
    ForwardOutcome,
    MOVE_OUTCOME,
    MoveOutcomeDistribution,
    BucketStat,
    ModuleBucketReport,
    AnchorLifecycleOutcome,
    SweepEventOutcome,
    PriceActionSequenceOutcome,
    AlignmentCountBucket,
    PairwiseCombinationBucket,
    SweepMagnitudeVsTerminalStage,
    CombinationSection,
    MagnetAnalysisResult,
    CandleSnapshot,
    EventTimelineWindow,
    CrossCheckResult,
    AnalysisMetadata,
    SimulationAnalysisReport,
} from "@/core/interfacesv2";
import { getLiquidationHeatmap } from "./liquidationHeatmap";

const CONFIG = {
    // Below this many samples, a combination bucket is flagged (not
    // dropped) as too thin to trust. ARBITRARY.
    MIN_COMBINATION_SAMPLE_SIZE: 20,
    // Magnet "touch" tolerance, in ATRs of the trigger candle. ARBITRARY —
    // the only genuinely fixed-feeling number left in this file.
    MAGNET_TOUCH_TOLERANCE_ATR: 0.25,
};

// ── Generic stats helpers ────────────────────────────────────────────────

function average(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number {
    return percentile(values, 50);
}

function percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

// ── ForwardOutcome: measurement + deferred classification ──────────────
// moveOutcome is left as a placeholder here and set later in one global
// pass (classifyAllOutcomes), once every outcome in the whole report has
// been collected — that's what lets the STRONG/WEAK/CHOP cutoffs be
// calibrated to this dataset's own distribution instead of a fixed number.

function computeForwardOutcome(
    candles: CandleInfo[],
    startIdx: number,
    endIdx: number,
    direction: SIGNAL_DIRECTION,
    censored: boolean
): ForwardOutcome {
    // Baseline is the candle BEFORE the window starts, not the window's own
    // first candle. Using the window's own first candle as the "before"
    // price excludes that candle's own move from the measurement — and for
    // a single-candle window (startIdx === endIdx, common for short-lived
    // categories), it makes startCandle and endCandle THE SAME candle,
    // so the return is always exactly 0 regardless of what really
    // happened. baseIdx fixes both problems at once.
    const baseIdx = Math.max(0, startIdx - 1);
    const baseCandle = candles[baseIdx];
    const endCandle = candles[endIdx];
    const atr = baseCandle.atr > 0 ? baseCandle.atr : (endCandle.atr > 0 ? endCandle.atr : 0);

    const forwardReturnPercent = baseCandle.close !== 0
        ? ((endCandle.close - baseCandle.close) / baseCandle.close) * 100
        : 0;
    const forwardReturnAtr = atr > 0 ? (endCandle.close - baseCandle.close) / atr : 0;

    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
        if (candles[i].high > highestHigh) highestHigh = candles[i].high;
        if (candles[i].low < lowestLow) lowestLow = candles[i].low;
    }

    const upExcursionAtr = atr > 0 ? (highestHigh - baseCandle.close) / atr : 0;
    const downExcursionAtr = atr > 0 ? (baseCandle.close - lowestLow) / atr : 0;

    let favorableExcursionAtr: number | null = null;
    let adverseExcursionAtr: number | null = null;
    if (direction === "LONG") {
        favorableExcursionAtr = upExcursionAtr;
        adverseExcursionAtr = downExcursionAtr;
    } else if (direction === "SHORT") {
        favorableExcursionAtr = downExcursionAtr;
        adverseExcursionAtr = upExcursionAtr;
    }

    return {
        horizonCandles: endIdx - startIdx + 1,
        direction,
        forwardReturnPercent,
        forwardReturnAtr,
        upExcursionAtr,
        downExcursionAtr,
        favorableExcursionAtr,
        adverseExcursionAtr,
        moveOutcome: "CHOP", // placeholder — see classifyAllOutcomes
        censored,
    };
}

/** Sets moveOutcome on every outcome, using cutoffs computed from THIS dataset's own magnitude distribution. Mutates in place. Returns the cutoffs used, for auditability. */
function classifyAllOutcomes(outcomes: ForwardOutcome[]): { p33: number; p66: number } {
    const magnitudes = outcomes.filter(o => !o.censored).map(o => Math.abs(o.forwardReturnAtr));
    const p33 = percentile(magnitudes, 33);
    const p66 = percentile(magnitudes, 66);

    for (const o of outcomes) {
        if (o.censored) {
            o.moveOutcome = "CENSORED";
            continue;
        }
        const mag = Math.abs(o.forwardReturnAtr);
        if (mag <= p33) {
            o.moveOutcome = "CHOP";
            continue;
        }
        // When there's no reference direction, treat the move's own sign as
        // the "continuation" label — there's nothing to continue or
        // reverse, so this only describes move size, not alignment.
        const movedUp = o.forwardReturnAtr >= 0;
        const isContinuation =
            o.direction === "NEUTRAL" ? true :
            o.direction === "LONG" ? movedUp : !movedUp;
        const strong = mag > p66;
        o.moveOutcome = isContinuation
            ? (strong ? "STRONG_CONTINUATION" : "WEAK_CONTINUATION")
            : (strong ? "STRONG_REVERSAL" : "WEAK_REVERSAL");
    }

    return { p33, p66 };
}

function aggregateDistribution(outcomes: ForwardOutcome[]): MoveOutcomeDistribution {
    const counts: Record<MOVE_OUTCOME, number> = {
        STRONG_CONTINUATION: 0, WEAK_CONTINUATION: 0, CHOP: 0,
        WEAK_REVERSAL: 0, STRONG_REVERSAL: 0, CENSORED: 0,
    };
    for (const o of outcomes) counts[o.moveOutcome]++;
    const total = outcomes.length || 1;
    const percents = {} as Record<MOVE_OUTCOME, number>;
    (Object.keys(counts) as MOVE_OUTCOME[]).forEach(k => { percents[k] = (counts[k] / total) * 100; });

    return {
        sampleCount: outcomes.length,
        outcomeCounts: counts,
        outcomePercents: percents,
        meanForwardReturnPercent: average(outcomes.map(o => o.forwardReturnPercent)),
        medianForwardReturnPercent: median(outcomes.map(o => o.forwardReturnPercent)),
        meanForwardReturnAtr: average(outcomes.map(o => o.forwardReturnAtr)),
    };
}

// ── Generic run detection over a per-candle category key ───────────────

interface RunInstance {
    startIdx: number;
    endIdx: number;
    key: string;
    /** true = this run reached the end of the array without its key changing — we don't know if/how it would have ended. */
    ranOffEnd: boolean;
}

function findRuns(length: number, keyFn: (idx: number) => string | null): RunInstance[] {
    const runs: RunInstance[] = [];
    let curKey: string | null = null;
    let curStart = -1;
    for (let i = 0; i < length; i++) {
        const k = keyFn(i);
        if (k === curKey) continue;
        if (curKey !== null) {
            runs.push({ startIdx: curStart, endIdx: i - 1, key: curKey, ranOffEnd: false });
        }
        curKey = k;
        curStart = i;
    }
    if (curKey !== null) {
        runs.push({ startIdx: curStart, endIdx: length - 1, key: curKey, ranOffEnd: true });
    }
    return runs;
}

// ── Per-candle categorical buckets (positioningState / longShortState / volumeState / alignment) ──
// Outcome window is POST-run: from the candle right after this run ends,
// through the end of whatever run comes next. That's the non-circular
// question ("once this label's streak ends, what happens next"), using
// only boundaries the data itself already defines.

interface PendingBucketGroup {
    outcomes: ForwardOutcome[];
    runLengths: number[];
    strengths: number[];
}

function buildCategoryGroups(
    candles: CandleInfo[],
    keyFn: (idx: number) => string | null,
    directionFn: (key: string) => SIGNAL_DIRECTION,
    strengthFn: ((idx: number) => number) | null,
    allOutcomes: ForwardOutcome[]
): Map<string, PendingBucketGroup> {
    const runs = findRuns(candles.length, keyFn);
    const groups = new Map<string, PendingBucketGroup>();

    const getGroup = (key: string): PendingBucketGroup => {
        let g = groups.get(key);
        if (!g) { g = { outcomes: [], runLengths: [], strengths: [] }; groups.set(key, g); }
        return g;
    };

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const group = getGroup(run.key);
        group.runLengths.push(run.endIdx - run.startIdx + 1);
        if (strengthFn) {
            for (let c = run.startIdx; c <= run.endIdx; c++) group.strengths.push(strengthFn(c));
        }

        const nextRun = runs[i + 1];
        if (!nextRun) continue; // last run in the series — no "after" data at all, no outcome sample

        const outcome = computeForwardOutcome(
            candles, run.endIdx + 1, nextRun.endIdx,
            directionFn(run.key), nextRun.ranOffEnd
        );
        allOutcomes.push(outcome);
        group.outcomes.push(outcome);
    }

    return groups;
}

function finalizeBucketReport(
    module: ModuleBucketReport["module"],
    field: string,
    groups: Map<string, PendingBucketGroup>
): ModuleBucketReport {
    const buckets: BucketStat[] = [];
    for (const [category, g] of groups) {
        buckets.push({
            category,
            sampleCount: g.outcomes.length,
            runLengthPercentiles: g.runLengths.length
                ? { p10: percentile(g.runLengths, 10), p50: percentile(g.runLengths, 50), p90: percentile(g.runLengths, 90) }
                : null,
            strengthPercentiles: g.strengths.length
                ? { p10: percentile(g.strengths, 10), p50: percentile(g.strengths, 50), p90: percentile(g.strengths, 90) }
                : null,
            outcome: aggregateDistribution(g.outcomes),
        });
    }
    return { module, field, buckets };
}

// Behavior -> reference direction the label implies, for framing the
// post-run continuation/reversal question. LONG_BUILDUP and SHORT_COVERING
// both mean price was rising while the label held; SHORT_BUILDUP and
// LONG_UNWINDING both mean price was falling.
function positioningDirection(behavior: string): SIGNAL_DIRECTION {
    if (behavior === "LONG_BUILDUP" || behavior === "SHORT_COVERING") return "LONG";
    if (behavior === "SHORT_BUILDUP" || behavior === "LONG_UNWINDING") return "SHORT";
    return "NEUTRAL";
}

function lsStateDirection(state: string): SIGNAL_DIRECTION {
    if (state === "LONG_DOMINANT" || state === "LONG_INCREASING") return "LONG";
    if (state === "SHORT_DOMINANT" || state === "SHORT_INCREASING") return "SHORT";
    return "NEUTRAL";
}

function volumeStateDirection(): SIGNAL_DIRECTION {
    // Volume expanding/contracting has no inherent up/down lean of its own.
    return "NEUTRAL";
}

// ── Anchor lifecycle outcomes (liquidationHeatmapStamp, per side) ──────

function buildAnchorLifecycleOutcomes(
    candles: CandleInfo[],
    allOutcomes: ForwardOutcome[]
): AnchorLifecycleOutcome[] {
    const results: AnchorLifecycleOutcome[] = [];

    for (const side of ["long", "short"] as const) {
        let openClusterId: string | null = null;
        let startIdx = -1;
        let confirmedOpenTime: number | null = null;

        for (let i = 0; i < candles.length; i++) {
            const stamp = candles[i].liquidationHeatmapStamp?.[side];
            if (!stamp) continue;

            if (stamp.clusterId && stamp.clusterId !== openClusterId) {
                openClusterId = stamp.clusterId;
                startIdx = i;
                confirmedOpenTime = null;
            }

            if (!stamp.clusterId && openClusterId) {
                // stamp is ALREADY reset (clusterId null, runLength 0) —
                // the real run length as it stood right before breaking
                // lives on the previous candle's stamp.
                const priorRunLength = candles[i - 1]?.liquidationHeatmapStamp?.[side]?.runLength ?? null;
                results.push(finishLifecycle(
                    candles, side, openClusterId, startIdx, i - 1, confirmedOpenTime,
                    null, "BROKEN_BEFORE_CONFIRM", priorRunLength, false, allOutcomes
                ));
                openClusterId = null;
            }

            if (stamp.status === "ACTIVE" && confirmedOpenTime === null && stamp.confirmedOpenTime) {
                confirmedOpenTime = stamp.confirmedOpenTime;
            }

            if (stamp.status === "ENDED" && openClusterId) {
                results.push(finishLifecycle(
                    candles, side, openClusterId, startIdx, i, confirmedOpenTime,
                    stamp.endOpenTime, "CONFIRMED_THEN_ENDED", stamp.runLength, false, allOutcomes
                ));
                openClusterId = null;
            }
        }

        if (openClusterId) {
            const lastIdx = candles.length - 1;
            const terminal = confirmedOpenTime ? "STILL_ACTIVE_AT_DATASET_END" : "STILL_BUILDING_AT_DATASET_END";
            results.push(finishLifecycle(
                candles, side, openClusterId, startIdx, lastIdx, confirmedOpenTime,
                null, terminal, null, true, allOutcomes
            ));
        }
    }

    return results;
}

function finishLifecycle(
    candles: CandleInfo[],
    side: "long" | "short",
    clusterId: string,
    startIdx: number,
    endIdx: number,
    confirmedOpenTime: number | null,
    endOpenTime: number | null,
    terminalStatus: AnchorLifecycleOutcome["terminalStatus"],
    runLengthAtBreak: number | null,
    censored: boolean,
    allOutcomes: ForwardOutcome[]
): AnchorLifecycleOutcome {
    const direction: SIGNAL_DIRECTION = side === "long" ? "LONG" : "SHORT";
    const outcome = computeForwardOutcome(candles, startIdx, Math.max(startIdx, endIdx), direction, censored);
    allOutcomes.push(outcome);

    return {
        side: side === "long" ? "LONG" : "SHORT",
        clusterId,
        startOpenTime: candles[startIdx].openTime,
        confirmedOpenTime,
        endOpenTime,
        terminalStatus,
        runLengthAtBreak,
        lifetimeCandles: endIdx - startIdx + 1,
        censored,
        outcome,
    };
}

// ── Sweep event outcomes (liquiditySweepInfo) ───────────────────────────
// Window = from this sweep (or this run of non-sweeps) forward until the
// NEXT sweep event of either side, or until no anchor is ACTIVE anymore —
// whichever the data reaches first.

function buildSweepEventOutcomes(
    candles: CandleInfo[],
    allOutcomes: ForwardOutcome[]
): SweepEventOutcome[] {
    const results: SweepEventOutcome[] = [];

    const keyFn = (i: number): string | null => {
        const info = candles[i].liquiditySweepInfo;
        if (!info || info.behavior === "NO_ACTIVE_HEATMAP") return null;
        return info.behavior; // "SWEPT" or "NO_SWEEP" — runs of each become one sample
    };

    const runs = findRuns(candles.length, keyFn);

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const nextRun = runs[i + 1];
        const endIdx = nextRun ? nextRun.startIdx - 1 : run.endIdx;
        const censored = !nextRun && run.ranOffEnd;

        const startInfo = candles[run.startIdx].liquiditySweepInfo!;
        const sides = startInfo.measuredSides;
        const direction: SIGNAL_DIRECTION = sides.length === 1 ? (sides[0] === "LONG" ? "LONG" : "SHORT") : "NEUTRAL";

        const outcome = computeForwardOutcome(candles, run.startIdx, Math.max(run.startIdx, endIdx), direction, censored);
        allOutcomes.push(outcome);

        results.push({
            timestamp: candles[run.startIdx].openTime,
            behavior: run.key as SweepEventOutcome["behavior"],
            sweptRatio: startInfo.sweptRatio,
            measuredSides: sides,
            isControlSample: run.key === "NO_SWEEP",
            outcome,
        });
    }

    return results;
}

// ── Price action sequence outcomes ──────────────────────────────────────
// Groups candles by matching (direction, level) on priceAction.reclaim.level,
// same grouping key the visualizer uses for its level-line segments.

function buildPriceActionSequenceOutcomes(
    candles: CandleInfo[],
    allOutcomes: ForwardOutcome[]
): PriceActionSequenceOutcome[] {
    const results: PriceActionSequenceOutcome[] = [];

    const keyFn = (i: number): string | null => {
        const pa = candles[i].priceAction;
        if (!pa || pa.sequence.direction === "NEUTRAL") return null;
        return `${pa.sequence.direction}-${pa.reclaim.level}`;
    };

    const runs = findRuns(candles.length, keyFn);

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const startCandle = candles[run.startIdx];
        const endCandle = candles[run.endIdx];
        const pa = endCandle.priceAction!;
        const direction = pa.sequence.direction;
        const level = pa.reclaim.level;

        let terminalStage: PriceActionSequenceOutcome["terminalStage"] = "PENDING";
        if (pa.sequence.closeConfirmation) terminalStage = "CONFIRMED";
        else if (pa.sequence.displacement) terminalStage = "DISPLACED";
        else if (pa.sequence.reclaim) terminalStage = "RECLAIMED";
        else if (pa.sequence.rejection) terminalStage = "REJECTED";
        // A run that ends because the NEXT run overrode it (rather than
        // running off the dataset) and never reclaimed is effectively an
        // invalidated attempt.
        const nextRun = runs[i + 1];
        const overridden = !!nextRun && !run.ranOffEnd;
        if (overridden && !pa.sequence.reclaim) terminalStage = "INVALIDATED";

        let candlesToReject: number | null = null, candlesToReclaim: number | null = null;
        let candlesToDisplace: number | null = null, candlesToConfirm: number | null = null;
        let confirmIdx: number | null = null;
        for (let c = run.startIdx; c <= run.endIdx; c++) {
            const p = candles[c].priceAction!;
            if (candlesToReject === null && p.rejection.detected) candlesToReject = c - run.startIdx;
            if (candlesToReclaim === null && p.reclaim.detected) candlesToReclaim = c - run.startIdx;
            if (candlesToDisplace === null && p.displacement.detected) candlesToDisplace = c - run.startIdx;
            if (candlesToConfirm === null && p.sequence.closeConfirmation) { candlesToConfirm = c - run.startIdx; confirmIdx = c; }
        }

        const outcomeFromSweep = computeForwardOutcome(candles, run.startIdx, run.endIdx, direction, run.ranOffEnd);
        allOutcomes.push(outcomeFromSweep);

        let outcomeFromConfirmation: ForwardOutcome | null = null;
        if (confirmIdx !== null) {
            outcomeFromConfirmation = computeForwardOutcome(candles, confirmIdx, run.endIdx, direction, run.ranOffEnd);
            allOutcomes.push(outcomeFromConfirmation);
        }

        results.push({
            clusterKey: run.key,
            direction,
            level,
            startOpenTime: startCandle.openTime,
            terminalStage,
            candlesToReject, candlesToReclaim, candlesToDisplace, candlesToConfirm,
            censored: run.ranOffEnd,
            outcomeFromSweep,
            outcomeFromConfirmation,
        });
    }

    return results;
}

// ── Combinations ─────────────────────────────────────────────────────────

function tercileLabel(value: number, p33: number, p66: number): "LOW" | "MED" | "HIGH" {
    if (value <= p33) return "LOW";
    if (value <= p66) return "MED";
    return "HIGH";
}

interface RawCombinations {
    alignmentGroups: Map<string, PendingBucketGroup>;
    pairwiseGroups: Array<{ id: string; fieldA: string; fieldB: string; groups: Map<string, PendingBucketGroup> }>;
    sweepMagnitudeVsTerminalStage: SweepMagnitudeVsTerminalStage[];
}

function buildCombinationGroups(
    candles: CandleInfo[],
    priceActionOutcomes: PriceActionSequenceOutcome[],
    categoricalOutcomes: ForwardOutcome[]
): RawCombinations {
    // Alignment count: positioning direction (buildups only — see
    // positioningDirection), sweep side, price-action sequence direction.
    // Covering/unwinding behaviors are deliberately excluded from this
    // vote — they describe existing conviction LEAVING, a different signal
    // than the other two (both forward-looking setups).
    const alignmentKeyFn = (i: number): string | null => {
        const behavior = candles[i].openInterest?.positioningState?.behavior;
        const posDir = behavior === "LONG_BUILDUP" ? "LONG" : behavior === "SHORT_BUILDUP" ? "SHORT" : "NEUTRAL";
        const sides = candles[i].liquiditySweepInfo?.measuredSides ?? [];
        const sweepDir = sides.length === 1 ? (sides[0] === "LONG" ? "LONG" : "SHORT") : "NEUTRAL";
        const paDir = candles[i].priceAction?.sequence.direction ?? "NEUTRAL";

        let longVotes = 0, shortVotes = 0;
        for (const d of [posDir, sweepDir, paDir]) {
            if (d === "LONG") longVotes++;
            if (d === "SHORT") shortVotes++;
        }
        const aligned = Math.max(longVotes, shortVotes);
        const total = longVotes + shortVotes;
        if (total === 0) return null;
        return `${aligned}/${total}`;
    };
    const alignmentDirFn = (_key: string): SIGNAL_DIRECTION => "NEUTRAL"; // the count itself is the signal, not a side
    const alignmentGroups = buildCategoryGroups(candles, alignmentKeyFn, alignmentDirFn, null, categoricalOutcomes);

    // Curated pairwise combos: positioning behavior x volume confirmation,
    // and positioning behavior x account agreement — do the two
    // confirmation channels we built actually change the outcome, or are
    // they noise we're carrying for nothing.
    const pairwiseDefs: Array<{ id: string; fieldA: string; fieldB: string; keyFn: (i: number) => string | null }> = [
        {
            id: "positioning-behavior_x_volume-confirmation",
            fieldA: "positioningState.behavior", fieldB: "positioningState.volumeConfirmation",
            keyFn: (i) => {
                const p = candles[i].openInterest?.positioningState;
                if (!p) return null;
                return `${p.behavior}|${p.volumeConfirmation}`;
            },
        },
        {
            id: "positioning-behavior_x_account-agreement",
            fieldA: "positioningState.behavior", fieldB: "positioningState.accountAgreement",
            keyFn: (i) => {
                const p = candles[i].openInterest?.positioningState;
                if (!p) return null;
                return `${p.behavior}|${p.accountAgreement}`;
            },
        },
    ];

    const pairwiseGroups = pairwiseDefs.map(def => ({
        id: def.id, fieldA: def.fieldA, fieldB: def.fieldB,
        groups: buildCategoryGroups(candles, def.keyFn, () => "NEUTRAL", null, categoricalOutcomes),
    }));

    // Sweep magnitude vs how far the resulting price-action sequence went —
    // terciles computed from THIS dataset's own sweptRatio-at-start values.
    // Doesn't touch MOVE_OUTCOME classification at all, so it's safe to
    // finalize immediately (no ordering dependency).
    const ratiosForTercile: number[] = [];
    for (const seq of priceActionOutcomes) {
        const startIdx = candles.findIndex(c => c.openTime === seq.startOpenTime);
        ratiosForTercile.push(startIdx >= 0 ? (candles[startIdx].liquiditySweepInfo?.sweptRatio ?? 0) : 0);
    }
    const p33 = percentile(ratiosForTercile, 33);
    const p66 = percentile(ratiosForTercile, 66);

    const tercileGroups = new Map<string, { count: number; stageCounts: Record<string, number> }>();
    priceActionOutcomes.forEach((seq, idx) => {
        const tier = tercileLabel(ratiosForTercile[idx], p33, p66);
        let g = tercileGroups.get(tier);
        if (!g) { g = { count: 0, stageCounts: {} }; tercileGroups.set(tier, g); }
        g.count++;
        g.stageCounts[seq.terminalStage] = (g.stageCounts[seq.terminalStage] ?? 0) + 1;
    });

    const sweepMagnitudeVsTerminalStage: SweepMagnitudeVsTerminalStage[] = [];
    for (const [tier, g] of tercileGroups) {
        sweepMagnitudeVsTerminalStage.push({
            sweptRatioTercile: tier as "LOW" | "MED" | "HIGH",
            sampleCount: g.count,
            terminalStageCounts: g.stageCounts as SweepMagnitudeVsTerminalStage["terminalStageCounts"],
        });
    }

    return { alignmentGroups, pairwiseGroups, sweepMagnitudeVsTerminalStage };
}

/** Must run AFTER classifyAllOutcomes — this is where outcome.moveOutcome actually gets read into the aggregated distributions. */
function finalizeCombinations(raw: RawCombinations): CombinationSection {
    const alignmentCounts: AlignmentCountBucket[] = [];
    for (const [key, g] of raw.alignmentGroups) {
        const [aligned, total] = key.split("/").map(Number);
        alignmentCounts.push({
            alignedSignalCount: aligned as 0 | 1 | 2 | 3,
            totalSignalsConsidered: total,
            sampleCount: g.outcomes.length,
            outcome: aggregateDistribution(g.outcomes),
        });
    }

    const pairwise: PairwiseCombinationBucket[] = [];
    for (const def of raw.pairwiseGroups) {
        for (const [key, g] of def.groups) {
            const [valueA, valueB] = key.split("|");
            pairwise.push({
                combinationId: `${def.id}:${key}`,
                fieldA: def.fieldA, valueA,
                fieldB: def.fieldB, valueB,
                sampleCount: g.outcomes.length,
                belowMinSampleSize: g.outcomes.length < CONFIG.MIN_COMBINATION_SAMPLE_SIZE,
                outcome: aggregateDistribution(g.outcomes),
            });
        }
    }

    return {
        alignmentCounts,
        pairwise,
        sweepMagnitudeVsTerminalStage: raw.sweepMagnitudeVsTerminalStage,
        minSampleSize: CONFIG.MIN_COMBINATION_SAMPLE_SIZE,
    };
}

// ── Magnet analysis ──────────────────────────────────────────────────────
// Does price get pulled toward remaining liquidity on the OTHER side after
// interacting with a level, vs a comparable random control level?

function findPeakOppositeSide(
    finalPool: number[], rangeLow: number, bucketHeight: number,
    currentPrice: number, side: "above" | "below"
): { price: number; value: number } | null {
    let bestIdx = -1, bestValue = 0;
    for (let idx = 0; idx < finalPool.length; idx++) {
        const bucketPrice = rangeLow + idx * bucketHeight + bucketHeight / 2;
        if (side === "above" && bucketPrice <= currentPrice) continue;
        if (side === "below" && bucketPrice >= currentPrice) continue;
        if (finalPool[idx] > bestValue) { bestValue = finalPool[idx]; bestIdx = idx; }
    }
    if (bestIdx < 0) return null;
    return { price: rangeLow + bestIdx * bucketHeight + bucketHeight / 2, value: bestValue };
}

function buildMagnetAnalysis(candles: CandleInfo[]): MagnetAnalysisResult[] {
    const results: MagnetAnalysisResult[] = [];

    const triggers: Array<{ idx: number; originLevel: number; type: MagnetAnalysisResult["triggerType"] }> = [];

    for (let i = 1; i < candles.length; i++) {
        const sweep = candles[i].liquiditySweepInfo;
        if (sweep?.behavior === "SWEPT" && sweep.peakPrice !== null) {
            triggers.push({ idx: i, originLevel: sweep.peakPrice, type: "SWEEP" });
        }
        const pa = candles[i].priceAction;
        const prevPa = candles[i - 1].priceAction;
        if (pa?.sequence.closeConfirmation && !prevPa?.sequence.closeConfirmation) {
            triggers.push({ idx: i, originLevel: pa.reclaim.level, type: "PRICE_ACTION_CONFIRMED" });
        }
    }

    for (const trigger of triggers) {
        const stamp = candles[trigger.idx].liquidationHeatmapStamp;
        const activeSides: number[] = [];
        if (stamp?.long.status === "ACTIVE" && stamp.long.eventCandleIndex !== null) activeSides.push(stamp.long.eventCandleIndex);
        if (stamp?.short.status === "ACTIVE" && stamp.short.eventCandleIndex !== null) activeSides.push(stamp.short.eventCandleIndex);
        if (!activeSides.length) continue;

        const anchorStart = Math.min(...activeSides);
        const slice = candles.slice(anchorStart, trigger.idx + 1);
        const heatmap = getLiquidationHeatmap(slice);
        if (!heatmap) continue;

        const currentClose = candles[trigger.idx].close;
        const side: "above" | "below" = trigger.originLevel < currentClose ? "above" : "below";
        const target = findPeakOppositeSide(heatmap.finalPool, heatmap.rangeLow, heatmap.bucketHeight, currentClose, side);
        if (!target) continue;

        const distance = Math.abs(target.price - currentClose);
        const jitter = 0.6 + seededRandom(candles[trigger.idx].openTime) * 0.8; // 0.6x - 1.4x the real distance
        const controlPrice = side === "above" ? currentClose + distance * jitter : currentClose - distance * jitter;

        const atr = candles[trigger.idx].atr;
        const tolerance = atr > 0 ? atr * CONFIG.MAGNET_TOUCH_TOLERANCE_ATR : 0;

        // The target's own bucket bounds — NOT the same thing as "target
        // price ± tolerance". The heatmap clears a whole bucket the
        // instant any candle's [low, high] overlaps ANY part of it (see
        // clearSweptRange in liquidationHeatmap.ts), so a candle can wipe
        // out the target's resting liquidity by clipping just the edge of
        // its bucket — nowhere near the target's exact price — without
        // that ever counting as "hitting" the target in the tolerance
        // sense. Checking bucket overlap (wide, matches the real clearing
        // mechanics) instead of point-plus-tolerance overlap (narrow, and
        // a strict subset of the hit condition below) is what makes
        // "drained" a genuinely different, reachable event rather than
        // dead code.
        const targetBucketLow = target.price - heatmap.bucketHeight / 2;
        const targetBucketHigh = target.price + heatmap.bucketHeight / 2;

        let targetHit = false, controlHit = false, targetDrained = false;
        let candlesToHitTarget: number | null = null, candlesToHitControl: number | null = null;
        let endIdx = candles.length - 1;

        for (let j = trigger.idx + 1; j < candles.length; j++) {
            const c = candles[j];
            if (!targetHit && c.high >= target.price - tolerance && c.low <= target.price + tolerance) {
                targetHit = true; candlesToHitTarget = j - trigger.idx;
            }
            if (!controlHit && c.high >= controlPrice - tolerance && c.low <= controlPrice + tolerance) {
                controlHit = true; candlesToHitControl = j - trigger.idx;
            }
            if (!targetHit && !targetDrained && c.high >= targetBucketLow && c.low <= targetBucketHigh) {
                targetDrained = true;
            }
            if (targetHit && controlHit) { endIdx = j; break; }
            endIdx = j;
        }

        const censored = !targetHit && !targetDrained && endIdx === candles.length - 1;
        const fractionOfDistanceClosed = distance > 0
            ? Math.max(0, Math.min(1, (distance - Math.abs(target.price - candles[endIdx].close)) / distance))
            : 0;

        results.push({
            triggerType: trigger.type,
            triggerTimestamp: candles[trigger.idx].openTime,
            originLevel: trigger.originLevel,
            targetPrice: target.price,
            targetPoolValue: target.value,
            controlPrice,
            targetHit, controlHit,
            targetDrainedByOtherSweep: targetDrained,
            candlesToHitTarget, candlesToHitControl,
            horizonCandles: endIdx - trigger.idx,
            fractionOfDistanceClosed,
            censored,
        });
    }

    return results;
}

// ── Event timelines ──────────────────────────────────────────────────────

function toSnapshot(candle: CandleInfo): CandleSnapshot {
    const seq = candle.priceAction?.sequence;
    const hasActiveSequence = !!seq && seq.direction !== "NEUTRAL";
    return {
        openTime: candle.openTime,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume,
        atr: candle.atr,
        positioningBehavior: candle.openInterest?.positioningState?.behavior ?? "INSUFFICIENT_DATA",
        liquiditySweepBehavior: candle.liquiditySweepInfo?.behavior ?? "NO_ACTIVE_HEATMAP",
        priceActionStage: hasActiveSequence
            ? (seq!.closeConfirmation ? "CONFIRMED"
                : seq!.displacement ? "DISPLACED"
                : seq!.reclaim ? "RECLAIMED"
                : seq!.rejection ? "REJECTED" : "PENDING")
            : null,
    };
}

function buildEventTimelines(
    candles: CandleInfo[],
    anchorOutcomes: AnchorLifecycleOutcome[],
    sweepOutcomes: SweepEventOutcome[],
    priceActionOutcomes: PriceActionSequenceOutcome[]
): EventTimelineWindow[] {
    const windows: EventTimelineWindow[] = [];
    const findIdx = (openTime: number) => candles.findIndex(c => c.openTime === openTime);

    const pushWindow = (eventType: EventTimelineWindow["eventType"], idx: number, beforeLen: number, afterLen: number) => {
        if (idx < 0) return;
        windows.push({
            eventType,
            eventTimestamp: candles[idx].openTime,
            beforeCandles: candles.slice(Math.max(0, idx - beforeLen), idx).map(toSnapshot),
            afterCandles: candles.slice(idx, Math.min(candles.length, idx + afterLen + 1)).map(toSnapshot),
        });
    };

    for (const a of anchorOutcomes) {
        if (a.confirmedOpenTime) {
            const idx = findIdx(a.confirmedOpenTime);
            pushWindow("CLUSTER_CONFIRMED", idx, a.lifetimeCandles ?? 10, a.outcome.horizonCandles);
        }
        if (a.endOpenTime) {
            const idx = findIdx(a.endOpenTime);
            pushWindow("CLUSTER_ENDED", idx, a.lifetimeCandles ?? 10, a.outcome.horizonCandles);
        }
    }

    for (const s of sweepOutcomes) {
        if (s.behavior !== "SWEPT") continue;
        const idx = findIdx(s.timestamp);
        pushWindow("SWEEP", idx, 10, s.outcome.horizonCandles);
    }

    for (const p of priceActionOutcomes) {
        if (p.terminalStage === "CONFIRMED" && p.candlesToConfirm !== null) {
            const startIdx = findIdx(p.startOpenTime);
            const confirmIdx = startIdx + p.candlesToConfirm;
            pushWindow("PRICE_ACTION_CONFIRMED", confirmIdx, p.candlesToConfirm, p.outcomeFromConfirmation?.horizonCandles ?? 10);
        }
        if (p.terminalStage === "INVALIDATED") {
            const startIdx = findIdx(p.startOpenTime);
            pushWindow("PRICE_ACTION_INVALIDATED", startIdx, 10, p.outcomeFromSweep.horizonCandles);
        }
    }

    return windows;
}

// ── Cross-module consistency checks ─────────────────────────────────────
// These two field pairs are each computed independently from the same
// underlying raw data by two different modules — frequent disagreement
// here points at a bug in one of them, not a market finding.

function buildCrossChecks(candles: CandleInfo[]): CrossCheckResult[] {
    const results: CrossCheckResult[] = [];

    // Compares the RAW, unthresholded sign of change, not each module's own
    // thresholded category label. accountShareChangePercent (percentage
    // points of longAccount/(longAccount+shortAccount)) and
    // longShort.ratioChange (raw longAccount/shortAccount delta) are
    // computed on different scales with different flat thresholds, but
    // share is a strictly monotonic function of ratio — so if both are
    // reading the same underlying (current, previous) LongShortRatioEntry
    // pair correctly, their signs must agree essentially always,
    // regardless of how different their magnitudes/thresholds are. A
    // comparison of the two modules' own thresholded labels found 0%
    // agreement here purely from the units mismatch (see positioningState
    // module docs) — this version tests the thing that's actually
    // supposed to agree.
    let agree = 0, disagree = 0, total = 0;
    for (const c of candles) {
        const shareChange = c.openInterest?.positioningState?.accountShareChangePercent;
        const shareDir = c.openInterest?.positioningState?.accountShareDirection;
        const ratioChange = c.longShort?.ratioChange;
        if (shareDir === undefined || shareDir === "INSUFFICIENT_DATA" || shareChange === undefined || ratioChange === undefined) continue;
        const shareSign = Math.sign(shareChange);
        const ratioSign = Math.sign(ratioChange);
        if (shareSign === 0 || ratioSign === 0) continue; // an exact-zero change isn't informative for a sign comparison
        total++;
        if (shareSign === ratioSign) agree++; else disagree++;
    }
    if (total > 0) {
        results.push({
            description: "sign(positioningState.accountShareChangePercent) vs sign(longShort.ratioChange) — raw, unthresholded (both derived from the same long/short ratio data; should agree almost always since share is a monotonic function of ratio)",
            agreementRate: agree / total,
            disagreementCount: disagree,
            sampleCount: total,
        });
    }

    agree = 0; disagree = 0; total = 0;
    for (const c of candles) {
        const posVolDir = c.openInterest?.positioningState?.volumeDirection;
        const volState = c.volumeState?.state;
        if (!posVolDir || !volState || posVolDir === "INSUFFICIENT_DATA") continue;
        const volDir = volState === "EXPANDING" ? "RISING" : volState === "CONTRACTING" ? "FALLING" : (volState === "NORMAL" || volState === "NEUTRAL") ? "FLAT" : null;
        if (!volDir) continue;
        total++;
        if (posVolDir === volDir) agree++; else disagree++;
    }
    if (total > 0) {
        results.push({
            description: "positioningState.volumeDirection vs volumeState.state (both derived from candle volume)",
            agreementRate: agree / total,
            disagreementCount: disagree,
            sampleCount: total,
        });
    }

    return results;
}

// ── Entry point ──────────────────────────────────────────────────────────

export function analyzeMovements(
    rawCandles: CandleInfo[],
    meta?: { symbol?: string; interval?: MARKET_INTERVAL }
): SimulationAnalysisReport {

    // SimulationUtilityV2.runAnalysis starts its loop at i=1, so candles[0]
    // (and, defensively, any other leading candle before the simulation
    // actually started) carries none of the computed fields this analyzer
    // reads — it's raw OHLCV only, not a real "no signal" data point.
    // Including it would mean treating "never simulated" the same as
    // "simulated and found nothing", which is a different fact. Drop every
    // leading candle up to the first one that's actually been processed.
    const firstProcessedIdx = rawCandles.findIndex(c => c.openInterest !== undefined);
    const candles = firstProcessedIdx === -1 ? [] : rawCandles.slice(firstProcessedIdx);

    // Two SEPARATE calibration pools, not one shared global pool. Joint
    // categorical keys (alignment counts, pairwise combos) require multiple
    // fields to match simultaneously to keep a run alive, which produces
    // much shorter runs — and therefore much smaller price moves — than
    // event-driven windows like a 90-candle anchor lifecycle. Calibrating
    // both against one shared percentile pool squeezed every short-window
    // categorical outcome under the cutoff regardless of its own relative
    // size, making the CHOP/CONTINUATION/REVERSAL labels meaningless for
    // that whole family. Each pool is now calibrated only against outcomes
    // of a comparable natural scale.
    const categoricalOutcomes: ForwardOutcome[] = [];
    const eventOutcomes: ForwardOutcome[] = [];

    const positioningGroups = buildCategoryGroups(
        candles,
        (i) => candles[i].openInterest?.positioningState?.behavior ?? null,
        positioningDirection,
        (i) => candles[i].openInterest?.positioningState?.strength ?? 0,
        categoricalOutcomes
    );
    const volumeConfirmationGroups = buildCategoryGroups(
        candles,
        (i) => candles[i].openInterest?.positioningState?.volumeConfirmation ?? null,
        () => "NEUTRAL",
        null,
        categoricalOutcomes
    );
    const accountAgreementGroups = buildCategoryGroups(
        candles,
        (i) => candles[i].openInterest?.positioningState?.accountAgreement ?? null,
        () => "NEUTRAL",
        null,
        categoricalOutcomes
    );
    const longShortGroups = buildCategoryGroups(
        candles,
        (i) => candles[i].longShort?.state ?? null,
        lsStateDirection,
        (i) => candles[i].longShort?.strength ?? 0,
        categoricalOutcomes
    );
    const volumeStateGroups = buildCategoryGroups(
        candles,
        (i) => candles[i].volumeState?.state ?? null,
        volumeStateDirection,
        (i) => candles[i].volumeState?.strength ?? 0,
        categoricalOutcomes
    );

    const anchorLifecycleOutcomes = buildAnchorLifecycleOutcomes(candles, eventOutcomes);
    const sweepEventOutcomes = buildSweepEventOutcomes(candles, eventOutcomes);
    const priceActionSequenceOutcomes = buildPriceActionSequenceOutcomes(candles, eventOutcomes);
    const rawCombinations = buildCombinationGroups(candles, priceActionSequenceOutcomes, categoricalOutcomes);
    const magnetAnalysis = buildMagnetAnalysis(candles);
    const eventTimelines = buildEventTimelines(candles, anchorLifecycleOutcomes, sweepEventOutcomes, priceActionSequenceOutcomes);
    const crossModuleConsistencyChecks = buildCrossChecks(candles);

    // Calibrate each pool separately — must happen after every outcome in
    // that pool has been collected.
    const categoricalCutoffs = classifyAllOutcomes(categoricalOutcomes);
    const eventCutoffs = classifyAllOutcomes(eventOutcomes);

    // Only NOW is it safe to aggregate anything that reads outcome.moveOutcome.
    const combinations = finalizeCombinations(rawCombinations);

    const stateBucketReports: ModuleBucketReport[] = [
        finalizeBucketReport("positioningState", "behavior", positioningGroups),
        finalizeBucketReport("positioningState", "volumeConfirmation", volumeConfirmationGroups),
        finalizeBucketReport("positioningState", "accountAgreement", accountAgreementGroups),
        finalizeBucketReport("longShortState", "state", longShortGroups),
        finalizeBucketReport("volumeState", "state", volumeStateGroups),
    ];

    const metadata: AnalysisMetadata = {
        symbol: meta?.symbol ?? "",
        interval: meta?.interval ?? "15m",
        candleCount: candles.length,
        startTime: candles[0]?.openTime ?? 0,
        endTime: candles[candles.length - 1]?.openTime ?? 0,
        generatedAt: Date.now(),
        parameters: {
            MIN_COMBINATION_SAMPLE_SIZE: CONFIG.MIN_COMBINATION_SAMPLE_SIZE,
            MAGNET_TOUCH_TOLERANCE_ATR: CONFIG.MAGNET_TOUCH_TOLERANCE_ATR,
            categoricalOutcomePoolSize: categoricalOutcomes.length,
            categoricalP33Atr: categoricalCutoffs.p33,
            categoricalP66Atr: categoricalCutoffs.p66,
            eventOutcomePoolSize: eventOutcomes.length,
            eventP33Atr: eventCutoffs.p33,
            eventP66Atr: eventCutoffs.p66,
        },
    };

    return {
        metadata,
        stateBucketReports,
        anchorLifecycleOutcomes,
        sweepEventOutcomes,
        priceActionSequenceOutcomes,
        combinations,
        magnetAnalysis,
        eventTimelines,
        crossModuleConsistencyChecks,
    };
}