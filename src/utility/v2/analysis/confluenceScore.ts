import type {
    CandleInfo,
    ConfluenceScore,
    CrossTimeframeState,
    EntryEvidence,
    Ema200State,
    LocationState,
    MainMarketRegime,
    MarketRegime,
    MARKET_DIRECTION,
    MARKET_INTERVAL,
    REGIME_DIRECTION,
    SIGNAL_DIRECTION,
    SymbolInfo,
    TimeframeStructureState,
    TradeLevel,
    TradeRecommendation,
} from "@/core/interfacesv2"


/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
|
| These are architectural starting values.
| They should eventually be optimized through backtesting.
|
*/

const STRUCTURE_WEIGHTS: Record<MARKET_INTERVAL, number> = {
    '15m': 0.10,
    '1h': 0.20,
    '4h': 0.30,
    '1d': 0.40,
}

const EMA_WEIGHTS: Record<MARKET_INTERVAL, number> = {
    '15m': 0.10,
    '1h': 0.20,
    '4h': 0.30,
    '1d': 0.40,
}

const MAIN_MARKET_WEIGHTS = {
    btc: 0.50,
    eth: 0.30,
    sol: 0.20,
}

const MIN_DIRECTION_EDGE = 12

const MIN_TRADE_CONFIDENCE = 52

const MIN_RISK_REWARD = 1.50

const PIVOT_LOOKBACK = 80

const LEVEL_DEDUP_ATR = 0.35

const STOP_BUFFER_ATR = 0.25


/*
|--------------------------------------------------------------------------
| Public API
|--------------------------------------------------------------------------
*/

export function getConfluenceScore(
    targetSymbol: SymbolInfo,
    movingCandles: CandleInfo[],
    mainMarkets: SymbolInfo[]
): ConfluenceScore | null {

    if (!movingCandles || movingCandles.length === 0) {
        return null
    }

    const current = movingCandles[movingCandles.length - 1]

    if (!current) {
        return null
    }

    const timestamp = current.closeTime || current.openTime

    const regime = buildMarketRegime(
        movingCandles,
        current.closeTime
    )

    const mainMarketRegime = buildMainMarketRegime(
        mainMarkets,
        current.closeTime
    )

    const crossTimeframe = regime.structure

    const location = buildLocationState(
        movingCandles,
        current
    )

    const entry = buildEntryEvidence(
        movingCandles,
        current
    )

    const contradiction = calculateContradiction(
        regime,
        mainMarketRegime,
        crossTimeframe,
        entry
    )

    const finalDirection = determineFinalDirection(
        regime,
        mainMarketRegime,
        location,
        entry,
        contradiction
    )

    const score = calculateFinalScore(
        regime,
        mainMarketRegime,
        location,
        entry,
        contradiction,
        finalDirection
    )

    const confidence = calculateConfidence(
        score,
        contradiction,
        entry.strength,
        regime.strength,
        mainMarketRegime.strength
    )

    const trade = buildTradeRecommendation(
        finalDirection,
        current,
        movingCandles,
        targetSymbol,
        confidence
    )

    const reasons = buildFinalReasons(
        finalDirection,
        score,
        confidence,
        regime,
        mainMarketRegime,
        location,
        entry,
        contradiction,
        trade
    )

    return {
        score,
        direction: finalDirection,
        confidence,

        regime,

        mainMarketRegime,

        crossTimeframe,

        location,

        entry,

        contradiction,

        reasons,

        trade,

        timestamp,
    }
}


/*
|--------------------------------------------------------------------------
| Market Regime
|--------------------------------------------------------------------------
*/

function buildMarketRegime(
    candles15m: CandleInfo[],
    currentCloseTime: number
): MarketRegime {

    const intervals: MARKET_INTERVAL[] = [
        '15m',
        '1h',
        '4h',
        '1d'
    ]

    const timeframes = {
        '15m': buildTimeframeStructure(
            candles15m,
            '15m',
            currentCloseTime
        ),
        '1h': buildTimeframeStructure(
            getTimeframeCandles(candles15m, '1h'),
            '1h',
            currentCloseTime
        ),
        '4h': buildTimeframeStructure(
            getTimeframeCandles(candles15m, '4h'),
            '4h',
            currentCloseTime
        ),
        '1d': buildTimeframeStructure(
            getTimeframeCandles(candles15m, '1d'),
            '1d',
            currentCloseTime
        ),
    }

    const ema200 = {
        '15m': buildEma200State(
            getTimeframeCandles(candles15m, '15m'),
            '15m',
            currentCloseTime
        ),

        '1h': buildEma200State(
            getTimeframeCandles(candles15m, '1h'),
            '1h',
            currentCloseTime
        ),

        '4h': buildEma200State(
            getTimeframeCandles(candles15m, '4h'),
            '4h',
            currentCloseTime
        ),

        '1d': buildEma200State(
            getTimeframeCandles(candles15m, '1d'),
            '1d',
            currentCloseTime
        ),
    }

    const structure = buildCrossTimeframeState(
        timeframes,
        currentCloseTime
    )

    const directionalEvidence = calculateRegimeDirectionalEvidence(
        ema200,
        structure
    )

    const direction = directionalEvidence.direction

    let state: MarketRegime["state"] = 'NEUTRAL'

    if (direction === 'BULLISH') {
        if (structure.conflict >= 45) {
            state = 'TRANSITION'
        } else if (directionalEvidence.strength >= 60) {
            state = 'TREND_UP'
        } else {
            state = 'TRANSITION'
        }
    } else if (direction === 'BEARISH') {
        if (structure.conflict >= 45) {
            state = 'TRANSITION'
        } else if (directionalEvidence.strength >= 60) {
            state = 'TREND_DOWN'
        } else {
            state = 'TRANSITION'
        }
    } else {
        state = 'RANGE'
    }

    const reasons: string[] = []

    reasons.push(
        `HTF regime: ${state}`
    )

    reasons.push(
        `Regime direction: ${direction}`
    )

    reasons.push(
        `Regime strength ${round(directionalEvidence.strength)}`
    )

    for (const interval of intervals) {

        const ema = ema200[interval]

        if (ema) {
            reasons.push(
                `${interval} EMA200 ${formatPrice(ema.value)} ` +
                `${ema.position.toLowerCase()} price ` +
                `(${formatPercent(ema.distancePercent)})`
            )
        }
    }

    reasons.push(...structure.reasons)

    return {
        state,
        direction,
        strength: directionalEvidence.strength,
        ema200,
        structure,
        reasons,
        timestamp: currentCloseTime,
    }
}


/*
|--------------------------------------------------------------------------
| Cross-Timeframe Structure
|--------------------------------------------------------------------------
*/

function buildCrossTimeframeState(
    timeframes: {
        '15m': TimeframeStructureState
        '1h': TimeframeStructureState
        '4h': TimeframeStructureState
        '1d': TimeframeStructureState
    },
    timestamp: number
): CrossTimeframeState {

    const states = [
        timeframes['15m'],
        timeframes['1h'],
        timeframes['4h'],
        timeframes['1d'],
    ]

    let bullishWeight = 0
    let bearishWeight = 0
    let availableWeight = 0

    for (const timeframe of states) {

        const weight = STRUCTURE_WEIGHTS[timeframe.interval]

        if (timeframe.direction === 'BULLISH') {
            bullishWeight += weight * normalizeStrength(timeframe.strength)
            availableWeight += weight
        }

        if (timeframe.direction === 'BEARISH') {
            bearishWeight += weight * normalizeStrength(timeframe.strength)
            availableWeight += weight
        }

        if (timeframe.direction === 'NEUTRAL') {
            availableWeight += weight * 0.5
        }
    }

    const bullish = availableWeight > 0
        ? bullishWeight / availableWeight
        : 0

    const bearish = availableWeight > 0
        ? bearishWeight / availableWeight
        : 0

    const alignment = clamp(
        Math.abs(bullish - bearish) * 100,
        0,
        100
    )

    const conflict = calculateStructureConflict(states)

    let direction: REGIME_DIRECTION = 'NEUTRAL'

    if (bullish > bearish && bullish >= 0.20) {
        direction = 'BULLISH'
    } else if (bearish > bullish && bearish >= 0.20) {
        direction = 'BEARISH'
    }

    const strength = clamp(
        Math.max(bullish, bearish) * 100,
        0,
        100
    )

    const reasons: string[] = []

    reasons.push(
        `Cross-timeframe structure ${direction}`
    )

    reasons.push(
        `Structure alignment ${round(alignment)}`
    )

    reasons.push(
        `Structure conflict ${round(conflict)}`
    )

    for (const timeframe of states) {
        reasons.push(...timeframe.reasons)
    }

    return {
        direction,
        strength,
        timeframes,
        alignment,
        conflict,
        reasons,
        timestamp,
    }
}


