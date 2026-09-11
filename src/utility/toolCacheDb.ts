// toolCacheDb.ts
//
// Persists the drawing-tool objects placed on the chart in
// CandleVisualizerV2Component.vue — rectangles, trend lines, horizontal
// lines, vertical lines, price-range boxes, and text annotations — keyed by
// symbol. Previously none of this survived a reload; now reopening the same
// symbol restores exactly what was drawn on it.
//
// FRVP zones, AVWAP anchors, and liquidity ranges are intentionally NOT
// included here yet — their anchoring is still index-based (see the
// time-anchored-drawings comment in the component), so persisting them
// across sessions/timeframes would currently reproduce the same
// "drawing points at the wrong place" bug this cache is meant to avoid.
// Once those are converted to time-based anchoring too, extend
// ToolCachePayload and the component's load/save wiring accordingly.
//
// No external dependency — plain native IndexedDB, wrapped in a small
// promise-based API so callers don't have to deal with
// IDBRequest/onsuccess/onerror boilerplate directly.

const DB_NAME = "cev2-tool-cache-db";
const DB_VERSION = 1;
const STORE = "toolCache";

export interface ToolCachePayload {
  symbol: string;
  rectangles: unknown[];
  trendLines: unknown[];
  horizontalLines: unknown[];
  verticalLines: unknown[];
  priceRangeBoxes: unknown[];
  textAnnotations: unknown[];
  positions: unknown[];
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
        // keyPath "symbol" — one cached tool-set per symbol, overwritten on
        // every save rather than accumulating a history.
        db.createObjectStore(STORE, { keyPath: "symbol" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open tool cache DB"));
  });
  return dbPromise;
}

/** The cached tool-set for a symbol, or null if nothing has been saved yet. */
export async function loadToolCache(symbol: string): Promise<ToolCachePayload | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(symbol);
    req.onsuccess = () => resolve((req.result as ToolCachePayload) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Failed to load tool cache"));
  });
}

/** Overwrite the cached tool-set for a symbol. */
export async function saveToolCache(payload: ToolCachePayload): Promise<void> {
  const db = await openDb();
  // Same defensive clone as notesDb.saveNote — the arrays here are commonly
  // Vue reactive proxies, which IndexedDB's structured-clone step rejects
  // with "DataCloneError: ... could not be cloned". Plain JSON round-trip
  // fixes it regardless of which framework/reactivity system calls this.
  const plain = JSON.parse(JSON.stringify(payload)) as ToolCachePayload;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(plain);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save tool cache"));
    tx.onabort = () => reject(tx.error ?? new Error("Save tool cache transaction aborted"));
  });
}

/** Remove the cached tool-set for a symbol (not currently wired to any UI action). */
export async function clearToolCache(symbol: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(symbol);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear tool cache"));
    tx.onabort = () => reject(tx.error ?? new Error("Clear tool cache transaction aborted"));
  });
}