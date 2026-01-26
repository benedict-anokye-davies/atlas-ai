/**
 * Atlas Finance - Type Definitions
 *
 * Core types for finance/banking infrastructure including accounts,
 * transactions, budgets, and spending analytics.
 *
 * @module finance/types
 */

import Decimal from 'decimal.js';

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Supported banking providers
 */
export type BankingProvider = 'truelayer';

/**
 * Connection status for banking provider
 */
export type BankConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

/**
 * OAuth token response from TrueLayer
 */
export interface OAuthTokens {
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for renewing access */
  refreshToken: string;
  /** Token expiry timestamp */
  expiresAt: number;
  /** Scopes granted */
  scopes: string[];
}

/**
 * TrueLayer configuration
 */
export interface TrueLayerConfig {
  /** TrueLayer client ID */
  clientId: string;
  /** TrueLayer client secret */
  clientSecret: string;
  /** OAuth redirect URI */
  redirectUri: string;
  /** Use sandbox environment */
  sandbox: boolean;
}

// =============================================================================
// Account Types
// =============================================================================

/**
 * Bank account type
 */
export type AccountType = 'current' | 'savings' | 'credit_card' | 'loan' | 'mortgage' | 'other';

/**
 * Bank account identifiers
 */
export interface AccountNumber {
  /** IBAN (International Bank Account Number) */
  iban?: string;
  /** UK sort code */
  sortCode?: string;
  /** Account number */
  number?: string;
  /** SWIFT/BIC code */
  swiftBic?: string;
}

/**
 * Bank provider information
 */
export interface BankProvider {
  /** Provider ID (e.g., 'tsb', 'barclays') */
  id: string;
  /** Display name */
  name: string;
  /** Logo URL */
  logoUrl?: string;
}

/**
 * Bank account
 */
