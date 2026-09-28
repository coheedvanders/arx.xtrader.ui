import JSZip from "jszip";
import { klineDbUtilityV2 } from "@/utility/v2/klineDbUtilityV2";

/**
 * Zip export of stored SymbolInfo records (IndexedDB), shared by the chart's
 * "Download ALL" and V2MintMain's auto capture.
 *
 * SPLIT INTO PARTS. An auto-captured 30-day range is several MB of JSON per
 * symbol, so ~300 symbols do not fit in one in-memory zip. A part is closed
 * and downloaded once its uncompressed JSON passes PART_BYTES
 * (…-part1.zip, -part2.zip, …); a small batch still downloads as one zip with
 * the original name. Files are DEFLATE-compressed (JSON shrinks ~5-10x).
 */
const PART_BYTES = 300 * 1024 * 1024;

/** Fields dropped by the slim export: always empty in backtests (no OI/LS for past dates), or prose. */
const SLIM_DROP_KEYS = new Set(["openInterest", "longShort", "reasons"]);

export interface SymbolInfoExportOptions {
    /** Drop SLIM_DROP_KEYS and write compact JSON (~40% smaller). Default true. */
    slim?: boolean;
    onProgress?: (current: number, total: number, symbol: string) => void;
}

export interface SymbolInfoExportResult {
    /** Symbols with no stored record. */
    missing: string[];
    /** Zip files downloaded. */
    parts: number;
}

function triggerDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoked a little later: revoking right after click can cancel the
    // download in some browsers when the blob is large.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadSymbolInfoZip(symbols: string[], options: SymbolInfoExportOptions = {}): Promise<SymbolInfoExportResult> {
    const slim = options.slim ?? true;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const missing: string[] = [];

    let zip = new JSZip();
    let partBytes = 0;
    let partFiles = 0;
    let parts = 0;
    let splitIntoParts = false;

    const flushPart = async (isLast: boolean) => {
        if (partFiles === 0) return;
        parts++;
        if (!isLast) splitIntoParts = true;
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        triggerDownload(blob, splitIntoParts ? `symbolInfo-batch-${stamp}-part${parts}.zip` : `symbolInfo-batch-${stamp}.zip`);
        zip = new JSZip();
        partBytes = 0;
        partFiles = 0;
    };

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        options.onProgress?.(i + 1, symbols.length, symbol);
        const info = await klineDbUtilityV2.getSymbolInfo(symbol);
        if (!info) {
            missing.push(symbol);
            continue;
        }
        const json = slim
            ? JSON.stringify(info, (key, value) => (SLIM_DROP_KEYS.has(key) ? undefined : value))
            : JSON.stringify(info, null, 2);
        zip.file(`symbolInfo-${symbol}-${stamp}.json`, json);
        partBytes += json.length;
        partFiles++;
        if (partBytes >= PART_BYTES && i < symbols.length - 1) await flushPart(false);
    }

    await flushPart(true);
    return { missing, parts };
}
