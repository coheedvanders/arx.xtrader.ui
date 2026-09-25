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

export type MarketStructureLabel = 'HH' | 'HL' | 'LH' | 'LL';

export interface MarketStructureSwing {
    label: MarketStructureLabel;
    /** openTime of the candle whose close made this swing knowable — always later than (or equal to, if fractalWidth were 0) the swing candle's own openTime. Same confirmation-lag concept as LiquidityHeatmapAnchor's confirmedOpenTime. */
    confirmedOpenTime: number;
}

export interface TrendSegmentInfo {
    direction: 'UP' | 'DOWN';
    /** Index of the confirming swing candle (the HH for an uptrend, the LL for a downtrend) — same gi space as everything else in this candle array. */
    startGi: number;
    /** Inclusive. If the segment is still the current, active trend, this is the most recent candle's gi (may still extend as more data arrives). */
    endGi: number;
    /** openTime at which this segment could first be said to be real — when the confirming swing (HL after HH, LH after LL) itself confirmed AND price cleared the minimum significance bar in its favor. Every candle within [startGi, endGi] carries the SAME TrendSegmentInfo object (by value), so any one of them tells you the whole segment's bounds. */
    confirmedOpenTime: number;
}

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
    | 'SWEPT_AND_RESPECTED' // entered the previous segment's hot (yellow/red) zone, then closed back on the side it came from — the zone held as support/resistance
    | 'SWEPT_AND_CONTINUED' // entered the hot zone and closed through it — the zone did NOT hold
    | 'NO_SWEEP'            // a previous segment exists, but this candle's range never reached its hot zone
    | 'NO_PREVIOUS_ANCHOR'  // no previously-confirmed liquidity heatmap anchor segment exists yet to measure against

export interface LiquiditySweepInfo {
    behavior: LIQUIDITY_SWEEP_BEHAVIOR

    /** Which previously-confirmed trend segment this was measured against (see liquidityHeatmapAnchor.ts) — null when behavior is NO_PREVIOUS_ANCHOR. */
    previousAnchorPairId: string | null
    /** That segment's own direction (LONG = uptrend, SHORT = downtrend). */
    previousAnchorDirection: SIGNAL_DIRECTION | null

    /**
     * Raw pool value this candle's [low, high] cleared, counting ONLY the
     * segment's "yellow and red" (hot — intensity >= 0.5, see heatColor in
     * liquidationHeatmap.ts) buckets. Cold liquidity is deliberately
     * excluded — that's not what a trader means by "the pool" when
     * looking at a heatmap.
     */
    sweptValue: number
    /** The segment's TOTAL hot-pool value — how much yellow/red liquidity existed in total, the denominator for sweptRatio. */
    totalHotPoolValue: number
    /**
     * sweptValue / totalHotPoolValue (0-1). NOTE: this is a per-candle
     * snapshot against the reference segment's ORIGINAL, unconsumed hot
     * pool — not a running depletion tracker across multiple candles that
     * each nibble at the same zone. See the module comment in
     * liquiditySweepInfo.ts for why, and what that does and doesn't catch.
     */
    sweptRatio: number
    /** 0-100 — currently just sweptRatio scaled. See module comment for exactly what this does and doesn't capture. */
    strength: number

    /** The hot zone's own price bounds (bounding box of every intensity>=0.5 bucket in the reference segment) — set whenever a previous anchor exists, regardless of whether THIS candle touched them. */
    hotZoneLow: number | null
    hotZoneHigh: number | null

    sweptPriceLow: number | null
    sweptPriceHigh: number | null

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

    // Computed AFTER runAnalysis has fully populated candle_15m (see
    // SimulationUtilityV2.runTrendStats) — a post-hoc, hindsight-aware
    // summary pass over the already-analyzed candles, not part of the
    // causal walk-forward pipeline itself. Its purpose is research
    // review (surfacing market behavior around each move for analysis),
    // not a live trading input — unlike positionEntry.ts, look-ahead
    // is fine here since nothing here feeds back into an entry decision.
    trendstats_15m: TrendStats | null
}

