// notesDb.ts
//
// Lightweight sticky-notes store backed by IndexedDB, used by the notes
// toolbar in CandleVisualizerV2Component.vue. Notes are tagged with the
// symbol they were written for so switching symbols shows only the notes
// relevant to that pair, but nothing stops a note from being read across
// symbols later if that's ever useful (the `bySymbol` index just filters).
//
// No external dependency (no `idb` package) — plain native IndexedDB,
// wrapped in a small promise-based API so callers don't have to deal with
// IDBRequest/onsuccess/onerror boilerplate directly.

const DB_NAME = "cev2-notes-db";
const DB_VERSION = 1;
const STORE = "notes";

export interface StickyNote {
  id: string;
  symbol: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  color?: string;
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
        store.createIndex("bySymbol", "symbol", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open notes DB"));
  });
  return dbPromise;
}

/** All notes for a symbol, most-recently-updated first. */
export async function listNotes(symbol: string): Promise<StickyNote[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("bySymbol");
    const req = idx.getAll(IDBKeyRange.only(symbol));
    req.onsuccess = () => {
      const rows = (req.result as StickyNote[]) ?? [];
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to list notes"));
  });
}

/** Create or overwrite a note (matched by id). */
export async function saveNote(note: StickyNote): Promise<void> {
  const db = await openDb();
  // Callers may pass a Vue (or other framework) reactive proxy rather than a
  // plain object — IndexedDB's structured-clone algorithm can choke on those
  // ("DataCloneError: ... could not be cloned"). A JSON round-trip strips
  // any proxy/getter wrapping and leaves a plain object to store.
  const plain = JSON.parse(JSON.stringify(note)) as StickyNote;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(plain);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save note"));
    tx.onabort = () => reject(tx.error ?? new Error("Save note transaction aborted"));
  });
}

/** Delete a single note by id. */
export async function deleteNote(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete note"));
    tx.onabort = () => reject(tx.error ?? new Error("Delete note transaction aborted"));
  });
}

/** Delete every note for a symbol (not currently wired to any UI action). */
export async function clearNotesForSymbol(symbol: string): Promise<void> {
  const rows = await listNotes(symbol);
  await Promise.all(rows.map((r) => deleteNote(r.id)));
}