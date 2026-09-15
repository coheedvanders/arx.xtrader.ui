// Intended location: src/utility/v2/analysis/testPositionLiveCheck.ts
// Shared by TestPositionViewComponent.vue (manual Check/Run All/Force
// Close) and CandleVisualizerV2Component.vue (auto-check on symbol load)
// so there's exactly one implementation of "fetch live candles" and
// "apply a check result to a position" — not two copies that could
// quietly drift apart the way an earlier version of this feature did
// (checkOne once forgot to assign pnlPercent/pnl after computing them).

import type { CandleInfo } from "@/core/interfacesv2";
import { checkTestPosition } from "@/utility/v2/analysis/checkTestPosition";
import { saveTestPosition, type TestPosition } from "@/utility/testPositionDb";

/**
 * Queries live candles directly from Binance's public USDT-M futures
 * REST API — NOT klineDbUtilityV2/IndexedDB. Same endpoint and row-
 * mapping convention as CandleVisualizerV2Component's own "Load Older
 * Candles" feature (https://fapi.binance.com/fapi/v1/klines). Uses
 * Binance's own `startTime` parameter to fetch exactly from the
 * position's entry point forward, rather than over-fetching and
 * filtering client-side — Binance returns candles AT OR AFTER startTime,
 * up to `limit` or the current time, whichever comes first.
 *
 * Only raw OHLCV + times — no candleStructure/OI/priceAction/etc, since
 * checkTestPosition never reads any of that; it only needs
 * openTime/high/low/close.
 *
 * limit=1000 covers roughly 10 days of 15m candles in one call — a
 * reasonable ceiling for the day-trading workflow this is built for
 * (positions open for hours to a couple of days), not a hard guarantee
 * for a position left open far longer than that. Returns null on any
 * fetch failure so callers can distinguish "no data" from "genuinely no
 * candles yet".
 */
export async function fetchLiveCandles(symbol: string, sinceOpenTime: number): Promise<CandleInfo[] | null> {
  try {
    const sym = encodeURIComponent(symbol.trim().toUpperCase());
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=15m&startTime=${sinceOpenTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines request failed (${res.status})`);
    const rows = (await res.json()) as unknown[][];
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6]),
    })) as unknown as CandleInfo[];
  } catch (err) {
    console.error(`Failed to fetch live candles for ${symbol}:`, err);
    return null;
  }
}

/**
 * Runs checkTestPosition against the given candles, applies EVERY field
 * of the result onto the position (status, resolvedAt, resolvedPrice,
 * pnlPercent, pnl, lastCheckedAt), and persists it. Mutates the position
 * object in place, matching how both call sites already hold a reference
 * into their own reactive array.
 */
export async function checkOneTestPosition(position: TestPosition, candles: CandleInfo[]): Promise<void> {
  const result = checkTestPosition(position, candles);
  position.status = result.status;
  position.resolvedAt = result.resolvedAt;
  position.resolvedPrice = result.resolvedPrice;
  position.pnlPercent = result.pnlPercent;
  position.pnl = result.pnl;
  position.lastCheckedAt = Date.now();
  await saveTestPosition(position);
}