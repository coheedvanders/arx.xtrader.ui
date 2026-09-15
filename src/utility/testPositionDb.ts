// Intended location: src/utility/testPositionDb.ts
// (sibling of notesDb.ts, scoreDb.ts)

const DB_NAME = "cev2-test-position-db";
const DB_VERSION = 1;
const STORE = "testPositions";

export interface TestPosition {
    id: string;
    symbol: string;
    side: "LONG" | "SHORT";
    entry: number;
    tp: number;
    sl: number;
    /** The anchor candle's own openTime — where the position tool sits on the chart, and where "check" starts scanning forward from. */
    entryOpenTime: number;
    createdAt: number;
    /** AMBIGUOUS = a single candle's range touched both TP and SL — matches the reference simulator's own "MID" outcome exactly: neither a definite win nor loss, and no PnL is estimated for it either. */
    status: "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS";
    lastCheckedAt: number | null;
    /** When TP/SL was actually hit, once resolved — null while still ACTIVE (or AMBIGUOUS, which has no single resolution price). */
    resolvedAt: number | null;
    resolvedPrice: number | null;

    /** True when this WIN/LOSS came from "Force Close" rather than TP/SL actually being hit — resolvedPrice is null for a forced close, since there's no level it resolved against. */
    forceClosed: boolean;

    /** Position cost in USDT — the basis PnlUtility.calculateEstimatedPnl scales against. Captured at creation from the same margin input the live-order preview panel already uses. */
    margin: number;
    /** From chocoMintoStore.futureSymbols at creation time — this symbol's own max leverage, not a global assumption. */
    maxLeverage: number;
    /** Estimated PnL %, via PnlUtility.calculatePNLPercent — null until first checked, and always null for an AMBIGUOUS resolution. */
    pnlPercent: number | null;
    /** Estimated PnL in USDT, via PnlUtility.calculateEstimatedPnl — same nullability as pnlPercent. Unrealized (marked against the latest close) while ACTIVE, realized (marked against TP or SL) once resolved. */
    pnl: number | null;
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
        req.onerror = () => reject(req.error ?? new Error("Failed to open test position DB"));
    });
    return dbPromise;
}

/** Every test position, most-recently-created first. */
export async function listAllTestPositions(): Promise<TestPosition[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const rows = (req.result as TestPosition[]) ?? [];
            rows.sort((a, b) => b.createdAt - a.createdAt);
            resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to list test positions"));
    });
}

/** Create or overwrite a test position (matched by id). */
export async function saveTestPosition(position: TestPosition): Promise<void> {
    const db = await openDb();
    // Same defensive clone as notesDb.saveNote — callers may pass a Vue
    // reactive proxy, which IndexedDB's structured-clone step rejects.
    const plain = JSON.parse(JSON.stringify(position)) as TestPosition;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(plain);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to save test position"));
        tx.onabort = () => reject(tx.error ?? new Error("Save test position transaction aborted"));
    });
}

/** Delete a single test position by id. */
export async function deleteTestPosition(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to delete test position"));
        tx.onabort = () => reject(tx.error ?? new Error("Delete test position transaction aborted"));
    });
}

/** Delete every test position — the "Clear All" action. */
export async function clearAllTestPositions(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to clear test positions"));
        tx.onabort = () => reject(tx.error ?? new Error("Clear test positions transaction aborted"));
    });
}