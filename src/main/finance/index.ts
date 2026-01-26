/**
 * Atlas Finance Module
 *
 * Provides banking and finance functionality via Open Banking (TrueLayer).
 * Includes account management, transaction tracking, categorization,
 * budgeting, and spending analytics.
 *
 * @module finance
 */

// Types
export * from './types';

// TrueLayer client
export {
  TrueLayerClient,
  getTrueLayerClient,
  initializeTrueLayer,
  shutdownTrueLayer,
} from './truelayer';

// Transaction management
export {
  TransactionManager,
  getTransactionManager,
  categorizeByKeywords,
  extractMerchant,
} from './transactions';

// Budget management
export {
  BudgetManager,
  getBudgetManager,
  initializeBudgetManager,
  shutdownBudgetManager,
} from './budget';

// IPC handlers
export { registerFinanceIPC, unregisterFinanceIPC } from './ipc';

// Re-export commonly used types for convenience
export type {
  BankAccount,
  AccountBalance,
  Transaction,
  TransactionCategory,
  TransactionFilter,
  Budget,
  BudgetStatus,
  SpendingReport,
  SpendingInsight,
} from './types';
