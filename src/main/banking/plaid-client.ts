/**
 * Atlas Banking - Plaid Client
 *
 * Integration with Plaid API for bank account connections,
 * balance retrieval, and transaction history.
 * 
 * Note: Plaid SDK is optional. TrueLayer is the primary provider for UK banks.
 * To enable Plaid: npm install plaid
 *
 * @module banking/plaid-client
 */

import { createModuleLogger } from '../utils/logger';
import {
  BankAccount,
  BankInstitution,
  BankTransaction,
  PlaidLinkToken,
  PlaidAccessToken,
  AccountType,
  AccountSubtype,
  TransactionCategory,
} from './types';

const logger = createModuleLogger('PlaidClient');

// Dynamic import types for Plaid SDK (optional dependency)
/* eslint-disable @typescript-eslint/no-explicit-any */
type PlaidConfig = any;
type PlaidApiType = any;
type PlaidEnv = any;
type PlaidProducts = any;
type PlaidCountryCode = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Try to load Plaid SDK
let PlaidModule: {
  Configuration: new (config: PlaidConfig) => PlaidConfig;
  PlaidApi: new (config: PlaidConfig) => PlaidApiType;
  PlaidEnvironments: PlaidEnv;
  Products: PlaidProducts;
  CountryCode: PlaidCountryCode;
} | null = null;

try {
  /* eslint-disable @typescript-eslint/no-var-requires */
  PlaidModule = require('plaid');
  /* eslint-enable @typescript-eslint/no-var-requires */
  logger.info('Plaid SDK loaded successfully');
} catch {
  logger.info('Plaid SDK not installed. Plaid integration disabled. Use TrueLayer for UK banks.');
}

/**
 * Map Plaid account type to our AccountType
 */
function mapAccountType(plaidType: string): AccountType {
  const typeMap: Record<string, AccountType> = {
    depository: 'checking',
    credit: 'credit',
    loan: 'loan',
    investment: 'investment',
    mortgage: 'mortgage',
  };
  return typeMap[plaidType] || 'other';
}

/**
 * Map Plaid account subtype to our AccountSubtype
 */
function mapAccountSubtype(plaidSubtype: string | null): AccountSubtype | undefined {
  if (!plaidSubtype) return undefined;
  const subtypeMap: Record<string, AccountSubtype> = {
    checking: 'checking',
    savings: 'savings',
    'money market': 'money_market',
    cd: 'cd',
    'credit card': 'credit_card',
    paypal: 'paypal',
    student: 'student',
    mortgage: 'mortgage',
    auto: 'auto',
    personal: 'personal',
    '401k': '401k',
    ira: 'ira',
    brokerage: 'brokerage',
  };
  return subtypeMap[plaidSubtype.toLowerCase()] || 'other';
}

/**
 * Plaid Client - Handles all Plaid API interactions
 */
export class PlaidClient {
  private client: PlaidApiType | null = null;
  private accessTokens: Map<string, string> = new Map(); // itemId -> accessToken
  private initialized = false;

  constructor() {
    this.initializeClient();
  }

