/**
 * Atlas Banking - Recurring Payment Detector
 *
 * Identifies subscriptions and recurring payments from transaction history.
 * Alerts on price changes or missed payments.
 *
 * @module banking/recurring-detector
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BankTransaction } from './types';

const logger = createModuleLogger('RecurringDetector');

/**
 * Recurring payment frequency
 */
export type RecurringFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual';

/**
 * Detected recurring payment
 */
export interface RecurringPayment {
  id: string;
  merchantName: string;
  merchantPattern: string;
  frequency: RecurringFrequency;
  amount: number;
  currency: string;
  lastPaymentDate: number;
  nextExpectedDate: number;
  dayOfMonth?: number;
  dayOfWeek?: number;
  transactionIds: string[];
  detectedAt: number;
  isSubscription: boolean;
  isActive: boolean;
  priceHistory: Array<{ amount: number; date: number }>;
  category?: string;
  notes?: string;
}

/**
 * Price change alert
 */
export interface PriceChangeAlert {
  id: string;
  recurringId: string;
  merchantName: string;
  previousAmount: number;
  newAmount: number;
  changePercent: number;
  detectedAt: number;
  acknowledged: boolean;
}

/**
 * Missed payment alert
 */
export interface MissedPaymentAlert {
  id: string;
  recurringId: string;
  merchantName: string;
  expectedDate: number;
  amount: number;
  daysOverdue: number;
  detectedAt: number;
  acknowledged: boolean;
}

/**
 * Subscription-like merchant patterns
 */
const SUBSCRIPTION_PATTERNS = [
  /netflix/i,
  /spotify/i,
  /amazon\s*prime/i,
  /disney\+|disney\s*plus/i,
  /apple\s*(music|tv|one|icloud)/i,
  /microsoft\s*365|office\s*365/i,
  /google\s*(one|storage)/i,
  /adobe/i,
  /dropbox/i,
  /github/i,
  /slack/i,
  /zoom/i,
  /notion/i,
  /figma/i,
  /canva/i,
  /linkedin\s*premium/i,
  /youtube\s*(premium|music)/i,
  /hbo\s*max/i,
  /paramount\+|paramount\s*plus/i,
  /now\s*tv/i,
  /sky/i,
  /bt\s*(sport|tv)/i,
  /virgin\s*media/i,
  /ee\s*mobile/i,
  /vodafone/i,
  /three\s*mobile|3\s*mobile/i,
  /o2\s*mobile/i,
  /giffgaff/i,
  /gym|fitness|puregym|virgin\s*active/i,
  /british\s*gas|edf|eon|scottish\s*power|octopus\s*energy/i,
  /thames\s*water|severn\s*trent|united\s*utilities/i,
  /council\s*tax/i,
];

/**
 * Recurring Payment Detector
 */
export class RecurringPaymentDetector extends EventEmitter {
  private recurring: Map<string, RecurringPayment> = new Map();
  private priceAlerts: PriceChangeAlert[] = [];
  private missedAlerts: MissedPaymentAlert[] = [];
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load recurring payment data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'recurring-payments.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.recurring = new Map(Object.entries(data.recurring || {}));
        this.priceAlerts = data.priceAlerts || [];
        this.missedAlerts = data.missedAlerts || [];
        logger.info('Loaded recurring payment data', {
          recurring: this.recurring.size,
          priceAlerts: this.priceAlerts.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load recurring payment data', { error: (error as Error).message });
    }
  }

  /**
   * Save recurring payment data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'recurring-payments.json');
      const data = {
        recurring: Object.fromEntries(this.recurring),
        priceAlerts: this.priceAlerts.slice(-100),
        missedAlerts: this.missedAlerts.slice(-100),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save recurring payment data', { error: (error as Error).message });
    }
  }

  /**
   * Analyze transactions to detect recurring payments
   */
  analyzeTransactions(transactions: BankTransaction[]): {
    detected: RecurringPayment[];
    priceChanges: PriceChangeAlert[];
    missed: MissedPaymentAlert[];
  } {
    const newDetected: RecurringPayment[] = [];
    const newPriceChanges: PriceChangeAlert[] = [];

    // Group transactions by normalized merchant
    const merchantGroups = new Map<string, BankTransaction[]>();

    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // Only consider outgoing payments

      const normalizedMerchant = this.normalizeMerchant(tx.merchantName || tx.description);
      if (!merchantGroups.has(normalizedMerchant)) {
        merchantGroups.set(normalizedMerchant, []);
      }
      merchantGroups.get(normalizedMerchant)!.push(tx);
    }

