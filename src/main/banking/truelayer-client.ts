/**
 * Atlas Banking - TrueLayer Client
 *
 * Integration with TrueLayer API for UK/EU bank connections.
 * TrueLayer has excellent coverage for UK banks including TSB,
 * Lloyds, Barclays, HSBC, NatWest, Santander, etc.
 *
 * @module banking/truelayer-client
 */

import { createModuleLogger } from '../utils/logger';
import {
  BankAccount,
  BankInstitution,
  BankTransaction,
  AccountType,
  TransactionCategory,
} from './types';

const logger = createModuleLogger('TrueLayerClient');

/**
 * TrueLayer auth token response
 */
interface TrueLayerTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  scope: string;
}

/**
 * TrueLayer account from API
 */
interface TrueLayerAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
  account_number?: {
    iban?: string;
    swift_bic?: string;
    number?: string;
    sort_code?: string;
  };
  provider: {
    display_name: string;
    provider_id: string;
    logo_uri?: string;
  };
}

/**
 * TrueLayer balance from API
 */
interface TrueLayerBalance {
  currency: string;
  available: number;
  current: number;
  overdraft?: number;
}

/**
 * TrueLayer transaction from API
 */
interface TrueLayerTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  transaction_type: string;
  transaction_category: string;
  merchant_name?: string;
  running_balance?: {
    amount: number;
    currency: string;
  };
  meta?: Record<string, unknown>;
}

/**
 * Map TrueLayer account type to our AccountType
 */
function mapAccountType(tlType: string): AccountType {
  const typeMap: Record<string, AccountType> = {
    TRANSACTION: 'checking',
    SAVINGS: 'savings',
    CREDIT_CARD: 'credit',
    LOAN: 'loan',
    MORTGAGE: 'mortgage',
  };
  return typeMap[tlType.toUpperCase()] || 'other';
}

/**
 * TrueLayer Client - Handles UK/EU bank connections via TrueLayer
 */
export class TrueLayerClient {
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private baseUrl: string;
  private authUrl: string;
  private accessTokens: Map<string, { token: string; expiresAt: number }> = new Map();
  private refreshTokens: Map<string, string> = new Map();
  private initialized = false;

  constructor() {
    this.initializeClient();
    // Use sandbox for testing, production for real banks
    const env = process.env.TRUELAYER_ENV || 'sandbox';
    this.baseUrl = env === 'production' 
      ? 'https://api.truelayer.com'
      : 'https://api.truelayer-sandbox.com';
    this.authUrl = env === 'production'
      ? 'https://auth.truelayer.com'
      : 'https://auth.truelayer-sandbox.com';
  }

  /**
   * Initialize the TrueLayer client with API credentials
   */
  private initializeClient(): void {
    this.clientId = process.env.TRUELAYER_CLIENT_ID || null;
    this.clientSecret = process.env.TRUELAYER_CLIENT_SECRET || null;

    if (!this.clientId || !this.clientSecret) {
      logger.warn('TrueLayer credentials not configured. Set TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET.');
      return;
    }

    this.initialized = true;
    logger.info('TrueLayer client initialized');
  }

  /**
   * Check if TrueLayer is properly configured
   */
  isConfigured(): boolean {
    return this.initialized && this.clientId !== null && this.clientSecret !== null;
  }

