import type { SymbolInfo } from "@/core/interfacesv2";

class KlineDbUtilityV2 {
  private dbName = "KlineDbV2";
  private symbolInfoStoreName = "symbolInfo";
  private db: IDBDatabase | null = null;
  private dbVersion = 1;

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
        console.log("✓ IndexedDB (V2) initialized");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.symbolInfoStoreName)) {
          db.createObjectStore(this.symbolInfoStoreName, { keyPath: "name" });
          console.log("✓ SymbolInfo object store created");
        }
      };
    });
  }

  /**
   * Stores (or overwrites) a SymbolInfo record, keyed by its `name` field.
   */
  async storeSymbolInfo(symbolInfo: SymbolInfo): Promise<void> {
    await this.init();

    // Strip any non-serializable/proxy state (e.g. Vue reactivity) before persisting.
    const safeData = JSON.parse(JSON.stringify(symbolInfo)) as SymbolInfo;

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([this.symbolInfoStoreName], "readwrite");
      const store = tx.objectStore(this.symbolInfoStoreName);
      const req = store.put(safeData);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Retrieves a SymbolInfo record by symbol name. Returns null if not found.
   */
  async getSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
    await this.init();

    return new Promise<SymbolInfo | null>((resolve, reject) => {
      const tx = this.db!.transaction([this.symbolInfoStoreName], "readonly");
      const store = tx.objectStore(this.symbolInfoStoreName);
      const req = store.get(symbol);

      req.onsuccess = () => {
        resolve((req.result as SymbolInfo) ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Deletes a SymbolInfo record by symbol name.
   */
  async deleteSymbolInfo(symbol: string): Promise<void> {
    await this.init();

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([this.symbolInfoStoreName], "readwrite");
      const store = tx.objectStore(this.symbolInfoStoreName);
      const req = store.delete(symbol);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Returns all stored symbol names currently cached in IndexedDB.
   */
  async getAllSymbolNames(): Promise<string[]> {
    await this.init();

    return new Promise<string[]>((resolve, reject) => {
      const tx = this.db!.transaction([this.symbolInfoStoreName], "readonly");
      const store = tx.objectStore(this.symbolInfoStoreName);
      const req = store.getAllKeys();

      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  }
}

export const klineDbUtilityV2 = new KlineDbUtilityV2();