/**
 * Atlas Trading - Portfolio Manager
 *
 * Aggregates balances, positions, and performance metrics
 * across multiple exchanges.
 *
 * @module trading/portfolio
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import {
  ExchangeId,
  IExchange,
  Balance,
  Position,
  AggregatedBalance,
  PerformanceMetrics,
  PnLReport,
} from './types';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('PortfolioManager');

/**
 * Time period for performance calculations
 */
export type PerformancePeriod = '1h' | '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

/**
 * Portfolio snapshot for historical tracking
 */
export interface PortfolioSnapshot {
  timestamp: number;
  totalUsdValue: Decimal;
  balancesByExchange: Map<ExchangeId, Decimal>;
  balancesByCurrency: Map<string, Decimal>;
}

/**
 * Portfolio manager configuration
 */
export interface PortfolioManagerConfig {
  /** Interval for snapshot updates (ms) */
  snapshotInterval?: number;
  /** Maximum snapshots to retain */
  maxSnapshots?: number;
  /** Quote currency for valuation */
  quoteCurrency?: string;
}

const DEFAULT_CONFIG: Required<PortfolioManagerConfig> = {
  snapshotInterval: 60000, // 1 minute
  maxSnapshots: 10080, // 7 days at 1-minute intervals
  quoteCurrency: 'USD',
};

/**
 * Portfolio Manager
 *
 * Manages and aggregates portfolio data across multiple exchanges.
 */
export class PortfolioManager extends EventEmitter {
  private exchanges: Map<ExchangeId, IExchange> = new Map();
  private snapshots: PortfolioSnapshot[] = [];
  private config: Required<PortfolioManagerConfig>;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private priceCache: Map<string, Decimal> = new Map();
  private lastUpdate: number = 0;

  constructor(config: PortfolioManagerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an exchange with the portfolio manager
   */
  registerExchange(exchange: IExchange): void {
    if (this.exchanges.has(exchange.id)) {
      logger.warn('Exchange already registered', { exchange: exchange.id });
      return;
    }

    this.exchanges.set(exchange.id, exchange);
    logger.info('Exchange registered', { exchange: exchange.id });

    // Listen for balance updates if exchange is an EventEmitter
    if (typeof (exchange as unknown as EventEmitter).on === 'function') {
      (exchange as unknown as EventEmitter).on('balance:updated', () => {
        this.emit('portfolio:updated');
      });
    }
  }

  /**
   * Unregister an exchange
   */
  unregisterExchange(exchangeId: ExchangeId): void {
    if (this.exchanges.delete(exchangeId)) {
      logger.info('Exchange unregistered', { exchange: exchangeId });
    }
  }

  /**
   * Get all registered exchanges
   */
  getExchanges(): ExchangeId[] {
    return Array.from(this.exchanges.keys());
  }

  /**
   * Start automatic snapshot collection
   */
  startSnapshots(): void {
    if (this.snapshotTimer) {
      return;
    }

    this.snapshotTimer = setInterval(async () => {
      try {
        await this.takeSnapshot();
      } catch (error) {
        logger.error('Failed to take snapshot', { error });
      }
    }, this.config.snapshotInterval);

    logger.info('Started snapshot collection', {
      interval: this.config.snapshotInterval,
    });
  }

  /**
   * Stop automatic snapshot collection
   */
  stopSnapshots(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
      logger.info('Stopped snapshot collection');
    }
  }

