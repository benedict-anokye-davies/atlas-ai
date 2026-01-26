/**
 * Atlas Banking - Security Module
 *
 * Security controls for banking operations including spending limits,
 * recipient verification, fraud detection, and audit logging.
 *
 * @module banking/security
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import keytar from 'keytar';
import { createModuleLogger } from '../utils/logger';
import {
  BankingSecuritySettings,
  SpendingLimit,
  PaymentRequest,
  PaymentRecipient,
} from './types';

const logger = createModuleLogger('BankingSecurity');

const SERVICE_NAME = 'atlas-banking';
const PIN_ACCOUNT = 'user-pin';

/**
 * Spending record for limit tracking
 */
interface SpendingRecord {
  amount: number;
  recipient: string;
  timestamp: number;
}

/**
 * Payment validation result
 */
export interface PaymentValidation {
  allowed: boolean;
  reason?: string;
  warnings?: string[];
  requiresConfirmation?: boolean;
}

/**
 * Default security settings
 */
const DEFAULT_SETTINGS: BankingSecuritySettings = {
  requireAuthForTransactions: true,
  confirmationThreshold: 100, // Confirm payments over $100
  blockNewRecipients: false,
  spendingLimits: {
    daily: 1000,
    weekly: 3000,
    monthly: 10000,
    perTransaction: 500,
  },
  allowedCategories: [],
  blockedRecipients: [],
  fraudAlerts: true,
  require2FAAbove: 1000,
};

/**
 * Banking Security - Handles all security-related operations
 */
export class BankingSecurity extends EventEmitter {
  private settings: BankingSecuritySettings;
  private settingsPath: string;
  private spendingHistory: SpendingRecord[] = [];
  private trustedRecipients: Set<string> = new Set();
  private pinHash: string | null = null;

  constructor() {
    super();
    this.settings = { ...DEFAULT_SETTINGS };
    this.settingsPath = path.join(app.getPath('userData'), 'banking', 'security.json');
  }

  /**
   * Initialize security module
   */
  async initialize(): Promise<void> {
    await this.loadSettings();
    await this.loadPinHash();
    logger.info('Banking security initialized');
  }