function buildTimeframeStructure(
    candles: CandleInfo[],
    interval: MARKET_INTERVAL,
    currentCloseTime: number
): TimeframeStructureState {

    const available = candles
        .filter(c => c.closeTime <= currentCloseTime)
        .slice(-20)

    if (available.length === 0) {
        return {
            interval,
            direction: 'NEUTRAL',
            strength: 0,
            candle: null,
            reasons: [`${interval}: no causal candle available`],
        }
    }

    const current = available[available.length - 1]

    const recent = available.slice(-5)

    let bullish = 0
    let bearish = 0

    for (const candle of recent) {

        const structure = candle.candleStructure

        if (!structure) {
            continue
        }

        const strength = normalizeStrength(structure.strength)

        if (
            structure.direction === 'BULLISH' ||
            structure.isBullish
        ) {
            bullish += strength
        }

        if (
            structure.direction === 'BEARISH' ||
            structure.isBearish
        ) {
            bearish += strength
        }
    }

    const total = bullish + bearish

    let direction: MARKET_DIRECTION = 'NEUTRAL'

    if (total > 0) {

        if (bullish / total >= 0.60) {
            direction = 'BULLISH'
        } else if (bearish / total >= 0.60) {
            direction = 'BEARISH'
        }
    }

    const strength = total > 0
        ? clamp(
            Math.max(bullish, bearish) /
            total *
            100,
            0,
            100
        )
        : 0

    const reasons: string[] = []

    reasons.push(
        `${interval}: ${direction} structure`
    )

    reasons.push(
        `${interval}: structure strength ${round(strength)}`
    )

    if (current) {

        reasons.push(
            `${interval}: close ${formatPrice(current.close)}`
        )

        if (current.candleStructure) {

            if (current.candleStructure.isExpansion) {
                reasons.push(
                    `${interval}: expansion candle`
                )
            }

            if (current.candleStructure.isCompression) {
                reasons.push(
                    `${interval}: compression`
                )
            }

            if (current.candleStructure.isBullishEngulfing) {
                reasons.push(
                    `${interval}: bullish engulfing`
                )
            }

            if (current.candleStructure.isBearishEngulfing) {
                reasons.push(
                    `${interval}: bearish engulfing`
                )
            }
        }
    }

    return {
        interval,
        direction,
        strength,
        candle: current,
        reasons,
    }
}


/*
|--------------------------------------------------------------------------
| EMA200
|--------------------------------------------------------------------------
*/

function buildEma200State(
    candles: CandleInfo[],
    interval: MARKET_INTERVAL,
    currentCloseTime: number
): Ema200State | null {

    const available = candles
        .filter(c =>
            c.closeTime <= currentCloseTime &&
            Number.isFinite(c.close) &&
            Number.isFinite(c.ema200) &&
            c.ema200 > 0
        )

    if (available.length === 0) {
        return null
    }

    const current = available[available.length - 1]

    const previous =
        available.length >= 5
            ? available[available.length - 5]
            : available.length >= 2
                ? available[available.length - 2]
                : null

    const value = current.ema200

    const distance = current.close - value

    const distancePercent =
        value !== 0
            ? distance / value * 100
            : 0

    const atr =
        Number.isFinite(current.atr) && current.atr > 0
            ? current.atr
            : Math.abs(current.high - current.low)

    const distanceAtr =
        atr > 0
            ? distance / atr
            : 0

    let position: Ema200State["position"] = 'AT'

    if (distancePercent > 0.15) {
        position = 'ABOVE'
    } else if (distancePercent < -0.15) {
        position = 'BELOW'
    }

    let slope: Ema200State["slope"] = 'NEUTRAL'

    if (previous) {

        const slopePercent =
            previous.ema200 !== 0
                ? (value - previous.ema200) /
                previous.ema200 *
                100
                : 0

        const threshold = 0.02

        if (position === 'ABOVE') {
            if (slopePercent > threshold) {
                slope = 'ABOVE_RISING'
            } else if (slopePercent < -threshold) {
                slope = 'ABOVE_FALLING'
            } else {
                slope = 'ABOVE_FLAT'
            }
        } else if (position === 'BELOW') {
            if (slopePercent > threshold) {
                slope = 'BELOW_RISING'
            } else if (slopePercent < -threshold) {
                slope = 'BELOW_FALLING'
            } else {
                slope = 'BELOW_FLAT'
            }
        }
    }

    let direction: REGIME_DIRECTION = 'NEUTRAL'

    if (
        position === 'ABOVE' &&
        (
            slope === 'ABOVE_RISING' ||
            slope === 'ABOVE_FLAT'
        )
    ) {
        direction = 'BULLISH'
    }

    if (
        position === 'BELOW' &&
        (
            slope === 'BELOW_FALLING' ||
            slope === 'BELOW_FLAT'
        )
    ) {
        direction = 'BEARISH'
    }

    if (
        position === 'ABOVE' &&
        slope === 'ABOVE_FALLING'
    ) {
        direction = 'NEUTRAL'
    }

    if (
        position === 'BELOW' &&
        slope === 'BELOW_RISING'
    ) {
        direction = 'NEUTRAL'
    }

    const positionalStrength = clamp(
        Math.abs(distanceAtr) * 20,
        0,
        70
    )

    const slopeStrength =
        slope.includes('RISING') ||
        slope.includes('FALLING')
            ? 30
            : 10

    const strength = clamp(
        positionalStrength + slopeStrength,
        0,
        100
    )

    const reasons: string[] = []

    reasons.push(
        `${interval} close ${formatPrice(current.close)} ` +
        `${position.toLowerCase()} EMA200 ${formatPrice(value)}`
    )

    reasons.push(
        `${interval} EMA200 distance ` +
        `${formatPercent(distancePercent)} ` +
        `(${formatNumber(distanceAtr, 2)} ATR)`
    )

    reasons.push(
        `${interval} EMA200 slope ${slope}`
    )

    return {
        value,
        distance,
        distancePercent,
        distanceAtr,
        position,
        slope,
        direction,
        strength,
        reasons,
        timestamp: current.closeTime,
    }
}


function calculateRegimeDirectionalEvidence(
    ema200: MarketRegime["ema200"],
    structure: CrossTimeframeState
): {
    direction: REGIME_DIRECTION
    strength: number
} {

    let bullish = 0
    let bearish = 0

    for (const interval of ['15m', '1h', '4h', '1d'] as MARKET_INTERVAL[]) {

        const ema = ema200[interval]

        if (!ema) {
            continue
        }

        const weight = EMA_WEIGHTS[interval]

        if (ema.direction === 'BULLISH') {
            bullish += weight * normalizeStrength(ema.strength)
        }

        if (ema.direction === 'BEARISH') {
            bearish += weight * normalizeStrength(ema.strength)
        }
    }

    const structureWeight = 0.40

    if (structure.direction === 'BULLISH') {
        bullish += structureWeight *
            normalizeStrength(structure.strength)
    }

    if (structure.direction === 'BEARISH') {
        bearish += structureWeight *
            normalizeStrength(structure.strength)
    }

    const total = bullish + bearish

    if (total <= 0) {
        return {
            direction: 'NEUTRAL',
            strength: 0,
        }
    }

    const edge =
        Math.abs(bullish - bearish) /
        total

    let direction: REGIME_DIRECTION = 'NEUTRAL'

    if (bullish > bearish && edge >= 0.12) {
        direction = 'BULLISH'
    }

    if (bearish > bullish && edge >= 0.12) {
        direction = 'BEARISH'
    }

    return {
        direction,
        strength: clamp(
            Math.max(bullish, bearish) /
            Math.max(total, 1) *
            100,
            0,
            100
        ),
    }
}