  /**
   * Initialize the Plaid client with API credentials
   */
  private initializeClient(): void {
    if (!PlaidModule) {
      logger.warn('Plaid SDK not installed. Install with: npm install plaid');
      return;
    }

    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const env = process.env.PLAID_ENV || 'sandbox';

    if (!clientId || !secret) {
      logger.warn('Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.');
      return;
    }

    const { Configuration, PlaidApi, PlaidEnvironments } = PlaidModule;

    const envMap: Record<string, string> = {
      sandbox: PlaidEnvironments.sandbox,
      development: PlaidEnvironments.development,
      production: PlaidEnvironments.production,
    };

    const configuration = new Configuration({
      basePath: envMap[env] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    this.client = new PlaidApi(configuration);
    this.initialized = true;
    logger.info('Plaid client initialized', { environment: env });
  }

  /**
   * Check if Plaid is properly configured
   */
  isConfigured(): boolean {
    return this.initialized && this.client !== null && PlaidModule !== null;
  }

  /**
   * Create a Link token for Plaid Link initialization
   * Supports US, UK, and EU banks
   */
  async createLinkToken(userId: string, countryCode?: 'US' | 'GB' | 'EU'): Promise<PlaidLinkToken> {
    if (!this.client || !PlaidModule) {
      throw new Error('Plaid client not initialized. Install Plaid SDK: npm install plaid');
    }

    const { Products, CountryCode } = PlaidModule;

    // Determine country codes - default to configured or GB for UK users
    const configuredCountry = process.env.PLAID_COUNTRY || 'GB';
    const country = countryCode || configuredCountry;
    
    // Map to Plaid country codes
    const countryCodeMap: Record<string, PlaidCountryCode[]> = {
      'US': [CountryCode.Us],
      'GB': [CountryCode.Gb],
      'EU': [CountryCode.Gb, CountryCode.Fr, CountryCode.Es, CountryCode.De, CountryCode.Nl, CountryCode.Ie],
    };
    
    const countryCodes = countryCodeMap[country] || [CountryCode.Gb];
    
    // UK uses different products (no Transfer in same way)
    const isUK = country === 'GB' || country === 'EU';
    const products = isUK 
      ? [Products.Transactions] // UK Open Banking - transactions and auth via AIS
      : [Products.Auth, Products.Transactions, Products.Transfer];

    try {
      const response = await this.client.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: 'Atlas Desktop',
        products,
        country_codes: countryCodes,
        language: 'en',
        // For UK, we need to enable payment initiation separately
        ...(isUK && {
          payment_initiation: {
            payment_id: undefined, // Will be created separately for payments
          },
        }),
        // Optional: webhook for real-time updates
        // webhook: 'https://your-webhook-url.com/plaid',
      });

      logger.info('Link token created', { userId });

      return {
        linkToken: response.data.link_token,
        expiration: response.data.expiration,
        requestId: response.data.request_id,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create link token', { error: err.message });
      throw new Error(`Failed to create link token: ${err.message}`);
    }
  }

  /**
   * Exchange public token for access token after successful Link
   */
  async exchangePublicToken(publicToken: string): Promise<PlaidAccessToken> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    try {
      const response = await this.client.itemPublicTokenExchange({
        public_token: publicToken,
      });

      const { access_token, item_id } = response.data;

      // Store the access token
      this.accessTokens.set(item_id, access_token);

      logger.info('Public token exchanged', { itemId: item_id });

      return {
        accessToken: access_token,
        itemId: item_id,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to exchange public token', { error: err.message });
      throw new Error(`Failed to exchange public token: ${err.message}`);
    }
  }

  /**
   * Store an access token (loaded from secure storage)
   */
  setAccessToken(itemId: string, accessToken: string): void {
    this.accessTokens.set(itemId, accessToken);
    logger.debug('Access token stored', { itemId });
  }

  /**
   * Get institution information
   */
  async getInstitution(institutionId: string): Promise<BankInstitution> {
    if (!this.client || !PlaidModule) {
      throw new Error('Plaid client not initialized');
    }

    const { CountryCode } = PlaidModule;

    try {
      const response = await this.client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
        options: { include_optional_metadata: true },
      });

      const inst = response.data.institution;

      return {
        id: inst.institution_id,
        name: inst.name,
        logo: inst.logo || undefined,
        primaryColor: inst.primary_color || undefined,
        status: 'connected',
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get institution', { institutionId, error: err.message });
      throw new Error(`Failed to get institution: ${err.message}`);
    }
  }

