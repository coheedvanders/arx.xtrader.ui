import type { NumberLiteralType } from "typescript"

export interface TrendLine {
  slope: number
  yIntercept: number
  points: [number, number][] // [index, price] pairs
  type: 'uptrend' | 'downtrend'
  strength: number // number of touches/confirmation
}

export interface ReactionData {
    direction: "UP" | "DOWN" | "MIXED";
    strength: number; // 0-100%
    highest_price: number;
    lowest_price: number;
    price_range: number;
    avg_momentum: number;
    volume_increased: boolean;
}

export interface BalanceResponse {
  balance: number;
  mbx_weight: number;
  unrealized_pnl: number;
}
export interface PriceZoneInteraction {
    touchCount: number;              // How many times price touched the zone boundary
    bounceCount: number;             // How many times price bounced off boundaries
    breakoutCount: number;           // How many times price broke out of zone
    timeInZone: number;              // Candles spent inside the zone
    timeOutsideZone: number;         // Candles spent outside the zone
    avgDistanceFromCenter: number;   // Average distance from zone midpoint
    extremePoint: "upper" | "lower" | null;  // Which boundary was touched most
    strengthScore: number;           // 0-100 score of zone integrity
    lastInteraction: "touch" | "bounce" | "breakout" | null;
    volatilityInZone: number;        // Average volatility while inside zone
    volatilityOutsideZone: number;   // Average volatility while outside zone
    volatilityRatio: number;         // Inside volatility / Outside volatility
    breakoutVelocity: number;        // Average speed when breaking out
    approachVelocity: number;        // Average speed when approaching boundaries
    momentumOnBreakout: "strong" | "moderate" | "weak" | null;  // Breakout strength
    pressureDirection: "bullish" | "bearish" | "neutral";  // Overall directional bias
    distanceToMid: string
    lastBreakoutChange:number,
    breakoutType: "breakout_start" | "breakout_cont" | null;
    breakoutStartScore: BreakoutStartScore | null
}

export interface TradeLog {
  id?: number;
  timestamp: number;
  localTime: string;
  symbol: string;
  side: string;
  support: { lower: number; upper: number };
  resistance: { lower: number; upper: number };
  currentPrice: number;
  tpsl: { tp: number; sl: number };
  currentCandleData: CandleData;
  isOpen: boolean;
  result: string;
  pnlPercentage: { highest: number; lowest: number };
  exitPrice: number | null;
  exitTimeStamp: number | null;
  exitLocalTime: string | null;
  duration: number | null;
  zoneAnalysis: ZoneAnalysis;
  pastVolumeAnalysis: PastVolumeAnalysis;
  pnl: number | null;
  margin: number;
  leverage: number;
  takerFee: number;
  volumeAnalysis: VolumeAnalysis;
  candleOpenTime: number;
}

export interface FuturesSymbol{
  symbol: string;
  maxLeverage: number;
  status: string;
  simulationStats:SimulationStats;
}

export interface PastVolumeAnalysis{
    pastAvgVolume: number,
    volumeTrend: string,
    spikeFlag:boolean,
    dominantDirection:string
}

export interface SimulationStats{
  won:number;
  loss:number;
  open:number;
  mid: number;
  takerFee:number;
  closedPnl:number;
  wonPnl:number;
  lossPnl:number;
  openPnl:number
}

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
  closed: boolean
  support: PriceZone | null
  resistance: PriceZone | null
  breakthrough_resistance:boolean;
  breakthrough_support:boolean;
}

export interface BreakoutStartScore {
    momentumScore: number;           // How aggressive the breakout (0-25)
    sustainabilityScore: number;     // Will it continue or revert (0-25)
    volumeProfile: number;           // Distance penetrated (0-20)
    rejectionStrength: number;       // Wick strength (0-15)
    compositeScore: number;          // Total (0-85)
    recommendation: "strong_buy" | "moderate_buy" | "weak_buy" | "skip";
}

