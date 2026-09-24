import type { FuturesSymbol } from "@/core/interfaces";
import { KlineUtility } from "@/utility/klineUtility";

/**
 * Decides which futures symbols currently look worth scanning in detail —
 * a cheap pre-filter using raw klines/OI/long-short data directly (NOT the
 * full runMarketAnalysis pipeline), so it stays fast across the whole
 * symbol list before the heavier per-symbol simulation ever runs.
 *
 * "Interesting" here means: a real trend (not just noise), volume/open
 * interest showing people are actually positioning around it right now,
 * and a genuine reason to expect two-sided attention rather than a
 * dead, directionless tape. The specific checks (relative volume, price
 * momentum, OI change, OI+volume confirmation, long/short crowding,
 * volatility expansion) are the standard toolkit used by momentum/gainer
 * scanners and crypto derivatives analysis for exactly this question —
 * see the "why" comment on each threshold below.
 */

export interface SymbolInterestResult {
    symbol: string;
    isInteresting: boolean;
    reasons: string[];
    // Raw metrics kept alongside the verdict for debugging/tuning the
    // thresholds below without having to re-derive them from scratch.
    relativeVolume: number | null;
    priceChangePercent: number | null;
    oiChangePercent: number | null;
    longShortRatio: number | null;
    volatilityExpansionRatio: number | null;
}

export interface SymbolInterestConfig {
    /** Candles fetched for the scan window. 15m x 100 ≈ 25h — enough for a 24h lookback plus a short recent window, without pulling the full multi-hundred-candle history checkSymbolInterest itself doesn't need. */
    candleLimit: number;
    /** How many of the most recent candles count as "right now" for the volume/range comparisons. */
    recentWindow: number;
    /** How far back "24h momentum" and OI-change look. */
    lookbackWindow: number;
    /**
     * RVOL >= this counts as unusually high activity. 1.5-2x+ is the
     * standard cited threshold across momentum-scanner practice (e.g.
     * Scanz/Cabot Wealth guidance on relative volume) — this project
     * uses 1.6 as a middle-of-the-road cut, not either extreme.
     */
    relativeVolumeThreshold: number;
    /**
     * A 24h move at or beyond this magnitude (either direction) is a
     * real, attention-grabbing gainer/loser move, not noise. Crypto
     * moves faster than equities, so this sits a bit above the 3-5%
     * range typically cited for stock gap scanners.
     */
    priceChangeThreshold: number;
    /**
     * OI change at or beyond this magnitude means real positions are
     * being opened or unwound, not just volume rotating between
     * existing holders — the distinction multiple derivatives-analysis
     * sources draw between "genuine signal" and "noise."
     */
    oiChangeThreshold: number;
    /**
     * Long/short ratio this far from neutral (1.0) means positioning is
     * crowded on one side — a real, if double-edged, attention signal:
     * crowded positioning is exactly the setup that produces squeezes.
     * 1.0 +/- this value is the band treated as "not extreme."
     */
    longShortRatioDeviation: number;
    /** Current short-window range vs its own longer baseline, at or beyond this ratio, means the symbol's own volatility is actively expanding. */
    volatilityExpansionThreshold: number;
    /** How many of the checks above must fire for the symbol to count as interesting. Requiring more than one avoids calling a symbol interesting off a single noisy metric — convergence across independent signals is the whole point. */
    minReasonsRequired: number;
}

export const DEFAULT_SYMBOL_INTEREST_CONFIG: SymbolInterestConfig = {
    candleLimit: 100,
    recentWindow: 8,
    lookbackWindow: 96,
    relativeVolumeThreshold: 1.6,
    priceChangeThreshold: 0.04,
    oiChangeThreshold: 0.05,
    longShortRatioDeviation: 0.8,
    volatilityExpansionThreshold: 1.5,
    minReasonsRequired: 2,
};

export const INTERESTING_SYMBOLS_STORAGE_KEY = "INTERESTING_SYMBOLS";

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Runs every check against one symbol's raw, recently-fetched data.
 * Pure function of its inputs so it can be unit-tested without hitting
 * the network — checkSymbolInterest below is the thin fetching wrapper.
 */
