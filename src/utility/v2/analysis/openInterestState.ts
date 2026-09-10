import type {
    CandleInfo,
    SymbolInfo,
    OpenInterestHistEntry,
    LongShortRatioEntry,
    OpenInterestState,
    OI_STATE,
    MARKET_INTERVAL,
} from "@/core/interfacesv2";

import { getLatestEntry, getPreviousEntry } from "./casualLookup";

import {
    computePositioningState,
    emptyPositioningState,
} from "./positioningState";

const CONFIG = {
    LOOKBACK: 8,

    FLAT_THRESHOLD_PERCENT: 0.5,

    STRONG_CHANGE_PERCENT: 2.0,

    STRENGTH_MAX_CHANGE_PERCENT: 5.0,

    // Flat threshold for long-account-share change, in percentage points
    // (share is expressed 0-100). ARBITRARY, uncalibrated — same status as
    // the constants above. Not validated against data yet.
    ACCOUNT_SHARE_FLAT_THRESHOLD_PERCENT: 2.0,
};

function getOpenInterestHistory(
    symbol: SymbolInfo,
    interval: MARKET_INTERVAL
): OpenInterestHistEntry[] {

    switch (interval) {
        case "15m":
            return symbol.oi_15m;

        case "1h":
            return symbol.oi_1h;

        case "4h":
            return symbol.oi_4h;

        case "1d":
            return symbol.oi_1d;
    }
}

function getLongShortRatioHistory(
    symbol: SymbolInfo,
    interval: MARKET_INTERVAL
): LongShortRatioEntry[] {

    switch (interval) {
        case "15m":
            return symbol.ls_15m;

        case "1h":
            return symbol.ls_1h;

        case "4h":
            return symbol.ls_4h;

        case "1d":
            return symbol.ls_1d;
    }
}

/**
 * Long-account share as a percentage: longAccount / (longAccount +
 * shortAccount) * 100. Kept separate from `longShortRatio` on the entry
 * (which is longAccount/shortAccount, a different scale) since a share
 * is what's directly comparable across time as a "trend".
 */
function longAccountSharePercent(entry: LongShortRatioEntry): number | null {
    const total = entry.longAccount + entry.shortAccount;
    if (total === 0) return null;
    return (entry.longAccount / total) * 100;
}

/**
 * Percent-point change in long-account share between the current candle's
 * timestamp and `lookback` LS entries before it. Returns null when there
 * isn't enough causal LS history to compute this — distinct from 0, which
 * would legitimately mean "share unchanged".
 */
function computeAccountShareChangePercent(
    symbol: SymbolInfo,
    interval: MARKET_INTERVAL,
    asOfTimestamp: number,
    lookback: number
): number | null {

    const history = getLongShortRatioHistory(symbol, interval);
    if (!history.length) return null;

    const current = getLatestEntry(history, asOfTimestamp);
    if (!current) return null;

    const previous = getPreviousEntry(history, current.timestamp, lookback);
    if (!previous) return null;

    const currentShare = longAccountSharePercent(current);
    const previousShare = longAccountSharePercent(previous);

    if (currentShare === null || previousShare === null) return null;

    // Difference in percentage points (not a percent-of-percent change) —
    // shares are already 0-100, so a plain difference is the natural unit.
    return currentShare - previousShare;
}