export interface TrendSegmentStats {
    direction: "UP" | "DOWN"
    startGi: number
    endGi: number
    startOpenTime: number
    endOpenTime: number
    // The confirming candle's own openTime (same value as
    // TrendSegmentInfo.confirmedOpenTime) — repeated here so a segment
    // stat is self-contained without needing to cross-reference candles.
    confirmedOpenTime: number
    // THE LAG — candles between this segment's own pivot (startGi) and
    // the candle that actually confirmed the reversal establishing it.
    // Always >= 0; a segment's true start is only ever knowable in
    // hindsight, this is exactly how much hindsight was needed.
    confirmationLagCandles: number
    durationCandles: number
    // close-to-close, not high/low-to-high/low — consistent, simple
    // basis for comparing segments against each other.
    priceChangePercent: number
    // priceChangePercent / durationCandles — a segment's own "steepness":
    // a large magnitude means a sharp move packed into few candles: a
    // small one means a slow, long-spanning move. Deliberately left as
    // a raw, signed number rather than pre-sorted into "sharp" or
    // "long-spanning" buckets — sort/filter on this and durationCandles
    // directly rather than trusting an arbitrary bucket boundary.
    changePerCandlePercent: number
    // Descriptive aggregates of what OI/LS/volume were doing DURING this
    // segment — context to review, not a score. Null when that field
    // was never populated on the underlying candles.
    avgOpenInterestChangePercent: number | null
    dominantLongShortState: LS_STATE | null
    avgRelativeVolume: number | null
}

export interface AvwapBreakEvent {
    gi: number
    openTime: number
    // The specific POC AVWAP value the candle's own body broke through
    // (see AVWAP_BODY_BREAK_LEVEL in simulationUtilityV2.ts's extras).
    avwapLevel: number
    // Which way the candle's body crossed the level.
    breakDirection: "UP" | "DOWN"
    // CONTINUATION: price moved further past the level in breakDirection
    // by the stated ATR threshold before ever reversing back through it.
    // SWEEP_REVERSAL: price crossed back through the level in the
    // OPPOSITE direction by the stated threshold first — read literally
    // per the request this answers: "price breaks AVWAP high/low then
    // reverses back — more likely a sweep before going the other way."
    // UNRESOLVED: neither happened within the lookahead window.
    outcome: "CONTINUATION" | "SWEEP_REVERSAL" | "UNRESOLVED"
    // The candle where the outcome above was actually determined — null
    // for UNRESOLVED, since nothing resolved it within the window.
    resolvedAtGi: number | null
    // Context AT the moment of the break itself — same "descriptive,
    // not a score" status as TrendSegmentStats' own aggregates.
    openInterestChangePercent: number | null
    longShortState: LS_STATE | null
    relativeVolume: number | null
}

export interface TrendStats {
    segments: TrendSegmentStats[]
    avwapBreakEvents: AvwapBreakEvent[]
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

    conditions_met: string[]

    extras: string[]

    candleStructure: CandleStructure

    marketStructure: MarketStructureSwing | null

    trendState: TrendSegmentInfo | null

    anchors: AnchorState

    priceAction: PriceAction

    openInterest: OpenInterestState

    longShort: LongShortState

    volumeState: VolumeState

    marketAlignment: MarketAlignment

    liquidationHeatmapStamp: LiquidationHeatmapStamp

    liquiditySweepInfo: LiquiditySweepInfo

    // Usually empty. A candle can genuinely be BOTH the end of one trend
    // segment and the start of the next (a clean reversal point) — this is
    // common, not an edge case — so this must be an array, not a single
    // nullable value; a single field silently overwrote one of the two on
    // any candle where that happened. See liquidityHeatmapAnchor.ts.
    liquidityAnchor: LiquidityHeatmapAnchor[]

    confluenceScore?: ConfluenceScore

    // Shared across every candle from the entry candle through to
    // resolution (same pattern as trendState/marketStructure) — the
    // SAME object reference, mutated in place as each subsequent
    // candle is processed, so by the end of the run every candle in
    // that range reflects the FINAL, resolved outcome, not a frozen
    // snapshot of what was known at that candle's own time. Null on
    // any candle with no entry active or being resolved on it.
    positionEntry: PositionEntry | null
}