export interface BankAccount {
  /** Unique account identifier */
  id: string;
  /** Account type */
  type: AccountType;
  /** Currency code (ISO 4217) */
  currency: string;
  /** Display name */
  displayName: string;
  /** Account description */
  description?: string;
  /** Account identifiers */
  accountNumber?: AccountNumber;
  /** Provider information */
  provider: BankProvider;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Account balance
 */
export interface AccountBalance {
  /** Account ID */
  accountId: string;
  /** Current balance */
  current: Decimal;
  /** Available balance */
  available: Decimal;
  /** Currency code */
  currency: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Aggregated balance across all accounts
 */
export interface AggregatedBalance {
  /** Total balance by currency */
  byCurrency: Record<
    string,
    {
      current: Decimal;
      available: Decimal;
    }
  >;
  /** Individual account balances */
  accounts: AccountBalance[];
  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction type
 */
export type TransactionType =
  | 'debit'
  | 'credit'
  | 'transfer'
  | 'direct_debit'
  | 'standing_order'
  | 'atm'
  | 'card_payment'
  | 'fee'
  | 'interest'
  | 'refund'
  | 'other';

/**
 * Transaction category (for budgeting)
 */
export type TransactionCategory =
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'utilities'
  | 'entertainment'
  | 'shopping'
  | 'health'
  | 'education'
  | 'travel'
  | 'subscriptions'
  | 'rent'
  | 'income'
  | 'transfers'
  | 'fees'
  | 'cash'
  | 'other';

/**
 * Bank transaction
 */
export interface Transaction {
  /** Unique transaction ID */
  id: string;
  /** Account ID this transaction belongs to */
  accountId: string;
  /** Transaction amount (positive = credit, negative = debit) */
  amount: Decimal;
  /** Currency code */
  currency: string;
  /** Transaction description from bank */
  description: string;
  /** Cleaned/normalized description */
  normalizedDescription?: string;
  /** Transaction type */
  type: TransactionType;
  /** Assigned category */
  category: TransactionCategory;
  /** Transaction timestamp */
  timestamp: string;
  /** Is this a pending transaction? */
  pending: boolean;
  /** Merchant name (if identified) */
  merchant?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

/**
 * Transaction query filters
 */
export interface TransactionFilter {
  /** Account ID(s) to filter by */
  accountIds?: string[];
  /** Start date (ISO 8601) */
  from?: string;
  /** End date (ISO 8601) */
  to?: string;
  /** Filter by category */
  categories?: TransactionCategory[];
  /** Filter by type */
  types?: TransactionType[];
  /** Min amount */
  minAmount?: number;
  /** Max amount */
  maxAmount?: number;
  /** Search description */
  search?: string;
  /** Include pending transactions */
  includePending?: boolean;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Direct Debit & Standing Order Types
// =============================================================================

/**
 * Direct debit mandate
 */
export interface DirectDebit {
  /** Unique ID */
  id: string;
  /** Account ID */
  accountId: string;
  /** Creditor name */
  name: string;
  /** Reference */
  reference?: string;
  /** Status */
  status: 'active' | 'inactive' | 'cancelled';
  /** Last payment date */
  previousPaymentDate?: string;
  /** Last payment amount */
  previousPaymentAmount?: Decimal;
  /** Currency */
  currency: string;
}

/**
 * Standing order
 */
export interface StandingOrder {
  /** Unique ID */
  id: string;
  /** Account ID */
  accountId: string;
  /** Payee name */
  payee: string;
  /** Reference */
  reference?: string;
  /** Amount */
  amount: Decimal;
  /** Currency */
  currency: string;
  /** Frequency (e.g., 'monthly', 'weekly') */
  frequency: string;
  /** Next payment date */
  nextPaymentDate?: string;
  /** Status */
  status: 'active' | 'inactive' | 'cancelled';
}

// =============================================================================
// Budget Types
// =============================================================================

/**
 * Budget period
 */
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Budget definition
 */
export interface Budget {
  /** Unique budget ID */
  id: string;
  /** Category this budget applies to */
  category: TransactionCategory;
  /** Budget amount */
  amount: Decimal;
  /** Currency */
  currency: string;
  /** Budget period */
  period: BudgetPeriod;
  /** Created timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
  /** Is budget active? */
  active: boolean;
  /** Alert threshold (0-1, e.g., 0.8 = alert at 80%) */
  alertThreshold?: number;
}

/**
 * Budget status for a specific period
 */
export interface BudgetStatus {
  /** Budget definition */
  budget: Budget;
  /** Period start date */
  periodStart: string;
  /** Period end date */
  periodEnd: string;
  /** Amount spent in this period */
  spent: Decimal;
  /** Amount remaining */
  remaining: Decimal;
  /** Percentage used (0-100+) */
  percentUsed: number;
  /** Is over budget? */
  overBudget: boolean;
  /** Days remaining in period */
  daysRemaining: number;
  /** Projected spend at current rate */
  projectedSpend?: Decimal;
}

// =============================================================================
// Spending Analytics Types
// =============================================================================

/**
 * Spending by category
 */
export interface CategorySpending {
  /** Category */
  category: TransactionCategory;
  /** Total amount spent */
  amount: Decimal;
  /** Currency */
  currency: string;
  /** Transaction count */
  transactionCount: number;
  /** Percentage of total spending */
  percentage: number;
  /** Average transaction amount */
  averageAmount: Decimal;
}

/**
 * Spending report
 */
export interface SpendingReport {
  /** Report period start */
  periodStart: string;
  /** Report period end */
  periodEnd: string;
  /** Total spending */
  totalSpent: Decimal;
  /** Total income */
  totalIncome: Decimal;
  /** Net (income - spending) */
  net: Decimal;
  /** Currency */
  currency: string;
  /** Spending by category */
  byCategory: CategorySpending[];
  /** Top merchants by spending */
  topMerchants: {
    merchant: string;
    amount: Decimal;
    transactionCount: number;
  }[];
  /** Daily spending breakdown */
  dailySpending?: {
    date: string;
    amount: Decimal;
  }[];
  /** Comparison to previous period */
  comparison?: {
    previousPeriodSpent: Decimal;
    change: Decimal;
    changePercent: number;
  };
}

/**
 * Spending insights
 */
export interface SpendingInsight {
  /** Insight type */
  type:
    | 'unusual_spending'
    | 'recurring_payment'
    | 'budget_warning'
    | 'saving_opportunity'
    | 'trend';
  /** Insight title */
  title: string;
  /** Detailed description */
  description: string;
  /** Related category (if applicable) */
  category?: TransactionCategory;
  /** Related amount */
  amount?: Decimal;
  /** Currency */
  currency?: string;
  /** Severity/importance (1-5) */
  importance: number;
  /** Generated timestamp */
  timestamp: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Finance event types for EventEmitter
 */
export type FinanceEventType =
  | 'connection:status'
  | 'accounts:updated'
  | 'balance:updated'
  | 'transactions:new'
  | 'budget:warning'
  | 'budget:exceeded'
  | 'insight:generated'
  | 'error';

/**
 * Finance event payload
 */
export interface FinanceEvent {
  type: FinanceEventType;
  timestamp: string;
  data: unknown;
}

// =============================================================================
// Card Types (Credit Cards via TrueLayer)
// =============================================================================

/**
 * Credit card account
 */
export interface CreditCard {
  /** Card account ID */
  id: string;
  /** Display name */
  displayName: string;
  /** Card type */
  cardType: string;
  /** Currency */
  currency: string;
  /** Provider */
  provider: BankProvider;
  /** Last update */
  updatedAt: string;
}

/**
 * Credit card balance
 */
export interface CreditCardBalance {
  /** Card ID */
  cardId: string;
  /** Current balance (amount owed) */
  current: Decimal;
  /** Available credit */
  available: Decimal;
  /** Credit limit */
  creditLimit: Decimal;
  /** Currency */
  currency: string;
  /** Last statement balance */
  lastStatementBalance?: Decimal;
  /** Last statement date */
  lastStatementDate?: string;
  /** Payment due date */
  paymentDueDate?: string;
  /** Minimum payment */
  minimumPayment?: Decimal;
  /** Last update */
  updatedAt: string;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Generic API result wrapper
 */
export interface FinanceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
