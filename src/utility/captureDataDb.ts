// Intended location: src/utility/captureDataDb.ts
// (sibling of testPositionDb.ts, sessionSummaryDb.ts)

import type { CandleInfo } from "@/core/interfacesv2";

const DB_NAME = "cev2-captured-data-db";
const DB_VERSION = 1;
const STORE = "capturedEntries";

// Kept loose (not importing the component's own local interfaces) since
// this module has no dependency on CandleVisualizerV2Component.vue's
// internals — it just needs to describe the shape of what gets stored.
// Fields deliberately match PositionShape/FrvpZone/LiquidityRange/
// TestPosition's real shapes even though they aren't imported directly.
export interface CapturedPosition {
    id: string;
    kind: "long" | "short";
    x1: number;
    x2: number;
    entry: number;
    tp: number;
    sl: number;
    tag?: "test" | "live" | "simulated";
    testPositionId?: string;
    /** Set only when tag is "simulated" — the entry candle's own gi from CandleInfo.positionEntry.openGi (see PositionShape). */
    simulatedOpenGi?: number;
}

export interface CapturedTestPosition {
    id: string;
    symbol: string;
    side: "LONG" | "SHORT";
    entry: number;
    tp: number;
    sl: number;
    entryOpenTime: number;
    createdAt: number;
    status: "ACTIVE" | "WIN" | "LOSS" | "AMBIGUOUS";
    lastCheckedAt: number | null;
    resolvedAt: number | null;
    resolvedPrice: number | null;
    forceClosed: boolean;
    margin: number;
    maxLeverage: number;
    pnlPercent: number | null;
    pnl: number | null;
}

export interface CapturedFrvpZone {
    id: string;
    startGi: number;
    endGi: number;
    rangeLow: number;
    rangeHigh: number;
    poc: number;
    maxVol: number;
    rows: { priceLow: number; priceHigh: number; buyVolume: number; sellVolume: number; buyFrac: number; sellFrac: number }[];
}

export interface CapturedLiquidityRange {
    id: string;
    startGi: number;
    endGi: number;
    low: number;
    high: number;
    // Heatmap cells omitted deliberately — they're a dense, derived
    // rendering artifact (regenerable from candles + startGi/endGi any
    // time), not something worth bloating every captured entry with.
    prediction?: unknown;
}

export interface CapturedDataEntry {
    id: string;
    symbol: string;
    capturedAt: number;
    startGi: number;
    endGi: number;
    startOpenTime: number;
    endOpenTime: number;
    /** The captured range's own candles — includes whatever analysis fields (liquidityAnchor, conditions_met, candleStructure, etc.) were already present on them. */
    candles: CandleInfo[];
    frvpZones: CapturedFrvpZone[];
    liquidityRanges: CapturedLiquidityRange[];
    /** Long/short position drawings overlapping the captured range. */
    positions: CapturedPosition[];
    /** Full outcome data for any test position linked to one of the above (matched by testPositionId) — win/loss/pnl, not just entry/TP/SL. */
    testPositions: CapturedTestPosition[];
    /** Optional free-text note, e.g. why this range was captured. */
    label?: string;
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
        req.onerror = () => reject(req.error ?? new Error("Failed to open captured data DB"));
    });
    return dbPromise;
}

/** Every captured entry, most-recently-captured first. */
export async function listAllCapturedData(): Promise<CapturedDataEntry[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
            const rows = (req.result as CapturedDataEntry[]) ?? [];
            rows.sort((a, b) => b.capturedAt - a.capturedAt);
            resolve(rows);
        };
        req.onerror = () => reject(req.error ?? new Error("Failed to list captured data"));
    });
}

/** Create or overwrite a captured entry (matched by id). */
export async function saveCapturedData(entry: CapturedDataEntry): Promise<void> {
    const db = await openDb();
    const plain = JSON.parse(JSON.stringify(entry)) as CapturedDataEntry;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(plain);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to save captured data"));
        tx.onabort = () => reject(tx.error ?? new Error("Save captured data transaction aborted"));
    });
}

/** Delete a single captured entry by id. */
export async function deleteCapturedData(id: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to delete captured data"));
        tx.onabort = () => reject(tx.error ?? new Error("Delete captured data transaction aborted"));
    });
}

/** Delete every captured entry — a "Clear All" action, matching the same convention as testPositionDb/clearAllTestPositions. */
export async function clearAllCapturedData(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to clear captured data"));
        tx.onabort = () => reject(tx.error ?? new Error("Clear captured data transaction aborted"));
    });
}