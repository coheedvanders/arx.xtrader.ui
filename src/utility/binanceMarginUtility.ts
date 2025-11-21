// Types / Interfaces
export interface BracketEntry {
  bracket: number;
  notionalFloor: number;
  notionalCap: number;
  maintMarginRatio: number;
  cum: number;
  initialLeverage: number;
}

export type SymbolBrackets = BracketEntry[];

export interface BracketsCache {
  [symbol: string]: {
    brackets: BracketEntry[];
  };
}

/**
 * Binance Margin Utility for calculating maintenance margin requirements.
 * Fetches bracket data from backend Python API.
 */
export class BinanceMarginUtility {
  private static readonly CACHE_KEY = "binance_futures_brackets_cache";
  private static readonly BACKEND_URL = import.meta.env.VITE_ORDER_MAKER_API; // Update if needed
  private static cache: BracketsCache | null = null;

  /**
   * Fetches and caches leverage brackets from backend API.
   */
  static async fetchAllFuturesBrackets(forceRefresh = false): Promise<BracketsCache> {
    // Try memory cache first
    if (this.cache && !forceRefresh) {
      console.log(`Using cached brackets (${Object.keys(this.cache).length} symbols)`);
      return this.cache;
    }

    // Try localStorage cache
    const cached = localStorage.getItem(this.CACHE_KEY);
    if (cached && !forceRefresh) {
      try {
        this.cache = JSON.parse(cached) as BracketsCache;
        console.log(`Loaded ${Object.keys(this.cache).length} symbols from localStorage cache`);
        return this.cache;
      } catch (e) {
        console.warn("Cache corrupted, refetching from backend...");
      }
    }

    try {
      console.log("Fetching bracket data from backend...");
      const res = await fetch(`${this.BACKEND_URL}/get-leverage-brackets`);

      if (!res.ok) {
        throw new Error(`Backend error: ${res.status} ${res.statusText}`);
      }

      const response = await res.json();

      if (response.status !== "ok") {
        throw new Error(`Backend returned error: ${response.error}`);
      }

      const brackets: BracketsCache = response.data;

      // Cache in memory and localStorage
      this.cache = brackets;
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(brackets));

      console.log(`✓ Fetched and cached brackets for ${Object.keys(brackets).length} symbols`);
      return brackets;
    } catch (error) {
      console.error("Error fetching brackets from backend:", error);
      throw error;
    }
  }

  /**
   * Calculates maintenance margin amount for a single position.
   * Formula: cum + (notional - notionalFloor) * maintMarginRatio
   */
  static calculateMaintenanceMargin(symbol: string, notionalValue: number): number {
    const brackets = this.cache || this.loadFromCache();
    if (!brackets) {
      throw new Error("Brackets not loaded. Call fetchAllFuturesBrackets() first.");
    }

    const symbolData = brackets[symbol];
    if (!symbolData || !symbolData.brackets || symbolData.brackets.length === 0) {
      throw new Error(`No bracket data for ${symbol}`);
    }

    const symbolBrackets = symbolData.brackets;

    // Find the applicable bracket tier for this notional value
    for (const bracket of symbolBrackets) {
      // notionalCap of 0 means unlimited (last tier)
      const isApplicable = bracket.notionalCap === 0 || notionalValue <= bracket.notionalCap;

      if (isApplicable) {
        // Formula from Binance: cum + (notional - floor) * rate
        const maintenance =
          bracket.cum + (notionalValue - bracket.notionalFloor) * bracket.maintMarginRatio;
        return maintenance;
      }
    }

    // Fallback to last bracket
    const lastBracket = symbolBrackets[symbolBrackets.length - 1];
    return (
      lastBracket.cum +
      (notionalValue - lastBracket.notionalFloor) * lastBracket.maintMarginRatio
    );
  }

  /**
   * Returns the maintenance margin rate (percentage) for a symbol at given notional.
   */
  static getMaintenanceMarginRate(symbol: string, notionalValue: number): number {
    const brackets = this.cache || this.loadFromCache();
    if (!brackets) {
      throw new Error("Brackets not loaded. Call fetchAllFuturesBrackets() first.");
    }

    const symbolData = brackets[symbol];
    if (!symbolData || !symbolData.brackets || symbolData.brackets.length === 0) {
      throw new Error(`No bracket data for ${symbol}`);
    }

    const symbolBrackets = symbolData.brackets;

    for (const bracket of symbolBrackets) {
      const isApplicable = bracket.notionalCap === 0 || notionalValue <= bracket.notionalCap;
      if (isApplicable) return bracket.maintMarginRatio;
    }

    return symbolBrackets[symbolBrackets.length - 1].maintMarginRatio;
  }

  /**
   * Calculate total maintenance margin across multiple positions.
   */
  static calculateTotalMaintenance(
    positions: Array<{ symbol: string; notionalValue: number }>
  ): number {
    return positions.reduce((sum, pos) => {
      try {
        return sum + this.calculateMaintenanceMargin(pos.symbol, pos.notionalValue);
      } catch (e) {
        console.warn(`Failed to calculate maintenance for ${pos.symbol}:`, e);
        return sum;
      }
    }, 0);
  }

  /**
   * Get max leverage for a symbol.
   */
  static getMaxLeverage(symbol: string): number {
    const brackets = this.cache || this.loadFromCache();
    if (!brackets) {
      throw new Error("Brackets not loaded. Call fetchAllFuturesBrackets() first.");
    }

    const symbolData = brackets[symbol];
    if (!symbolData || !symbolData.brackets || symbolData.brackets.length === 0) {
      return 1;
    }

    return symbolData.brackets[0].initialLeverage || 1;
  }

  private static loadFromCache(): BracketsCache | null {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      if (cached) {
        this.cache = JSON.parse(cached) as BracketsCache;
        return this.cache;
      }
    } catch (e) {
      console.warn("Failed to load cache from localStorage");
    }
    return null;
  }

  /**
   * Clear all cached data.
   */
  static clearCache(): void {
    this.cache = null;
    localStorage.removeItem(this.CACHE_KEY);
    console.log("Cache cleared");
  }

  /**
   * Check if brackets are loaded in memory.
   */
  static isLoaded(): boolean {
    return this.cache !== null;
  }
}

// Usage:
/*
// On app initialization
await BinanceMarginUtility.fetchAllFuturesBrackets();

// In backtest snapshot
const positions = openPositions.map(p => ({
  symbol: p.symbol,
  notionalValue: p.margin * p.leverage
}));

const totalMaintenance = BinanceMarginUtility.calculateTotalMaintenance(positions);
const safetyRatio = marginBalance / totalMaintenance;

simulationStats.value.totalMaintenanceNeeded = totalMaintenance;
simulationStats.value.safetyRatio = safetyRatio;

if (safetyRatio < 1.05) {
  console.warn("⚠️ LIQUIDATION RISK - Safety ratio below 1.05x");
}
*/