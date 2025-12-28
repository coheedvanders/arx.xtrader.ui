class IndexDBLogger {
  private dbName = "LoggerDb";
  private storeName = "logs";
  private db: IDBDatabase | null = null;
  private dbVersion = 1;

  init = async (): Promise<void> => {
    if (this.db) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };
    });
  };

  writeLog = async (message: string): Promise<void> => {
    await this.init();

    const logEntry = {
      timestamp: new Date().toISOString(),
      message,
      date: new Date(),
    };

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.add(logEntry);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  };

  getAllLogs = async (): Promise<any[]> => {
    await this.init();

    return new Promise<any[]>((resolve, reject) => {
      const tx = this.db!.transaction([this.storeName], "readonly");
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  download = async (): Promise<void> => {
    await this.init();

    if (!this.db) throw new Error("DB not initialized");

    const logs = await this.getAllLogs();
    if (!logs.length) return;

    let text = "=== LOG FILE ===\n";
    text += `Generated: ${new Date().toISOString()}\n`;
    text += `Total Logs: ${logs.length}\n`;
    text += "==================\n\n";

    logs.forEach((log, i) => {
      text += `[${i + 1}] ${log.date.toLocaleString()}:\n${log.message}\n---\n`;
    });

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  clearLogs = async (): Promise<void> => {
    await this.init();

    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  };

  getLogCount = async (): Promise<number> => {
    await this.init();

    return new Promise<number>((resolve, reject) => {
      const tx = this.db!.transaction([this.storeName], "readonly");
      const store = tx.objectStore(this.storeName);
      const req = store.count();

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
}

export const indexDBLogger = new IndexDBLogger();
export default IndexDBLogger;
