/**
 * Atlas Banking - Type Definitions
 *
 * Core types for banking integration including accounts,
 * transactions, and payment operations.
 *
 * @module banking/types
 */

// =============================================================================
// Account Types
// =============================================================================

/**
 * Supported bank connection providers
 */
export type BankingProvider = 'plaid' | 'manual';

/**
 * Account types
 */
export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'mortgage'
  | 'other';

/**
 * Account subtype for more specific categorization
 */
export type AccountSubtype =
  | 'checking'
  | 'savings'
  | 'money_market'
  | 'cd'
  | 'credit_card'
  | 'paypal'
  | 'student'
  | 'mortgage'
  | 'auto'
  | 'personal'
  | '401k'
  | 'ira'
  | 'brokerage'
  | 'other';

/**
 * Connected bank institution
 */
export interface BankInstitution {
  /** Unique institution ID */
  id: string;
  /** Institution name (e.g., "Chase", "Bank of America") */
  name: string;
  /** Institution logo URL */
  logo?: string;
  /** Primary color for branding */
  primaryColor?: string;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  /** Last successful sync */
  lastSync?: Date;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Bank account information
 */
export interface BankAccount {
  /** Unique account ID */
  id: string;
  /** Institution this account belongs to */
  institutionId: string;
  /** Account name/label */
  name: string;
  /** Official account name from bank */
  officialName?: string;
  /** Account type */
  type: AccountType;
  /** Account subtype */
  subtype?: AccountSubtype;
  /** Last 4 digits of account number */
  mask?: string;
  /** Current balance */
  currentBalance: number;
  /** Available balance */
  availableBalance?: number;
  /** Credit limit (for credit accounts) */
  creditLimit?: number;
  /** ISO currency code */
  currency: string;
  /** Whether this is a primary account for payments */
  isPrimary: boolean;
  /** Custom nickname set by user */
  nickname?: string;
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction category
 */
export interface TransactionCategory {
  primary: string;
  detailed?: string;
  confidence?: number;
}

/**
 * Payment channel
 */
export type PaymentChannel = 'online' | 'in_store' | 'atm' | 'other';

/**
 * Transaction status
 */
export type TransactionStatus = 'pending' | 'posted' | 'cancelled';

/**
 * Bank transaction
 */
export interface BankTransaction {
  /** Unique transaction ID */
  id: string;
  /** Account ID this transaction belongs to */
  accountId: string;
  /** Transaction amount (negative for debits) */
  amount: number;
  /** ISO currency code */
  currency: string;
  /** Transaction date */
  date: Date;
  /** Authorization date */
  authorizedDate?: Date;
  /** Merchant/payee name */
  name: string;
  /** Clean merchant name */
  merchantName?: string;
  /** Transaction category */
  category?: TransactionCategory;
  /** Payment channel */
  paymentChannel?: PaymentChannel;
  /** Transaction status */
  status: TransactionStatus;
  /** Whether this is a recurring transaction */
  isRecurring?: boolean;
  /** Location information */
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
  /** Personal memo/note */
  memo?: string;
}

// =============================================================================
// Payment Types
// =============================================================================

/**
 * Payment request status
 */
export type PaymentStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Payment method
 */
export type PaymentMethod = 'ach' | 'wire' | 'card' | 'external';

/**
 * Payment recipient
 */
export interface PaymentRecipient {
  /** Recipient name */
  name: string;
  /** Recipient type */
  type: 'individual' | 'business';
  /** Bank routing number (for ACH) */
  routingNumber?: string;
  /** Bank account number (for ACH) */
  accountNumber?: string;
  /** Email (for some payment services) */
  email?: string;
  /** Phone (for some payment services) */
  phone?: string;
  /** External payment ID (Venmo, PayPal, etc.) */
  externalId?: string;
  /** External service name */
  externalService?: string;
}

/**
 * Payment request
 */
export interface PaymentRequest {
  /** Unique payment ID */
  id: string;
  /** Source account ID */
  sourceAccountId: string;
  /** Recipient information */
  recipient: PaymentRecipient;
  /** Payment amount */
  amount: number;
  /** ISO currency code */
  currency: string;
  /** Payment method */
  method: PaymentMethod;
  /** Payment description/memo */
  description: string;
  /** Payment status */
  status: PaymentStatus;
  /** Scheduled date (null for immediate) */
  scheduledDate?: Date;
  /** Created timestamp */
  createdAt: Date;
  /** Last updated timestamp */
  updatedAt: Date;
  /** Confirmation code */
  confirmationCode?: string;
  /** Error message if failed */
  error?: string;
  /** Voice command that initiated this payment */
  voiceCommand?: string;
  /** Whether user has confirmed */
  userConfirmed: boolean;
}

// =============================================================================
// Security Types
// =============================================================================

/**
 * Spending limit configuration
 */
export interface SpendingLimit {
  /** Daily limit */
  daily: number;
  /** Weekly limit */
  weekly: number;
  /** Monthly limit */
  monthly: number;
  /** Per-transaction limit */
  perTransaction: number;
  /** Categories with special limits */
  categoryLimits?: Record<string, number>;
}

/**
 * Security settings for banking
 */
export interface BankingSecuritySettings {
  /** Require PIN/biometric for all transactions */
  requireAuthForTransactions: boolean;
  /** Require confirmation for transactions above this amount */
  confirmationThreshold: number;
  /** Block transactions to new recipients without manual approval */
  blockNewRecipients: boolean;
  /** Spending limits */
  spendingLimits: SpendingLimit;
  /** Allowed transaction categories (empty = all allowed) */
  allowedCategories: string[];
  /** Blocked merchants/recipients */
  blockedRecipients: string[];
  /** Enable fraud detection alerts */
  fraudAlerts: boolean;
  /** Require 2FA for large transactions */
  require2FAAbove?: number;
}

// =============================================================================
// Plaid Types
// =============================================================================

/**
 * Plaid Link token response
 */
export interface PlaidLinkToken {
  linkToken: string;
  expiration: string;
  requestId: string;
}

/**
 * Plaid public token exchange result
 */
export interface PlaidAccessToken {
  accessToken: string;
  itemId: string;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Generic banking API response
 */
export interface BankingResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

/**
 * Account balance response
 */
export interface BalanceResponse {
  accounts: BankAccount[];
  totalBalance: number;
  totalAvailable: number;
  totalDebt: number;
  netWorth: number;
}

/**
 * Transaction search options
 */
export interface TransactionSearchOptions {
  accountId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  category?: string;
  merchantName?: string;
  limit?: number;
  offset?: number;
}

/**
 * Spending summary by category
 */
export interface SpendingSummary {
  period: 'day' | 'week' | 'month' | 'year';
  startDate: Date;
  endDate: Date;
  totalSpent: number;
  totalIncome: number;
  netChange: number;
  byCategory: Record<string, number>;
  topMerchants: Array<{ name: string; amount: number; count: number }>;
}