/*
|--------------------------------------------------------------------------
| Main Market Regime
|--------------------------------------------------------------------------
*/

function buildMainMarketRegime(
    mainMarkets: SymbolInfo[],
    currentCloseTime: number
): MainMarketRegime {

    const btc = findMarket(mainMarkets, 'BTCUSDT')
    const eth = findMarket(mainMarkets, 'ETHUSDT')
    const sol = findMarket(mainMarkets, 'SOLUSDT')

    const btcRegime = btc
        ? buildSymbolRegime(btc, currentCloseTime)
        : null

    const ethRegime = eth
        ? buildSymbolRegime(eth, currentCloseTime)
        : null

    const solRegime = sol
        ? buildSymbolRegime(sol, currentCloseTime)
        : null

    const regimes = [
        {
            name: 'BTC',
            regime: btcRegime,
            weight: MAIN_MARKET_WEIGHTS.btc,
        },
        {
            name: 'ETH',
            regime: ethRegime,
            weight: MAIN_MARKET_WEIGHTS.eth,
        },
        {
            name: 'SOL',
            regime: solRegime,
            weight: MAIN_MARKET_WEIGHTS.sol,
        },
    ]

    let bullish = 0
    let bearish = 0
    let totalWeight = 0

    for (const item of regimes) {

        if (!item.regime) {
            continue
        }

        totalWeight += item.weight

        if (item.regime.direction === 'BULLISH') {
            bullish +=
                item.weight *
                normalizeStrength(item.regime.strength)
        }

        if (item.regime.direction === 'BEARISH') {
            bearish +=
                item.weight *
                normalizeStrength(item.regime.strength)
        }
    }

    let direction: REGIME_DIRECTION = 'NEUTRAL'

    if (totalWeight > 0) {

        const edge =
            Math.abs(bullish - bearish) /
            totalWeight

        if (bullish > bearish && edge >= 0.12) {
            direction = 'BULLISH'
        }

        if (bearish > bullish && edge >= 0.12) {
            direction = 'BEARISH'
        }
    }

    const strength = totalWeight > 0
        ? clamp(
            Math.max(bullish, bearish) /
            totalWeight *
            100,
            0,
            100
        )
        : 0

    const activeDirections = regimes
        .filter(x => x.regime !== null)
        .map(x => x.regime!.direction)

    const bullishCount =
        activeDirections.filter(x => x === 'BULLISH').length

    const bearishCount =
        activeDirections.filter(x => x === 'BEARISH').length

    const availableMarkets = activeDirections.length

    const consensus =
        availableMarkets > 0
            ? Math.max(
                bullishCount,
                bearishCount
            ) /
            availableMarkets *
            100
            : 0

    const divergence =
        availableMarkets > 0
            ? Math.min(
                bullishCount,
                bearishCount
            ) /
            availableMarkets *
            100
            : 0

    const reasons: string[] = []

    reasons.push(
        `Main market direction ${direction}`
    )

    reasons.push(
        `BTC/ETH/SOL consensus ${round(consensus)}`
    )

    reasons.push(
        `Main market divergence ${round(divergence)}`
    )

    for (const item of regimes) {

        if (item.regime) {
            reasons.push(
                `${item.name}: ` +
                `${item.regime.direction} ` +
                `strength ${round(item.regime.strength)}`
            )
        }
    }

    return {
        direction,
        strength,
        btc: btcRegime,
        eth: ethRegime,
        sol: solRegime,
        consensus,
        divergence,
        reasons,
        timestamp: currentCloseTime,
    }
}


function buildSymbolRegime(
    symbol: SymbolInfo,
    currentCloseTime: number
): MarketRegime {

    const candles15m = symbol.candle_15m || []

    return buildMarketRegime(
        candles15m,
        currentCloseTime
    )
}


/*
|--------------------------------------------------------------------------
| Location
|--------------------------------------------------------------------------
*/

function buildLocationState(
    candles: CandleInfo[],
    current: CandleInfo
): LocationState {

    const price = current.close

    let avwap: number | null = null
    let frvp: number | null = null
    let liquidityHeatmap: number | null = null

    /*
     * Anchor analysis is intentionally not dereferenced here because
     * PriceZone, VolumeProfile and LiquidationHeatmapResult are external
     * interfaces whose internal fields are not part of interfacesv2.ts.
     *
     * Location therefore uses causal price structure when those values
     * are unavailable.
     */

    const recent = candles.slice(-30)

    const support = findNearestSupport(
        recent,
        price
    )

    const resistance = findNearestResistance(
        recent,
        price
    )

    let location: LocationState["location"] = 'NEUTRAL'
    let direction: REGIME_DIRECTION = 'NEUTRAL'
    let strength = 0

    const atr =
        current.atr > 0
            ? current.atr
            : Math.abs(current.high - current.low)

    if (support !== null && atr > 0) {

        const distance = Math.abs(price - support)

        if (distance <= atr * 0.50) {

            location = 'SUPPORT'
            direction = 'BULLISH'

            strength = clamp(
                100 -
                distance /
                (atr * 0.50) *
                100,
                0,
                100
            )
        }
    }

    if (resistance !== null && atr > 0) {

        const distance = Math.abs(
            resistance - price
        )

        if (distance <= atr * 0.50) {

            location = 'RESISTANCE'
            direction = 'BEARISH'

            strength = clamp(
                100 -
                distance /
                (atr * 0.50) *
                100,
                0,
                100
            )
        }
    }

    if (
        location === 'NEUTRAL' &&
        current.ema200 > 0
    ) {

        const distancePercent =
            (price - current.ema200) /
            current.ema200 *
            100

        if (Math.abs(distancePercent) <= 0.50) {

            location = 'VALUE'
            direction = 'NEUTRAL'

            strength = 30

        } else if (price > current.ema200) {

            location = 'ABOVE_VALUE'
            direction = 'BULLISH'

            strength = clamp(
                Math.abs(distancePercent) * 10,
                0,
                60
            )

        } else {

            location = 'BELOW_VALUE'
            direction = 'BEARISH'

            strength = clamp(
                Math.abs(distancePercent) * 10,
                0,
                60
            )
        }
    }

    if (location === 'NEUTRAL') {

        location = 'MID_RANGE'
        strength = 20
    }

    const reasons: string[] = []

    reasons.push(
        `Price location ${location}`
    )

    if (support !== null) {

        reasons.push(
            `Nearest causal support ${formatPrice(support)} ` +
            `(${formatDistancePercent(price, support)})`
        )
    }

    if (resistance !== null) {

        reasons.push(
            `Nearest causal resistance ${formatPrice(resistance)} ` +
            `(${formatDistancePercent(price, resistance)})`
        )
    }

    return {
        location,
        direction,
        strength,
        price,
        avwap,
        frvp,
        liquidityHeatmap,
        reasons,
        timestamp: current.closeTime,
    }
}


/*
|--------------------------------------------------------------------------
| Entry Evidence
|--------------------------------------------------------------------------
*/