  /**
   * Load security settings
   */
  private async loadSettings(): Promise<void> {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const loaded = JSON.parse(data);
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        this.trustedRecipients = new Set(loaded.trustedRecipients || []);
        this.spendingHistory = loaded.spendingHistory || [];
      }
    } catch (error) {
      logger.warn('Failed to load security settings, using defaults');
    }
  }

  /**
   * Save security settings
   */
  private async saveSettings(): Promise<void> {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        ...this.settings,
        trustedRecipients: Array.from(this.trustedRecipients),
        spendingHistory: this.spendingHistory,
      };

      fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to save security settings', { error: err.message });
    }
  }

  /**
   * Load PIN hash from secure storage
   */
  private async loadPinHash(): Promise<void> {
    try {
      this.pinHash = await keytar.getPassword(SERVICE_NAME, PIN_ACCOUNT);
    } catch (error) {
      logger.warn('Failed to load PIN hash');
    }
  }

  /**
   * Set user PIN for transaction authorization
   */
  async setPin(pin: string): Promise<void> {
    if (pin.length < 4 || pin.length > 8) {
      throw new Error('PIN must be 4-8 digits');
    }

    if (!/^\d+$/.test(pin)) {
      throw new Error('PIN must contain only digits');
    }

    // Hash the PIN
    const hash = crypto.createHash('sha256').update(pin + SERVICE_NAME).digest('hex');

    await keytar.setPassword(SERVICE_NAME, PIN_ACCOUNT, hash);
    this.pinHash = hash;

    logger.info('PIN updated');
  }

  /**
   * Verify user PIN
   */
  async verifyPin(pin: string): Promise<boolean> {
    if (!this.pinHash) {
      logger.warn('No PIN set');
      return false;
    }

    const hash = crypto.createHash('sha256').update(pin + SERVICE_NAME).digest('hex');
    return hash === this.pinHash;
  }

  /**
   * Check if PIN is set
   */
  hasPinSet(): boolean {
    return this.pinHash !== null;
  }

  /**
   * Get current security settings
   */
  getSettings(): BankingSecuritySettings {
    return { ...this.settings };
  }

  /**
   * Update security settings
   */
  async updateSettings(updates: Partial<BankingSecuritySettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
    await this.saveSettings();
    this.emit('settings-updated', this.settings);
    logger.info('Security settings updated');
  }

  /**
   * Update spending limits
   */
  async updateSpendingLimits(limits: Partial<SpendingLimit>): Promise<void> {
    this.settings.spendingLimits = { ...this.settings.spendingLimits, ...limits };
    await this.saveSettings();
    logger.info('Spending limits updated', limits);
  }

  /**
   * Validate a payment request
   */
  async validatePayment(request: {
    amount: number;
    recipient: PaymentRecipient;
    sourceAccountId: string;
  }): Promise<PaymentValidation> {
    const warnings: string[] = [];

    // Check per-transaction limit
    if (request.amount > this.settings.spendingLimits.perTransaction) {
      return {
        allowed: false,
        reason: `Amount exceeds per-transaction limit of $${this.settings.spendingLimits.perTransaction}`,
      };
    }

    // Check daily spending
    const dailySpent = this.getSpendingForPeriod('day');
    if (dailySpent + request.amount > this.settings.spendingLimits.daily) {
      return {
        allowed: false,
        reason: `Would exceed daily spending limit of $${this.settings.spendingLimits.daily}. Already spent: $${dailySpent.toFixed(2)}`,
      };
    }

    // Check weekly spending
    const weeklySpent = this.getSpendingForPeriod('week');
    if (weeklySpent + request.amount > this.settings.spendingLimits.weekly) {
      return {
        allowed: false,
        reason: `Would exceed weekly spending limit of $${this.settings.spendingLimits.weekly}. Already spent: $${weeklySpent.toFixed(2)}`,
      };
    }

    // Check monthly spending
    const monthlySpent = this.getSpendingForPeriod('month');
    if (monthlySpent + request.amount > this.settings.spendingLimits.monthly) {
      return {
        allowed: false,
        reason: `Would exceed monthly spending limit of $${this.settings.spendingLimits.monthly}. Already spent: $${monthlySpent.toFixed(2)}`,
      };
    }

    // Check blocked recipients
    const recipientKey = this.getRecipientKey(request.recipient);
    if (this.settings.blockedRecipients.includes(recipientKey)) {
      return {
        allowed: false,
        reason: `Recipient "${request.recipient.name}" is blocked`,
      };
    }

    // Check new recipient policy
    if (this.settings.blockNewRecipients && !this.trustedRecipients.has(recipientKey)) {
      return {
        allowed: false,
        reason: `New recipients are blocked. Add "${request.recipient.name}" to trusted recipients first.`,
      };
    }

    // Fraud detection - unusual amount
    if (this.settings.fraudAlerts) {
      const avgSpending = this.getAverageTransactionAmount();
      if (avgSpending > 0 && request.amount > avgSpending * 5) {
        warnings.push(`Unusually large amount (5x average of $${avgSpending.toFixed(2)})`);
      }

      // Rapid spending detection
      const recentSpending = this.getSpendingInLastMinutes(5);
      if (recentSpending > this.settings.spendingLimits.perTransaction * 2) {
        warnings.push('Multiple rapid transactions detected');
      }
    }

    return {
      allowed: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Check if payment requires user confirmation
   */
  async requiresConfirmation(payment: PaymentRequest): Promise<boolean> {
    // Always require confirmation above threshold
    if (payment.amount >= this.settings.confirmationThreshold) {
      return true;
    }

    // Require confirmation for new recipients
    const recipientKey = this.getRecipientKey(payment.recipient);
    if (!this.trustedRecipients.has(recipientKey)) {
      return true;
    }

    // Check if auth is required for all transactions
    if (this.settings.requireAuthForTransactions) {
      return true;
    }

    return false;
  }

  /**
   * Record a completed payment for spending tracking
   */
  async recordSpending(amount: number, recipient: string): Promise<void> {
    this.spendingHistory.push({
      amount,
      recipient,
      timestamp: Date.now(),
    });

    // Keep only last 90 days of history
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    this.spendingHistory = this.spendingHistory.filter((r) => r.timestamp > cutoff);

    await this.saveSettings();
  }

  /**
   * Get spending for a period
   */
  private getSpendingForPeriod(period: 'day' | 'week' | 'month'): number {
    const now = Date.now();
    let cutoff: number;

    switch (period) {
      case 'day':
        cutoff = now - 24 * 60 * 60 * 1000;
        break;
      case 'week':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
        break;
    }

    return this.spendingHistory
      .filter((r) => r.timestamp > cutoff)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get spending in last N minutes
   */
  private getSpendingInLastMinutes(minutes: number): number {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.spendingHistory
      .filter((r) => r.timestamp > cutoff)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get average transaction amount
   */
  private getAverageTransactionAmount(): number {
    if (this.spendingHistory.length === 0) return 0;
    const total = this.spendingHistory.reduce((sum, r) => sum + r.amount, 0);
    return total / this.spendingHistory.length;
  }

  /**
   * Generate recipient key for tracking
   */
  private getRecipientKey(recipient: PaymentRecipient): string {
    if (recipient.accountNumber && recipient.routingNumber) {
      return `ach:${recipient.routingNumber}:${recipient.accountNumber}`;
    }
    if (recipient.externalId && recipient.externalService) {
      return `${recipient.externalService}:${recipient.externalId}`;
    }
    if (recipient.email) {
      return `email:${recipient.email}`;
    }
    return `name:${recipient.name.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * Add a trusted recipient
   */
  async addTrustedRecipient(recipient: PaymentRecipient): Promise<void> {
    const key = this.getRecipientKey(recipient);
    this.trustedRecipients.add(key);
    await this.saveSettings();
    logger.info('Trusted recipient added', { name: recipient.name });
  }

  /**
   * Remove a trusted recipient
   */
  async removeTrustedRecipient(recipient: PaymentRecipient): Promise<void> {
    const key = this.getRecipientKey(recipient);
    this.trustedRecipients.delete(key);
    await this.saveSettings();
    logger.info('Trusted recipient removed', { name: recipient.name });
  }

  /**
   * Block a recipient
   */
  async blockRecipient(recipient: PaymentRecipient): Promise<void> {
    const key = this.getRecipientKey(recipient);
    if (!this.settings.blockedRecipients.includes(key)) {
      this.settings.blockedRecipients.push(key);
      await this.saveSettings();
      logger.info('Recipient blocked', { name: recipient.name });
    }
  }

  /**
   * Unblock a recipient
   */
  async unblockRecipient(recipient: PaymentRecipient): Promise<void> {
    const key = this.getRecipientKey(recipient);
    this.settings.blockedRecipients = this.settings.blockedRecipients.filter((r) => r !== key);
    await this.saveSettings();
    logger.info('Recipient unblocked', { name: recipient.name });
  }

  /**
   * Get spending summary
   */
  getSpendingSummary(): {
    daily: { spent: number; limit: number; remaining: number };
    weekly: { spent: number; limit: number; remaining: number };
    monthly: { spent: number; limit: number; remaining: number };
  } {
    const daily = this.getSpendingForPeriod('day');
    const weekly = this.getSpendingForPeriod('week');
    const monthly = this.getSpendingForPeriod('month');

    return {
      daily: {
        spent: daily,
        limit: this.settings.spendingLimits.daily,
        remaining: Math.max(0, this.settings.spendingLimits.daily - daily),
      },
      weekly: {
        spent: weekly,
        limit: this.settings.spendingLimits.weekly,
        remaining: Math.max(0, this.settings.spendingLimits.weekly - weekly),
      },
      monthly: {
        spent: monthly,
        limit: this.settings.spendingLimits.monthly,
        remaining: Math.max(0, this.settings.spendingLimits.monthly - monthly),
      },
    };
  }

  /**
   * Audit log for security events
   */
  async logSecurityEvent(
    event: string,
    details: Record<string, unknown>
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      details,
    };

    logger.info('Security event', logEntry);

    // Emit for external audit systems
    this.emit('security-event', logEntry);
  }
}

// Singleton instance
let bankingSecurity: BankingSecurity | null = null;

/**
 * Get the banking security instance
 */
export function getBankingSecurity(): BankingSecurity {
  if (!bankingSecurity) {
    bankingSecurity = new BankingSecurity();
  }
  return bankingSecurity;
}

/**
 * Initialize banking security
 */
export async function initializeBankingSecurity(): Promise<BankingSecurity> {
  const security = getBankingSecurity();
  await security.initialize();
  return security;
}
