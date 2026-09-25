import type { CandleInfo } from "@/core/interfacesv2";

/**
 * Decides whether a symbol currently looks "interesting" enough to open
 * a NEW position on, using ONLY price action and volume — deliberately
 * no open-interest or long/short-ratio dependency, unlike
 * symbolInterest.ts's own (OI/LS-based) checks. That one is fine for
 * live/recent scanning, where Binance's OI/LS history is actually
 * available; it isn't for the rolling simulation, which can be asked
 * to walk forward from any past date, and Binance's own OI/LS
 * retention only goes back ~30 days - a backtest starting further back
 * than that would silently have no OI/LS data to check against for
 * most of its own run.
 *
 * Operates directly on the CandleInfo[] window the rolling simulation
 * already holds in memory for each symbol - no separate fetch, unlike
 * symbolInterest.ts's own klines fetch (which exists there because
 * that scanner runs BEFORE any window has been loaded for a symbol).
 *
 * Same relative-volume/price-momentum/volatility-expansion thresholds
 * as symbolInterest.ts's own DEFAULT_SYMBOL_INTEREST_CONFIG, for
 * consistency - these three checks are the price/volume-only subset of
 * that file's own six. minReasonsRequired=2 (of 3) is a stated,
 * arbitrary threshold, same status as everything else here: not
 * derived from data, a reasonable starting point to revisit once this
 * has been observed against real backtest results.
 */

export interface PriceVolumeInterestResult {
    isInteresting: boolean;
    reasons: string[];
    // Raw metrics alongside the verdict, for debugging/tuning without
    // having to re-derive them.
    relativeVolume: number | null;
    priceChangePercent: number | null;
    volatilityExpansionRatio: number | null;
}

export interface PriceVolumeInterestConfig {
    /** How many of the most recent candles count as "right now" for the volume/range comparisons. */
    recentWindow: number;
    /** How far back price momentum looks. */
    lookbackWindow: number;
    /** Relative volume (in USDT terms - volume * close, not raw asset volume) at or beyond this ratio counts as unusually high activity. */
    relativeVolumeThreshold: number;
    /** A price move at or beyond this magnitude (either direction), over lookbackWindow, is a real move worth trading, not noise. */
    priceChangeThreshold: number;
    /** Current short-window range vs its own longer baseline, at or beyond this ratio, means volatility is actively expanding. */
    volatilityExpansionThreshold: number;
    /** How many of the 3 checks above must fire for the symbol to count as interesting. */
    minReasonsRequired: number;
}

export const DEFAULT_PRICE_VOLUME_INTEREST_CONFIG: PriceVolumeInterestConfig = {
    recentWindow: 8,
    lookbackWindow: 96,
    relativeVolumeThreshold: 1.6,
    priceChangeThreshold: 0.04,
    volatilityExpansionThreshold: 1.5,
    minReasonsRequired: 2,
};

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Evaluates interest as of the LAST candle in `candles` — the same
 * causal discipline as the rest of this pipeline: only ever looks at
 * candles up to and including the current one, never ahead.
 */
export function evaluatePriceVolumeInterest(
    candles: CandleInfo[],
    config: PriceVolumeInterestConfig = DEFAULT_PRICE_VOLUME_INTEREST_CONFIG
): PriceVolumeInterestResult {
    const reasons: string[] = [];
    const n = candles.length;

    let relativeVolume: number | null = null;
    let priceChangePercent: number | null = null;
    let volatilityExpansionRatio: number | null = null;

    // Relative volume (USDT terms: volume * close, not raw asset volume -
    // makes this comparable in spirit to how a person reads "volume" for
    // a symbol, and matches what the user asked for specifically).
    if (n >= config.recentWindow + config.lookbackWindow) {
        const recent = candles.slice(n - config.recentWindow);
        const baseline = candles.slice(n - config.recentWindow - config.lookbackWindow, n - config.recentWindow);
        const recentAvgUsdt = average(recent.map(c => c.volume * c.close));
        const baselineAvgUsdt = average(baseline.map(c => c.volume * c.close));
        if (baselineAvgUsdt > 0) {
            relativeVolume = recentAvgUsdt / baselineAvgUsdt;
            if (relativeVolume >= config.relativeVolumeThreshold) {
                reasons.push(`Relative volume ${relativeVolume.toFixed(2)}x baseline (USDT terms)`);
            }
        }
    }

    // Price momentum over lookbackWindow.
    if (n > config.lookbackWindow) {
        const priorClose = candles[n - 1 - config.lookbackWindow].close;
        const currentClose = candles[n - 1].close;
        if (priorClose > 0) {
            priceChangePercent = (currentClose - priorClose) / priorClose;
            if (Math.abs(priceChangePercent) >= config.priceChangeThreshold) {
                reasons.push(`Price moved ${(priceChangePercent * 100).toFixed(1)}% over the lookback window`);
            }
        }
    }

    // Volatility expansion: recent range vs its own baseline.
    if (n >= config.recentWindow + config.lookbackWindow) {
        const recent = candles.slice(n - config.recentWindow);
        const baseline = candles.slice(n - config.recentWindow - config.lookbackWindow, n - config.recentWindow);
        const recentAvgRange = average(recent.map(c => c.high - c.low));
        const baselineAvgRange = average(baseline.map(c => c.high - c.low));
        if (baselineAvgRange > 0) {
            volatilityExpansionRatio = recentAvgRange / baselineAvgRange;
            if (volatilityExpansionRatio >= config.volatilityExpansionThreshold) {
                reasons.push(`Volatility expanding ${volatilityExpansionRatio.toFixed(2)}x baseline range`);
            }
        }
    }

    const isInteresting = reasons.length >= config.minReasonsRequired;
    if (!isInteresting && reasons.length === 0) {
        reasons.push("No price/volume signals fired");
    }

    return { isInteresting, reasons, relativeVolume, priceChangePercent, volatilityExpansionRatio };
}