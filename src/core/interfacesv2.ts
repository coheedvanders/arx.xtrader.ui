import type { LiquidationHeatmapResult } from "@/utility/v2/analysis/liquidationHeatmap"
import type { PriceZone, VolumeProfile } from "./interfaces"

export type MARKET_INTERVAL = "15m" | "1h" | "4h" | "1d";

export type MARKET_ALIGNMENT =
    | 'ALIGNED_BULLISH'
    | 'ALIGNED_BEARISH'
    | 'PARTIALLY_BULLISH'
    | 'PARTIALLY_BEARISH'
    | 'DIVERGING_BULLISH'
    | 'DIVERGING_BEARISH'
    | 'NEUTRAL';

export type VOLUME_STATE =
    | 'EXPANDING'
    | 'CONTRACTING'
    | 'NORMAL'
    | 'NEUTRAL'

export type MARKET_DIRECTION =
    | 'BULLISH'
    | 'BEARISH'
    | 'NEUTRAL'
    | 'RANGE'

export type SIGNAL_DIRECTION =
    | 'LONG'
    | 'SHORT'
    | 'NEUTRAL'

export type ANCHOR_TYPE =
    | 'AVWAP'
    | 'LIQUIDITY_HEATMAP'
    | 'FRVP'

export type ANCHOR_REASON =
    | 'RANGE_START'
    | 'CONSOLIDATION_START'
    | 'SWING_START'
    | 'IMPULSE_ORIGIN'
    | 'STRUCTURE_BREAK'
    | 'LIQUIDITY_REGIME_CHANGE'
    | 'LIQUIDITY_SWEEP'
    | 'RECLAIM'
    | 'DISPLACEMENT'
    | 'SESSION_START'
    | 'OTHER'

export type ANCHOR_STATUS =
    | 'ACTIVE'
    | 'WEAKENED'
    | 'INVALIDATED'
    | 'EXPIRED'

export type OI_STATE =
    | 'RISING'
    | 'FALLING'
    | 'FLAT'
    | 'EXPANDING'
    | 'CONTRACTING'
    | 'NEUTRAL'

export type LS_STATE =
    | 'LONG_DOMINANT'
    | 'SHORT_DOMINANT'
    | 'BALANCED'
    | 'LONG_INCREASING'
    | 'SHORT_INCREASING'
    | 'NEUTRAL'

export type MARKET_REGIME =
    | 'TREND_UP'
    | 'TREND_DOWN'
    | 'RANGE'
    | 'TRANSITION'
    | 'NEUTRAL'

export type REGIME_DIRECTION =
    | 'BULLISH'
    | 'BEARISH'
    | 'NEUTRAL'

export type EMA_TREND =
    | 'ABOVE_RISING'
    | 'ABOVE_FALLING'
    | 'BELOW_RISING'
    | 'BELOW_FALLING'
    | 'ABOVE_FLAT'
    | 'BELOW_FLAT'
    | 'NEUTRAL'

export type MARKET_LOCATION =
    | 'SUPPORT'
    | 'RESISTANCE'
    | 'VALUE'
    | 'ABOVE_VALUE'
    | 'BELOW_VALUE'
    | 'MID_RANGE'
    | 'NEUTRAL'

export type ENTRY_QUALITY =
    | 'STRONG'
    | 'VALID'
    | 'WEAK'
    | 'CONFLICTED'
    | 'NONE'

export type TRADE_LEVEL_TYPE =
    | 'ENTRY'
    | 'STOP_LOSS'
    | 'TAKE_PROFIT'
    | 'RESISTANCE'
    | 'SUPPORT'
    | 'SWING_HIGH'
    | 'SWING_LOW'
    | 'EMA200'
    | 'FRVP'
    | 'AVWAP'
    | 'LIQUIDITY'

export interface SymbolInfo {
    name: string

    candle_15m: CandleInfo[]
    candle_1h: CandleInfo[]
    candle_4h: CandleInfo[]
    candle_1d: CandleInfo[]

    oi_15m: OpenInterestHistEntry[]
    oi_1h: OpenInterestHistEntry[]
    oi_4h: OpenInterestHistEntry[]
    oi_1d: OpenInterestHistEntry[]