function buildEntryEvidence(
    candles: CandleInfo[],
    current: CandleInfo
): EntryEvidence {

    const structure = current.candleStructure
    const priceAction = current.priceAction
    const volumeState = current.volumeState
    const oi = current.openInterest
    const ls = current.longShort

    let long = 0
    let short = 0

    const reasons: string[] = []

    /*
     * Candle structure
     */

    let candleStructureScore = 0

    if (structure) {

        const strength =
            normalizeStrength(structure.strength)

        if (structure.isBullish) {
            candleStructureScore +=
                30 * strength
        }

        if (structure.isBearish) {
            candleStructureScore -=
                30 * strength
        }

        if (structure.isBullishEngulfing) {
            candleStructureScore += 20
        }

        if (structure.isBearishEngulfing) {
            candleStructureScore -= 20
        }

        if (structure.isExpansion) {

            if (structure.isBullish) {
                candleStructureScore += 10
            }

            if (structure.isBearish) {
                candleStructureScore -= 10
            }
        }
    }

    long += Math.max(candleStructureScore, 0)
    short += Math.max(-candleStructureScore, 0)

    /*
     * Price action
     */

    let priceActionScore = 0

    if (priceAction) {

        priceActionScore +=
            safeDirectionalScore(
                priceAction.long,
                priceAction.short
            )

        if (
            priceAction.sequence &&
            priceAction.sequence.direction === 'LONG'
        ) {
            priceActionScore +=
                priceAction.sequence.completion * 0.20
        }

        if (
            priceAction.sequence &&
            priceAction.sequence.direction === 'SHORT'
        ) {
            priceActionScore -=
                priceAction.sequence.completion * 0.20
        }
    }

    priceActionScore = clamp(
        priceActionScore,
        -100,
        100
    )

    long += Math.max(priceActionScore, 0) * 0.50
    short += Math.max(-priceActionScore, 0) * 0.50

    /*
     * Volume
     *
     * Volume confirms direction but does not invent it.
     */

    let volumeScore = 0

    if (
        volumeState &&
        structure
    ) {

        const volumeStrength =
            normalizeStrength(volumeState.strength)

        if (
            volumeState.state === 'EXPANDING' &&
            structure.isBullish
        ) {
            volumeScore =
                25 * volumeStrength
        }

        if (
            volumeState.state === 'EXPANDING' &&
            structure.isBearish
        ) {
            volumeScore =
                -25 * volumeStrength
        }
    }

    long += Math.max(volumeScore, 0)
    short += Math.max(-volumeScore, 0)

    /*
     * Open Interest
     *
     * Price + OI interaction.
     */

    let oiScore = 0

    if (oi) {

        const oiStrength =
            normalizeStrength(oi.strength)

        const priceChange =
            getRecentPriceChange(candles)

        const priceUp = priceChange > 0
        const priceDown = priceChange < 0

        if (
            oi.state === 'RISING' ||
            oi.state === 'EXPANDING'
        ) {

            if (priceUp) {
                oiScore =
                    30 * oiStrength
            }

            if (priceDown) {
                oiScore =
                    -30 * oiStrength
            }
        }

        /*
         * Falling OI represents position reduction.
         * It should not be treated as equally strong directional
         * confirmation.
         */

        if (
            oi.state === 'FALLING' ||
            oi.state === 'CONTRACTING'
        ) {

            if (priceUp) {
                oiScore = 10 * oiStrength
            }

            if (priceDown) {
                oiScore = -10 * oiStrength
            }
        }
    }

    long += Math.max(oiScore, 0)
    short += Math.max(-oiScore, 0)

    /*
     * Long/Short ratio
     *
     * Positioning context only.
     * It receives the lowest directional influence.
     */

    let lsScore = 0

    if (ls) {

        const lsStrength =
            normalizeStrength(ls.strength)

        if (
            ls.state === 'LONG_INCREASING' &&
            ls.ratioChange > 0
        ) {
            lsScore =
                15 * lsStrength
        }

        if (
            ls.state === 'SHORT_INCREASING' &&
            ls.ratioChange < 0
        ) {
            lsScore =
                -15 * lsStrength
        }

        /*
         * Dominance alone is not used as a directional signal.
         */
    }

    long += Math.max(lsScore, 0)
    short += Math.max(-lsScore, 0)

    long = clamp(long, 0, 100)
    short = clamp(short, 0, 100)

    const edge = Math.abs(long - short)

    let dominant: SIGNAL_DIRECTION = 'NEUTRAL'

    if (
        long > short &&
        edge >= MIN_DIRECTION_EDGE
    ) {
        dominant = 'LONG'
    }

    if (
        short > long &&
        edge >= MIN_DIRECTION_EDGE
    ) {
        dominant = 'SHORT'
    }

    const strength = clamp(
        Math.max(long, short),
        0,
        100
    )

    if (structure) {

        reasons.push(
            `15m candle structure ` +
            `${structure.direction}, strength ` +
            `${round(structure.strength)}`
        )
    }

    if (priceAction) {

        reasons.push(
            `15m price action ${priceAction.dominant}`
        )
    }

    if (volumeState) {

        reasons.push(
            `15m volume ${volumeState.state}, ` +
            `relative ${formatNumber(volumeState.relativeVolume, 2)}x`
        )
    }

    if (oi) {

        reasons.push(
            `15m OI ${oi.state}, ` +
            `${formatPercent(oi.valueChangePercent)}`
        )
    }

    if (ls) {

        reasons.push(
            `15m long/short ratio ${formatNumber(ls.ratio, 2)}`
        )
    }

    reasons.push(
        `Entry evidence LONG ${round(long)} / SHORT ${round(short)}`
    )

    reasons.push(
        `Entry directional edge ${round(edge)}`
    )

    return {
        long,
        short,
        dominant,
        strength,
        candleStructure: clamp(
            Math.abs(candleStructureScore),
            0,
            100
        ),
        priceAction: clamp(
            Math.abs(priceActionScore),
            0,
            100
        ),
        volume: clamp(
            Math.abs(volumeScore),
            0,
            100
        ),
        openInterest: clamp(
            Math.abs(oiScore),
            0,
            100
        ),
        longShort: clamp(
            Math.abs(lsScore),
            0,
            100
        ),
        reasons,
        timestamp: current.closeTime,
    }
}


/*
|--------------------------------------------------------------------------
| Contradiction
|--------------------------------------------------------------------------
*/

function calculateContradiction(
    regime: MarketRegime,
    mainMarket: MainMarketRegime,
    crossTimeframe: CrossTimeframeState,
    entry: EntryEvidence
): number {

    let contradiction = 0

    /*
     * Strong HTF vs 15m conflict.
     */

    if (
        regime.direction === 'BULLISH' &&
        entry.dominant === 'SHORT'
    ) {

        contradiction +=
            30 *
            normalizeStrength(regime.strength)
    }

    if (
        regime.direction === 'BEARISH' &&
        entry.dominant === 'LONG'
    ) {

        contradiction +=
            30 *
            normalizeStrength(regime.strength)
    }

    /*
     * Main market conflict.
     */

    if (
        mainMarket.direction === 'BULLISH' &&
        entry.dominant === 'SHORT'
    ) {

        contradiction +=
            25 *
            normalizeStrength(mainMarket.strength)
    }

    if (
        mainMarket.direction === 'BEARISH' &&
        entry.dominant === 'LONG'
    ) {

        contradiction +=
            25 *
            normalizeStrength(mainMarket.strength)
    }

    /*
     * Cross timeframe conflict.
     */

    if (crossTimeframe.conflict > 0) {

        contradiction +=
            crossTimeframe.conflict * 0.25
    }

    /*
     * Transition regime is inherently less reliable.
     */

    if (regime.state === 'TRANSITION') {
        contradiction += 10
    }

    return clamp(
        contradiction,
        0,
        100
    )
}


/*
|--------------------------------------------------------------------------
| Final Direction
|--------------------------------------------------------------------------
*/

