// tradeSignalLogger.ts - Optimized for concurrency-safe batched updates

import type { Candle, CandleEntry, CandleData, TradeLog, VolumeAnalysis, ZoneAnalysis, PastVolumeAnalysis } from "@/core/interfaces";

class TradeSignalLogger {
  private dbName = "TradeSignalDB";
  private storeName = "signals";
  private backtestStoreName = "backtest";
  private db: IDBDatabase | null = null;

  private pnlUpdateQueue = new Map<number, number>();
  private highestUpdateQueue = new Map<number, number>();
  private lowestUpdateQueue = new Map<number, number>();
  private flushTimer: number | null = null;

  async init() {
    if (this.db) return;
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.error("IndexedDB open error:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log("✓ IndexedDB initialized");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id", autoIncrement: true });
          console.log("✓ Object store created");
        }
        if (!db.objectStoreNames.contains(this.backtestStoreName)) {
          db.createObjectStore(this.backtestStoreName, { keyPath: "id", autoIncrement: true });
          console.log("✓ Object store created");
        }
      };
    });
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
  ) {
    if (!this.db) await this.init();

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

    return new Promise<number>((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.add(log);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as number);
    });
  }

  async logBackTestResult(candleEntry: CandleEntry) {
    if (!this.db) await this.init();

    // structured clone safe copy
    const safeData = JSON.parse(JSON.stringify(candleEntry));

    return new Promise<number>((resolve, reject) => {
      const transaction = this.db!.transaction([this.backtestStoreName], "readwrite");
      const store = transaction.objectStore(this.backtestStoreName);
      const request = store.add(safeData);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as number);
    });
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

  async getOpenPosition(symbol: string): Promise<TradeLog | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const logs = request.result as TradeLog[];
        const openPosition = logs.find((log) => log.symbol === symbol && log.isOpen) || null;
        resolve(openPosition);
      };
    });
  }

  async getOpenPositions(): Promise<TradeLog[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const logs = request.result as TradeLog[];
        const openPositions = logs.filter((log) => log.isOpen) || null;
        resolve(openPositions);
      };
    });
  }

  async closePosition(id: number, exitPrice: number, result: string): Promise<boolean> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(id);

      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const log = getRequest.result as TradeLog | undefined;
        if (!log) {
          resolve(false);
          return;
        }

        const exitTime = Date.now();
        const duration = exitTime - log.timestamp;

        log.isOpen = false;
        log.result = result;
        log.exitPrice = exitPrice;
        log.exitTimeStamp = exitTime;
        log.exitLocalTime = new Date().toLocaleString();
        log.duration = duration;

        const updateRequest = store.put(log);
        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => resolve(true);
      };
    });
  }

  async forceCloseOpenPositions(): Promise<number> {
    if (!this.db) await this.init();

    return new Promise<number>((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const logs = request.result as TradeLog[];
            const openLogs = logs.filter((log) => log.isOpen);

            openLogs.forEach((log) => {
                log.result = log.pnl! > 0 ? "WON" : "LOSS";
                log.isOpen = false;
                store.put(log);
            });

            resolve(openLogs.length); // returns number of positions forced closed
        };
    });
  }

  async getAllLogs(): Promise<TradeLog[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getBackTestLogs(): Promise<TradeLog[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.backtestStoreName], "readonly");
      const store = transaction.objectStore(this.backtestStoreName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async clearAllLogs() {
    if (!this.db) await this.init();

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log("✓ All logs cleared");
        resolve();
      };
    });
  }

  async clearBackTestLogs() {
    if (!this.db) await this.init();

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([this.backtestStoreName], "readwrite");
      const store = transaction.objectStore(this.backtestStoreName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log("✓ All logs cleared");
        resolve();
      };
    });
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

  async getTradeStats(): Promise<{ wonCount: number; lossCount: number; openCount: number; openPnl: number, totalPnl: number; totalTakerFee: number }> {
    const logs = await this.getAllLogs();
    const wonCount = logs.filter((log) => log.result.toLowerCase() === "won").length;
    const lossCount = logs.filter((log) => log.result.toLowerCase() === "loss").length;
    const openCount = logs.filter((log) => log.isOpen).length;
    const openPnl = logs.filter((log) => log.isOpen).reduce((sum, log) => sum + (log.pnl ?? 0), 0);
    const totalPnl = logs.reduce((sum, log) => sum + (log.pnl ?? 0), 0);
    const totalTakerFee = logs.reduce((sum, log) => sum + (log.takerFee ?? 0), 0);
    return { wonCount, lossCount, openCount, openPnl, totalPnl, totalTakerFee };
  }

  async updatePnl(id: number, pnl: number): Promise<boolean> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(id);

      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const log = getRequest.result as TradeLog | undefined;
        if (!log) {
          resolve(false);
          return;
        }

        log.pnl = pnl;

        const updateRequest = store.put(log);
        updateRequest.onerror = () => reject(updateRequest.error);
        updateRequest.onsuccess = () => resolve(true);
      };
    });
  }

  schedulePnlUpdate(id: number, pnlValue: number) {
    this.pnlUpdateQueue.set(id, pnlValue);
    this.scheduleFlush();
  }

  scheduleHighestUpdate(id: number, pnlValue: number) {
    this.highestUpdateQueue.set(id, pnlValue);
    this.scheduleFlush();
  }

  scheduleLowestUpdate(id: number, pnlValue: number) {
    this.lowestUpdateQueue.set(id, pnlValue);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => this.flushUpdates(), 250);
    }
  }

  private async flushUpdates() {
    if (!this.db) await this.init();

    const transaction = this.db!.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);

    for (const [id, pnl] of this.pnlUpdateQueue) {
      const req = store.get(id);
      req.onsuccess = () => {
        const log = req.result as TradeLog | undefined;
        if (!log) return;
        log.pnl = pnl;
        store.put(log);
      };
    }

    for (const [id, pnl] of this.highestUpdateQueue) {
      const req = store.get(id);
      req.onsuccess = () => {
        const log = req.result as TradeLog | undefined;
        if (!log) return;
        log.pnlPercentage.highest = pnl;
        store.put(log);
      };
    }

    for (const [id, pnl] of this.lowestUpdateQueue) {
      const req = store.get(id);
      req.onsuccess = () => {
        const log = req.result as TradeLog | undefined;
        if (!log) return;
        log.pnlPercentage.lowest = pnl;
        store.put(log);
      };
    }

    this.pnlUpdateQueue.clear();
    this.highestUpdateQueue.clear();
    this.lowestUpdateQueue.clear();
    this.flushTimer = null;
  }
}

export const tradeLogger = new TradeSignalLogger();
tradeLogger.init().catch((err) => console.error("Failed to init trade logger:", err));
