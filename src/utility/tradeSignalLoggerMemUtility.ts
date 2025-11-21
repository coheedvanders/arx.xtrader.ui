// tradeSignalLogger.ts - Optimized for concurrency-safe batched updates (In-Memory)

import type { Candle, CandleEntry, CandleData, TradeLog, VolumeAnalysis, ZoneAnalysis, PastVolumeAnalysis } from "@/core/interfaces";

class TradeSignalLoggerMem {
  private signals: Map<number, TradeLog> = new Map();
  private backtestLogs: Map<number, CandleEntry> = new Map();
  private nextId = 1;
  private nextBacktestId = 1;

  async init() {
    console.log("✓ In-Memory storage initialized");
    return Promise.resolve();
  }

  async logSignal(
    symbol: string,
    side: string,
    support: { lower: number; upper: number },
    resistance: { lower: number; upper: number },
    currentPrice: number,
    tpsl: { tp: number; sl: number },
    currentCandleData: CandleData,
    zoneAnalysis: ZoneAnalysis,
    margin: number,
    leverage: number,
    takerFee: number,
    volumeAnalysis: VolumeAnalysis,
    candleOpenTime: number,
    pastVolumeAnalysis: PastVolumeAnalysis
  ): Promise<number> {
    const log: TradeLog = {
      timestamp: Date.now(),
      localTime: new Date().toLocaleString(),
      symbol,
      side,
      support,
      resistance,
      currentPrice,
      tpsl,
      isOpen: true,
      result: "",
      currentCandleData,
      pnlPercentage: { highest: 0, lowest: 0 },
      exitPrice: null,
      exitTimeStamp: null,
      exitLocalTime: null,
      duration: null,
      zoneAnalysis,
      pnl: null,
      margin,
      leverage,
      takerFee,
      volumeAnalysis,
      candleOpenTime,
      pastVolumeAnalysis
    };

    const id = this.nextId++;
    this.signals.set(id, log);
    return Promise.resolve(id);
  }

  async logBackTestResult(candleEntry: CandleEntry): Promise<number> {
    const safeData = JSON.parse(JSON.stringify(candleEntry));
    const id = this.nextBacktestId++;
    this.backtestLogs.set(id, safeData);
    return Promise.resolve(id);
  }

  async downloadBackTestLogs(filename = "back-test-results.json") {
    const json = await this.exportBackTestToJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async getOpenPosition(symbol: string): Promise<(TradeLog & { id: number }) | null> {
    for (const [id, log] of this.signals.entries()) {
      if (log.symbol === symbol && log.isOpen) {
        return { ...log, id };
      }
    }
    return null;
  }

  async getOpenPositions(): Promise<TradeLog[]> {
    return Array.from(this.signals.values()).filter((log) => log.isOpen);
  }

  async closePosition(id: number, exitPrice: number, result: string): Promise<boolean> {
    const log = this.signals.get(id);
    if (!log) {
      return false;
    }

    const exitTime = Date.now();
    const duration = exitTime - log.timestamp;

    log.isOpen = false;
    log.result = result;
    log.exitPrice = exitPrice;
    log.exitTimeStamp = exitTime;
    log.exitLocalTime = new Date().toLocaleString();
    log.duration = duration;

    return true;
  }

  async forceCloseOpenPositions(): Promise<number> {
    let closedCount = 0;
    for (const log of this.signals.values()) {
      if (log.isOpen) {
        log.result = log.pnl! > 0 ? "WON" : "LOSS";
        log.isOpen = false;
        closedCount++;
      }
    }
    return closedCount;
  }

  async getAllLogs(): Promise<TradeLog[]> {
    return Array.from(this.signals.values());
  }

  async getBackTestLogs(): Promise<CandleEntry[]> {
    return Array.from(this.backtestLogs.values());
  }

  async clearAllLogs(): Promise<void> {
    this.signals.clear();
    console.log("✓ All logs cleared");
    return Promise.resolve();
  }

  async clearBackTestLogs(): Promise<void> {
    this.backtestLogs.clear();
    console.log("✓ All backtest logs cleared");
    return Promise.resolve();
  }

  async exportToJSON(): Promise<string> {
    const logs = await this.getAllLogs();
    return JSON.stringify(logs, null, 2);
  }

  async exportBackTestToJSON(): Promise<string> {
    const logs = await this.getBackTestLogs();
    return JSON.stringify(logs, null, 2);
  }

  async downloadLogs(filename = "trade-signals.json") {
    const json = await this.exportToJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async getTradeStats(): Promise<{
    wonCount: number;
    lossCount: number;
    openCount: number;
    openPnl: number;
    totalPnl: number;
    totalTakerFee: number;
  }> {
    const logs = await this.getAllLogs();
    const wonCount = logs.filter((log) => log.result.toLowerCase() === "won").length;
    const lossCount = logs.filter((log) => log.result.toLowerCase() === "loss").length;
    const openCount = logs.filter((log) => log.isOpen).length;
    const openPnl = logs
      .filter((log) => log.isOpen)
      .reduce((sum, log) => sum + (log.pnl ?? 0), 0);
    const totalPnl = logs.reduce((sum, log) => sum + (log.pnl ?? 0), 0);
    const totalTakerFee = logs.reduce((sum, log) => sum + (log.takerFee ?? 0), 0);
    return { wonCount, lossCount, openCount, openPnl, totalPnl, totalTakerFee };
  }

  async updatePnl(id: number, pnl: number): Promise<boolean> {
    const log = this.signals.get(id);
    if (!log) {
      return false;
    }
    log.pnl = pnl;
    return true;
  }

  schedulePnlUpdate(id: number, pnlValue: number) {
    const log = this.signals.get(id);
    if (log) {
      log.pnl = pnlValue;
    }
  }

  scheduleHighestUpdate(id: number, pnlValue: number) {
    const log = this.signals.get(id);
    if (log) {
      log.pnlPercentage.highest = pnlValue;
    }
  }

  scheduleLowestUpdate(id: number, pnlValue: number) {
    const log = this.signals.get(id);
    if (log) {
      log.pnlPercentage.lowest = pnlValue;
    }
  }
}

export const tradeLogger = new TradeSignalLoggerMem();
tradeLogger.init().catch((err) => console.error("Failed to init trade logger:", err));