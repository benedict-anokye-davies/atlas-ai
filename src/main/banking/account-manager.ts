/**
 * Atlas Banking - Account Manager
 *
 * Manages connected bank accounts, syncing, and balance tracking.
 * Persists account data securely with encrypted storage.
 *
 * @module banking/account-manager
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import keytar from 'keytar';
import { createModuleLogger } from '../utils/logger';
import { getPlaidClient } from './plaid-client';
import {
  BankAccount,
  BankInstitution,
  BankTransaction,
  BalanceResponse,
  TransactionSearchOptions,
  SpendingSummary,
} from './types';

const logger = createModuleLogger('AccountManager');

const SERVICE_NAME = 'atlas-banking';
const ENCRYPTION_KEY_ACCOUNT = 'encryption-key';

/**
 * Persisted account data structure
 */
interface PersistedData {
  institutions: BankInstitution[];
  accounts: BankAccount[];
  accessTokens: Record<string, string>; // itemId -> encrypted access token
  lastSync: Record<string, string>; // itemId -> ISO date string
}

/**
 * Account Manager - Handles all bank account operations
 */
export class AccountManager extends EventEmitter {
  private dataPath: string;
  private data: PersistedData;
  private encryptionKey: Buffer | null = null;
  private transactionCache: Map<string, BankTransaction[]> = new Map();
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.dataPath = path.join(app.getPath('userData'), 'banking', 'accounts.enc');
    this.data = {
      institutions: [],
      accounts: [],
      accessTokens: {},
      lastSync: {},
    };
  }

  /**
   * Initialize the account manager
   */
  async initialize(): Promise<void> {
    await this.loadEncryptionKey();
    await this.loadData();
    await this.restoreAccessTokens();
    this.startAutoSync();
    logger.info('Account manager initialized', {
      institutionCount: this.data.institutions.length,
      accountCount: this.data.accounts.length,
    });
  }

  /**
   * Load or create encryption key
   */
  private async loadEncryptionKey(): Promise<void> {
    try {
      let keyHex = await keytar.getPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);

      if (!keyHex) {
        // Generate new key
        const key = crypto.randomBytes(32);
        keyHex = key.toString('hex');
        await keytar.setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, keyHex);
        logger.info('Generated new encryption key');
      }

      this.encryptionKey = Buffer.from(keyHex, 'hex');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to load encryption key', { error: err.message });
      // Fallback to derived key (less secure but functional)
      this.encryptionKey = crypto.scryptSync('atlas-banking-fallback', 'salt', 32);
    }
  }

  /**
   * Encrypt data
   */
  private encrypt(data: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not loaded');

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt data
   */
  private decrypt(encryptedData: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not loaded');

    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Load persisted data
   */
  private async loadData(): Promise<void> {
    try {
      if (!fs.existsSync(this.dataPath)) {
        logger.info('No existing banking data found');
        return;
      }

      const encrypted = fs.readFileSync(this.dataPath, 'utf8');
      const decrypted = this.decrypt(encrypted);
      this.data = JSON.parse(decrypted);

      logger.info('Banking data loaded');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to load banking data', { error: err.message });
      // Start fresh if data is corrupted
      this.data = {
        institutions: [],
        accounts: [],
        accessTokens: {},
        lastSync: {},
      };
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const json = JSON.stringify(this.data);
      const encrypted = this.encrypt(json);
      fs.writeFileSync(this.dataPath, encrypted, 'utf8');

      logger.debug('Banking data saved');
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to save banking data', { error: err.message });
    }
  }

  /**
   * Restore access tokens to Plaid client
   */
  private async restoreAccessTokens(): Promise<void> {
    const plaid = getPlaidClient();

    for (const [itemId, encryptedToken] of Object.entries(this.data.accessTokens)) {
      try {
        const accessToken = this.decrypt(encryptedToken);
        plaid.setAccessToken(itemId, accessToken);
      } catch (error) {
        logger.warn('Failed to restore access token', { itemId });
      }
    }
  }

  /**
   * Start automatic sync for all institutions
   */
  private startAutoSync(): void {
    // Sync every 4 hours
    const SYNC_INTERVAL = 4 * 60 * 60 * 1000;

    for (const institution of this.data.institutions) {
      if (institution.status === 'connected') {
        const interval = setInterval(() => {
          this.syncInstitution(institution.id).catch((err) =>
            logger.error('Auto-sync failed', { institutionId: institution.id, error: err.message })
          );
        }, SYNC_INTERVAL);

        this.syncIntervals.set(institution.id, interval);
      }
    }
  }

  /**
   * Connect a new bank via Plaid Link
   */
  async createLinkToken(userId: string): Promise<string> {
    const plaid = getPlaidClient();

    if (!plaid.isConfigured()) {
      throw new Error('Plaid is not configured. Please set PLAID_CLIENT_ID and PLAID_SECRET.');
    }

    const result = await plaid.createLinkToken(userId);
    return result.linkToken;
  }

  /**
   * Complete bank connection after Plaid Link success
   */
  async completeLinkConnection(
    publicToken: string,
    institutionId: string,
    institutionName: string
  ): Promise<BankInstitution> {
    const plaid = getPlaidClient();

    // Exchange token
    const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);

    // Store encrypted access token
    this.data.accessTokens[itemId] = this.encrypt(accessToken);

    // Create institution record
    const institution: BankInstitution = {
      id: itemId,
      name: institutionName,
      status: 'connected',
      lastSync: new Date(),
    };

    // Try to get institution details
    try {
      const details = await plaid.getInstitution(institutionId);
      institution.logo = details.logo;
      institution.primaryColor = details.primaryColor;
    } catch {
      // Ignore - optional data
    }

    // Fetch accounts
    const accounts = await plaid.getAccounts(itemId);

    // Mark first checking account as primary
    const checkingAccount = accounts.find((a) => a.type === 'checking');
    if (checkingAccount) {
      checkingAccount.isPrimary = true;
    }

    // Update data
    this.data.institutions.push(institution);
    this.data.accounts.push(...accounts);
    this.data.lastSync[itemId] = new Date().toISOString();

    await this.saveData();

    // Start auto-sync for this institution
    const interval = setInterval(() => {
      this.syncInstitution(itemId).catch(() => {});
    }, 4 * 60 * 60 * 1000);
    this.syncIntervals.set(itemId, interval);

    this.emit('institution-connected', institution);
    logger.info('Bank connected', { institutionId: itemId, name: institutionName });

    return institution;
  }

  /**
   * Sync an institution's accounts and balances
   */
  async syncInstitution(itemId: string): Promise<void> {
    const plaid = getPlaidClient();
    const institution = this.data.institutions.find((i) => i.id === itemId);

    if (!institution) {
      throw new Error(`Institution not found: ${itemId}`);
    }

    try {
      // Get updated balances
      const updatedAccounts = await plaid.getBalances(itemId);

      // Update stored accounts
      for (const updated of updatedAccounts) {
        const existing = this.data.accounts.find((a) => a.id === updated.id);
        if (existing) {
          existing.currentBalance = updated.currentBalance;
          existing.availableBalance = updated.availableBalance;
        } else {
          this.data.accounts.push(updated);
        }
      }

      institution.status = 'connected';
      institution.lastSync = new Date();
      institution.error = undefined;
      this.data.lastSync[itemId] = new Date().toISOString();

      await this.saveData();

      this.emit('accounts-updated', { institutionId: itemId, accounts: updatedAccounts });
      logger.info('Institution synced', { itemId });
    } catch (error) {
      const err = error as Error;
      institution.status = 'error';
      institution.error = err.message;
      await this.saveData();

      this.emit('sync-error', { institutionId: itemId, error: err.message });
      logger.error('Sync failed', { itemId, error: err.message });
    }
  }

  /**
   * Get all connected institutions
   */
  getInstitutions(): BankInstitution[] {
    return [...this.data.institutions];
  }

  /**
   * Get all accounts
   */
  getAccounts(): BankAccount[] {
    return [...this.data.accounts];
  }

  /**
   * Get accounts for a specific institution
   */
  getAccountsByInstitution(institutionId: string): BankAccount[] {
    return this.data.accounts.filter((a) => a.institutionId === institutionId);
  }

  /**
   * Get a specific account
   */
  getAccount(accountId: string): BankAccount | undefined {
    return this.data.accounts.find((a) => a.id === accountId);
  }

  /**
   * Get primary account
   */
  getPrimaryAccount(): BankAccount | undefined {
    return this.data.accounts.find((a) => a.isPrimary);
  }

  /**
   * Set primary account
   */
  async setPrimaryAccount(accountId: string): Promise<void> {
    // Unset current primary
    for (const account of this.data.accounts) {
      account.isPrimary = false;
    }

    // Set new primary
    const account = this.data.accounts.find((a) => a.id === accountId);
    if (account) {
      account.isPrimary = true;
      await this.saveData();
      this.emit('primary-account-changed', account);
    }
  }

  /**
   * Set account nickname
   */
  async setAccountNickname(accountId: string, nickname: string): Promise<void> {
    const account = this.data.accounts.find((a) => a.id === accountId);
    if (account) {
      account.nickname = nickname;
      await this.saveData();
    }
  }

  /**
   * Get aggregated balance summary
   */
  getBalanceSummary(): BalanceResponse {
    const accounts = this.data.accounts;

    let totalBalance = 0;
    let totalAvailable = 0;
    let totalDebt = 0;

    for (const account of accounts) {
      if (account.type === 'credit' || account.type === 'loan' || account.type === 'mortgage') {
        totalDebt += Math.abs(account.currentBalance);
      } else {
        totalBalance += account.currentBalance;
        totalAvailable += account.availableBalance || account.currentBalance;
      }
    }

    return {
      accounts,
      totalBalance,
      totalAvailable,
      totalDebt,
      netWorth: totalBalance - totalDebt,
    };
  }

  /**
   * Get transactions with search/filter options
   */
  async getTransactions(options: TransactionSearchOptions = {}): Promise<BankTransaction[]> {
    const plaid = getPlaidClient();
    const transactions: BankTransaction[] = [];

    const endDate = options.endDate || new Date();
    const startDate = options.startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Determine which institutions to query
    const institutionIds = options.accountId
      ? [this.data.accounts.find((a) => a.id === options.accountId)?.institutionId].filter(Boolean)
      : [...new Set(this.data.accounts.map((a) => a.institutionId))];

    for (const itemId of institutionIds) {
      if (!itemId) continue;

      try {
        const txs = await plaid.getTransactions(itemId, startDate, endDate, {
          accountIds: options.accountId ? [options.accountId] : undefined,
          count: options.limit || 100,
          offset: options.offset || 0,
        });

        transactions.push(...txs);
      } catch (error) {
        logger.warn('Failed to get transactions for institution', { itemId });
      }
    }

    // Apply filters
    let filtered = transactions;

    if (options.minAmount !== undefined) {
      filtered = filtered.filter((tx) => Math.abs(tx.amount) >= options.minAmount!);
    }

    if (options.maxAmount !== undefined) {
      filtered = filtered.filter((tx) => Math.abs(tx.amount) <= options.maxAmount!);
    }

    if (options.category) {
      filtered = filtered.filter(
        (tx) =>
          tx.category?.primary?.toLowerCase().includes(options.category!.toLowerCase()) ||
          tx.category?.detailed?.toLowerCase().includes(options.category!.toLowerCase())
      );
    }

    if (options.merchantName) {
      const search = options.merchantName.toLowerCase();
      filtered = filtered.filter(
        (tx) =>
          tx.name.toLowerCase().includes(search) ||
          tx.merchantName?.toLowerCase().includes(search)
      );
    }

    // Sort by date descending
    filtered.sort((a, b) => b.date.getTime() - a.date.getTime());

    return filtered;
  }

  /**
   * Get spending summary for a period
   */
  async getSpendingSummary(
    period: 'day' | 'week' | 'month' | 'year'
  ): Promise<SpendingSummary> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }

    const transactions = await this.getTransactions({
      startDate,
      endDate: now,
    });

    let totalSpent = 0;
    let totalIncome = 0;
    const byCategory: Record<string, number> = {};
    const merchantSpending: Record<string, { amount: number; count: number }> = {};

    for (const tx of transactions) {
      if (tx.amount < 0) {
        // Spending (negative amount)
        totalSpent += Math.abs(tx.amount);

        const category = tx.category?.primary || 'Other';
        byCategory[category] = (byCategory[category] || 0) + Math.abs(tx.amount);

        const merchant = tx.merchantName || tx.name;
        if (!merchantSpending[merchant]) {
          merchantSpending[merchant] = { amount: 0, count: 0 };
        }
        merchantSpending[merchant].amount += Math.abs(tx.amount);
        merchantSpending[merchant].count += 1;
      } else {
        // Income (positive amount)
        totalIncome += tx.amount;
      }
    }

    const topMerchants = Object.entries(merchantSpending)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    return {
      period,
      startDate,
      endDate: now,
      totalSpent,
      totalIncome,
      netChange: totalIncome - totalSpent,
      byCategory,
      topMerchants,
    };
  }

  /**
   * Disconnect an institution
   */
  async disconnectInstitution(itemId: string): Promise<void> {
    const plaid = getPlaidClient();

    try {
      await plaid.removeItem(itemId);
    } catch {
      // Continue even if Plaid removal fails
    }

    // Clear sync interval
    const interval = this.syncIntervals.get(itemId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(itemId);
    }

    // Remove from data
    this.data.institutions = this.data.institutions.filter((i) => i.id !== itemId);
    this.data.accounts = this.data.accounts.filter((a) => a.institutionId !== itemId);
    delete this.data.accessTokens[itemId];
    delete this.data.lastSync[itemId];

    await this.saveData();

    this.emit('institution-disconnected', itemId);
    logger.info('Institution disconnected', { itemId });
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup(): Promise<void> {
    for (const interval of this.syncIntervals.values()) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();
    await this.saveData();
    logger.info('Account manager cleaned up');
  }
}

// Singleton instance
let accountManager: AccountManager | null = null;

/**
 * Get the account manager instance
 */
export function getAccountManager(): AccountManager {
  if (!accountManager) {
    accountManager = new AccountManager();
  }
  return accountManager;
}

/**
 * Initialize the account manager
 */
export async function initializeAccountManager(): Promise<AccountManager> {
  const manager = getAccountManager();
  await manager.initialize();
  return manager;
}