function determineFinalDirection(
    regime: MarketRegime,
    mainMarket: MainMarketRegime,
    location: LocationState,
    entry: EntryEvidence,
    contradiction: number
): SIGNAL_DIRECTION {

    let long = entry.long
    let short = entry.short

    /*
     * Regime is context, not a direct vote.
     */

    if (regime.direction === 'BULLISH') {

        long +=
            20 *
            normalizeStrength(regime.strength)

    } else if (regime.direction === 'BEARISH') {

        short +=
            20 *
            normalizeStrength(regime.strength)
    }

    /*
     * Main market is confirmation.
     */

    if (mainMarket.direction === 'BULLISH') {

        long +=
            12 *
            normalizeStrength(mainMarket.strength)

    } else if (mainMarket.direction === 'BEARISH') {

        short +=
            12 *
            normalizeStrength(mainMarket.strength)
    }

    /*
     * Location.
     */

    if (location.direction === 'BULLISH') {

        long +=
            10 *
            normalizeStrength(location.strength)

    } else if (location.direction === 'BEARISH') {

        short +=
            10 *
            normalizeStrength(location.strength)
    }

    /*
     * Contradiction removes directional confidence.
     */

    if (entry.dominant === 'LONG') {
        long -= contradiction * 0.50
    }

    if (entry.dominant === 'SHORT') {
        short -= contradiction * 0.50
    }

    long = Math.max(0, long)
    short = Math.max(0, short)

    const edge = Math.abs(long - short)

    /*
     * Critical:
     *
     * Never choose LONG simply because LONG >= SHORT.
     *
     * There must be a meaningful edge.
     */

    if (edge < MIN_DIRECTION_EDGE) {
        return 'NEUTRAL'
    }

    if (
        long > short &&
        long >= 35
    ) {
        return 'LONG'
    }

    if (
        short > long &&
        short >= 35
    ) {
        return 'SHORT'
    }

    return 'NEUTRAL'
}


/*
|--------------------------------------------------------------------------
| Final Score
|--------------------------------------------------------------------------
*/

function calculateFinalScore(
    regime: MarketRegime,
    mainMarket: MainMarketRegime,
    location: LocationState,
    entry: EntryEvidence,
    contradiction: number,
    direction: SIGNAL_DIRECTION
): number {

    const regimeScore =
        directionalScore(
            regime.direction,
            direction
        ) *
        normalizeStrength(regime.strength) *
        0.35

    const mainMarketScore =
        directionalScore(
            mainMarket.direction,
            direction
        ) *
        normalizeStrength(mainMarket.strength) *
        0.15

    const locationScore =
        directionalScore(
            location.direction,
            direction
        ) *
        normalizeStrength(location.strength) *
        0.15

    const entryScore =
        entryDirectionScore(
            entry,
            direction
        ) *
        0.35

    const raw =
        regimeScore +
        mainMarketScore +
        locationScore +
        entryScore

    const contradictionPenalty =
        contradiction * 0.25

    const score = raw - contradictionPenalty

    return clamp(
        score,
        0,
        100
    )
}


function calculateConfidence(
    score: number,
    contradiction: number,
    entryStrength: number,
    regimeStrength: number,
    mainMarketStrength: number
): number {

    const agreement =
        (
            normalizeStrength(entryStrength) +
            normalizeStrength(regimeStrength) +
            normalizeStrength(mainMarketStrength)
        ) / 3

    const confidence =
        score * 0.50 +
        agreement * 0.35 -
        contradiction * 0.35

    return clamp(
        confidence,
        0,
        100
    )
}


/*
|--------------------------------------------------------------------------
| Trade Recommendation
|--------------------------------------------------------------------------
*/

function buildTradeRecommendation(
    direction: SIGNAL_DIRECTION,
    current: CandleInfo,
    movingCandles: CandleInfo[],
    targetSymbol: SymbolInfo,
    confidence: number
): TradeRecommendation {

    const entryPrice = current.close

    const atr =
        current.atr > 0
            ? current.atr
            : Math.max(
                current.high - current.low,
                entryPrice * 0.001
            )

    const entry = createTradeLevel(
        'ENTRY',
        entryPrice,
        entryPrice,
        atr,
        '15m',
        100,
        'AT',
        [
            `Entry is current 15m candle close ${formatPrice(entryPrice)}`
        ],
        current.openTime,
        current.closeTime
    )

    if (
        direction === 'NEUTRAL' ||
        confidence < MIN_TRADE_CONFIDENCE
    ) {

        return {
            direction,
            entry,
            stopLoss: null,
            takeProfit: null,
            riskReward: null,
            stopLossDistance: null,
            stopLossPercent: null,
            takeProfitDistance: null,
            takeProfitPercent: null,
            reasons: [
                `No trade recommendation: direction ${direction}`,
                `Confidence ${round(confidence)} below trade threshold ${MIN_TRADE_CONFIDENCE}`
            ],
        }
    }

    const stopLoss = buildStructuralStopLoss(
        direction,
        current,
        movingCandles
    )

    if (!stopLoss) {

        return {
            direction,
            entry,
            stopLoss: null,
            takeProfit: null,
            riskReward: null,
            stopLossDistance: null,
            stopLossPercent: null,
            takeProfitDistance: null,
            takeProfitPercent: null,
            reasons: [
                `Trade direction ${direction}`,
                `No valid causal structural stop loss found`
            ],
        }
    }

    const takeProfit = buildStructuralTakeProfit(
        direction,
        current,
        movingCandles,
        stopLoss
    )

    if (!takeProfit) {

        return {
            direction,
            entry,
            stopLoss,
            takeProfit: null,
            riskReward: null,
            stopLossDistance: stopLoss.distance,
            stopLossPercent: stopLoss.distancePercent,
            takeProfitDistance: null,
            takeProfitPercent: null,
            reasons: [
                `Trade direction ${direction}`,
                `Stop loss ${formatPrice(stopLoss.price)}`,
                `No causal HTF structural target provides minimum RR ${MIN_RISK_REWARD}`
            ],
        }
    }

    const risk =
        Math.abs(
            entryPrice -
            stopLoss.price
        )

    const reward =
        Math.abs(
            takeProfit.price -
            entryPrice
        )

    const riskReward =
        risk > 0
            ? reward / risk
            : null

    return {
        direction,
        entry,
        stopLoss,
        takeProfit,
        riskReward,

        stopLossDistance: risk,
        stopLossPercent:
            entryPrice > 0
                ? risk / entryPrice * 100
                : null,

        takeProfitDistance: reward,
        takeProfitPercent:
            entryPrice > 0
                ? reward / entryPrice * 100
                : null,

        reasons: [
            `Trade direction ${direction}`,
            `Entry ${formatPrice(entryPrice)}`,
            `Stop ${formatPrice(stopLoss.price)}`,
            `Target ${formatPrice(takeProfit.price)}`,
            `Risk/reward ${riskReward !== null ? formatNumber(riskReward, 2) : 'N/A'}`
        ],
    }
}


/*
|--------------------------------------------------------------------------
| Structural Stop Loss
|--------------------------------------------------------------------------
*/

function buildStructuralStopLoss(
    direction: SIGNAL_DIRECTION,
    current: CandleInfo,
    candles15m: CandleInfo[]
): TradeLevel | null {

    const entry = current.close

    const atr =
        current.atr > 0
            ? current.atr
            : Math.max(
                current.high - current.low,
                entry * 0.001
            )

    const pivots = findCausalPivots(
        candles15m,
        current.closeTime
    )

    if (direction === 'LONG') {

        const supports = pivots
            .filter(p =>
                p.type === 'SWING_LOW' &&
                p.price < entry
            )
            .sort(
                (a, b) =>
                    b.price - a.price
            )

        const support = supports[0]

        if (support) {

            const price =
                support.price -
                atr * STOP_BUFFER_ATR

            const distance =
                Math.abs(entry - price)

            return createTradeLevel(
                'STOP_LOSS',
                price,
                entry,
                atr,
                support.interval,
                support.strength,
                'BEHIND',
                [
                    `15m structural stop below swing low ${formatPrice(support.price)}`,
                    `ATR safety buffer ${formatNumber(STOP_BUFFER_ATR, 2)} ATR`
                ],
                support.sourceOpenTime,
                current.closeTime
            )
        }
    }

    if (direction === 'SHORT') {

        const resistances = pivots
            .filter(p =>
                p.type === 'SWING_HIGH' &&
                p.price > entry
            )
            .sort(
                (a, b) =>
                    a.price - b.price
            )

        const resistance = resistances[0]

        if (resistance) {

            const price =
                resistance.price +
                atr * STOP_BUFFER_ATR

            return createTradeLevel(
                'STOP_LOSS',
                price,
                entry,
                atr,
                resistance.interval,
                resistance.strength,
                'BEHIND',
                [
                    `15m structural stop above swing high ${formatPrice(resistance.price)}`,
                    `ATR safety buffer ${formatNumber(STOP_BUFFER_ATR, 2)} ATR`
                ],
                resistance.sourceOpenTime,
                current.closeTime
            )
        }
    }

    return null
}


