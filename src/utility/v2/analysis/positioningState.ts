import type {
    CandleInfo,
    PositioningState,
    POSITIONING_BEHAVIOR,
    TREND_DIRECTION,
    VOLUME_CONFIRMATION,
} from "@/core/interfacesv2";

/**
 * Config for the price/volume/account-share side of positioning
 * classification.
 *
 * These are ARBITRARY, uncalibrated constants — same status as the
 * pre-existing OI strength constants in openInterestState.ts. They have
 * not been validated against historical data. Treat them as a starting
 * point for research, not a conclusion.
 */
const CONFIG = {
    // Price move below this many ATRs (over the lookback window) is
    // considered flat, not a directional move.
    PRICE_FLAT_ATR_MULTIPLE: 0.5,

    // A price move of this many ATRs (or more) maps to 100 magnitude.
    STRENGTH_MAX_PRICE_ATR: 3.0,

    // Average-volume change below this percent (window vs prior window)
    // is considered flat.
    VOLUME_FLAT_THRESHOLD_PERCENT: 5.0,
};

export interface PositioningInput {
    /**
     * Causal candle history up to and including the current candle.
     * Must not contain any candle that closes after `timestamp`.
     */
    candles: CandleInfo[]

    /** Number of candles back used for the price/OI/account comparison window. */
    lookback: number

    /** OI percent change already computed by the caller (single source of truth). */
    oiChangePercent: number

    /** The same flat threshold already used to classify the OI's own FLAT state. */
    oiFlatThresholdPercent: number

    /** OI magnitude (0-100) already computed by the caller. */
    oiMagnitude: number

    /**
     * Percent change in long-account share (longAccount / (longAccount +
     * shortAccount)) over the lookback window, already computed by the
     * caller from LongShortRatioEntry history. `null` when there isn't
     * enough long/short ratio history to compute it — kept distinct from
     * `0`, which would legitimately mean "no change".
     */
    accountShareChangePercent: number | null

    /** Flat threshold for account share change, in percentage points. */
    accountShareFlatThresholdPercent: number

    timestamp: number
}

interface PriceComponent {
    direction: TREND_DIRECTION
    change: number
    changePercent: number
    changeAtr: number
    magnitude: number
}

interface VolumeComponent {
    direction: TREND_DIRECTION
    changePercent: number
}

