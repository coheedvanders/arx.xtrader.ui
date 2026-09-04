<script setup lang="ts">
/**
 * RiskMeasureComponent
 *
 * Pulls open positions (with TP/SL prices + estimated PnL) from the
 * /get-pos-risk endpoint and renders one bar per symbol:
 *
 *   BTCUSDT   [ ---- red (SL) ---- | ---- green (TP) ---- ]
 *
 * Bar fill length on each side is scaled against the largest potential
 * gain/loss/current-PnL across all open positions, so every row shares
 * one visual scale — a wide bar means "big number relative to your other
 * open risk today," not just "big number."
 *
 * A small marker on each bar shows where the LIVE unrealized PnL sits
 * between the SL and TP extremes.
 *
 * "See earning potential" opens a dialog with an outcome ladder: for each
 * open position, assume it either hits TP or hits SL, and show the running
 * total from "every position hits TP" down to "every position hits SL" —
 * so you can see roughly where today lands if all, most, some, or none of
 * today's setups work out.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

interface PositionRisk {
  symbol: string
  side: 'LONG' | 'SHORT'
  quantity: number
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  tpPrice: number | null
  slPrice: number | null
  potentialTpPnl: number | null
  potentialSlPnl: number | null
}

interface OutcomeRow {
  hitCount: number
  total: number
  label: string
}

const props = withDefaults(
  defineProps<{
    apiBase?: string
    pollMs?: number
  }>(),
  {
    apiBase: 'http://localhost:5001',
    pollMs: 5000,
  }
)

const positions = ref<PositionRisk[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let timer: number | undefined

async function fetchPositions() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`${props.apiBase}/get-pos-risk`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    positions.value = await res.json()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load positions'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchPositions()
  timer = window.setInterval(fetchPositions, props.pollMs)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

// Shared scale across every row: the largest magnitude among all
// potential SL loss, potential TP gain, and live PnL currently on screen.
const maxMagnitude = computed(() => {
  let max = 0
  for (const p of positions.value) {
    max = Math.max(
      max,
      Math.abs(p.potentialSlPnl ?? 0),
      Math.abs(p.potentialTpPnl ?? 0),
      Math.abs(p.unrealizedPnl)
    )
  }
  return max || 1
})

const totalRisk = computed(() =>
  positions.value.reduce((sum, p) => sum + Math.abs(p.potentialSlPnl ?? 0), 0)
)
const totalReward = computed(() =>
  positions.value.reduce((sum, p) => sum + (p.potentialTpPnl ?? 0), 0)
)

// % of the shared scale a value represents (0-100), used as a zone's fill width.
function fillPct(value: number | null): number {
  if (value == null) return 0
  return Math.min(100, (Math.abs(value) / maxMagnitude.value) * 100)
}

// Marker position as a % across the whole bar (0 = far left / max loss, 100 = far right / max gain).
function markerPct(value: number): number {
  const half = fillPct(value) / 2
  return value >= 0 ? 50 + half : 50 - half
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}`
}

function refresh() {
  fetchPositions()
}

// --- Earning potential dialog -------------------------------------------

const showEarningDialog = ref(false)

function openEarningDialog() {
  showEarningDialog.value = true
}
function closeEarningDialog() {
  showEarningDialog.value = false
}
function onDialogKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeEarningDialog()
}

// Positions with both a TP and SL in place — a position missing either one
// can't be assumed into a "hit TP / hit SL" scenario, so it's left out of
// the ladder (shown separately as a caveat instead).
const scenarioPositions = computed(() =>
  positions.value.filter((p) => p.potentialTpPnl != null && p.potentialSlPnl != null)
)
const excludedPositions = computed(() =>
  positions.value.filter((p) => p.potentialTpPnl == null || p.potentialSlPnl == null)
)

// Outcome ladder: sort positions by their TP payout (best first), then for
// hitCount = N..0, assume the top `hitCount` positions hit TP and the rest
// hit SL, and sum it up. Row N = "every position hits TP" (best case), row
// 0 = "every position hits SL" (worst case) — everything between is a
// rough "if only the strongest few come in" read, not a probability.
const outcomeLadder = computed<OutcomeRow[]>(() => {
  const sorted = [...scenarioPositions.value].sort(
    (a, b) => (b.potentialTpPnl ?? 0) - (a.potentialTpPnl ?? 0)
  )
  const n = sorted.length
  const rows: OutcomeRow[] = []

  for (let hitCount = n; hitCount >= 0; hitCount--) {
    const winners = sorted.slice(0, hitCount)
    const losers = sorted.slice(hitCount)
    const total =
      winners.reduce((sum, p) => sum + (p.potentialTpPnl ?? 0), 0) +
      losers.reduce((sum, p) => sum + (p.potentialSlPnl ?? 0), 0)

    let label: string
    if (n === 0) label = 'No open positions'
    else if (hitCount === n) label = 'All hit TP'
    else if (hitCount === 0) label = 'All hit SL'
    else label = `${hitCount} of ${n} hit TP`

    rows.push({ hitCount, total: Math.round(total * 100) / 100, label })
  }
  return rows
})

const bestCase = computed(() => outcomeLadder.value[0]?.total ?? 0)
const worstCase = computed(
  () => outcomeLadder.value[outcomeLadder.value.length - 1]?.total ?? 0
)
const liveTotalPnl = computed(() =>
  positions.value.reduce((sum, p) => sum + p.unrealizedPnl, 0)
)

// Bar width for a ladder row, scaled against whichever of best/worst case
// has the larger magnitude, so rows read on one consistent scale.
const ladderMax = computed(() => Math.max(Math.abs(bestCase.value), Math.abs(worstCase.value), 1))
function ladderPct(total: number): number {
  return Math.min(100, (Math.abs(total) / ladderMax.value) * 100)
}

defineExpose({ refresh })
</script>

<template>
  <div class="risk-meter">
    <header class="risk-meter__header">
      <h3 class="risk-meter__title">Today's risk exposure</h3>
      <div class="risk-meter__totals">
        <span class="risk-meter__total risk-meter__total--loss">
          Risk if all SL hit: −{{ totalRisk.toFixed(2) }} USDT
        </span>
        <span class="risk-meter__total risk-meter__total--gain">
          Reward if all TP hit: +{{ totalReward.toFixed(2) }} USDT
        </span>
        <button class="risk-meter__cta" @click="openEarningDialog">See earning potential</button>
        <button class="risk-meter__refresh" :disabled="loading" @click="refresh">
          {{ loading ? '…' : '↻' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="risk-meter__error">{{ error }}</p>
    <p v-else-if="!loading && positions.length === 0" class="risk-meter__empty">
      No open positions.
    </p>

    <div class="risk-meter__rows">
      <div v-for="p in positions" :key="p.symbol" class="risk-row">
        <div class="risk-row__label">
          <span class="risk-row__symbol">{{ p.symbol }}</span>
          <span class="risk-row__side" :class="p.side === 'LONG' ? 'is-long' : 'is-short'">
            {{ p.side }}
          </span>
        </div>

        <span class="risk-row__sl-value">{{ fmt(p.potentialSlPnl) }}</span>

        <div class="risk-row__bar">
          <div class="risk-row__zone risk-row__zone--loss">
            <div
              class="risk-row__fill risk-row__fill--loss"
              :style="{ width: fillPct(p.potentialSlPnl) + '%' }"
            >
              <span v-if="fillPct(p.potentialSlPnl) > 18" class="risk-row__fill-label">
                {{ fmt(p.potentialSlPnl) }}
              </span>
            </div>
          </div>
          <div class="risk-row__center" />
          <div class="risk-row__zone risk-row__zone--gain">
            <div
              class="risk-row__fill risk-row__fill--gain"
              :style="{ width: fillPct(p.potentialTpPnl) + '%' }"
            >
              <span v-if="fillPct(p.potentialTpPnl) > 18" class="risk-row__fill-label">
                {{ fmt(p.potentialTpPnl) }}
              </span>
            </div>
          </div>
          <div
            class="risk-row__marker"
            :class="{ 'is-negative': p.unrealizedPnl < 0 }"
            :style="{ left: markerPct(p.unrealizedPnl) + '%' }"
            :title="`Live PnL: ${fmt(p.unrealizedPnl)} USDT`"
          >
            <span class="risk-row__marker-label">{{ fmt(p.unrealizedPnl) }}</span>
          </div>
        </div>

        <span class="risk-row__tp-value">{{ fmt(p.potentialTpPnl) }}</span>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="risk-dialog-fade">
      <div
        v-if="showEarningDialog"
        class="risk-dialog__overlay"
        @click.self="closeEarningDialog"
        @keydown="onDialogKeydown"
      >
        <div
          class="risk-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="earning-potential-title"
          tabindex="-1"
        >
          <header class="risk-dialog__header">
            <h3 id="earning-potential-title">Earning potential — today's open positions</h3>
            <button class="risk-dialog__close" aria-label="Close" @click="closeEarningDialog">✕</button>
          </header>

          <div v-if="scenarioPositions.length === 0" class="risk-dialog__empty">
            No open positions with both TP and SL placed yet — nothing to project.
          </div>

          <template v-else>
            <div class="risk-dialog__summary">
              <div class="risk-dialog__summary-item">
                <span class="risk-dialog__summary-label">Right now</span>
                <span
                  class="risk-dialog__summary-value"
                  :class="{ 'is-negative': liveTotalPnl < 0, 'is-positive': liveTotalPnl > 0 }"
                >
                  {{ fmt(liveTotalPnl) }} USDT
                </span>
              </div>
              <div class="risk-dialog__summary-item">
                <span class="risk-dialog__summary-label">Best case — all hit TP</span>
                <span class="risk-dialog__summary-value is-positive">{{ fmt(bestCase) }} USDT</span>
              </div>
              <div class="risk-dialog__summary-item">
                <span class="risk-dialog__summary-label">Worst case — all hit SL</span>
                <span class="risk-dialog__summary-value is-negative">{{ fmt(worstCase) }} USDT</span>
              </div>
            </div>

            <p class="risk-dialog__caption">
              Outcome ladder — assumes your strongest targets land first and the rest hit stop.
              Not a probability, just a range of where today could land.
            </p>

            <div class="risk-dialog__ladder">
              <div v-for="row in outcomeLadder" :key="row.hitCount" class="ladder-row">
                <span class="ladder-row__label">{{ row.label }}</span>
                <div class="ladder-row__track">
                  <div
                    class="ladder-row__fill"
                    :class="row.total >= 0 ? 'is-positive' : 'is-negative'"
                    :style="{ width: ladderPct(row.total) + '%' }"
                  />
                </div>
                <span
                  class="ladder-row__value"
                  :class="row.total >= 0 ? 'is-positive' : 'is-negative'"
                >
                  {{ fmt(row.total) }}
                </span>
              </div>
            </div>

            <p v-if="excludedPositions.length > 0" class="risk-dialog__caveat">
              {{ excludedPositions.length }} position(s) without both a TP and SL placed
              ({{ excludedPositions.map((p) => p.symbol).join(', ') }}) aren't included in the
              ladder above.
            </p>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.risk-meter {
  --bg: #14171c;
  --panel: #1b1f26;
  --line: #2a2f38;
  --text: #e6e8eb;
  --text-dim: #8a919c;
  --loss: #e5484d;
  --loss-dim: #e5484d55;
  --gain: #30a46c;
  --gain-dim: #30a46c55;
  --marker: #f5b942;

  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 16px;
  color: var(--text);
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.risk-meter__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.risk-meter__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.risk-meter__totals {
  display: flex;
  align-items: center;
  gap: 14px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.risk-meter__total--loss {
  color: var(--loss);
}
.risk-meter__total--gain {
  color: var(--gain);
}

.risk-meter__refresh {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
  border-radius: 4px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  line-height: 1;
}
.risk-meter__refresh:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.risk-meter__error {
  color: var(--loss);
  font-size: 12px;
}
.risk-meter__empty {
  color: var(--text-dim);
  font-size: 12px;
}

.risk-meter__rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.risk-row {
  display: grid;
  grid-template-columns: 110px 64px 1fr 64px;
  align-items: center;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 10px;
}

.risk-row__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.risk-row__symbol {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.risk-row__side {
  font-size: 10px;
  width: fit-content;
  padding: 1px 5px;
  border-radius: 3px;
}
.risk-row__side.is-long {
  color: var(--gain);
  background: var(--gain-dim);
}
.risk-row__side.is-short {
  color: var(--loss);
  background: var(--loss-dim);
}

.risk-row__bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 24px;
  background: #0f1216;
  border-radius: 3px;
  overflow: visible;
}

.risk-row__zone {
  width: 50%;
  height: 100%;
  display: flex;
  overflow: hidden;
}
.risk-row__zone--loss {
  justify-content: flex-end;
}
.risk-row__zone--gain {
  justify-content: flex-start;
}

.risk-row__fill {
  height: 100%;
  display: flex;
  align-items: center;
  min-width: 0;
}
.risk-row__fill--loss {
  background: var(--loss);
  justify-content: flex-start;
  padding-left: 6px;
}
.risk-row__fill--gain {
  background: var(--gain);
  justify-content: flex-end;
  padding-right: 6px;
}

.risk-row__fill-label {
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f1216;
  white-space: nowrap;
}

.risk-row__center {
  position: absolute;
  left: 50%;
  top: -4px;
  bottom: -4px;
  width: 1px;
  background: var(--line);
}

.risk-row__marker {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  background: var(--marker);
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
}

.risk-row__marker-label {
  position: absolute;
  top: -15px;
  left: 50%;
  font-size: 9px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--marker);
  white-space: nowrap;
  transform: translateX(-50%);
}

/* Values flanking the bar — kept next to the segment they describe so
   the weight of each number is legible at a glance, not detached below. */
