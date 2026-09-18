// Intended location: src/utility/pocRangeCatalogDb.ts
// (sibling of wispMemoryDb.ts)
//
// Stores the output of a Train Wisp run: one entry per classified range,
// across every symbol scanned. Deliberately raw, not pre-aggregated —
// grouping by profile type and counting reaction outcomes happens on
// read (see groupCatalogByProfileType), the same way wispMemoryDb.ts
// stores raw stories rather than a computed summary. Keeping the stored
// data raw means the grouping/visualization logic can change later
// without needing a migration of what's actually saved.
//
// Unlike wispMemoryDb.ts (a growing per-symbol reference library that
// accumulates across sessions on purpose), this store represents "what
// does the market look like right now" — trainWisp() clears and rebuilds
// it from scratch on every run rather than accumulating indefinitely,
// since old cross-symbol snapshots from weeks ago aren't a track record
// worth keeping alongside a fresh one, they're just stale.

import type { ProfileType, ProfileSignature, ReactionCategory } from "@/utility/pocRangeProfile";
import type { SIGNAL_DIRECTION } from "@/core/interfacesv2";
import type { ExtendedFeatures } from "@/utility/wispExtendedFeatures";
import type { FourHContext } from "@/utility/wisp4hContext";

const DB_NAME = "cev2-poc-range-catalog-db";
const DB_VERSION = 1;
const STORE = "catalogEntries";

export interface CatalogEntry {
    id: string;
    symbol: string;
    profileTypeKey: string;
    profileType: ProfileType;
    signature: ProfileSignature;
    reaction: ReactionCategory;
    direction: SIGNAL_DIRECTION;
    startOpenTime: number;
    endOpenTime: number;
    savedAt: number;
    /** The raw story fields aggregateStories (in pastCandleWisp.ts) needs to actually blend a matched entry into a TP/SL suggestion — classification alone (profileType/reaction) isn't enough to reconstruct these. Raw, on THIS entry's own symbol's price scale — never mix these directly with a different symbol's raw values, see mfeNormalized/maeNormalized below. */
    avwap: number;
    frvpPoc: number | null;
    redLevel: number | null;
    referencePrice: number;
    mfe: number;
    mae: number;
    /** mfe/mae divided by this entry's own ATR — scale-independent, exactly like the signature's own distances. Cross-symbol matching (Ask Wisp's catalog path) MUST use these, not the raw mfe/mae above, and re-scale by the LIVE symbol's own ATR before aggregating — referencePrice/avwap/etc. above can vary by a billion-fold across symbols (a sub-cent coin vs BTC), so aggregating them directly produces a meaningless median. */
    mfeNormalized: number;
    maeNormalized: number;
    /** OI/long-short/volume/candle-structure features — see wispExtendedFeatures.ts. Optional: entries trained before this was added, or from a symbol whose candles lack this data, won't have it. Model training must skip entries where this is undefined rather than treating absence as zero, which would silently fabricate "no positioning change" data. */
    extendedFeatures?: ExtendedFeatures;
    /** 4H trend/momentum/positioning context the 15M range occurred inside of — see wisp4hContext.ts. Optional, same reasoning as extendedFeatures above: absence must be skipped, not zero-filled. */
    fourHContext?: FourHContext;
}

export interface ProfileTypeGroup {
    profileTypeKey: string;
    profileType: ProfileType;
    entries: CatalogEntry[];
    reactionCounts: Record<ReactionCategory, number>;
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
                store.createIndex("profileTypeKey", "profileTypeKey", { unique: false });
                store.createIndex("symbol", "symbol", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Failed to open POC range catalog DB"));
    });
    return dbPromise;
}

/** Every stored catalog entry, across every symbol. */
export async function listCatalogEntries(): Promise<CatalogEntry[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as CatalogEntry[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("Failed to list catalog entries"));
    });
}

/** Saves a batch of entries in one transaction — a training run produces many at once. */
export async function saveCatalogEntries(entries: CatalogEntry[]): Promise<void> {
    if (!entries.length) return;
    const db = await openDb();
    const plain = entries.map(e => JSON.parse(JSON.stringify(e)) as CatalogEntry);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const entry of plain) store.put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to save catalog entries"));
        tx.onabort = () => reject(tx.error ?? new Error("Save catalog entries transaction aborted"));
    });
}

/** Wipes the whole catalog — trainWisp() calls this before rebuilding, since this store represents a snapshot, not an accumulating log. */
export async function clearCatalog(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Failed to clear catalog"));
        tx.onabort = () => reject(tx.error ?? new Error("Clear catalog transaction aborted"));
    });
}

/**
 * Groups raw entries by profile type key, with reaction counts computed
 * on the spot — this is what the training visual and Ask Wisp's
 * "does this profile type have a real track record" check both read
 * from, rather than a separately stored, potentially-stale summary.
 */
export function groupCatalogByProfileType(entries: CatalogEntry[]): ProfileTypeGroup[] {
    const map = new Map<string, ProfileTypeGroup>();
    for (const entry of entries) {
        let group = map.get(entry.profileTypeKey);
        if (!group) {
            group = {
                profileTypeKey: entry.profileTypeKey,
                profileType: entry.profileType,
                entries: [],
                reactionCounts: { continuation: 0, reversal: 0, pin: 0 },
            };
            map.set(entry.profileTypeKey, group);
        }
        group.entries.push(entry);
        group.reactionCounts[entry.reaction]++;
    }
    return [...map.values()].sort((a, b) => b.entries.length - a.entries.length);
}