export function getOpenInterestState(
    symbol: SymbolInfo,
    movingCandles: CandleInfo[],
    interval: MARKET_INTERVAL
): OpenInterestState {

    if (!movingCandles.length) {
        return {
            value: 0,
            valueChange: 0,
            valueChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: 0,
            reasons: ["No candle data available"],
            positioningState: emptyPositioningState(
                0,
                CONFIG.LOOKBACK,
                ["No candle data available"]
            ),
        };
    }

    const currentCandle =
        movingCandles[movingCandles.length - 1];

    const history = getOpenInterestHistory(symbol, interval);

    if (!history.length) {
        return {
            value: 0,
            valueChange: 0,
            valueChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: ["No open interest history available"],
            positioningState: emptyPositioningState(
                currentCandle.openTime,
                CONFIG.LOOKBACK,
                ["No open interest history available"]
            ),
        };
    }

    const current = getLatestEntry(
        history,
        currentCandle.openTime
    );

    if (!current) {
        return {
            value: 0,
            valueChange: 0,
            valueChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                `No open interest data available at ${currentCandle.openTime}`,
            ],
            positioningState: emptyPositioningState(
                currentCandle.openTime,
                CONFIG.LOOKBACK,
                [`No open interest data available at ${currentCandle.openTime}`]
            ),
        };
    }

    const previous = getPreviousEntry(
        history,
        current.timestamp,
        CONFIG.LOOKBACK
    );

    if (!previous) {
        return {
            value: current.sumOpenInterestValue,
            valueChange: 0,
            valueChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: current.timestamp,
            reasons: [
                "Insufficient open interest history",
            ],
            positioningState: emptyPositioningState(
                current.timestamp,
                CONFIG.LOOKBACK,
                ["Insufficient open interest history"]
            ),
        };
    }

    const value = current.sumOpenInterestValue;
    const previousValue = previous.sumOpenInterestValue;

    const valueChange = value - previousValue;

    const valueChangePercent =
        previousValue !== 0
            ? (valueChange / previousValue) * 100
            : 0;

    const absChangePercent =
        Math.abs(valueChangePercent);

    let state: OI_STATE;
    let direction:
        | "BULLISH"
        | "BEARISH"
        | "NEUTRAL"
        | "RANGE";

    if (
        absChangePercent <=
        CONFIG.FLAT_THRESHOLD_PERCENT
    ) {
        state = "FLAT";
        direction = "NEUTRAL";
    }
    else if (valueChange > 0) {

        state =
            absChangePercent >=
            CONFIG.STRONG_CHANGE_PERCENT
                ? "EXPANDING"
                : "RISING";

        direction = "NEUTRAL";
    }
    else {

        state =
            absChangePercent >=
            CONFIG.STRONG_CHANGE_PERCENT
                ? "CONTRACTING"
                : "FALLING";

        direction = "NEUTRAL";
    }

    const strength = Math.min(
        100,
        (
            absChangePercent /
            CONFIG.STRENGTH_MAX_CHANGE_PERCENT
        ) * 100
    );

    const reasons: string[] = [];

    if (state === "EXPANDING") {
        reasons.push(
            `Open interest expanding ${valueChangePercent.toFixed(2)}%`
        );
    }
    else if (state === "CONTRACTING") {
        reasons.push(
            `Open interest contracting ${Math.abs(valueChangePercent).toFixed(2)}%`
        );
    }
    else if (state === "RISING") {
        reasons.push(
            `Open interest rising ${valueChangePercent.toFixed(2)}%`
        );
    }
    else if (state === "FALLING") {
        reasons.push(
            `Open interest falling ${Math.abs(valueChangePercent).toFixed(2)}%`
        );
    }
    else {
        reasons.push(
            "Open interest relatively flat"
        );
    }

    // Long/short account-share change, computed the same causal way as OI
    // (as-of currentCandle.openTime, looking `CONFIG.LOOKBACK` LS entries
    // back). Independent data source from OI — see computeAccountShareChangePercent.
    const accountShareChangePercent = computeAccountShareChangePercent(
        symbol,
        interval,
        currentCandle.openTime,
        CONFIG.LOOKBACK
    );

    // Positioning classification reuses the OI change data already
    // computed above (single source of truth) and adds the price/volume/
    // account-share side of the analysis. See positioningState.ts.
    const positioningState = computePositioningState({
        candles: movingCandles,
        lookback: CONFIG.LOOKBACK,
        oiChangePercent: valueChangePercent,
        oiFlatThresholdPercent: CONFIG.FLAT_THRESHOLD_PERCENT,
        oiMagnitude: strength,
        accountShareChangePercent,
        accountShareFlatThresholdPercent: CONFIG.ACCOUNT_SHARE_FLAT_THRESHOLD_PERCENT,
        timestamp: current.timestamp,
    });

    return {
        value,
        valueChange,
        valueChangePercent,
        direction,
        state,
        strength,
        timestamp: current.timestamp,
        reasons,
        positioningState,
    };
}