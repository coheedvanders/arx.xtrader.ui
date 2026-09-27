import type { CandleInfo } from "@/core/interfacesv2";

// =====================================================================
// RUN ARCHIVE — the full candle history of a range run, stored in
// IndexedDB as it is walked and exported afterwards.
//
// WHY A COMPACT RECORD AND NOT THE ANALYSED CANDLE. Measured on a real
// 336-symbol capture: a fully analysed candle is 3,345 bytes of JSON, and
// the symbolInfo wrapper that carries the 1h/4h/1d arrays and OI/LS takes
// it to 9,819. Over 2026-01-01 -> 2026-02-28 that is 5,664 candles x 336
// symbols = 1.9M records:
//
//     full symbolInfo .................. 17.4 GB
//     15m analysed candle only .......... 5.9 GB
//     this record ....................... ~147 MB  (~25 MB zipped)
//
// The first two cannot be held, written or transferred. This one can, and
// it loses nothing that research reads: priceAction, candleStructure,
// volumeState and openInterest together account for 2,940 of those 3,345
// bytes while analysis uses about a dozen scalars out of them.
//
// OI and longShort are deliberately absent. They are 1,018 bytes a candle
// (1.8 GB over this range) and Binance retains roughly 30 days of both, so
// for a run starting in January they would be null for most of it.
//
// INDICES ARE CONVERTED TO TIMESTAMPS. `extras` TREND_SNAPSHOT carries the
// reversing segment's start as a gi - an index into the 500-candle ROLLING
// WINDOW, which slides every tick (the engine even decrements openGi on
// each shift for this reason). Archived across a 5,664-candle range that
// index means nothing. It is resolved to the segment start's openTime at
// write time, while the window it refers to is still in hand. Getting this
// wrong would silently mis-locate every segment in the archive.
// =====================================================================

export const ARCHIVE_DB_NAME = "rolling-run-archive";
export const ARCHIVE_DB_VERSION = 1;
export const ARCHIVE_STORE = "candles";
export const ARCHIVE_META_STORE = "meta";

/** Trend direction as volumeState/trendState report it. */
export type TrendDirection = "UP" | "DOWN";

/**
 * The scalars analysis actually reads out of the heavyweight analysis
 * objects. Written only for candles that carried a signal, which measured
 * 13% of candles (5.6% for POTENTIAL_REVERSAL alone).
 */
export interface ArchivedSignal {
    /** conditions_met verbatim - the trigger set is the whole point. */
    cm: string[];
    /** TREND_SNAPSHOT direction, or null when the candle had none. */
    dir: TrendDirection | null;
    /**
     * openTime of the reversing segment's FIRST candle - NOT a gi.
     * null when the snapshot was missing or its gi fell outside the window
     * that was in hand, which is recorded rather than guessed.
     */
    segT: number | null;
    ema: number | null;
    /** volumeState: trend z-score, relative volume, rolling z-score. */
    tz: number | null;
    rv: number | null;
    dz: number | null;
    /** candleStructure: body ratio and the two wicks, in price. */
    br: number | null;
    uw: number | null;
    lw: number | null;
    /** priceAction flags, packed as a bitfield - see PA_FLAGS. */
    pa: number;
}

/** Bit positions for ArchivedSignal.pa. Order is part of the format. */
export const PA_FLAGS = [
    "liquiditySweep",
    "rejection",
    "displacement",
    "reclaim",
    "breakout",
    "failedBreakout",
] as const;

export interface ArchivedCandle {
    t: number;  // openTime
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    atr: number;
    s?: ArchivedSignal;
}

/** One stored row. The compound key [sym, t] makes writes idempotent. */
export interface ArchiveRow extends ArchivedCandle {
    sym: string;
}

