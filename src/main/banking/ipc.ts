/**
 * Atlas Banking - IPC Handlers
 *
 * IPC communication layer for banking operations.
 * Exposes banking functionality to the renderer process.
 *
 * @module banking/ipc
 */

import { ipcMain, shell, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAccountManager } from './account-manager';
import { getPaymentService } from './payment-service';
import { getBankingSecurity } from './security';
import { getTrueLayerClient } from './truelayer-client';
import { getPlaidClient } from './plaid-client';
import {
  BankAccount,
  BankInstitution,
  BankTransaction,
  BalanceResponse,
  SpendingSummary,
  PaymentRequest,
  BankingSecuritySettings,
  TransactionSearchOptions,
} from './types';

const logger = createModuleLogger('BankingIPC');

/**
 * Register all banking IPC handlers
 */
export function registerBankingHandlers(): void {
  logger.info('Registering banking IPC handlers');

  // =========================================================================
  // Connection Handlers
  // =========================================================================

  /**
   * Get the authorization URL for connecting a UK bank via TrueLayer
   */
  ipcMain.handle('banking:get-truelayer-auth-url', async (_event, state: string) => {
    try {
      const truelayer = getTrueLayerClient();

      if (!truelayer.isConfigured()) {
        return {
          success: false,
          error: 'TrueLayer is not configured. Please set TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET.',
        };
      }

      // Use a local redirect URI for desktop app
      const redirectUri = 'http://localhost:3847/callback';
      const authUrl = truelayer.getAuthorizationUrl(redirectUri, state);

      return { success: true, data: { authUrl, redirectUri } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get TrueLayer auth URL', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Complete TrueLayer connection with authorization code
   */
  ipcMain.handle('banking:complete-truelayer-connection', async (_event, code: string, redirectUri: string) => {
    try {
      const truelayer = getTrueLayerClient();
      const connectionId = await truelayer.exchangeCode(code, redirectUri);

      // Get provider info
      const institution = await truelayer.getProviderInfo(connectionId);

      // Get accounts
      const accounts = await truelayer.getAccounts(connectionId);

      // Store in account manager
      const accountManager = getAccountManager();
      // Note: You may want to add a method to store TrueLayer connections

      return {
        success: true,
        data: {
          connectionId,
          institution,
          accounts,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to complete TrueLayer connection', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Create Plaid Link token for bank connection
   */
  ipcMain.handle('banking:create-link-token', async (_event, userId: string, country?: 'US' | 'GB' | 'EU') => {
    try {
      const plaid = getPlaidClient();

      if (!plaid.isConfigured()) {
        return {
          success: false,
          error: 'Plaid is not configured. Please set PLAID_CLIENT_ID and PLAID_SECRET.',
        };
      }

      const linkToken = await plaid.createLinkToken(userId, country);
      return { success: true, data: { linkToken } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create Plaid link token', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Complete Plaid connection after Link success
   */
  ipcMain.handle(
    'banking:complete-plaid-connection',
    async (_event, publicToken: string, institutionId: string, institutionName: string) => {
      try {
        const accountManager = getAccountManager();
        const institution = await accountManager.completeLinkConnection(
          publicToken,
          institutionId,
          institutionName
        );

        const accounts = accountManager.getAccountsByInstitution(institution.id);

        return {
          success: true,
          data: { institution, accounts },
        };
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to complete Plaid connection', { error: err.message });
        return { success: false, error: err.message };
      }
    }
  );

  /**
   * Open bank connection flow in external browser (for OAuth)
   */
  ipcMain.handle('banking:open-bank-auth', async (_event, authUrl: string) => {
    try {
      await shell.openExternal(authUrl);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to open bank auth URL', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Account Handlers
  // =========================================================================

  /**
   * Get all connected institutions
   */
  ipcMain.handle('banking:get-institutions', async () => {
    try {
      const accountManager = getAccountManager();
      const institutions = accountManager.getInstitutions();
      return { success: true, data: institutions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get institutions', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get all accounts
   */
  ipcMain.handle('banking:get-accounts', async () => {
    try {
      const accountManager = getAccountManager();
      const accounts = accountManager.getAccounts();
      return { success: true, data: accounts };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get accounts', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get balance summary
   */
  ipcMain.handle('banking:get-balance-summary', async () => {
    try {
      const accountManager = getAccountManager();
      const summary = accountManager.getBalanceSummary();
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get balance summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Sync an institution's data
   */
  ipcMain.handle('banking:sync-institution', async (_event, institutionId: string) => {
    try {
      const accountManager = getAccountManager();
      await accountManager.syncInstitution(institutionId);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to sync institution', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Disconnect an institution
   */
  ipcMain.handle('banking:disconnect-institution', async (_event, institutionId: string) => {
    try {
      const accountManager = getAccountManager();
      await accountManager.disconnectInstitution(institutionId);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to disconnect institution', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Set primary account
   */
  ipcMain.handle('banking:set-primary-account', async (_event, accountId: string) => {
    try {
      const accountManager = getAccountManager();
      await accountManager.setPrimaryAccount(accountId);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to set primary account', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Transaction Handlers
  // =========================================================================

  /**
   * Get transactions with filters
   */
  ipcMain.handle('banking:get-transactions', async (_event, options: TransactionSearchOptions) => {
    try {
      const accountManager = getAccountManager();

      // Convert date strings to Date objects if needed
      const searchOptions: TransactionSearchOptions = {
        ...options,
        startDate: options.startDate ? new Date(options.startDate) : undefined,
        endDate: options.endDate ? new Date(options.endDate) : undefined,
      };

      const transactions = await accountManager.getTransactions(searchOptions);
      return { success: true, data: transactions };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get transactions', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get spending summary
   */
  ipcMain.handle('banking:get-spending-summary', async (_event, period: 'day' | 'week' | 'month' | 'year') => {
    try {
      const accountManager = getAccountManager();
      const summary = await accountManager.getSpendingSummary(period);
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get spending summary', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Payment Handlers
  // =========================================================================

  /**
   * Create a payment request
   */
  ipcMain.handle('banking:create-payment', async (_event, options: {
    recipientName: string;
    recipientType?: 'individual' | 'business';
    amount: number;
    currency?: string;
    description: string;
    sortCode?: string;
    accountNumber?: string;
    email?: string;
    voiceCommand?: string;
  }) => {
    try {
      const paymentService = getPaymentService();

      const payment = await paymentService.createPayment({
        recipient: {
          name: options.recipientName,
          type: options.recipientType || 'individual',
          routingNumber: options.sortCode?.replace(/-/g, ''),
          accountNumber: options.accountNumber,
          email: options.email,
        },
        amount: options.amount,
        currency: options.currency || 'GBP',
        description: options.description,
        voiceCommand: options.voiceCommand,
      });

      return { success: true, data: payment };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Confirm a pending payment
   */
  ipcMain.handle('banking:confirm-payment', async (_event, paymentId: string, pin?: string) => {
    try {
      const paymentService = getPaymentService();
      const payment = await paymentService.confirmPayment(paymentId, pin);
      return { success: true, data: payment };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to confirm payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Cancel a pending payment
   */
  ipcMain.handle('banking:cancel-payment', async (_event, paymentId: string) => {
    try {
      const paymentService = getPaymentService();
      await paymentService.cancelPayment(paymentId);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to cancel payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get pending payments
   */
  ipcMain.handle('banking:get-pending-payments', async () => {
    try {
      const paymentService = getPaymentService();
      const payments = paymentService.getPendingPayments();
      return { success: true, data: payments };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get pending payments', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get payment history
   */
  ipcMain.handle('banking:get-payment-history', async (_event, limit?: number) => {
    try {
      const paymentService = getPaymentService();
      const payments = paymentService.getPaymentHistory(limit);
      return { success: true, data: payments };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get payment history', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Quick pay to saved recipient
   */
  ipcMain.handle('banking:quick-pay', async (_event, recipientName: string, amount: number, description?: string) => {
    try {
      const paymentService = getPaymentService();
      const payment = await paymentService.quickPay(recipientName, amount, description);
      return { success: true, data: payment };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to quick pay', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Parse natural language payment request
   */
  ipcMain.handle('banking:parse-payment', async (_event, text: string) => {
    try {
      const paymentService = getPaymentService();
      const parsed = paymentService.parsePaymentRequest(text);
      return { success: true, data: parsed };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to parse payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get saved recipients
   */
  ipcMain.handle('banking:get-recipients', async () => {
    try {
      const paymentService = getPaymentService();
      const recipients = paymentService.getSavedRecipients();
      return { success: true, data: recipients };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get recipients', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // Security Handlers
  // =========================================================================

  /**
   * Get security settings
   */
  ipcMain.handle('banking:get-security-settings', async () => {
    try {
      const security = getBankingSecurity();
      const settings = security.getSettings();
      return { success: true, data: settings };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get security settings', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Update security settings
   */
  ipcMain.handle('banking:update-security-settings', async (_event, settings: Partial<BankingSecuritySettings>) => {
    try {
      const security = getBankingSecurity();
      await security.updateSettings(settings);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update security settings', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Set PIN
   */
  ipcMain.handle('banking:set-pin', async (_event, pin: string) => {
    try {
      const security = getBankingSecurity();
      await security.setPin(pin);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to set PIN', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Verify PIN
   */
  ipcMain.handle('banking:verify-pin', async (_event, pin: string) => {
    try {
      const security = getBankingSecurity();
      const valid = await security.verifyPin(pin);
      return { success: true, data: { valid } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to verify PIN', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Check if PIN is set
   */
  ipcMain.handle('banking:has-pin', async () => {
    try {
      const security = getBankingSecurity();
      const hasPin = security.hasPinSet();
      return { success: true, data: { hasPin } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to check PIN', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Get spending limits summary
   */
  ipcMain.handle('banking:get-spending-limits', async () => {
    try {
      const security = getBankingSecurity();
      const summary = security.getSpendingSummary();
      return { success: true, data: summary };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get spending limits', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Update spending limits
   */
  ipcMain.handle('banking:update-spending-limits', async (_event, limits: {
    daily?: number;
    weekly?: number;
    monthly?: number;
    perTransaction?: number;
  }) => {
    try {
      const security = getBankingSecurity();
      await security.updateSpendingLimits(limits);
      return { success: true };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update spending limits', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // TrueLayer UK Payment Initiation
  // =========================================================================

  /**
   * Initiate a UK bank payment via TrueLayer
   */
  ipcMain.handle('banking:initiate-uk-payment', async (_event, options: {
    amount: number;
    recipientName: string;
    sortCode: string;
    accountNumber: string;
    reference: string;
  }) => {
    try {
      const truelayer = getTrueLayerClient();

      if (!truelayer.isConfigured()) {
        return {
          success: false,
          error: 'TrueLayer is not configured for UK payments.',
        };
      }

      const result = await truelayer.initiatePayment(
        options.amount,
        'GBP',
        options.recipientName,
        options.sortCode,
        options.accountNumber,
        options.reference
      );

      return { success: true, data: result };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to initiate UK payment', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  /**
   * Check UK payment status
   */
  ipcMain.handle('banking:get-uk-payment-status', async (_event, paymentId: string) => {
    try {
      const truelayer = getTrueLayerClient();
      const status = await truelayer.getPaymentStatus(paymentId);
      return { success: true, data: { status } };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get UK payment status', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  logger.info('Banking IPC handlers registered');
}

/**
 * Alias for registerBankingHandlers (used by main process)
 */
export const registerBankingIPC = registerBankingHandlers;

/**
 * Unregister all banking IPC handlers
 */
export function unregisterBankingIPC(): void {
  logger.info('Unregistering banking IPC handlers');

  const channels = [
    'banking:get-truelayer-auth-url',
    'banking:exchange-truelayer-code',
    'banking:get-plaid-link-token',
    'banking:exchange-plaid-token',
    'banking:is-connected',
    'banking:get-authorization-url',
    'banking:complete-authorization',
    'banking:disconnect',
    'banking:get-accounts',
    'banking:get-balance-summary',
    'banking:sync-accounts',
    'banking:get-connected-institutions',
    'banking:get-transactions',
    'banking:get-spending-summary',
    'banking:create-payment',
    'banking:confirm-payment',
    'banking:cancel-payment',
    'banking:get-payment-status',
    'banking:quick-pay',
    'banking:get-saved-recipients',
    'banking:save-recipient',
    'banking:delete-recipient',
    'banking:setup-pin',
    'banking:verify-pin',
    'banking:change-pin',
    'banking:get-spending-limits',
    'banking:set-spending-limit',
    'banking:get-security-settings',
    'banking:update-security-settings',
    'banking:initiate-uk-payment',
    'banking:get-uk-payment-status',
  ];

  for (const channel of channels) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler may not exist
    }
  }

  logger.info('Banking IPC handlers unregistered');
}
