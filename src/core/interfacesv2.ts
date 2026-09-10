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
     * The single price (within [sweptPriceLow, sweptPriceHigh]) where
     * resting liquidity was densest at the moment of the sweep — a
     * defensible candidate for "the level" this sweep was actually
     * targeting, used by priceAction.ts to anchor rejection/reclaim
     * checks against something more specific than the candle's own
     * high/low. Null when there's no active heatmap to measure against.
     */
    peakPrice: number | null

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

// ── Movement analysis report (simulationMovementAnalyzer.ts) ───────────
// Every "how long do we watch forward" window here is DISCOVERED per
// instance from a real, already-computed boundary (a run of the same
// category ending, a lifecycle reaching ENDED, a sequence reaching a new
// sweep or a full retrace) — never a fixed candle count or a hand-picked
// ATR multiple. `horizonCandles` on ForwardOutcome is reported, not
// configured. The few genuinely-arbitrary constants that remain (e.g. the
// touch tolerance in magnet analysis) are called out where they're used.
//
// MOVE_OUTCOME's STRONG/WEAK/CHOP cutoffs are also dynamic: computed once
// from the percentile distribution of |forwardReturnAtr| actually observed
// across this dataset, not a fixed ATR threshold — so the same label means
// something different (and something real) on a quiet symbol vs a violent
// one.

export type MOVE_OUTCOME =
    | 'STRONG_CONTINUATION'
    | 'WEAK_CONTINUATION'
    | 'CHOP'
    | 'WEAK_REVERSAL'
    | 'STRONG_REVERSAL'
    | 'CENSORED'

export interface ForwardOutcome {
    /** Discovered, not configured — see module comment above. */
    horizonCandles: number
    /** Reference direction for continuation/reversal framing; NEUTRAL when there wasn't one. */
    direction: SIGNAL_DIRECTION

    forwardReturnPercent: number
    forwardReturnAtr: number

    upExcursionAtr: number
    downExcursionAtr: number

    favorableExcursionAtr: number | null
    adverseExcursionAtr: number | null

    moveOutcome: MOVE_OUTCOME
    censored: boolean
}

export interface MoveOutcomeDistribution {
    sampleCount: number
    outcomeCounts: Record<MOVE_OUTCOME, number>
    outcomePercents: Record<MOVE_OUTCOME, number>
    meanForwardReturnPercent: number
    medianForwardReturnPercent: number
    meanForwardReturnAtr: number
}

export interface BucketStat {
    category: string
    sampleCount: number
    /** How many consecutive candles this category typically ran for before changing — reveals if a field is too flip-floppy to bucket usefully. */
    runLengthPercentiles: { p10: number; p50: number; p90: number } | null
    strengthPercentiles: { p10: number; p50: number; p90: number } | null
    outcome: MoveOutcomeDistribution
}

export interface ModuleBucketReport {
    module: 'positioningState' | 'longShortState' | 'volumeState' | 'alignmentSignal'
    field: string
    buckets: BucketStat[]
}

export interface AnchorLifecycleOutcome {
    side: 'LONG' | 'SHORT'
    clusterId: string
    startOpenTime: number
    confirmedOpenTime: number | null
    endOpenTime: number | null
    terminalStatus: 'BROKEN_BEFORE_CONFIRM' | 'CONFIRMED_THEN_ENDED' | 'STILL_ACTIVE_AT_DATASET_END' | 'STILL_BUILDING_AT_DATASET_END'
    runLengthAtBreak: number | null
    lifetimeCandles: number | null
    censored: boolean
    outcome: ForwardOutcome
}

export interface SweepEventOutcome {
    timestamp: number
    behavior: LIQUIDITY_SWEEP_BEHAVIOR
    sweptRatio: number
    measuredSides: Array<'LONG' | 'SHORT'>
    /** true = "an anchor was ACTIVE but this run of candles did NOT sweep" baseline case */
    isControlSample: boolean
    outcome: ForwardOutcome
}

export interface PriceActionSequenceOutcome {
    clusterKey: string
    direction: SIGNAL_DIRECTION
    level: number
    startOpenTime: number
    terminalStage: 'PENDING' | 'REJECTED' | 'RECLAIMED' | 'DISPLACED' | 'CONFIRMED' | 'INVALIDATED'
    candlesToReject: number | null
    candlesToReclaim: number | null
    candlesToDisplace: number | null
    candlesToConfirm: number | null
    censored: boolean
    outcomeFromSweep: ForwardOutcome
    outcomeFromConfirmation: ForwardOutcome | null
}

export interface AlignmentCountBucket {
    alignedSignalCount: 0 | 1 | 2 | 3
    totalSignalsConsidered: number
    sampleCount: number
    outcome: MoveOutcomeDistribution
}

export interface PairwiseCombinationBucket {
    combinationId: string
    fieldA: string; valueA: string
    fieldB: string; valueB: string
    sampleCount: number
    belowMinSampleSize: boolean
    outcome: MoveOutcomeDistribution
}

export interface SweepMagnitudeVsTerminalStage {
    /** Tercile computed from this dataset's own sweptRatio distribution — not a fixed cutoff. */
    sweptRatioTercile: 'LOW' | 'MED' | 'HIGH'
    sampleCount: number
    terminalStageCounts: Record<PriceActionSequenceOutcome['terminalStage'], number>
}

export interface CombinationSection {
    alignmentCounts: AlignmentCountBucket[]
    pairwise: PairwiseCombinationBucket[]
    sweepMagnitudeVsTerminalStage: SweepMagnitudeVsTerminalStage[]
    minSampleSize: number
}

export interface MagnetAnalysisResult {
    triggerType: 'SWEEP' | 'PRICE_ACTION_CONFIRMED'
    triggerTimestamp: number
    originLevel: number
    targetPrice: number
    targetPoolValue: number
    controlPrice: number
    targetHit: boolean
    controlHit: boolean
    targetDrainedByOtherSweep: boolean
    candlesToHitTarget: number | null
    candlesToHitControl: number | null
    horizonCandles: number
    fractionOfDistanceClosed: number
    censored: boolean
}

export interface CandleSnapshot {
    openTime: number
    open: number; high: number; low: number; close: number; volume: number
    atr: number
    positioningBehavior: string
    liquiditySweepBehavior: string
    priceActionStage: string | null
}

export interface EventTimelineWindow {
    eventType: 'SWEEP' | 'CLUSTER_CONFIRMED' | 'CLUSTER_ENDED' | 'PRICE_ACTION_CONFIRMED' | 'PRICE_ACTION_INVALIDATED'
    eventTimestamp: number
    beforeCandles: CandleSnapshot[]
    afterCandles: CandleSnapshot[]
}

export interface CrossCheckResult {
    description: string
    agreementRate: number
    disagreementCount: number
    sampleCount: number
}

export interface AnalysisMetadata {
    symbol: string
    interval: MARKET_INTERVAL
    candleCount: number
    startTime: number
    endTime: number
    generatedAt: number
    parameters: Record<string, number>
}

export interface SimulationAnalysisReport {
    metadata: AnalysisMetadata
    stateBucketReports: ModuleBucketReport[]
    anchorLifecycleOutcomes: AnchorLifecycleOutcome[]
    sweepEventOutcomes: SweepEventOutcome[]
    priceActionSequenceOutcomes: PriceActionSequenceOutcome[]
    combinations: CombinationSection
    magnetAnalysis: MagnetAnalysisResult[]
    eventTimelines: EventTimelineWindow[]
    crossModuleConsistencyChecks: CrossCheckResult[]
}