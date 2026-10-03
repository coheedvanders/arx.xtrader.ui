// Lazy chart data for a live run (V2MintMain "clear entries" -> "next").
//
// A live-run press only runs the full analysis where an entry is possible, and
// does not store every window, so a symbol's stored window can be behind. The
// scanner that owns the symbol registers a preparer here; the chart awaits it
// before reading the window from IndexedDB, whichever way the chart was opened
// (scanner row, or the chart's own previous/next symbol buttons).

const preparers = new Map<string, () => Promise<void>>();

export function setDisplayPreparer(symbol: string, prepare: (() => Promise<void>) | null): void {
    if (prepare) preparers.set(symbol, prepare);
    else preparers.delete(symbol);
}

/** Brings the symbol's stored window up to date for display, if a live run owns it. No-op otherwise. */
export async function prepareSymbolForDisplay(symbol: string): Promise<void> {
    await preparers.get(symbol)?.();
}

/**
 * A position interaction on a symbol's newest candle during "next": a position
 * OPENED on it, or an open position CLOSED on it (TP, SL, MID, expiry...).
 */
export interface PositionInteraction {
    kind: "OPENED" | "CLOSED";
    symbol: string;
    side: "LONG" | "SHORT";
    entryPrice: number;
    sl: number;
    tp: number;
    openTime: number;
    /** The newest candle's openTime - when the interaction happened. */
    candleOpenTime: number;
    /** CLOSED only. */
    status?: string;
    closeReason?: string | null;
    exitPrice?: number | null;
    /** CLOSED only: pnl net of entry and exit fees (null for MID, which books none). */
    netPnl?: number | null;
}