/*
|--------------------------------------------------------------------------
| Structural Take Profit
|--------------------------------------------------------------------------
*/

function buildStructuralTakeProfit(
    direction: SIGNAL_DIRECTION,
    current: CandleInfo,
    candles15m: CandleInfo[],
    stopLoss: TradeLevel
): TradeLevel | null {

    const entry = current.close

    const atr =
        current.atr > 0
            ? current.atr
            : Math.max(
                current.high - current.low,
                entry * 0.001
            )

    const risk =
        Math.abs(
            entry -
            stopLoss.price
        )

    if (risk <= 0) {
        return null
    }

    const pivots = findCausalPivots(
        candles15m,
        current.closeTime
    )

    const candidates = pivots
        .filter(p => {

            if (direction === 'LONG') {
                return (
                    p.price > entry &&
                    (
                        p.type === 'SWING_HIGH' ||
                        p.type === 'RESISTANCE'
                    )
                )
            }

            if (direction === 'SHORT') {
                return (
                    p.price < entry &&
                    (
                        p.type === 'SWING_LOW' ||
                        p.type === 'SUPPORT'
                    )
                )
            }

            return false
        })

    /*
     * Deduplicate nearby levels.
     */

    const deduplicated =
        deduplicateLevels(
            candidates,
            atr
        )

    /*
     * Sort from nearest to farthest.
     */

    deduplicated.sort(
        (a, b) => {

            const distanceA =
                Math.abs(a.price - entry)

            const distanceB =
                Math.abs(b.price - entry)

            return distanceA - distanceB
        }
    )

    /*
     * Prefer the nearest structural level that
     * still provides acceptable RR.
     */

    for (const candidate of deduplicated) {

        const reward =
            Math.abs(
                candidate.price -
                entry
            )

        const rr =
            reward / risk

        if (rr >= MIN_RISK_REWARD) {

            return createTradeLevel(
                'TAKE_PROFIT',
                candidate.price,
                entry,
                atr,
                candidate.interval,
                candidate.strength,
                'AHEAD',
                [
                    `${candidate.interval} structural ${candidate.type.toLowerCase()} ` +
                    `at ${formatPrice(candidate.price)}`,
                    `Distance ${formatDistancePercent(entry, candidate.price)}`,
                    `Distance ${formatNumber(reward / atr, 2)} ATR`,
                    `Risk/reward ${formatNumber(rr, 2)}`
                ],
                candidate.sourceOpenTime,
                current.closeTime
            )
        }
    }

    /*
     * No arbitrary ATR TP.
     *
     * If structure does not provide a worthwhile target,
     * return null.
     */

    return null
}


/*
|--------------------------------------------------------------------------
| Structural Pivots
|--------------------------------------------------------------------------
*/

interface InternalTradePivot {
    type:
        | 'SWING_HIGH'
        | 'SWING_LOW'
        | 'RESISTANCE'
        | 'SUPPORT'

    price: number

    interval: MARKET_INTERVAL

    strength: number

    sourceOpenTime: number
}


function findCausalPivots(
    candles: CandleInfo[],
    currentCloseTime: number
): InternalTradePivot[] {

    const result: InternalTradePivot[] = []

    const intervals: {
        interval: MARKET_INTERVAL
        candles: CandleInfo[]
    }[] = [
        {
            interval: '15m',
            candles: getTimeframeCandles(
                candles,
                '15m'
            ),
        },
        {
            interval: '1h',
            candles: getTimeframeCandles(
                candles,
                '1h'
            ),
        },
        {
            interval: '4h',
            candles: getTimeframeCandles(
                candles,
                '4h'
            ),
        },
        {
            interval: '1d',
            candles: getTimeframeCandles(
                candles,
                '1d'
            ),
        },
    ]

    for (const item of intervals) {

        const available =
            item.candles
                .filter(
                    c =>
                        c.closeTime <=
                        currentCloseTime
                )
                .slice(-PIVOT_LOOKBACK)

        /*
         * We intentionally require a candle on both sides
         * of the pivot and therefore only use pivots whose
         * right-hand confirmation candle has already closed.
         */

        for (
            let i = 1;
            i < available.length - 1;
            i++
        ) {

            const left = available[i - 1]
            const pivot = available[i]
            const right = available[i + 1]

            if (
                pivot.high > left.high &&
                pivot.high >= right.high
            ) {

                const strength =
                    calculatePivotStrength(
                        pivot,
                        item.interval
                    )

                result.push({
                    type: 'SWING_HIGH',
                    price: pivot.high,
                    interval: item.interval,
                    strength,
                    sourceOpenTime: pivot.openTime,
                })
            }

            if (
                pivot.low < left.low &&
                pivot.low <= right.low
            ) {

                const strength =
                    calculatePivotStrength(
                        pivot,
                        item.interval
                    )

                result.push({
                    type: 'SWING_LOW',
                    price: pivot.low,
                    interval: item.interval,
                    strength,
                    sourceOpenTime: pivot.openTime,
                })
            }
        }
    }

    return result
}


function calculatePivotStrength(
    candle: CandleInfo,
    interval: MARKET_INTERVAL
): number {

    const intervalWeight: Record<
        MARKET_INTERVAL,
        number
    > = {
        '15m': 35,
        '1h': 55,
        '4h': 75,
        '1d': 90,
    }

    const structureStrength =
        candle.candleStructure
            ? normalizeStrength(
                candle.candleStructure.strength
            )
            : 0

    return clamp(
        intervalWeight[interval] * 0.70 +
        structureStrength * 0.30,
        0,
        100
    )
}


/*
|--------------------------------------------------------------------------
| Trade Level
|--------------------------------------------------------------------------
*/

function createTradeLevel(
    type: TradeLevel["type"],
    price: number,
    entry: number,
    atr: number,
    interval: MARKET_INTERVAL | null,
    strength: number,
    relativePosition: TradeLevel["relativePosition"],
    reasons: string[],
    sourceOpenTime: number | null,
    timestamp: number
): TradeLevel {

    const distance =
        Math.abs(price - entry)

    const distancePercent =
        entry !== 0
            ? distance / entry * 100
            : 0

    const distanceAtr =
        atr > 0
            ? distance / atr
            : 0

    return {
        type,
        price,

        interval,

        distance,
        distancePercent,
        distanceAtr,

        strength,

        valid:
            Number.isFinite(price) &&
            price > 0,

        relativePosition,

        reasons,

        sourceOpenTime,

        timestamp,
    }
}


