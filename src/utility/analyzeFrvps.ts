// analyzeFrvps.ts
//
// FRVP (Fixed-Range Volume Profile) confluence analyzer.
//
// Turns a chronological list of placed FRVP zones (candles + volume profile +
// OI, same shape as CandleEntryVisualizerComponent's per-profile JSON export)
// into a LONG / SHORT / NEUTRAL directional bias with a confidence %, plus
// the full breakdown of *why* (per-zone structure, scoring, pattern breaks,
// and next-zone historical validation) so the UI can show its work.
//
// Core principle: the useful signal isn't just where the POC is — it's
// whether price is being ACCEPTED around the POC or STRONGLY SEPARATING
// from it. OI is a confirmation/context signal on top of that, never a
// standalone directional signal by itself.
//
// All magic numbers live in THRESHOLDS / WEIGHTS below so they're easy to
// tune without hunting through the logic.

// ─── Input shape ────────────────────────────────────────────────────────────
// Matches CandleEntryVisualizerComponent's buildFrvpExportPayload() output
// (minus symbol/interval, which are passed in separately as batch meta).

export interface FrvpZoneCandle {
  openTime: number | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface FrvpZoneBucket {
  priceLow: number
  priceHigh: number
  buyVolume: number
  sellVolume: number
  totalVolume: number
  isPoc: boolean
}

export type FrvpZoneOpenInterest =
  | {
      status: 'ready'
      oiChangePct: number
      ratePerHour: number
      startOi?: number
      endOi?: number
      oiChangeAbs?: number
      period?: string
      pointCount?: number
    }
  | { status: 'no-data' | 'error' | 'not-fetched'; error?: string }

export interface FrvpZoneInput {
  /** Volume profile id / file order — carried through purely for display. */
  id: number | string
  startIndex: number
  endIndex: number
  candles: FrvpZoneCandle[]
  fixedRangeVolumeProfile: {
    rangeHighPrice: number
    rangeLowPrice: number
    pocPrice: number
    totalVolume: number
    buckets: FrvpZoneBucket[]
  }
  openInterest: FrvpZoneOpenInterest
}

// ─── Classification enums ───────────────────────────────────────────────────

export type PriceDirection = 'UP' | 'DOWN' | 'FLAT'
export type ClosePocRelation = 'ABOVE_POC' | 'BELOW_POC' | 'AT_POC'
export type PocPositionBand = 'LOW_POC' | 'MID_POC' | 'HIGH_POC'
export type PocDisplacementBand = 'NEAR_POC' | 'MODERATE_DISPLACEMENT' | 'STRONG_DISPLACEMENT'
export type HvnStructure = 'SINGLE_HVN' | 'MULTI_HVN'
export type HvnSpread = 'CLUSTERED' | 'SEPARATED' | 'LOWER_RANGE' | 'UPPER_RANGE' | 'DISTRIBUTED'
export type EdgeThickness = 'THIN_EDGES' | 'NORMAL_EDGES' | 'THICK_EDGES'
export type OiRegime = 'BUILDING' | 'UNWINDING' | 'FLAT' | 'UNAVAILABLE'
export type Bias = 'LONG' | 'SHORT' | 'NEUTRAL'
export type BiasStrength = 'NEUTRAL' | 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG'

/** Tunable thresholds. All percentages are expressed as plain numbers (0.10 = 0.10%, not 10%) unless noted. */
const THRESHOLDS = {
  priceFlatPct: 0.10,
  atPocPct: 0.05,
  pocPositionLow: 0.40,
  pocPositionHigh: 0.60,
  displacementNear: 0.15,
  displacementStrong: 0.30,
  hvnRelativeVolume: 0.70, // bucket counts as a node if >= 70% of the max bucket's volume
  hvnClusterSpread: 0.20, // normalized (0-1) spread between node midpoints below which nodes count as one cluster
  hvnDistributedSpread: 0.60,
  edgeBandFraction: 0.20, // outer 20% on each side = 40% total "edges", middle 60% is the core
  edgeThickRatio: 0.50, // edge volume / total volume above this = THICK_EDGES
  edgeThinRatio: 0.25, // below this = THIN_EDGES
  oiFlatPct: 0.10,
  minComparableSetups: 5, // section 16/20: below this, historical validation is "insufficient sample"
  minZonesForFullConfidence: 5,
}

/** Scoring weights, taken directly from the spec's section 12. */
const WEIGHTS = {
  strongAcceptanceOrRejection: 25, // LONG A/B, SHORT A/B (strong displacement variant)
  moderateAcceptanceOrRejection: 12, // LONG A/B, SHORT A/B (moderate displacement variant)
  continuationBonus: 15, // LONG C / SHORT C
  failedDisplacementReversal: 25, // LONG E / confirmed failed bullish positioning -> SHORT
  oiUnwindDirectional: 10, // LONG D / SHORT E
  oiBuildDirectional: 8, // LONG D(bullish build) / SHORT D
  hvnBonus: 4,
  edgeBonus: 3,
  contradictionPenalty: -10,
  severeContradictionPenalty: -15,
}

// ─── Per-zone structural classification ─────────────────────────────────────

export interface ZoneStructure {
  id: number | string
  startIndex: number
  endIndex: number
  firstOpen: number | null
  lastClose: number | null
  priceChangePct: number
  priceDirection: PriceDirection
  pocPrice: number
  rangeHigh: number
  rangeLow: number
  rangeSize: number
  closePocDistancePct: number
  closePocRelation: ClosePocRelation
  pocPosition: number
  pocPositionBand: PocPositionBand
  pocDisplacement: number
  pocDisplacementBand: PocDisplacementBand
  hvnCount: number
  hvnStructure: HvnStructure
  hvnSpread: HvnSpread
  edgeThickness: EdgeThickness
  oiRegime: OiRegime
  oiChangePct: number | null
  ratePerHour: number | null
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / (values.length || 1)
}

function classifyHvnStructure(
  buckets: FrvpZoneBucket[],
  rangeLow: number,
  rangeSize: number
): { hvnCount: number; hvnStructure: HvnStructure; hvnSpread: HvnSpread } {
  if (!buckets.length) return { hvnCount: 0, hvnStructure: 'SINGLE_HVN', hvnSpread: 'CLUSTERED' }

  const maxVol = Math.max(...buckets.map(b => b.totalVolume))
  const threshold = maxVol * THRESHOLDS.hvnRelativeVolume

  // Buckets come in price-ascending order (see computeVolumeProfile). Group
  // contiguous "significant" buckets into nodes rather than counting every
  // bucket over the threshold individually.
  const nodeMidpoints: number[] = []
  let clusterMids: number[] = []

  for (const b of buckets) {
    const significant = b.totalVolume >= threshold
    if (significant) {
      clusterMids.push((b.priceLow + b.priceHigh) / 2)
    } else if (clusterMids.length) {
      nodeMidpoints.push(average(clusterMids))
      clusterMids = []
    }
  }
  if (clusterMids.length) nodeMidpoints.push(average(clusterMids))

  const hvnCount = Math.max(nodeMidpoints.length, 1)
  const hvnStructure: HvnStructure = hvnCount <= 1 ? 'SINGLE_HVN' : 'MULTI_HVN'

  let hvnSpread: HvnSpread = 'CLUSTERED'
  if (hvnCount > 1) {
    const positions = nodeMidpoints.map(m => (m - rangeLow) / rangeSize)
    const spread = Math.max(...positions) - Math.min(...positions)
    const avg = average(positions)
    if (spread < THRESHOLDS.hvnClusterSpread) hvnSpread = 'CLUSTERED'
    else if (spread > THRESHOLDS.hvnDistributedSpread) hvnSpread = 'DISTRIBUTED'
    else if (avg < 0.4) hvnSpread = 'LOWER_RANGE'
    else if (avg > 0.6) hvnSpread = 'UPPER_RANGE'
    else hvnSpread = 'SEPARATED'
  }

  return { hvnCount, hvnStructure, hvnSpread }
}

function classifyEdgeThickness(
  buckets: FrvpZoneBucket[],
  rangeLow: number,
  rangeHigh: number,
  rangeSize: number,
  totalVolume: number
): EdgeThickness {
  if (!buckets.length || !totalVolume) return 'NORMAL_EDGES'

  const lowBound = rangeLow + THRESHOLDS.edgeBandFraction * rangeSize
  const highBound = rangeHigh - THRESHOLDS.edgeBandFraction * rangeSize

  let edgeVolume = 0
  for (const b of buckets) {
    const mid = (b.priceLow + b.priceHigh) / 2
    if (mid < lowBound || mid > highBound) edgeVolume += b.totalVolume
  }

  const ratio = edgeVolume / totalVolume
  if (ratio > THRESHOLDS.edgeThickRatio) return 'THICK_EDGES'
  if (ratio < THRESHOLDS.edgeThinRatio) return 'THIN_EDGES'
  return 'NORMAL_EDGES'
}

function classifyZoneStructure(zone: FrvpZoneInput): ZoneStructure {
  const candles = zone.candles.filter(c => c.open != null && c.close != null)
  const firstOpen = candles[0]?.open ?? null
  const lastClose = candles[candles.length - 1]?.close ?? null

  const priceChangePct = firstOpen != null && lastClose != null && firstOpen !== 0
    ? ((lastClose - firstOpen) / firstOpen) * 100
    : 0
  const priceDirection: PriceDirection =
    priceChangePct > THRESHOLDS.priceFlatPct ? 'UP' : priceChangePct < -THRESHOLDS.priceFlatPct ? 'DOWN' : 'FLAT'

  const { pocPrice, rangeHighPrice: rangeHigh, rangeLowPrice: rangeLow, buckets, totalVolume } =
    zone.fixedRangeVolumeProfile
  const rangeSize = rangeHigh - rangeLow || 1e-9

  const closePocDistancePct =
    lastClose != null && pocPrice ? ((lastClose - pocPrice) / pocPrice) * 100 : 0
  const closePocRelation: ClosePocRelation =
    Math.abs(closePocDistancePct) < THRESHOLDS.atPocPct
      ? 'AT_POC'
      : closePocDistancePct > 0
        ? 'ABOVE_POC'
        : 'BELOW_POC'

  const pocPosition = (pocPrice - rangeLow) / rangeSize
  const pocPositionBand: PocPositionBand =
    pocPosition < THRESHOLDS.pocPositionLow ? 'LOW_POC' : pocPosition > THRESHOLDS.pocPositionHigh ? 'HIGH_POC' : 'MID_POC'

  const pocDisplacement = lastClose != null ? Math.abs(lastClose - pocPrice) / rangeSize : 0
  const pocDisplacementBand: PocDisplacementBand =
    pocDisplacement < THRESHOLDS.displacementNear
      ? 'NEAR_POC'
      : pocDisplacement <= THRESHOLDS.displacementStrong
        ? 'MODERATE_DISPLACEMENT'
        : 'STRONG_DISPLACEMENT'

  const { hvnCount, hvnStructure, hvnSpread } = classifyHvnStructure(buckets, rangeLow, rangeSize)
  const edgeThickness = classifyEdgeThickness(buckets, rangeLow, rangeHigh, rangeSize, totalVolume)

  let oiRegime: OiRegime = 'UNAVAILABLE'
  let oiChangePct: number | null = null
  let ratePerHour: number | null = null
  if (zone.openInterest.status === 'ready') {
    oiChangePct = zone.openInterest.oiChangePct
    ratePerHour = zone.openInterest.ratePerHour
    oiRegime =
      oiChangePct > THRESHOLDS.oiFlatPct ? 'BUILDING' : oiChangePct < -THRESHOLDS.oiFlatPct ? 'UNWINDING' : 'FLAT'
  }

  return {
    id: zone.id,
    startIndex: zone.startIndex,
    endIndex: zone.endIndex,
    firstOpen,
    lastClose,
    priceChangePct,
    priceDirection,
    pocPrice,
    rangeHigh,
    rangeLow,
    rangeSize,
    closePocDistancePct,
    closePocRelation,
    pocPosition,
    pocPositionBand,
    pocDisplacement,
    pocDisplacementBand,
    hvnCount,
    hvnStructure,
    hvnSpread,
    edgeThickness,
    oiRegime,
    oiChangePct,
    ratePerHour,
  }
}

// ─── Per-zone scoring ────────────────────────────────────────────────────────

export interface ScoreReason {
  label: string
  side: 'LONG' | 'SHORT'
  weight: number
}

export interface ZoneScoreBreakdown {
  longScore: number
  shortScore: number
  reasons: ScoreReason[]
}

/**
 * Scores a single zone using ONLY that zone's own structure plus the PRIOR
 * zone (never a future zone) — see spec section 20 "avoid look-ahead bias".
 * The "failed displacement reversal" rules (LONG E / SHORT equivalent) are
 * causal: they use the prior zone's setup + this zone's own outcome, never
 * a zone that comes after this one.
 */
function scoreZone(s: ZoneStructure, prev: ZoneStructure | undefined): ZoneScoreBreakdown {
  let longScore = 0
  let shortScore = 0
  const reasons: ScoreReason[] = []

  const add = (side: 'LONG' | 'SHORT', weight: number, label: string) => {
    if (side === 'LONG') longScore += weight
    else shortScore += weight
    reasons.push({ label, side, weight })
  }

  const moderateOrStrongDisp = s.pocDisplacement >= THRESHOLDS.displacementNear
  const strongDisp = s.pocDisplacementBand === 'STRONG_DISPLACEMENT'

  // LONG A/B — bullish acceptance: low POC, price above it, meaningfully displaced.
  if (s.pocPositionBand === 'LOW_POC' && s.closePocRelation === 'ABOVE_POC' && moderateOrStrongDisp) {
    add(
      'LONG',
      strongDisp ? WEIGHTS.strongAcceptanceOrRejection : WEIGHTS.moderateAcceptanceOrRejection,
      strongDisp ? 'Low POC with strong bullish displacement' : 'Low POC with bullish acceptance'
    )
  }

  // SHORT A/B — bearish rejection: high POC, price below it, meaningfully displaced.
  if (s.pocPositionBand === 'HIGH_POC' && s.closePocRelation === 'BELOW_POC' && moderateOrStrongDisp) {
    add(
      'SHORT',
      strongDisp ? WEIGHTS.strongAcceptanceOrRejection : WEIGHTS.moderateAcceptanceOrRejection,
      strongDisp ? 'High POC with strong bearish displacement' : 'High POC with bearish rejection'
    )
  }

  // LONG C / SHORT C — continuation across consecutive zones.
  if (prev) {
    if (prev.closePocRelation === 'ABOVE_POC' && s.closePocRelation === 'ABOVE_POC' &&
        (prev.priceDirection === 'UP' || s.priceDirection === 'UP')) {
      add('LONG', WEIGHTS.continuationBonus, 'Repeated bullish acceptance above POC across zones')
    }
    if (prev.closePocRelation === 'BELOW_POC' && s.closePocRelation === 'BELOW_POC' && s.priceDirection === 'DOWN') {
      add('SHORT', WEIGHTS.continuationBonus, 'Repeated bearish rejection below POC across zones')
    }
  }

  // LONG D — bullish OI-unwinding continuation (short covering read).
  if (s.oiRegime === 'UNWINDING' && s.priceDirection === 'UP' && s.closePocRelation === 'ABOVE_POC' && s.pocPositionBand === 'LOW_POC') {
    add('LONG', WEIGHTS.oiUnwindDirectional, 'Price rising with OI unwinding above a low POC (short covering)')
  }
  // SHORT E — bearish OI-unwinding (long liquidation read).
  if (s.oiRegime === 'UNWINDING' && s.priceDirection === 'DOWN' && s.closePocRelation === 'BELOW_POC') {
    add('SHORT', WEIGHTS.oiUnwindDirectional, 'Price falling with OI unwinding below POC (long liquidation)')
  }
  // SHORT D — bearish OI-building.
  if (s.oiRegime === 'BUILDING' && s.priceDirection === 'DOWN' && s.closePocRelation === 'BELOW_POC') {
    add('SHORT', WEIGHTS.oiBuildDirectional, 'New positioning building while price falls below POC')
  }
  // Symmetric bullish OI-building.
  if (s.oiRegime === 'BUILDING' && s.priceDirection === 'UP' && s.closePocRelation === 'ABOVE_POC') {
    add('LONG', WEIGHTS.oiBuildDirectional, 'New positioning building while price rises above POC')
  }

  // LONG E / SHORT equivalent — failed displacement reversal (causal: prior
  // zone's setup, confirmed or denied by THIS zone's own outcome).
  if (prev) {
    const prevBearishDisplacement =
      prev.priceDirection === 'DOWN' && prev.oiRegime === 'BUILDING' &&
      prev.closePocRelation === 'BELOW_POC' && prev.pocDisplacementBand === 'STRONG_DISPLACEMENT'
    if (prevBearishDisplacement && (s.closePocRelation === 'ABOVE_POC' || s.priceDirection === 'UP')) {
      add('LONG', WEIGHTS.failedDisplacementReversal,
        'Previous bearish displacement (OI building) failed to continue — price recovering')
    }

    const prevBullishDisplacement =
      prev.priceDirection === 'UP' && prev.oiRegime === 'BUILDING' &&
      prev.closePocRelation === 'ABOVE_POC' && prev.pocDisplacementBand === 'STRONG_DISPLACEMENT'
    if (prevBullishDisplacement && (s.closePocRelation === 'BELOW_POC' || s.priceDirection === 'DOWN')) {
      add('SHORT', WEIGHTS.failedDisplacementReversal,
        'Previous bullish positioning (OI building) failed to continue — price fading')
    }
  }

  // Secondary: multi-HVN skew bonus (never a standalone signal).
  if (s.hvnStructure === 'MULTI_HVN') {
    if (s.pocPositionBand === 'LOW_POC' && s.closePocRelation === 'ABOVE_POC') {
      add('LONG', WEIGHTS.hvnBonus, 'Multi-HVN structure skewed bullish (low POC, price above)')
    } else if (s.pocPositionBand === 'HIGH_POC' && s.closePocRelation === 'BELOW_POC') {
      add('SHORT', WEIGHTS.hvnBonus, 'Multi-HVN structure skewed bearish (high POC, price below)')
    }
  }

  // Secondary: thick-edge confirmation of a strong displacement.
  if (s.edgeThickness === 'THICK_EDGES' && strongDisp) {
    if (s.closePocRelation === 'ABOVE_POC') add('LONG', WEIGHTS.edgeBonus, 'Thick edge volume confirms bullish displacement')
    else if (s.closePocRelation === 'BELOW_POC') add('SHORT', WEIGHTS.edgeBonus, 'Thick edge volume confirms bearish displacement')
  }

  // Contradiction penalties: price + OI directly opposing the structural lean.
  if (longScore > shortScore && s.priceDirection === 'DOWN' && s.oiRegime === 'BUILDING' && s.closePocRelation === 'BELOW_POC') {
    const penalty = s.pocDisplacementBand === 'STRONG_DISPLACEMENT' ? WEIGHTS.severeContradictionPenalty : WEIGHTS.contradictionPenalty
    longScore = Math.max(0, longScore + penalty)
    reasons.push({ label: 'Contradiction: bullish structure vs bearish price + building OI', side: 'LONG', weight: penalty })
  }
  if (shortScore > longScore && s.priceDirection === 'UP' && s.oiRegime === 'BUILDING' && s.closePocRelation === 'ABOVE_POC') {
    const penalty = s.pocDisplacementBand === 'STRONG_DISPLACEMENT' ? WEIGHTS.severeContradictionPenalty : WEIGHTS.contradictionPenalty
    shortScore = Math.max(0, shortScore + penalty)
    reasons.push({ label: 'Contradiction: bearish structure vs bullish price + building OI', side: 'SHORT', weight: penalty })
  }

  return { longScore, shortScore, reasons }
}

function biasFromScore(score: ZoneScoreBreakdown): { bias: Bias; advantage: number } {
  const net = score.longScore - score.shortScore
  const advantage = Math.abs(net)
  if (advantage < 10) return { bias: 'NEUTRAL', advantage }
  return { bias: net > 0 ? 'LONG' : 'SHORT', advantage }
}

function biasStrengthLabel(advantage: number): BiasStrength {
  if (advantage < 10) return 'NEUTRAL'
  if (advantage < 20) return 'WEAK'
  if (advantage < 35) return 'MODERATE'
  if (advantage < 50) return 'STRONG'
  return 'VERY_STRONG'
}

// ─── Pattern break detection ─────────────────────────────────────────────────

export type PatternBreak =
  | 'BULLISH_PATTERN_BREAK'
  | 'BEARISH_PATTERN_BREAK'
  | 'BEARISH_DISPLACEMENT_FAILURE'
  | 'BULLISH_POSITIONING_FAILURE'
  | null

function detectPatternBreak(s: ZoneStructure, prev: ZoneStructure | undefined): PatternBreak {
  if (!prev) return null

  const prevBullishSetup = prev.pocPositionBand === 'LOW_POC' && prev.closePocRelation === 'ABOVE_POC'
  if (prevBullishSetup && s.closePocRelation === 'BELOW_POC' && s.priceDirection === 'DOWN') {
    return 'BULLISH_PATTERN_BREAK'
  }

  const prevBearishSetup = prev.pocPositionBand === 'HIGH_POC' && prev.closePocRelation === 'BELOW_POC'
  if (prevBearishSetup && s.closePocRelation === 'ABOVE_POC' && s.priceDirection === 'UP') {
    return 'BEARISH_PATTERN_BREAK'
  }

  if (prev.priceDirection === 'DOWN' && prev.oiRegime === 'BUILDING' && s.priceDirection === 'UP') {
    return 'BEARISH_DISPLACEMENT_FAILURE'
  }
  if (prev.priceDirection === 'UP' && prev.oiRegime === 'BUILDING' && s.priceDirection === 'DOWN') {
    return 'BULLISH_POSITIONING_FAILURE'
  }

  return null
}

const PATTERN_LABELS: Record<Exclude<PatternBreak, null>, string> = {
  BULLISH_PATTERN_BREAK: 'BULLISH PATTERN BREAK',
  BEARISH_PATTERN_BREAK: 'BEARISH PATTERN BREAK',
  BEARISH_DISPLACEMENT_FAILURE: 'FAILED BEARISH DISPLACEMENT',
  BULLISH_POSITIONING_FAILURE: 'FAILED BULLISH POSITIONING',
}

const PATTERN_EXPLANATIONS: Record<string, string> = {
  'BULLISH ACCEPTANCE':
    'Price is holding above a volume-accepted area with enough separation to suggest genuine migration higher.',
  'BEARISH REJECTION':
    'Price is holding below a volume-accepted area with enough separation to suggest genuine rejection lower.',
  'BULLISH PATTERN BREAK':
    'A prior bullish acceptance setup failed to hold — price fell back below the POC.',
  'BEARISH PATTERN BREAK':
    'A prior bearish rejection setup failed to hold — price reclaimed the POC to the upside.',
  'FAILED BEARISH DISPLACEMENT':
    'Price pushed down with OI building, but the move failed to continue and price is recovering — likely trapped short positioning.',
  'FAILED BULLISH POSITIONING':
    'Price pushed up with OI building, but the move failed to continue and price is fading — likely trapped long positioning.',
  'BULLISH LEAN': 'Structure leans bullish but without enough confluence for a strong signal.',
  'BEARISH LEAN': 'Structure leans bearish but without enough confluence for a strong signal.',
  'NO CLEAR PATTERN': 'No single structure or OI signal dominates; conditions are mixed or too weak to lean either way.',
}

function choosePatternLabel(score: ZoneScoreBreakdown, patternBreak: PatternBreak): string {
  if (patternBreak) return PATTERN_LABELS[patternBreak]
  if (score.longScore >= WEIGHTS.strongAcceptanceOrRejection) return 'BULLISH ACCEPTANCE'
  if (score.shortScore >= WEIGHTS.strongAcceptanceOrRejection) return 'BEARISH REJECTION'
  if (score.longScore > score.shortScore && score.longScore > 0) return 'BULLISH LEAN'
  if (score.shortScore > score.longScore && score.shortScore > 0) return 'BEARISH LEAN'
  return 'NO CLEAR PATTERN'
}

// ─── Full zone analysis + batch result ──────────────────────────────────────

export interface NextZoneOutcome {
  actualDirection: PriceDirection
  /** null when this zone's own signal was NEUTRAL (no directional claim to check). */
  predictedCorrect: boolean | null
}

export interface ZoneAnalysis {
  id: number | string
  startIndex: number
  endIndex: number
  structure: ZoneStructure
  score: ZoneScoreBreakdown
  /** This zone's own causal signal — what it implies for the zone AFTER it. */
  signal: Bias
  patternLabel: string
  patternBreak: PatternBreak
  /** Present for every zone except the last (needs a following zone to compare against). */
  nextZone?: NextZoneOutcome
}

export interface HistoricalValidation {
  comparableSetups: number
  correct: number
  /** Percentage 0-100, or null when sample size is below THRESHOLDS.minComparableSetups. */
  accuracy: number | null
  insufficientSample: boolean
}

export interface FrvpAnalysisResult {
  symbol: string
  interval: string
  zonesAnalyzed: number
  oiCoverage: { withOi: number; total: number }
  bias: Bias
  confidencePct: number
  biasStrength: BiasStrength
  /** Top 3-5 reasons behind the current bias, strongest first. */
  reasons: string[]
  warnings: string[]
  currentStructure: ZoneStructure
  patternDetected: string
  patternExplanation: string
  historicalValidation: HistoricalValidation
  /** Chronological, oldest first. */
  zones: ZoneAnalysis[]
  narrative: string
}

function buildReasons(latest: ZoneAnalysis, bias: Bias): string[] {
  if (bias === 'NEUTRAL') return []
  const relevant = latest.score.reasons.filter(r => r.side === bias && r.weight > 0)
  return [...relevant].sort((a, b) => b.weight - a.weight).slice(0, 5).map(r => r.label)
}

function buildWarnings(oiReadyCount: number, totalZones: number, latest: ZoneAnalysis): string[] {
  const warnings: string[] = []
  if (oiReadyCount < totalZones) {
    warnings.push(`OI data unavailable for ${totalZones - oiReadyCount}/${totalZones} zones`)
  }
  if (latest.structure.hvnStructure === 'MULTI_HVN') {
    warnings.push('Multi-HVN structure reduces directional certainty')
  }
  if (latest.structure.pocDisplacementBand === 'STRONG_DISPLACEMENT') {
    warnings.push('Current move is unusually extended from its POC')
  }
  if (totalZones < THRESHOLDS.minZonesForFullConfidence) {
    warnings.push('Small sample size — treat this bias as exploratory, not statistically reliable')
  }
  return warnings
}

function buildHistoricalValidation(zones: ZoneAnalysis[], bias: Bias): HistoricalValidation {
  if (bias === 'NEUTRAL') {
    return { comparableSetups: 0, correct: 0, accuracy: null, insufficientSample: true }
  }
  const comparable = zones
    .slice(0, -1)
    .filter(z => z.signal === bias && z.nextZone && z.nextZone.predictedCorrect !== null)
  const correct = comparable.filter(z => z.nextZone!.predictedCorrect).length
  const insufficientSample = comparable.length < THRESHOLDS.minComparableSetups
  return {
    comparableSetups: comparable.length,
    correct,
    accuracy: insufficientSample ? null : Math.round((correct / comparable.length) * 1000) / 10,
    insufficientSample,
  }
}

function buildNarrative(bias: Bias, confidencePct: number, latest: ZoneAnalysis, warnings: string[]): string {
  const caveat = warnings.length ? ` ${warnings.join('. ')}.` : ''
  if (bias === 'NEUTRAL') {
    return (
      `NEUTRAL ${confidencePct}% — The profile contains competing signals; no single structure or OI read ` +
      `has enough strength to justify a directional bias.${caveat}`
    )
  }
  const lead = [...latest.score.reasons]
    .filter(r => r.side === bias && r.weight > 0)
    .sort((a, b) => b.weight - a.weight)[0]?.label.toLowerCase() ?? 'the current structure'
  return (
    `${bias} ${confidencePct}% — driven by ${lead}.${caveat} This reflects confidence in the directional bias, ` +
    `not a probability that price will move by this exact percentage.`
  )
}

/**
 * Analyzes a chronological batch of FRVP zones and returns the full
 * confluence-based directional read. Returns null if given no zones.
 *
 * `zones` must be sorted oldest-first (matches the "Download FRVPs" zip
 * ordering / frvp_01, frvp_02, ... convention).
 */
export function analyzeFrvps(
  zones: FrvpZoneInput[],
  meta: { symbol: string; interval: string }
): FrvpAnalysisResult | null {
  if (zones.length === 0) return null

  const structures = zones.map(classifyZoneStructure)

  const zoneAnalyses: ZoneAnalysis[] = structures.map((structure, i) => {
    const prev = i > 0 ? structures[i - 1] : undefined
    const score = scoreZone(structure, prev)
    const patternBreak = detectPatternBreak(structure, prev)
    const patternLabel = choosePatternLabel(score, patternBreak)
    const { bias: signal } = biasFromScore(score)
    return {
      id: zones[i].id,
      startIndex: zones[i].startIndex,
      endIndex: zones[i].endIndex,
      structure,
      score,
      signal,
      patternLabel,
      patternBreak,
    }
  })

  // Next-zone historical validation: causal at the time each signal was made
  // (zone i's signal only ever used zone i and earlier), checked here against
  // what actually happened in zone i+1.
  for (let i = 0; i < zoneAnalyses.length - 1; i++) {
    const actualDirection = structures[i + 1].priceDirection
    const predicted = zoneAnalyses[i].signal
    const predictedCorrect =
      predicted === 'NEUTRAL'
        ? null
        : (predicted === 'LONG' && actualDirection === 'UP') || (predicted === 'SHORT' && actualDirection === 'DOWN')
    zoneAnalyses[i].nextZone = { actualDirection, predictedCorrect }
  }

  const latest = zoneAnalyses[zoneAnalyses.length - 1]
  const { bias, advantage } = biasFromScore(latest.score)
  const biasStrength = biasStrengthLabel(advantage)

  const oiReadyCount = zones.filter(z => z.openInterest.status === 'ready').length
  let confidenceCap = 90
  if (oiReadyCount < zones.length) confidenceCap = Math.min(confidenceCap, 80)
  if (zones.length < THRESHOLDS.minZonesForFullConfidence) confidenceCap = Math.min(confidenceCap, 70)
  const confidencePct = Math.round(Math.min(50 + advantage, confidenceCap))

  const reasons = buildReasons(latest, bias)
  const warnings = buildWarnings(oiReadyCount, zones.length, latest)
  const historicalValidation = buildHistoricalValidation(zoneAnalyses, bias)
  const narrative = buildNarrative(bias, confidencePct, latest, warnings)

  return {
    symbol: meta.symbol,
    interval: meta.interval,
    zonesAnalyzed: zones.length,
    oiCoverage: { withOi: oiReadyCount, total: zones.length },
    bias,
    confidencePct,
    biasStrength,
    reasons,
    warnings,
    currentStructure: latest.structure,
    patternDetected: latest.patternLabel,
    patternExplanation: PATTERN_EXPLANATIONS[latest.patternLabel] ?? '',
    historicalValidation,
    zones: zoneAnalyses,
    narrative,
  }
}