.risk-row__sl-value,
.risk-row__tp-value {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.risk-row__sl-value {
  color: var(--loss);
  text-align: right;
}
.risk-row__tp-value {
  color: var(--gain);
  text-align: left;
}

@media (max-width: 560px) {
  .risk-row {
    grid-template-columns: 90px 1fr;
    grid-template-rows: auto auto auto;
  }
  .risk-row__sl-value,
  .risk-row__tp-value {
    grid-column: 1 / -1;
    text-align: left;
  }
}

.risk-meter__cta {
  background: transparent;
  border: 1px solid var(--gain);
  color: var(--gain);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.risk-meter__cta:hover {
  background: var(--gain-dim);
}

/* --- Earning potential dialog ------------------------------------------ */

.risk-dialog__overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 10, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.risk-dialog {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--bg, #14171c);
  border: 1px solid var(--line, #2a2f38);
  border-radius: 8px;
  padding: 18px 20px;
  color: var(--text, #e6e8eb);
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.risk-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.risk-dialog__header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.risk-dialog__close {
  background: transparent;
  border: none;
  color: var(--text-dim, #8a919c);
  font-size: 14px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
}
.risk-dialog__close:hover {
  color: var(--text, #e6e8eb);
}

.risk-dialog__empty {
  color: var(--text-dim, #8a919c);
  font-size: 13px;
}

.risk-dialog__summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.risk-dialog__summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--panel, #1b1f26);
  border: 1px solid var(--line, #2a2f38);
  border-radius: 6px;
  padding: 8px 10px;
}
.risk-dialog__summary-label {
  font-size: 10px;
  color: var(--text-dim, #8a919c);
}
.risk-dialog__summary-value {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.risk-dialog__summary-value.is-positive {
  color: var(--gain, #30a46c);
}
.risk-dialog__summary-value.is-negative {
  color: var(--loss, #e5484d);
}

.risk-dialog__caption {
  font-size: 11px;
  color: var(--text-dim, #8a919c);
  margin: 0 0 10px;
  line-height: 1.4;
}

.risk-dialog__ladder {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ladder-row {
  display: grid;
  grid-template-columns: 100px 1fr 70px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.ladder-row__label {
  color: var(--text-dim, #8a919c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ladder-row__track {
  height: 10px;
  background: #0f1216;
  border-radius: 3px;
  overflow: hidden;
}
.ladder-row__fill {
  height: 100%;
}
.ladder-row__fill.is-positive {
  background: var(--gain, #30a46c);
}
.ladder-row__fill.is-negative {
  background: var(--loss, #e5484d);
}
.ladder-row__value {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.ladder-row__value.is-positive {
  color: var(--gain, #30a46c);
}
.ladder-row__value.is-negative {
  color: var(--loss, #e5484d);
}

.risk-dialog__caveat {
  margin: 12px 0 0;
  font-size: 10px;
  color: var(--text-dim, #8a919c);
  line-height: 1.4;
}

.risk-dialog-fade-enter-active,
.risk-dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}
.risk-dialog-fade-enter-from,
.risk-dialog-fade-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .risk-dialog__summary {
    grid-template-columns: 1fr;
  }
  .ladder-row {
    grid-template-columns: 80px 1fr 60px;
  }
}
</style>