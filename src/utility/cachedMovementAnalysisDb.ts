// cachedMovementAnalysisDb.ts
//
// Persists SimulationAnalysisReport results from the Movement Analyzer
// modal ("Run All"), keyed by symbol. One cached report per symbol,
// overwritten on each re-run — same choice as toolCacheDb.ts ("one cached
// tool-set per symbol") rather than accumulating a growing history, since
// re-running is expected to supersede the previous result, not append to
// it.
//
// No external dependency — plain native IndexedDB, wrapped in a small
// promise-based API, matching the existing convention in this codebase
// (see toolCacheDb.ts / notesDb.ts).

import type { SimulationAnalysisReport } from "@/core/interfacesv2";

const DB_NAME = "cev2-movement-analysis-db";
const DB_VERSION = 1;
const STORE = "movementAnalysis";

export interface CachedMovementAnalysis {
  symbol: string;
  report: SimulationAnalysisReport;
  updatedAt: number;
}

/** Lightweight projection for the paginated list UI — avoids holding every full report in memory just to render a table. */
export interface CachedMovementAnalysisSummary {
  symbol: string;
  interval: string;
  candleCount: number;
  startTime: number;
  endTime: number;
  generatedAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath "symbol" — one cached report per symbol, overwritten on every save.
        db.createObjectStore(STORE, { keyPath: "symbol" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open movement analysis DB"));
  });
  return dbPromise;
}

/** Overwrite the cached report for a symbol. */
export async function saveMovementAnalysis(payload: CachedMovementAnalysis): Promise<void> {
  const db = await openDb();
  // Same defensive clone as toolCacheDb.saveToolCache / notesDb.saveNote —
  // the report is commonly built from Vue-reactive candle data, which
  // IndexedDB's structured-clone step rejects with "DataCloneError".
  const plain = JSON.parse(JSON.stringify(payload)) as CachedMovementAnalysis;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(plain);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save movement analysis"));
    tx.onabort = () => reject(tx.error ?? new Error("Save movement analysis transaction aborted"));
  });
}

/** The cached report for a symbol, or null if nothing has been saved yet. */
export async function loadMovementAnalysis(symbol: string): Promise<CachedMovementAnalysis | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(symbol);
    req.onsuccess = () => resolve((req.result as CachedMovementAnalysis) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to load movement analysis"));
  });
}

/**
 * Summaries for every cached symbol, for the paginated list UI. Reads full
 * records (IndexedDB has no way around that for a getAll) but immediately
 * strips them down to the summary shape rather than returning/holding the
 * full reports in Vue state.
 */
export async function listMovementAnalysisSummaries(): Promise<CachedMovementAnalysisSummary[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as CachedMovementAnalysis[]) ?? [];
      const summaries: CachedMovementAnalysisSummary[] = rows.map((r) => ({
        symbol: r.symbol,
        interval: r.report.metadata.interval,
        candleCount: r.report.metadata.candleCount,
        startTime: r.report.metadata.startTime,
        endTime: r.report.metadata.endTime,
        generatedAt: r.report.metadata.generatedAt,
        updatedAt: r.updatedAt,
      }));
      summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list movement analyses"));
  });
}

/** Delete the cached report for a single symbol. */
export async function deleteMovementAnalysis(symbol: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(symbol);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete movement analysis"));
    tx.onabort = () => reject(tx.error ?? new Error("Delete movement analysis transaction aborted"));
  });
}

/** Remove every cached report (not currently wired to any UI action — available if a reset affordance is ever needed). */
export async function clearAllMovementAnalyses(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear movement analyses"));
    tx.onabort = () => reject(tx.error ?? new Error("Clear movement analyses transaction aborted"));
  });
}