function average(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Classifies a percent-change value into RISING/FALLING/FLAT against a
 * flat threshold, or INSUFFICIENT_DATA when the value itself is unknown.
 * Shared by OI direction and account-share direction — both are "percent
 * change vs a flat threshold" classifications, just over different data.
 */
function classifyTrendFromPercent(
    changePercent: number | null,
    flatThresholdPercent: number
): TREND_DIRECTION {

    if (changePercent === null) {
        return "INSUFFICIENT_DATA";
    }

    if (Math.abs(changePercent) <= flatThresholdPercent) {
        return "FLAT";
    }

    return changePercent > 0 ? "RISING" : "FALLING";
}

function computePriceComponent(
    candles: CandleInfo[],
    lookback: number
): PriceComponent {

    const currentIndex = candles.length - 1;
    const previousIndex = currentIndex - lookback;

    if (previousIndex < 0) {
        return {
            direction: "INSUFFICIENT_DATA",
            change: 0,
            changePercent: 0,
            changeAtr: 0,
            magnitude: 0,
        };
    }

    const current = candles[currentIndex];
    const previous = candles[previousIndex];

    const change = current.close - previous.close;

    const changePercent =
        previous.close !== 0
            ? (change / previous.close) * 100
            : 0;

    const changeAtr =
        current.atr !== 0
            ? change / current.atr
            : 0;

    const direction: TREND_DIRECTION =
        Math.abs(changeAtr) <= CONFIG.PRICE_FLAT_ATR_MULTIPLE
            ? "FLAT"
            : changeAtr > 0 ? "RISING" : "FALLING";

    const magnitude = Math.min(
        100,
        (Math.abs(changeAtr) / CONFIG.STRENGTH_MAX_PRICE_ATR) * 100
    );

    return { direction, change, changePercent, changeAtr, magnitude };
}

function computeVolumeComponent(
    candles: CandleInfo[],
    lookback: number
): VolumeComponent {

    // Need two full, non-overlapping windows to compare flow vs flow.
    if (candles.length < lookback * 2) {
        return {
            direction: "INSUFFICIENT_DATA",
            changePercent: 0,
        };
    }

    const currentWindow = candles.slice(candles.length - lookback);

    const priorWindow = candles.slice(
        candles.length - lookback * 2,
        candles.length - lookback
    );

    const currentAvg = average(currentWindow.map(c => c.volume));
    const priorAvg = average(priorWindow.map(c => c.volume));

    const changePercent =
        priorAvg !== 0
            ? ((currentAvg - priorAvg) / priorAvg) * 100
            : 0;

    const direction: TREND_DIRECTION =
        Math.abs(changePercent) <= CONFIG.VOLUME_FLAT_THRESHOLD_PERCENT
            ? "FLAT"
            : changePercent > 0 ? "RISING" : "FALLING";

    return { direction, changePercent };
}

function classifyBehavior(
    priceDirection: TREND_DIRECTION,
    oiDirection: TREND_DIRECTION
): POSITIONING_BEHAVIOR {

    if (
        priceDirection === "INSUFFICIENT_DATA" ||
        oiDirection === "INSUFFICIENT_DATA"
    ) {
        return "INSUFFICIENT_DATA";
    }

    if (priceDirection === "FLAT" || oiDirection === "FLAT") {
        return "NEUTRAL";
    }

    if (priceDirection === "RISING" && oiDirection === "RISING") {
        return "LONG_BUILDUP";
    }

    if (priceDirection === "RISING" && oiDirection === "FALLING") {
        return "SHORT_COVERING";
    }

    if (priceDirection === "FALLING" && oiDirection === "RISING") {
        return "SHORT_BUILDUP";
    }

    // FALLING + FALLING
    return "LONG_UNWINDING";
}

/**
 * Generic "does trend A agree with trend B" classifier. Used both for
 * volume-vs-OI confirmation and account-share-vs-price agreement — same
 * comparison, different inputs.
 */
function classifyTrendAgreement(
    a: TREND_DIRECTION,
    b: TREND_DIRECTION
): VOLUME_CONFIRMATION {

    if (a === "INSUFFICIENT_DATA" || b === "INSUFFICIENT_DATA") {
        return "INSUFFICIENT_DATA";
    }

    if (a === "FLAT" || b === "FLAT") {
        return "NEUTRAL";
    }

    return a === b ? "CONFIRMS" : "DIVERGES";
}

export function emptyPositioningState(
    timestamp: number,
    lookback: number,
    reasons: string[]
): PositioningState {

    return {
        behavior: "INSUFFICIENT_DATA",
        strength: 0,

        priceDirection: "INSUFFICIENT_DATA",
        priceChange: 0,
        priceChangePercent: 0,
        priceChangeAtr: 0,
        priceMagnitude: 0,

        oiDirection: "INSUFFICIENT_DATA",
        oiChangePercent: 0,
        oiMagnitude: 0,

        volumeDirection: "INSUFFICIENT_DATA",
        volumeChangePercent: 0,
        volumeConfirmation: "INSUFFICIENT_DATA",

        accountShareDirection: "INSUFFICIENT_DATA",
        accountShareChangePercent: 0,
        accountAgreement: "INSUFFICIENT_DATA",

        lookback,
        timestamp,

        reasons,
    };
}

/**
 * Classifies price/OI positioning behavior into the four textbook
 * quadrants (long buildup, short covering, short buildup, long
 * unwinding), reports the magnitude of each contributing leg, and
 * separately reports two independent confirmation channels:
 *   - volume vs OI (does volume corroborate the OI move)
 *   - long-account share vs price (does crowd positioning agree with
 *     the direction price is moving)
 *
 * Neither confirmation channel feeds into `strength` or `behavior` — they
 * are reported as-is so they can be inspected and validated on their own
 * before being trusted or acted on.
 *
 * Pure function: no I/O, no hidden state. All inputs must already be
 * causal (no candle/entry may reflect data after `timestamp`).
 */
export function computePositioningState(
    input: PositioningInput
): PositioningState {

    const {
        candles,
        lookback,
        oiChangePercent,
        oiFlatThresholdPercent,
        oiMagnitude,
        accountShareChangePercent,
        accountShareFlatThresholdPercent,
        timestamp,
    } = input;

    if (!candles.length) {
        return emptyPositioningState(
            timestamp,
            lookback,
            ["No candle data available"]
        );
    }

    const price = computePriceComponent(candles, lookback);
    const volume = computeVolumeComponent(candles, lookback);

    const oiDirection = classifyTrendFromPercent(
        oiChangePercent,
        oiFlatThresholdPercent
    );

    const accountShareDirection = classifyTrendFromPercent(
        accountShareChangePercent,
        accountShareFlatThresholdPercent
    );

    const behavior = classifyBehavior(price.direction, oiDirection);

    const volumeConfirmation = classifyTrendAgreement(
        volume.direction,
        oiDirection
    );

    const accountAgreement = classifyTrendAgreement(
        accountShareDirection,
        price.direction
    );

    const isQuadrant =
        behavior === "LONG_BUILDUP" ||
        behavior === "SHORT_COVERING" ||
        behavior === "SHORT_BUILDUP" ||
        behavior === "LONG_UNWINDING";

    const strength = isQuadrant
        ? Math.min(price.magnitude, oiMagnitude)
        : 0;

    const reasons: string[] = [];

    if (price.direction === "INSUFFICIENT_DATA") {
        reasons.push(
            `Not enough candle history to measure price change over ${lookback} candles`
        );
    } else {
        reasons.push(
            `Price ${price.direction.toLowerCase()} ${price.changePercent.toFixed(2)}% ` +
            `(${price.changeAtr.toFixed(2)}x ATR) over ${lookback} candles`
        );
    }

    if (oiDirection === "INSUFFICIENT_DATA") {
        reasons.push("Not enough open interest history to classify positioning");
    } else {
        reasons.push(
            `Open interest ${oiDirection.toLowerCase()} ${oiChangePercent.toFixed(2)}% over the same window`
        );
    }

    if (volume.direction === "INSUFFICIENT_DATA") {
        reasons.push(
            `Not enough candle history to measure volume change over ${lookback * 2} candles`
        );
    } else {
        reasons.push(
            `Average volume ${volume.direction.toLowerCase()} ${volume.changePercent.toFixed(2)}% vs prior window`
        );
    }

    if (accountShareDirection === "INSUFFICIENT_DATA") {
        reasons.push("Not enough long/short account ratio history to check crowd agreement");
    } else {
        reasons.push(
            `Long-account share ${accountShareDirection.toLowerCase()} ${(accountShareChangePercent as number).toFixed(2)}pp over the same window`
        );
    }

    switch (behavior) {
        case "LONG_BUILDUP":
            reasons.push(
                "Price and open interest rising together — consistent with new long positions being added"
            );
            break;
        case "SHORT_COVERING":
            reasons.push(
                "Price rising while open interest falls — consistent with short positions being closed"
            );
            break;
        case "SHORT_BUILDUP":
            reasons.push(
                "Price falling while open interest rises — consistent with new short positions being added"
            );
            break;
        case "LONG_UNWINDING":
            reasons.push(
                "Price and open interest falling together — consistent with long positions being closed"
            );
            break;
        case "NEUTRAL":
            reasons.push(
                "Price or open interest is flat — positioning behavior not classified"
            );
            break;
        case "INSUFFICIENT_DATA":
            break;
    }

    if (volumeConfirmation === "CONFIRMS") {
        reasons.push("Volume trend confirms the open interest move");
    } else if (volumeConfirmation === "DIVERGES") {
        reasons.push(
            "Volume trend diverges from the open interest move — treat this positioning read with caution"
        );
    }

    if (accountAgreement === "CONFIRMS") {
        reasons.push("Long-account share is trending with price — crowd agrees with the move");
    } else if (accountAgreement === "DIVERGES") {
        reasons.push(
            "Long-account share is trending against price — crowd positioning disagrees with the move"
        );
    }

    return {
        behavior,
        strength,

        priceDirection: price.direction,
        priceChange: price.change,
        priceChangePercent: price.changePercent,
        priceChangeAtr: price.changeAtr,
        priceMagnitude: price.magnitude,

        oiDirection,
        oiChangePercent,
        oiMagnitude,

        volumeDirection: volume.direction,
        volumeChangePercent: volume.changePercent,
        volumeConfirmation,

        accountShareDirection,
        accountShareChangePercent: accountShareChangePercent ?? 0,
        accountAgreement,

        lookback,
        timestamp,

        reasons,
    };
}