export function evaluateSymbolInterest(
    symbol: string,
    candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number }[],
    oiHistory: { sumOpenInterest: number; timestamp: number }[],
    lsHistory: { longShortRatio: number; timestamp: number }[],
    config: SymbolInterestConfig = DEFAULT_SYMBOL_INTEREST_CONFIG
): SymbolInterestResult {
    const reasons: string[] = [];
    const n = candles.length;

    let relativeVolume: number | null = null;
    let priceChangePercent: number | null = null;
    let oiChangePercent: number | null = null;
    let longShortRatio: number | null = null;
    let volatilityExpansionRatio: number | null = null;

    // 1. Relative volume: recent window vs the longer baseline before it.
    if (n >= config.recentWindow + config.lookbackWindow) {
        const recent = candles.slice(-config.recentWindow);
        const baseline = candles.slice(-(config.recentWindow + config.lookbackWindow), -config.recentWindow);
        const recentAvgVol = average(recent.map(c => c.volume));
        const baselineAvgVol = average(baseline.map(c => c.volume));
        if (baselineAvgVol > 0) {
            relativeVolume = recentAvgVol / baselineAvgVol;
            if (relativeVolume >= config.relativeVolumeThreshold) {
                reasons.push(`relative volume ${relativeVolume.toFixed(2)}x`);
            }
        }
    }

    // 2. Price momentum over the lookback window.
    if (n > config.lookbackWindow) {
        const priorClose = candles[n - 1 - config.lookbackWindow].close;
        const currentClose = candles[n - 1].close;
        if (priorClose > 0) {
            priceChangePercent = (currentClose - priorClose) / priorClose;
            if (Math.abs(priceChangePercent) >= config.priceChangeThreshold) {
                const direction = priceChangePercent > 0 ? "up" : "down";
                reasons.push(`price ${direction} ${(priceChangePercent * 100).toFixed(1)}% over lookback`);
            }
        }
    }

    // 3. Open interest change over the same lookback, PLUS the
    // volume+OI confirmation check: a price move backed by rising OI is
    // new positioning, not just existing holders trading among
    // themselves — the single strongest "genuine, not noise" signal
    // found across derivatives-market sources.
    if (oiHistory.length > config.lookbackWindow) {
        const m = oiHistory.length;
        const priorOi = oiHistory[m - 1 - config.lookbackWindow].sumOpenInterest;
        const currentOi = oiHistory[m - 1].sumOpenInterest;
        if (priorOi > 0) {
            oiChangePercent = (currentOi - priorOi) / priorOi;
            if (Math.abs(oiChangePercent) >= config.oiChangeThreshold) {
                reasons.push(`open interest changed ${(oiChangePercent * 100).toFixed(1)}%`);
            }
            if (
                priceChangePercent != null &&
                Math.abs(priceChangePercent) >= config.priceChangeThreshold / 2 &&
                Math.abs(oiChangePercent) >= config.oiChangeThreshold / 2 &&
                Math.sign(priceChangePercent) === Math.sign(oiChangePercent)
            ) {
                reasons.push("price and open interest confirming the same direction");
            }
        }
    }

    // 4. Long/short ratio extremity — crowded positioning on one side.
    if (lsHistory.length > 0) {
        longShortRatio = lsHistory[lsHistory.length - 1].longShortRatio;
        if (Math.abs(longShortRatio - 1) >= config.longShortRatioDeviation) {
            const side = longShortRatio > 1 ? "long" : "short";
            reasons.push(`long/short ratio ${longShortRatio.toFixed(2)} (crowded ${side})`);
        }
    }

    // 5. Volatility expansion: recent candle ranges vs their own baseline.
    if (n >= config.recentWindow + config.lookbackWindow) {
        const recent = candles.slice(-config.recentWindow);
        const baseline = candles.slice(-(config.recentWindow + config.lookbackWindow), -config.recentWindow);
        const recentAvgRange = average(recent.map(c => c.high - c.low));
        const baselineAvgRange = average(baseline.map(c => c.high - c.low));
        if (baselineAvgRange > 0) {
            volatilityExpansionRatio = recentAvgRange / baselineAvgRange;
            if (volatilityExpansionRatio >= config.volatilityExpansionThreshold) {
                reasons.push(`volatility expanding ${volatilityExpansionRatio.toFixed(2)}x baseline`);
            }
        }
    }

    return {
        symbol,
        isInteresting: reasons.length >= config.minReasonsRequired,
        reasons,
        relativeVolume,
        priceChangePercent,
        oiChangePercent,
        longShortRatio,
        volatilityExpansionRatio,
    };
}

/** Fetches one symbol's raw recent data and evaluates it. */
export async function checkSymbolInterest(
    symbol: string,
    config: SymbolInterestConfig = DEFAULT_SYMBOL_INTEREST_CONFIG
): Promise<SymbolInterestResult> {
    const [candles, oiHistory, lsHistory] = await Promise.all([
        KlineUtility.getRecentKlines(symbol, "15m", config.candleLimit),
        KlineUtility.getOIByRange(symbol, "15m", config.candleLimit),
        KlineUtility.getLSRatioByRange(symbol, "15m", config.candleLimit),
    ]);
    return evaluateSymbolInterest(symbol, candles, oiHistory, lsHistory, config);
}

/**
 * Scans every given futures symbol and returns just the interesting
 * ones' symbol strings — this is the array the caller stores in
 * localStorage under INTERESTING_SYMBOLS_STORAGE_KEY. A failed lookup
 * for one symbol (missing data, request error) is logged and skipped
 * rather than aborting the whole scan.
 */
export async function scanForInterestingSymbols(
    symbols: FuturesSymbol[],
    config: SymbolInterestConfig = DEFAULT_SYMBOL_INTEREST_CONFIG,
    onProgress?: (current: number, total: number, symbol: string) => void
): Promise<string[]> {
    const interesting: string[] = [];
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i].symbol;
        try {
            const result = await checkSymbolInterest(symbol, config);
            if (result.isInteresting) interesting.push(result.symbol);
        } catch (error) {
            console.error("checkSymbolInterest failed for", symbol, error);
        }
        onProgress?.(i + 1, symbols.length, symbol);
    }
    return interesting;
}

/** Reads the stored interesting-symbols list. Empty array if none is stored, matching "blank means run everything." */
export function getStoredInterestingSymbols(): string[] {
    const raw = localStorage.getItem(INTERESTING_SYMBOLS_STORAGE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function storeInterestingSymbols(symbols: string[]): void {
    localStorage.setItem(INTERESTING_SYMBOLS_STORAGE_KEY, JSON.stringify(symbols));
}