/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function getTimeframeCandles(
    candles: CandleInfo[],
    interval: MARKET_INTERVAL
): CandleInfo[] {

    if (interval === '15m') {
        return candles
    }

    const duration: Record<
        MARKET_INTERVAL,
        number
    > = {
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
    }

    /*
     * The supplied movingCandles are 15m candles.
     *
     * Build completed HTF candles from the available
     * lower timeframe candles.
     *
     * This function does NOT use future candles.
     */

    const bucketMap =
        new Map<number, CandleInfo[]>()

    for (const candle of candles) {

        const bucket =
            Math.floor(
                candle.openTime /
                duration[interval]
            ) *
            duration[interval]

        const list =
            bucketMap.get(bucket) || []

        list.push(candle)

        bucketMap.set(
            bucket,
            list
        )
    }

    const result: CandleInfo[] = []

    for (
        const [bucket, group]
        of bucketMap.entries()
    ) {

        if (group.length === 0) {
            continue
        }

        const sorted =
            [...group].sort(
                (a, b) =>
                    a.openTime -
                    b.openTime
            )

        const open =
            sorted[0].open

        const close =
            sorted[sorted.length - 1].close

        const high =
            Math.max(
                ...sorted.map(c => c.high)
            )

        const low =
            Math.min(
                ...sorted.map(c => c.low)
            )

        const volume =
            sorted.reduce(
                (sum, c) =>
                    sum + c.volume,
                0
            )

        /*
         * Only treat a synthesized HTF candle as complete
         * when the full interval exists.
         *
         * For 1h = 4 x 15m
         * 4h = 16 x 15m
         * 1d = 96 x 15m
         */

        const expectedCount =
            interval === '1h'
                ? 4
                : interval === '4h'
                    ? 16
                    : 96

        if (sorted.length < expectedCount) {
            continue
        }

        const closeTime =
            bucket +
            duration[interval] -
            1

        result.push({
            open,
            close,
            high,
            low,
            volume,
            openTime: bucket,
            closeTime,

            /*
             * HTF derived EMA/ATR are calculated from the
             * available completed HTF candles below.
             */

            atr: calculateSimpleAtr(
                result,
                high,
                low,
                close
            ),

            ema200:
                calculateEmaFromValues(
                    [
                        ...result.map(c => c.close),
                        close
                    ],
                    200
                ),

            candleStructure:
                buildBasicCandleStructure(
                    open,
                    high,
                    low,
                    close,
                    calculateSimpleAtr(
                        result,
                        high,
                        low,
                        close
                    )
                ),

            anchors: createEmptyAnchorState(),

            priceAction: createEmptyPriceAction(),

            openInterest:
                createEmptyOpenInterestState(
                    closeTime
                ),

            longShort:
                createEmptyLongShortState(
                    closeTime
                ),

            volumeState:
                createEmptyVolumeState(
                    volume,
                    closeTime
                ),

            marketAlignment:
                createEmptyMarketAlignment(
                    closeTime
                ),
        })
    }

    return result.sort(
        (a, b) =>
            a.openTime -
            b.openTime
    )
}


/*
|--------------------------------------------------------------------------
| Causal support / resistance
|--------------------------------------------------------------------------
*/

function findNearestSupport(
    candles: CandleInfo[],
    price: number
): number | null {

    let nearest: number | null = null

    for (const candle of candles) {

        if (candle.low < price) {

            if (
                nearest === null ||
                candle.low > nearest
            ) {
                nearest = candle.low
            }
        }
    }

    return nearest
}


function findNearestResistance(
    candles: CandleInfo[],
    price: number
): number | null {

    let nearest: number | null = null

    for (const candle of candles) {

        if (candle.high > price) {

            if (
                nearest === null ||
                candle.high < nearest
            ) {
                nearest = candle.high
            }
        }
    }

    return nearest
}


function deduplicateLevels(
    levels: InternalTradePivot[],
    atr: number
): InternalTradePivot[] {

    const result: InternalTradePivot[] = []

    const threshold =
        atr * LEVEL_DEDUP_ATR

    const sorted =
        [...levels].sort(
            (a, b) =>
                a.price -
                b.price
        )

    for (const level of sorted) {

        const duplicate =
            result.some(
                existing =>
                    Math.abs(
                        existing.price -
                        level.price
                    ) <= threshold
            )

        if (!duplicate) {
            result.push(level)
        } else {

            const existing =
                result.find(
                    x =>
                        Math.abs(
                            x.price -
                            level.price
                        ) <= threshold
                )

            if (
                existing &&
                level.strength >
                existing.strength
            ) {
                Object.assign(
                    existing,
                    level
                )
            }
        }
    }

    return result
}


/*
|--------------------------------------------------------------------------
| Main Market Lookup
|--------------------------------------------------------------------------
*/

function findMarket(
    markets: SymbolInfo[],
    symbol: string
): SymbolInfo | null {

    return (
        markets.find(
            market =>
                market.name.toUpperCase() ===
                symbol.toUpperCase()
        ) ||
        null
    )
}


/*
|--------------------------------------------------------------------------
| Empty State Helpers
|--------------------------------------------------------------------------
|
| These are only used for synthesized HTF candles.
| They ensure the strict CandleInfo interface remains satisfied.
|
*/

function createEmptyAnchorState() {
    return {
        candidates: [],
        active: {
            avwap: null,
            frvp: null,
            liquidityHeatmap: null,
        },
    }
}


function createEmptyPriceAction() {
    const event = {
        detected: false,
        direction: 'NEUTRAL' as SIGNAL_DIRECTION,
        strength: 0,
        reasons: [],
    }

    const reclaim = {
        ...event,
        level: 0,
        penetration: 0,
        closeDistance: 0,
    }

    const breakout = {
        ...event,
        level: 0,
        volumeConfirmation: 0,
        displacementConfirmation: 0,
    }

    return {
        displacement: event,
        rejection: event,
        reclaim,
        breakout,
        failedBreakout: breakout,
        liquiditySweep: event,

        sequence: {
            liquiditySweep: false,
            rejection: false,
            reclaim: false,
            displacement: false,
            closeConfirmation: false,
            completion: 0,
            direction: 'NEUTRAL' as SIGNAL_DIRECTION,
        },

        long: 0,
        short: 0,

        dominant: 'NEUTRAL' as SIGNAL_DIRECTION,

        strength: 0,

        reasons: [],
    }
}


function createEmptyOpenInterestState(
    timestamp: number
) {
    return {
        value: 0,
        valueChange: 0,
        valueChangePercent: 0,
        direction: 'NEUTRAL' as MARKET_DIRECTION,
        state: 'NEUTRAL' as const,
        strength: 0,
        timestamp,
        reasons: [],
    }
}


function createEmptyLongShortState(
    timestamp: number
) {
    return {
        ratio: 0,
        longAccount: 0,
        shortAccount: 0,
        ratioChange: 0,
        ratioChangePercent: 0,
        direction: 'NEUTRAL' as MARKET_DIRECTION,
        state: 'NEUTRAL' as const,
        strength: 0,
        timestamp,
        reasons: [],
    }
}


function createEmptyVolumeState(
    value: number,
    timestamp: number
) {
    return {
        value,
        averageVolume: 0,
        relativeVolume: 0,
        volumeChange: 0,
        volumeChangePercent: 0,
        state: 'NEUTRAL' as const,
        strength: 0,
        timestamp,
        reasons: [],
    }
}


function createEmptyMarketAlignment(
    timestamp: number
) {

    const component = {
        score: 0,
        direction: 'NEUTRAL' as SIGNAL_DIRECTION,
        aligned: false,
        reasons: [],
    }

    return {
        state: 'NEUTRAL' as const,
        direction: 'NEUTRAL' as SIGNAL_DIRECTION,
        strength: 0,

        btc: component,
        eth: component,
        sol: component,

        marketConsensus: 0,
        alignmentScore: 0,
        divergenceScore: 0,

        reasons: [],

        timestamp,
    }
}


/*
|--------------------------------------------------------------------------
| Basic HTF calculations
|--------------------------------------------------------------------------
*/

function calculateSimpleAtr(
    previous: CandleInfo[],
    high: number,
    low: number,
    close: number
): number {

    const previousClose =
        previous.length > 0
            ? previous[previous.length - 1].close
            : close

    const trueRange =
        Math.max(
            high - low,
            Math.abs(high - previousClose),
            Math.abs(low - previousClose)
        )

    const ranges =
        previous
            .slice(-7)
            .map(c =>
                Math.max(
                    c.high - c.low,
                    Math.abs(
                        c.high -
                        (
                            previous
                                .find(
                                    p =>
                                        p.openTime <
                                        c.openTime
                                )
                                ?.close ??
                            c.open
                        )
                    )
                )
            )

    if (ranges.length === 0) {
        return trueRange
    }

    return (
        ranges.reduce(
            (sum, value) =>
                sum + value,
            trueRange
        ) /
        (ranges.length + 1)
    )
}


