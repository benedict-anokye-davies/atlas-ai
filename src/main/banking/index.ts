/**
 * Atlas Banking - Module Exports
 *
 * Main entry point for the banking integration module.
 * Supports UK (TrueLayer), EU, and US (Plaid) banks.
 *
 * @module banking
 */

// Core exports
export * from './types';
export { PlaidClient, getPlaidClient } from './plaid-client';
export { TrueLayerClient, getTrueLayerClient } from './truelayer-client';
export {
  AccountManager,
  getAccountManager,
  initializeAccountManager,
} from './account-manager';
export {
  PaymentService,
  getPaymentService,
  CreatePaymentOptions,
} from './payment-service';
export {
  BankingSecurity,
  getBankingSecurity,
  initializeBankingSecurity,
  PaymentValidation,
} from './security';
export { registerBankingHandlers } from './ipc';

// Enhanced features
export {
  TransactionCategorizer,
  getTransactionCategorizer,
  CATEGORIES,
} from './transaction-categorizer';
export {
  BalanceAlertManager,
  getBalanceAlertManager,
  AlertType,
  AlertPriority,
  BalanceAlert,
  AlertConfig,
} from './balance-alerts';
export {
  RecurringPaymentDetector,
  getRecurringPaymentDetector,
  RecurringPayment,
  RecurringFrequency,
  PriceChangeAlert,
  MissedPaymentAlert,
} from './recurring-detector';
export {
  SpendingPredictor,
  getSpendingPredictor,
  SpendingPrediction,
} from './spending-predictor';
export {
  BudgetManager,
  getBudgetManager,
  Budget,
  BudgetPeriod,
  BudgetAlert,
  BudgetSummary,
} from './budget-manager';
export {
  PaymentScheduler,
  getPaymentScheduler,
  ScheduledPayment,
  ScheduleFrequency,
  PaymentReminder,
} from './payment-scheduler';
export {
  TransactionSearchEngine,
  getTransactionSearchEngine,
  TransactionSearchFilter,
  TransactionSearchResult,
  ExportFormat,
} from './transaction-search';
export {
  DirectDebitManager,
  getDirectDebitManager,
  DirectDebit,
  StandingOrder,
} from './direct-debits';
export {
  PayeeValidator,
  getPayeeValidator,
  SavedPayee,
  PayeeValidationResult,
  CoPMatchResult,
} from './payee-validator';

// Enhanced IPC handlers
export {
  registerEnhancedBankingHandlers,
  unregisterEnhancedBankingHandlers,
} from './enhanced-ipc';

import { createModuleLogger } from '../utils/logger';
import { initializeAccountManager } from './account-manager';
import { initializeBankingSecurity } from './security';
import { getPaymentService } from './payment-service';
import { registerBankingHandlers } from './ipc';
import { registerEnhancedBankingHandlers } from './enhanced-ipc';

const logger = createModuleLogger('Banking');

/**
 * Initialize the entire banking module
 */
export async function initializeBanking(): Promise<void> {
  logger.info('Initializing banking module...');

  try {
    // Initialize security first
    await initializeBankingSecurity();

    // Initialize account manager
    await initializeAccountManager();

    // Payment service is lazy-initialized
    getPaymentService();

    // Register IPC handlers
    registerBankingHandlers();
    
    // Register enhanced IPC handlers
    registerEnhancedBankingHandlers();

    logger.info('Banking module initialized successfully');
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to initialize banking module', { error: err.message });
    throw error;
  }
}
