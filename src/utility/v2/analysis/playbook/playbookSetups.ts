import type { CandleInfo } from "@/core/interfacesv2";
import {
    type LimitOrderDecision, type Regime, has, hasPattern, unitU, regime, trendSnapshot, structure, lastSwing,
    consolidationBox, stretch20, donchian96, volRank, unitPctRank, hourPHT, makeOrder, validOrder,
} from "./playbookHelpers";

// #####################################################################
// SCALPING PLAYBOOK - generated from playbook/results (see REPORT.md).
// Each setup: (candle, candles, gi) => limit order | null, reading only candles[gi-499..gi].
// U = mean true range of the last 32 candles. Orders follow section-5 mechanics:
// fill only when price trades THROUGH the limit by 1 tick; cancel if TP is reached first;
// expire after expiryCandles; max hold counted from the fill candle.
// Priority = array order in PLAYBOOK (first setup that returns an order wins).
// #####################################################################

interface Ctx { c: CandleInfo; C: CandleInfo[]; gi: number; close: number; U: number; reg: Regime }

/** LONG_BEAR_STRETCH_EXHAUSTION__unitPctGE06
 *  LONG STRETCH_EXHAUSTION in BEAR + unitPct>=0.6; limit close-1.6U, SL 2U, TP 2.5U, exp 3, hold 16 */
