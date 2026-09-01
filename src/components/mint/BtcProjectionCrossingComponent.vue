<template>
  <div class="btc-projection-cross">
    <div class="controls">
      <label class="recent-length-label">
        <span>Recent candles</span>
        <input
          v-model.number="recentCandleLength"
          type="number"
          min="1"
          max="500"
          class="recent-length-input"
        />
      </label>

      <button class="run-scan-btn" :disabled="scanning" @click="runScan">
        {{ scanning ? `Scanning… (${scannedCount}/${totalSymbols})` : 'Run Scan' }}
      </button>

      <span v-if="scanError" class="scan-error" :title="scanError">
        Scan failed — see console
      </span>
    </div>

    <div v-if="hasScanned && !scanning" class="scan-summary">
      {{ results.length }} of {{ totalSymbols }} symbols had a BTC projection crossing
      in the last {{ recentCandleLength }}
      candle{{ recentCandleLength === 1 ? '' : 's' }}.
    </div>

    <table v-if="results.length" class="cross-results-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Crossings</th>
          <th>Up</th>
          <th>Down</th>
          <th>Last crossing</th>
        </tr>
      </thead>

      <tbody>
        <template v-for="r in results" :key="r.symbol">
          <tr
            class="cross-result-row"
            :class="{
              'has-up': r.hasUpBreak,
              'has-down': r.hasDownBreak
            }"
            @click="openSymbolVisualizer(r.symbol)"
          >
            <td class="symbol-cell">
              <button
                class="expand-toggle"
                title="Show individual crossing candles"
                @click.stop="toggleExpanded(r.symbol)"
              >
                {{ expandedSymbols.has(r.symbol) ? '▾' : '▸' }}
              </button>

              {{ r.symbol }}
            </td>

            <td>{{ r.breaks.length }}</td>

            <td :class="{ up: r.hasUpBreak }">
              {{ r.breaks.filter(b => b.direction === 'up').length }}
            </td>

            <td :class="{ down: r.hasDownBreak }">
              {{ r.breaks.filter(b => b.direction === 'down').length }}
            </td>

            <td
              v-if="r.lastBreak"
              class="level-cell"
              :class="r.lastBreak.direction === 'up' ? 'up' : 'down'"
            >
              {{ r.lastBreak.direction === 'up' ? '↑' : '↓' }}
              candle {{ r.lastBreak.candleExtreme.toFixed(4) }}
              vs proj {{ r.lastBreak.projectionLevel.toFixed(4) }}
            </td>
          </tr>

          <tr
            v-if="expandedSymbols.has(r.symbol)"
            class="cross-detail-row"
          >
            <td colspan="5">
              <div class="cross-detail-list">
                <div
                  v-for="b in r.breaks"
                  :key="`${b.direction}-${b.index}`"
                  class="cross-detail-item"
                  :class="b.direction"
                >
                  {{ b.direction === 'up' ? '↑' : '↓' }}
                  {{ new Date(b.openTime).toLocaleString() }}
                  —
                  candle
                  {{ b.direction === 'up' ? 'high' : 'low' }}
                  {{ b.candleExtreme.toFixed(4) }}
                  vs projection
                  {{ b.projectionLevel.toFixed(4) }}
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div
      v-else-if="hasScanned && !scanning"
      class="no-results"
    >
      No symbols crossed their BTC projection level in the last
      {{ recentCandleLength }}
      candle{{ recentCandleLength === 1 ? '' : 's' }}.
    </div>
  </div>

  <DialogComponent v-model="showVisualizerModal" :width="'95vw'">
    <DialogHeaderComponent>
      {{ selectedSymbol }}
    </DialogHeaderComponent>

    <CandleEntryVisualizerComponent
      v-if="selectedSymbolCandleEntries.length"
      :candles="selectedSymbolCandleEntries"
      :symbol="selectedSymbol.toLowerCase()"
    />
  </DialogComponent>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CandleEntry } from '@/core/interfaces'
import { useChocoMintoStore } from '@/stores/chocoMintoStore.ts'
import { klineDbUtility } from '@/utility/klineDbUtility.ts'
import DialogComponent from '../shared/dialog/DialogComponent.vue'
import DialogHeaderComponent from '../shared/dialog/DialogHeaderComponent.vue'
import CandleEntryVisualizerComponent from './CandleEntryVisualizerComponent.vue'

