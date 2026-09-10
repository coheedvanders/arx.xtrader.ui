/**
 * Generic, causal ("no future data") lookups over any timestamped history
 * array. Used by both OI history (OpenInterestHistEntry) and long/short
 * ratio history (LongShortRatioEntry) — the two currently share the exact
 * same "find the entry as-of this timestamp" logic, so it lives here once
 * instead of being duplicated per data source.
 *
 * Both functions assume `history` is sorted ascending by `timestamp`,
 * which is how SymbolInfo's oi_ls_* arrays are stored.
 */

export interface TimestampedEntry {
    timestamp: number
}

/**
 * The latest entry whose timestamp is <= `timestamp`. Never looks at an
 * entry that occurs after `timestamp` — this is what keeps analysis causal.
 */
export function getLatestEntry<T extends TimestampedEntry>(
    history: T[],
    timestamp: number
): T | null {

    let result: T | null = null;

    for (const entry of history) {

        if (entry.timestamp > timestamp) {
            break;
        }

        result = entry;
    }

    return result;
}

/**
 * The entry `lookback` steps before the latest entry as-of `timestamp`.
 * Mirrors the original getPreviousOpenInterest behavior exactly: if fewer
 * than `lookback` eligible entries exist, falls back to the earliest
 * eligible entry (or null if there's at most one).
 */
export function getPreviousEntry<T extends TimestampedEntry>(
    history: T[],
    timestamp: number,
    lookback: number
): T | null {

    const eligible = history.filter(
        entry => entry.timestamp <= timestamp
    );

    if (eligible.length <= lookback) {
        return eligible.length > 1
            ? eligible[0]
            : null;
    }

    return eligible[eligible.length - 1 - lookback];
}