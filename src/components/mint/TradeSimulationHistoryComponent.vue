<template>
  <div>
    <button class="log-button" @click="show_Clicked()">View Trade Logs</button>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-header">
          <h2>Trade Logs</h2>
          <button class="close-btn" @click="showModal = false">&times;</button>
        </div>

        <div v-if="loading" class="loading">Loading logs...</div>

        <div v-else class="table-wrapper">
          <table class="trade-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>TP</th>
                <th>SL</th>
                <th>Result</th>
                <th>Opening Position Fee</th>
                <th>PNL (less exit fee)</th>
                <th>PNL % (H/L)</th>
                <th>Duration</th>
                <th>Condition</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="log in logs" :key="log.id">
                <tr
                  :class="{
                    won: log.result?.toLowerCase() === 'won',
                    loss: log.result?.toLowerCase() === 'loss'
                  }"
                >
                  <td>{{ log.localTime }}</td>
                  <td>{{ log.symbol }}</td>
                  <td>{{ log.side.toUpperCase() }}</td>
                  <td>{{ log.tpsl.tp }}</td>
                  <td>{{ log.tpsl.sl }}</td>
                  <td>{{ log.result || '-' }}</td>
                  <td>{{ formatNumber(log.takerFee) }}</td>
                  <td>{{ formatNumber(log.pnl) }}</td>
                  <td>
                    {{ log.pnlPercentage.highest.toFixed(2) }} /
                    {{ log.pnlPercentage.lowest.toFixed(2) }}
                  </td>
                  <td>{{ formatDuration(log.duration) }}</td>
                  <td>{{ log.currentCandleData.conditionMet }}</td>
                  <td>
                    <button @click="toggleDetails(log.id!)">View</button>
                  </td>
                </tr>

                <tr v-if="expandedLogId === log.id" class="details-row">
                  <td colspan="11">
                    <div class="row px-md">
                        <div class="col-lg-3">
                            <div><span class="font-semibold">Margin:</span> {{ log.margin }}</div>
                            <div><span class="font-semibold">Leverage:</span> {{ log.leverage }}</div>
                            <div><span class="font-semibold">Current Price:</span> {{ log.currentPrice }}</div>
                            <div><span class="font-semibold">Exit Price:</span> {{ log.exitPrice ?? '-' }}</div>
                            <div class="divider"></div>
                            <div><span class="font-semibold">Resistance:</span></div>
                            <div>{{ log.resistance.upper ?? '-' }}</div>
                            <div>{{ log.resistance.lower ?? '-' }}</div>
                            <div class="divider"></div>
                            <div><span class="font-semibold">Support:</span></div>
                            <div>{{ log.support.upper ?? '-' }}</div>
                            <div>{{ log.support.lower ?? '-' }}</div>
                            <div>
                                <button @click="copyLogJson(log)">copy log json</button>
                            </div>
                        </div>

                        <div class="col-lg-4">
                            <div><span class="font-semibold">Zone Analysis:</span></div>
                            <div><span class="font-semibold">Type:</span> {{ log.zoneAnalysis.zoneType }}</div>
                            <div><span class="font-semibold">Strength:</span> {{ log.zoneAnalysis.zoneStrength }}</div>
                            <div><span class="font-semibold">Width:</span> {{ log.zoneAnalysis.zoneWidth }}</div>
                            <div><span class="font-semibold">Price Proximity:</span> {{ log.zoneAnalysis.priceProximityCloseToZone }}</div>
                            <div><span class="font-semibold">Past Interactions:</span> {{ log.zoneAnalysis.pastInteractionsToZoneCount }}</div>
                            <div><span class="font-semibold">Past Trend:</span> {{ log.zoneAnalysis.pastTrend }}</div>
                            <div><span class="font-semibold">Momentum:</span> {{ log.zoneAnalysis.momentum }}</div>
                            <div><span class="font-semibold">Time in Zone (ms):</span> {{ log.zoneAnalysis.timeInZoneMs }}</div>
                            <div><span class="font-semibold">Reaction Velocity:</span> {{ log.zoneAnalysis.reactionVelocity }}</div>
                            <div><span class="font-semibold">Volume Confluence:</span> {{ log.zoneAnalysis.volumeConfluence }}</div>
                            <div><span class="font-semibold">Current Candle Reversal:</span> {{ log.zoneAnalysis.currentCandleReversal }}</div>
                            <div><span class="font-semibold">Volatility Score:</span> {{ log.zoneAnalysis.volatilityScore }}</div>
                            <div><span class="font-semibold">Proximity Score:</span> {{ log.zoneAnalysis.proximityScore }}</div>
                            <div><span class="font-semibold">Proximity Confidence:</span> {{ log.zoneAnalysis.proximityConfidence }}</div>
                            <div><span class="font-semibold">Signal Confidence:</span> {{ log.zoneAnalysis.signalConfidence }}</div>
                            <div><span class="font-semibold">Interaction Strength:</span> {{ log.zoneAnalysis.interactionStrength }}</div>
                            <div><span class="font-semibold">Momentum Strength:</span> {{ log.zoneAnalysis.momentumStrength }}</div>
                            <div><span class="font-semibold">Breakout Probability:</span> {{ log.zoneAnalysis.breakoutProbability }}</div>
                            <div><span class="font-semibold">Overall Bias:</span> {{ log.zoneAnalysis.overallBias }}</div>
                            <div><span class="font-semibold">Zone Touch Detected:</span> {{ log.zoneAnalysis.zoneTouchDetected }}</div>
                            <div><span class="font-semibold">Past Resistance Breaks:</span> {{ log.zoneAnalysis.pastResistanceBreakCount }}</div>
                            <div><span class="font-semibold">Past Support Breaks:</span> {{ log.zoneAnalysis.pastSupportBreakCount }}</div>

                            <div class="divider"></div>
                            <div><span class="font-semibold">Volume Analysis:</span></div>
                            <div><span class="font-semibold">Total Volume:</span> {{ log.volumeAnalysis?.totalVolume ?? '-' }}</div>
                            <div><span class="font-semibold">Buy Volume:</span> {{ log.volumeAnalysis?.buyVolume ?? '-' }}</div>
                            <div><span class="font-semibold">Sell Volume:</span> {{ log.volumeAnalysis?.sellVolume ?? '-' }}</div>
                            <div><span class="font-semibold">Delta Volume:</span> {{ log.volumeAnalysis?.deltaVolume?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Delta Ratio:</span> {{ log.volumeAnalysis?.deltaRatio?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Avg Volume (20):</span> {{ log.volumeAnalysis?.avgVolumeLookback20?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Z-Score:</span> {{ log.volumeAnalysis?.zScore?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Spike Flag:</span> {{ log.volumeAnalysis?.spikeFlag ? 'Yes' : 'No' }}</div>
                            <div><span class="font-semibold">Absorption Index:</span> {{ log.volumeAnalysis?.absorptionIndex?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Delta Alignment:</span> {{ log.volumeAnalysis?.deltaAlignment ? 'Aligned' : 'Opposed' }}</div>
                            <div><span class="font-semibold">Volume-Momentum Corr:</span> {{ log.volumeAnalysis?.corrVolumeMomentum?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">VWAP:</span> {{ log.volumeAnalysis?.vwap?.toFixed(4) ?? '-' }}</div>
                            <div><span class="font-semibold">VWAP Deviation %:</span> {{ log.volumeAnalysis?.vwapDeviationPercent?.toFixed(2) ?? '-' }}</div>
                            <div><span class="font-semibold">Volume Pressure:</span> {{ log.volumeAnalysis?.volumePressure?.toFixed(2) ?? '-' }}</div>
                        </div>

                        
                        <div class="vol-lg-4">
                            <div><span class="font-semibold">Candle Data:</span></div>
                            <div><span class="font-semibold">O:</span> {{ log.currentCandleData.o }}</div>
                            <div><span class="font-semibold">H:</span> {{ log.currentCandleData.h }}</div>
                            <div><span class="font-semibold">L:</span> {{ log.currentCandleData.l }}</div>
                            <div><span class="font-semibold">C:</span> {{ log.currentCandleData.c }}</div>
                            <div><span class="font-semibold">Volume:</span> {{ log.currentCandleData.volume }}</div>
                            <div><span class="font-semibold">Volume Change %:</span> {{ log.currentCandleData.volume_change_percentage }}</div>
                            <div><span class="font-semibold">Body V:</span> {{ log.currentCandleData.body_v }}</div>
                            <div><span class="font-semibold">Top Wick V:</span> {{ log.currentCandleData.top_wick_v }}</div>
                            <div><span class="font-semibold">Bottom Wick V:</span> {{ log.currentCandleData.bottom_wick_v }}</div>
                            <div><span class="font-semibold">Strength V:</span> {{ log.currentCandleData.strength_v }}</div>
                            <div><span class="font-semibold">Change % V:</span> {{ log.currentCandleData.change_percentage_v }}</div>
                            <div><span class="font-semibold">Side:</span> {{ log.currentCandleData.side }}</div>
                            <!-- <div><span class="font-semibold">Previous Candle:</span>
                            O: {{ log.currentCandleData.previousCandle.o }},
                            H: {{ log.currentCandleData.previousCandle.h }},
                            L: {{ log.currentCandleData.previousCandle.l }},
                            C: {{ log.currentCandleData.previousCandle.c }},
                            Volume: {{ log.currentCandleData.previousCandle.volume }}
                            </div> -->
                        </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6" style="text-align: right; font-weight: 600;">Total:</td>
                <td>{{ formatNumber(totalOpeningFee) }}</td>
                <td>{{ formatNumber(totalPnl) }}</td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TradeLog } from "@/core/interfaces";
import { tradeLogger } from "@/utility/tradeSignalLoggerUtility";
import { ref, onMounted, computed } from "vue";

const logs = ref<TradeLog[]>([]);
const loading = ref(true);
const showModal = ref(false);
const expandedLogId = ref<number | null>(null);

function formatDuration(ms: number | null): string {
  if (!ms) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(2);
}

const totalOpeningFee = computed(() =>
  logs.value.reduce((sum, log) => sum + (log.takerFee ?? 0), 0)
);

const totalPnl = computed(() =>
  logs.value.reduce((sum, log) => sum + (log.pnl ?? 0), 0)
);

function toggleDetails(id: number) {
  expandedLogId.value = expandedLogId.value === id ? null : id;
}

onMounted(async () => {
  await tradeLogger.init();
  logs.value = await tradeLogger.getAllLogs();
  loading.value = false;
});

async function show_Clicked(){
    showModal.value = true;
    logs.value = await tradeLogger.getAllLogs();
}

function copyLogJson(log: TradeLog) {
  try {
    const jsonString = JSON.stringify(log, null, 2);
    navigator.clipboard.writeText(jsonString);
    console.log("Trade log copied to clipboard");
  } catch (err) {
    console.error("Failed to copy trade log:", err);
  }
}
</script>

<style scoped>
.log-button {
  background-color: #222;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 500;
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.log-button:hover {
  background-color: #444;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}
.modal {
  background: #fff;
  color: #222;
  width: 90%;
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  border-radius: 10px;
  box-shadow: 0 4px 25px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f0f0f0;
  padding: 0.8rem 1.2rem;
  font-weight: 600;
  border-bottom: 1px solid #ddd;
}
.close-btn {
  background: transparent;
  border: none;
  font-size: 1.6rem;
  cursor: pointer;
  line-height: 1;
  color: #444;
}
.table-wrapper {
  overflow-y: auto;
  max-height: 70vh;
}
.trade-table {
  width: 100%;
  border-collapse: collapse;
  background-color: #fff;
}
.trade-table th {
  background: #f7f7f7;
  text-align: left;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid #ddd;
  font-size: 0.9rem;
  position: sticky;
  top: 0;
}
.trade-table td {
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid #eee;
  font-size: 0.9rem;
}
.trade-table tr.won {
  background-color: #d1f7d6;
}
.trade-table tr.loss {
  background-color: #f8d6d6;
}
.trade-table tr:hover {
  background-color: #f3f3f3;
}
.details-row {
  background-color: #f9f9f9;
}
.details-grid, .zone-grid, .candle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  padding: 8px 0;
}
.zone-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)) !important;
}
.loading {
  padding: 1rem;
  text-align: center;
  font-style: italic;
}
</style>