    ls_15m: LongShortRatioEntry[]
    ls_1h: LongShortRatioEntry[]
    ls_4h: LongShortRatioEntry[]
    ls_1d: LongShortRatioEntry[]
}

export interface CandleInfo {
    open: number
    close: number
    high: number
    low: number
    volume: number
    openTime: number
    closeTime: number

    atr: number
    ema200: number

    candleStructure: CandleStructure

    anchors: AnchorState

    priceAction: PriceAction

    openInterest: OpenInterestState

    longShort: LongShortState

    volumeState: VolumeState

    marketAlignment: MarketAlignment

    confluenceScore?: ConfluenceScore
}

export interface OpenInterestEntry {
    symbol: string
    openInterest: number
    time: number
}

export interface OpenInterestHistEntry {
    symbol: string
    sumOpenInterest: number
    sumOpenInterestValue: number
    timestamp: number
}

export interface LongShortRatioEntry {
    symbol: string
    longShortRatio: number
    longAccount: number
    shortAccount: number
    timestamp: number
}

export interface CandleStructure {
    direction: MARKET_DIRECTION

    range: number
    body: number
    upperWick: number
    lowerWick: number

    bodyRatio: number
    upperWickRatio: number
    lowerWickRatio: number

    closeLocation: number

    rangeAtrRatio: number
    bodyAtrRatio: number

    isBullish: boolean
    isBearish: boolean
    isDoji: boolean

    isExpansion: boolean
    isCompression: boolean

    isInsideBar: boolean
    isOutsideBar: boolean

    isBullishEngulfing: boolean
    isBearishEngulfing: boolean

    consecutiveBullish: number
    consecutiveBearish: number

    strength: number
}

export interface CandleAnchor {
    isAnchor: boolean
    openTime: number | null
    reasons: ANCHOR_REASON[]
    confidence: number
}

export interface CandleAnchors {
    avwap: CandleAnchor
    liquidityHeatmap: CandleAnchor
    frvp: CandleAnchor
}

export interface AnchorPoint {
    id: string
    type: ANCHOR_TYPE
    openTime: number
    reason: ANCHOR_REASON
    confidence: number
    status: ANCHOR_STATUS
    age: number
    relevance: number
}

export interface AnchorAnalysis {
    avwap: PriceZone | null
    frvp: VolumeProfile | null
    heatmap: LiquidationHeatmapResult | null
}

export interface ActiveAnchor {
    anchor: AnchorPoint
    analysis: AnchorAnalysis
}

export interface ActiveAnchors {
    avwap: ActiveAnchor | null
    frvp: ActiveAnchor | null
    liquidityHeatmap: ActiveAnchor | null
}

export interface AnchorState {
    candidates: AnchorPoint[]
    active: ActiveAnchors
}

export interface PriceActionEvent {
    detected: boolean
    direction: SIGNAL_DIRECTION
    strength: number
    reasons: string[]
}

export interface PriceActionReclaim extends PriceActionEvent {
    level: number
    penetration: number
    closeDistance: number
}

export interface PriceActionBreakout extends PriceActionEvent {
    level: number
    volumeConfirmation: number
    displacementConfirmation: number
}

export interface PriceActionSequence {
    liquiditySweep: boolean
    rejection: boolean
    reclaim: boolean
    displacement: boolean
    closeConfirmation: boolean

    completion: number
    direction: SIGNAL_DIRECTION
}

export interface PriceAction {
    displacement: PriceActionEvent
    rejection: PriceActionEvent
    reclaim: PriceActionReclaim
    breakout: PriceActionBreakout
    failedBreakout: PriceActionBreakout
    liquiditySweep: PriceActionEvent
    sequence: PriceActionSequence

    long: number
    short: number

    dominant: SIGNAL_DIRECTION

    strength: number

    reasons: string[]
}

export interface OpenInterestState {
    value: number
    valueChange: number
    valueChangePercent: number

    direction: MARKET_DIRECTION

    state: OI_STATE

    strength: number

    timestamp: number

    reasons: string[]
}

export interface LongShortState {
    ratio: number

    longAccount: number
    shortAccount: number

