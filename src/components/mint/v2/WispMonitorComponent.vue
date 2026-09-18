<template>
  <div class="wisp-monitor">
    <!-- Train Wisp: scans every symbol's cached history, classifies every
         completed range into a POC Range profile type, and rebuilds the
         catalog below from scratch. -->
    <div class="wisp-train-section">
      <div class="wisp-train-header">
        <button class="wisp-train-btn" :disabled="trainingInProgress" @click="trainWisp">
          {{ trainingInProgress ? "Training…" : "Train Wisp" }}
        </button>
        <span v-if="!trainingInProgress && catalogEntries.length" class="wisp-train-summary">
          {{ catalogEntries.length }} classified ranges across {{ catalogGroups.length }} profile type{{ catalogGroups.length === 1 ? "" : "s" }}
        </span>
        <button
          v-if="!trainingInProgress && (catalogEntries.length || memories.length)"
          class="wisp-download-btn"
          title="Download the catalog and per-symbol memories as JSON"
          @click="downloadWispLearning"
        >⬇ Download</button>
        <button v-if="catalogEntries.length && !trainingInProgress" class="wisp-monitor-clear-legacy" @click="confirmClearCatalog">Clear catalog</button>
      </div>
      <div v-if="!trainingInProgress && Object.keys(extendedFeatureGapReasons).length" class="wisp-extfeat-gap">
        ⚠ Extended features (OI/long-short/volume/structure) missing on {{ Object.values(extendedFeatureGapReasons).reduce((a, b) => a + b, 0) }} range(s):
        <span v-for="(count, reason) in extendedFeatureGapReasons" :key="reason" class="wisp-extfeat-gap-reason">{{ reason }}: {{ count }}</span>
      </div>
      <div v-if="!trainingInProgress && Object.keys(fourHContextGapReasons).length" class="wisp-extfeat-gap">
        ⚠ 4H context missing on {{ Object.values(fourHContextGapReasons).reduce((a, b) => a + b, 0) }} range(s):
        <span v-for="(count, reason) in fourHContextGapReasons" :key="reason" class="wisp-extfeat-gap-reason">{{ reason }}: {{ count }}</span>
      </div>
      <div v-if="trainingProgress" class="wisp-train-progress">
        Scanning {{ trainingProgress.symbol }}… ({{ trainingProgress.current }}/{{ trainingProgress.total }})
        <div class="wisp-train-progress-bar">
          <div class="wisp-train-progress-fill" :style="{ width: (trainingProgress.current / trainingProgress.total * 100) + '%' }" />
        </div>
      </div>
      <div v-if="trainingError" class="wisp-train-error">{{ trainingError }}</div>

      <div v-if="catalogGroups.length" class="wisp-catalog-groups">
        <div v-for="group in catalogGroups" :key="group.profileTypeKey" class="wisp-catalog-group">
          <div class="wisp-catalog-group-header">
            <span class="wisp-catalog-ordering">{{ group.profileType.ordering.join(" > ") }}</span>
            <span class="wisp-catalog-meta">{{ group.profileType.favorableCount }}/{{ group.profileType.presentCount }} favorable · {{ group.profileType.spread }}</span>
            <span class="wisp-catalog-count">{{ group.entries.length }} sample{{ group.entries.length === 1 ? "" : "s" }}</span>
          </div>
          <div class="wisp-catalog-reactions">
            <div class="wisp-catalog-reaction-bar">
              <div
                v-for="cat in (['continuation', 'reversal', 'pin'] as const)"
                :key="cat"
                :class="['wisp-catalog-reaction-seg', 'reaction-' + cat]"
                :style="{ width: (group.entries.length ? group.reactionCounts[cat] / group.entries.length * 100 : 0) + '%' }"
                :title="`${cat}: ${group.reactionCounts[cat]} (${group.entries.length ? (group.reactionCounts[cat] / group.entries.length * 100).toFixed(0) : 0}%)`"
              />
            </div>
            <div class="wisp-catalog-reaction-labels">
              <span class="reaction-continuation">Continuation {{ group.reactionCounts.continuation }}</span>
              <span class="reaction-reversal">Reversal {{ group.reactionCounts.reversal }}</span>
              <span class="reaction-pin">Pin {{ group.reactionCounts.pin }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="wisp-monitor-summary">
      <span v-if="!loading">{{ memories.length }} stored {{ memories.length === 1 ? "story" : "stories" }} across {{ symbolCount }} symbol{{ symbolCount === 1 ? "" : "s" }}</span>
      <div class="wisp-monitor-summary-actions">
        <button v-if="legacyCount > 0" class="wisp-monitor-clear-legacy" @click="confirmClearLegacy">Clear {{ legacyCount }} legacy</button>
        <button class="wisp-monitor-clear-all" :disabled="!memories.length" @click="confirmClearAll">Clear All</button>
      </div>
    </div>

    <div v-if="loading" class="wisp-monitor-status">Loading…</div>
    <div v-else-if="!memories.length" class="wisp-monitor-status">
      No stored stories yet — running a wisp scan (the ` hotkey or Ask Wisp) saves what it finds here.
    </div>

    <div v-else class="wisp-monitor-groups">
      <div v-for="group in groupedBySymbol" :key="group.symbol" class="wisp-monitor-group">
        <div class="wisp-monitor-group-header">
          <span class="wisp-monitor-group-symbol">{{ group.symbol }}</span>
          <span class="wisp-monitor-group-count">{{ group.entries.length }}</span>
          <button class="wisp-monitor-group-clear" title="Clear this symbol's stored stories" @click="confirmClearSymbol(group.symbol, group.entries)">Clear</button>
        </div>
        <div class="wisp-monitor-table-wrap">
          <table class="wisp-monitor-table">
            <thead>
              <tr>
                <th>Dir</th>
                <th>Start (openTime)</th>
                <th>End (openTime)</th>
                <th>AVWAP</th>
                <th>FRVP POC</th>
                <th>Red level</th>
                <th>MFE</th>
                <th>MAE</th>
                <th>Saved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in group.entries" :key="entry.id" :class="{ 'legacy-row': isLegacyEntry(entry) }">
                <td :class="entry.story.direction === 'LONG' ? 'dir-long' : 'dir-short'">{{ entry.story.direction }}</td>
                <td class="mono">{{ entry.story.startOpenTime }}</td>
                <td class="mono">{{ entry.story.endOpenTime }}</td>
                <td class="mono">{{ entry.story.avwap?.toFixed(6) ?? "—" }}</td>
                <td class="mono">{{ entry.story.frvpPoc != null ? entry.story.frvpPoc.toFixed(6) : "—" }}</td>
                <td class="mono">{{ entry.story.redLevel != null ? entry.story.redLevel.toFixed(6) : "—" }}</td>
                <td class="mono">{{ entry.story.mfe?.toFixed(6) ?? "—" }}</td>
                <td class="mono">{{ entry.story.mae?.toFixed(6) ?? "—" }}</td>
                <td>{{ new Date(entry.savedAt).toLocaleString() }}<span v-if="isLegacyEntry(entry)" class="legacy-badge" title="Saved under an older, incompatible schema — missing fields the current wisp expects (e.g. avwap). Safe to clear.">legacy</span></td>
                <td><button class="wisp-monitor-row-delete" title="Delete this story" @click="deleteOne(entry.id)">✕</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { listAllWispMemories, deleteWispMemory, clearAllWispMemories, type WispMemoryEntry } from "@/utility/wispMemoryDb";
import { findPointCandles, buildPointCandleRanges, measureRangeStory } from "@/utility/pastCandleWisp";
import { extractExtendedFeatures } from "@/utility/wispExtendedFeatures";
import { extractFourHContext } from "@/utility/wisp4hContext";
import { computeProfileSignature, computeProfileType, computeReactionCategory, profileTypeKey, type ProfileType, type ReactionCategory } from "@/utility/pocRangeProfile";
import { listCatalogEntries, saveCatalogEntries, clearCatalog, groupCatalogByProfileType, type CatalogEntry, type ProfileTypeGroup } from "@/utility/pocRangeCatalogDb";
import { klineDbUtilityV2 } from "@/utility/v2/klineDbUtilityV2";
import { useChocoMintoStore } from "@/stores/chocoMintoStore";

const chocoMintoStore = useChocoMintoStore();

const memories = ref<WispMemoryEntry[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    memories.value = await listAllWispMemories();
    catalogEntries.value = await listCatalogEntries();
  } catch (err) {
    console.error("Failed to load wisp memories:", err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const catalogEntries = ref<CatalogEntry[]>([]);
const catalogGroups = computed(() => groupCatalogByProfileType(catalogEntries.value));
const trainingInProgress = ref(false);
const trainingProgress = ref<{ current: number; total: number; symbol: string } | null>(null);
const trainingError = ref<string | null>(null);
/** Breakdown of why extractExtendedFeatures returned null, by reason — diagnostic surface for the gap where 0 of a real 2483-entry catalog came back with extended features despite the extraction logic itself being verified correct against real data. */
const extendedFeatureGapReasons = ref<Record<string, number>>({});
/** Same diagnostic pattern as extendedFeatureGapReasons, for the 4H context extraction. */
const fourHContextGapReasons = ref<Record<string, number>>({});

/**
 * Walks every symbol chocoMintoStore knows about, using ONLY whatever
 * SymbolInfo is already cached in IndexedDB (klineDbUtilityV2.getSymbolInfo
 * never fetches live) — a symbol with nothing cached is skipped, not
 * treated as an error, since "haven't loaded that one yet" is a normal
 * state, not a failure.
 *
 * For each symbol: find every point candle, build its self-contained
 * range (buildPointCandleRanges — the same, verified-correct definition
 * the actual combo placement uses), measure every range that has a
 * completed story (the most recent range per symbol is the CURRENT
 * reference setup, not yet resolved, so it's skipped here — training
 * only learns from ranges with a known outcome), classify it into a
 * profile type and reaction category, and save the raw classification.
 *
 * Clears the whole catalog first and rebuilds from scratch — this store
 * represents "what the market looks like right now" across everything
 * scanned, not an accumulating history, so a stale entry from a symbol
 * that's since restructured shouldn't linger from a previous run.
 */
function diagnoseExtendedFeaturesGap(candles: any[], range: { startGi: number; endGi: number }): string | null {
  const start = candles[range.startGi];
  const end = candles[range.endGi];
  if (!start || !end) return "startGi/endGi out of range";
  if (!start.openInterest) return "missing openInterest at startGi";
  if (!end.openInterest) return "missing openInterest at endGi";
  if (!start.longShort) return "missing longShort at startGi";
  if (!end.longShort) return "missing longShort at endGi";
  if (!end.volumeState) return "missing volumeState at endGi";
  if (!end.candleStructure) return "missing candleStructure at endGi";
  return null; // shouldn't happen if extractExtendedFeatures itself returned null
}

function diagnoseFourHContextGap(candles4h: any[] | undefined, range: { endOpenTime: number }): string {
  if (!candles4h || !candles4h.length) return "no 4h candle data cached for this symbol";
  const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
  const closed = candles4h.filter((c: any) => c.openTime + FOUR_HOUR_MS <= range.endOpenTime);
  if (!closed.length) return "not enough 4h history closed yet at this range's confirm time";
  const last = closed[closed.length - 1];
  if (!last.candleStructure) return "4h candle missing candleStructure";
  if (!last.openInterest) return "4h candle missing openInterest";
  if (!(last.atr > 0)) return "4h candle has zero/missing atr";
  return "unknown";
}

async function trainWisp() {
  if (trainingInProgress.value) return;
  trainingInProgress.value = true;
  trainingError.value = null;
  try {
    await clearCatalog();
    extendedFeatureGapReasons.value = {};
    fourHContextGapReasons.value = {};
    const symbols = chocoMintoStore.futureSymbols.map(f => f.symbol);
    let totalEntries = 0;

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      trainingProgress.value = { current: i + 1, total: symbols.length, symbol };

      try {
        const info = await klineDbUtilityV2.getSymbolInfo(symbol);
        const candles = info?.candle_15m;
        const candles4h = info?.candle_4h;
        if (!candles || !candles.length) continue;

        const points = findPointCandles(candles);
        if (points.length < 1) continue;
        const ranges = buildPointCandleRanges(candles, points);

        const symbolEntries: CatalogEntry[] = [];
        for (const range of ranges) {
          const nextPoint = points[range.pointIndex + 1];
          if (!nextPoint) continue; // this symbol's current, unresolved reference range — no outcome to learn from yet
          const story = measureRangeStory(candles, range, nextPoint.gi);
          if (!story) continue;

          const atr = candles[range.endGi]?.atr ?? 0;
          const signature = computeProfileSignature(story, atr);
          if (!signature) continue; // no usable ATR at this candle yet

          const type = computeProfileType(signature);
          const reaction = computeReactionCategory(story, atr);
          const extendedFeatures = extractExtendedFeatures(candles, range) ?? undefined;
          if (!extendedFeatures) {
            const reason = diagnoseExtendedFeaturesGap(candles, range) ?? "unknown";
            extendedFeatureGapReasons.value[reason] = (extendedFeatureGapReasons.value[reason] ?? 0) + 1;
          }
          const fourHContext = extractFourHContext(candles, candles4h ?? [], range) ?? undefined;
          if (!fourHContext) {
            const reason = diagnoseFourHContextGap(candles4h, range);
            fourHContextGapReasons.value[reason] = (fourHContextGapReasons.value[reason] ?? 0) + 1;
          }
          symbolEntries.push({
            id: `${symbol}:${story.startOpenTime}:${story.endOpenTime}`,
            symbol,
            profileTypeKey: profileTypeKey(type),
            profileType: type,
            signature,
            reaction,
            direction: story.direction,
            startOpenTime: story.startOpenTime,
            endOpenTime: story.endOpenTime,
            savedAt: Date.now(),
            avwap: story.avwap,
            frvpPoc: story.frvpPoc,
            redLevel: story.redLevel,
            referencePrice: story.referencePrice,
            mfe: story.mfe,
            mae: story.mae,
            mfeNormalized: story.mfe / atr,
            maeNormalized: story.mae / atr,
            extendedFeatures,
            fourHContext,
          });
        }

        if (symbolEntries.length) {
          await saveCatalogEntries(symbolEntries);
          totalEntries += symbolEntries.length;
        }
      } catch (err) {
        // One symbol's own data being malformed shouldn't abort scanning
        // every other symbol — log it and keep going.
        console.error(`Train Wisp: failed on ${symbol}:`, err);
      }
    }

    catalogEntries.value = await listCatalogEntries();
    if (!totalEntries) {
      trainingError.value = "Scan completed but found no usable ranges — check that symbols have cached candle history with liquidityAnchor data.";
    }
  } catch (err) {
    trainingError.value = `Training failed: ${(err as Error)?.message ?? err}`;
    console.error("Train Wisp failed:", err);
  } finally {
    trainingInProgress.value = false;
    trainingProgress.value = null;
  }
}

/**
 * Exports everything wisp currently knows — the cross-symbol catalog and
 * the per-symbol memories — as one JSON file. Meant for handing off a
 * concrete snapshot of "what wisp actually learned" when discussing it
 * outside this app, the same way symbolInfo gets downloaded for sharing
 * real data rather than describing it secondhand.
 */
function downloadWispLearning() {
  const payload = {
    exportedAt: new Date().toISOString(),
    catalogEntries: catalogEntries.value,
    catalogGroups: catalogGroups.value.map(g => ({
      profileTypeKey: g.profileTypeKey,
      profileType: g.profileType,
      sampleCount: g.entries.length,
      reactionCounts: g.reactionCounts,
    })),
    perSymbolMemories: memories.value,
    extendedFeatureGapReasons: extendedFeatureGapReasons.value,
    fourHContextGapReasons: fourHContextGapReasons.value,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `wisp-learning-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function confirmClearCatalog() {
  if (!catalogEntries.value.length) return;
  if (!confirm(`Clear the entire trained catalog (${catalogEntries.value.length} classified ranges across every symbol)? This can't be undone — you'd need to re-run Train Wisp.`)) return;
  try {
    await clearCatalog();
    catalogEntries.value = [];
  } catch (err) {
    console.error("Failed to clear catalog:", err);
  }
}

const symbolCount = computed(() => new Set(memories.value.map(m => m.symbol)).size);

const groupedBySymbol = computed(() => {
  const map = new Map<string, WispMemoryEntry[]>();
  for (const m of memories.value) {
    if (!map.has(m.symbol)) map.set(m.symbol, []);
    map.get(m.symbol)!.push(m);
  }
  return [...map.entries()]
    .map(([symbol, entries]) => ({ symbol, entries: entries.sort((a, b) => b.story.endOpenTime - a.story.endOpenTime) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
});

function isLegacyEntry(entry: WispMemoryEntry): boolean {
  const s = entry.story as any;
  return s.avwap === undefined || s.mfe === undefined || s.mae === undefined;
}

async function deleteOne(id: string) {
  try {
    await deleteWispMemory(id);
    await load();
  } catch (err) {
    console.error("Failed to delete wisp memory:", err);
  }
}

async function confirmClearSymbol(symbol: string, entries: WispMemoryEntry[]) {
  if (!confirm(`Clear all ${entries.length} stored ${entries.length === 1 ? "story" : "stories"} for ${symbol}? This can't be undone.`)) return;
  try {
    for (const e of entries) await deleteWispMemory(e.id);
    await load();
  } catch (err) {
    console.error("Failed to clear symbol's wisp memories:", err);
  }
}

const legacyCount = computed(() => memories.value.filter(isLegacyEntry).length);

async function confirmClearLegacy() {
  const legacy = memories.value.filter(isLegacyEntry);
  if (!legacy.length) return;
  if (!confirm(`Clear ${legacy.length} legacy ${legacy.length === 1 ? "entry" : "entries"} saved under an older, incompatible schema? This can't be undone.`)) return;
  try {
    for (const e of legacy) await deleteWispMemory(e.id);
    await load();
  } catch (err) {
    console.error("Failed to clear legacy wisp memories:", err);
  }
}

async function confirmClearAll() {
  if (!confirm(`Clear all ${memories.value.length} stored wisp ${memories.value.length === 1 ? "story" : "stories"} across every symbol? This can't be undone.`)) return;
  try {
    await clearAllWispMemories();
    await load();
  } catch (err) {
    console.error("Failed to clear all wisp memories:", err);
  }
}

defineExpose({ load });
</script>

<style scoped>
.wisp-monitor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.wisp-train-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,.1);
}
.wisp-train-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wisp-train-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 5px;
  border: 1px solid #a78bfa;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
  cursor: pointer;
}
.wisp-train-btn:hover:not(:disabled) { background: rgba(167, 139, 250, 0.22); }
.wisp-train-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.wisp-train-summary { font-size: 11.5px; color: #99a; }
.wisp-download-btn {
  margin-left: auto;
  font-size: 10.5px;
  padding: 3px 9px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,.15);
  color: #99a;
  background: transparent;
  cursor: pointer;
}
.wisp-download-btn:hover { border-color: #a78bfa; color: #a78bfa; }
.wisp-extfeat-gap {
  font-size: 10.5px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 4px;
  padding: 5px 8px;
  line-height: 1.5;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.wisp-extfeat-gap-reason { color: #99a; }
.wisp-train-progress {
  font-size: 11px;
  color: #a78bfa;
}
.wisp-train-progress-bar {
  margin-top: 4px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,.08);
  overflow: hidden;
}
.wisp-train-progress-fill {
  height: 100%;
  background: #a78bfa;
  transition: width 0.15s ease;
}
.wisp-train-error {
  font-size: 11px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 4px;
  padding: 6px 10px;
}
.wisp-catalog-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 40vh;
  overflow-y: auto;
}
.wisp-catalog-group {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 6px;
  padding: 8px 10px;
}
.wisp-catalog-group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  margin-bottom: 6px;
}
.wisp-catalog-ordering { font-family: var(--mono); color: #c8ccd4; font-weight: 600; }
.wisp-catalog-meta { color: #99a; }
.wisp-catalog-count { margin-left: auto; color: #667; font-family: var(--mono); }
.wisp-catalog-reaction-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255,255,255,.05);
}
.wisp-catalog-reaction-seg.reaction-continuation { background: var(--bull); }
.wisp-catalog-reaction-seg.reaction-reversal { background: var(--bear); }
.wisp-catalog-reaction-seg.reaction-pin { background: #667; }
.wisp-catalog-reaction-labels {
  display: flex;
  gap: 10px;
  font-size: 10px;
  margin-top: 4px;
}
.wisp-catalog-reaction-labels .reaction-continuation { color: var(--bull); }
.wisp-catalog-reaction-labels .reaction-reversal { color: var(--bear); }
.wisp-catalog-reaction-labels .reaction-pin { color: #99a; }
.wisp-monitor-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #99a;
}
.wisp-monitor-summary-actions { display: flex; gap: 8px; }
.wisp-monitor-clear-legacy {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #ffc107;
  color: #ffc107;
  background: rgba(255, 193, 7, 0.08);
  cursor: pointer;
}
.wisp-monitor-clear-legacy:hover { background: rgba(255, 193, 7, 0.18); }
.wisp-monitor-clear-all {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--bear);
  color: var(--bear);
  background: rgba(239, 83, 80, 0.08);
  cursor: pointer;
}
.wisp-monitor-clear-all:hover:not(:disabled) { background: rgba(239, 83, 80, 0.18); }
.wisp-monitor-clear-all:disabled { opacity: 0.4; cursor: not-allowed; }
.wisp-monitor-status {
  font-size: 12px;
  color: #667;
  text-align: center;
  padding: 24px 12px;
}
.wisp-monitor-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 60vh;
  overflow-y: auto;
}
.wisp-monitor-group {
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 6px;
  overflow: hidden;
}
.wisp-monitor-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255,255,255,.04);
}
.wisp-monitor-group-symbol { font-weight: 600; font-size: 12px; color: #c8ccd4; }
.wisp-monitor-group-count { font-size: 11px; color: #99a; font-family: var(--mono); }
.wisp-monitor-group-clear {
  margin-left: auto;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,.15);
  color: #99a;
  background: transparent;
  cursor: pointer;
}
.wisp-monitor-group-clear:hover { border-color: var(--bear); color: var(--bear); }
.wisp-monitor-table-wrap { overflow-x: auto; }
.wisp-monitor-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.wisp-monitor-table th {
  text-align: left;
  padding: 4px 8px;
  color: #667;
  font-weight: 500;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.wisp-monitor-table td {
  padding: 4px 8px;
  color: #c8ccd4;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255,255,255,.04);
}
.wisp-monitor-table .mono { font-family: var(--mono); }
.wisp-monitor-table .dir-long { color: var(--bull); font-weight: 600; }
.wisp-monitor-table .dir-short { color: var(--bear); font-weight: 600; }
.legacy-row { opacity: 0.55; }
.legacy-badge {
  margin-left: 6px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
  text-transform: uppercase;
}
.wisp-monitor-row-delete {
  background: transparent;
  border: none;
  color: #667;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
}
.wisp-monitor-row-delete:hover { color: var(--bear); }
</style>