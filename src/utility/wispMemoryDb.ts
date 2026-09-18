// Intended location: src/utility/wispMemoryDb.ts
// (sibling of testPositionDb.ts, capturedDataDb.ts, sessionSummaryDb.ts)
//
// Every RangeStory a wisp scan computes gets saved here, per symbol —
// this is the "brain" the scan itself doesn't have yet on its own: right
// now, every scan re-derives every story from scratch from whatever
// candle history happens to be loaded, and none of it survives past the
// scan finishing. This module makes it survive, as a growing reference
// library keyed on the range's own openTimes (stable across sessions —
// unlike gi, which only means something relative to whatever candle
// window happens to be loaded at the time, the same lesson toolCacheDb.ts
// already had to learn the hard way).
//
// This module ONLY handles persistence. Whether/how a FUTURE scan should
// actually draw on this stored history (same-symbol only? across all
// symbols? weighted by recency?) is a separate, bigger design decision —
// deliberately not decided here.

import type { RangeStory } from "@/utility/pastCandleWisp";

const DB_NAME = "cev2-wisp-memory-db";
const DB_VERSION = 1;
const STORE = "wispMemories";

export interface WispMemoryEntry {
    id: string;
    symbol: string;
    savedAt: number;
    story: RangeStory;
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
                const store = db.createObjectStore(STORE, { keyPath: "id" });
                store.createIndex("symbol", "symbol", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Failed to open wisp memory DB"));
    });
    return dbPromise;
}

/** Deterministic — the same range saved twice (e.g. re-scanning the same symbol) overwrites the same record instead of duplicating it. */
export function wispMemoryId(symbol: string, story: RangeStory): string {
    return `${symbol}:${story.startOpenTime}:${story.endOpenTime}`;
}

/** Every stored story, most-recently-saved first. */
export async function listAllWispMemories(): Promise<WispMemoryEntry[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const rows = (req.result as WispMemoryEntry[]) ?? [];
            rows.sort((a, b) => b.savedAt - a.savedAt);
            resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to list wisp memories"));
    });
}

/** Just one symbol's stored stories — the natural scope for "does this symbol have a track record yet." */
export async function listWispMemoriesForSymbol(symbol: string): Promise<WispMemoryEntry[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const idx = tx.objectStore(STORE).index("symbol");
        const req = idx.getAll(symbol);
        req.onsuccess = () => {
            const rows = (req.result as WispMemoryEntry[]) ?? [];
            rows.sort((a, b) => b.savedAt - a.savedAt);
            resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to list wisp memories for symbol"));
    });
}

/**
 * Saves every story from one scan in a single transaction — a scan
 * produces potentially many stories at once, and this avoids N separate
 * round trips for what's really one save operation.
 */
export async function saveWispMemories(symbol: string, stories: RangeStory[]): Promise<void> {
    if (!stories.length) return;
    const db = await openDb();
    const now = Date.now();
    const plain = stories.map((story) => {
        const entry: WispMemoryEntry = { id: wispMemoryId(symbol, story), symbol, savedAt: now, story };
        return JSON.parse(JSON.stringify(entry)) as WispMemoryEntry;
    });
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const entry of plain) store.put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to save wisp memories"));
        tx.onabort = () => reject(tx.error ?? new Error("Save wisp memories transaction aborted"));
    });
}

/** Delete a single stored story by id. */
export async function deleteWispMemory(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to delete wisp memory"));
        tx.onabort = () => reject(tx.error ?? new Error("Delete wisp memory transaction aborted"));
    });
}

/** Delete every stored story — a "Clear All" action, matching the same convention as the other memory-style stores in this app. */
export async function clearAllWispMemories(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to clear wisp memories"));
        tx.onabort = () => reject(tx.error ?? new Error("Clear wisp memories transaction aborted"));
    });
}