    // Analyze each merchant group
    for (const [merchant, txs] of merchantGroups) {
      if (txs.length < 2) continue; // Need at least 2 transactions

      // Sort by date
      txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Calculate intervals between payments
      const intervals: number[] = [];
      for (let i = 1; i < txs.length; i++) {
        const interval = new Date(txs[i].date).getTime() - new Date(txs[i - 1].date).getTime();
        intervals.push(interval / (24 * 60 * 60 * 1000)); // Days
      }

      // Detect frequency
      const frequency = this.detectFrequency(intervals);
      if (!frequency) continue;

      // Check if amounts are consistent (within 20%)
      const amounts = txs.map((tx) => Math.abs(tx.amount));
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const isConsistent = amounts.every((a) => Math.abs(a - avgAmount) / avgAmount < 0.2);

      if (!isConsistent && frequency !== 'monthly') continue;

      // Create or update recurring payment
      const existingId = Array.from(this.recurring.values()).find(
        (r) => r.merchantPattern === merchant
      )?.id;

      const latestTx = txs[txs.length - 1];
      const latestAmount = Math.abs(latestTx.amount);

      if (existingId) {
        // Update existing
        const existing = this.recurring.get(existingId)!;
        const previousAmount = existing.amount;

        // Check for price change
        if (Math.abs(latestAmount - previousAmount) / previousAmount > 0.05) {
          const priceChange: PriceChangeAlert = {
            id: `pc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            recurringId: existingId,
            merchantName: existing.merchantName,
            previousAmount,
            newAmount: latestAmount,
            changePercent: ((latestAmount - previousAmount) / previousAmount) * 100,
            detectedAt: Date.now(),
            acknowledged: false,
          };
          this.priceAlerts.push(priceChange);
          newPriceChanges.push(priceChange);
          this.emit('priceChange', priceChange);

          existing.priceHistory.push({ amount: latestAmount, date: Date.now() });
        }

        existing.amount = latestAmount;
        existing.lastPaymentDate = new Date(latestTx.date).getTime();
        existing.nextExpectedDate = this.calculateNextDate(existing);
        existing.transactionIds = txs.map((tx) => tx.id);
      } else {
        // Create new
        const recurring: RecurringPayment = {
          id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          merchantName: latestTx.merchantName || merchant,
          merchantPattern: merchant,
          frequency,
          amount: latestAmount,
          currency: latestTx.currency || 'GBP',
          lastPaymentDate: new Date(latestTx.date).getTime(),
          nextExpectedDate: 0,
          transactionIds: txs.map((tx) => tx.id),
          detectedAt: Date.now(),
          isSubscription: this.isSubscription(merchant),
          isActive: true,
          priceHistory: [{ amount: latestAmount, date: Date.now() }],
        };

        // Calculate day of month/week
        const lastDate = new Date(latestTx.date);
        if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'annual') {
          recurring.dayOfMonth = lastDate.getDate();
        } else {
          recurring.dayOfWeek = lastDate.getDay();
        }

        recurring.nextExpectedDate = this.calculateNextDate(recurring);
        this.recurring.set(recurring.id, recurring);
        newDetected.push(recurring);
        this.emit('detected', recurring);
      }
    }

    // Check for missed payments
    const missed = this.checkMissedPayments();

    this.saveData();

    return {
      detected: newDetected,
      priceChanges: newPriceChanges,
      missed,
    };
  }

  /**
   * Normalize merchant name for matching
   */
  private normalizeMerchant(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/ltd|limited|plc|inc|corp/g, '')
      .trim();
  }

  /**
   * Detect payment frequency from intervals
   */
  private detectFrequency(intervals: number[]): RecurringFrequency | null {
    if (intervals.length === 0) return null;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Check if intervals are consistent (stdDev < 20% of avg)
    if (stdDev / avgInterval > 0.2 && intervals.length > 2) {
      return null;
    }

    // Classify frequency
    if (avgInterval >= 5 && avgInterval <= 9) return 'weekly';
    if (avgInterval >= 12 && avgInterval <= 16) return 'fortnightly';
    if (avgInterval >= 25 && avgInterval <= 35) return 'monthly';
    if (avgInterval >= 85 && avgInterval <= 100) return 'quarterly';
    if (avgInterval >= 350 && avgInterval <= 380) return 'annual';

    return null;
  }

  /**
   * Check if merchant is a known subscription service
   */
  private isSubscription(merchant: string): boolean {
    return SUBSCRIPTION_PATTERNS.some((pattern) => pattern.test(merchant));
  }

  /**
   * Calculate next expected payment date
   */
  private calculateNextDate(recurring: RecurringPayment): number {
    const last = new Date(recurring.lastPaymentDate);
    const next = new Date(last);

    switch (recurring.frequency) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'fortnightly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        if (recurring.dayOfMonth) {
          next.setDate(Math.min(recurring.dayOfMonth, this.getDaysInMonth(next)));
        }
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'annual':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }

    return next.getTime();
  }

  /**
   * Get days in month
   */
  private getDaysInMonth(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  /**
   * Check for missed payments
   */
  checkMissedPayments(): MissedPaymentAlert[] {
    const newAlerts: MissedPaymentAlert[] = [];
    const now = Date.now();
    const gracePeriod = 3 * 24 * 60 * 60 * 1000; // 3 days grace

    for (const recurring of this.recurring.values()) {
      if (!recurring.isActive) continue;

      if (recurring.nextExpectedDate + gracePeriod < now) {
        const daysOverdue = Math.floor(
          (now - recurring.nextExpectedDate) / (24 * 60 * 60 * 1000)
        );

        // Check if we already have an alert for this
        const existingAlert = this.missedAlerts.find(
          (a) =>
            a.recurringId === recurring.id &&
            !a.acknowledged &&
            now - a.detectedAt < 30 * 24 * 60 * 60 * 1000
        );

        if (!existingAlert) {
          const alert: MissedPaymentAlert = {
            id: `mp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            recurringId: recurring.id,
            merchantName: recurring.merchantName,
            expectedDate: recurring.nextExpectedDate,
            amount: recurring.amount,
            daysOverdue,
            detectedAt: now,
            acknowledged: false,
          };
          this.missedAlerts.push(alert);
          newAlerts.push(alert);
          this.emit('missed', alert);
        }
      }
    }

