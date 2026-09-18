// Intended location: src/utility/wispForestModel.ts
// (sibling of wispRidgeModel.ts)
//
// Ridge regression (wispRidgeModel.ts) found essentially no LINEAR
// relationship between the current profile features and MFE/MAE
// (R²≈0 on real data). This module tries the natural next step: a
// Random Forest, which can capture nonlinear interactions a straight
// line structurally cannot — e.g. "AVWAP distance only matters when
// spread is tight," which ridge regression has no way to represent.
//
// Built from scratch rather than an unverified third-party package,
// same reasoning as wispRidgeModel.ts. Deterministic: uses a seeded
// PRNG (not Math.random()) for bootstrap sampling and feature
// subsetting, so re-running training on the same data reproduces the
// same forest and the same reported numbers — important for a research
// tool where reproducibility matters more than true randomness.

import type { RidgeFeatures } from "./wispRidgeModel";

function buildFeatureRow(f: RidgeFeatures): number[] {
    return [
        f.avwapDistance,
        f.frvpPocDistance ?? 0,
        f.frvpPocDistance !== null ? 1 : 0,
        f.redLevelDistance ?? 0,
        f.redLevelDistance !== null ? 1 : 0,
        f.favorableCount,
        f.spreadWide ? 1 : 0,
    ];
}

export const FOREST_FEATURE_NAMES = [
    "avwapDistance",
    "frvpPocDistance",
    "frvpPocPresent",
    "redLevelDistance",
    "redLevelPresent",
    "favorableCount",
    "spreadWide",
] as const;

/** Deterministic PRNG (mulberry32) — same seed always produces the same sequence, unlike Math.random(). */
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface TreeNode {
    isLeaf: boolean;
    prediction?: number;
    featureIdx?: number;
    threshold?: number;
    left?: TreeNode;
    right?: TreeNode;
}