export function LONG_BEAR_STRETCH_EXHAUSTION__unitPctGE06({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((stretch20(C, gi) <= -3.0)
        && (c.candleStructure.consecutiveBearish >= 3.0)
        && (U / close * 100 >= 0.6))) return null;
    const o = makeOrder('LONG_BEAR_STRETCH_EXHAUSTION__unitPctGE06', 'LONG', close, U, 1.6, 2.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_CAPITULATION_VOLUME__sessionAsia_08_16PHT
 *  LONG CAPITULATION_VOLUME in BEAR + sessionAsia(08-16PHT); limit close-0.25U, SL 2U, TP 3.2U, exp 8, hold 16 */
export function LONG_BEAR_CAPITULATION_VOLUME__sessionAsia_08_16PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((volRank(C, gi, 480) >= 0.98)
        && (c.candleStructure.direction === 'BEARISH')
        && (c.candleStructure.rangeAtrRatio >= 1.5)
        && (c.candleStructure.closeLocation >= 0.35)
        && (hourPHT(c) >= 8 && hourPHT(c) < 16))) return null;
    const o = makeOrder('LONG_BEAR_CAPITULATION_VOLUME__sessionAsia_08_16PHT', 'LONG', close, U, 0.25, 2.0, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_VOLUME_SPIKE_REJECTION__volatHigh
 *  LONG VOLUME_SPIKE_REJECTION in BEAR + volatHigh; limit close-0.25U, SL 1.5U, TP 1.875U, exp 3, hold 16 */
export function LONG_BEAR_VOLUME_SPIKE_REJECTION__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.candleStructure.volumeSpike)
        && (c.candleStructure.lowerWickRatio >= 0.5)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BEAR_VOLUME_SPIKE_REJECTION__volatHigh', 'LONG', close, U, 0.25, 1.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_ZONE_SWEEP_RECLAIM__stretchedAgainst
 *  LONG ZONE_SWEEP_RECLAIM in BEAR + stretchedAgainst; limit close-1.6U, SL 2.5U, TP 4U, exp 3, hold 16 */
export function LONG_BEAR_ZONE_SWEEP_RECLAIM__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const pz = c.priceZone;
    if (!((pz !== null)
        && (c.low < pz.lower)
        && (c.close > pz.lower)
        && (c.candleStructure.lowerWickRatio >= 0.4)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_BEAR_ZONE_SWEEP_RECLAIM__stretchedAgainst', 'LONG', close, U, 1.6, 2.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_STRETCH_EXHAUSTION__sessionNight_00_08PHT
 *  LONG STRETCH_EXHAUSTION in RANGE + sessionNight(00-08PHT); limit close-0.8U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function LONG_RANGE_STRETCH_EXHAUSTION__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((stretch20(C, gi) <= -3.0)
        && (c.candleStructure.consecutiveBearish >= 3.0)
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('LONG_RANGE_STRETCH_EXHAUSTION__sessionNight_00_08PHT', 'LONG', close, U, 0.8, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_REJECTED_IMBALANCE__sessionNight_00_08PHT
 *  LONG REJECTED_IMBALANCE in BEAR + sessionNight(00-08PHT); limit close-1.6U, SL 2U, TP 3.2U, exp 3, hold 16 */
export function LONG_BEAR_REJECTED_IMBALANCE__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.state === 'REJECTED_DOWN')
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('LONG_BEAR_REJECTED_IMBALANCE__sessionNight_00_08PHT', 'LONG', close, U, 1.6, 2.0, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_STRETCH_EXHAUSTION
 *  LONG STRETCH_EXHAUSTION in BULL; limit close-1.6U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function LONG_BULL_STRETCH_EXHAUSTION({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((stretch20(C, gi) <= -3.0)
        && (c.candleStructure.consecutiveBearish >= 3.0))) return null;
    const o = makeOrder('LONG_BULL_STRETCH_EXHAUSTION', 'LONG', close, U, 1.6, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_REVERSAL_PATTERN_AT_ZONE__volatHigh
 *  LONG REVERSAL_PATTERN_AT_ZONE in BEAR + volatHigh; limit close-1.6U, SL 1.5U, TP 1.875U, exp 3, hold 16 */
export function LONG_BEAR_REVERSAL_PATTERN_AT_ZONE__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((hasPattern(c, 'HAMMER', 'BULLISH_ENGULFING', 'MORNING_STAR', 'PIERCING_LINE', 'TWEEZER_BOTTOM', 'DRAGONFLY_DOJI'))
        && (oz !== null && (oz.positionInZone <= 0.3 || oz.position === 'BELOW'))
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BEAR_REVERSAL_PATTERN_AT_ZONE__volatHigh', 'LONG', close, U, 1.6, 1.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_ZONE_SWEEP_RECLAIM__dayDropAgainst
 *  LONG ZONE_SWEEP_RECLAIM in RANGE + dayDropAgainst; limit close-1.6U, SL 2.5U, TP 5.5U, exp 3, hold 16 */
export function LONG_RANGE_ZONE_SWEEP_RECLAIM__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const pz = c.priceZone;
    if (!((pz !== null)
        && (c.low < pz.lower)
        && (c.close > pz.lower)
        && (c.candleStructure.lowerWickRatio >= 0.4)
        && (gi - 96 >= 0 && (close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('LONG_RANGE_ZONE_SWEEP_RECLAIM__dayDropAgainst', 'LONG', close, U, 1.6, 2.5, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_RANGE_EDGE_BOUNCE__volumeHigh
 *  LONG RANGE_EDGE_BOUNCE in BEAR + volumeHigh; limit close-1.6U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function LONG_BEAR_RANGE_EDGE_BOUNCE__volumeHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((donchian96(C, gi) <= 0.1)
        && (c.candleStructure.direction === 'BULLISH')
        && (volRank(C, gi, 96) >= 0.8))) return null;
    const o = makeOrder('LONG_BEAR_RANGE_EDGE_BOUNCE__volumeHigh', 'LONG', close, U, 1.6, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_FAILED_BREAKOUT__sessionNight_00_08PHT
 *  LONG FAILED_BREAKOUT in BEAR + sessionNight(00-08PHT); limit close-1.6U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function LONG_BEAR_FAILED_BREAKOUT__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.priceAction.failedBreakout.detected)
        && (c.priceAction.failedBreakout.direction === 'LONG')
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('LONG_BEAR_FAILED_BREAKOUT__sessionNight_00_08PHT', 'LONG', close, U, 1.6, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_SWING_RETEST__dayDropAgainst
 *  SHORT SWING_RETEST in BEAR + dayDropAgainst; limit close+0.25U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function SHORT_BEAR_SWING_RETEST__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const tr = trendSnapshot(C, gi);
    const sw = lastSwing(C, gi, 'HIGH');
    if (!((tr !== null && tr.dir === -1)
        && (sw !== null && sw.type === -1)
        && ((sw.price - close) / U >= 0)
        && ((sw.price - close) / U <= 0.5)
        && (gi - 96 >= 0 && -(close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('SHORT_BEAR_SWING_RETEST__dayDropAgainst', 'SHORT', close, U, 0.25, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_ZONE_SWEEP_RECLAIM__sessionAsia_08_16PHT
 *  LONG ZONE_SWEEP_RECLAIM in BULL + sessionAsia(08-16PHT); limit close-1.6U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function LONG_BULL_ZONE_SWEEP_RECLAIM__sessionAsia_08_16PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const pz = c.priceZone;
    if (!((pz !== null)
        && (c.low < pz.lower)
        && (c.close > pz.lower)
        && (c.candleStructure.lowerWickRatio >= 0.4)
        && (hourPHT(c) >= 8 && hourPHT(c) < 16))) return null;
    const o = makeOrder('LONG_BULL_ZONE_SWEEP_RECLAIM__sessionAsia_08_16PHT', 'LONG', close, U, 1.6, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_MOMENTUM_EXPANSION__volatHigh
 *  LONG MOMENTUM_EXPANSION in BEAR + volatHigh; limit close-1.2U, SL 1U, TP 1.25U, exp 3, hold 16 */
export function LONG_BEAR_MOMENTUM_EXPANSION__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.candleStructure.isExpansion)
        && (c.candleStructure.direction === 'BULLISH')
        && (volRank(C, gi, 96) >= 0.9)
        && (c.candleStructure.closeLocation >= 0.8)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BEAR_MOMENTUM_EXPANSION__volatHigh', 'LONG', close, U, 1.2, 1.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_VOLUME_SPIKE_REJECTION__zoneCheapSide
 *  LONG VOLUME_SPIKE_REJECTION in BULL + zoneCheapSide; limit close-1.6U, SL 2U, TP 2.5U, exp 3, hold 16 */
export function LONG_BULL_VOLUME_SPIKE_REJECTION__zoneCheapSide({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((c.candleStructure.volumeSpike)
        && (c.candleStructure.lowerWickRatio >= 0.5)
        && (c.outsidePriceZoneMetrics !== null && c.outsidePriceZoneMetrics.positionInZone <= 0.3))) return null;
    const o = makeOrder('LONG_BULL_VOLUME_SPIKE_REJECTION__zoneCheapSide', 'LONG', close, U, 1.6, 2.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_STRONG_PRICE_ACTION__volatHigh
 *  SHORT STRONG_PRICE_ACTION in BEAR + volatHigh; limit close+1.2U, SL 1U, TP 1.25U, exp 3, hold 16 */
export function SHORT_BEAR_STRONG_PRICE_ACTION__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.priceAction.strongAction)
        && (c.priceAction.dominant === 'SHORT')
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('SHORT_BEAR_STRONG_PRICE_ACTION__volatHigh', 'SHORT', close, U, 1.2, 1.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_HL_CONFIRM_LOWZONE__stretchedAgainst
 *  LONG HL_CONFIRM_LOWZONE in BEAR + stretchedAgainst; limit level-0U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function LONG_BEAR_HL_CONFIRM_LOWZONE__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((has(c, 'CONFIRMATION_HL'))
        && (oz !== null && oz.positionInZone <= 0.5)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_BEAR_HL_CONFIRM_LOWZONE__stretchedAgainst', 'LONG', C[gi - 2].low, U, 0.0, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_RECLAIM__volatHigh
 *  LONG RECLAIM in BEAR + volatHigh; limit close-1.2U, SL 1.5U, TP 1.875U, exp 8, hold 16 */
export function LONG_BEAR_RECLAIM__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.priceAction.reclaim.detected)
        && (c.priceAction.reclaim.direction === 'LONG')
        && (c.priceAction.reclaim.strength >= 90.0)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BEAR_RECLAIM__volatHigh', 'LONG', close, U, 1.2, 1.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_VALUE_SHIFT_PULLBACK__volatHigh
 *  LONG VALUE_SHIFT_PULLBACK in BULL + volatHigh; limit close-1.2U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function LONG_BULL_VALUE_SHIFT_PULLBACK__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((im !== null && (im.valueShiftAtr ?? NaN) >= 3.0)
        && (tr !== null && tr.dir === 1)
        && (oz !== null && oz.positionInZone <= 0.5)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BULL_VALUE_SHIFT_PULLBACK__volatHigh', 'LONG', close, U, 1.2, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_REJECTED_IMBALANCE__unitPctGE10
 *  SHORT REJECTED_IMBALANCE in RANGE + unitPct>=1.0; limit close+1.6U, SL 1.5U, TP 1.875U, exp 8, hold 16 */
export function SHORT_RANGE_REJECTED_IMBALANCE__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.state === 'REJECTED_UP')
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_REJECTED_IMBALANCE__unitPctGE10', 'SHORT', close, U, 1.6, 1.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_SWING_RETEST__unitPctGE10
 *  LONG SWING_RETEST in RANGE + unitPct>=1.0; limit close-1.6U, SL 2U, TP 2.5U, exp 3, hold 16 */
export function LONG_RANGE_SWING_RETEST__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    const sw = lastSwing(C, gi, 'LOW');
    if (!((tr !== null && tr.dir === 1)
        && (sw !== null && sw.type === 1)
        && ((close - sw.price) / U >= 0)
        && ((close - sw.price) / U <= 0.5)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_RANGE_SWING_RETEST__unitPctGE10', 'LONG', close, U, 1.6, 2.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_CAPITULATION_VOLUME__sessionEuUs_16_24PHT
 *  LONG CAPITULATION_VOLUME in BULL + sessionEuUs(16-24PHT); limit close-1.6U, SL 2.5U, TP 3.125U, exp 8, hold 16 */
export function LONG_BULL_CAPITULATION_VOLUME__sessionEuUs_16_24PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((volRank(C, gi, 480) >= 0.98)
        && (c.candleStructure.direction === 'BEARISH')
        && (c.candleStructure.rangeAtrRatio >= 1.5)
        && (c.candleStructure.closeLocation >= 0.35)
        && (hourPHT(c) >= 16))) return null;
    const o = makeOrder('LONG_BULL_CAPITULATION_VOLUME__sessionEuUs_16_24PHT', 'LONG', close, U, 1.6, 2.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_OUTSIDE_ZONE_REVERT__sessionEuUs_16_24PHT
 *  LONG OUTSIDE_ZONE_REVERT in BEAR + sessionEuUs(16-24PHT); limit close-1.6U, SL 2U, TP 2.5U, exp 3, hold 16 */
export function LONG_BEAR_OUTSIDE_ZONE_REVERT__sessionEuUs_16_24PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((oz !== null && oz.position === 'BELOW')
        && (-(oz.outsideAtr) >= 2.0)
        && (im === null || im.state !== 'IMBALANCE_DOWN')
        && (hourPHT(c) >= 16))) return null;
    const o = makeOrder('LONG_BEAR_OUTSIDE_ZONE_REVERT__sessionEuUs_16_24PHT', 'LONG', close, U, 1.6, 2.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_SWING_RETEST__unitPctGE10
 *  LONG SWING_RETEST in BULL + unitPct>=1.0; limit close-1.2U, SL 1.5U, TP 2.4U, exp 3, hold 16 */
export function LONG_BULL_SWING_RETEST__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    const sw = lastSwing(C, gi, 'LOW');
    if (!((tr !== null && tr.dir === 1)
        && (sw !== null && sw.type === 1)
        && ((close - sw.price) / U >= 0)
        && ((close - sw.price) / U <= 0.5)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_BULL_SWING_RETEST__unitPctGE10', 'LONG', close, U, 1.2, 1.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_REVERSAL_PATTERN_AT_ZONE__volatHigh
 *  LONG REVERSAL_PATTERN_AT_ZONE in BULL + volatHigh; limit close-1.6U, SL 2.5U, TP 3.125U, exp 8, hold 16 */
export function LONG_BULL_REVERSAL_PATTERN_AT_ZONE__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((hasPattern(c, 'HAMMER', 'BULLISH_ENGULFING', 'MORNING_STAR', 'PIERCING_LINE', 'TWEEZER_BOTTOM', 'DRAGONFLY_DOJI'))
        && (oz !== null && (oz.positionInZone <= 0.3 || oz.position === 'BELOW'))
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_BULL_REVERSAL_PATTERN_AT_ZONE__volatHigh', 'LONG', close, U, 1.6, 2.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_REJECTED_IMBALANCE__dayDropAgainst
 *  LONG REJECTED_IMBALANCE in RANGE + dayDropAgainst; limit close-1.6U, SL 2.5U, TP 5.5U, exp 3, hold 16 */
export function LONG_RANGE_REJECTED_IMBALANCE__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.state === 'REJECTED_DOWN')
        && (gi - 96 >= 0 && (close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('LONG_RANGE_REJECTED_IMBALANCE__dayDropAgainst', 'LONG', close, U, 1.6, 2.5, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_EMA_PULLBACK__unitPctGE10
 *  SHORT EMA_PULLBACK in RANGE + unitPct>=1.0; limit close+1.6U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function SHORT_RANGE_EMA_PULLBACK__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === -1)
        && (structure(C, gi) === -1)
        && (-(close - c.ema200) / c.ema200 * 100 >= 0)
        && (-(close - c.ema200) / c.ema200 * 100 <= 0.75)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_EMA_PULLBACK__unitPctGE10', 'SHORT', close, U, 1.6, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_RECLAIM__zoneCheapSide
 *  LONG RECLAIM in BULL + zoneCheapSide; limit close-1.6U, SL 2.5U, TP 4U, exp 3, hold 16 */
export function LONG_BULL_RECLAIM__zoneCheapSide({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((c.priceAction.reclaim.detected)
        && (c.priceAction.reclaim.direction === 'LONG')
        && (c.priceAction.reclaim.strength >= 90.0)
        && (c.outsidePriceZoneMetrics !== null && c.outsidePriceZoneMetrics.positionInZone <= 0.3))) return null;
    const o = makeOrder('LONG_BULL_RECLAIM__zoneCheapSide', 'LONG', close, U, 1.6, 2.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_EMA_PULLBACK__stretchedAgainst
 *  LONG EMA_PULLBACK in BULL + stretchedAgainst; limit close-1.6U, SL 2U, TP 3.2U, exp 3, hold 16 */
export function LONG_BULL_EMA_PULLBACK__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === 1)
        && (structure(C, gi) === 1)
        && ((close - c.ema200) / c.ema200 * 100 >= 0)
        && ((close - c.ema200) / c.ema200 * 100 <= 0.75)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_BULL_EMA_PULLBACK__stretchedAgainst', 'LONG', close, U, 1.6, 2.0, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_FIB_PULLBACK__volumeHigh
 *  SHORT FIB_PULLBACK in BEAR + volumeHigh; limit close+1.6U, SL 2.5U, TP 4U, exp 3, hold 16 */
export function SHORT_BEAR_FIB_PULLBACK__volumeHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === -1)
        && (tr.retrace >= 0.38 && tr.retrace <= 0.75)
        && (tr.legU >= 4.0)
        && (c.candleStructure.direction === 'BEARISH')
        && (c.candleStructure.closeLocation <= 0.4)
        && (volRank(C, gi, 96) >= 0.8))) return null;
    const o = makeOrder('SHORT_BEAR_FIB_PULLBACK__volumeHigh', 'SHORT', close, U, 1.6, 2.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_DISPLACEMENT_FVG__zoneCheapSide
 *  LONG DISPLACEMENT_FVG in BEAR + zoneCheapSide; limit level-0U, SL 2U, TP 4.4U, exp 3, hold 16 */
export function LONG_BEAR_DISPLACEMENT_FVG__zoneCheapSide({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.displacement !== null && im.displacement.direction === 'BULLISH')
        && (im.fairValueGap !== null && im.fairValueGap.direction === 'BULLISH')
        && ((c.openTime - im.fairValueGap.confirmedOpenTime) / 900000 <= 2.0)
        && (c.outsidePriceZoneMetrics !== null && c.outsidePriceZoneMetrics.positionInZone <= 0.3))) return null;
    const o = makeOrder('LONG_BEAR_DISPLACEMENT_FVG__zoneCheapSide', 'LONG', im!.fairValueGap!.high, U, 0.0, 2.0, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_FAILED_BREAKOUT__unitPctGE10
 *  SHORT FAILED_BREAKOUT in RANGE + unitPct>=1.0; limit close+1.6U, SL 2U, TP 2.5U, exp 8, hold 16 */
export function SHORT_RANGE_FAILED_BREAKOUT__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((c.priceAction.failedBreakout.detected)
        && (c.priceAction.failedBreakout.direction === 'SHORT')
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_FAILED_BREAKOUT__unitPctGE10', 'SHORT', close, U, 1.6, 2.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_INSIDE_BAR_BREAK__zoneCheapSide
 *  SHORT INSIDE_BAR_BREAK in BEAR + zoneCheapSide; limit close+1.2U, SL 2U, TP 2.5U, exp 8, hold 16 */
export function SHORT_BEAR_INSIDE_BAR_BREAK__zoneCheapSide({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((C[gi - 1].candleStructure.isInsideBar)
        && (close < C[gi - 2].low)
        && (c.outsidePriceZoneMetrics !== null && c.outsidePriceZoneMetrics.positionInZone >= 0.7))) return null;
    const o = makeOrder('SHORT_BEAR_INSIDE_BAR_BREAK__zoneCheapSide', 'SHORT', close, U, 1.2, 2.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_HL_CONFIRM_LOWZONE__sessionEuUs_16_24PHT
 *  LONG HL_CONFIRM_LOWZONE in RANGE + sessionEuUs(16-24PHT); limit close-0.8U, SL 2U, TP 4.4U, exp 3, hold 16 */
export function LONG_RANGE_HL_CONFIRM_LOWZONE__sessionEuUs_16_24PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((has(c, 'CONFIRMATION_HL'))
        && (oz !== null && oz.positionInZone <= 0.5)
        && (hourPHT(c) >= 16))) return null;
    const o = makeOrder('LONG_RANGE_HL_CONFIRM_LOWZONE__sessionEuUs_16_24PHT', 'LONG', close, U, 0.8, 2.0, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_FAILED_BREAKOUT__dayDropAgainst
 *  SHORT FAILED_BREAKOUT in BEAR + dayDropAgainst; limit close+0.25U, SL 2U, TP 4.4U, exp 8, hold 16 */
export function SHORT_BEAR_FAILED_BREAKOUT__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.priceAction.failedBreakout.detected)
        && (c.priceAction.failedBreakout.direction === 'SHORT')
        && (gi - 96 >= 0 && -(close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('SHORT_BEAR_FAILED_BREAKOUT__dayDropAgainst', 'SHORT', close, U, 0.25, 2.0, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_FIB_PULLBACK__zoneDearSide
 *  LONG FIB_PULLBACK in RANGE + zoneDearSide; limit close-1.6U, SL 1.5U, TP 1.875U, exp 3, hold 16 */
export function LONG_RANGE_FIB_PULLBACK__zoneDearSide({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === 1)
        && (tr.retrace >= 0.38 && tr.retrace <= 0.75)
        && (tr.legU >= 4.0)
        && (c.candleStructure.direction === 'BULLISH')
        && (c.candleStructure.closeLocation >= 0.6)
        && (c.outsidePriceZoneMetrics !== null && c.outsidePriceZoneMetrics.positionInZone >= 0.7))) return null;
    const o = makeOrder('LONG_RANGE_FIB_PULLBACK__zoneDearSide', 'LONG', close, U, 1.6, 1.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_SWING_RETEST__volatHigh
 *  SHORT SWING_RETEST in BULL + volatHigh; limit close+0.8U, SL 1U, TP 1.25U, exp 3, hold 16 */
export function SHORT_BULL_SWING_RETEST__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    const sw = lastSwing(C, gi, 'HIGH');
    if (!((tr !== null && tr.dir === -1)
        && (sw !== null && sw.type === -1)
        && ((sw.price - close) / U >= 0)
        && ((sw.price - close) / U <= 0.5)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('SHORT_BULL_SWING_RETEST__volatHigh', 'SHORT', close, U, 0.8, 1.0, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_REJECTED_IMBALANCE__unitPctGE10
 *  LONG REJECTED_IMBALANCE in BULL + unitPct>=1.0; limit close-1.6U, SL 2.5U, TP 3.125U, exp 8, hold 16 */
export function LONG_BULL_REJECTED_IMBALANCE__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.state === 'REJECTED_DOWN')
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_BULL_REJECTED_IMBALANCE__unitPctGE10', 'LONG', close, U, 1.6, 2.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_DISPLACEMENT_FVG__unitPctGE10
 *  SHORT DISPLACEMENT_FVG in RANGE + unitPct>=1.0; limit level+0.25U, SL 1U, TP 1.25U, exp 8, hold 16 */
export function SHORT_RANGE_DISPLACEMENT_FVG__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.displacement !== null && im.displacement.direction === 'BEARISH')
        && (im.fairValueGap !== null && im.fairValueGap.direction === 'BEARISH')
        && ((c.openTime - im.fairValueGap.confirmedOpenTime) / 900000 <= 2.0)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_DISPLACEMENT_FVG__unitPctGE10', 'SHORT', im!.fairValueGap!.low, U, 0.25, 1.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_VALUE_SHIFT_PULLBACK__unitPctGE10
 *  SHORT VALUE_SHIFT_PULLBACK in RANGE + unitPct>=1.0; limit close+1.2U, SL 1.5U, TP 2.4U, exp 3, hold 16 */
export function SHORT_RANGE_VALUE_SHIFT_PULLBACK__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((im !== null && -(im.valueShiftAtr ?? NaN) >= 3.0)
        && (tr !== null && tr.dir === -1)
        && (oz !== null && oz.positionInZone >= 0.5)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_VALUE_SHIFT_PULLBACK__unitPctGE10', 'SHORT', close, U, 1.2, 1.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_COMPRESSION_BREAK__sessionNight_00_08PHT
 *  LONG COMPRESSION_BREAK in BEAR + sessionNight(00-08PHT); limit close-1.6U, SL 1.5U, TP 3.3U, exp 3, hold 16 */
export function LONG_BEAR_COMPRESSION_BREAK__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const box = consolidationBox(C, gi - 1);   // box measured at the previous candle
    if (!((box.n >= 16.0)
        && (close > box.high)
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('LONG_BEAR_COMPRESSION_BREAK__sessionNight_00_08PHT', 'LONG', close, U, 1.6, 1.5, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_NEW_TREND_CONFIRMED__sessionNight_00_08PHT
 *  SHORT NEW_TREND_CONFIRMED in BEAR + sessionNight(00-08PHT); limit close+1.6U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function SHORT_BEAR_NEW_TREND_CONFIRMED__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === -1)
        && (tr.ageConf <= 2.0)
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('SHORT_BEAR_NEW_TREND_CONFIRMED__sessionNight_00_08PHT', 'SHORT', close, U, 1.6, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_CAPITULATION_VOLUME__volatHigh
 *  LONG CAPITULATION_VOLUME in RANGE + volatHigh; limit close-1.6U, SL 0.75U, TP 1.65U, exp 3, hold 16 */
export function LONG_RANGE_CAPITULATION_VOLUME__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((volRank(C, gi, 480) >= 0.98)
        && (c.candleStructure.direction === 'BEARISH')
        && (c.candleStructure.rangeAtrRatio >= 1.5)
        && (c.candleStructure.closeLocation >= 0.35)
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_RANGE_CAPITULATION_VOLUME__volatHigh', 'LONG', close, U, 1.6, 0.75, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_CAPITULATION_VOLUME__sessionNight_00_08PHT
 *  SHORT CAPITULATION_VOLUME in RANGE + sessionNight(00-08PHT); limit close+0.5U, SL 2U, TP 4.4U, exp 3, hold 16 */
export function SHORT_RANGE_CAPITULATION_VOLUME__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((volRank(C, gi, 480) >= 0.98)
        && (c.candleStructure.direction === 'BULLISH')
        && (c.candleStructure.rangeAtrRatio >= 1.5)
        && (c.candleStructure.closeLocation <= 0.65)
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('SHORT_RANGE_CAPITULATION_VOLUME__sessionNight_00_08PHT', 'SHORT', close, U, 0.5, 2.0, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_VALUE_ACCEPTED__dayDropAgainst
 *  LONG VALUE_ACCEPTED in RANGE + dayDropAgainst; limit level-0.25U, SL 1U, TP 1.6U, exp 3, hold 16 */
export function LONG_RANGE_VALUE_ACCEPTED__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const pz = c.priceZone;
    if (!((has(c, 'BULLISH_VALUE_ACCEPTED'))
        && (pz !== null)
        && (gi - 96 >= 0 && (close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('LONG_RANGE_VALUE_ACCEPTED__dayDropAgainst', 'LONG', pz!.upper, U, 0.25, 1.0, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_STRONG_PRICE_ACTION__volumeLow
 *  SHORT STRONG_PRICE_ACTION in BULL + volumeLow; limit close+0.8U, SL 1.5U, TP 1.875U, exp 8, hold 16 */
export function SHORT_BULL_STRONG_PRICE_ACTION__volumeLow({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((c.priceAction.strongAction)
        && (c.priceAction.dominant === 'SHORT')
        && (volRank(C, gi, 96) <= 0.4))) return null;
    const o = makeOrder('SHORT_BULL_STRONG_PRICE_ACTION__volumeLow', 'SHORT', close, U, 0.8, 1.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_INSIDE_BAR_BREAK__sessionNight_00_08PHT
 *  LONG INSIDE_BAR_BREAK in BEAR + sessionNight(00-08PHT); limit close-1.6U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function LONG_BEAR_INSIDE_BAR_BREAK__sessionNight_00_08PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((C[gi - 1].candleStructure.isInsideBar)
        && (close > C[gi - 2].high)
        && (hourPHT(c) < 8))) return null;
    const o = makeOrder('LONG_BEAR_INSIDE_BAR_BREAK__sessionNight_00_08PHT', 'LONG', close, U, 1.6, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BEAR_STRONG_PRICE_ACTION__dayDropAgainst
 *  LONG STRONG_PRICE_ACTION in BEAR + dayDropAgainst; limit close-0.5U, SL 1.5U, TP 2.4U, exp 8, hold 16 */
export function LONG_BEAR_STRONG_PRICE_ACTION__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.priceAction.strongAction)
        && (c.priceAction.dominant === 'LONG')
        && (gi - 96 >= 0 && (close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('LONG_BEAR_STRONG_PRICE_ACTION__dayDropAgainst', 'LONG', close, U, 0.5, 1.5, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_REJECTED_IMBALANCE__volatHigh
 *  SHORT REJECTED_IMBALANCE in BEAR + volatHigh; limit close+1.6U, SL 2U, TP 4.4U, exp 3, hold 16 */
export function SHORT_BEAR_REJECTED_IMBALANCE__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.state === 'REJECTED_UP')
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('SHORT_BEAR_REJECTED_IMBALANCE__volatHigh', 'SHORT', close, U, 1.6, 2.0, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_HL_CONFIRM_LOWZONE__unitPctGE06
 *  SHORT HL_CONFIRM_LOWZONE in BEAR + unitPct>=0.6; limit close+1.6U, SL 2U, TP 3.2U, exp 8, hold 16 */
export function SHORT_BEAR_HL_CONFIRM_LOWZONE__unitPctGE06({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((has(c, 'CONFIRMATION_LH'))
        && (oz !== null && oz.positionInZone >= 0.5)
        && (U / close * 100 >= 0.6))) return null;
    const o = makeOrder('SHORT_BEAR_HL_CONFIRM_LOWZONE__unitPctGE06', 'SHORT', close, U, 1.6, 2.0, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_DISPLACEMENT_FVG__sessionEuUs_16_24PHT
 *  LONG DISPLACEMENT_FVG in BULL + sessionEuUs(16-24PHT); limit level-0.25U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function LONG_BULL_DISPLACEMENT_FVG__sessionEuUs_16_24PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const im = c.imbalanceState;
    if (!((im !== null && im.displacement !== null && im.displacement.direction === 'BULLISH')
        && (im.fairValueGap !== null && im.fairValueGap.direction === 'BULLISH')
        && ((c.openTime - im.fairValueGap.confirmedOpenTime) / 900000 <= 2.0)
        && (hourPHT(c) >= 16))) return null;
    const o = makeOrder('LONG_BULL_DISPLACEMENT_FVG__sessionEuUs_16_24PHT', 'LONG', im!.fairValueGap!.high, U, 0.25, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_HL_CONFIRM__unitPctGE10
 *  SHORT HL_CONFIRM in BULL + unitPct>=1.0; limit close+1.6U, SL 1.5U, TP 2.4U, exp 8, hold 16 */
export function SHORT_BULL_HL_CONFIRM__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    if (!((has(c, 'CONFIRMATION_LH'))
        && (tr !== null && tr.dir === -1)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_BULL_HL_CONFIRM__unitPctGE10', 'SHORT', close, U, 1.6, 1.5, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_OUTSIDE_ZONE_REVERT__sessionAsia_08_16PHT
 *  SHORT OUTSIDE_ZONE_REVERT in BULL + sessionAsia(08-16PHT); limit close+1.6U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function SHORT_BULL_OUTSIDE_ZONE_REVERT__sessionAsia_08_16PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((oz !== null && oz.position === 'ABOVE')
        && ((oz.outsideAtr) >= 2.0)
        && (im === null || im.state !== 'IMBALANCE_UP')
        && (hourPHT(c) >= 8 && hourPHT(c) < 16))) return null;
    const o = makeOrder('SHORT_BULL_OUTSIDE_ZONE_REVERT__sessionAsia_08_16PHT', 'SHORT', close, U, 1.6, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_ZONE_SWEEP_RECLAIM__dayDropAgainst
 *  SHORT ZONE_SWEEP_RECLAIM in BEAR + dayDropAgainst; limit close+0.25U, SL 2.5U, TP 3.125U, exp 3, hold 16 */
export function SHORT_BEAR_ZONE_SWEEP_RECLAIM__dayDropAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    const pz = c.priceZone;
    if (!((pz !== null)
        && (c.high > pz.upper)
        && (c.close < pz.upper)
        && (c.candleStructure.upperWickRatio >= 0.4)
        && (gi - 96 >= 0 && -(close - C[gi - 96].close) / U <= -5))) return null;
    const o = makeOrder('SHORT_BEAR_ZONE_SWEEP_RECLAIM__dayDropAgainst', 'SHORT', close, U, 0.25, 2.5, 1.25, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_RANGE_EDGE_BOUNCE__unitPctGE10
 *  LONG RANGE_EDGE_BOUNCE in RANGE + unitPct>=1.0; limit close-1.6U, SL 2U, TP 2.5U, exp 8, hold 16 */
export function LONG_RANGE_RANGE_EDGE_BOUNCE__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((donchian96(C, gi) <= 0.1)
        && (c.candleStructure.direction === 'BULLISH')
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_RANGE_RANGE_EDGE_BOUNCE__unitPctGE10', 'LONG', close, U, 1.6, 2.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_HL_CONFIRM_LOWZONE__volatLow
 *  SHORT HL_CONFIRM_LOWZONE in BULL + volatLow; limit close+1.6U, SL 2U, TP 4.4U, exp 3, hold 16 */
export function SHORT_BULL_HL_CONFIRM_LOWZONE__volatLow({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((has(c, 'CONFIRMATION_LH'))
        && (oz !== null && oz.positionInZone >= 0.5)
        && (unitPctRank(C, gi) <= 0.3))) return null;
    const o = makeOrder('SHORT_BULL_HL_CONFIRM_LOWZONE__volatLow', 'SHORT', close, U, 1.6, 2.0, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_REVERSAL_PATTERN_AT_ZONE__unitPctGE10
 *  LONG REVERSAL_PATTERN_AT_ZONE in RANGE + unitPct>=1.0; limit close-1.6U, SL 2U, TP 2.5U, exp 8, hold 16 */
export function LONG_RANGE_REVERSAL_PATTERN_AT_ZONE__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const oz = c.outsidePriceZoneMetrics;
    if (!((hasPattern(c, 'HAMMER', 'BULLISH_ENGULFING', 'MORNING_STAR', 'PIERCING_LINE', 'TWEEZER_BOTTOM', 'DRAGONFLY_DOJI'))
        && (oz !== null && (oz.positionInZone <= 0.3 || oz.position === 'BELOW'))
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_RANGE_REVERSAL_PATTERN_AT_ZONE__unitPctGE10', 'LONG', close, U, 1.6, 2.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_HL_CONFIRM__unitPctGE10
 *  LONG HL_CONFIRM in RANGE + unitPct>=1.0; limit level-0.25U, SL 1U, TP 1.25U, exp 8, hold 16 */
export function LONG_RANGE_HL_CONFIRM__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    if (!((has(c, 'CONFIRMATION_HL'))
        && (tr !== null && tr.dir === 1)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('LONG_RANGE_HL_CONFIRM__unitPctGE10', 'LONG', C[gi - 2].low, U, 0.25, 1.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_VALUE_SHIFT_PULLBACK__stretchedAgainst
 *  LONG VALUE_SHIFT_PULLBACK in RANGE + stretchedAgainst; limit close-1.6U, SL 2.5U, TP 5.5U, exp 3, hold 16 */
export function LONG_RANGE_VALUE_SHIFT_PULLBACK__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const tr = trendSnapshot(C, gi);
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((im !== null && (im.valueShiftAtr ?? NaN) >= 3.0)
        && (tr !== null && tr.dir === 1)
        && (oz !== null && oz.positionInZone <= 0.5)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_RANGE_VALUE_SHIFT_PULLBACK__stretchedAgainst', 'LONG', close, U, 1.6, 2.5, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_VOLUME_SPIKE_REJECTION__stretchedWith
 *  SHORT VOLUME_SPIKE_REJECTION in BEAR + stretchedWith; limit close+1.6U, SL 2.5U, TP 5.5U, exp 3, hold 16 */
export function SHORT_BEAR_VOLUME_SPIKE_REJECTION__stretchedWith({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((c.candleStructure.volumeSpike)
        && (c.candleStructure.upperWickRatio >= 0.5)
        && (-stretch20(C, gi) >= 1.5))) return null;
    const o = makeOrder('SHORT_BEAR_VOLUME_SPIKE_REJECTION__stretchedWith', 'SHORT', close, U, 1.6, 2.5, 2.2, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_VALUE_ACCEPTED__volumeHigh
 *  SHORT VALUE_ACCEPTED in BULL + volumeHigh; limit close+1.2U, SL 1.5U, TP 2.4U, exp 8, hold 16 */
export function SHORT_BULL_VALUE_ACCEPTED__volumeHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const pz = c.priceZone;
    if (!((has(c, 'BEARISH_VALUE_ACCEPTED'))
        && (pz !== null)
        && (volRank(C, gi, 96) >= 0.8))) return null;
    const o = makeOrder('SHORT_BULL_VALUE_ACCEPTED__volumeHigh', 'SHORT', close, U, 1.2, 1.5, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_OUTSIDE_ZONE_REVERT__volatHigh
 *  LONG OUTSIDE_ZONE_REVERT in RANGE + volatHigh; limit close-0.8U, SL 1U, TP 1.6U, exp 3, hold 16 */
export function LONG_RANGE_OUTSIDE_ZONE_REVERT__volatHigh({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const oz = c.outsidePriceZoneMetrics;
    const im = c.imbalanceState;
    if (!((oz !== null && oz.position === 'BELOW')
        && (-(oz.outsideAtr) >= 2.0)
        && (im === null || im.state !== 'IMBALANCE_DOWN')
        && (unitPctRank(C, gi) >= 0.7))) return null;
    const o = makeOrder('LONG_RANGE_OUTSIDE_ZONE_REVERT__volatHigh', 'LONG', close, U, 0.8, 1.0, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_NEW_TREND_CONFIRMED__unitPctGE10
 *  SHORT NEW_TREND_CONFIRMED in BULL + unitPct>=1.0; limit close+1.6U, SL 2U, TP 2.5U, exp 8, hold 16 */
export function SHORT_BULL_NEW_TREND_CONFIRMED__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    const tr = trendSnapshot(C, gi);
    if (!((tr !== null && tr.dir === -1)
        && (tr.ageConf <= 2.0)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_BULL_NEW_TREND_CONFIRMED__unitPctGE10', 'SHORT', close, U, 1.6, 2.0, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_ZONE_SWEEP_RECLAIM__unitPctGE10
 *  SHORT ZONE_SWEEP_RECLAIM in RANGE + unitPct>=1.0; limit close+1.6U, SL 1.5U, TP 1.875U, exp 8, hold 16 */
export function SHORT_RANGE_ZONE_SWEEP_RECLAIM__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const pz = c.priceZone;
    if (!((pz !== null)
        && (c.high > pz.upper)
        && (c.close < pz.upper)
        && (c.candleStructure.upperWickRatio >= 0.4)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_RANGE_ZONE_SWEEP_RECLAIM__unitPctGE10', 'SHORT', close, U, 1.6, 1.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_RANGE_INSIDE_BAR_BREAK__stretchedAgainst
 *  LONG INSIDE_BAR_BREAK in RANGE + stretchedAgainst; limit close-1.6U, SL 2.5U, TP 5.5U, exp 8, hold 16 */
export function LONG_RANGE_INSIDE_BAR_BREAK__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    if (!((C[gi - 1].candleStructure.isInsideBar)
        && (close > C[gi - 2].high)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_RANGE_INSIDE_BAR_BREAK__stretchedAgainst', 'LONG', close, U, 1.6, 2.5, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** LONG_BULL_SWEEP_REJECT_SEQ__stretchedAgainst
 *  LONG SWEEP_REJECT_SEQ in BULL + stretchedAgainst; limit close-1.6U, SL 1.5U, TP 2.4U, exp 3, hold 16 */
export function LONG_BULL_SWEEP_REJECT_SEQ__stretchedAgainst({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((c.priceAction.liquiditySweep.detected)
        && (c.priceAction.liquiditySweep.direction === 'LONG')
        && (c.priceAction.rejection.detected)
        && (c.priceAction.rejection.direction === 'LONG')
        && (c.priceAction.sequence.completion >= 0.6)
        && (stretch20(C, gi) <= -1.5))) return null;
    const o = makeOrder('LONG_BULL_SWEEP_REJECT_SEQ__stretchedAgainst', 'LONG', close, U, 1.6, 1.5, 1.6, 3, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_RANGE_COMPRESSION_BREAK__sessionEuUs_16_24PHT
 *  SHORT COMPRESSION_BREAK in RANGE + sessionEuUs(16-24PHT); limit close+1.2U, SL 1.5U, TP 2.4U, exp 8, hold 16 */
export function SHORT_RANGE_COMPRESSION_BREAK__sessionEuUs_16_24PHT({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'RANGE') return null;
    const box = consolidationBox(C, gi - 1);   // box measured at the previous candle
    if (!((box.n >= 16.0)
        && (close < box.low)
        && (hourPHT(c) >= 16))) return null;
    const o = makeOrder('SHORT_RANGE_COMPRESSION_BREAK__sessionEuUs_16_24PHT', 'SHORT', close, U, 1.2, 1.5, 1.6, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BEAR_STRETCH_EXHAUSTION__unitPctGE06
 *  SHORT STRETCH_EXHAUSTION in BEAR + unitPct>=0.6; limit close+0.8U, SL 1U, TP 2.2U, exp 8, hold 16 */
export function SHORT_BEAR_STRETCH_EXHAUSTION__unitPctGE06({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BEAR') return null;
    if (!((stretch20(C, gi) >= 3.0)
        && (c.candleStructure.consecutiveBullish >= 3.0)
        && (U / close * 100 >= 0.6))) return null;
    const o = makeOrder('SHORT_BEAR_STRETCH_EXHAUSTION__unitPctGE06', 'SHORT', close, U, 0.8, 1.0, 2.2, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

/** SHORT_BULL_VOLUME_SPIKE_REJECTION__unitPctGE10
 *  SHORT VOLUME_SPIKE_REJECTION in BULL + unitPct>=1.0; limit close+1.6U, SL 1.5U, TP 1.875U, exp 8, hold 16 */
export function SHORT_BULL_VOLUME_SPIKE_REJECTION__unitPctGE10({ c, C, gi, close, U, reg }: Ctx, tick: number): LimitOrderDecision | null {
    if (reg !== 'BULL') return null;
    if (!((c.candleStructure.volumeSpike)
        && (c.candleStructure.upperWickRatio >= 0.5)
        && (U / close * 100 >= 1.0))) return null;
    const o = makeOrder('SHORT_BULL_VOLUME_SPIKE_REJECTION__unitPctGE10', 'SHORT', close, U, 1.6, 1.5, 1.25, 8, 16);
    return validOrder(o, close, tick) ? o : null;
}

export const PLAYBOOK = [
    LONG_BEAR_STRETCH_EXHAUSTION__unitPctGE06,
    LONG_BEAR_CAPITULATION_VOLUME__sessionAsia_08_16PHT,
    LONG_BEAR_VOLUME_SPIKE_REJECTION__volatHigh,
    LONG_BEAR_ZONE_SWEEP_RECLAIM__stretchedAgainst,
    LONG_RANGE_STRETCH_EXHAUSTION__sessionNight_00_08PHT,
    LONG_BEAR_REJECTED_IMBALANCE__sessionNight_00_08PHT,
    LONG_BULL_STRETCH_EXHAUSTION,
    LONG_BEAR_REVERSAL_PATTERN_AT_ZONE__volatHigh,
    LONG_RANGE_ZONE_SWEEP_RECLAIM__dayDropAgainst,
    LONG_BEAR_RANGE_EDGE_BOUNCE__volumeHigh,
    LONG_BEAR_FAILED_BREAKOUT__sessionNight_00_08PHT,
    SHORT_BEAR_SWING_RETEST__dayDropAgainst,
    LONG_BULL_ZONE_SWEEP_RECLAIM__sessionAsia_08_16PHT,
    LONG_BEAR_MOMENTUM_EXPANSION__volatHigh,
    LONG_BULL_VOLUME_SPIKE_REJECTION__zoneCheapSide,
    SHORT_BEAR_STRONG_PRICE_ACTION__volatHigh,
    LONG_BEAR_HL_CONFIRM_LOWZONE__stretchedAgainst,
    LONG_BEAR_RECLAIM__volatHigh,
    LONG_BULL_VALUE_SHIFT_PULLBACK__volatHigh,
    SHORT_RANGE_REJECTED_IMBALANCE__unitPctGE10,
    LONG_RANGE_SWING_RETEST__unitPctGE10,
    LONG_BULL_CAPITULATION_VOLUME__sessionEuUs_16_24PHT,
    LONG_BEAR_OUTSIDE_ZONE_REVERT__sessionEuUs_16_24PHT,
    LONG_BULL_SWING_RETEST__unitPctGE10,
    LONG_BULL_REVERSAL_PATTERN_AT_ZONE__volatHigh,
    LONG_RANGE_REJECTED_IMBALANCE__dayDropAgainst,
    SHORT_RANGE_EMA_PULLBACK__unitPctGE10,
    LONG_BULL_RECLAIM__zoneCheapSide,
    LONG_BULL_EMA_PULLBACK__stretchedAgainst,
    SHORT_BEAR_FIB_PULLBACK__volumeHigh,
    LONG_BEAR_DISPLACEMENT_FVG__zoneCheapSide,
    SHORT_RANGE_FAILED_BREAKOUT__unitPctGE10,
    SHORT_BEAR_INSIDE_BAR_BREAK__zoneCheapSide,
    LONG_RANGE_HL_CONFIRM_LOWZONE__sessionEuUs_16_24PHT,
    SHORT_BEAR_FAILED_BREAKOUT__dayDropAgainst,
    LONG_RANGE_FIB_PULLBACK__zoneDearSide,
    SHORT_BULL_SWING_RETEST__volatHigh,
    LONG_BULL_REJECTED_IMBALANCE__unitPctGE10,
    SHORT_RANGE_DISPLACEMENT_FVG__unitPctGE10,
    SHORT_RANGE_VALUE_SHIFT_PULLBACK__unitPctGE10,
    LONG_BEAR_COMPRESSION_BREAK__sessionNight_00_08PHT,
    SHORT_BEAR_NEW_TREND_CONFIRMED__sessionNight_00_08PHT,
    LONG_RANGE_CAPITULATION_VOLUME__volatHigh,
    SHORT_RANGE_CAPITULATION_VOLUME__sessionNight_00_08PHT,
    LONG_RANGE_VALUE_ACCEPTED__dayDropAgainst,
    SHORT_BULL_STRONG_PRICE_ACTION__volumeLow,
    LONG_BEAR_INSIDE_BAR_BREAK__sessionNight_00_08PHT,
    LONG_BEAR_STRONG_PRICE_ACTION__dayDropAgainst,
    SHORT_BEAR_REJECTED_IMBALANCE__volatHigh,
    SHORT_BEAR_HL_CONFIRM_LOWZONE__unitPctGE06,
    LONG_BULL_DISPLACEMENT_FVG__sessionEuUs_16_24PHT,
    SHORT_BULL_HL_CONFIRM__unitPctGE10,
    SHORT_BULL_OUTSIDE_ZONE_REVERT__sessionAsia_08_16PHT,
    SHORT_BEAR_ZONE_SWEEP_RECLAIM__dayDropAgainst,
    LONG_RANGE_RANGE_EDGE_BOUNCE__unitPctGE10,
    SHORT_BULL_HL_CONFIRM_LOWZONE__volatLow,
    LONG_RANGE_REVERSAL_PATTERN_AT_ZONE__unitPctGE10,
    LONG_RANGE_HL_CONFIRM__unitPctGE10,
    LONG_RANGE_VALUE_SHIFT_PULLBACK__stretchedAgainst,
    SHORT_BEAR_VOLUME_SPIKE_REJECTION__stretchedWith,
    SHORT_BULL_VALUE_ACCEPTED__volumeHigh,
    LONG_RANGE_OUTSIDE_ZONE_REVERT__volatHigh,
    SHORT_BULL_NEW_TREND_CONFIRMED__unitPctGE10,
    SHORT_RANGE_ZONE_SWEEP_RECLAIM__unitPctGE10,
    LONG_RANGE_INSIDE_BAR_BREAK__stretchedAgainst,
    LONG_BULL_SWEEP_REJECT_SEQ__stretchedAgainst,
    SHORT_RANGE_COMPRESSION_BREAK__sessionEuUs_16_24PHT,
    SHORT_BEAR_STRETCH_EXHAUSTION__unitPctGE06,
    SHORT_BULL_VOLUME_SPIKE_REJECTION__unitPctGE10,
];

/**
 * Call at the close of candles[gi] when the symbol has NO open order and NO open position.
 * `tick` = the symbol's price tick. Returns the highest-priority setup's order, or null.
 */
export function checkPlaybookEntry(candle: CandleInfo, candles: CandleInfo[], gi: number, tick: number): LimitOrderDecision | null {
    if (gi < 499) return null;                         // the bot needs a full 500-candle window
    const U = unitU(candles, gi);
    if (!(U > 0) || !(candle.atr > 0)) return null;
    const ctx: Ctx = { c: candle, C: candles, gi, close: candle.close, U, reg: regime(candles, gi) };
    for (const setup of PLAYBOOK) {
        const o = setup(ctx, tick);
        if (o) return o;
    }
    return null;
}