    ratioChange: number
    ratioChangePercent: number

    direction: MARKET_DIRECTION

    state: LS_STATE

    strength: number

    timestamp: number

    reasons: string[]
}

export interface VolumeState {
    value: number

    averageVolume: number
    relativeVolume: number

    volumeChange: number
    volumeChangePercent: number

    state: VOLUME_STATE

    strength: number

    timestamp: number

    reasons: string[]
}

export interface MarketAlignmentComponent {
    score: number

    direction: SIGNAL_DIRECTION

    aligned: boolean

    reasons: string[]
}

export interface MarketAlignment {
    state: MARKET_ALIGNMENT

    direction: SIGNAL_DIRECTION

    strength: number

    btc: MarketAlignmentComponent

    eth: MarketAlignmentComponent

    sol: MarketAlignmentComponent

    marketConsensus: number

    alignmentScore: number

    divergenceScore: number

    reasons: string[]

    timestamp: number
}

export interface TradeRecommendation {
    direction: SIGNAL_DIRECTION

    entry: TradeLevel

    stopLoss: TradeLevel | null

    takeProfit: TradeLevel | null

    riskReward: number | null

    stopLossDistance: number | null
    stopLossPercent: number | null

    takeProfitDistance: number | null
    takeProfitPercent: number | null

    reasons: string[]
}

export interface Ema200State {
    value: number

    distance: number
    distancePercent: number
    distanceAtr: number

    position: 'ABOVE' | 'BELOW' | 'AT'

    slope: EMA_TREND

    direction: REGIME_DIRECTION

    strength: number

    reasons: string[]

    timestamp: number
}

export interface Ema200TimeframeState {
    interval: MARKET_INTERVAL
    state: Ema200State | null
}

export interface TimeframeStructureState {
    interval: MARKET_INTERVAL

    direction: MARKET_DIRECTION

    strength: number

    candle: CandleInfo | null

    reasons: string[]
}

export interface CrossTimeframeState {
    direction: REGIME_DIRECTION

    strength: number

    timeframes: {
        '15m': TimeframeStructureState
        '1h': TimeframeStructureState
        '4h': TimeframeStructureState
        '1d': TimeframeStructureState
    }

    alignment: number
    conflict: number

    reasons: string[]

    timestamp: number
}

export interface MarketRegime {
    state: MARKET_REGIME

    direction: REGIME_DIRECTION

    strength: number

    ema200: {
        '15m': Ema200State | null
        '1h': Ema200State | null
        '4h': Ema200State | null
        '1d': Ema200State | null
    }

    structure: CrossTimeframeState

    reasons: string[]

    timestamp: number
}

export interface MainMarketRegime {
    direction: REGIME_DIRECTION

    strength: number

    btc: MarketRegime | null
    eth: MarketRegime | null
    sol: MarketRegime | null

    consensus: number
    divergence: number

    reasons: string[]

    timestamp: number
}

export interface LocationState {
    location: MARKET_LOCATION

    direction: REGIME_DIRECTION

    strength: number

    price: number

    avwap: number | null
    frvp: number | null
    liquidityHeatmap: number | null

    reasons: string[]

    timestamp: number
}

export interface EntryEvidence {
    long: number
    short: number

    dominant: SIGNAL_DIRECTION

    strength: number

    candleStructure: number
    priceAction: number
    volume: number
    openInterest: number
    longShort: number

    reasons: string[]

    timestamp: number
}

export interface ConfluenceScore {
    score: number

    direction: SIGNAL_DIRECTION

    confidence: number

    regime: MarketRegime

    mainMarketRegime: MainMarketRegime

    crossTimeframe: CrossTimeframeState

    location: LocationState

    entry: EntryEvidence

    contradiction: number

    reasons: string[]

    trade: TradeRecommendation

    timestamp: number
}

export interface TradeLevel {
    type: TRADE_LEVEL_TYPE

    price: number

    interval: MARKET_INTERVAL | null

    distance: number
    distancePercent: number
    distanceAtr: number

    strength: number

    valid: boolean

    relativePosition: 'BEHIND' | 'AHEAD' | 'AT'

    reasons: string[]

    sourceOpenTime: number | null

    timestamp: number
}