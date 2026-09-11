// scoreDb.ts
//
// Manual trade-journal / performance score, backed by IndexedDB. Global
// (not scoped to whichever symbol is currently open) — same design choice
// as notesDb.ts's notes, since the point is seeing overall manual-trading
// performance across everything you've traded, not per-symbol.
//
// No external dependency — plain native IndexedDB, wrapped in a small
// promise-based API, matching the existing convention in this codebase
// (see notesDb.ts / toolCacheDb.ts).

const DB_NAME = "cev2-score-db";
const DB_VERSION = 1;
const STORE = "scoreEntries";

export interface ScoreEntry {
  id: string;
  symbol: string;
  result: "win" | "loss";
  /** Optional R-multiple (reward achieved relative to risk) — null if not tracked for this entry. */
  rMultiple: number | null;
  note: string;
  createdAt: number;
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
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open score DB"));
  });
  return dbPromise;
}

/** Every score entry, most-recently-created first. */
export async function listScoreEntries(): Promise<ScoreEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as ScoreEntry[]) ?? [];
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list score entries"));
  });
}

/** Create or overwrite a score entry (matched by id). */
export async function saveScoreEntry(entry: ScoreEntry): Promise<void> {
  const db = await openDb();
  // Same defensive clone as notesDb.saveNote — callers may pass a Vue
  // reactive proxy, which IndexedDB's structured-clone step rejects.
  const plain = JSON.parse(JSON.stringify(entry)) as ScoreEntry;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(plain);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save score entry"));
    tx.onabort = () => reject(tx.error ?? new Error("Save score entry transaction aborted"));
  });
}

/** Delete a single score entry by id. */
export async function deleteScoreEntry(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete score entry"));
    tx.onabort = () => reject(tx.error ?? new Error("Delete score entry transaction aborted"));
  });
}

/** Delete every score entry — the "Clear" action. */
export async function clearAllScoreEntries(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear score entries"));
    tx.onabort = () => reject(tx.error ?? new Error("Clear score entries transaction aborted"));
  });
}