// Captures WHY an entry actually fired, in structured, analyzable form
// (not just a prose sentence) - so a batch of positions can be grouped
// and studied by which factors were true at entry, matching how every
// other piece of this pipeline has been designed to stay analyzable
// rather than just readable. SHORT-only fields are null for LONG,
// since LONG's current entry logic has no extra confirmation gates -
// segmentLow/High/Mid are populated for both sides, since that
// geometry alone was enough to find and explain the LONG "late entry"
// bad-RR pattern in an earlier research pass.
export interface PositionEntryReason {
    trigger: "POTENTIAL_REVERSAL"
    reversingDirection: "UP" | "DOWN"
    segmentLow: number
    segmentHigh: number
    segmentMid: number
    // null for LONG - these are SHORT-only confirmation checks.
    broaderMoveAtr: number | null
    exhaustionWickRatio: number | null
    trendZScoreAvg: number | null
    // Short, human-readable summary for quick scanning without having
    // to interpret the raw numbers above.
    summary: string
}

export interface PositionEntry {
    side: "LONG" | "SHORT"
    entryPrice: number
    margin: number
    leverage: number
    sl: number
    tp: number
    // Why this specific entry fired - see PositionEntryReason.
    entryReason: PositionEntryReason
    // The openTime of the candle this position opened on, stamped once
    // at creation and never changed afterward. Lives HERE, on the
    // position itself, rather than being tracked externally by the
    // caller - an earlier design kept it in a single mutable per-symbol
    // slot written in one place and read in another, which repeatedly
    // desynchronized as positions opened/closed across rolling-window
    // shifts (real exports had 11.8% of records carrying some earlier
    // position's openTime). Immutable data travelling with the position
    // is immune to that whole class of bug by construction.
    openTime: number
    // Taker fee charged to open this position, in USDT — via
    // PnlUtility.calculateTakerFee(margin, leverage). Captured once at
    // entry (fee is fixed by margin/leverage at open time, doesn't
    // change as the position runs).
    entryFee: number
    // ATR-normalized excursions, updated every candle the position is
    // open (including the candle it resolves on) — MAE is the worst
    // (most against) move seen, MFE the best (most favorable), both
    // measured from entryPrice.
    mae: number
    mfe: number
    // MID = SL and TP both fell within the same candle's [low, high] —
    // genuinely ambiguous which was hit first intra-candle, so no PnL
    // is computed for it (see the reference logic this mirrors).
    status: "OPEN" | "WON" | "LOSS" | "MID"
    // Mark-to-market while OPEN, final realized value once WON/LOSS,
    // null for MID (unresolvable) and before entry.
    pnl: number | null
    // Per-candle pnl HISTORY, indexed by candles-since-open:
    // walkingPnl[k] is the pnl as of candle (openGi + k) — so
    // walkingPnl[gi - openGi] gives the pnl AT any specific gi the
    // position covered. walkingPnl[0] is always 0 (pnl is trivially 0
    // at the entry candle itself, since entryPrice === that candle's
    // own close). The LAST entry always equals the final `pnl` once
    // resolved (WON/LOSS), or null for MID at that final index.
    //
    // Exists because candle.positionEntry is the SAME mutated object
    // referenced from every candle the position spans — reading `pnl`
    // from an EARLIER candle mid-replay would show the position's
    // FINAL outcome, not what it actually was at that point in time,
    // since it's one shared object, not a snapshot per candle.
    // walkingPnl is what actually varies by which candle you're
    // looking from; `pnl` alone does not.
    walkingPnl: (number | null)[]
    openGi: number
    closeGi: number | null
    durationMinutes: number | null
    /**
     * WHY the position closed — which is NOT recoverable from `status`.
     *
     * A force-close (duration cap, or a scheduled portfolio-wide close)
     * sets status to WON/LOSS purely by the SIGN of its mark-to-market
     * pnl, so an expiry at +0.30 USDT is indistinguishable from a real
     * TP hit once it's written. Without this field a report can count
     * wins and losses but cannot say how many of them the strategy
     * actually chose to exit versus how many the cap closed for it.
     *
     *   TP / SL   — price reached the target or the stop.
     *   MID       — SL and TP both fell inside one candle's range;
     *               genuinely ambiguous, no pnl computed.
     *   EXPIRED   — hit maxPositionDurationCandles while still OPEN.
     *   AUTO_CLOSE— a scheduled portfolio-wide close (the rolling
     *               simulation's auto-close modes), distinct from
     *               EXPIRED because the two answer different questions.
     *
     * Undefined while the position is still OPEN, and on records
     * produced before this field existed — so a report must treat
     * `undefined` as "unknown", never as a zero for any bucket.
     */
    closeReason?: "TP" | "SL" | "MID" | "EXPIRED" | "AUTO_CLOSE" | "LIQUIDATED"
    /**
     * The price this position actually exited at. NOT always the SL/TP
     * level: when a candle OPENS past the level, the market gapped
     * through it and a resting stop fills at the open instead. Null
     * while OPEN.
     */
    exitPrice?: number | null
    /**
     * Taker fee on the exit fill, charged on quantity x exitPrice. Null
     * while OPEN. Separate from entryFee because the two are computed on
     * different notionals - the position moved in between. Round-trip
     * cost is entryFee + exitFee; charging only entryFee understates it
     * by close to half.
     */
    exitFee?: number | null
    /**
     * Cumulative funding paid by this position, in USDT, POSITIVE when
     * the position paid and negative when it received. Accrued per
     * settlement by the simulation loop (never inside updatePositionEntry,
     * which re-runs over the whole window on every shift and would
     * multiply it), on notional at the settlement's own mark, not on
     * margin - at 20x those differ by 20x.
     */
    fundingPaid: number
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