  /**
   * Take a portfolio snapshot
   */
  async takeSnapshot(): Promise<PortfolioSnapshot> {
    const aggregated = await this.getAggregatedBalance();

    const balancesByExchange = new Map<ExchangeId, Decimal>();
    for (const [exchangeId, balance] of aggregated.byExchange) {
      balancesByExchange.set(exchangeId, balance.totalUsdValue ?? new Decimal(0));
    }

    const snapshot: PortfolioSnapshot = {
      timestamp: Date.now(),
      totalUsdValue: aggregated.totalUsdValue,
      balancesByExchange,
      balancesByCurrency: aggregated.byCurrency,
    };

    this.snapshots.push(snapshot);

    // Trim old snapshots
    while (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    this.emit('snapshot:created', snapshot);
    return snapshot;
  }

  /**
   * Get snapshots for a time period
   */
  getSnapshots(since?: number): PortfolioSnapshot[] {
    if (!since) {
      return [...this.snapshots];
    }
    return this.snapshots.filter((s) => s.timestamp >= since);
  }

  // ===========================================================================
  // Balance Aggregation
  // ===========================================================================

  /**
   * Get aggregated balance across all exchanges
   */
  async getAggregatedBalance(): Promise<AggregatedBalance> {
    const byExchange = new Map<ExchangeId, Balance>();
    const byCurrency = new Map<string, Decimal>();
    let totalUsdValue = new Decimal(0);

    // Fetch balances from all connected exchanges
    const balancePromises = Array.from(this.exchanges.entries())
      .filter(([_, exchange]) => exchange.isConnected())
      .map(async ([exchangeId, exchange]) => {
        try {
          const balance = await exchange.fetchBalance();
          return { exchangeId, balance };
        } catch (error) {
          logger.error('Failed to fetch balance', {
            exchange: exchangeId,
            error: (error as Error).message,
          });
          return null;
        }
      });

    const results = await Promise.all(balancePromises);

    for (const result of results) {
      if (!result) continue;

      const { exchangeId, balance } = result;
      byExchange.set(exchangeId, balance);

      // Aggregate by currency
      for (const [currency, currBalance] of balance.currencies) {
        const existing = byCurrency.get(currency) ?? new Decimal(0);
        byCurrency.set(currency, existing.plus(currBalance.total));
      }

      // Add to total USD value if available
      if (balance.totalUsdValue) {
        totalUsdValue = totalUsdValue.plus(balance.totalUsdValue);
      }
    }

    // Calculate USD value if not provided by exchanges
    if (totalUsdValue.isZero() && byCurrency.size > 0) {
      totalUsdValue = await this.calculateTotalUsdValue(byCurrency);
    }

    this.lastUpdate = Date.now();

    return {
      timestamp: this.lastUpdate,
      byExchange,
      byCurrency,
      totalUsdValue,
    };
  }

  /**
   * Get balance for a specific exchange
   */
  async getExchangeBalance(exchangeId: ExchangeId): Promise<Balance | null> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange || !exchange.isConnected()) {
      return null;
    }

