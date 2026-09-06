import type {
    CandleInfo,
    SymbolInfo,
    OpenInterestHistEntry,
    OpenInterestState,
    OI_STATE,
    MARKET_INTERVAL,
} from "@/core/interfacesv2";

const CONFIG = {
    LOOKBACK: 8,

    FLAT_THRESHOLD_PERCENT: 0.5,

    STRONG_CHANGE_PERCENT: 2.0,

    STRENGTH_MAX_CHANGE_PERCENT: 5.0,
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

function getLatestOpenInterest(
    history: OpenInterestHistEntry[],
    timestamp: number
): OpenInterestHistEntry | null {

    let result: OpenInterestHistEntry | null = null;

    for (const entry of history) {

        if (entry.timestamp > timestamp) {
            break;
        }

        result = entry;
    }

    return result;
}

function getPreviousOpenInterest(
    history: OpenInterestHistEntry[],
    timestamp: number,
    lookback: number
): OpenInterestHistEntry | null {

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
        };
    }

    const current = getLatestOpenInterest(
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
        };
    }

    const previous = getPreviousOpenInterest(
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

    return {
        value,
        valueChange,
        valueChangePercent,
        direction,
        state,
        strength,
        timestamp: current.timestamp,
        reasons,
    };
}