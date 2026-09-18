// Intended location: src/utility/wispRidgeModel.ts
//
// The actual learning component wisp was missing. Everything else in
// this pipeline (profile classification, nearest-signature matching) is
// deterministic lookup — no parameters are learned from data, which is
// exactly the "vanilla methods, flat functions" critique this module
// exists to answer.
//
// Ridge regression: a linear model (Y = Xβ) with L2 regularization,
// fit via the closed-form solution β = (XᵀX + λI)⁻¹Xᵀy. Chosen over
// gradient boosting or a neural net specifically because of dataset
// scale — a few thousand samples, ~7 features, heavily skewed across
// profile types. Research (see the conversation this was built from)
// is consistent: at this scale, regularized linear regression is the
// strongest baseline, and deep learning is explicitly discouraged
// ("with <10K observations and few hundred features, deep nets
// typically don't beat XGBoost" — we have far fewer than that).
//
// Trained across the WHOLE catalog at once, not bucketed into sparse
// profile-type groups — this is the concrete fix for the sparsity
// problem the nearest-neighbor approach had: a learned function doesn't
// need K samples in a local cluster to make a prediction, it
// generalizes from everything it saw.
//
// Predicts NORMALIZED (ATR-divided) mfe/mae, not raw price distances —
// same reason the catalog-matching path had to be fixed earlier: raw
// price distances aren't comparable across symbols of wildly different
// scale, so the model has to learn in the normalized space and get
// rescaled by the LIVE symbol's own ATR at prediction time.

export interface RidgeFeatures {
    avwapDistance: number;
    frvpPocDistance: number | null;
    redLevelDistance: number | null;
    favorableCount: number;
    spreadWide: boolean;
}

/** The order feature vectors are built in — exported so training and prediction can never silently drift out of sync with each other. */
export const FEATURE_NAMES = [
    "intercept",
    "avwapDistance",
    "frvpPocDistance",
    "frvpPocPresent",
    "redLevelDistance",
    "redLevelPresent",
    "favorableCount",
    "spreadWide",
] as const;

function buildFeatureRow(f: RidgeFeatures): number[] {
    return [
        1, // intercept
        f.avwapDistance,
        f.frvpPocDistance ?? 0,
        f.frvpPocDistance !== null ? 1 : 0,
        f.redLevelDistance ?? 0,
        f.redLevelDistance !== null ? 1 : 0,
        f.favorableCount,
        f.spreadWide ? 1 : 0,
    ];
}

export interface FeatureScaling {
    /** Mean of each column, computed on the TRAINING set only — applied identically at prediction time so a live query is standardized the same way training data was. */
    means: number[];
    /** Std dev of each column; 1 substituted for any column with zero variance (e.g. the constant intercept column) to avoid dividing by zero. */
    stds: number[];
}

/**
 * Ridge regression penalizes coefficient MAGNITUDE, so features on
 * different scales (favorableCount: 0-3, avwapDistance: often -5 to 5)
 * would be penalized unfairly without standardizing first. The
 * intercept column is left unscaled (mean 0, std 1) since it's already
 * a constant.
 */
export function computeScaling(rows: number[][]): FeatureScaling {
    const n = rows.length;
    const p = rows[0].length;
    const means = new Array(p).fill(0);
    const stds = new Array(p).fill(0);
    for (const row of rows) {
        for (let j = 0; j < p; j++) means[j] += row[j];
    }
    for (let j = 0; j < p; j++) means[j] /= n;
    for (const row of rows) {
        for (let j = 0; j < p; j++) stds[j] += (row[j] - means[j]) ** 2;
    }
    for (let j = 0; j < p; j++) stds[j] = Math.sqrt(stds[j] / n);
    // Intercept column (constant 1s) has zero variance — leave it
    // unscaled rather than dividing by zero.
    means[0] = 0;
    stds[0] = 1;
    for (let j = 1; j < p; j++) if (stds[j] === 0) stds[j] = 1;
    return { means, stds };
}

export function applyScaling(row: number[], scaling: FeatureScaling): number[] {
    return row.map((v, j) => (v - scaling.means[j]) / scaling.stds[j]);
}

function transpose(m: number[][]): number[][] {
    return m[0].map((_, j) => m.map(row => row[j]));
}

function matMul(a: number[][], b: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < a.length; i++) {
        result.push([]);
        for (let j = 0; j < b[0].length; j++) {
            let sum = 0;
            for (let k = 0; k < b.length; k++) sum += a[i][k] * b[k][j];
            result[i].push(sum);
        }
    }
    return result;
}

