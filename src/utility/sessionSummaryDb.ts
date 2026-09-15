// Intended location: src/utility/sessionSummaryDb.ts
// (sibling of testPositionDb.ts, notesDb.ts, scoreDb.ts)

const DB_NAME = "cev2-session-summary-db";
const DB_VERSION = 1;
const STORE = "sessionSummaries";

export interface SessionSummary {
    id: string;
    cachedAt: number;

    totalCount: number;
    activeCount: number;
    winCount: number;
    lossCount: number;
    ambiguousCount: number;

    /** Same "exclude null pnl, don't treat as zero" convention as the live view's own totals. */
    totalPnl: number;
    activePnl: number;
    winPnl: number;
    lossPnl: number;
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
        req.onerror = () => reject(req.error ?? new Error("Failed to open session summary DB"));
    });
    return dbPromise;
}

/** Every cached session summary, most-recently-cached first. */
export async function listAllSessionSummaries(): Promise<SessionSummary[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const rows = (req.result as SessionSummary[]) ?? [];
            rows.sort((a, b) => b.cachedAt - a.cachedAt);
            resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to list session summaries"));
    });
}

/** Create or overwrite a session summary (matched by id). */
export async function saveSessionSummary(summary: SessionSummary): Promise<void> {
    const db = await openDb();
    const plain = JSON.parse(JSON.stringify(summary)) as SessionSummary;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(plain);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to save session summary"));
        tx.onabort = () => reject(tx.error ?? new Error("Save session summary transaction aborted"));
    });
}

/** Delete a single session summary by id. */
export async function deleteSessionSummary(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to delete session summary"));
        tx.onabort = () => reject(tx.error ?? new Error("Delete session summary transaction aborted"));
    });
}