function num(v: unknown): number | null {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Reads the TREND_SNAPSHOT pair out of `extras`, which is a flat array of
 * alternating tags and values rather than an object.
 */
function trendSnapshot(candle: CandleInfo): { dir: TrendDirection | null; gi: number | null } {
    const ex = (candle as unknown as { extras?: unknown[] }).extras;
    if (!Array.isArray(ex)) return { dir: null, gi: null };
    for (let k = 0; k < ex.length - 2; k++) {
        if (ex[k] !== "TREND_SNAPSHOT") continue;
        const dir = ex[k + 1];
        const gi = Number(ex[k + 2]);
        return {
            dir: dir === "UP" || dir === "DOWN" ? dir : null,
            gi: Number.isFinite(gi) ? gi : null,
        };
    }
    return { dir: null, gi: null };
}

function packPriceAction(candle: CandleInfo): number {
    const pa = (candle as unknown as { priceAction?: Record<string, unknown> }).priceAction;
    if (!pa) return 0;
    let bits = 0;
    PA_FLAGS.forEach((name, i) => { if (pa[name]) bits |= 1 << i; });
    return bits;
}

/**
 * Compacts one analysed candle.
 *
 * `window` and `index` are the rolling window this candle was analysed in
 * and its position inside it - needed ONLY to resolve the segment gi to an
 * openTime. Pass them from the same call that produced the analysis; a
 * later window has already slid and would resolve to the wrong candle.
 */
export function compactCandle(candle: CandleInfo, window: CandleInfo[], index: number): ArchivedCandle {
    const row: ArchivedCandle = {
        t: candle.openTime,
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: candle.volume,
        atr: candle.atr,
    };
    const cm = candle.conditions_met;
    if (!cm || !cm.length) return row;

    const snap = trendSnapshot(candle);
    // gi is an index into `window`; anything outside it cannot be resolved
    // and is recorded as null rather than clamped to a wrong candle.
    const segT = snap.gi != null && snap.gi >= 0 && snap.gi < window.length
        ? window[snap.gi].openTime
        : null;

    const vs = (candle as unknown as { volumeState?: Record<string, unknown> }).volumeState ?? {};
    const cs = (candle as unknown as { candleStructure?: Record<string, unknown> }).candleStructure ?? {};

    row.s = {
        cm: [...cm],
        dir: snap.dir,
        segT,
        ema: num((candle as unknown as { ema200?: unknown }).ema200),
        tz: num(vs.trendZScore),
        rv: num(vs.relativeVolume),
        dz: num(vs.dynamicZScore),
        br: num(cs.bodyRatio),
        uw: num(cs.upperWick),
        lw: num(cs.lowerWick),
        pa: packPriceAction(candle),
    };
    // `index` is accepted for symmetry with callers that already know it and
    // to make the window/candle pairing explicit at every call site.
    void index;
    return row;
}

// ── IndexedDB ────────────────────────────────────────────────────────
// Kept here rather than in klineDbUtilityV2 because this store has a
// different lifetime: it belongs to ONE run and is cleared when a run
// starts, whereas the kline cache is shared across runs.

/**
 * Opens the archive database.
 *
 * TIMES OUT ON PURPOSE. `indexedDB.open` can settle NEITHER onsuccess NOR
 * onerror: when another connection holds the database it fires `onblocked`
 * and then simply waits. Awaited from a run start that sits outside any
 * status reporting, that presents as the run button going dead with nothing
 * on screen and no error anywhere - which is exactly how it was found. A
 * hang is the one failure mode a caller cannot recover from, so it is turned
 * into a rejection the caller can report and continue past.
 */
export function openArchiveDb(timeoutMs = 10000): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
        const timer = setTimeout(
            () => finish(() => reject(new Error(
                `timed out opening ${ARCHIVE_DB_NAME} after ${timeoutMs}ms - another tab may hold it open`
            ))),
            timeoutMs
        );
        const req = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION);
        req.onblocked = () => finish(() => {
            clearTimeout(timer);
            reject(new Error(`${ARCHIVE_DB_NAME} is open in another tab - close it and run again`));
        });
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
                // compound key: a re-walk writing the same candle again
                // overwrites its own row instead of appending a duplicate
                db.createObjectStore(ARCHIVE_STORE, { keyPath: ["sym", "t"] });
            }
            if (!db.objectStoreNames.contains(ARCHIVE_META_STORE)) {
                db.createObjectStore(ARCHIVE_META_STORE, { keyPath: "k" });
            }
        };
        req.onsuccess = () => finish(() => { clearTimeout(timer); resolve(req.result); });
        req.onerror = () => finish(() => { clearTimeout(timer); reject(req.error); });
    });
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
    return db.transaction(store, mode).objectStore(store);
}

