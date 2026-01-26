/**
 * Atlas Trading - Trading History Manager
 *
 * Manages and queries trading history across all exchanges.
 * Provides aggregation, filtering, and analysis of historical trades.
 *
 * @module trading/history
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import { ExchangeId, IExchange, TradingSymbol, Order, Trade, OrderSide, OrderType } from './types';
import { logTrade, logOrder } from './trade-logger';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TradingHistory');

/**
 * Historical trade query options
 */
export interface TradeHistoryQuery {
  /** Start timestamp */
  since?: number;
  /** End timestamp */
  until?: number;
  /** Filter by exchange */
  exchange?: ExchangeId;
  /** Filter by symbol */
  symbol?: TradingSymbol;
  /** Filter by side */
  side?: OrderSide;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Historical order query options
 */
export interface OrderHistoryQuery {
  /** Start timestamp */
  since?: number;
  /** End timestamp */
  until?: number;
  /** Filter by exchange */
  exchange?: ExchangeId;
  /** Filter by symbol */
  symbol?: TradingSymbol;
  /** Filter by side */
  side?: OrderSide;
  /** Filter by order type */
  type?: OrderType;
  /** Include only filled orders */
  filledOnly?: boolean;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Trade summary for a period
 */
export interface TradeSummary {
  period: {
    start: number;
    end: number;
  };
  totalTrades: number;
  totalVolume: Decimal;
  totalFees: Decimal;
  buyVolume: Decimal;
  sellVolume: Decimal;
  uniqueSymbols: string[];
  byExchange: Map<
    ExchangeId,
    {
      trades: number;
      volume: Decimal;
      fees: Decimal;
    }
  >;
  bySymbol: Map<
    TradingSymbol,
    {
      trades: number;
      volume: Decimal;
      fees: Decimal;
      avgPrice: Decimal;
    }
  >;
}

/**
 * Trading history manager configuration
 */
export interface TradingHistoryConfig {
  /** Maximum trades to cache in memory */
  maxCacheSize?: number;
  /** Auto-log trades to Obsidian */
  autoLog?: boolean;
  /** Sync interval for fetching new trades (ms) */
  syncInterval?: number;
}

const DEFAULT_CONFIG: Required<TradingHistoryConfig> = {
  maxCacheSize: 10000,
  autoLog: true,
  syncInterval: 60000, // 1 minute
};

/**
 * Trading History Manager
 *
 * Tracks, queries, and analyzes trading history across exchanges.
 */
export class TradingHistory extends EventEmitter {
  private exchanges: Map<ExchangeId, IExchange> = new Map();
  private tradeCache: Map<string, Trade> = new Map();
  private orderCache: Map<string, Order> = new Map();
  private config: Required<TradingHistoryConfig>;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: Map<ExchangeId, number> = new Map();
  private loggedTrades: Set<string> = new Set();
  private loggedOrders: Set<string> = new Set();

