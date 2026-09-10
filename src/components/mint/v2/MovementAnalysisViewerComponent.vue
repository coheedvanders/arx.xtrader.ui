<template>
  <div class="mav">

    <div class="mav-header">
      <div><span class="mav-label">Symbol</span><span class="mav-value">{{ report.metadata.symbol || "current" }}</span></div>
      <div><span class="mav-label">Interval</span><span class="mav-value">{{ report.metadata.interval }}</span></div>
      <div><span class="mav-label">Candles</span><span class="mav-value">{{ report.metadata.candleCount }}</span></div>
      <div><span class="mav-label">Range</span><span class="mav-value">{{ formatRange(report.metadata.startTime, report.metadata.endTime) }}</span></div>
      <div><span class="mav-label">Generated</span><span class="mav-value">{{ formatDate(report.metadata.generatedAt) }}</span></div>
    </div>

    <!-- Legend, once, for every stacked outcome bar below -->
    <div class="mav-legend">
      <span v-for="seg in LEGEND" :key="seg.key" class="mav-legend-item">
        <span class="mav-swatch" :style="{ background: seg.color }"></span>{{ seg.label }}
      </span>
    </div>

    <!-- ── Price Action funnel — the headline section ───────────────── -->
    <section class="mav-section">
      <h3>Price Action — how far do sweeps get?</h3>
      <div class="mav-funnel">
        <div v-for="f in priceActionFunnel" :key="f.stage" class="mav-funnel-row">
          <span class="mav-funnel-label">{{ f.stage }}</span>
          <div class="mav-funnel-track">
            <div class="mav-funnel-fill" :style="{ width: f.pct + '%', background: f.color }"></div>
          </div>
          <span class="mav-funnel-count">{{ f.count }} ({{ f.pct.toFixed(0) }}%)</span>
        </div>
      </div>
      <div class="mav-substats">
        <span>Median candles to reject: {{ medianOf(paTimes.reject) }}</span>
        <span>to reclaim: {{ medianOf(paTimes.reclaim) }}</span>
        <span>to displace: {{ medianOf(paTimes.displace) }}</span>
        <span>to confirm: {{ medianOf(paTimes.confirm) }}</span>
        <span>censored: {{ censoredPaCount }} / {{ report.priceActionSequenceOutcomes.length }}</span>
      </div>
    </section>

    <!-- ── Anchor lifecycle ─────────────────────────────────────────── -->
    <section class="mav-section">
      <h3>Liquidity Anchors</h3>
      <div class="mav-anchor-grid">
        <div v-for="side in ANCHOR_SIDES" :key="side" class="mav-anchor-side">
          <div class="mav-anchor-side-title">{{ side }} ({{ anchorCounts(side).total }})</div>
          <div v-for="row in anchorCounts(side).rows" :key="row.status" class="mav-badge-row">
            <span class="mav-badge" :class="anchorBadgeClass(row.status)">{{ row.status }}</span>
            <span>{{ row.count }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Sweep events: swept vs control comparison ───────────────── -->
    <section class="mav-section">
      <h3>Sweeps — does sweeping change the outcome?</h3>
      <div class="mav-substats">
        <span>SWEPT runs: {{ sweepCounts.swept }}</span>
        <span>NO_SWEEP (control) runs: {{ sweepCounts.control }}</span>
        <span>median sweptRatio: {{ medianOf(sweptRatios) }}</span>
      </div>
      <div class="mav-compare-row">
        <div class="mav-compare-label">Swept</div>
        <OutcomeBar :dist="sweptOutcome" />
      </div>
      <div class="mav-compare-row">
        <div class="mav-compare-label">Not swept (control)</div>
        <OutcomeBar :dist="controlOutcome" />
      </div>
    </section>

    <!-- ── State bucket reports ─────────────────────────────────────── -->
    <section class="mav-section" v-for="rep in report.stateBucketReports" :key="rep.module + rep.field">
      <h3>{{ rep.module }}.{{ rep.field }}</h3>
      <div v-for="b in sortedBuckets(rep.buckets)" :key="b.category" class="mav-bucket-row">
        <div class="mav-bucket-label">
          {{ b.category }}
          <span class="mav-n">n={{ b.sampleCount }}</span>
        </div>
        <OutcomeBar :dist="b.outcome" />
        <div class="mav-bucket-meta" v-if="b.runLengthPercentiles">
          run len p50: {{ b.runLengthPercentiles.p50.toFixed(1) }}
        </div>
      </div>
    </section>

    <!-- ── Combinations ─────────────────────────────────────────────── -->
    <section class="mav-section">
      <h3>Alignment count (how many independent signals agree)</h3>
      <div v-for="a in report.combinations.alignmentCounts" :key="a.alignedSignalCount + '/' + a.totalSignalsConsidered" class="mav-bucket-row">
        <div class="mav-bucket-label">
          {{ a.alignedSignalCount }}/{{ a.totalSignalsConsidered }} aligned
          <span class="mav-n">n={{ a.sampleCount }}</span>
        </div>
        <OutcomeBar :dist="a.outcome" />
      </div>

      <h3 class="mav-subheading">Pairwise combinations <span class="mav-hint">(reversal is structurally 0% here — no reference direction; read as chop vs. real move)</span></h3>
      <div v-for="p in sortedPairwise" :key="p.combinationId" class="mav-bucket-row">
        <div class="mav-bucket-label">
          {{ p.valueA }} × {{ p.valueB }}
          <span class="mav-n" :class="{ 'mav-n-warn': p.belowMinSampleSize }">n={{ p.sampleCount }}{{ p.belowMinSampleSize ? ' (thin)' : '' }}</span>
        </div>
        <OutcomeBar :dist="p.outcome" />
      </div>

      <h3 class="mav-subheading">Sweep magnitude vs. how far the sequence went</h3>
      <div v-for="s in report.combinations.sweepMagnitudeVsTerminalStage" :key="s.sweptRatioTercile" class="mav-bucket-row">
        <div class="mav-bucket-label">{{ s.sweptRatioTercile }} <span class="mav-n">n={{ s.sampleCount }}</span></div>
        <div class="mav-stage-badges">
          <span v-for="(count, stage) in s.terminalStageCounts" :key="stage" class="mav-badge" :class="anchorBadgeClass(String(stage))">
            {{ stage }}: {{ count }}
          </span>
        </div>
      </div>
    </section>

    <!-- ── Magnet analysis ──────────────────────────────────────────── -->
    <section class="mav-section" v-if="report.magnetAnalysis.length">
      <h3>Magnet Analysis — target vs. random control</h3>
      <div class="mav-substats">
        <span>triggers: {{ report.magnetAnalysis.length }}</span>
        <span>censored: {{ magnetCensored }}</span>
        <span>drained by another sweep: {{ magnetDrained }}</span>
      </div>
      <div class="mav-compare-row">
        <div class="mav-compare-label">Target hit rate</div>
        <div class="mav-simple-bar-track"><div class="mav-simple-bar-fill" :style="{ width: magnetTargetHitPct + '%', background: '#2dd4bf' }"></div></div>
        <span class="mav-n">{{ magnetTargetHitPct.toFixed(0) }}% (median {{ medianOf(magnetTimes.target) }} candles)</span>
      </div>
      <div class="mav-compare-row">
        <div class="mav-compare-label">Control hit rate</div>
        <div class="mav-simple-bar-track"><div class="mav-simple-bar-fill" :style="{ width: magnetControlHitPct + '%', background: '#a78bfa' }"></div></div>
        <span class="mav-n">{{ magnetControlHitPct.toFixed(0) }}% (median {{ medianOf(magnetTimes.control) }} candles)</span>
      </div>
      <div class="mav-hint" v-if="Math.abs(magnetTargetHitPct - magnetControlHitPct) < 10">
        Target and control hit rates are close — this sample doesn't show the target level behaving differently from an ordinary nearby price.
      </div>
    </section>

    <!-- ── Cross-module consistency checks ──────────────────────────── -->
    <section class="mav-section" v-if="report.crossModuleConsistencyChecks.length">
      <h3>Cross-Module Consistency Checks <span class="mav-hint">(low agreement here flags a code bug, not a market finding)</span></h3>
      <div v-for="c in report.crossModuleConsistencyChecks" :key="c.description" class="mav-check-row">
        <span class="mav-badge" :class="agreementClass(c.agreementRate)">{{ (c.agreementRate * 100).toFixed(0) }}%</span>
        <span class="mav-check-desc">{{ c.description }} <span class="mav-n">(n={{ c.sampleCount }})</span></span>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { computed, h, defineComponent, type PropType } from "vue";
import type { SimulationAnalysisReport, MoveOutcomeDistribution, MOVE_OUTCOME, PairwiseCombinationBucket, BucketStat } from "@/core/interfacesv2";

const props = defineProps<{
  report: SimulationAnalysisReport;
}>();

// ── Shared outcome-bar legend/colors ─────────────────────────────────────
const OUTCOME_COLORS: Record<MOVE_OUTCOME, string> = {
  STRONG_CONTINUATION: "#22c55e",
  WEAK_CONTINUATION: "#86efac",
  CHOP: "#6b7280",
  WEAK_REVERSAL: "#fca5a5",
  STRONG_REVERSAL: "#ef4444",
  CENSORED: "#475569",
};
const LEGEND = (Object.keys(OUTCOME_COLORS) as MOVE_OUTCOME[]).map(k => ({
  key: k, color: OUTCOME_COLORS[k], label: k.replace(/_/g, " ").toLowerCase(),
}));

// Small inline component: renders one MoveOutcomeDistribution as a stacked bar.
const OutcomeBar = defineComponent({
  props: { dist: { type: Object as PropType<MoveOutcomeDistribution>, required: true } },
  setup(p) {
    return () => h("div", { class: "mav-outcome-bar", title: JSON.stringify(p.dist.outcomePercents) },
      (Object.keys(OUTCOME_COLORS) as MOVE_OUTCOME[]).map(k => {
        const pct = p.dist.outcomePercents[k] ?? 0;
        if (pct <= 0) return null;
        return h("div", { class: "mav-outcome-seg", style: { width: pct + "%", background: OUTCOME_COLORS[k] } });
      })
    );
  },
});

function formatDate(ts: number): string { return new Date(ts).toLocaleString(); }
function formatRange(start: number, end: number): string {
  const fmt = (t: number) => new Date(t).toLocaleDateString();
  return `${fmt(start)} - ${fmt(end)}`;
}
function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function medianOf(values: (number | null)[]): string {
  const clean = values.filter((v): v is number => v !== null);
  if (!clean.length) return "—";
  return median(clean).toFixed(1);
}

// ── Price action funnel ──────────────────────────────────────────────────
const STAGE_ORDER = ["PENDING", "REJECTED", "RECLAIMED", "DISPLACED", "CONFIRMED", "INVALIDATED"];
const STAGE_COLORS: Record<string, string> = {
  PENDING: "#6b7280", REJECTED: "#93c5fd", RECLAIMED: "#60a5fa",
  DISPLACED: "#38bdf8", CONFIRMED: "#22c55e", INVALIDATED: "#ef4444",
};
const priceActionFunnel = computed(() => {
  const total = props.report.priceActionSequenceOutcomes.length || 1;
  const counts: Record<string, number> = {};
  for (const p of props.report.priceActionSequenceOutcomes) counts[p.terminalStage] = (counts[p.terminalStage] ?? 0) + 1;
  return STAGE_ORDER.filter(s => counts[s]).map(stage => ({
    stage, count: counts[stage] ?? 0, pct: ((counts[stage] ?? 0) / total) * 100, color: STAGE_COLORS[stage],
  }));
});
const paTimes = computed(() => ({
  reject: props.report.priceActionSequenceOutcomes.map(p => p.candlesToReject),
  reclaim: props.report.priceActionSequenceOutcomes.map(p => p.candlesToReclaim),
  displace: props.report.priceActionSequenceOutcomes.map(p => p.candlesToDisplace),
  confirm: props.report.priceActionSequenceOutcomes.map(p => p.candlesToConfirm),
}));
const censoredPaCount = computed(() => props.report.priceActionSequenceOutcomes.filter(p => p.censored).length);

// ── Anchor lifecycle ─────────────────────────────────────────────────────
const ANCHOR_SIDES = ["LONG", "SHORT"] as const;
function anchorCounts(side: "LONG" | "SHORT") {
  const rows: Array<{ status: string; count: number }> = [];
  const counts: Record<string, number> = {};
  const items = props.report.anchorLifecycleOutcomes.filter(a => a.side === side);
  for (const a of items) counts[a.terminalStatus] = (counts[a.terminalStatus] ?? 0) + 1;
  for (const [status, count] of Object.entries(counts)) rows.push({ status, count });
  return { total: items.length, rows };
}
function anchorBadgeClass(status: string): string {
  if (status.includes("CONFIRMED")) return "mav-badge-good";
  if (status.includes("BROKEN") || status === "INVALIDATED") return "mav-badge-bad";
  return "mav-badge-neutral";
}

// ── Sweep comparison ─────────────────────────────────────────────────────
const sweepCounts = computed(() => ({
  swept: props.report.sweepEventOutcomes.filter(s => s.behavior === "SWEPT").length,
  control: props.report.sweepEventOutcomes.filter(s => s.isControlSample).length,
}));
const sweptRatios = computed(() =>
  props.report.sweepEventOutcomes.filter(s => s.behavior === "SWEPT").map(s => s.sweptRatio)
);
function mergedDistribution(sourceOutcomes: { moveOutcome: MOVE_OUTCOME; forwardReturnPercent: number; forwardReturnAtr: number }[]): MoveOutcomeDistribution {
  const counts: Record<MOVE_OUTCOME, number> = {
    STRONG_CONTINUATION: 0, WEAK_CONTINUATION: 0, CHOP: 0, WEAK_REVERSAL: 0, STRONG_REVERSAL: 0, CENSORED: 0,
  };
  for (const o of sourceOutcomes) counts[o.moveOutcome]++;
  const total = sourceOutcomes.length || 1;
  const percents = {} as Record<MOVE_OUTCOME, number>;
  (Object.keys(counts) as MOVE_OUTCOME[]).forEach(k => { percents[k] = (counts[k] / total) * 100; });
  return {
    sampleCount: sourceOutcomes.length,
    outcomeCounts: counts,
    outcomePercents: percents,
    meanForwardReturnPercent: 0, medianForwardReturnPercent: 0, meanForwardReturnAtr: 0,
  };
}
const sweptOutcome = computed(() => mergedDistribution(
  props.report.sweepEventOutcomes.filter(s => s.behavior === "SWEPT").map(s => s.outcome)
));
const controlOutcome = computed(() => mergedDistribution(
  props.report.sweepEventOutcomes.filter(s => s.isControlSample).map(s => s.outcome)
));

// ── Combinations ─────────────────────────────────────────────────────────
function sortedBuckets(buckets: BucketStat[]): BucketStat[] {
  return [...buckets].sort((a, b) => b.sampleCount - a.sampleCount);
}
const sortedPairwise = computed((): PairwiseCombinationBucket[] =>
  [...props.report.combinations.pairwise].sort((a, b) => b.sampleCount - a.sampleCount)
);

// ── Magnet analysis ──────────────────────────────────────────────────────
const magnetCensored = computed(() => props.report.magnetAnalysis.filter(m => m.censored).length);
const magnetDrained = computed(() => props.report.magnetAnalysis.filter(m => m.targetDrainedByOtherSweep).length);
const magnetTargetHitPct = computed(() => {
  const n = props.report.magnetAnalysis.length || 1;
  return (props.report.magnetAnalysis.filter(m => m.targetHit).length / n) * 100;
});
const magnetControlHitPct = computed(() => {
  const n = props.report.magnetAnalysis.length || 1;
  return (props.report.magnetAnalysis.filter(m => m.controlHit).length / n) * 100;
});
const magnetTimes = computed(() => ({
  target: props.report.magnetAnalysis.map(m => m.candlesToHitTarget),
  control: props.report.magnetAnalysis.map(m => m.candlesToHitControl),
}));

function agreementClass(rate: number): string {
  if (rate >= 0.9) return "mav-badge-good";
  if (rate >= 0.7) return "mav-badge-neutral";
  return "mav-badge-bad";
}
</script>

<style scoped>
.mav { font-family: var(--mono, monospace); color: #e5e7eb; font-size: 12px; }

.mav-header {
  display: flex; flex-wrap: wrap; gap: 16px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;
}
.mav-label { color: #9aa4b2; margin-right: 6px; }
.mav-value { color: #fff; font-weight: 600; }

.mav-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; font-size: 10px; color: #9aa4b2; }
.mav-legend-item { display: flex; align-items: center; gap: 4px; }
.mav-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

.mav-section {
  margin-bottom: 22px; padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.mav-section h3 { font-size: 13px; color: #f5f5f5; margin: 0 0 10px 0; font-weight: 600; }
.mav-subheading { margin-top: 18px; }
.mav-hint { color: #7d8590; font-weight: 400; font-size: 10px; font-style: italic; }

.mav-substats { display: flex; flex-wrap: wrap; gap: 14px; color: #9aa4b2; margin-bottom: 10px; font-size: 11px; }

.mav-funnel-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.mav-funnel-label { width: 100px; flex-shrink: 0; color: #cdd3db; }
.mav-funnel-track { flex: 1; height: 14px; background: rgba(255,255,255,.06); border-radius: 3px; overflow: hidden; }
.mav-funnel-fill { height: 100%; }
.mav-funnel-count { width: 90px; flex-shrink: 0; color: #9aa4b2; text-align: right; }

.mav-anchor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.mav-anchor-side-title { font-weight: 600; color: #fff; margin-bottom: 6px; }
.mav-badge-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; max-width: 260px; }

.mav-compare-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.mav-compare-label { width: 140px; flex-shrink: 0; color: #cdd3db; }

.mav-bucket-row { margin-bottom: 10px; }
.mav-bucket-label { display: flex; justify-content: space-between; margin-bottom: 3px; color: #cdd3db; }
.mav-bucket-meta { color: #7d8590; font-size: 10px; margin-top: 2px; }
.mav-n { color: #7d8590; font-size: 10px; }
.mav-n-warn { color: #f59e0b; }

.mav-outcome-bar { display: flex; height: 14px; width: 100%; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,.06); }
.mav-outcome-seg { height: 100%; }

.mav-simple-bar-track { flex: 1; height: 10px; background: rgba(255,255,255,.06); border-radius: 3px; overflow: hidden; }
.mav-simple-bar-fill { height: 100%; }

.mav-stage-badges { display: flex; flex-wrap: wrap; gap: 6px; }

.mav-badge {
  display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 600;
}
.mav-badge-good { background: rgba(34,197,94,.15); color: #22c55e; }
.mav-badge-bad { background: rgba(239,68,68,.15); color: #ef4444; }
.mav-badge-neutral { background: rgba(255,255,255,.08); color: #cdd3db; }

.mav-check-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.mav-check-desc { color: #cdd3db; }
</style>