/** Writes a batch of rows for one symbol. Idempotent per [sym, t]. */
export function putCandles(db: IDBDatabase, symbol: string, rows: ArchivedCandle[]): Promise<void> {
    if (!rows.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const t = db.transaction(ARCHIVE_STORE, "readwrite");
        const store = t.objectStore(ARCHIVE_STORE);
        for (const r of rows) store.put({ sym: symbol, ...r });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

/** All archived candles for one symbol, ascending by openTime. */
export function readSymbol(db: IDBDatabase, symbol: string): Promise<ArchivedCandle[]> {
    return new Promise((resolve, reject) => {
        // Canonical compound-key range: arrays sort after every other key
        // type, so [symbol, []] is an upper bound for every [symbol, number]
        // without assuming anything about the timestamps themselves.
        const range = IDBKeyRange.bound([symbol], [symbol, []]);
        const req = tx(db, ARCHIVE_STORE, "readonly").getAll(range);
        req.onsuccess = () => {
            const rows = (req.result as ArchiveRow[]) ?? [];
            rows.sort((a, b) => a.t - b.t);
            resolve(rows.map(({ sym, ...rest }) => { void sym; return rest; }));
        };
        req.onerror = () => reject(req.error);
    });
}

export function countRows(db: IDBDatabase): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = tx(db, ARCHIVE_STORE, "readonly").count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export function clearArchive(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = db.transaction([ARCHIVE_STORE, ARCHIVE_META_STORE], "readwrite");
        t.objectStore(ARCHIVE_STORE).clear();
        t.objectStore(ARCHIVE_META_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

export function putMeta(db: IDBDatabase, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = db.transaction(ARCHIVE_META_STORE, "readwrite");
        t.objectStore(ARCHIVE_META_STORE).put({ k: key, v: value });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

export function getMeta(db: IDBDatabase, key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = tx(db, ARCHIVE_META_STORE, "readonly").get(key);
        req.onsuccess = () => resolve((req.result as { v?: unknown } | undefined)?.v);
        req.onerror = () => reject(req.error);
    });
}

/**
 * The per-symbol file shape written into the download.
 *
 * `name` and `candle_15m` deliberately mirror the existing symbolInfo
 * export so the research scripts can read either, but the candles are
 * ArchivedCandle, not CandleInfo - the `format` field says which, and any
 * reader should branch on it rather than sniffing fields.
 */
export interface ArchiveFile {
    format: "run-archive/1";
    name: string;
    from: number;
    to: number;
    paFlags: readonly string[];
    candle_15m: ArchivedCandle[];
    positions: unknown[];
}

export function buildArchiveFile(
    symbol: string,
    candles: ArchivedCandle[],
    positions: unknown[]
): ArchiveFile {
    return {
        format: "run-archive/1",
        name: symbol,
        from: candles.length ? candles[0].t : 0,
        to: candles.length ? candles[candles.length - 1].t : 0,
        // The bit order of ArchivedSignal.pa travels WITH the data. Readers
        // must not hardcode it - reordering PA_FLAGS would otherwise
        // silently re-label every flag in every previously exported file.
        paFlags: PA_FLAGS,
        candle_15m: candles,
        positions,
    };
}