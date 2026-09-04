// ─── Flow movement IndexedDB cache ──────────────────────────────────────────────
//
// Stores the raw wallet-movement records fetched per symbol by
// FlowMovementScanner.vue, keyed by symbol, so:
//   - the scanner doesn't have to re-hit the whale-tracker API for a symbol
//     it already scanned recently
//   - CandleEntryVisualizerComponent.vue can load a symbol's last-scanned
//     movement history the instant it opens (no network wait) and render
//     spike boxes over historical candles
//
// Plain `indexedDB` — no external deps, works the same in any Vue/Vite app.

import { totalFlowInWindow, dominantFlowInWindow, type FlowMovementRecord } from './flowMovement'

const DB_NAME = 'flowMovementDb'
const DB_VERSION = 1
const STORE_NAME = 'symbolMovements'

export interface FlowMovementDbEntry {
  /** Always uppercase — matches Binance/whale-tracker symbol casing. */
  symbol: string
  movements: FlowMovementRecord[]
  /** Range the movements were fetched for. */
  startMs: number
  endMs: number
  /** Candle interval (ms) the movements were bucketed at when this entry was computed — 15m for the scanner. */
  intervalMs: number
  totalFlowLast24: number
  zScore: number | null
  hasSpike: boolean
  fetchedAt: number
  /**
   * True only when `totalFlowLast24`/`zScore`/`hasSpike` above were computed
   * by FlowMovementScanner.vue's own sweep (fixed 15m interval, 60-candle
   * fetch, 24-candle lookback, z>=3 threshold) — the canonical basis the
   * scanner's own list is sorted/filtered by.
   *
   * CandleEntryVisualizerComponent.vue's background backfill
   * (`ensureFlowScannerCoverage`) writes to this SAME record (keyed only by
   * `symbol`) to top up `movements` for whatever interval/candle-range the
   * chart currently has open — which is very often NOT 15m/60/24. It must
   * never overwrite the three verdict fields above when `scannerVerified` is
   * already true, or a chart opened at 1h/4h/1d silently clobbers the
   * scanner's real verdict with one computed on a different basis, and the
   * scanner's list stops matching what it actually scanned. See the
   * `ensureFlowScannerCoverage` comment in CandleEntryVisualizerComponent.vue
   * for the full story.
   */
  scannerVerified: boolean
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * In-memory mirror of the IDB store, keyed by uppercase symbol.
 *
 * `getFlowMovement` is called once per candle by `totalFlowForCandle` /
 * `getDominantFlowMovement`, and callers (the visualizer's z-score/dominant-
 * flow loop, the scanner's sweep) walk hundreds of candles per symbol —
 * without this cache that's hundreds of redundant IDB transactions fetching
 * the exact same record back to back. IDB reads are cheap individually but
 * the transaction-open overhead adds up fast at that call volume, which is
 * what was actually making `totalFlowForCandle`/`getDominantFlowMovement`
 * slow in a per-candle loop.
 *
 * `null` is a valid cached value (means "confirmed no entry for this
 * symbol yet") and must be distinguished from "not cached yet" — hence a
 * `Map<string, FlowMovementDbEntry | null>` checked with `.has()` rather
 * than a plain object or a truthiness check. Every write path
 * (`saveFlowMovement`, `deleteFlowMovement`) updates this cache at the same
 * point it commits to IDB, so a caller can never read a stale entry after a
 * legitimate write — this matters especially for `scannerVerified`, since
 * the scanner sweep and `ensureFlowScannerCoverage` both write the same
 * record from different call sites.
 */
const entryCache = new Map<string, FlowMovementDbEntry | null>()

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'symbol' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

export async function saveFlowMovement(entry: FlowMovementDbEntry): Promise<void> {
  const db = await openDb()
  const normalized: FlowMovementDbEntry = { ...entry, symbol: entry.symbol.toUpperCase() }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(normalized)
    tx.oncomplete = () => {
      entryCache.set(normalized.symbol, normalized)
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function getFlowMovement(symbol: string): Promise<FlowMovementDbEntry | null> {
  const key = symbol.toUpperCase()
  if (entryCache.has(key)) return entryCache.get(key)!

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => {
      const result = (req.result as FlowMovementDbEntry) ?? null
      entryCache.set(key, result)
      resolve(result)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getAllFlowMovements(): Promise<FlowMovementDbEntry[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      const results = (req.result as FlowMovementDbEntry[]) ?? []
      // Warm the cache for every entry while we're here — a full sweep call
      // up front means every later per-candle getFlowMovement() call in the
      // same session is a pure in-memory cache hit, no IDB transaction at all.
      for (const result of results) entryCache.set(result.symbol, result)
      resolve(results)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteFlowMovement(symbol: string): Promise<void> {
  const db = await openDb()
  const key = symbol.toUpperCase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => {
      entryCache.set(key, null)
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Totals exchange wallet flow (abs(inflow) + abs(outflow)) for a single
 * candle, identified by its `openTime` (ms epoch) — e.g. 1787172300000 —
 * against whatever's cached for `symbol` in IndexedDB. `intervalMs` must
 * match the candle interval the openTime belongs to (900_000 for 15m,
 * 3_600_000 for 1h, etc.) since that's what defines the candle's window:
 * a movement counts toward it if its timestamp falls in
 * [openTime, openTime + intervalMs) — same rule `bucketFlowByCandle` and
 * `movementPerCandle` use everywhere else, just for one candle instead of a
 * whole array.
 *
 * Returns 0 (not an error) if there's no cached entry for `symbol` yet, or
 * if the entry exists but nothing lands in that window.
 *
 * Only the FIRST call for a given `symbol` in a session actually touches
 * IndexedDB — every call after that (including from
 * `getDominantFlowMovement` for the same symbol) is served from the
 * in-memory `entryCache`, so calling this in a per-candle loop is cheap.
 *
 * Example:
 *   const total = await totalFlowForCandle('BTCUSDT', 1787172300000, 15 * 60 * 1000)
 */
export async function totalFlowForCandle(
  symbol: string,
  openTime: number,
  intervalMs: number,
): Promise<number> {
  const entry = await getFlowMovement(symbol)
  if (!entry || entry.movements.length === 0) return 0
  return totalFlowInWindow(entry.movements, openTime, intervalMs)
}

/**
 * Which direction (inflow/outflow) dominated a single candle's window,
 * identified the same way as `totalFlowForCandle` — `openTime` (ms epoch)
 * plus `intervalMs` for the candle's interval — against whatever's cached
 * for `symbol` in IndexedDB.
 *
 * Returns `null` when there's no cached entry for `symbol`, no movements
 * land in that window, or inflow/outflow are exactly tied — never a guess.
 *
 * Shares the same `entryCache` as `totalFlowForCandle`, so calling both for
 * the same symbol across a candle loop only costs one IDB read total.
 *
 * Example:
 *   const direction = await getDominantFlowMovement('BTCUSDT', 1787172300000, 15 * 60 * 1000)
 *   // 'INFLOW' | 'OUTFLOW' | null
 */
export async function getDominantFlowMovement(
  symbol: string,
  openTime: number,
  intervalMs: number,
): Promise<'INFLOW' | 'OUTFLOW' | null> {
  const entry = await getFlowMovement(symbol)
  if (!entry || entry.movements.length === 0) return null
  return dominantFlowInWindow(entry.movements, openTime, intervalMs)
}