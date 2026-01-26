/**
 * Atlas Banking - Enhanced Feature IPC Handlers
 *
 * IPC handlers for advanced banking features:
 * - Transaction categorization
 * - Balance alerts
 * - Recurring payment detection
 * - Spending predictions
 * - Budget management
 * - Payment scheduling
 * - Transaction search & export
 * - Direct debits
 * - Payee validation
 *
 * @module banking/enhanced-ipc
 */

import { ipcMain } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getTransactionCategorizer } from './transaction-categorizer';
import { getBalanceAlertManager, AlertType } from './balance-alerts';
import { getRecurringPaymentDetector, RecurringFrequency } from './recurring-detector';
import { getSpendingPredictor } from './spending-predictor';
import { getBudgetManager, BudgetPeriod } from './budget-manager';
import { getPaymentScheduler, ScheduleFrequency } from './payment-scheduler';
import { getTransactionSearchEngine, TransactionSearchFilter, ExportFormat } from './transaction-search';
import { getDirectDebitManager } from './direct-debits';
import { getPayeeValidator } from './payee-validator';
import { getAccountManager } from './account-manager';

const logger = createModuleLogger('BankingEnhancedIPC');

/**
 * Register enhanced banking IPC handlers
 */
export function registerEnhancedBankingHandlers(): void {
  logger.info('Registering enhanced banking IPC handlers');

  // =========================================================================
  // Transaction Categorization Handlers
  // =========================================================================

  ipcMain.handle('banking:categorize-transaction', async (_event, txId: string, description: string, merchantName?: string) => {
    try {
      const categorizer = getTransactionCategorizer();
      const category = categorizer.categorize({ id: txId, description, merchantName } as any);
      return { success: true, data: category };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to categorize transaction', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:correct-category', async (_event, merchantPattern: string, correctCategory: string) => {
    try {
      const categorizer = getTransactionCategorizer();
      categorizer.correct(merchantPattern, correctCategory);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to correct category', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:suggest-categories', async (_event, description: string) => {
    try {
      const categorizer = getTransactionCategorizer();
      const suggestions = categorizer.suggest(description);
      return { success: true, data: suggestions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to suggest categories', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-categorizer-stats', async () => {
    try {
      const categorizer = getTransactionCategorizer();
      const stats = categorizer.getStats();
      return { success: true, data: stats };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get categorizer stats', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Balance Alert Handlers
  // =========================================================================

  ipcMain.handle('banking:create-alert-config', async (_event, accountId: string, type: AlertType, threshold?: number) => {
    try {
      const alertManager = getBalanceAlertManager();
      const config = alertManager.createConfig(accountId, type, threshold);
      return { success: true, data: config };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create alert config', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-alert-configs', async (_event, accountId?: string) => {
    try {
      const alertManager = getBalanceAlertManager();
      const configs = alertManager.getConfigs(accountId);
      return { success: true, data: configs };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get alert configs', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-active-alerts', async () => {
    try {
      const alertManager = getBalanceAlertManager();
      const alerts = alertManager.getActiveAlerts();
      return { success: true, data: alerts };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get active alerts', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:acknowledge-alert', async (_event, alertId: string) => {
    try {
      const alertManager = getBalanceAlertManager();
      const result = alertManager.acknowledgeAlert(alertId);
      return { success: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to acknowledge alert', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:set-alert-thresholds', async (_event, thresholds: { lowBalance?: number; largeWithdrawal?: number; overdraftBuffer?: number }) => {
    try {
      const alertManager = getBalanceAlertManager();
      alertManager.setThresholds(thresholds);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to set alert thresholds', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-alert-stats', async () => {
    try {
      const alertManager = getBalanceAlertManager();
      const stats = alertManager.getStats();
      return { success: true, data: stats };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get alert stats', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Recurring Payment Detection Handlers
  // =========================================================================

  ipcMain.handle('banking:analyze-recurring', async () => {
    try {
      const detector = getRecurringPaymentDetector();
      const accountManager = getAccountManager();
      const transactions = await accountManager.getTransactions({ limit: 500 });
      const result = detector.analyzeTransactions(transactions);
      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to analyze recurring payments', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-recurring-payments', async (_event, options?: { activeOnly?: boolean; subscriptionsOnly?: boolean; frequency?: RecurringFrequency }) => {
    try {
      const detector = getRecurringPaymentDetector();
      const payments = detector.getRecurringPayments(options);
      return { success: true, data: payments };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get recurring payments', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-monthly-recurring-total', async () => {
    try {
      const detector = getRecurringPaymentDetector();
      const total = detector.getMonthlyTotal();
      return { success: true, data: total };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get monthly recurring total', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-upcoming-recurring', async (_event, days: number = 30) => {
    try {
      const detector = getRecurringPaymentDetector();
      const upcoming = detector.getUpcoming(days);
      return { success: true, data: upcoming };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get upcoming recurring', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-price-change-alerts', async (_event, unacknowledgedOnly: boolean = false) => {
    try {
      const detector = getRecurringPaymentDetector();
      const alerts = detector.getPriceAlerts(unacknowledgedOnly);
      return { success: true, data: alerts };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get price change alerts', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Spending Prediction Handlers
  // =========================================================================

  ipcMain.handle('banking:learn-spending-patterns', async () => {
    try {
      const predictor = getSpendingPredictor();
      const accountManager = getAccountManager();
      const categorizer = getTransactionCategorizer();
      
      const transactions = await accountManager.getTransactions({ limit: 1000 });
      predictor.learnFromTransactions(transactions, (tx) => categorizer.categorize(tx));
      
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to learn spending patterns', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:predict-spending', async (_event, currentBalance: number, upcomingRecurring?: Array<{ amount: number; date: number }>) => {
    try {
      const predictor = getSpendingPredictor();
      const prediction = predictor.predict(currentBalance, upcomingRecurring);
      return { success: true, data: prediction };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to predict spending', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-spending-trend', async () => {
    try {
      const predictor = getSpendingPredictor();
      const trend = predictor.getSpendingTrend();
      return { success: true, data: trend };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get spending trend', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-day-patterns', async () => {
    try {
      const predictor = getSpendingPredictor();
      const patterns = predictor.getDayOfWeekPatterns();
      return { success: true, data: patterns };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get day patterns', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Budget Management Handlers
  // =========================================================================

  ipcMain.handle('banking:create-budget', async (_event, options: { name: string; category: string; amount: number; period?: BudgetPeriod; rollover?: boolean }) => {
    try {
      const budgetManager = getBudgetManager();
      const budget = budgetManager.createBudget(options);
      return { success: true, data: budget };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create budget', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-budgets', async (_event, options?: { activeOnly?: boolean; category?: string; period?: BudgetPeriod }) => {
    try {
      const budgetManager = getBudgetManager();
      const budgets = budgetManager.getBudgets(options);
      return { success: true, data: budgets };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budgets', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:update-budget', async (_event, id: string, updates: any) => {
    try {
      const budgetManager = getBudgetManager();
      const budget = budgetManager.updateBudget(id, updates);
      return { success: !!budget, data: budget };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update budget', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:delete-budget', async (_event, id: string) => {
    try {
      const budgetManager = getBudgetManager();
      const result = budgetManager.deleteBudget(id);
      return { success: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete budget', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-budget-summary', async () => {
    try {
      const budgetManager = getBudgetManager();
      const summary = budgetManager.getSummary();
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budget summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:process-budget-transactions', async () => {
    try {
      const budgetManager = getBudgetManager();
      const accountManager = getAccountManager();
      const categorizer = getTransactionCategorizer();
      
      const transactions = await accountManager.getTransactions({ limit: 500 });
      const alerts = budgetManager.processTransactions(transactions, (tx) => categorizer.categorize(tx));
      
      return { success: true, data: { alerts } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to process budget transactions', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-budget-alerts', async () => {
    try {
      const budgetManager = getBudgetManager();
      const alerts = budgetManager.getActiveAlerts();
      return { success: true, data: alerts };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get budget alerts', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Payment Scheduling Handlers
  // =========================================================================

  ipcMain.handle('banking:schedule-payment', async (_event, options: {
    recipientName: string;
    recipientSortCode: string;
    recipientAccountNumber: string;
    amount: number;
    reference: string;
    frequency: ScheduleFrequency;
    firstPaymentDate: number;
    endDate?: number;
    totalPayments?: number;
    reminderDays?: number;
  }) => {
    try {
      const scheduler = getPaymentScheduler();
      const schedule = scheduler.schedulePayment({
        ...options,
        firstPaymentDate: new Date(options.firstPaymentDate),
        endDate: options.endDate ? new Date(options.endDate) : undefined,
      });
      return { success: true, data: schedule };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to schedule payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-scheduled-payments', async (_event, options?: { status?: string; frequency?: ScheduleFrequency; upcoming?: boolean }) => {
    try {
      const scheduler = getPaymentScheduler();
      const schedules = scheduler.getSchedules(options as any);
      return { success: true, data: schedules };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get scheduled payments', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:cancel-scheduled-payment', async (_event, id: string) => {
    try {
      const scheduler = getPaymentScheduler();
      const result = scheduler.cancelSchedule(id);
      return { success: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to cancel scheduled payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-payment-reminders', async () => {
    try {
      const scheduler = getPaymentScheduler();
      const reminders = scheduler.getPendingReminders();
      return { success: true, data: reminders };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get payment reminders', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-scheduler-summary', async () => {
    try {
      const scheduler = getPaymentScheduler();
      const summary = scheduler.getSummary();
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get scheduler summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Transaction Search & Export Handlers
  // =========================================================================

  ipcMain.handle('banking:search-transactions', async (_event, filter: TransactionSearchFilter) => {
    try {
      const searchEngine = getTransactionSearchEngine();
      const accountManager = getAccountManager();
      const transactions = await accountManager.getTransactions({ limit: 5000 });
      const result = searchEngine.search(transactions, filter);
      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to search transactions', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:export-transactions', async (_event, filter: TransactionSearchFilter, format: ExportFormat, filename?: string) => {
    try {
      const searchEngine = getTransactionSearchEngine();
      const accountManager = getAccountManager();
      const transactions = await accountManager.getTransactions({ limit: 5000 });
      const filtered = searchEngine.search(transactions, filter).transactions;
      
      let filePath: string;
      switch (format) {
        case 'csv':
          filePath = searchEngine.exportToCSV(filtered, filename);
          break;
        case 'json':
          filePath = searchEngine.exportToJSON(filtered, filename);
          break;
        case 'qif':
          filePath = searchEngine.exportToQIF(filtered, filename);
          break;
        case 'ofx':
          filePath = searchEngine.exportToOFX(filtered, {
            bankId: '000000',
            accountId: 'COMBINED',
            accountType: 'CHECKING',
          }, filename);
          break;
        default:
          throw new Error(`Unknown export format: ${format}`);
      }
      
      return { success: true, data: { filePath } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to export transactions', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-tax-summary', async (_event, taxYearStart: number, taxYearEnd: number) => {
    try {
      const searchEngine = getTransactionSearchEngine();
      const accountManager = getAccountManager();
      const transactions = await accountManager.getTransactions({ limit: 10000 });
      const summary = searchEngine.generateTaxSummary(transactions, {
        start: new Date(taxYearStart),
        end: new Date(taxYearEnd),
      });
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get tax summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Direct Debit Handlers
  // =========================================================================

  ipcMain.handle('banking:detect-direct-debits', async () => {
    try {
      const ddManager = getDirectDebitManager();
      const accountManager = getAccountManager();
      const transactions = await accountManager.getTransactions({ limit: 1000 });
      const result = ddManager.detectFromTransactions(transactions);
      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to detect direct debits', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-direct-debits', async (_event, options?: { status?: string; accountId?: string }) => {
    try {
      const ddManager = getDirectDebitManager();
      const debits = ddManager.getDirectDebits(options as any);
      return { success: true, data: debits };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get direct debits', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-standing-orders', async (_event, options?: { status?: string; accountId?: string }) => {
    try {
      const ddManager = getDirectDebitManager();
      const orders = ddManager.getStandingOrders(options as any);
      return { success: true, data: orders };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get standing orders', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-upcoming-payments', async (_event, days: number = 30) => {
    try {
      const ddManager = getDirectDebitManager();
      const upcoming = ddManager.getUpcoming(days);
      return { success: true, data: upcoming };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get upcoming payments', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-monthly-committed', async () => {
    try {
      const ddManager = getDirectDebitManager();
      const committed = ddManager.getMonthlyCommitted();
      return { success: true, data: committed };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get monthly committed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:cancel-direct-debit', async (_event, id: string, reason?: string) => {
    try {
      const ddManager = getDirectDebitManager();
      const result = ddManager.cancelDirectDebit(id, reason);
      return { success: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to cancel direct debit', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Payee Validation Handlers
  // =========================================================================

  ipcMain.handle('banking:validate-payee', async (_event, name: string, sortCode: string, accountNumber: string) => {
    try {
      const validator = getPayeeValidator();
      const result = await validator.validatePayee(name, sortCode, accountNumber);
      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to validate payee', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:save-payee', async (_event, name: string, sortCode: string, accountNumber: string, nickname?: string) => {
    try {
      const validator = getPayeeValidator();
      const payee = validator.savePayee(name, sortCode, accountNumber, nickname);
      return { success: true, data: payee };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to save payee', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-saved-payees', async () => {
    try {
      const validator = getPayeeValidator();
      const payees = validator.getSavedPayees();
      return { success: true, data: payees };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get saved payees', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:search-payees', async (_event, query: string) => {
    try {
      const validator = getPayeeValidator();
      const payees = validator.searchPayees(query);
      return { success: true, data: payees };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to search payees', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:delete-payee', async (_event, id: string) => {
    try {
      const validator = getPayeeValidator();
      const result = validator.deletePayee(id);
      return { success: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete payee', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-bank-from-sort-code', async (_event, sortCode: string) => {
    try {
      const validator = getPayeeValidator();
      const result = validator.getBankFromSortCode(sortCode);
      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get bank from sort code', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('banking:get-frequent-payees', async (_event, limit: number = 5) => {
    try {
      const validator = getPayeeValidator();
      const payees = validator.getFrequentPayees(limit);
      return { success: true, data: payees };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get frequent payees', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  logger.info('Enhanced banking IPC handlers registered');
}

/**
 * Unregister enhanced banking IPC handlers
 */
export function unregisterEnhancedBankingHandlers(): void {
  logger.info('Unregistering enhanced banking IPC handlers');

  const channels = [
    // Categorization
    'banking:categorize-transaction',
    'banking:correct-category',
    'banking:suggest-categories',
    'banking:get-categorizer-stats',
    // Balance alerts
    'banking:create-alert-config',
    'banking:get-alert-configs',
    'banking:get-active-alerts',
    'banking:acknowledge-alert',
    'banking:set-alert-thresholds',
    'banking:get-alert-stats',
    // Recurring payments
    'banking:analyze-recurring',
    'banking:get-recurring-payments',
    'banking:get-monthly-recurring-total',
    'banking:get-upcoming-recurring',
    'banking:get-price-change-alerts',
    // Spending prediction
    'banking:learn-spending-patterns',
    'banking:predict-spending',
    'banking:get-spending-trend',
    'banking:get-day-patterns',
    // Budget management
    'banking:create-budget',
    'banking:get-budgets',
    'banking:update-budget',
    'banking:delete-budget',
    'banking:get-budget-summary',
    'banking:process-budget-transactions',
    'banking:get-budget-alerts',
    // Payment scheduling
    'banking:schedule-payment',
    'banking:get-scheduled-payments',
    'banking:cancel-scheduled-payment',
    'banking:get-payment-reminders',
    'banking:get-scheduler-summary',
    // Transaction search
    'banking:search-transactions',
    'banking:export-transactions',
    'banking:get-tax-summary',
    // Direct debits
    'banking:detect-direct-debits',
    'banking:get-direct-debits',
    'banking:get-standing-orders',
    'banking:get-upcoming-payments',
    'banking:get-monthly-committed',
    'banking:cancel-direct-debit',
    // Payee validation
    'banking:validate-payee',
    'banking:save-payee',
    'banking:get-saved-payees',
    'banking:search-payees',
    'banking:delete-payee',
    'banking:get-bank-from-sort-code',
    'banking:get-frequent-payees',
  ];

  for (const channel of channels) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler may not exist
    }
  }

  logger.info('Enhanced banking IPC handlers unregistered');
}
