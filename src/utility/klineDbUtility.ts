import type { CandleEntry } from "@/core/interfaces";
import JSZip from 'jszip';

class KlineDbUtility {
  private dbName = "KlineDb";
  private klineStoreName = "candles";
  private db: IDBDatabase | null = null;
  private dbVersion = 2;

  private queue: (() => Promise<void>)[] = [];
  private isProcessing = false;

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) await job();
    }
    this.isProcessing = false;
  }

  async init() {
    if (this.db) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

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
        if (!db.objectStoreNames.contains(this.klineStoreName)) {
          var store = db.createObjectStore(this.klineStoreName, { keyPath: "symbol" });
          store.createIndex("openTime", "candles.openTime", { unique: false });
          console.log("✓ Object store created");
        }
      };
    });
  }

  async downloadAll(): Promise<void> {
    await this.init();

    const zip = new JSZip();
    const symbolMap = new Map<string, CandleEntry[]>();

    // Collect all data by symbol
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([this.klineStoreName], "readonly");
      const store = tx.objectStore(this.klineStoreName);
      const req = store.openCursor();

      req.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          const symbol = cursor.value.symbol;
          const candles = cursor.value.candles ?? [];
          symbolMap.set(symbol, candles);
          cursor.continue();
        } else {
          resolve();
        }
      };

      req.onerror = () => reject(req.error);
    });

    // Add each symbol as a separate JSON file to zip
    for (const [symbol, candles] of symbolMap) {
      const fileName = `${symbol}.json`;
      const fileContent = JSON.stringify(candles, null, 2);
      zip.file(fileName, fileContent);
      console.log(`Added ${fileName} (${candles.length} candles)`);
    }

    // Generate zip and download
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kline_data_${new Date().getTime()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      console.log("Download complete!");
    } catch (error) {
      console.error("Zip download failed:", error);
    }
  }

  async initializeKlineData(symbol: string, candles: CandleEntry[]) {
    await this.init();
    const safeData = JSON.parse(JSON.stringify({ symbol, candles }));

    const execute = async () => {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readwrite");
        const store = tx.objectStore(this.klineStoreName);
        const req = store.put(safeData);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    };

    this.queue.push(execute);
    await this.processQueue();
  }

  async insertNewKline(symbol: string, candle: CandleEntry) {
    await this.init();

    const execute = async () => {
      const candles = await this.getKlines(symbol);
      const updated = [...candles];

      if (updated.length >= 400) updated.shift(); // remove oldest
      updated.push(candle); // append newest

      const data = { symbol, candles: updated };
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readwrite");
        const store = tx.objectStore(this.klineStoreName);
        const req = store.put(data);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    };

    this.queue.push(execute);
    await this.processQueue();
  }

  async getKlines(symbol: string): Promise<CandleEntry[]> {
    await this.init();

    return new Promise((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readonly");
        const store = tx.objectStore(this.klineStoreName);
        const req = store.get(symbol);

        req.onsuccess = () => {
        resolve(req.result?.candles ?? []);
        };
        req.onerror = () => reject(req.error);
    });
  }

  async getFirstTimestamps(): Promise<number[]> {
    await this.init();

    return new Promise((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readonly");
        const store = tx.objectStore(this.klineStoreName);

        const req = store.openCursor();

        req.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
                const candles: CandleEntry[] = cursor.value.candles ?? [];
                // map all candles to openTime
                resolve(candles.map(c => c.openTime));
            } else {
                resolve([]); // store is empty
            }
        };

        req.onerror = () => reject(req.error);
    });
  }

  async getPositions(): Promise<CandleEntry[]> {
    await this.init();

    // Cache this or materialize once at startup
    return new Promise<CandleEntry[]>((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readonly");
        const store = tx.objectStore(this.klineStoreName);
        const result: CandleEntry[] = [];

        const req = store.openCursor();
        req.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
                const candles: CandleEntry[] = cursor.value.candles ?? [];
                const matching = candles.filter(c => c.side !== "" && c.slPrice > 0 && c.tpPrice > 0);
                result.push(...matching);
                cursor.continue();
            } else {
                resolve(result);
            }
        };

        req.onerror = () => reject(req.error);
    });
  }

  async getCandleByTimestamp(timestamp: number, symbol?: string): Promise<CandleEntry[]> {
    await this.init();

    if (symbol) {
        const candles = await this.getKlines(symbol);
        return candles.filter(c => c.openTime === timestamp);
    }

    // Cache this or materialize once at startup
    return new Promise<CandleEntry[]>((resolve, reject) => {
        const tx = this.db!.transaction([this.klineStoreName], "readonly");
        const store = tx.objectStore(this.klineStoreName);
        const result: CandleEntry[] = [];

        const req = store.openCursor();
        req.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
                const candles: CandleEntry[] = cursor.value.candles ?? [];
                const matching = candles.filter(c => c.symbol == symbol && c.openTime === timestamp);
                result.push(...matching);
                cursor.continue();
            } else {
                resolve(result);
            }
        };

        req.onerror = () => reject(req.error);
    });
  }
}

export const klineDbUtility = new KlineDbUtility();
