/**
 * Atlas Autonomous Trading - IPC Handlers
 * 
 * IPC handlers for autonomous trading operations:
 * - Autonomous control (start/stop/pause)
 * - Backtest operations
 * - Portfolio queries
 * - Signal management
 * - Risk management
 * - Feedback submission
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../utils/logger';
import {
  getAutonomousTrader,
  createAutonomousTrader,
  getGoBackendClient,
  getSignalAggregator,
  getRiskManager,
  type AutonomousConfig,
  type BacktestConfig,
  type TradeFeedback,
} from './backtester';

const logger = createModuleLogger('TradingIPC');

// Helper to convert Decimal to serializable format
function serializeDecimals<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  
  if (obj instanceof Decimal) {
    return obj.toString() as unknown as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeDecimals) as unknown as T;
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeDecimals(value);
    }
    return result as T;
  }
  
  return obj;
}

// Helper to convert string numbers to Decimal
function deserializeDecimals<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string' && /^-?\d+\.?\d*$/.test(obj)) {
    return new Decimal(obj) as unknown as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(deserializeDecimals) as unknown as T;
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Known decimal fields
      const decimalFields = [
        'maxCapitalPercent', 'reserveCashPercent', 'maxSlippagePercent',
        'rebalanceThresholdPercent', 'volatilityThresholdPercent', 'feedbackWeight',
        'initialCapital', 'commissionRate', 'slippageRate', 'threshold', 'value',
        'takeProfitPercent', 'stopLossPercent', 'trailingStopPercent',
      ];
      
      if (decimalFields.includes(key) && typeof value === 'string') {
        result[key] = new Decimal(value);
      } else {
        result[key] = deserializeDecimals(value);
      }
    }
    return result as T;
  }
  
  return obj;
}

export function registerTradingIpcHandlers(): void {
  logger.info('Registering trading IPC handlers');

  // ===========================================================================
  // Autonomous Control
  // ===========================================================================

  ipcMain.handle('trading:autonomous:start', async (_event: IpcMainInvokeEvent, config?: Partial<AutonomousConfig>) => {
    try {
      let trader = getAutonomousTrader();
      
      if (config) {
        const deserializedConfig = deserializeDecimals(config);
        trader = createAutonomousTrader(deserializedConfig);
      }
      
      await trader.start();
      
      return { success: true, data: serializeDecimals(trader.getStatus()) };
    } catch (error) {
      logger.error('Failed to start autonomous trading', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:autonomous:stop', async () => {
    try {
      const trader = getAutonomousTrader();
      await trader.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop autonomous trading', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:autonomous:pause', async () => {
    try {
      const trader = getAutonomousTrader();
      trader.pause();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:autonomous:resume', async () => {
    try {
      const trader = getAutonomousTrader();
      trader.resume();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:autonomous:status', async () => {
    try {
      const trader = getAutonomousTrader();
      return { success: true, data: serializeDecimals(trader.getStatus()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:autonomous:config', async (_event: IpcMainInvokeEvent, updates?: Partial<AutonomousConfig>) => {
    try {
      const trader = getAutonomousTrader();
      
      if (updates) {
        const deserializedUpdates = deserializeDecimals(updates);
        trader.updateConfig(deserializedUpdates);
      }
      
      return { success: true, data: serializeDecimals(trader.getConfig()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Kill Switch
  // ===========================================================================

  ipcMain.handle('trading:killswitch:trigger', async () => {
    try {
      const trader = getAutonomousTrader();
      trader.pause(); // Immediate pause
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:killswitch:reset', async () => {
    try {
      const trader = getAutonomousTrader();
      await trader.resetKillSwitch();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:killswitch:status', async () => {
    try {
      const riskManager = getRiskManager();
      return { success: true, data: serializeDecimals(riskManager.getKillSwitchStatus()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Backtest Operations
  // ===========================================================================

  ipcMain.handle('trading:backtest:run', async (_event: IpcMainInvokeEvent, config: BacktestConfig) => {
    try {
      const client = getGoBackendClient();
      
      if (!client.isConnected()) {
        await client.connect();
      }
      
      const deserializedConfig = deserializeDecimals(config);
      const backtestId = await client.runBacktest(deserializedConfig);
      
      return { success: true, data: { backtestId } };
    } catch (error) {
      logger.error('Failed to run backtest', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backtest:status', async (_event: IpcMainInvokeEvent, backtestId: string) => {
    try {
      const client = getGoBackendClient();
      const progress = await client.getBacktestProgress(backtestId);
      return { success: true, data: serializeDecimals(progress) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backtest:result', async (_event: IpcMainInvokeEvent, backtestId: string) => {
    try {
      const client = getGoBackendClient();
      const result = await client.getBacktestResult(backtestId);
      return { success: true, data: serializeDecimals(result) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backtest:cancel', async (_event: IpcMainInvokeEvent, backtestId: string) => {
    try {
      const client = getGoBackendClient();
      await client.cancelBacktest(backtestId);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backtest:list', async () => {
    try {
      const client = getGoBackendClient();
      const backtests = await client.listBacktests();
      return { success: true, data: serializeDecimals(backtests) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Signals
  // ===========================================================================

  ipcMain.handle('trading:signals:list', async (_event: IpcMainInvokeEvent, symbol?: string) => {
    try {
      const aggregator = getSignalAggregator();
      const signals = symbol ? aggregator.getSignals(symbol) : aggregator.getActiveSignals();
      return { success: true, data: serializeDecimals(signals) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:signals:subscribe', async (_event: IpcMainInvokeEvent, symbol: string) => {
    try {
      const aggregator = getSignalAggregator();
      aggregator.addSymbol(symbol);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:signals:unsubscribe', async (_event: IpcMainInvokeEvent, symbol: string) => {
    try {
      const aggregator = getSignalAggregator();
      aggregator.removeSymbol(symbol);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Risk Management
  // ===========================================================================

  ipcMain.handle('trading:risk:metrics', async () => {
    try {
      const riskManager = getRiskManager();
      return { success: true, data: serializeDecimals(riskManager.getMetrics()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:risk:limits', async () => {
    try {
      const riskManager = getRiskManager();
      return { success: true, data: serializeDecimals(riskManager.getLimits()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Feedback & Learning
  // ===========================================================================

  ipcMain.handle('trading:feedback:submit', async (_event: IpcMainInvokeEvent, feedback: TradeFeedback) => {
    try {
      const trader = getAutonomousTrader();
      await trader.submitFeedback(feedback);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // ===========================================================================
  // Go Backend Connection
  // ===========================================================================

  ipcMain.handle('trading:backend:connect', async (_event: IpcMainInvokeEvent, config?: { host: string; port: number }) => {
    try {
      const client = getGoBackendClient();
      
      if (config) {
        // Would need to recreate client with new config
        // For now, just connect with existing config
      }
      
      await client.connect();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backend:disconnect', async () => {
    try {
      const client = getGoBackendClient();
      client.disconnect();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('trading:backend:status', async () => {
    try {
      const client = getGoBackendClient();
      
      if (!client.isConnected()) {
        return { success: true, data: { connected: false } };
      }
      
      const status = await client.getStatus();
      // Status already includes 'connected' field, just serialize
      return { success: true, data: serializeDecimals({ ...status, connected: true }) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Trading IPC handlers registered');
}

export function unregisterTradingIpcHandlers(): void {
  const channels = [
    'trading:autonomous:start',
    'trading:autonomous:stop',
    'trading:autonomous:pause',
    'trading:autonomous:resume',
    'trading:autonomous:status',
    'trading:autonomous:config',
    'trading:killswitch:trigger',
    'trading:killswitch:reset',
    'trading:killswitch:status',
    'trading:backtest:run',
    'trading:backtest:status',
    'trading:backtest:result',
    'trading:backtest:cancel',
    'trading:backtest:list',
    'trading:signals:list',
    'trading:signals:subscribe',
    'trading:signals:unsubscribe',
    'trading:risk:metrics',
    'trading:risk:limits',
    'trading:feedback:submit',
    'trading:backend:connect',
    'trading:backend:disconnect',
    'trading:backend:status',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('Trading IPC handlers unregistered');
}