export interface CloseAbsDistanceToZone{
  upper: number
  mid: number
  lower: number
}
export interface PriceZoneEvaluation {
    bulls: number;
    bears: number;
    dojis: number;
    bear_change: number;
    bull_change: number;
}
export interface CandleEntry {
  symbol: string;
  openTime: number
  open: number
  high: number
  low: number
  close: number
  close_atr_adjusted: number
  close_atr_abs_change: number
  volume: number
  closeTime: number
  duration: number
  closed: boolean
  support: PriceZone | null
  resistance: PriceZone | null
  breakthrough_resistance:boolean;
  breakthrough_support:boolean;
  status: string;
  side: string;
  tpPrice: number,
  slPrice: number,
  zoneAnalysis: ZoneAnalysis | null,
  volumeAnalysis: VolumeAnalysis | null
  overboughSoldAnalysis: OverboughtOversoldAnalysis | null
  pastVolumeAnalysis: PastVolumeAnalysis | null
  candleData: CandleData | null
  pnl: number;
  leverage:number;
  margin: number;
  entryFee: number;
  priceZone: PriceZone | null;
  priceZoneInteraction: PriceZoneInteraction | null
  closeAbsDistanceToZone: CloseAbsDistanceToZone | null
  priceZoneEvaluation: PriceZoneEvaluation | null
  patternTrack: string
}

interface CandleSnapshot {
  o: number;
  h: number;
  l: number;
  c: number;
  volume: number;
  volume_change_percentage: number;
  body_v: number;
  top_wick_v: number;
  bottom_wick_v: number;
  strength_v: number;
  change_percentage_v: number;
  side: "bull" | "bear";
  closeLocation: number; // 0-100: where close sits in range
}


export interface TrendConfirmation {
  isConfirmed: boolean;
  consecutiveCount: number;
  hasVolumeSpike: boolean;
  reason: string;
}

export interface CandleData {
  o: number;
  h: number;
  l: number;
  c: number;
  openTime: number;
  volume: number;
  volume_change_percentage: number,
  body_v: number;
  top_wick_v: number;
  bottom_wick_v: number;
  strength_v: number;
  change_percentage_v: number;
  side: "bull" | "bear";
  previousCandleData: CandleData[] | null;
  ema200: number;
  pastBelowEma:number
  pastAboveEma:number
  emaLevel: "above" | "below",
  volumeSpike:boolean;
  zoneInhabitantCount: number;
  lookbackChangePercentage: number
  lookbackTrend: string
  atr:number
  isNewZone:boolean
  proximityToZoneEdge: string
  atrVolatility: string
  zoneSizePercentage: number;
  extraInfo: string
  isIndecisive:boolean
  isLongPotential:boolean;
  isShortPotential:boolean;
  conditionMet: string;
  priceMove:string;
  pastZoneOverStatePriceReaction: string;
  spaceTakenInZoneLevel:number;
  pastCandleAverageChange:number;
  absCandleSize: number;
}


export interface VolumeAnalysis {
  /** Total traded volume for the current candle. */
  totalVolume: number;

  /** Estimated total buy-side volume within the candle (executed at ask). */
  buyVolume: number;

  /** Estimated total sell-side volume within the candle (executed at bid). */
  sellVolume: number;

  /** Net difference between buyVolume and sellVolume (buyVolume - sellVolume). */
  deltaVolume: number;

  /** Ratio of deltaVolume to totalVolume, indicating buy/sell imbalance intensity. */
  deltaRatio: number;

  /** Average total volume across the last 20 candles for normalization/comparison. */
  avgVolumeLookback20: number;

  /** Z-score of totalVolume against the lookback mean; used to identify abnormal spikes. */
  zScore: number;

  /** True if the zScore exceeds a defined threshold, flagging a significant volume spike. */
  spikeFlag: boolean;

  /** Relative absorption strength, measuring passive liquidity response to aggressive volume. */
  absorptionIndex: number;

  /** True if volume delta direction aligns with momentum direction (confirming trend). */
  deltaAlignment: boolean;

  /** Correlation between recent volume change and price momentum (positive = confirming move). */
  corrVolumeMomentum: number;

  /** Volume-weighted average price for the current candle. */
  vwap: number;

  /** Percent deviation of current price from VWAP; positive = price above VWAP. */
  vwapDeviationPercent: number;

  /** Pressure index representing the net force of sellers vs buyers; negative = sell pressure. */
  volumePressure: number;
}