/** Gauss-Jordan matrix inversion — fine for the small (~8x8) matrices this module ever deals with (feature count is fixed and small), not meant for anything larger. */
function invertMatrix(m: number[][]): number[][] {
    const n = m.length;
    const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < n; col++) {
        let pivotRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[pivotRow][col])) pivotRow = row;
        }
        [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
        const pivot = aug[col][col];
        if (Math.abs(pivot) < 1e-12) throw new Error("Matrix is singular or near-singular — cannot invert (likely too few samples or collinear features).");
        for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = aug[row][col];
            for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
        }
    }
    return aug.map(row => row.slice(n));
}

export interface RidgeModel {
    coefficients: number[]; // in standardized feature space, aligned with FEATURE_NAMES
    scaling: FeatureScaling;
    lambda: number;
    trainedOn: number; // sample count
}

/**
 * Fits β = (XᵀX + λI)⁻¹Xᵀy on already-standardized features. The
 * intercept's own regularization is typically excluded in textbook
 * Ridge (penalizing the intercept doesn't make sense — it isn't a
 * "direction" to shrink), so λ is applied to every coefficient except
 * the first (intercept) row/column.
 */
export function fitRidge(featureRows: RidgeFeatures[], targets: number[], lambda: number): RidgeModel {
    if (featureRows.length !== targets.length) throw new Error("featureRows and targets must have the same length");
    if (featureRows.length < FEATURE_NAMES.length + 1) throw new Error(`Need at least ${FEATURE_NAMES.length + 1} samples to fit — got ${featureRows.length}`);

    const rawRows = featureRows.map(buildFeatureRow);
    const scaling = computeScaling(rawRows);
    const X = rawRows.map(row => applyScaling(row, scaling));
    const y = targets.map(v => [v]);

    const p = X[0].length;
    const Xt = transpose(X);
    const XtX = matMul(Xt, X);
    // Regularize every coefficient except the intercept (index 0).
    for (let i = 1; i < p; i++) XtX[i][i] += lambda;
    const XtXInv = invertMatrix(XtX);
    const Xty = matMul(Xt, y);
    const beta = matMul(XtXInv, Xty).map(row => row[0]);

    return { coefficients: beta, scaling, lambda, trainedOn: featureRows.length };
}

export function predictRidge(model: RidgeModel, features: RidgeFeatures): number {
    const raw = buildFeatureRow(features);
    const scaled = applyScaling(raw, model.scaling);
    return scaled.reduce((sum, v, j) => sum + v * model.coefficients[j], 0);
}

export interface CrossValidationResult {
    /** R² per fold — how much of the target's variance the model explains on data it did NOT train on. 1.0 is a perfect fit, 0 means "no better than always predicting the mean," negative means "worse than that." */
    foldR2: number[];
    meanR2: number;
    /** Mean absolute error per fold, in the same (normalized) units as the target — easier to read directly than R² alone. */
    foldMae: number[];
    meanMae: number;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * K-fold cross-validation — fits on k-1 folds, evaluates on the held-out
 * fold, rotates, repeats. This is the honest check on whether the model
 * actually learned something generalizable or just fit noise — report
 * this to the person training it rather than only ever showing an
 * in-sample fit, which would look good even for an overfit model.
 */
export function crossValidateRidge(featureRows: RidgeFeatures[], targets: number[], lambda: number, k: number = 5): CrossValidationResult {
    const n = featureRows.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    // Deterministic shuffle (not random) — a fixed permutation so
    // re-running cross-validation on the same data always reproduces
    // the same folds and the same reported numbers.
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
        if (trainRows.length < FEATURE_NAMES.length + 1 || !testRows.length) continue;

        const model = fitRidge(trainRows, trainTargets, lambda);
        const predictions = testRows.map(r => predictRidge(model, r));

        const testMean = testTargets.reduce((s, v) => s + v, 0) / testTargets.length;
        const ssRes = predictions.reduce((s, p, i) => s + (testTargets[i] - p) ** 2, 0);
        const ssTot = testTargets.reduce((s, v) => s + (v - testMean) ** 2, 0);
        const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
        const mae = predictions.reduce((s, p, i) => s + Math.abs(testTargets[i] - p), 0) / predictions.length;

        foldR2.push(r2);
        foldMae.push(mae);
    }

    return {
        foldR2,
        meanR2: median(foldR2),
        foldMae,
        meanMae: median(foldMae),
    };
}