function calculateEmaFromValues(
    values: number[],
    period: number
): number {

    if (values.length === 0) {
        return 0
    }

    const seedLength =
        Math.min(
            period,
            values.length
        )

    let ema =
        values
            .slice(0, seedLength)
            .reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
        seedLength

    const multiplier =
        2 /
        (period + 1)

    for (
        let i = seedLength;
        i < values.length;
        i++
    ) {

        ema =
            (
                values[i] -
                ema
            ) *
            multiplier +
            ema
    }

    return ema
}


function buildBasicCandleStructure(
    open: number,
    high: number,
    low: number,
    close: number,
    atr: number
) {

    const range =
        Math.max(
            high - low,
            0
        )

    const body =
        Math.abs(
            close - open
        )

    const upperWick =
        Math.max(
            high -
            Math.max(open, close),
            0
        )

    const lowerWick =
        Math.max(
            Math.min(open, close) -
            low,
            0
        )

    const bodyRatio =
        range > 0
            ? body / range
            : 0

    const upperWickRatio =
        range > 0
            ? upperWick / range
            : 0

    const lowerWickRatio =
        range > 0
            ? lowerWick / range
            : 0

    const closeLocation =
        range > 0
            ? (close - low) /
            range
            : 0.5

    const rangeAtrRatio =
        atr > 0
            ? range / atr
            : 0

    const bodyAtrRatio =
        atr > 0
            ? body / atr
            : 0

    let direction: MARKET_DIRECTION =
        'NEUTRAL'

    if (close > open) {
        direction = 'BULLISH'
    }

    if (close < open) {
        direction = 'BEARISH'
    }

    return {
        direction,

        range,
        body,
        upperWick,
        lowerWick,

        bodyRatio,
        upperWickRatio,
        lowerWickRatio,

        closeLocation,

        rangeAtrRatio,
        bodyAtrRatio,

        isBullish: close > open,
        isBearish: close < open,
        isDoji: bodyRatio < 0.10,

        isExpansion:
            atr > 0 &&
            rangeAtrRatio >= 1.50,

        isCompression:
            atr > 0 &&
            rangeAtrRatio <= 0.60,

        isInsideBar: false,
        isOutsideBar: false,

        isBullishEngulfing: false,
        isBearishEngulfing: false,

        consecutiveBullish: 0,
        consecutiveBearish: 0,

        strength: clamp(
            bodyRatio * 100,
            0,
            100
        ),
    }
}


/*
|--------------------------------------------------------------------------
| Direction helpers
|--------------------------------------------------------------------------
*/

function directionalScore(
    actual: REGIME_DIRECTION,
    desired: SIGNAL_DIRECTION
): number {

    if (
        desired === 'NEUTRAL' ||
        actual === 'NEUTRAL'
    ) {
        return 0
    }

    if (
        desired === 'LONG' &&
        actual === 'BULLISH'
    ) {
        return 100
    }

    if (
        desired === 'SHORT' &&
        actual === 'BEARISH'
    ) {
        return 100
    }

    return 0
}


function entryDirectionScore(
    entry: EntryEvidence,
    direction: SIGNAL_DIRECTION
): number {

    if (direction === 'LONG') {
        return entry.long
    }

    if (direction === 'SHORT') {
        return entry.short
    }

    return 0
}


function safeDirectionalScore(
    long: number,
    short: number
): number {

    if (
        !Number.isFinite(long) ||
        !Number.isFinite(short)
    ) {
        return 0
    }

    const total =
        Math.max(
            Math.abs(long),
            Math.abs(short),
            1
        )

    return clamp(
        (
            long -
            short
        ) /
        total *
        100,
        -100,
        100
    )
}


function calculateStructureConflict(
    states: TimeframeStructureState[]
): number {

    let bullish = 0
    let bearish = 0

    for (const state of states) {

        const weight =
            STRUCTURE_WEIGHTS[
                state.interval
            ]

        if (state.direction === 'BULLISH') {
            bullish += weight
        }

        if (state.direction === 'BEARISH') {
            bearish += weight
        }
    }

    if (
        bullish === 0 ||
        bearish === 0
    ) {
        return 0
    }

    return clamp(
        Math.min(
            bullish,
            bearish
        ) /
        Math.max(
            bullish,
            bearish
        ) *
        100,
        0,
        100
    )
}


/*
|--------------------------------------------------------------------------
| Price helpers
|--------------------------------------------------------------------------
*/

function getRecentPriceChange(
    candles: CandleInfo[]
): number {

    if (candles.length < 2) {
        return 0
    }

    const current =
        candles[candles.length - 1]

    const previous =
        candles[candles.length - 2]

    if (previous.close === 0) {
        return 0
    }

    return (
        current.close -
        previous.close
    ) /
    previous.close
}


function formatDistancePercent(
    from: number,
    to: number
): string {

    if (from === 0) {
        return '0%'
    }

    return formatPercent(
        (
            to -
            from
        ) /
        from *
        100
    )
}


/*
|--------------------------------------------------------------------------
| Final Reasons
|--------------------------------------------------------------------------
*/

function buildFinalReasons(
    direction: SIGNAL_DIRECTION,
    score: number,
    confidence: number,
    regime: MarketRegime,
    mainMarket: MainMarketRegime,
    location: LocationState,
    entry: EntryEvidence,
    contradiction: number,
    trade: TradeRecommendation
): string[] {

    const reasons: string[] = []

    reasons.push(
        `Final direction ${direction}`
    )

    reasons.push(
        `Confluence score ${round(score)}`
    )

    reasons.push(
        `Confidence ${round(confidence)}`
    )

    reasons.push(
        `HTF regime ${regime.direction} ` +
        `strength ${round(regime.strength)}`
    )

    reasons.push(
        `Main market ${mainMarket.direction} ` +
        `strength ${round(mainMarket.strength)}`
    )

    reasons.push(
        `Location ${location.location}`
    )

    reasons.push(
        `Entry LONG ${round(entry.long)} / ` +
        `SHORT ${round(entry.short)}`
    )

    reasons.push(
        `Contradiction ${round(contradiction)}`
    )

    reasons.push(
        ...trade.reasons
    )

    return reasons
}


/*
|--------------------------------------------------------------------------
| Generic numeric helpers
|--------------------------------------------------------------------------
*/

function normalizeStrength(
    value: number
): number {

    if (!Number.isFinite(value)) {
        return 0
    }

    return clamp(
        value / 100,
        0,
        1
    )
}


function clamp(
    value: number,
    min: number,
    max: number
): number {

    if (!Number.isFinite(value)) {
        return min
    }

    return Math.min(
        Math.max(
            value,
            min
        ),
        max
    )
}


function round(
    value: number
): number {

    return Math.round(
        value * 100
    ) / 100
}


function formatNumber(
    value: number,
    decimals = 4
): string {

    if (!Number.isFinite(value)) {
        return 'N/A'
    }

    return value.toFixed(decimals)
}


function formatPrice(
    value: number
): string {

    if (!Number.isFinite(value)) {
        return 'N/A'
    }

    if (value >= 1000) {
        return value.toFixed(2)
    }

    if (value >= 1) {
        return value.toFixed(4)
    }

    if (value >= 0.01) {
        return value.toFixed(6)
    }

    return value.toFixed(8)
}


function formatPercent(
    value: number
): string {

    if (!Number.isFinite(value)) {
        return 'N/A'
    }

    const sign =
        value > 0
            ? '+'
            : ''

    return (
        sign +
        value.toFixed(2) +
        '%'
    )
}