  /**
   * Generate the authorization URL for bank connection
   * User will be redirected here to select their bank and log in
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    if (!this.clientId) {
      throw new Error('TrueLayer client not initialized');
    }

    const scopes = [
      'info',
      'accounts',
      'balance',
      'transactions',
      'offline_access', // For refresh tokens
    ].join('%20');

    // Supported UK providers including TSB
    const providers = [
      'uk-ob-all', // All UK Open Banking banks
      'uk-oauth-all', // Legacy OAuth banks
    ].join('%20');

    return `${this.authUrl}/?` +
      `response_type=code&` +
      `client_id=${this.clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${scopes}&` +
      `providers=${providers}&` +
      `state=${state}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('TrueLayer client not initialized');
    }

    try {
      const response = await fetch(`${this.authUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      const data: TrueLayerTokenResponse = await response.json();
      
      // Generate a unique connection ID
      const connectionId = `tl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store tokens
      this.accessTokens.set(connectionId, {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
      });
      
      if (data.refresh_token) {
        this.refreshTokens.set(connectionId, data.refresh_token);
      }

      logger.info('TrueLayer code exchanged', { connectionId });
      return connectionId;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to exchange TrueLayer code', { error: err.message });
      throw error;
    }
  }

  /**
   * Refresh an access token
   */
  private async refreshAccessToken(connectionId: string): Promise<void> {
    const refreshToken = this.refreshTokens.get(connectionId);
    if (!refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh token - no refresh token available');
    }

    try {
      const response = await fetch(`${this.authUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data: TrueLayerTokenResponse = await response.json();
      
      this.accessTokens.set(connectionId, {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
      });
      
      if (data.refresh_token) {
        this.refreshTokens.set(connectionId, data.refresh_token);
      }

      logger.debug('TrueLayer token refreshed', { connectionId });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to refresh TrueLayer token', { connectionId, error: err.message });
      throw error;
    }
  }

  /**
   * Get valid access token, refreshing if needed
   */
  private async getValidToken(connectionId: string): Promise<string> {
    const tokenData = this.accessTokens.get(connectionId);
    
    if (!tokenData) {
      throw new Error(`No token found for connection: ${connectionId}`);
    }

    // Refresh if token expires in less than 5 minutes
    if (tokenData.expiresAt - Date.now() < 5 * 60 * 1000) {
      await this.refreshAccessToken(connectionId);
      return this.accessTokens.get(connectionId)!.token;
    }

    return tokenData.token;
  }

  /**
   * Store tokens (for loading from secure storage)
   */
  setTokens(connectionId: string, accessToken: string, expiresAt: number, refreshToken?: string): void {
    this.accessTokens.set(connectionId, { token: accessToken, expiresAt });
    if (refreshToken) {
      this.refreshTokens.set(connectionId, refreshToken);
    }
  }

  /**
   * Get accounts for a connection
   */
  async getAccounts(connectionId: string): Promise<BankAccount[]> {
    const token = await this.getValidToken(connectionId);

    try {
      const response = await fetch(`${this.baseUrl}/data/v1/accounts`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get accounts: ${response.statusText}`);
      }

      const data = await response.json();
      const accounts: TrueLayerAccount[] = data.results || [];

      const mappedAccounts: BankAccount[] = await Promise.all(
        accounts.map(async (acc) => {
          // Get balance for each account
          let balance = { current: 0, available: 0 };
          try {
            balance = await this.getAccountBalance(connectionId, acc.account_id);
          } catch {
            logger.warn('Failed to get balance for account', { accountId: acc.account_id });
          }

          return {
            id: acc.account_id,
            institutionId: connectionId,
            name: acc.display_name,
            officialName: acc.provider.display_name,
            type: mapAccountType(acc.account_type),
            mask: acc.account_number?.number?.slice(-4),
            currentBalance: balance.current,
            availableBalance: balance.available,
            currency: acc.currency,
            isPrimary: false,
          };
        })
      );

      logger.info('TrueLayer accounts retrieved', { connectionId, count: mappedAccounts.length });
      return mappedAccounts;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get TrueLayer accounts', { connectionId, error: err.message });
      throw error;
    }
  }

  /**
   * Get balance for a specific account
   */
  private async getAccountBalance(connectionId: string, accountId: string): Promise<{ current: number; available: number }> {
    const token = await this.getValidToken(connectionId);

    const response = await fetch(`${this.baseUrl}/data/v1/accounts/${accountId}/balance`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get balance: ${response.statusText}`);
    }

    const data = await response.json();
    const balance: TrueLayerBalance = data.results?.[0] || { current: 0, available: 0 };

    return {
      current: balance.current,
      available: balance.available,
    };
  }

  /**
   * Get transactions for an account
   */
  async getTransactions(
    connectionId: string,
    accountId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<BankTransaction[]> {
    const token = await this.getValidToken(connectionId);

    try {
      const from = fromDate.toISOString().split('T')[0];
      const to = toDate.toISOString().split('T')[0];

      const response = await fetch(
        `${this.baseUrl}/data/v1/accounts/${accountId}/transactions?from=${from}&to=${to}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get transactions: ${response.statusText}`);
      }

      const data = await response.json();
      const transactions: TrueLayerTransaction[] = data.results || [];

      const mappedTransactions: BankTransaction[] = transactions.map((tx) => {
        const category: TransactionCategory = {
          primary: tx.transaction_category || 'Other',
          confidence: 0.8,
        };

        return {
          id: tx.transaction_id,
          accountId,
          amount: tx.amount, // TrueLayer uses negative for debits
          currency: tx.currency,
          date: new Date(tx.timestamp),
          name: tx.description,
          merchantName: tx.merchant_name,
          category,
          status: 'posted',
        };
      });

      logger.info('TrueLayer transactions retrieved', {
        connectionId,
        accountId,
        count: mappedTransactions.length,
      });

      return mappedTransactions;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get TrueLayer transactions', { connectionId, error: err.message });
      throw error;
    }
  }

  /**
   * Get connected provider info (bank name, logo, etc.)
   */
  async getProviderInfo(connectionId: string): Promise<BankInstitution> {
    const token = await this.getValidToken(connectionId);

    try {
      const response = await fetch(`${this.baseUrl}/data/v1/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get provider info: ${response.statusText}`);
      }

      const data = await response.json();
      const provider = data.results?.[0]?.provider || {};

      return {
        id: connectionId,
        name: provider.display_name || 'Unknown Bank',
        logo: provider.logo_uri,
        status: 'connected',
        lastSync: new Date(),
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get TrueLayer provider info', { connectionId, error: err.message });
      throw error;
    }
  }

  /**
   * Initiate a payment (UK Open Banking Payment Initiation)
   */
  async initiatePayment(
    amount: number,
    currency: string,
    recipientName: string,
    recipientSortCode: string,
    recipientAccountNumber: string,
    reference: string
  ): Promise<{ paymentId: string; authorizationUrl: string }> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('TrueLayer client not initialized');
    }

    try {
      // Get client credentials token for payment initiation
      const tokenResponse = await fetch(`${this.authUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'payments',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to get payment token');
      }

      const tokenData: TrueLayerTokenResponse = await tokenResponse.json();

      // Create payment
      const paymentResponse = await fetch(`${this.baseUrl}/v3/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `atlas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        },
        body: JSON.stringify({
          amount_in_minor: Math.round(amount * 100), // Convert to pence
          currency,
          payment_method: {
            type: 'bank_transfer',
            provider_selection: {
              type: 'user_selected',
            },
            beneficiary: {
              type: 'external_account',
              account_holder_name: recipientName,
              account_identifier: {
                type: 'sort_code_account_number',
                sort_code: recipientSortCode.replace(/-/g, ''),
                account_number: recipientAccountNumber,
              },
              reference,
            },
          },
          user: {
            name: 'Atlas User',
            email: 'user@atlas.local',
          },
        }),
      });

      if (!paymentResponse.ok) {
        const error = await paymentResponse.text();
        throw new Error(`Payment creation failed: ${error}`);
      }

      const paymentData = await paymentResponse.json();

      logger.info('TrueLayer payment initiated', {
        paymentId: paymentData.id,
        amount,
        currency,
      });

      return {
        paymentId: paymentData.id,
        authorizationUrl: paymentData.resource_token 
          ? `${this.authUrl}/payments#payment_id=${paymentData.id}&resource_token=${paymentData.resource_token}`
          : '',
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to initiate TrueLayer payment', { error: err.message });
      throw error;
    }
  }

  /**
   * Check payment status
   */
  async getPaymentStatus(paymentId: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('TrueLayer client not initialized');
    }

    try {
      // Get client credentials token
      const tokenResponse = await fetch(`${this.authUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'payments',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to get payment token');
      }

      const tokenData: TrueLayerTokenResponse = await tokenResponse.json();

      const response = await fetch(`${this.baseUrl}/v3/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get payment status: ${response.statusText}`);
      }

      const data = await response.json();
      return data.status || 'unknown';
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get TrueLayer payment status', { paymentId, error: err.message });
      throw error;
    }
  }

  /**
   * Disconnect a connection
   */
  disconnect(connectionId: string): void {
    this.accessTokens.delete(connectionId);
    this.refreshTokens.delete(connectionId);
    logger.info('TrueLayer connection disconnected', { connectionId });
  }
}

// Singleton instance
let trueLayerClient: TrueLayerClient | null = null;

/**
 * Get the TrueLayer client instance
 */
export function getTrueLayerClient(): TrueLayerClient {
  if (!trueLayerClient) {
    trueLayerClient = new TrueLayerClient();
  }
  return trueLayerClient;
}