function variance(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function mean(values: number[]): number {
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

export interface TreeParams {
    maxDepth: number;
    minSamplesLeaf: number;
    /** How many features to consider at each split — a random subset (not all of them) is the second de-correlation mechanism a Random Forest relies on, alongside bootstrap sampling. */
    featuresPerSplit: number;
}

function buildTree(rows: number[][], targets: number[], depth: number, params: TreeParams, rng: () => number): TreeNode {
    if (depth >= params.maxDepth || rows.length < params.minSamplesLeaf * 2) {
        return { isLeaf: true, prediction: mean(targets) };
    }

    const numFeatures = rows[0].length;
    const candidateFeatures = new Set<number>();
    while (candidateFeatures.size < Math.min(params.featuresPerSplit, numFeatures)) {
        candidateFeatures.add(Math.floor(rng() * numFeatures));
    }

    let bestFeature = -1;
    let bestThreshold = 0;
    let bestScore = variance(targets) * targets.length; // current weighted variance — a split must beat this
    let bestLeftIdx: number[] = [];
    let bestRightIdx: number[] = [];

    for (const featureIdx of candidateFeatures) {
        const values = [...new Set(rows.map(r => r[featureIdx]))].sort((a, b) => a - b);
        for (let i = 0; i < values.length - 1; i++) {
            const threshold = (values[i] + values[i + 1]) / 2;
            const leftIdx: number[] = [];
            const rightIdx: number[] = [];
            for (let r = 0; r < rows.length; r++) {
                if (rows[r][featureIdx] <= threshold) leftIdx.push(r);
                else rightIdx.push(r);
            }
            if (leftIdx.length < params.minSamplesLeaf || rightIdx.length < params.minSamplesLeaf) continue;

            const leftTargets = leftIdx.map(i => targets[i]);
            const rightTargets = rightIdx.map(i => targets[i]);
            const score = variance(leftTargets) * leftTargets.length + variance(rightTargets) * rightTargets.length;
            if (score < bestScore) {
                bestScore = score;
                bestFeature = featureIdx;
                bestThreshold = threshold;
                bestLeftIdx = leftIdx;
                bestRightIdx = rightIdx;
            }
        }
    }

    if (bestFeature === -1) {
        return { isLeaf: true, prediction: mean(targets) };
    }

    const leftRows = bestLeftIdx.map(i => rows[i]);
    const leftTargets = bestLeftIdx.map(i => targets[i]);
    const rightRows = bestRightIdx.map(i => rows[i]);
    const rightTargets = bestRightIdx.map(i => targets[i]);

    return {
        isLeaf: false,
        featureIdx: bestFeature,
        threshold: bestThreshold,
        left: buildTree(leftRows, leftTargets, depth + 1, params, rng),
        right: buildTree(rightRows, rightTargets, depth + 1, params, rng),
    };
}

function predictTree(node: TreeNode, row: number[]): number {
    if (node.isLeaf) return node.prediction!;
    return row[node.featureIdx!] <= node.threshold! ? predictTree(node.left!, row) : predictTree(node.right!, row);
}

export interface ForestModel {
    trees: TreeNode[];
    params: TreeParams;
    trainedOn: number;
}

/**
 * Fits numTrees regression trees, each on a bootstrap sample (random
 * sample WITH replacement, the standard Random Forest technique) with a
 * random feature subset per split — both mechanisms exist specifically
 * to de-correlate the trees so averaging them actually reduces variance
 * instead of just averaging copies of the same overfit tree.
 */
export function fitForest(
    featureRows: RidgeFeatures[],
    targets: number[],
    numTrees: number,
    params: TreeParams,
    seed: number = 12345
): ForestModel {
    if (featureRows.length !== targets.length) throw new Error("featureRows and targets must have the same length");
    const rows = featureRows.map(buildFeatureRow);
    const rng = makeRng(seed);
    const trees: TreeNode[] = [];

    for (let t = 0; t < numTrees; t++) {
        const bootstrapIdx: number[] = [];
        for (let i = 0; i < rows.length; i++) bootstrapIdx.push(Math.floor(rng() * rows.length));
        const bootRows = bootstrapIdx.map(i => rows[i]);
        const bootTargets = bootstrapIdx.map(i => targets[i]);
        trees.push(buildTree(bootRows, bootTargets, 0, params, rng));
    }

    return { trees, params, trainedOn: featureRows.length };
}

export function predictForest(model: ForestModel, features: RidgeFeatures): number {
    const row = buildFeatureRow(features);
    const predictions = model.trees.map(tree => predictTree(tree, row));
    return mean(predictions);
}

export interface ForestCrossValidationResult {
    foldR2: number[];
    meanR2: number;
    foldMae: number[];
    meanMae: number;
}

function medianOf(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Same k-fold discipline as crossValidateRidge — fit on k-1 folds, evaluate on the held-out fold, so overfitting shows up as a genuinely low score rather than being hidden by an in-sample fit. */
export function crossValidateForest(
    featureRows: RidgeFeatures[],
    targets: number[],
    numTrees: number,
    params: TreeParams,
    k: number = 5,
    seed: number = 12345
): ForestCrossValidationResult {
    const n = featureRows.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    const shuffled = indices
        .map(i => ({ i, key: (i * 2654435761) % 2147483647 }))
        .sort((a, b) => a.key - b.key)
        .map(x => x.i);

    const foldSize = Math.floor(n / k);
    const foldR2: number[] = [];
    const foldMae: number[] = [];

    for (let fold = 0; fold < k; fold++) {
        const testStart = fold * foldSize;
        const testEnd = fold === k - 1 ? n : testStart + foldSize;
        const testIdx = new Set(shuffled.slice(testStart, testEnd));

        const trainRows: RidgeFeatures[] = [];
        const trainTargets: number[] = [];
        const testRows: RidgeFeatures[] = [];
        const testTargets: number[] = [];
        for (const i of shuffled) {
            if (testIdx.has(i)) {
                testRows.push(featureRows[i]);
                testTargets.push(targets[i]);
            } else {
                trainRows.push(featureRows[i]);
                trainTargets.push(targets[i]);
            }
        }
        if (!trainRows.length || !testRows.length) continue;

        const model = fitForest(trainRows, trainTargets, numTrees, params, seed + fold);
        const predictions = testRows.map(r => predictForest(model, r));

        const testMean = testTargets.reduce((s, v) => s + v, 0) / testTargets.length;
        const ssRes = predictions.reduce((s, p, i) => s + (testTargets[i] - p) ** 2, 0);
        const ssTot = testTargets.reduce((s, v) => s + (v - testMean) ** 2, 0);
        const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
        const mae = predictions.reduce((s, p, i) => s + Math.abs(testTargets[i] - p), 0) / predictions.length;

        foldR2.push(r2);
        foldMae.push(mae);
    }

    return { foldR2, meanR2: medianOf(foldR2), foldMae, meanMae: medianOf(foldMae) };
}