const chocomintoStore = useChocoMintoStore()

// ─────────────────────────────────────────────────────────────────────────────
// Visualizer
// ─────────────────────────────────────────────────────────────────────────────

const showVisualizerModal = ref(false)
const selectedSymbol = ref('')
const selectedSymbolCandleEntries = ref<CandleEntry[]>([])

async function openSymbolVisualizer(symbol: string) {
  showVisualizerModal.value = true
  selectedSymbol.value = symbol

  selectedSymbolCandleEntries.value =
    await klineDbUtility.getKlines(symbol)
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls / state
// ─────────────────────────────────────────────────────────────────────────────

const recentCandleLength = ref(5)
const scanning = ref(false)
const scanError = ref<string | null>(null)
const hasScanned = ref(false)
const scannedCount = ref(0)

const totalSymbols = computed(
  () => chocomintoStore.futureSymbols.length
)

const expandedSymbols = ref<Set<string>>(new Set())

function toggleExpanded(symbol: string) {
  const next = new Set(expandedSymbols.value)

  if (next.has(symbol)) {
    next.delete(symbol)
  } else {
    next.add(symbol)
  }

  expandedSymbols.value = next
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BreakEvent {
  index: number
  openTime: number
  direction: 'up' | 'down'

  candleExtreme: number
  projectionLevel: number
}

interface SymbolCrossResult {
  symbol: string
  breaks: BreakEvent[]
  hasUpBreak: boolean
  hasDownBreak: boolean
  lastBreak: BreakEvent | null
}

interface ProjectedCandle {
  index: number
  openTime: number

  open: number
  high: number
  low: number
  close: number
}

const results = ref<SymbolCrossResult[]>([])

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a timestamp lookup for BTC candles.
 *
 * The important part here is that projection alignment is based on
 * openTime instead of assuming:
 *
 * symbolCandles[i] === btcCandles[i]
 */
function createCandleTimeMap(
  candles: CandleEntry[]
): Map<number, CandleEntry> {
  const map = new Map<number, CandleEntry>()

  for (const candle of candles) {
    if (candle.openTime == null) continue

    map.set(candle.openTime, candle)
  }

  return map
}

/**
 * Align the symbol candles with BTC candles using candle openTime.
 *
 * Only candles that exist in BOTH datasets are returned.
 */
function alignCandles(
  symbolCandles: CandleEntry[],
  btcCandles: CandleEntry[]
): Array<{
  symbol: CandleEntry
  btc: CandleEntry
  symbolIndex: number
}> {
  const btcByTime = createCandleTimeMap(btcCandles)

  const aligned: Array<{
    symbol: CandleEntry
    btc: CandleEntry
    symbolIndex: number
  }> = []

  for (let i = 0; i < symbolCandles.length; i++) {
    const symbolCandle = symbolCandles[i]

    if (symbolCandle.openTime == null) continue

    const btcCandle = btcByTime.get(symbolCandle.openTime)

    if (!btcCandle) continue

    aligned.push({
      symbol: symbolCandle,
      btc: btcCandle,
      symbolIndex: i
    })
  }

  return aligned
}

// ─────────────────────────────────────────────────────────────────────────────
// BTC projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the BTC projection from aligned candles.
 *
 * The projection is compounded:
 *
 * projectedOpen
 *      ↓
 * BTC candle movement
 *      ↓
 * projectedClose
 *      ↓
 * next projectedOpen
 *
 * This follows the existing projection logic.
 */
function computeBtcProjection(
  aligned: Array<{
    symbol: CandleEntry
    btc: CandleEntry
    symbolIndex: number
  }>
): ProjectedCandle[] {
  if (aligned.length < 2) {
    return []
  }

  const result: ProjectedCandle[] = []

  let prevProjectedClose = aligned[0].symbol.close!

  for (let i = 1; i < aligned.length; i++) {
    const item = aligned[i]

    const btc = item.btc

    const btcOpen = btc.open

    if (
      btcOpen == null ||
      btc.high == null ||
      btc.low == null ||
      btc.close == null
    ) {
      result.push({
        index: item.symbolIndex,
        openTime: item.symbol.openTime!,

        open: prevProjectedClose,
        high: prevProjectedClose,
        low: prevProjectedClose,
        close: prevProjectedClose
      })

      continue
    }

    if (btcOpen === 0) {
      result.push({
        index: item.symbolIndex,
        openTime: item.symbol.openTime!,

        open: prevProjectedClose,
        high: prevProjectedClose,
        low: prevProjectedClose,
        close: prevProjectedClose
      })

      continue
    }

    const projectedOpen = prevProjectedClose

    const scaleFactor =
      projectedOpen / btcOpen

    const projectedClose =
      btc.close * scaleFactor

    const projectedHigh =
      btc.high * scaleFactor

    const projectedLow =
      btc.low * scaleFactor

    result.push({
      index: item.symbolIndex,
      openTime: item.symbol.openTime!,

      open: projectedOpen,
      high: projectedHigh,
      low: projectedLow,
      close: projectedClose
    })

    prevProjectedClose = projectedClose
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Crossing detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A candle crosses the projection when its range intersects
 * the projection candle's range.
 *
 * UP crossing:
 *
 *     candle high
 *          ↑
 *          |
 *     ─────┼───── projection high
 *
 * DOWN crossing:
 *
 *     ─────┼───── projection low
 *          |
 *          ↓
 *      candle low
 *
 * We specifically detect a breakout through the projection boundary,
 * rather than simply checking whether the candle overlaps the projection.
 */
function detectCrossing(
  candle: CandleEntry,
  projection: ProjectedCandle
): BreakEvent[] {
  if (
    candle.openTime == null ||
    candle.high == null ||
    candle.low == null
  ) {
    return []
  }

  const breaks: BreakEvent[] = []

  // Price moved above the projected high.
  if (candle.high > projection.high) {
    breaks.push({
      index: projection.index,
      openTime: candle.openTime,
      direction: 'up',
      candleExtreme: candle.high,
      projectionLevel: projection.high
    })
  }

  // Price moved below the projected low.
  if (candle.low < projection.low) {
    breaks.push({
      index: projection.index,
      openTime: candle.openTime,
      direction: 'down',
      candleExtreme: candle.low,
      projectionLevel: projection.low
    })
  }

  return breaks
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan one symbol
// ─────────────────────────────────────────────────────────────────────────────

async function scanSymbol(
  symbol: string,
  btcCandles: CandleEntry[]
): Promise<SymbolCrossResult | null> {
  try {
    const symbolCandles =
      await klineDbUtility.getKlines(symbol)

    if (
      !symbolCandles ||
      symbolCandles.length < 2
    ) {
      return null
    }

    // Ensure chronological order.
    const sortedSymbolCandles = [...symbolCandles]
      .filter(c => c.openTime != null)
      .sort(
        (a, b) =>
          a.openTime! - b.openTime!
      )

    const sortedBtcCandles = [...btcCandles]
      .filter(c => c.openTime != null)
      .sort(
        (a, b) =>
          a.openTime! - b.openTime!
      )

    // Align by timestamp.
    const aligned = alignCandles(
      sortedSymbolCandles,
      sortedBtcCandles
    )

    if (aligned.length < 2) {
      return null
    }

    // Build the projection over the aligned history.
    const projection =
      computeBtcProjection(aligned)

    if (projection.length === 0) {
      return null
    }

    // ─────────────────────────────────────────────────────────────────────
    // IMPORTANT:
    //
    // recentCandleLength refers to the LAST N REAL SYMBOL CANDLES.
    //
    // We do NOT calculate:
    //
    // projection.length - N
    //
    // because projection.length can differ from the original candle array
    // due to alignment.
    //
    // Instead, we get the timestamps of the actual latest N symbol candles
    // and only inspect those.
    // ─────────────────────────────────────────────────────────────────────

    const windowSize = Math.max(
      1,
      Math.floor(recentCandleLength.value)
    )

    const recentAligned =
      aligned.slice(-windowSize)

    const recentTimes = new Set(
      recentAligned
        .map(x => x.symbol.openTime)
        .filter(
          (t): t is number =>
            t != null
        )
    )

    const breaks: BreakEvent[] = []

    for (const proj of projection) {
      // Projection candle must belong to the
      // requested recent-candle window.
      if (!recentTimes.has(proj.openTime)) {
        continue
      }

      const candle =
        sortedSymbolCandles.find(
          c => c.openTime === proj.openTime
        )

      if (!candle) {
        continue
      }

      const candleBreaks =
        detectCrossing(
          candle,
          proj
        )

      breaks.push(...candleBreaks)
    }

    // No crossing inside the LAST N candles.
    if (breaks.length === 0) {
      return null
    }

    // Sort chronologically.
    breaks.sort(
      (a, b) =>
        a.openTime - b.openTime
    )

    return {
      symbol,

      breaks,

      hasUpBreak:
        breaks.some(
          b => b.direction === 'up'
        ),

      hasDownBreak:
        breaks.some(
          b => b.direction === 'down'
        ),

      lastBreak:
        breaks[breaks.length - 1] ?? null
    }
  } catch (err) {
    console.error(
      `BTC projection cross scan failed for ${symbol}:`,
      err
    )

    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_CONCURRENCY = 6

async function runScan() {
  scanning.value = true
  scanError.value = null
  hasScanned.value = false
  scannedCount.value = 0
  results.value = []
  expandedSymbols.value = new Set()

  try {
    const btcCandles =
      await klineDbUtility.getKlines(
        'BTCUSDT'
      )

    if (
      !btcCandles ||
      btcCandles.length === 0
    ) {
      scanError.value =
        'No BTC candle data returned.'

      return
    }

    const symbols =
      chocomintoStore.futureSymbols.map(
        f => f.symbol
      )

    const found: SymbolCrossResult[] = []

    for (
      let i = 0;
      i < symbols.length;
      i += SCAN_CONCURRENCY
    ) {
      const batch =
        symbols.slice(
          i,
          i + SCAN_CONCURRENCY
        )

      const batchResults =
        await Promise.all(
          batch.map(sym =>
            scanSymbol(
              sym,
              btcCandles
            )
          )
        )

      for (const result of batchResults) {
        if (result) {
          found.push(result)
        }
      }

      scannedCount.value +=
        batch.length
    }

    // Most recent crossing first.
    found.sort(
      (a, b) => {
        const aTime =
          a.lastBreak?.openTime ?? 0

        const bTime =
          b.lastBreak?.openTime ?? 0

        return bTime - aTime
      }
    )

    results.value = found
  } catch (err) {
    console.error(
      'BTC projection cross scan failed:',
      err
    )

    scanError.value =
      err instanceof Error
        ? err.message
        : 'Scan failed.'
  } finally {
    scanning.value = false
    hasScanned.value = true
  }
}
</script>

<style scoped>
.btc-projection-cross {
  color: #ddd;
  font-family: inherit;
}

.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.recent-length-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #aaa;
}

.recent-length-input {
  width: 64px;
  background: #1a1a1a;
  border: 1px solid #444;
  color: #fff;
  border-radius: 4px;
  padding: 4px 6px;
}

.run-scan-btn {
  background: #26a69a;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-weight: 600;
}

.run-scan-btn:disabled {
  background: #2f4d49;
  cursor: default;
  opacity: 0.7;
}

.scan-error {
  color: #ef5350;
  font-size: 12px;
  cursor: help;
}

.scan-summary {
  font-size: 13px;
  color: #999;
  margin-bottom: 8px;
}

.cross-results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.cross-results-table th {
  text-align: left;
  color: #888;
  font-weight: 600;
  padding: 6px 10px;
  border-bottom: 1px solid #333;
}

.cross-results-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #262626;
}

.cross-result-row {
  cursor: pointer;
}

.cross-result-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.cross-result-row.has-up
  td.symbol-cell {
  border-left: 2px solid #26a69a;
}

.cross-result-row.has-down
  td.symbol-cell {
  border-left: 2px solid #ef5350;
}

.expand-toggle {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 11px;
  padding: 0 4px 0 0;
  width: 14px;
}

.expand-toggle:hover {
  color: #fff;
}

td.up {
  color: #26a69a;
  font-weight: 600;
}

td.down {
  color: #ef5350;
  font-weight: 600;
}

.level-cell {
  font-family: monospace;
}

.cross-detail-row td {
  background: #141414;
  padding: 8px 10px 8px 20px;
}

.cross-detail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: monospace;
  font-size: 12px;
}

.cross-detail-item.up {
  color: #26a69a;
}

.cross-detail-item.down {
  color: #ef5350;
}

.no-results {
  color: #777;
  font-size: 13px;
  padding: 12px 0;
}
</style>