    if (newAlerts.length > 0) {
      this.saveData();
    }

    return newAlerts;
  }

  /**
   * Get all recurring payments
   */
  getRecurringPayments(options?: {
    activeOnly?: boolean;
    subscriptionsOnly?: boolean;
    frequency?: RecurringFrequency;
  }): RecurringPayment[] {
    let payments = Array.from(this.recurring.values());

    if (options?.activeOnly) {
      payments = payments.filter((p) => p.isActive);
    }
    if (options?.subscriptionsOnly) {
      payments = payments.filter((p) => p.isSubscription);
    }
    if (options?.frequency) {
      payments = payments.filter((p) => p.frequency === options.frequency);
    }

    return payments.sort((a, b) => a.nextExpectedDate - b.nextExpectedDate);
  }

  /**
   * Get monthly recurring total
   */
  getMonthlyTotal(): { total: number; breakdown: Array<{ name: string; amount: number }> } {
    const payments = this.getRecurringPayments({ activeOnly: true });
    const breakdown: Array<{ name: string; amount: number }> = [];

    let total = 0;
    for (const payment of payments) {
      let monthlyAmount = payment.amount;

      // Normalize to monthly
      switch (payment.frequency) {
        case 'weekly':
          monthlyAmount *= 4.33;
          break;
        case 'fortnightly':
          monthlyAmount *= 2.17;
          break;
        case 'quarterly':
          monthlyAmount /= 3;
          break;
        case 'annual':
          monthlyAmount /= 12;
          break;
      }

      total += monthlyAmount;
      breakdown.push({ name: payment.merchantName, amount: monthlyAmount });
    }

    breakdown.sort((a, b) => b.amount - a.amount);

    return { total, breakdown };
  }

  /**
   * Mark recurring payment as inactive
   */
  markInactive(id: string): boolean {
    const payment = this.recurring.get(id);
    if (payment) {
      payment.isActive = false;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Mark recurring payment as active
   */
  markActive(id: string): boolean {
    const payment = this.recurring.get(id);
    if (payment) {
      payment.isActive = true;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Delete recurring payment
   */
  deleteRecurring(id: string): boolean {
    const deleted = this.recurring.delete(id);
    if (deleted) {
      this.saveData();
    }
    return deleted;
  }

  /**
   * Get price change alerts
   */
  getPriceAlerts(unacknowledgedOnly = false): PriceChangeAlert[] {
    if (unacknowledgedOnly) {
      return this.priceAlerts.filter((a) => !a.acknowledged);
    }
    return [...this.priceAlerts];
  }

  /**
   * Get missed payment alerts
   */
  getMissedAlerts(unacknowledgedOnly = false): MissedPaymentAlert[] {
    if (unacknowledgedOnly) {
      return this.missedAlerts.filter((a) => !a.acknowledged);
    }
    return [...this.missedAlerts];
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const priceAlert = this.priceAlerts.find((a) => a.id === alertId);
    if (priceAlert) {
      priceAlert.acknowledged = true;
      this.saveData();
      return true;
    }

    const missedAlert = this.missedAlerts.find((a) => a.id === alertId);
    if (missedAlert) {
      missedAlert.acknowledged = true;
      this.saveData();
      return true;
    }

    return false;
  }

  /**
   * Add note to recurring payment
   */
  addNote(id: string, note: string): boolean {
    const payment = this.recurring.get(id);
    if (payment) {
      payment.notes = note;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Get upcoming payments for next N days
   */
  getUpcoming(days: number = 30): RecurringPayment[] {
    const now = Date.now();
    const cutoff = now + days * 24 * 60 * 60 * 1000;

    return this.getRecurringPayments({ activeOnly: true }).filter(
      (p) => p.nextExpectedDate <= cutoff
    );
  }
}

// Singleton instance
let detector: RecurringPaymentDetector | null = null;

export function getRecurringPaymentDetector(): RecurringPaymentDetector {
  if (!detector) {
    detector = new RecurringPaymentDetector();
  }
  return detector;
}