  /**
   * Get all accounts for a connected item
   */
  async getAccounts(itemId: string): Promise<BankAccount[]> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      const response = await this.client.accountsGet({
        access_token: accessToken,
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const accounts: BankAccount[] = response.data.accounts.map((acc: any) => ({
        id: acc.account_id,
        institutionId: itemId,
        name: acc.name,
        officialName: acc.official_name || undefined,
        type: mapAccountType(acc.type),
        subtype: mapAccountSubtype(acc.subtype),
        mask: acc.mask || undefined,
        currentBalance: acc.balances.current || 0,
        availableBalance: acc.balances.available || undefined,
        creditLimit: acc.balances.limit || undefined,
        currency: acc.balances.iso_currency_code || 'USD',
        isPrimary: false,
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */

      logger.info('Accounts retrieved', { itemId, count: accounts.length });

      return accounts;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get accounts', { itemId, error: err.message });
      throw new Error(`Failed to get accounts: ${err.message}`);
    }
  }

  /**
   * Get account balances (refreshed)
   */
  async getBalances(itemId: string): Promise<BankAccount[]> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      const response = await this.client.accountsBalanceGet({
        access_token: accessToken,
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const accounts: BankAccount[] = response.data.accounts.map((acc: any) => ({
        id: acc.account_id,
        institutionId: itemId,
        name: acc.name,
        officialName: acc.official_name || undefined,
        type: mapAccountType(acc.type),
        subtype: mapAccountSubtype(acc.subtype),
        mask: acc.mask || undefined,
        currentBalance: acc.balances.current || 0,
        availableBalance: acc.balances.available || undefined,
        creditLimit: acc.balances.limit || undefined,
        currency: acc.balances.iso_currency_code || 'USD',
        isPrimary: false,
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */

      logger.info('Balances retrieved', { itemId, count: accounts.length });

      return accounts;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get balances', { itemId, error: err.message });
      throw new Error(`Failed to get balances: ${err.message}`);
    }
  }

  /**
   * Get transactions for an item
   */
  async getTransactions(
    itemId: string,
    startDate: Date,
    endDate: Date,
    options?: { accountIds?: string[]; count?: number; offset?: number }
  ): Promise<BankTransaction[]> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      const response = await this.client.transactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        options: {
          account_ids: options?.accountIds,
          count: options?.count || 100,
          offset: options?.offset || 0,
        },
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const transactions: BankTransaction[] = response.data.transactions.map((tx: any) => {
        const category: TransactionCategory | undefined = tx.category
          ? {
              primary: tx.category[0] || 'Other',
              detailed: tx.category.slice(1).join(' > ') || undefined,
              confidence: tx.category_id ? 0.9 : 0.5,
            }
          : undefined;

        return {
          id: tx.transaction_id,
          accountId: tx.account_id,
          amount: -tx.amount, // Plaid uses positive for debits, we use negative
          currency: tx.iso_currency_code || 'USD',
          date: new Date(tx.date),
          authorizedDate: tx.authorized_date ? new Date(tx.authorized_date) : undefined,
          name: tx.name,
          merchantName: tx.merchant_name || undefined,
          category,
          paymentChannel: tx.payment_channel as BankTransaction['paymentChannel'],
          status: tx.pending ? 'pending' : 'posted',
          location: tx.location
            ? {
                address: tx.location.address || undefined,
                city: tx.location.city || undefined,
                region: tx.location.region || undefined,
                postalCode: tx.location.postal_code || undefined,
                country: tx.location.country || undefined,
                lat: tx.location.lat || undefined,
                lon: tx.location.lon || undefined,
              }
            : undefined,
        };
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */

      logger.info('Transactions retrieved', {
        itemId,
        count: transactions.length,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      return transactions;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get transactions', { itemId, error: err.message });
      throw new Error(`Failed to get transactions: ${err.message}`);
    }
  }

  /**
   * Authorize a transfer
   */
  async authorizeTransfer(
    itemId: string,
    accountId: string,
    amount: number,
    description: string
  ): Promise<{ authorization: { id: string; decision: string } }> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      const response = await this.client.transferAuthorizationCreate({
        access_token: accessToken,
        account_id: accountId,
        type: 'debit',
        network: 'ach',
        amount: amount.toFixed(2),
        ach_class: 'ppd',
        user: {
          legal_name: 'Atlas User', // Should be actual user name
        },
      });

      logger.info('Transfer authorized', {
        itemId,
        accountId,
        amount,
        authorizationId: response.data.authorization.id,
      });

      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to authorize transfer', { itemId, accountId, error: err.message });
      throw new Error(`Failed to authorize transfer: ${err.message}`);
    }
  }

  /**
   * Create a transfer
   */
  async createTransfer(
    itemId: string,
    accountId: string,
    authorizationId: string,
    amount: number,
    description: string
  ): Promise<{ transfer: { id: string; status: string } }> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      const response = await this.client.transferCreate({
        access_token: accessToken,
        account_id: accountId,
        authorization_id: authorizationId,
        description: description.substring(0, 10), // ACH description limit
      });

      logger.info('Transfer created', {
        itemId,
        accountId,
        transferId: response.data.transfer.id,
        amount,
      });

      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create transfer', { itemId, accountId, error: err.message });
      throw new Error(`Failed to create transfer: ${err.message}`);
    }
  }

  /**
   * Remove a connected item
   */
  async removeItem(itemId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Plaid client not initialized');
    }

    const accessToken = this.accessTokens.get(itemId);
    if (!accessToken) {
      throw new Error(`No access token found for item: ${itemId}`);
    }

    try {
      await this.client.itemRemove({
        access_token: accessToken,
      });

      this.accessTokens.delete(itemId);
      logger.info('Item removed', { itemId });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to remove item', { itemId, error: err.message });
      throw new Error(`Failed to remove item: ${err.message}`);
    }
  }
}

// Singleton instance
let plaidClient: PlaidClient | null = null;

/**
 * Get the Plaid client instance
 */
export function getPlaidClient(): PlaidClient {
  if (!plaidClient) {
    plaidClient = new PlaidClient();
  }
  return plaidClient;
}