  constructor(config: TradingHistoryConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an exchange for history tracking
   */
  registerExchange(exchange: IExchange): void {
    if (this.exchanges.has(exchange.id)) {
      logger.warn('Exchange already registered', { exchange: exchange.id });
      return;
    }

    this.exchanges.set(exchange.id, exchange);
    this.lastSyncTime.set(exchange.id, 0);
    logger.info('Exchange registered for history', { exchange: exchange.id });

    // Listen for new trades and orders
    if (typeof (exchange as unknown as EventEmitter).on === 'function') {
      const emitter = exchange as unknown as EventEmitter;

      emitter.on('order:created', (order: Order) => this.addOrder(order));
      emitter.on('order:filled', (order: Order) => this.addOrder(order));
      emitter.on('trade:executed', (trade: Trade) => this.addTrade(trade));
    }
  }

  /**
   * Unregister an exchange
   */
  unregisterExchange(exchangeId: ExchangeId): void {
    if (this.exchanges.delete(exchangeId)) {
      this.lastSyncTime.delete(exchangeId);
      logger.info('Exchange unregistered from history', { exchange: exchangeId });
    }
  }

  /**
   * Start automatic sync of trading history
   */
  startSync(): void {
    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setInterval(() => {
      this.syncAllExchanges().catch((error) => {
        logger.error('Failed to sync trading history', { error: (error as Error).message });
      });
    }, this.config.syncInterval);

    // Immediate sync
    this.syncAllExchanges().catch((error) => {
      logger.error('Initial sync failed', { error: (error as Error).message });
    });

    logger.info('Started history sync', { interval: this.config.syncInterval });
  }

  /**
   * Stop automatic sync
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info('Stopped history sync');
    }
  }

  /**
   * Sync trading history from all exchanges
   */
  async syncAllExchanges(): Promise<void> {
    const promises = Array.from(this.exchanges.entries())
      .filter(([_, exchange]) => exchange.isConnected())
      .map(([exchangeId, exchange]) => this.syncExchange(exchangeId, exchange));

    await Promise.all(promises);
  }

  /**
   * Sync trading history from a specific exchange
   */
  private async syncExchange(exchangeId: ExchangeId, exchange: IExchange): Promise<void> {
    const lastSync = this.lastSyncTime.get(exchangeId) || 0;
    const since = lastSync > 0 ? lastSync : undefined;

    try {
      // Fetch recent trades
      const trades = await exchange.fetchMyTrades(undefined, since, 100);

      for (const trade of trades) {
        await this.addTrade(trade);
      }

      // Fetch closed orders
      const orders = await exchange.fetchClosedOrders(undefined, since, 100);

      for (const order of orders) {
        await this.addOrder(order);
      }

      this.lastSyncTime.set(exchangeId, Date.now());

      logger.debug('Synced exchange history', {
        exchange: exchangeId,
        trades: trades.length,
        orders: orders.length,
      });
    } catch (error) {
      logger.error('Failed to sync exchange history', {
        exchange: exchangeId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Add a trade to history
   */
  async addTrade(trade: Trade): Promise<void> {
    const key = `${trade.exchange}:${trade.id}`;

    if (this.tradeCache.has(key)) {
      return;
    }

    this.tradeCache.set(key, trade);
    this.trimCache(this.tradeCache);

    // Auto-log to Obsidian
    if (this.config.autoLog && !this.loggedTrades.has(key)) {
      try {
        await logTrade(trade);
        this.loggedTrades.add(key);
      } catch (error) {
        logger.error('Failed to log trade', { error: (error as Error).message });
      }
    }

    this.emit('trade:added', trade);
  }

  /**
   * Add an order to history
   */
  async addOrder(order: Order): Promise<void> {
    const key = `${order.exchange}:${order.id}`;

    // Update existing or add new
    this.orderCache.set(key, order);
    this.trimCache(this.orderCache);

    // Auto-log filled orders to Obsidian
    if (this.config.autoLog && order.status === 'closed' && !this.loggedOrders.has(key)) {
      try {
        await logOrder(order);
        this.loggedOrders.add(key);
      } catch (error) {
        logger.error('Failed to log order', { error: (error as Error).message });
      }
    }

    this.emit('order:added', order);
  }

  /**
   * Trim cache to max size
   */
  private trimCache<T>(cache: Map<string, T>): void {
    if (cache.size > this.config.maxCacheSize) {
      const keysToRemove = Array.from(cache.keys()).slice(0, cache.size - this.config.maxCacheSize);

      for (const key of keysToRemove) {
        cache.delete(key);
      }
    }
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get trades matching query criteria
   */
  getTrades(query: TradeHistoryQuery = {}): Trade[] {
    let trades = Array.from(this.tradeCache.values());

    // Apply filters
    if (query.exchange) {
      trades = trades.filter((t) => t.exchange === query.exchange);
    }

    if (query.symbol) {
      trades = trades.filter((t) => t.symbol === query.symbol);
    }

    if (query.side) {
      trades = trades.filter((t) => t.side === query.side);
    }

    if (query.since) {
      trades = trades.filter((t) => t.timestamp >= query.since!);
    }

    if (query.until) {
      trades = trades.filter((t) => t.timestamp <= query.until!);
    }

    // Sort by timestamp descending (newest first)
    trades.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    if (query.offset) {
      trades = trades.slice(query.offset);
    }

    if (query.limit) {
      trades = trades.slice(0, query.limit);
    }

    return trades;
  }

  /**
   * Get orders matching query criteria
   */
  getOrders(query: OrderHistoryQuery = {}): Order[] {
    let orders = Array.from(this.orderCache.values());

    // Apply filters
    if (query.exchange) {
      orders = orders.filter((o) => o.exchange === query.exchange);
    }

    if (query.symbol) {
      orders = orders.filter((o) => o.symbol === query.symbol);
    }

    if (query.side) {
      orders = orders.filter((o) => o.side === query.side);
    }

    if (query.type) {
      orders = orders.filter((o) => o.type === query.type);
    }

    if (query.filledOnly) {
      orders = orders.filter((o) => o.status === 'closed' && o.filled.greaterThan(0));
    }

    if (query.since) {
      orders = orders.filter((o) => o.timestamp >= query.since!);
    }

    if (query.until) {
      orders = orders.filter((o) => o.timestamp <= query.until!);
    }

    // Sort by timestamp descending (newest first)
    orders.sort((a, b) => b.timestamp - a.timestamp);

    // Apply pagination
    if (query.offset) {
      orders = orders.slice(query.offset);
    }

    if (query.limit) {
      orders = orders.slice(0, query.limit);
    }

    return orders;
  }

  /**
   * Get trade summary for a period
   */
  getTradeSummary(since?: number, until?: number): TradeSummary {
    const now = Date.now();
    const start = since || 0;
    const end = until || now;

    const trades = this.getTrades({ since: start, until: end });

    let totalVolume = new Decimal(0);
    let totalFees = new Decimal(0);
    let buyVolume = new Decimal(0);
    let sellVolume = new Decimal(0);

    const byExchange = new Map<ExchangeId, { trades: number; volume: Decimal; fees: Decimal }>();
    const bySymbol = new Map<
      TradingSymbol,
      {
        trades: number;
        volume: Decimal;
        fees: Decimal;
        totalValue: Decimal;
      }
    >();
    const uniqueSymbols = new Set<string>();

    for (const trade of trades) {
      const volume = trade.cost;
      const fee = trade.fee?.cost ?? new Decimal(0);

      totalVolume = totalVolume.plus(volume);
      totalFees = totalFees.plus(fee);
      uniqueSymbols.add(trade.symbol);

      if (trade.side === 'buy') {
        buyVolume = buyVolume.plus(volume);
      } else {
        sellVolume = sellVolume.plus(volume);
      }

      // By exchange
      const exchangeStats = byExchange.get(trade.exchange) || {
        trades: 0,
        volume: new Decimal(0),
        fees: new Decimal(0),
      };
      exchangeStats.trades++;
      exchangeStats.volume = exchangeStats.volume.plus(volume);
      exchangeStats.fees = exchangeStats.fees.plus(fee);
      byExchange.set(trade.exchange, exchangeStats);

      // By symbol
      const symbolStats = bySymbol.get(trade.symbol) || {
        trades: 0,
        volume: new Decimal(0),
        fees: new Decimal(0),
        totalValue: new Decimal(0),
      };
      symbolStats.trades++;
      symbolStats.volume = symbolStats.volume.plus(trade.amount);
      symbolStats.fees = symbolStats.fees.plus(fee);
      symbolStats.totalValue = symbolStats.totalValue.plus(volume);
      bySymbol.set(trade.symbol, symbolStats);
    }

    // Calculate average prices
    const bySymbolWithAvg = new Map<
      TradingSymbol,
      {
        trades: number;
        volume: Decimal;
        fees: Decimal;
        avgPrice: Decimal;
      }
    >();

    for (const [symbol, stats] of bySymbol) {
      bySymbolWithAvg.set(symbol, {
        trades: stats.trades,
        volume: stats.volume,
        fees: stats.fees,
        avgPrice: stats.volume.isZero() ? new Decimal(0) : stats.totalValue.div(stats.volume),
      });
    }

    return {
      period: { start, end },
      totalTrades: trades.length,
      totalVolume,
      totalFees,
      buyVolume,
      sellVolume,
      uniqueSymbols: Array.from(uniqueSymbols),
      byExchange,
      bySymbol: bySymbolWithAvg,
    };
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit: number = 10): Trade[] {
    return this.getTrades({ limit });
  }

  /**
   * Get recent orders
   */
  getRecentOrders(limit: number = 10): Order[] {
    return this.getOrders({ limit });
  }

  /**
   * Get trade count
   */
  getTradeCount(): number {
    return this.tradeCache.size;
  }

  /**
   * Get order count
   */
  getOrderCount(): number {
    return this.orderCache.size;
  }

  /**
   * Get trades for a specific symbol
   */
  getSymbolTrades(symbol: TradingSymbol, limit?: number): Trade[] {
    return this.getTrades({ symbol, limit });
  }

  /**
   * Get orders for a specific symbol
   */
  getSymbolOrders(symbol: TradingSymbol, limit?: number): Order[] {
    return this.getOrders({ symbol, limit });
  }

  // ===========================================================================
  // Analysis Methods
  // ===========================================================================

  /**
   * Get average trade size for a symbol
   */
  getAverageTradeSize(symbol?: TradingSymbol): Decimal {
    const trades = symbol ? this.getSymbolTrades(symbol) : this.getTrades();

    if (trades.length === 0) {
      return new Decimal(0);
    }

    const total = trades.reduce((sum, t) => sum.plus(t.amount), new Decimal(0));
    return total.div(trades.length);
  }

  /**
   * Get win rate (simplified - based on sell prices vs buy prices)
   */
  getWinRate(symbol?: TradingSymbol): number {
    const trades = symbol ? this.getSymbolTrades(symbol) : this.getTrades();

    const buys = trades.filter((t) => t.side === 'buy');
    const sells = trades.filter((t) => t.side === 'sell');

    if (buys.length === 0 || sells.length === 0) {
      return 0;
    }

    const avgBuyPrice = buys.reduce((sum, t) => sum.plus(t.price), new Decimal(0)).div(buys.length);
    const avgSellPrice = sells
      .reduce((sum, t) => sum.plus(t.price), new Decimal(0))
      .div(sells.length);

    // Simple win rate: is avg sell price higher than avg buy?
    return avgSellPrice.greaterThan(avgBuyPrice) ? 1 : 0;
  }

  /**
   * Get most traded symbols
   */
  getMostTradedSymbols(limit: number = 10): Array<{ symbol: string; count: number }> {
    const symbolCounts = new Map<string, number>();

    for (const trade of this.tradeCache.values()) {
      const count = symbolCounts.get(trade.symbol) || 0;
      symbolCounts.set(trade.symbol, count + 1);
    }

    return Array.from(symbolCounts.entries())
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all cached history
   */
  clearCache(): void {
    this.tradeCache.clear();
    this.orderCache.clear();
    this.loggedTrades.clear();
    this.loggedOrders.clear();
    logger.info('History cache cleared');
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.stopSync();
    this.clearCache();
    this.exchanges.clear();
    this.lastSyncTime.clear();
    this.removeAllListeners();
    logger.info('Trading history disposed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let tradingHistory: TradingHistory | null = null;

/**
 * Get the trading history singleton
 */
export function getTradingHistory(): TradingHistory {
  if (!tradingHistory) {
    tradingHistory = new TradingHistory();
  }
  return tradingHistory;
}

/**
 * Create a new trading history instance with custom config
 */
export function createTradingHistory(config: TradingHistoryConfig): TradingHistory {
  return new TradingHistory(config);
}
