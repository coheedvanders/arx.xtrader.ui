// thesisDb.ts
//
// IndexedDB persistence for recorded trade "theses" — a snapshot of the
// candles on screen plus the entry/TP/SL a position was (or would be)
// placed at, together with a short freeform remark, saved via the
// "Add Thesis" button in CandleEntryVisualizerComponent.vue.
//
// Mirrors the shape of the existing flowMovementDb.ts pattern: a single
// object store, opened lazily, with small typed helper functions layered
// on top of the raw IndexedDB API (no external dependency).

import type { CandleEntry } from '@/core/interfaces';

const DB_NAME = 'thesisDb';
const DB_VERSION = 1;
const STORE_NAME = 'theses';
const SYMBOL_INDEX = 'symbol';
const CREATED_AT_INDEX = 'createdAt';

export interface ThesisRecord {
  /** Auto-incrementing primary key — omitted when creating a new record. */
  id?: number;
  /** e.g. 'btcusdt' — same casing/shape as CandleEntryVisualizerComponent's `symbol` prop. */
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  /** openTime (ms) of the candle the thesis was anchored to, so it can be re-plotted on the chart later. Null if unavailable. */
  entryOpenTime: number | null;
  /** ms epoch when the thesis was recorded. */
  createdAt: number;
  /** Freeform notes entered via the "Add Thesis" prompt. */
  remarks: string;
  /** Snapshot of the candles visible when the thesis was recorded. */
  candles: CandleEntry[];
}

function openThesisDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex(SYMBOL_INDEX, SYMBOL_INDEX, { unique: false });
        store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX, { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Saves a new thesis record. Returns the generated id. */
export async function saveThesis(entry: Omit<ThesisRecord, 'id'>): Promise<number> {
  const db = await openThesisDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(entry);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Deletes a thesis record by id. */
export async function deleteThesis(id: number): Promise<void> {
  const db = await openThesisDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** All thesis records for a single symbol, newest first. */
export async function getThesesForSymbol(symbol: string): Promise<ThesisRecord[]> {
  const db = await openThesisDb();
  try {
    const results = await new Promise<ThesisRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index(SYMBOL_INDEX);
      const req = index.getAll(IDBKeyRange.only(symbol));
      req.onsuccess = () => resolve(req.result as ThesisRecord[]);
      req.onerror = () => reject(req.error);
    });
    return results.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

/** Every thesis record across all symbols, newest first. */
export async function getAllTheses(): Promise<ThesisRecord[]> {
  const db = await openThesisDb();
  try {
    const results = await new Promise<ThesisRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as ThesisRecord[]);
      req.onerror = () => reject(req.error);
    });
    return results.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

/** Every thesis record created at or after `sinceMs`, newest first. */
export async function getThesesSince(sinceMs: number): Promise<ThesisRecord[]> {
  const all = await getAllTheses();
  return all.filter(t => t.createdAt >= sinceMs);
}

/** Convenience helper — theses recorded in the last N days (default 5, matching ThesisRecordComponent). */
export async function getRecentTheses(days = 5): Promise<ThesisRecord[]> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return getThesesSince(sinceMs);
}