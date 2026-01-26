/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas Finance - TrueLayer Client
 *
 * Wrapper for TrueLayer Open Banking API.
 * Handles OAuth flow, token management, and data retrieval.
 *
 * @module finance/truelayer
 */

import { shell } from 'electron';
import { EventEmitter } from 'events';
import { AuthAPIClient, DataAPIClient } from 'truelayer-client';
import type { IAccount, IBalance, ITransaction } from 'truelayer-client';

/**
 * Extended token response with expires_in (not in official types but returned by API)
 */
interface TrueLayerTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
import keytar from 'keytar';
import Decimal from 'decimal.js';
import { createModuleLogger } from '../utils/logger';
import { isoDate } from '../../shared/utils';
import {
  TrueLayerConfig,
  OAuthTokens,
  BankConnectionStatus,
  BankAccount,
  AccountBalance,
  Transaction,
  TransactionType,
  TransactionCategory,
  DirectDebit,
  StandingOrder,
  CreditCard,
  CreditCardBalance,
  FinanceResult,
} from './types';

const logger = createModuleLogger('TrueLayerClient');

/**
 * Service name for keytar storage
 */
const SERVICE_NAME = 'atlas-finance';
const TOKEN_ACCOUNT = 'truelayer-tokens';

/**
 * Default OAuth scopes for Open Banking
 */
const DEFAULT_SCOPES = [
  'info',
  'accounts',
  'balance',
  'transactions',
  'direct_debits',
  'standing_orders',
  'offline_access',
];

/**
 * Map TrueLayer transaction type to our type
 */
function mapTransactionType(trueLayerType: string): TransactionType {
  const typeMap: Record<string, TransactionType> = {
    CREDIT: 'credit',
    DEBIT: 'debit',
    TRANSFER: 'transfer',
    DIRECT_DEBIT: 'direct_debit',
    STANDING_ORDER: 'standing_order',
    ATM: 'atm',
    CARD_PAYMENT: 'card_payment',
    FEE: 'fee',
    INTEREST: 'interest',
    REFUND: 'refund',
  };
  return typeMap[trueLayerType?.toUpperCase()] || 'other';
}

/**
 * Simple transaction categorization based on description keywords
 * This can be enhanced with ML/LLM-based categorization later
 */
function categorizeTransaction(description: string, type: TransactionType): TransactionCategory {
  const desc = description.toLowerCase();

  // Income patterns
  if (desc.includes('salary') || desc.includes('wages') || desc.includes('payroll')) {
    return 'income';
  }

  // Transfers
  if (type === 'transfer' || desc.includes('transfer')) {
    return 'transfers';
  }

  // Groceries
  if (
    desc.includes('tesco') ||
    desc.includes('sainsbury') ||
    desc.includes('asda') ||
    desc.includes('morrisons') ||
    desc.includes('lidl') ||
    desc.includes('aldi') ||
    desc.includes('waitrose') ||
    desc.includes('co-op') ||
    desc.includes('grocery')
  ) {
    return 'groceries';
  }

  // Dining
  if (
    desc.includes('restaurant') ||
    desc.includes('cafe') ||
    desc.includes('coffee') ||
    desc.includes('mcdonald') ||
    desc.includes('burger') ||
    desc.includes('pizza') ||
    desc.includes('uber eats') ||
    desc.includes('deliveroo') ||
    desc.includes('just eat')
  ) {
    return 'dining';
  }

  // Transport
  if (
    desc.includes('uber') ||
    desc.includes('taxi') ||
    desc.includes('train') ||
    desc.includes('bus') ||
    desc.includes('tube') ||
    desc.includes('tfl') ||
    desc.includes('petrol') ||
    desc.includes('fuel') ||
    desc.includes('parking')
  ) {
    return 'transport';
  }

  // Utilities
  if (
    desc.includes('electric') ||
    desc.includes('gas') ||
    desc.includes('water') ||
    desc.includes('council tax') ||
    desc.includes('bt') ||
    desc.includes('virgin media') ||
    desc.includes('sky') ||
    desc.includes('broadband')
  ) {
    return 'utilities';
  }

  // Entertainment
  if (
    desc.includes('netflix') ||
    desc.includes('spotify') ||
    desc.includes('disney') ||
    desc.includes('cinema') ||
    desc.includes('amazon prime') ||
    desc.includes('apple music')
  ) {
    return 'entertainment';
  }

  // Subscriptions
  if (desc.includes('subscription') || desc.includes('monthly') || desc.includes('membership')) {
    return 'subscriptions';
  }

  // Shopping
  if (
    desc.includes('amazon') ||
    desc.includes('ebay') ||
    desc.includes('argos') ||
    desc.includes('john lewis') ||
    desc.includes('next') ||
    desc.includes('asos')
  ) {
    return 'shopping';
  }

  // Health
  if (
    desc.includes('pharmacy') ||
    desc.includes('doctor') ||
    desc.includes('hospital') ||
    desc.includes('dentist') ||
    desc.includes('optician') ||
    desc.includes('boots')
  ) {
    return 'health';
  }

  // Rent
  if (desc.includes('rent') || desc.includes('letting')) {
    return 'rent';
  }

  // Fees
  if (type === 'fee' || desc.includes('fee') || desc.includes('charge')) {
    return 'fees';
  }

  // Cash
  if (type === 'atm' || desc.includes('atm') || desc.includes('cash')) {
    return 'cash';
  }

  return 'other';
}

