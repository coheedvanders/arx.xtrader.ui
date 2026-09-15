// toolCacheDb.ts
//
// Persists the drawing-tool objects placed on the chart in
// CandleVisualizerV2Component.vue — rectangles, trend lines, horizontal
// lines, vertical lines, price-range boxes, text annotations, and
// long/short positions — keyed by symbol. Previously none of this
// survived a reload; now reopening the same symbol restores exactly
// what was drawn on it.
//
// FRVP zones, AVWAP anchors, and liquidity ranges are stored differently
// from everything else above: those are computed FROM a startGi/endGi
// (or anchorGi) slice of candle data, not just positioned by one. Saving
// the raw gi directly would reproduce the exact "drawing points at the
// wrong place" bug this cache exists to prevent — the same numeric index
// can point at a completely different candle once the underlying data
// has shifted between sessions. So these three save the ANCHOR TIMES
// (frvpAnchors / liquidityAnchors / avwapAnchors) instead of the gi
// itself; the component converts time back to whatever gi is current at
// load time (giFromTime) and recomputes the zone/line from there, rather
// than trusting a stored gi to still mean the same thing.
//
// No external dependency — plain native IndexedDB, wrapped in a small
// promise-based API so callers don't have to deal with
// IDBRequest/onsuccess/onerror boilerplate directly.

const DB_NAME = "cev2-tool-cache-db";
const DB_VERSION = 1;
const STORE = "toolCache";

export interface ToolCacheTimeAnchor {
  id: string;
  startOpenTime: number;
  endOpenTime: number;
  /** Only meaningful for liquidityAnchors — a manually-run prediction is restored as-is, not recomputed, since it's a snapshot of a judgment made at that time, not a derived value that needs to stay current. */
  prediction?: unknown;
}

export interface ToolCachePointAnchor {
  id: string;
  anchorOpenTime: number;
}

export interface ToolCachePayload {
  symbol: string;
  rectangles: unknown[];
  trendLines: unknown[];
  horizontalLines: unknown[];
  verticalLines: unknown[];
  priceRangeBoxes: unknown[];
  textAnnotations: unknown[];
  positions: unknown[];
  /** Optional — absent on any record saved before this field existed; the component treats a missing array the same as an empty one. */
  frvpAnchors?: ToolCacheTimeAnchor[];
  liquidityAnchors?: ToolCacheTimeAnchor[];
  avwapAnchors?: ToolCachePointAnchor[];
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