/**
 * Atlas Trading - IPC Handlers
 *
 * IPC handlers for trading functionality including exchanges,
 * portfolio management, alerts, and history.
 *
 * @module trading/ipc
 */

import { ipcMain } from 'electron';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../utils/logger';
import {
  getPortfolioManager,
  getAlertManager,
  getTradingHistory,
  ExchangeId,
  TradingSymbol,
  PerformancePeriod,
  CreateAlertRequest,
  TradeHistoryQuery,
  OrderHistoryQuery,
} from '../trading';

const logger = createModuleLogger('TradingIPC');

/**
 * IPC result type
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Validate exchange ID
 */
function validateExchangeId(id: unknown): id is ExchangeId {
  const validExchanges: ExchangeId[] = ['binance', 'coinbase', 'schwab', 'metaapi'];
  return typeof id === 'string' && validExchanges.includes(id as ExchangeId);
}

/**
 * Validate performance period
 */
function validatePeriod(period: unknown): period is PerformancePeriod {
  const validPeriods: PerformancePeriod[] = ['1h', '24h', '7d', '30d', '90d', '1y', 'all'];
  return typeof period === 'string' && validPeriods.includes(period as PerformancePeriod);
}

/**
 * Convert Decimal values to strings for IPC serialization
 */
function serializeDecimals<T>(obj: T): T {
  if (obj instanceof Decimal) {
    return obj.toString() as unknown as T;
  }
  if (obj instanceof Map) {
    const result = new Map();
    for (const [key, value] of obj) {
      result.set(key, serializeDecimals(value));
    }
    return result as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeDecimals) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeDecimals(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Register all trading IPC handlers
 */
export function registerTradingHandlers(): void {
  logger.info('Registering trading IPC handlers...');

  // ===========================================================================
  // Portfolio Handlers
  // ===========================================================================

  // Get aggregated balance across all exchanges
  ipcMain.handle('trading:get-aggregated-balance', async (): Promise<IPCResult> => {
    try {
      const portfolio = getPortfolioManager();
      const balance = await portfolio.getAggregatedBalance();
      return { success: true, data: serializeDecimals(balance) };
    } catch (error) {
      logger.error('Failed to get aggregated balance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get balance for specific exchange
  ipcMain.handle(
    'trading:get-exchange-balance',
    async (_event, exchangeId: unknown): Promise<IPCResult> => {
      if (!validateExchangeId(exchangeId)) {
        return { success: false, error: 'Invalid exchange ID' };
      }

      try {
        const portfolio = getPortfolioManager();
        const balance = await portfolio.getExchangeBalance(exchangeId);
        return { success: true, data: balance ? serializeDecimals(balance) : null };
      } catch (error) {
        logger.error('Failed to get exchange balance', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get all positions across exchanges
  ipcMain.handle('trading:get-all-positions', async (): Promise<IPCResult> => {
    try {
      const portfolio = getPortfolioManager();
      const positions = await portfolio.getAllPositions();

      // Convert Map to object for IPC
      const positionsObj: Record<string, unknown[]> = {};
      for (const [exchangeId, exchangePositions] of positions) {
        positionsObj[exchangeId] = serializeDecimals(exchangePositions);
      }

      return { success: true, data: positionsObj };
    } catch (error) {
      logger.error('Failed to get positions', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get position summary
  ipcMain.handle('trading:get-position-summary', async (): Promise<IPCResult> => {
    try {
      const portfolio = getPortfolioManager();
      const summary = await portfolio.getPositionSummary();
      return { success: true, data: serializeDecimals(summary) };
    } catch (error) {
      logger.error('Failed to get position summary', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get performance metrics
  ipcMain.handle('trading:get-performance', async (_event, period: unknown): Promise<IPCResult> => {
    if (!validatePeriod(period)) {
      return { success: false, error: 'Invalid period' };
    }

    try {
      const portfolio = getPortfolioManager();
      const performance = await portfolio.getPerformance(period);
      return { success: true, data: serializeDecimals(performance) };
    } catch (error) {
      logger.error('Failed to get performance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get P&L report
  ipcMain.handle(
    'trading:get-pnl',
    async (_event, period?: unknown, exchangeId?: unknown): Promise<IPCResult> => {
      const validPeriod = validatePeriod(period) ? period : '24h';
      const validExchange = validateExchangeId(exchangeId) ? exchangeId : undefined;

      try {
        const portfolio = getPortfolioManager();
        const pnl = await portfolio.getPnL(validPeriod, validExchange);
        return { success: true, data: serializeDecimals(pnl) };
      } catch (error) {
        logger.error('Failed to get P&L', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get registered exchanges
  ipcMain.handle('trading:get-exchanges', (): IPCResult => {
    try {
      const portfolio = getPortfolioManager();
      return { success: true, data: portfolio.getExchanges() };
    } catch (error) {
      logger.error('Failed to get exchanges', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Take portfolio snapshot
  ipcMain.handle('trading:take-snapshot', async (): Promise<IPCResult> => {
    try {
      const portfolio = getPortfolioManager();
      const snapshot = await portfolio.takeSnapshot();
      return { success: true, data: serializeDecimals(snapshot) };
    } catch (error) {
      logger.error('Failed to take snapshot', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get portfolio snapshots
  ipcMain.handle('trading:get-snapshots', (_event, since?: unknown): IPCResult => {
    try {
      const portfolio = getPortfolioManager();
      const validSince = typeof since === 'number' ? since : undefined;
      const snapshots = portfolio.getSnapshots(validSince);
      return { success: true, data: serializeDecimals(snapshots) };
    } catch (error) {
      logger.error('Failed to get snapshots', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Alert Handlers
  // ===========================================================================

  // Create price alert
  ipcMain.handle('trading:create-alert', (_event, request: unknown): IPCResult => {
    if (!request || typeof request !== 'object') {
      return { success: false, error: 'Invalid alert request' };
    }

    const req = request as Partial<CreateAlertRequest>;

    if (!validateExchangeId(req.exchange)) {
      return { success: false, error: 'Invalid exchange ID' };
    }
    if (typeof req.symbol !== 'string') {
      return { success: false, error: 'Symbol must be a string' };
    }
    if (typeof req.target !== 'number') {
      return { success: false, error: 'Target must be a number' };
    }

    const validConditions = [
      'price_above',
      'price_below',
      'price_crosses',
      'change_up',
      'change_down',
      'volume_spike',
    ];
    if (!validConditions.includes(req.condition as string)) {
      return { success: false, error: 'Invalid alert condition' };
    }

    try {
      const alertManager = getAlertManager();
      const alert = alertManager.createAlert(req as CreateAlertRequest);
      return { success: true, data: serializeDecimals(alert) };
    } catch (error) {
      logger.error('Failed to create alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel alert
  ipcMain.handle('trading:cancel-alert', (_event, alertId: unknown): IPCResult => {
    if (typeof alertId !== 'string') {
      return { success: false, error: 'Alert ID must be a string' };
    }

    try {
      const alertManager = getAlertManager();
      const success = alertManager.cancelAlert(alertId);
      return { success, data: { canceled: success } };
    } catch (error) {
      logger.error('Failed to cancel alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all alerts
  ipcMain.handle('trading:get-alerts', (): IPCResult => {
    try {
      const alertManager = getAlertManager();
      const alerts = alertManager.getAlerts();
      return { success: true, data: serializeDecimals(alerts) };
    } catch (error) {
      logger.error('Failed to get alerts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get active alerts
  ipcMain.handle('trading:get-active-alerts', (): IPCResult => {
    try {
      const alertManager = getAlertManager();
      const alerts = alertManager.getActiveAlerts();
      return { success: true, data: serializeDecimals(alerts) };
    } catch (error) {
      logger.error('Failed to get active alerts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get alerts by exchange
  ipcMain.handle('trading:get-alerts-by-exchange', (_event, exchangeId: unknown): IPCResult => {
    if (!validateExchangeId(exchangeId)) {
      return { success: false, error: 'Invalid exchange ID' };
    }

    try {
      const alertManager = getAlertManager();
      const alerts = alertManager.getAlertsByExchange(exchangeId);
      return { success: true, data: serializeDecimals(alerts) };
    } catch (error) {
      logger.error('Failed to get alerts by exchange', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get alerts by symbol
  ipcMain.handle('trading:get-alerts-by-symbol', (_event, symbol: unknown): IPCResult => {
    if (typeof symbol !== 'string') {
      return { success: false, error: 'Symbol must be a string' };
    }

    try {
      const alertManager = getAlertManager();
      const alerts = alertManager.getAlertsBySymbol(symbol as TradingSymbol);
      return { success: true, data: serializeDecimals(alerts) };
    } catch (error) {
      logger.error('Failed to get alerts by symbol', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Update alert
  ipcMain.handle(
    'trading:update-alert',
    (_event, alertId: unknown, updates: unknown): IPCResult => {
      if (typeof alertId !== 'string') {
        return { success: false, error: 'Alert ID must be a string' };
      }
      if (!updates || typeof updates !== 'object') {
        return { success: false, error: 'Updates must be an object' };
      }

      try {
        const alertManager = getAlertManager();
        const alert = alertManager.updateAlert(alertId, updates as Record<string, unknown>);
        return { success: !!alert, data: alert ? serializeDecimals(alert) : null };
      } catch (error) {
        logger.error('Failed to update alert', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Reactivate alert
  ipcMain.handle('trading:reactivate-alert', (_event, alertId: unknown): IPCResult => {
    if (typeof alertId !== 'string') {
      return { success: false, error: 'Alert ID must be a string' };
    }

    try {
      const alertManager = getAlertManager();
      const success = alertManager.reactivateAlert(alertId);
      return { success, data: { reactivated: success } };
    } catch (error) {
      logger.error('Failed to reactivate alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get alert stats
  ipcMain.handle('trading:get-alert-stats', (): IPCResult => {
    try {
      const alertManager = getAlertManager();
      const stats = alertManager.getStats();

      // Convert Map to object for IPC
      const byExchange: Record<string, number> = {};
      for (const [exchangeId, count] of stats.byExchange) {
        byExchange[exchangeId] = count;
      }

      return {
        success: true,
        data: {
          ...stats,
          byExchange,
        },
      };
    } catch (error) {
      logger.error('Failed to get alert stats', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Clear all alerts
  ipcMain.handle('trading:clear-alerts', (): IPCResult => {
    try {
      const alertManager = getAlertManager();
      const count = alertManager.clearAllAlerts();
      return { success: true, data: { cleared: count } };
    } catch (error) {
      logger.error('Failed to clear alerts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Trading History Handlers
  // ===========================================================================

  // Get trades
  ipcMain.handle('trading:get-trades', (_event, query?: unknown): IPCResult => {
    try {
      const history = getTradingHistory();
      const validQuery = (query as TradeHistoryQuery) || {};
      const trades = history.getTrades(validQuery);
      return { success: true, data: serializeDecimals(trades) };
    } catch (error) {
      logger.error('Failed to get trades', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get orders
  ipcMain.handle('trading:get-orders', (_event, query?: unknown): IPCResult => {
    try {
      const history = getTradingHistory();
      const validQuery = (query as OrderHistoryQuery) || {};
      const orders = history.getOrders(validQuery);
      return { success: true, data: serializeDecimals(orders) };
    } catch (error) {
      logger.error('Failed to get orders', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get recent trades
  ipcMain.handle('trading:get-recent-trades', (_event, limit?: unknown): IPCResult => {
    try {
      const history = getTradingHistory();
      const validLimit = typeof limit === 'number' ? limit : 10;
      const trades = history.getRecentTrades(validLimit);
      return { success: true, data: serializeDecimals(trades) };
    } catch (error) {
      logger.error('Failed to get recent trades', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get recent orders
  ipcMain.handle('trading:get-recent-orders', (_event, limit?: unknown): IPCResult => {
    try {
      const history = getTradingHistory();
      const validLimit = typeof limit === 'number' ? limit : 10;
      const orders = history.getRecentOrders(validLimit);
      return { success: true, data: serializeDecimals(orders) };
    } catch (error) {
      logger.error('Failed to get recent orders', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get trade summary
  ipcMain.handle(
    'trading:get-trade-summary',
    (_event, since?: unknown, until?: unknown): IPCResult => {
      try {
        const history = getTradingHistory();
        const validSince = typeof since === 'number' ? since : undefined;
        const validUntil = typeof until === 'number' ? until : undefined;
        const summary = history.getTradeSummary(validSince, validUntil);
        return { success: true, data: serializeDecimals(summary) };
      } catch (error) {
        logger.error('Failed to get trade summary', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get most traded symbols
  ipcMain.handle('trading:get-most-traded', (_event, limit?: unknown): IPCResult => {
    try {
      const history = getTradingHistory();
      const validLimit = typeof limit === 'number' ? limit : 10;
      const symbols = history.getMostTradedSymbols(validLimit);
      return { success: true, data: symbols };
    } catch (error) {
      logger.error('Failed to get most traded symbols', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Get trade/order counts
  ipcMain.handle('trading:get-history-counts', (): IPCResult => {
    try {
      const history = getTradingHistory();
      return {
        success: true,
        data: {
          trades: history.getTradeCount(),
          orders: history.getOrderCount(),
        },
      };
    } catch (error) {
      logger.error('Failed to get history counts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Sync history from exchanges
  ipcMain.handle('trading:sync-history', async (): Promise<IPCResult> => {
    try {
      const history = getTradingHistory();
      await history.syncAllExchanges();
      return { success: true };
    } catch (error) {
      logger.error('Failed to sync history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Clear history cache
  ipcMain.handle('trading:clear-history-cache', (): IPCResult => {
    try {
      const history = getTradingHistory();
      history.clearCache();
      return { success: true };
    } catch (error) {
      logger.error('Failed to clear history cache', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Trading IPC handlers registered');
}

/**
 * List of trading IPC channels for unregistration
 */
export const TRADING_IPC_CHANNELS = [
  // Portfolio
  'trading:get-aggregated-balance',
  'trading:get-exchange-balance',
  'trading:get-all-positions',
  'trading:get-position-summary',
  'trading:get-performance',
  'trading:get-pnl',
  'trading:get-exchanges',
  'trading:take-snapshot',
  'trading:get-snapshots',
  // Alerts
  'trading:create-alert',
  'trading:cancel-alert',
  'trading:get-alerts',
  'trading:get-active-alerts',
  'trading:get-alerts-by-exchange',
  'trading:get-alerts-by-symbol',
  'trading:update-alert',
  'trading:reactivate-alert',
  'trading:get-alert-stats',
  'trading:clear-alerts',
  // History
  'trading:get-trades',
  'trading:get-orders',
  'trading:get-recent-trades',
  'trading:get-recent-orders',
  'trading:get-trade-summary',
  'trading:get-most-traded',
  'trading:get-history-counts',
  'trading:sync-history',
  'trading:clear-history-cache',
];

/**
 * Unregister trading IPC handlers
 */
export function unregisterTradingHandlers(): void {
  for (const channel of TRADING_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info('Trading IPC handlers unregistered');
}

export default {
  registerTradingHandlers,
  unregisterTradingHandlers,
  TRADING_IPC_CHANNELS,
};
