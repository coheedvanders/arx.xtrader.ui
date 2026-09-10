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

export type TREND_DIRECTION =
    | 'RISING'
    | 'FALLING'
    | 'FLAT'
    | 'INSUFFICIENT_DATA'

export type POSITIONING_BEHAVIOR =
    | 'LONG_BUILDUP'      // price rising + OI rising    -> new longs entering
    | 'SHORT_COVERING'    // price rising + OI falling   -> shorts closing
    | 'SHORT_BUILDUP'     // price falling + OI rising   -> new shorts entering
    | 'LONG_UNWINDING'    // price falling + OI falling  -> longs closing / profit booking
    | 'NEUTRAL'           // price or OI flat -> not classified
    | 'INSUFFICIENT_DATA'

// Generic "does this second signal agree with the primary trend" result.
// Reused for both volume-vs-OI confirmation and long/short-account-share-
// vs-price agreement, since both are structurally the same comparison
// (CONFIRMS / DIVERGES / NEUTRAL / INSUFFICIENT_DATA) — kept as one type
// rather than two identical ones per the project's "avoid abstraction for
// its own sake" rule cutting the other way here (these really are the same
// concept applied twice).
export type VOLUME_CONFIRMATION =
    | 'CONFIRMS'
    | 'DIVERGES'
    | 'NEUTRAL'
    | 'INSUFFICIENT_DATA'

export type LIQUIDITY_ANCHOR_STATUS =
    | 'BUILDING'    // OI buildup run in progress on this side, not yet long enough to confirm
    | 'ACTIVE'      // confirmed: this side's cluster is live and its heatmap should be tracked
    | 'ENDED'       // same-side OI unwind occurred on this candle -> cluster resolved as of here
    | 'NONE'        // no buildup happening on this side, no active/pending cluster

/**
 * Lifecycle state for ONE side (long or short) of a liquidity anchor.
 * Long and short sides are tracked independently and can be active
 * simultaneously — see liquidationHeatmap.ts's own docstring: it models a
 * long-side pool and a short-side pool as coexisting at all times, so
 * forcing a single unified "the anchor" status would misrepresent that.
 */
export interface LiquiditySideStamp {
    status: LIQUIDITY_ANCHOR_STATUS

    /** Groups every candle belonging to the same episode. Null when status is NONE. */
    clusterId: string | null

    /** First candle of the OI-buildup run — the anchor/heatmap-start candidate. */
    eventOpenTime: number | null
    /** Index of that candle within whatever candles array produced this stamp. */
    eventCandleIndex: number | null

    /** When the run reached the confirmation threshold and became ACTIVE. */
    confirmedOpenTime: number | null

    /** Candle where the same-side unwind occurred and the cluster was marked ENDED. */
    endOpenTime: number | null

    /** How many consecutive same-direction buildup candles seen so far (diagnostic; resets on break). */
    runLength: number
}

export interface LiquidationHeatmapStamp {
    long: LiquiditySideStamp
    short: LiquiditySideStamp

    timestamp: number
    reasons: string[]
}

export type LIQUIDITY_SWEEP_BEHAVIOR =
    | 'SWEPT'             // this candle's range cleared a meaningful amount of an active anchor's resting pool
    | 'NO_SWEEP'          // an active anchor exists, but this candle didn't clear a meaningful amount
    | 'NO_ACTIVE_HEATMAP' // no ACTIVE long or short cluster to measure against

export interface LiquiditySweepInfo {
    behavior: LIQUIDITY_SWEEP_BEHAVIOR

    /** Raw pool value this candle's [low, high] cleared from the active anchor's heatmap. */
    sweptValue: number
    /** sweptValue / that heatmap's own globalMaxPoolValue (0-1). Normalized within this anchor only. */
    sweptRatio: number

    sweptPriceLow: number | null
    sweptPriceHigh: number | null

    /**
     * Which side(s) were ACTIVE and therefore in-scope for this
     * measurement. NOTE: the underlying heatmap pool does not separate
     * long vs short contributions by bucket (one merged pool — see
     * liquidationHeatmap.ts), so `sweptValue` cannot be split into "how
     * much was long-side vs short-side" — only which side(s)' anchors were
     * live is known, not the composition of what got cleared.
     */
    measuredSides: Array<'LONG' | 'SHORT'>

    anchorClusterIds: string[]

    timestamp: number
    reasons: string[]
}

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

    liquidationHeatmapStamp: LiquidationHeatmapStamp

    liquiditySweepInfo: LiquiditySweepInfo

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

export interface PositioningState {
    behavior: POSITIONING_BEHAVIOR

    // 0-100, min(priceMagnitude, oiMagnitude). 0 when behavior is NEUTRAL/INSUFFICIENT_DATA.
    strength: number

    priceDirection: TREND_DIRECTION
    priceChange: number
    priceChangePercent: number
    priceChangeAtr: number
    priceMagnitude: number

    oiDirection: TREND_DIRECTION
    oiChangePercent: number
    oiMagnitude: number

    volumeDirection: TREND_DIRECTION
    volumeChangePercent: number
    volumeConfirmation: VOLUME_CONFIRMATION

    // Independent signal from LongShortRatioEntry account counts. Checks
    // whether the crowd's long-account share is trending the same way as
    // price — NOT the same thing as oiDirection (see positioningState.ts
    // module comment: account count and OI notional can move differently).
    // This does NOT feed into `strength` above; it's reported separately
    // so it can be inspected/validated on its own before being trusted.
    accountShareDirection: TREND_DIRECTION
    accountShareChangePercent: number
    accountAgreement: VOLUME_CONFIRMATION

    lookback: number
    timestamp: number

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

    positioningState: PositioningState
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