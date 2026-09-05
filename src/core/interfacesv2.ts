export type MARKET_DIRECTION =
    | 'BULLISH'
    | 'BEARISH'
    | 'NEUTRAL'
    | 'RANGE'

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
    openTime: number,
    closeTime: number,

    atr: number
    ema200: number

    candleStructure: CandleStructure,

    anchors: CandleAnchors
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
    reasons: ANCHOR_REASON[]
    confidence: number
}

export interface CandleAnchors {
    avwap: CandleAnchor
    liquidityHeatmap: CandleAnchor
    frvp: CandleAnchor
}