    try {
      return await exchange.fetchBalance();
    } catch (error) {
      logger.error('Failed to fetch exchange balance', {
        exchange: exchangeId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  // ===========================================================================
  // Position Aggregation
  // ===========================================================================

  /**
   * Get all positions across all exchanges
   */
  async getAllPositions(): Promise<Map<ExchangeId, Position[]>> {
    const result = new Map<ExchangeId, Position[]>();

    const positionPromises = Array.from(this.exchanges.entries())
      .filter(([_, exchange]) => exchange.isConnected() && exchange.fetchPositions)
      .map(async ([exchangeId, exchange]) => {
        try {
          const positions = await exchange.fetchPositions!();
          return { exchangeId, positions };
        } catch (error) {
          logger.error('Failed to fetch positions', {
            exchange: exchangeId,
            error: (error as Error).message,
          });
          return null;
        }
      });

    const results = await Promise.all(positionPromises);

    for (const res of results) {
      if (res && res.positions.length > 0) {
        result.set(res.exchangeId, res.positions);
      }
    }

    return result;
  }

  /**
   * Get positions for a specific exchange
   */
  async getExchangePositions(exchangeId: ExchangeId): Promise<Position[]> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange || !exchange.isConnected() || !exchange.fetchPositions) {
      return [];
    }

    try {
      return await exchange.fetchPositions();
    } catch (error) {
      logger.error('Failed to fetch exchange positions', {
        exchange: exchangeId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Get aggregated position summary
   */
  async getPositionSummary(): Promise<{
    totalPositions: number;
    totalUnrealizedPnl: Decimal;
    totalRealizedPnl: Decimal;
    positionsByExchange: Map<ExchangeId, number>;
  }> {
    const allPositions = await this.getAllPositions();

    let totalPositions = 0;
    let totalUnrealizedPnl = new Decimal(0);
    let totalRealizedPnl = new Decimal(0);
    const positionsByExchange = new Map<ExchangeId, number>();

    for (const [exchangeId, positions] of allPositions) {
      totalPositions += positions.length;
      positionsByExchange.set(exchangeId, positions.length);

      for (const pos of positions) {
        if (pos.unrealizedPnl) {
          totalUnrealizedPnl = totalUnrealizedPnl.plus(pos.unrealizedPnl);
        }
        if (pos.realizedPnl) {
          totalRealizedPnl = totalRealizedPnl.plus(pos.realizedPnl);
        }
      }
    }

    return {
      totalPositions,
      totalUnrealizedPnl,
      totalRealizedPnl,
      positionsByExchange,
    };
  }

  // ===========================================================================
  // Performance Tracking
  // ===========================================================================

  /**
   * Get performance metrics for a period
   */
  async getPerformance(period: PerformancePeriod): Promise<PerformanceMetrics> {
    const periodMs = this.periodToMs(period);
    const now = Date.now();
    const since = period === 'all' ? 0 : now - periodMs;

    const relevantSnapshots = this.getSnapshots(since);

    if (relevantSnapshots.length < 2) {
      // Not enough data, get current balance as the only data point
      const currentBalance = await this.getAggregatedBalance();
      return {
        period,
        startValue: currentBalance.totalUsdValue,
        endValue: currentBalance.totalUsdValue,
        absoluteChange: new Decimal(0),
        percentageChange: new Decimal(0),
        highWaterMark: currentBalance.totalUsdValue,
        drawdown: new Decimal(0),
        maxDrawdown: new Decimal(0),
      };
    }

    const startSnapshot = relevantSnapshots[0];
    const endSnapshot = relevantSnapshots[relevantSnapshots.length - 1];

    const startValue = startSnapshot.totalUsdValue;
    const endValue = endSnapshot.totalUsdValue;
    const absoluteChange = endValue.minus(startValue);
    const percentageChange = startValue.isZero()
      ? new Decimal(0)
      : absoluteChange.div(startValue).times(100);

    // Calculate high water mark and drawdown
    let highWaterMark = new Decimal(0);
    let maxDrawdown = new Decimal(0);

    for (const snapshot of relevantSnapshots) {
      if (snapshot.totalUsdValue.greaterThan(highWaterMark)) {
        highWaterMark = snapshot.totalUsdValue;
      }

      const drawdown = highWaterMark.isZero()
        ? new Decimal(0)
        : highWaterMark.minus(snapshot.totalUsdValue).div(highWaterMark).times(100);

      if (drawdown.greaterThan(maxDrawdown)) {
        maxDrawdown = drawdown;
      }
    }

    const currentDrawdown = highWaterMark.isZero()
      ? new Decimal(0)
      : highWaterMark.minus(endValue).div(highWaterMark).times(100);

    return {
      period,
      startValue,
      endValue,
      absoluteChange,
      percentageChange,
      highWaterMark,
      drawdown: currentDrawdown,
      maxDrawdown,
    };
  }

  /**
   * Convert period string to milliseconds
   */
  private periodToMs(period: PerformancePeriod): number {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    switch (period) {
      case '1h':
        return hour;
      case '24h':
        return day;
      case '7d':
        return 7 * day;
      case '30d':
        return 30 * day;
      case '90d':
        return 90 * day;
      case '1y':
        return 365 * day;
      case 'all':
        return Number.MAX_SAFE_INTEGER;
      default:
        return day;
    }
  }

  // ===========================================================================
  // P&L Reporting
  // ===========================================================================

  /**
   * Get P&L report for all exchanges or a specific exchange
   */
  async getPnL(period: PerformancePeriod = '24h', exchangeId?: ExchangeId): Promise<PnLReport> {
    const periodMs = this.periodToMs(period);
    const since = period === 'all' ? undefined : Date.now() - periodMs;

    let realized = new Decimal(0);
    let unrealized = new Decimal(0);
    let fees = new Decimal(0);
    let trades = 0;
    let winners = 0;
    let losers = 0;
    let totalWinAmount = new Decimal(0);
    let totalLossAmount = new Decimal(0);

    // Get exchanges to process
    const exchangesToProcess = exchangeId
      ? ([this.exchanges.get(exchangeId)].filter(Boolean) as IExchange[])
      : Array.from(this.exchanges.values()).filter((e) => e.isConnected());

    // Collect trades and calculate P&L
    for (const exchange of exchangesToProcess) {
      try {
        // Get trades for the period
        const exchangeTrades = await exchange.fetchMyTrades(undefined, since, 500);

        for (const trade of exchangeTrades) {
          trades++;

          // Track fees
          if (trade.fee) {
            fees = fees.plus(trade.fee.cost);
          }

          // Simple P&L calculation based on trade side
          // For a proper P&L, we'd need to track entry/exit pairs
          const tradeValue = trade.cost;

          if (trade.side === 'sell') {
            // Potential profit (simplified)
            realized = realized.plus(tradeValue);
            winners++;
            totalWinAmount = totalWinAmount.plus(tradeValue);
          } else {
            // Cost (simplified)
            realized = realized.minus(tradeValue);
          }
        }

        // Get unrealized P&L from positions
        if (exchange.fetchPositions) {
          const positions = await exchange.fetchPositions();
          for (const pos of positions) {
            if (pos.unrealizedPnl) {
              unrealized = unrealized.plus(pos.unrealizedPnl);

              if (pos.unrealizedPnl.greaterThan(0)) {
                winners++;
              } else if (pos.unrealizedPnl.lessThan(0)) {
                losers++;
                totalLossAmount = totalLossAmount.plus(pos.unrealizedPnl.abs());
              }
            }
          }
        }
      } catch (error) {
        logger.error('Failed to get P&L data', {
          exchange: exchange.id,
          error: (error as Error).message,
        });
      }
    }

    const avgWin = winners > 0 ? totalWinAmount.div(winners) : undefined;
    const avgLoss = losers > 0 ? totalLossAmount.div(losers) : undefined;

    return {
      exchange: exchangeId,
      period,
      realized,
      unrealized,
      total: realized.plus(unrealized),
      fees,
      trades,
      winners,
      losers,
      avgWin,
      avgLoss,
    };
  }

  // ===========================================================================
  // Price Utilities
  // ===========================================================================

  /**
   * Update price cache with current prices
   */
  async updatePriceCache(): Promise<void> {
    const quoteCurrency = this.config.quoteCurrency;

    for (const exchange of this.exchanges.values()) {
      if (!exchange.isConnected()) continue;

      try {
        const symbols = exchange.getSymbols();
        const usdPairs = symbols.filter(
          (s) => s.endsWith(`/${quoteCurrency}`) || s.endsWith('/USDT')
        );

        const tickers = await exchange.fetchTickers(usdPairs);
        for (const [symbol, ticker] of tickers) {
          const base = symbol.split('/')[0];
          this.priceCache.set(base, ticker.last);
        }
      } catch (error) {
        logger.warn('Failed to update price cache', {
          exchange: exchange.id,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Get price for a currency from cache
   */
  getPrice(currency: string): Decimal | undefined {
    // USD is always 1
    if (currency === 'USD' || currency === 'USDT' || currency === 'USDC') {
      return new Decimal(1);
    }
    return this.priceCache.get(currency);
  }

  /**
   * Calculate total USD value from currency balances
   */
  private async calculateTotalUsdValue(balances: Map<string, Decimal>): Promise<Decimal> {
    await this.updatePriceCache();

    let total = new Decimal(0);

    for (const [currency, amount] of balances) {
      const price = this.getPrice(currency);
      if (price) {
        total = total.plus(amount.times(price));
      } else {
        logger.debug('No price for currency', { currency });
      }
    }

    return total;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cleanup and dispose resources
   */
  dispose(): void {
    this.stopSnapshots();
    this.exchanges.clear();
    this.snapshots = [];
    this.priceCache.clear();
    this.removeAllListeners();
    logger.info('Portfolio manager disposed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let portfolioManager: PortfolioManager | null = null;

/**
 * Get the portfolio manager singleton
 */
export function getPortfolioManager(): PortfolioManager {
  if (!portfolioManager) {
    portfolioManager = new PortfolioManager();
  }
  return portfolioManager;
}

/**
 * Create a new portfolio manager with custom config
 */
export function createPortfolioManager(config: PortfolioManagerConfig): PortfolioManager {
  return new PortfolioManager(config);
}
