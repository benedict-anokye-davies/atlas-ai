/**
 * Atlas Desktop - Trading Agent Tools
 *
 * Agent tools for trading operations including portfolio management,
 * price alerts, and trading history.
 *
 * @module agent/tools/trading
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import Decimal from 'decimal.js';
import {
  getPortfolioManager,
  getAlertManager,
  getTradingHistory,
  ExchangeId,
  PerformancePeriod,
  AlertCondition,
} from '../../trading';

const logger = createModuleLogger('TradingTools');

/**
 * Convert Decimal values to strings for serialization
 */
function serializeDecimals<T>(obj: T): T {
  if (obj instanceof Decimal) {
    return obj.toString() as unknown as T;
  }
  if (obj instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of obj) {
      result[String(key)] = serializeDecimals(value);
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

// =============================================================================
// Portfolio Tools
// =============================================================================

/**
 * Get portfolio balance across all exchanges
 */
export const getPortfolioBalanceTool: AgentTool = {
  name: 'trading_get_portfolio',
  description:
    'Get aggregated portfolio balance across all connected trading exchanges. Shows total balances by currency and by exchange.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const portfolio = getPortfolioManager();
      const balance = await portfolio.getAggregatedBalance();

      return {
        success: true,
        data: serializeDecimals({
          timestamp: balance.timestamp,
          totalUsdValue: balance.totalUsdValue,
          byCurrency: Object.fromEntries(balance.byCurrency),
          byExchange: Object.fromEntries(
            Array.from(balance.byExchange.entries()).map(([id, bal]) => [
              id,
              {
                totalUsdValue: bal.totalUsdValue,
                currencies: Object.fromEntries(bal.currencies),
              },
            ])
          ),
        }),
      };
    } catch (error) {
      logger.error('Failed to get portfolio balance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get all trading positions
 */
export const getPositionsTool: AgentTool = {
  name: 'trading_get_positions',
  description:
    'Get all open trading positions across all exchanges. Shows position details including size, entry price, and P&L.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const portfolio = getPortfolioManager();
      const positions = await portfolio.getAllPositions();

      const positionsObj: Record<string, unknown[]> = {};
      for (const [exchangeId, exchangePositions] of positions) {
        positionsObj[exchangeId] = serializeDecimals(exchangePositions);
      }

      const summary = await portfolio.getPositionSummary();

      return {
        success: true,
        data: {
          positions: positionsObj,
          summary: serializeDecimals(summary),
        },
      };
    } catch (error) {
      logger.error('Failed to get positions', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get portfolio performance
 */
export const getPerformanceTool: AgentTool = {
  name: 'trading_get_performance',
  description:
    'Get portfolio performance metrics for a time period. Includes return percentage, high water mark, and drawdown.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['1h', '24h', '7d', '30d', '90d', '1y', 'all'],
        description: 'Time period for performance calculation (default: 24h)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const period = (params.period as PerformancePeriod) || '24h';
      const portfolio = getPortfolioManager();
      const performance = await portfolio.getPerformance(period);

      return {
        success: true,
        data: serializeDecimals(performance),
      };
    } catch (error) {
      logger.error('Failed to get performance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get P&L report
 */
export const getPnLTool: AgentTool = {
  name: 'trading_get_pnl',
  description:
    'Get profit and loss report for trading. Shows realized P&L, unrealized P&L, fees, and trade statistics.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['1h', '24h', '7d', '30d', '90d', '1y', 'all'],
        description: 'Time period for P&L calculation (default: 24h)',
      },
      exchange: {
        type: 'string',
        enum: ['binance', 'coinbase', 'schwab', 'metaapi'],
        description: 'Filter by specific exchange (optional)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const period = (params.period as PerformancePeriod) || '24h';
      const exchange = params.exchange as ExchangeId | undefined;
      const portfolio = getPortfolioManager();
      const pnl = await portfolio.getPnL(period, exchange);

      return {
        success: true,
        data: serializeDecimals(pnl),
      };
    } catch (error) {
      logger.error('Failed to get P&L', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Alert Tools
// =============================================================================

/**
 * Create a price alert
 */
export const createAlertTool: AgentTool = {
  name: 'trading_create_alert',
  description:
    'Create a price alert for a trading symbol. Will trigger notification when condition is met.',
  parameters: {
    type: 'object',
    properties: {
      exchange: {
        type: 'string',
        enum: ['binance', 'coinbase', 'schwab', 'metaapi'],
        description: 'Exchange to monitor',
      },
      symbol: {
        type: 'string',
        description: 'Trading symbol (e.g., "BTC/USDT", "AAPL")',
      },
      condition: {
        type: 'string',
        enum: ['price_above', 'price_below', 'price_crosses', 'change_up', 'change_down'],
        description: 'Alert condition type',
      },
      target: {
        type: 'number',
        description: 'Target price or percentage for the alert',
      },
      repeat: {
        type: 'boolean',
        description: 'Whether alert should repeat after triggering (default: false)',
      },
      note: {
        type: 'string',
        description: 'Optional note or reason for the alert',
      },
    },
    required: ['exchange', 'symbol', 'condition', 'target'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const alertManager = getAlertManager();
      const alert = alertManager.createAlert({
        exchange: params.exchange as ExchangeId,
        symbol: params.symbol as string,
        condition: params.condition as AlertCondition,
        target: params.target as number,
        repeat: params.repeat as boolean | undefined,
        note: params.note as string | undefined,
      });

      return {
        success: true,
        data: {
          alert: serializeDecimals(alert),
          description: `Alert created: ${alert.condition} ${alert.target} for ${alert.symbol}`,
        },
      };
    } catch (error) {
      logger.error('Failed to create alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * List price alerts
 */
export const listAlertsTool: AgentTool = {
  name: 'trading_list_alerts',
  description: 'List all price alerts. Can filter by exchange or symbol.',
  parameters: {
    type: 'object',
    properties: {
      exchange: {
        type: 'string',
        enum: ['binance', 'coinbase', 'schwab', 'metaapi'],
        description: 'Filter by exchange (optional)',
      },
      symbol: {
        type: 'string',
        description: 'Filter by symbol (optional)',
      },
      activeOnly: {
        type: 'boolean',
        description: 'Only show active alerts (default: false)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const alertManager = getAlertManager();
      let alerts;

      if (params.activeOnly) {
        alerts = alertManager.getActiveAlerts();
      } else if (params.exchange) {
        alerts = alertManager.getAlertsByExchange(params.exchange as ExchangeId);
      } else if (params.symbol) {
        alerts = alertManager.getAlertsBySymbol(params.symbol as string);
      } else {
        alerts = alertManager.getAlerts();
      }

      const stats = alertManager.getStats();

      return {
        success: true,
        data: {
          alerts: serializeDecimals(alerts),
          stats: {
            total: stats.total,
            active: stats.active,
            triggered: stats.triggered,
          },
        },
      };
    } catch (error) {
      logger.error('Failed to list alerts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Cancel a price alert
 */
export const cancelAlertTool: AgentTool = {
  name: 'trading_cancel_alert',
  description: 'Cancel a price alert by ID.',
  parameters: {
    type: 'object',
    properties: {
      alertId: {
        type: 'string',
        description: 'ID of the alert to cancel',
      },
    },
    required: ['alertId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const alertManager = getAlertManager();
      const success = alertManager.cancelAlert(params.alertId as string);

      return {
        success,
        data: { canceled: success, description: success ? 'Alert canceled' : 'Alert not found' },
      };
    } catch (error) {
      logger.error('Failed to cancel alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Trading History Tools
// =============================================================================

/**
 * Get recent trades
 */
export const getRecentTradesTool: AgentTool = {
  name: 'trading_get_trades',
  description: 'Get recent trading history. Can filter by exchange, symbol, or time period.',
  parameters: {
    type: 'object',
    properties: {
      exchange: {
        type: 'string',
        enum: ['binance', 'coinbase', 'schwab', 'metaapi'],
        description: 'Filter by exchange (optional)',
      },
      symbol: {
        type: 'string',
        description: 'Filter by symbol (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of trades to return (default: 20)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const history = getTradingHistory();
      const trades = history.getTrades({
        exchange: params.exchange as ExchangeId | undefined,
        symbol: params.symbol as string | undefined,
        limit: (params.limit as number) || 20,
      });

      return {
        success: true,
        data: serializeDecimals(trades),
      };
    } catch (error) {
      logger.error('Failed to get trades', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get trade summary
 */
export const getTradeSummaryTool: AgentTool = {
  name: 'trading_get_summary',
  description:
    'Get trading summary statistics. Shows total volume, fees, and breakdown by exchange/symbol.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['1h', '24h', '7d', '30d', '90d', 'all'],
        description: 'Time period for summary (default: 24h)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const history = getTradingHistory();

      let since: number | undefined;
      const period = (params.period as string) || '24h';

      if (period !== 'all') {
        const periodMs: Record<string, number> = {
          '1h': 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000,
          '90d': 90 * 24 * 60 * 60 * 1000,
        };
        since = Date.now() - (periodMs[period] || periodMs['24h']);
      }

      const summary = history.getTradeSummary(since);

      return {
        success: true,
        data: serializeDecimals({
          period: summary.period,
          totalTrades: summary.totalTrades,
          totalVolume: summary.totalVolume,
          totalFees: summary.totalFees,
          buyVolume: summary.buyVolume,
          sellVolume: summary.sellVolume,
          uniqueSymbols: summary.uniqueSymbols,
          byExchange: Object.fromEntries(summary.byExchange),
          bySymbol: Object.fromEntries(summary.bySymbol),
        }),
      };
    } catch (error) {
      logger.error('Failed to get trade summary', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get most traded symbols
 */
export const getMostTradedTool: AgentTool = {
  name: 'trading_most_traded',
  description: 'Get the most frequently traded symbols.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of symbols to return (default: 10)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const history = getTradingHistory();
      const symbols = history.getMostTradedSymbols((params.limit as number) || 10);

      return {
        success: true,
        data: symbols,
      };
    } catch (error) {
      logger.error('Failed to get most traded symbols', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Get all trading tools
 */
export function getTradingTools(): AgentTool[] {
  return [
    // Portfolio
    getPortfolioBalanceTool,
    getPositionsTool,
    getPerformanceTool,
    getPnLTool,
    // Alerts
    createAlertTool,
    listAlertsTool,
    cancelAlertTool,
    // History
    getRecentTradesTool,
    getTradeSummaryTool,
    getMostTradedTool,
  ];
}

export default {
  getTradingTools,
  getPortfolioBalanceTool,
  getPositionsTool,
  getPerformanceTool,
  getPnLTool,
  createAlertTool,
  listAlertsTool,
  cancelAlertTool,
  getRecentTradesTool,
  getTradeSummaryTool,
  getMostTradedTool,
};
