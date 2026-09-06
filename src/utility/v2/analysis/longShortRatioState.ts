import type {
    CandleInfo,
    SymbolInfo,
    LongShortRatioEntry,
    LongShortState,
    LS_STATE,
    MARKET_INTERVAL,
} from "@/core/interfacesv2";

const CONFIG = {
    LOOKBACK: 8,

    BALANCED_MIN: 0.9,
    BALANCED_MAX: 1.1,

    FLAT_THRESHOLD_PERCENT: 1.0,

    STRENGTH_MAX_CHANGE_PERCENT: 10.0,
};

function getLongShortHistory(
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

function getLatestLongShort(
    history: LongShortRatioEntry[],
    timestamp: number
): LongShortRatioEntry | null {

    let result: LongShortRatioEntry | null = null;

    for (const entry of history) {

        if (entry.timestamp > timestamp) {
            break;
        }

        result = entry;
    }

    return result;
}

function getPreviousLongShort(
    history: LongShortRatioEntry[],
    timestamp: number,
    lookback: number
): LongShortRatioEntry | null {

    const eligible = history.filter(
        entry => entry.timestamp <= timestamp
    );

    if (eligible.length <= lookback) {
        return eligible.length > 1
            ? eligible[0]
            : null;
    }

    return eligible[eligible.length - 1 - lookback];
}

export function getLongShortRatioState(
    symbol: SymbolInfo,
    movingCandles: CandleInfo[],
    interval: MARKET_INTERVAL
): LongShortState {

    if (!movingCandles.length) {
        return {
            ratio: 0,
            longAccount: 0,
            shortAccount: 0,
            ratioChange: 0,
            ratioChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: 0,
            reasons: ["No candle data available"],
        };
    }

    const currentCandle =
        movingCandles[movingCandles.length - 1];

    const history = getLongShortHistory(
        symbol,
        interval
    );

    if (!history.length) {
        return {
            ratio: 0,
            longAccount: 0,
            shortAccount: 0,
            ratioChange: 0,
            ratioChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                "No long/short ratio history available",
            ],
        };
    }

    const current = getLatestLongShort(
        history,
        currentCandle.openTime
    );

    if (!current) {
        return {
            ratio: 0,
            longAccount: 0,
            shortAccount: 0,
            ratioChange: 0,
            ratioChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: currentCandle.openTime,
            reasons: [
                `No long/short data available at ${currentCandle.openTime}`,
            ],
        };
    }

    const previous = getPreviousLongShort(
        history,
        current.timestamp,
        CONFIG.LOOKBACK
    );

    if (!previous) {
        return {
            ratio: current.longShortRatio,
            longAccount: current.longAccount,
            shortAccount: current.shortAccount,
            ratioChange: 0,
            ratioChangePercent: 0,
            direction: "NEUTRAL",
            state: "NEUTRAL",
            strength: 0,
            timestamp: current.timestamp,
            reasons: [
                "Insufficient long/short ratio history",
            ],
        };
    }

    const ratio = current.longShortRatio;
    const previousRatio = previous.longShortRatio;

    const ratioChange = ratio - previousRatio;

    const ratioChangePercent =
        previousRatio !== 0
            ? (ratioChange / previousRatio) * 100
            : 0;

    const absChangePercent =
        Math.abs(ratioChangePercent);

    let state: LS_STATE;
    let direction:
        | "BULLISH"
        | "BEARISH"
        | "NEUTRAL"
        | "RANGE";

    if (
        ratio >= CONFIG.BALANCED_MIN &&
        ratio <= CONFIG.BALANCED_MAX
    ) {

        state = "BALANCED";
        direction = "NEUTRAL";

    }
    else if (ratio > CONFIG.BALANCED_MAX) {

        state =
            ratioChangePercent >=
            CONFIG.FLAT_THRESHOLD_PERCENT
                ? "LONG_INCREASING"
                : "LONG_DOMINANT";

        direction = "NEUTRAL";

    }
    else {

        state =
            ratioChangePercent <=
            -CONFIG.FLAT_THRESHOLD_PERCENT
                ? "SHORT_INCREASING"
                : "SHORT_DOMINANT";

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

    if (state === "LONG_INCREASING") {

        reasons.push(
            `Long/short ratio increasing ${ratioChangePercent.toFixed(2)}%`
        );

    }
    else if (state === "SHORT_INCREASING") {

        reasons.push(
            `Long/short ratio decreasing ${Math.abs(ratioChangePercent).toFixed(2)}%`
        );

    }
    else if (state === "LONG_DOMINANT") {

        reasons.push(
            `Long accounts dominant with ratio ${ratio.toFixed(3)}`
        );

    }
    else if (state === "SHORT_DOMINANT") {

        reasons.push(
            `Short accounts dominant with ratio ${ratio.toFixed(3)}`
        );

    }
    else {

        reasons.push(
            `Long/short positioning balanced at ${ratio.toFixed(3)}`
        );
    }

    return {
        ratio,
        longAccount: current.longAccount,
        shortAccount: current.shortAccount,
        ratioChange,
        ratioChangePercent,
        direction,
        state,
        strength,
        timestamp: current.timestamp,
        reasons,
    };
}