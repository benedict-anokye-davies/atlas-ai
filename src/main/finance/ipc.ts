/**
 * Atlas Finance - IPC Handlers
 *
 * IPC handlers for finance functionality exposed to renderer process.
 *
 * @module finance/ipc
 */

import { ipcMain } from 'electron';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../utils/logger';
import { getTrueLayerClient, initializeTrueLayer, shutdownTrueLayer } from './truelayer';
import { getTransactionManager } from './transactions';
import { getBudgetManager, initializeBudgetManager } from './budget';
import type {
  TransactionFilter,
  TransactionCategory,
  BudgetPeriod,
  TrueLayerConfig,
} from './types';

const logger = createModuleLogger('FinanceIPC');

/**
 * IPC result wrapper
 */
interface IPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Convert Decimal objects to strings for IPC serialization
 */
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

/**
 * Register all finance IPC handlers
 */
export function registerFinanceIPC(): void {
  logger.info('Registering finance IPC handlers');

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Initialize TrueLayer client
   */
  ipcMain.handle('finance:initialize', async (_, config?: TrueLayerConfig): Promise<IPCResult> => {
    try {
      await initializeTrueLayer(config);
      await initializeBudgetManager();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to initialize finance', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get connection status
   */
  ipcMain.handle('finance:status', async (): Promise<IPCResult<string>> => {
    try {
      const client = getTrueLayerClient();
      return { success: true, data: client.getStatus() };
    } catch (error) {
      return { success: true, data: 'disconnected' };
    }
  });

  /**
   * Start OAuth authorization flow
   */
  ipcMain.handle('finance:authorize', async (): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      await client.authorize();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to start authorization', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Exchange OAuth code for tokens
   */
  ipcMain.handle('finance:exchange-code', async (_, code: string): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      await client.exchangeCode(code);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to exchange code', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Disconnect from bank
   */
  ipcMain.handle('finance:disconnect', async (): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      await client.disconnect();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to disconnect', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Shutdown finance module
   */
  ipcMain.handle('finance:shutdown', async (): Promise<IPCResult> => {
    try {
      shutdownTrueLayer();
      return { success: true };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  });

  // ===========================================================================
  // Account Operations
  // ===========================================================================

  /**
   * Get all bank accounts
   */
  ipcMain.handle('finance:accounts', async (): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getAccounts();

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get accounts', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get balance for a specific account
   */
  ipcMain.handle('finance:balance', async (_, accountId: string): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getBalance(accountId);

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get balance', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all account balances
   */
  ipcMain.handle('finance:all-balances', async (): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getAllBalances();

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get all balances', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ===========================================================================
  // Transaction Operations
  // ===========================================================================

  /**
   * Get transactions with filtering
   */
  ipcMain.handle(
    'finance:transactions',
    async (_, filter?: TransactionFilter): Promise<IPCResult> => {
      try {
        const manager = getTransactionManager();
        const result = await manager.getTransactions(filter);
        return { success: true, data: serializeDecimals(result) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get transactions', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Get pending transactions
   */
  ipcMain.handle(
    'finance:pending-transactions',
    async (_, accountId: string): Promise<IPCResult> => {
      try {
        const client = getTrueLayerClient();
        const result = await client.getPendingTransactions(accountId);

        if (!result.success) {
          return { success: false, error: result.error?.message };
        }

        return { success: true, data: serializeDecimals(result.data) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get pending transactions', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Recategorize a transaction
   */
  ipcMain.handle(
    'finance:recategorize',
    async (_, transactionId: string, category: TransactionCategory): Promise<IPCResult> => {
      try {
        const manager = getTransactionManager();
        const success = await manager.recategorize(transactionId, category);
        return { success };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to recategorize', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  // ===========================================================================
  // Spending Analytics
  // ===========================================================================

  /**
   * Get spending by category
   */
  ipcMain.handle(
    'finance:spending-by-category',
    async (_, from?: string, to?: string, currency?: string): Promise<IPCResult> => {
      try {
        const manager = getTransactionManager();
        const result = await manager.getSpendingByCategory(from, to, currency);
        return { success: true, data: serializeDecimals(result) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get spending by category', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Get spending report
   */
  ipcMain.handle(
    'finance:spending-report',
    async (_, from: string, to: string, currency?: string): Promise<IPCResult> => {
      try {
        const manager = getTransactionManager();
        const result = await manager.getSpendingReport(from, to, currency);
        return { success: true, data: serializeDecimals(result) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get spending report', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Generate spending insights
   */
  ipcMain.handle('finance:insights', async (_, from: string, to: string): Promise<IPCResult> => {
    try {
      const manager = getTransactionManager();
      const result = await manager.generateInsights(from, to);
      return { success: true, data: serializeDecimals(result) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to generate insights', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ===========================================================================
  // Budget Operations
  // ===========================================================================

  /**
   * Create a budget
   */
  ipcMain.handle(
    'finance:create-budget',
    async (
      _,
      category: TransactionCategory,
      amount: number,
      period: BudgetPeriod,
      options?: { currency?: string; alertThreshold?: number }
    ): Promise<IPCResult> => {
      try {
        const manager = getBudgetManager();
        const budget = await manager.createBudget(category, amount, period, options);
        return { success: true, data: serializeDecimals(budget) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to create budget', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Update a budget
   */
  ipcMain.handle(
    'finance:update-budget',
    async (
      _,
      id: string,
      updates: { amount?: number; period?: BudgetPeriod; alertThreshold?: number; active?: boolean }
    ): Promise<IPCResult> => {
      try {
        const manager = getBudgetManager();
        const budget = await manager.updateBudget(id, updates);

        if (!budget) {
          return { success: false, error: 'Budget not found' };
        }

        return { success: true, data: serializeDecimals(budget) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to update budget', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Delete a budget
   */
  ipcMain.handle('finance:delete-budget', async (_, id: string): Promise<IPCResult> => {
    try {
      const manager = getBudgetManager();
      const success = await manager.deleteBudget(id);
      return { success };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete budget', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all budgets
   */
  ipcMain.handle('finance:budgets', async (): Promise<IPCResult> => {
    try {
      const manager = getBudgetManager();
      const budgets = manager.getAllBudgets();
      return { success: true, data: serializeDecimals(budgets) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budgets', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get budget status
   */
  ipcMain.handle('finance:budget-status', async (_, id: string): Promise<IPCResult> => {
    try {
      const manager = getBudgetManager();
      const status = await manager.getBudgetStatus(id);

      if (!status) {
        return { success: false, error: 'Budget not found' };
      }

      return { success: true, data: serializeDecimals(status) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budget status', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all budget statuses
   */
  ipcMain.handle('finance:all-budget-statuses', async (): Promise<IPCResult> => {
    try {
      const manager = getBudgetManager();
      const statuses = await manager.getAllBudgetStatuses();
      return { success: true, data: serializeDecimals(statuses) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get all budget statuses', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get budget summary
   */
  ipcMain.handle('finance:budget-summary', async (): Promise<IPCResult> => {
    try {
      const manager = getBudgetManager();
      const summary = await manager.getBudgetSummary();
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budget summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ===========================================================================
  // Direct Debits & Standing Orders
  // ===========================================================================

  /**
   * Get direct debits for an account
   */
  ipcMain.handle('finance:direct-debits', async (_, accountId: string): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getDirectDebits(accountId);

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get direct debits', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get standing orders for an account
   */
  ipcMain.handle('finance:standing-orders', async (_, accountId: string): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getStandingOrders(accountId);

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get standing orders', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // ===========================================================================
  // Credit Cards
  // ===========================================================================

  /**
   * Get all credit cards
   */
  ipcMain.handle('finance:cards', async (): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getCards();

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: result.data };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get cards', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get credit card balance
   */
  ipcMain.handle('finance:card-balance', async (_, cardId: string): Promise<IPCResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getCardBalance(cardId);

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: serializeDecimals(result.data) };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get card balance', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get credit card transactions
   */
  ipcMain.handle(
    'finance:card-transactions',
    async (_, cardId: string, from?: string, to?: string): Promise<IPCResult> => {
      try {
        const client = getTrueLayerClient();
        const result = await client.getCardTransactions(cardId, from, to);

        if (!result.success) {
          return { success: false, error: result.error?.message };
        }

        return { success: true, data: serializeDecimals(result.data) };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get card transactions', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  // ===========================================================================
  // Provider Information
  // ===========================================================================

  /**
   * Get supported banks/providers
   */
  ipcMain.handle('finance:providers', async (): Promise<IPCResult> => {
    try {
      const { TrueLayerClient } = await import('./truelayer');
      const result = await TrueLayerClient.getSupportedProviders();

      if (!result.success) {
        return { success: false, error: result.error?.message };
      }

      return { success: true, data: result.data };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get providers', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  logger.info('Finance IPC handlers registered (30 handlers)');
}

/**
 * Unregister all finance IPC handlers
 */
export function unregisterFinanceIPC(): void {
  const channels = [
    'finance:initialize',
    'finance:status',
    'finance:authorize',
    'finance:exchange-code',
    'finance:disconnect',
    'finance:shutdown',
    'finance:accounts',
    'finance:balance',
    'finance:all-balances',
    'finance:transactions',
    'finance:pending-transactions',
    'finance:recategorize',
    'finance:spending-by-category',
    'finance:spending-report',
    'finance:insights',
    'finance:create-budget',
    'finance:update-budget',
    'finance:delete-budget',
    'finance:budgets',
    'finance:budget-status',
    'finance:all-budget-statuses',
    'finance:budget-summary',
    'finance:direct-debits',
    'finance:standing-orders',
    'finance:cards',
    'finance:card-balance',
    'finance:card-transactions',
    'finance:providers',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('Finance IPC handlers unregistered');
}

export default registerFinanceIPC;