    /**
     * True for a STRONG, confirmed price-action moment — either the final
     * displacement stage of a full sweep->reject->reclaim->displace
     * sequence, or a decisive (above-threshold) SWEPT_AND_RESPECTED sweep
     * on its own. See priceAction.ts's STRONG_SWEEP_STRENGTH_THRESHOLD for
     * the exact cutoff. `dominant` gives the direction, `reasons` gives
     * the why — this field is just the filter, deliberately not a
     * separate score or narrative of its own.
     */
    strongAction: boolean

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
    // Standard-deviations from the mean, using the SAME dynamically
    // sized baseline as relativeVolume/averageVolume (see
    // getAdaptiveLookback in volumeState.ts) - not a separate fixed
    // window. relativeVolume answers "how many times normal";
    // dynamicZScore answers "how statistically unusual", which needs
    // the baseline's own spread (stdDev), not just its mean. 0 when
    // the baseline has zero variance (e.g. a single-candle baseline)
    // or volume data isn't available - see volumeState.ts's own
    // reasons strings to distinguish "genuinely flat" from "not
    // enough data."
    dynamicZScore: number
    // Standard-deviations from the mean of THIS candle's own trend
    // segment's volume (candle.trendState.startGi..endGi, excluding
    // this candle itself) - a structural baseline instead of a
    // rolling one. 0 whenever the candle isn't currently classified
    // into a trend (trendState is null) or the trend hasn't produced
    // enough prior candles yet to have a baseline of its own.
    trendZScore: number
    // Running sum/sumSq/count backing trendZScore's own calculation,
    // covering [trendStartGi, upToGiInclusive] of the current trend
    // segment's volume - carried forward so the NEXT candle's own
    // getVolumeState call can extend this incrementally (one new term)
    // instead of re-summing the whole segment from scratch every time.
    // null whenever trendZScore itself is 0 for a reason that leaves no
    // running range to carry forward (no active trend, or not enough
    // prior candles yet) - see volumeState.ts's own getTrendZScore.
    trendVolumeRunningStats?: TrendVolumeRunningStats | null

    volumeChange: number
    volumeChangePercent: number

    state: VOLUME_STATE

    strength: number

    timestamp: number

    reasons: string[]
}

export interface TrendVolumeRunningStats {
    trendStartGi: number
    sum: number
    sumSq: number
    count: number
    upToGiInclusive: number
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

// ── Liquidity heatmap anchor points (liquidityHeatmapAnchor.ts) ────
// Where should a liquidity heatmap actually be anchored? Not a fixed
// lookback — the START/END of a real structural trend segment, identified
// from swing-point structure (HH/HL for uptrends, LH/LL for downtrends).
// START and END are confirmed independently and asynchronously: END fires
// the moment structure breaks (one new swing is enough), START only once
// a full new two-swing pattern confirms a fresh trend — so there is
// honestly a "we don't know yet" gap between one segment's END and the
// next segment's START, not a forced hand-off between them.

export type LIQUIDITY_ANCHOR_TYPE = 'START' | 'END'

export interface LiquidityHeatmapAnchor {
    type: LIQUIDITY_ANCHOR_TYPE

    direction: SIGNAL_DIRECTION

    price: number
    swingType: 'high' | 'low'

    pairId: string
    sequenceIndex: number

    confirmedOpenTime: number
    anchorOpenTime: number

    reasons: string[]
}