export interface OverboughtOversoldAnalysis {
    extremeLevel: string
    score: number; // -100 to +100 (negative = oversold, positive = overbought)
    signals: string[];
    confidence: number; // 0-1
    rejectionProbability: number; // likelihood of pullback
}

export interface ZoneAnalysis {
  /** Proximity of current price to nearest zone boundary, expressed as percentage (0–100). */
  priceProximityCloseToZone: number;

  /** Historical count of candle interactions within this zone. */
  pastInteractionsToZoneCount: number;

  /** Dominant price direction prior to current zone approach. */
  pastTrend: 'sideways' | 'bearish' | 'bullish';

  /** Current price momentum strength approaching the zone. */
  momentum: number;

  /** Width of the price zone (upper - lower), representing sensitivity or buffer area. */
  zoneWidth: number;

  /** Type of the zone (support or resistance). */
  zoneType: string;

  /** Relative reliability of the zone derived from past reactions and structure strength (0–1). */
  zoneStrength: number;

  /** True if the current candle made physical contact with the zone boundaries. */
  zoneTouchDetected: boolean;

  /** Velocity of price reaction after zone contact; higher = faster reversal. */
  reactionVelocity: number;

  /** Combined confluence score of volume spike and structural alignment at the zone. */
  volumeConfluence: number;

  /** True if the current candle shows reversal characteristics (e.g., engulfing, pin, strong counter body). */
  currentCandleReversal: boolean;

  /** Relative volatility level around the zone based on recent candle ranges. */
  volatilityScore: number;

  /** Scaled score indicating how close current price sits relative to total zone width (0–10 scale). */
  proximityScore: number;

  /** Confidence in the proximity measurement (statistical reliability). */
  proximityConfidence: number;

  /** Overall signal confidence combining volume, structure, and momentum conditions. */
  signalConfidence: number;

  /** Strength of the last interaction with the zone (reaction intensity and duration). */
  interactionStrength: number;

  /** Strength factor derived purely from price momentum (normalized). */
  momentumStrength: number;

  /** Total time in milliseconds that price remained within zone boundaries. */
  timeInZoneMs: number;

  /** Probability of breakout beyond zone boundary rather than bounce (0–1). */
  breakoutProbability: number;

  /** Aggregated directional bias computed from trend, momentum, and breakout metrics. */
  overallBias: 'long' | 'short' | 'neutral';

  pastResistanceBreakCount: number;

  pastSupportBreakCount: number;
}


export interface PriceLevel {
  price: number
  strength: number
  touches: number
  volume: number
}

export interface TrendAnalysis {
  type: 'uptrend' | 'downtrend' | 'reversing' | 'neutral'
  strength: number
  swingHighs: number[]
  swingLows: number[]
  currentDirection: string
}

export interface OrderBookPressure {
  buyVolume: number
  sellVolume: number
  buyPercentage: number
  sellPercentage: number
}

export interface CandleStory {
  openPrice: number
  highestPrice: number
  lowestPrice: number
  averageBuyPercentage: number
  averageSellPercentage: number
  volumeProfile: number[]
  priceHistory: number[]
  buyPressureHistory: number[]
  sellPressureHistory: number[]
  highestBuyPressure: number
  highestSellPressure: number
  totalSamples: number
}

export interface ManipulationDetection {
  volumePriceDisconnect: number
  srBreakAndRecover: number
  orderBookMomentumMismatch: number
  wickRejection: number
  overallManipulationScore: number
  isManipulated: boolean
}

export interface MarketAnalyzerProps {
  symbol: string
  depth?: number
}

export interface PriceZone {
  lower: number
  upper: number
  mid: number
}

export interface SymbolTickerProps {
  symbol: string,
  isOpen: false,
}

export interface Metrics {
  bidAskSpread: number
  tickRatio: number
  microTrendSlope: number
  deltaVolume: number
  obPressure: number
  cumulativeDelta: number
  tickVolatility: number
  spreadChangeRate: number
  executionSpeed: number
}

export interface DataPoint {
  timestamp: number
  metrics: Metrics
  priceLevel: number
}

export interface Prediction {
  direction: 'UP' | 'DOWN' | 'CONSOLIDATING'
  confidence: number
  timeframe: string
  label: string
  strength: number
}