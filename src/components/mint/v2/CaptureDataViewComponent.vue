<template>
  <div class="captured-data-view">
    <div v-if="loading" class="captured-data-empty">Loading…</div>
    <div v-else-if="!entries.length" class="captured-data-empty">
      No captured ranges yet — press 8 on the chart and drag a range to capture one.
    </div>
    <template v-else>
      <div class="captured-data-toolbar">
        <button class="captured-data-download-all" :disabled="downloading" @click="downloadAllAsZip">
          {{ downloading ? "Zipping…" : `Download All as ZIP (${entries.length})` }}
        </button>
        <button class="captured-data-clear-all" @click="clearAll">Clear All</button>
      </div>
      <div class="captured-data-list">
        <div v-for="e in entries" :key="e.id" class="captured-data-row">
          <div class="captured-data-row-main">
            <span class="captured-data-symbol">{{ e.symbol }}</span>
            <span class="captured-data-meta">{{ e.candles.length }} candles · {{ e.positions.length }} position(s) · {{ e.frvpZones.length }} FRVP · {{ e.liquidityRanges.length }} heatmap</span>
          </div>
          <div class="captured-data-row-meta">
            Captured {{ formatDate(e.capturedAt) }} · range {{ formatDate(e.startOpenTime) }} → {{ formatDate(e.endOpenTime) }}
          </div>
          <div v-if="e.label" class="captured-data-row-label">{{ e.label }}</div>
          <div class="captured-data-row-actions">
            <button @click="downloadOne(e)">Download</button>
            <button class="captured-data-delete" @click="remove(e)">Delete</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  listAllCapturedData,
  deleteCapturedData,
  clearAllCapturedData,
  type CapturedDataEntry,
} from "@/utility/captureDataDb";
import { buildZip, type ZipEntry } from "@/utility/zipWriter";

const entries = ref<CapturedDataEntry[]>([]);
const loading = ref(true);
const downloading = ref(false);

onMounted(async () => {
  try {
    entries.value = await listAllCapturedData();
  } catch (err) {
    console.error("Failed to load captured data:", err);
  } finally {
    loading.value = false;
  }
});

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fileNameFor(e: CapturedDataEntry): string {
  const stamp = new Date(e.capturedAt).toISOString().replace(/[:.]/g, "-");
  return `${e.symbol}_${stamp}.json`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadOne(e: CapturedDataEntry) {
  const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
  triggerDownload(blob, fileNameFor(e));
}

async function downloadAllAsZip() {
  if (downloading.value || !entries.value.length) return;
  downloading.value = true;
  try {
    const zipEntries: ZipEntry[] = entries.value.map((e) => ({
      name: fileNameFor(e),
      content: JSON.stringify(e, null, 2),
    }));
    const blob = buildZip(zipEntries);
    triggerDownload(blob, `captured-data-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
  } catch (err) {
    console.error("Failed to build zip:", err);
  } finally {
    downloading.value = false;
  }
}

async function remove(e: CapturedDataEntry) {
  entries.value = entries.value.filter((x) => x.id !== e.id);
  try {
    await deleteCapturedData(e.id);
  } catch (err) {
    console.error("Failed to delete captured data:", err);
  }
}

async function clearAll() {
  if (!entries.value.length) return;
  if (!confirm("Clear every captured range? This can't be undone.")) return;
  entries.value = [];
  try {
    await clearAllCapturedData();
  } catch (err) {
    console.error("Failed to clear captured data:", err);
  }
}
</script>

<style scoped>
.captured-data-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: #cdd3db;
}
.captured-data-empty {
  color: #667;
  text-align: center;
  padding: 24px 0;
}
.captured-data-toolbar {
  display: flex;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.captured-data-download-all {
  background: rgba(79, 195, 247, 0.1);
  border: 1px solid rgba(79, 195, 247, 0.45);
  color: #4fc3f7;
  border-radius: 4px;
  padding: 5px 12px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.captured-data-download-all:hover:not(:disabled) { background: rgba(79, 195, 247, 0.18); }
.captured-data-download-all:disabled { opacity: 0.45; cursor: not-allowed; }
.captured-data-clear-all {
  margin-left: auto;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #ef4444;
  border-radius: 4px;
  padding: 5px 12px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.captured-data-clear-all:hover { background: rgba(239, 68, 68, 0.2); }
.captured-data-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 55vh;
  overflow-y: auto;
}
.captured-data-row {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.captured-data-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.captured-data-symbol {
  font-weight: 700;
  color: #f8fafc;
}
.captured-data-meta {
  font-size: 10.5px;
  color: #9aa4b2;
}
.captured-data-row-meta {
  font-size: 10px;
  color: #667;
}
.captured-data-row-label {
  font-size: 11px;
  color: #cdd3db;
  font-style: italic;
}
.captured-data-row-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.captured-data-row-actions button {
  background: #171b21;
  border: 1px solid #3a4048;
  color: #cdd3db;
  border-radius: 4px;
  padding: 3px 10px;
  font-family: var(--mono, monospace);
  font-size: 11px;
  cursor: pointer;
}
.captured-data-row-actions button:hover { border-color: #f8fafc; color: #f8fafc; }
.captured-data-delete:hover { border-color: #ef4444 !important; color: #ef4444 !important; }
</style>