/**
 * TrueLayer Open Banking Client
 *
 * Handles authentication and data retrieval from UK banks via TrueLayer.
 */
export class TrueLayerClient extends EventEmitter {
  private config: TrueLayerConfig;
  private authClient: AuthAPIClient;
  private tokens: OAuthTokens | null = null;
  private status: BankConnectionStatus = 'disconnected';
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(config: TrueLayerConfig) {
    super();
    this.config = config;

    // Initialize auth client
    this.authClient = new AuthAPIClient({
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    logger.info('TrueLayer client initialized', { sandbox: config.sandbox });
  }

  /**
   * Get current connection status
   */
  getStatus(): BankConnectionStatus {
    return this.status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: BankConnectionStatus): void {
    this.status = status;
    this.emit('connection:status', status);
    logger.debug('Connection status changed', { status });
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state?: string): string {
    const authUrl = this.authClient.getAuthUrl({
      redirectURI: this.config.redirectUri,
      scope: DEFAULT_SCOPES,
      nonce: Math.random().toString(36).substring(7),
      state: state || 'atlas',
      enableMock: this.config.sandbox,
      enableCredentialsSharing: false,
      enableOauth: true,
    });

    logger.debug('Generated auth URL');
    return authUrl;
  }

  /**
   * Start OAuth authorization flow
   * Opens browser for user to authorize with their bank
   */
  async authorize(): Promise<void> {
    try {
      this.setStatus('connecting');

      const authUrl = this.getAuthUrl();

      // Open browser for OAuth
      await shell.openExternal(authUrl);

      logger.info('Opened browser for OAuth authorization');

      // The actual token exchange happens when the user is redirected back
      // and the app receives the authorization code via deep link or local server
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to start authorization', { error: err.message });
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   * Called after user completes OAuth flow and is redirected back
   */
  async exchangeCode(code: string): Promise<void> {
    try {
      this.setStatus('connecting');

      const tokenResponse = (await this.authClient.exchangeCodeForToken(
        this.config.redirectUri,
        code
      )) as unknown as TrueLayerTokenResponse;

      // Store tokens (expires_in defaults to 1 hour if not provided)
      const expiresIn = tokenResponse.expires_in || 3600;
      this.tokens = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + expiresIn * 1000,
        scopes: DEFAULT_SCOPES,
      };

      // Persist tokens securely
      await this.saveTokens();

      // Schedule token refresh
      this.scheduleTokenRefresh();

      this.setStatus('connected');
      logger.info('Successfully exchanged code for tokens');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to exchange code for tokens', { error: err.message });
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      logger.debug('Refreshing access token');

      const tokenResponse = (await this.authClient.refreshAccessToken(
        this.tokens.refreshToken
      )) as unknown as TrueLayerTokenResponse;

      const expiresIn = tokenResponse.expires_in || 3600;
      this.tokens = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + expiresIn * 1000,
        scopes: this.tokens.scopes,
      };

      await this.saveTokens();
      this.scheduleTokenRefresh();

      this.setStatus('connected');
      logger.info('Access token refreshed');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to refresh token', { error: err.message });
      this.setStatus('expired');
      throw error;
    }
  }

  /**
   * Schedule automatic token refresh before expiry
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.tokens?.expiresAt) return;

    // Refresh 5 minutes before expiry
    const refreshIn = Math.max(0, this.tokens.expiresAt - Date.now() - 5 * 60 * 1000);

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshToken();
      } catch (error) {
        logger.error('Auto token refresh failed', { error: (error as Error).message });
      }
    }, refreshIn);

    logger.debug('Token refresh scheduled', { refreshIn: Math.round(refreshIn / 1000) });
  }

  /**
   * Save tokens to secure storage
   */
  private async saveTokens(): Promise<void> {
    if (!this.tokens) return;

    try {
      await keytar.setPassword(SERVICE_NAME, TOKEN_ACCOUNT, JSON.stringify(this.tokens));
      logger.debug('Tokens saved to keychain');
    } catch (error) {
      logger.error('Failed to save tokens', { error: (error as Error).message });
    }
  }

  /**
   * Load tokens from secure storage
   */
  async loadTokens(): Promise<boolean> {
    try {
      const tokensJson = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);

      if (!tokensJson) {
        logger.debug('No stored tokens found');
        return false;
      }

      this.tokens = JSON.parse(tokensJson);

      // Check if tokens are expired
      if (this.tokens && this.tokens.expiresAt < Date.now()) {
        logger.info('Stored tokens expired, attempting refresh');
        await this.refreshToken();
      } else if (this.tokens) {
        this.setStatus('connected');
        this.scheduleTokenRefresh();
      }

      logger.info('Loaded tokens from keychain');
      return true;
    } catch (error) {
      logger.error('Failed to load tokens', { error: (error as Error).message });
      this.setStatus('expired');
      return false;
    }
  }

  /**
   * Disconnect and clear tokens
   */
  async disconnect(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.tokens = null;

    try {
      await keytar.deletePassword(SERVICE_NAME, TOKEN_ACCOUNT);
    } catch (error) {
      logger.warn('Failed to delete tokens from keychain', { error: (error as Error).message });
    }

    this.setStatus('disconnected');
    logger.info('Disconnected from TrueLayer');
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureAuthenticated(): Promise<string> {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated. Please connect your bank account first.');
    }

    // Check if token is expired
    if (this.tokens.expiresAt < Date.now()) {
      await this.refreshToken();
    }

    return this.tokens.accessToken;
  }

  /**
   * Validate the current access token
   */
  isTokenValid(): boolean {
    if (!this.tokens?.accessToken) return false;
    return DataAPIClient.validateToken(this.tokens.accessToken);
  }

  // ===========================================================================
  // Account Methods
  // ===========================================================================

  /**
   * Get all connected bank accounts
   */
  async getAccounts(): Promise<FinanceResult<BankAccount[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getAccounts(accessToken);

      if (!response.results) {
        return { success: true, data: [] };
      }

      const accounts: BankAccount[] = response.results.map((acc: IAccount) => ({
        id: acc.account_id,
        type: (acc.account_type as any) || 'other',
        currency: acc.currency,
        displayName: acc.display_name || acc.description || 'Account',
        description: acc.description,
        accountNumber: acc.account_number
          ? {
              iban: acc.account_number.iban,
              sortCode: acc.account_number.sort_code,
              number: acc.account_number.number,
              swiftBic: acc.account_number.swift_bic,
            }
          : undefined,
        provider: {
          id: acc.provider.provider_id,
          name: acc.provider.display_name,
          logoUrl: acc.provider.logo_uri,
        },
        updatedAt: acc.update_timestamp,
      }));

      logger.debug('Retrieved accounts', { count: accounts.length });
      return { success: true, data: accounts };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get accounts', { error: err.message });
      return {
        success: false,
        error: {
          code: 'ACCOUNTS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get balance for a specific account
   */
  async getBalance(accountId: string): Promise<FinanceResult<AccountBalance>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getBalance(accessToken, accountId);

      if (!response.results || response.results.length === 0) {
        return {
          success: false,
          error: {
            code: 'BALANCE_NOT_FOUND',
            message: 'No balance data found for this account',
          },
        };
      }

      const bal: IBalance = response.results[0];
      const balance: AccountBalance = {
        accountId,
        current: new Decimal(bal.current),
        available: new Decimal(bal.available),
        currency: bal.currency,
        updatedAt: bal.update_timestamp,
      };

      logger.debug('Retrieved balance', { accountId, current: bal.current });
      return { success: true, data: balance };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get balance', { accountId, error: err.message });
      return {
        success: false,
        error: {
          code: 'BALANCE_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get balances for all accounts
   */
  async getAllBalances(): Promise<FinanceResult<AccountBalance[]>> {
    try {
      const accountsResult = await this.getAccounts();

      if (!accountsResult.success || !accountsResult.data) {
        return {
          success: false,
          error: accountsResult.error,
        };
      }

      const balances: AccountBalance[] = [];

      for (const account of accountsResult.data) {
        const balanceResult = await this.getBalance(account.id);
        if (balanceResult.success && balanceResult.data) {
          balances.push(balanceResult.data);
        }
      }

      return { success: true, data: balances };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          code: 'BALANCES_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  // ===========================================================================
  // Transaction Methods
  // ===========================================================================

  /**
   * Get transactions for an account
   */
  async getTransactions(
    accountId: string,
    from?: string,
    to?: string
  ): Promise<FinanceResult<Transaction[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      // Default to last 30 days if no date range specified
      const toDate = to || isoDate();
      const fromDate =
        from || isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

      const response = await DataAPIClient.getTransactions(
        accessToken,
        accountId,
        fromDate,
        toDate
      );

      if (!response.results) {
        return { success: true, data: [] };
      }

      const transactions: Transaction[] = response.results.map((tx: ITransaction) => {
        const type = mapTransactionType(tx.transaction_type);
        return {
          id: tx.transaction_id,
          accountId,
          amount: new Decimal(tx.amount),
          currency: tx.currency,
          description: tx.description,
          type,
          category: categorizeTransaction(tx.description, type),
          timestamp: tx.timestamp,
          pending: false,
          meta: tx.meta as Record<string, unknown> | undefined,
        };
      });

      logger.debug('Retrieved transactions', { accountId, count: transactions.length });
      return { success: true, data: transactions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get transactions', { accountId, error: err.message });
      return {
        success: false,
        error: {
          code: 'TRANSACTIONS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get pending transactions for an account
   */
  async getPendingTransactions(accountId: string): Promise<FinanceResult<Transaction[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getPendingTransactions(accessToken, accountId);

      if (!response.results) {
        return { success: true, data: [] };
      }

      const transactions: Transaction[] = response.results.map((tx: ITransaction) => {
        const type = mapTransactionType(tx.transaction_type);
        return {
          id: tx.transaction_id,
          accountId,
          amount: new Decimal(tx.amount),
          currency: tx.currency,
          description: tx.description,
          type,
          category: categorizeTransaction(tx.description, type),
          timestamp: tx.timestamp,
          pending: true,
          meta: tx.meta as Record<string, unknown> | undefined,
        };
      });

      logger.debug('Retrieved pending transactions', { accountId, count: transactions.length });
      return { success: true, data: transactions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get pending transactions', { accountId, error: err.message });
      return {
        success: false,
        error: {
          code: 'PENDING_TRANSACTIONS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get all transactions from all accounts
   */
  async getAllTransactions(from?: string, to?: string): Promise<FinanceResult<Transaction[]>> {
    try {
      const accountsResult = await this.getAccounts();

      if (!accountsResult.success || !accountsResult.data) {
        return {
          success: false,
          error: accountsResult.error,
        };
      }

      const allTransactions: Transaction[] = [];

      for (const account of accountsResult.data) {
        const txResult = await this.getTransactions(account.id, from, to);
        if (txResult.success && txResult.data) {
          allTransactions.push(...txResult.data);
        }
      }

      // Sort by timestamp descending
      allTransactions.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return { success: true, data: allTransactions };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          code: 'ALL_TRANSACTIONS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  // ===========================================================================
  // Direct Debits & Standing Orders
  // ===========================================================================

  /**
   * Get direct debits for an account
   */
  async getDirectDebits(accountId: string): Promise<FinanceResult<DirectDebit[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getDirectDebits(accessToken, accountId);

      if (!response.results) {
        return { success: true, data: [] };
      }

      const directDebits: DirectDebit[] = response.results.map((dd: any) => ({
        id: dd.direct_debit_id || dd.mandate_id || crypto.randomUUID(),
        accountId,
        name: dd.name,
        reference: dd.reference,
        status: dd.status?.toLowerCase() || 'active',
        previousPaymentDate: dd.previous_payment_timestamp,
        previousPaymentAmount: dd.previous_payment_amount
          ? new Decimal(dd.previous_payment_amount)
          : undefined,
        currency: dd.currency || 'GBP',
      }));

      logger.debug('Retrieved direct debits', { accountId, count: directDebits.length });
      return { success: true, data: directDebits };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get direct debits', { accountId, error: err.message });
      return {
        success: false,
        error: {
          code: 'DIRECT_DEBITS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get standing orders for an account
   */
  async getStandingOrders(accountId: string): Promise<FinanceResult<StandingOrder[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getStandingOrders(accessToken, accountId);

      if (!response.results) {
        return { success: true, data: [] };
      }

      const standingOrders: StandingOrder[] = response.results.map((so: any) => ({
        id: so.standing_order_id || crypto.randomUUID(),
        accountId,
        payee: so.payee || so.reference || 'Unknown',
        reference: so.reference,
        amount: new Decimal(so.amount || 0),
        currency: so.currency || 'GBP',
        frequency: so.frequency || 'monthly',
        nextPaymentDate: so.next_payment_timestamp,
        status: so.status?.toLowerCase() || 'active',
      }));

      logger.debug('Retrieved standing orders', { accountId, count: standingOrders.length });
      return { success: true, data: standingOrders };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get standing orders', { accountId, error: err.message });
      return {
        success: false,
        error: {
          code: 'STANDING_ORDERS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  // ===========================================================================
  // Credit Card Methods
  // ===========================================================================

  /**
   * Get all credit cards
   */
  async getCards(): Promise<FinanceResult<CreditCard[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getCards(accessToken);

      if (!response.results) {
        return { success: true, data: [] };
      }

      const cards: CreditCard[] = response.results.map((card: any) => ({
        id: card.account_id,
        displayName: card.display_name || card.card_type || 'Credit Card',
        cardType: card.card_type || 'unknown',
        currency: card.currency,
        provider: {
          id: card.provider?.provider_id || 'unknown',
          name: card.provider?.display_name || 'Unknown Provider',
          logoUrl: card.provider?.logo_uri,
        },
        updatedAt: card.update_timestamp,
      }));

      logger.debug('Retrieved credit cards', { count: cards.length });
      return { success: true, data: cards };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get credit cards', { error: err.message });
      return {
        success: false,
        error: {
          code: 'CARDS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get credit card balance
   */
  async getCardBalance(cardId: string): Promise<FinanceResult<CreditCardBalance>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const response = await DataAPIClient.getCardBalance(accessToken, cardId);

      if (!response.results || response.results.length === 0) {
        return {
          success: false,
          error: {
            code: 'CARD_BALANCE_NOT_FOUND',
            message: 'No balance data found for this card',
          },
        };
      }

      const bal = response.results[0];
      const balance: CreditCardBalance = {
        cardId,
        current: new Decimal(bal.current || 0),
        available: new Decimal(bal.available || 0),
        creditLimit: new Decimal(bal.credit_limit || 0),
        currency: bal.currency,
        lastStatementBalance: bal.last_statement_balance
          ? new Decimal(bal.last_statement_balance)
          : undefined,
        lastStatementDate: bal.last_statement_date,
        paymentDueDate: bal.payment_due_date,
        minimumPayment: bal.payment_due ? new Decimal(bal.payment_due) : undefined,
        updatedAt: bal.update_timestamp,
      };

      logger.debug('Retrieved card balance', { cardId, current: bal.current });
      return { success: true, data: balance };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get card balance', { cardId, error: err.message });
      return {
        success: false,
        error: {
          code: 'CARD_BALANCE_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Get credit card transactions
   */
  async getCardTransactions(
    cardId: string,
    from?: string,
    to?: string
  ): Promise<FinanceResult<Transaction[]>> {
    try {
      const accessToken = await this.ensureAuthenticated();

      const toDate = to || isoDate();
      const fromDate =
        from || isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

      const response = await DataAPIClient.getCardTransactions(
        accessToken,
        cardId,
        fromDate,
        toDate
      );

      if (!response.results) {
        return { success: true, data: [] };
      }

      const transactions: Transaction[] = response.results.map((tx: any) => {
        const type = mapTransactionType(tx.transaction_type);
        return {
          id: tx.transaction_id,
          accountId: cardId,
          amount: new Decimal(tx.amount),
          currency: tx.currency,
          description: tx.description,
          type,
          category: categorizeTransaction(tx.description, type),
          timestamp: tx.timestamp,
          pending: false,
          meta: tx.meta,
        };
      });

      logger.debug('Retrieved card transactions', { cardId, count: transactions.length });
      return { success: true, data: transactions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get card transactions', { cardId, error: err.message });
      return {
        success: false,
        error: {
          code: 'CARD_TRANSACTIONS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  // ===========================================================================
  // Provider Information
  // ===========================================================================

  /**
   * Get list of supported banks/providers
   */
  static async getSupportedProviders(): Promise<FinanceResult<any[]>> {
    try {
      const providers = await AuthAPIClient.getProviderInfos('oauth/openbanking');
      return { success: true, data: providers };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get providers', { error: err.message });
      return {
        success: false,
        error: {
          code: 'PROVIDERS_FETCH_FAILED',
          message: err.message,
        },
      };
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.removeAllListeners();
    logger.info('TrueLayer client destroyed');
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let trueLayerInstance: TrueLayerClient | null = null;

/**
 * Get or create the singleton TrueLayer client
 */
export function getTrueLayerClient(config?: TrueLayerConfig): TrueLayerClient {
  if (!trueLayerInstance) {
    if (!config) {
      // Try to load from environment
      const clientId = process.env.TRUELAYER_CLIENT_ID;
      const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error(
          'TrueLayer credentials not configured. Set TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET.'
        );
      }

      config = {
        clientId,
        clientSecret,
        redirectUri: process.env.TRUELAYER_REDIRECT_URI || 'atlas://truelayer/callback',
        sandbox: process.env.TRUELAYER_SANDBOX === 'true',
      };
    }

    trueLayerInstance = new TrueLayerClient(config);
  }

  return trueLayerInstance;
}

/**
 * Initialize TrueLayer client and load saved tokens
 */
export async function initializeTrueLayer(config?: TrueLayerConfig): Promise<TrueLayerClient> {
  const client = getTrueLayerClient(config);
  await client.loadTokens();
  return client;
}

/**
 * Shutdown TrueLayer client
 */
export function shutdownTrueLayer(): void {
  if (trueLayerInstance) {
    trueLayerInstance.destroy();
    trueLayerInstance = null;
  }
}

export default TrueLayerClient;
