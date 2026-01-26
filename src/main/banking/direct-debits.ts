/**
 * Atlas Banking - Direct Debit Manager
 *
 * View and manage active direct debits and standing orders.
 * Track mandates and upcoming collections.
 *
 * @module banking/direct-debits
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BankTransaction } from './types';

const logger = createModuleLogger('DirectDebits');

/**
 * Direct debit status
 */
export type DirectDebitStatus = 'active' | 'suspended' | 'cancelled';

/**
 * Direct debit information
 */
export interface DirectDebit {
  id: string;
  merchantName: string;
  merchantId?: string;
  reference: string;
  setupDate: number;
  lastCollectionDate?: number;
  lastCollectionAmount?: number;
  nextCollectionDate?: number;
  expectedAmount?: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'variable';
  status: DirectDebitStatus;
  accountId: string;
  bankName?: string;
  serviceUserNumber?: string; // UK DD SUN
  notes?: string;
  history: Array<{
    date: number;
    amount: number;
    status: 'collected' | 'rejected' | 'returned';
  }>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Standing order information
 */
export interface StandingOrder {
  id: string;
  recipientName: string;
  recipientSortCode: string;
  recipientAccountNumber: string;
  reference: string;
  amount: number;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';
  nextPaymentDate: number;
  lastPaymentDate?: number;
  setupDate: number;
  endDate?: number;
  status: 'active' | 'suspended' | 'completed' | 'cancelled';
  accountId: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Direct Debit Manager
 */
export class DirectDebitManager extends EventEmitter {
  private directDebits: Map<string, DirectDebit> = new Map();
  private standingOrders: Map<string, StandingOrder> = new Map();
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load direct debit data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'direct-debits.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.directDebits = new Map(Object.entries(data.directDebits || {}));
        this.standingOrders = new Map(Object.entries(data.standingOrders || {}));
        logger.info('Loaded direct debit data', {
          directDebits: this.directDebits.size,
          standingOrders: this.standingOrders.size,
        });
      }
    } catch (error) {
      logger.warn('Failed to load direct debit data', { error: (error as Error).message });
    }
  }

  /**
   * Save direct debit data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'direct-debits.json');
      const data = {
        directDebits: Object.fromEntries(this.directDebits),
        standingOrders: Object.fromEntries(this.standingOrders),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save direct debit data', { error: (error as Error).message });
    }
  }

  /**
   * Detect direct debits from transaction history
   */
  detectFromTransactions(transactions: BankTransaction[]): {
    directDebits: DirectDebit[];
    standingOrders: StandingOrder[];
  } {
    const newDirectDebits: DirectDebit[] = [];
    const newStandingOrders: StandingOrder[] = [];

    // Group by merchant/payee
    const groupedByMerchant = new Map<string, BankTransaction[]>();

    for (const tx of transactions) {
      // Only consider outgoing transactions
      if (tx.amount >= 0) continue;

      // Identify DD/SO indicators in description
      const isDirectDebit =
        /direct\s*debit|dd\s*|d\/d/i.test(tx.description) ||
        tx.transactionType === 'direct_debit';
      const isStandingOrder =
        /standing\s*order|s\/o|sto\s*/i.test(tx.description) ||
        tx.transactionType === 'standing_order';

      if (!isDirectDebit && !isStandingOrder) continue;

      const key = (tx.merchantName || tx.description).toLowerCase().trim();
      if (!groupedByMerchant.has(key)) {
        groupedByMerchant.set(key, []);
      }
      groupedByMerchant.get(key)!.push(tx);
    }

    // Analyze each group
    for (const [merchant, txs] of groupedByMerchant) {
      if (txs.length < 1) continue;

      // Sort by date
      txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const latestTx = txs[txs.length - 1];
      const isDirectDebit =
        /direct\s*debit|dd\s*|d\/d/i.test(latestTx.description) ||
        latestTx.transactionType === 'direct_debit';

      // Check if we already have this
      const existingDD = Array.from(this.directDebits.values()).find(
        (dd) => dd.merchantName.toLowerCase() === merchant
      );
      const existingSO = Array.from(this.standingOrders.values()).find(
        (so) => so.recipientName.toLowerCase() === merchant
      );

      if (existingDD || existingSO) {
        // Update existing
        if (existingDD) {
          existingDD.lastCollectionDate = new Date(latestTx.date).getTime();
          existingDD.lastCollectionAmount = Math.abs(latestTx.amount);
          existingDD.history.push({
            date: new Date(latestTx.date).getTime(),
            amount: Math.abs(latestTx.amount),
            status: 'collected',
          });
          existingDD.updatedAt = Date.now();
          this.calculateNextCollection(existingDD);
        }
        continue;
      }

      // Detect frequency
      const frequency = this.detectFrequency(txs);

      if (isDirectDebit) {
        const dd: DirectDebit = {
          id: `dd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          merchantName: latestTx.merchantName || merchant,
          reference: latestTx.reference || '',
          setupDate: new Date(txs[0].date).getTime(),
          lastCollectionDate: new Date(latestTx.date).getTime(),
          lastCollectionAmount: Math.abs(latestTx.amount),
          expectedAmount: this.calculateExpectedAmount(txs),
          frequency,
          status: 'active',
          accountId: latestTx.accountId,
          history: txs.map((tx) => ({
            date: new Date(tx.date).getTime(),
            amount: Math.abs(tx.amount),
            status: 'collected' as const,
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        this.calculateNextCollection(dd);
        this.directDebits.set(dd.id, dd);
        newDirectDebits.push(dd);
        this.emit('directDebitDetected', dd);
      } else {
        const so: StandingOrder = {
          id: `so_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          recipientName: latestTx.merchantName || merchant,
          recipientSortCode: '', // Not available from transaction
          recipientAccountNumber: '',
          reference: latestTx.reference || '',
          amount: Math.abs(latestTx.amount),
          frequency: frequency as StandingOrder['frequency'],
          nextPaymentDate: 0,
          lastPaymentDate: new Date(latestTx.date).getTime(),
          setupDate: new Date(txs[0].date).getTime(),
          status: 'active',
          accountId: latestTx.accountId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        this.calculateNextPayment(so);
        this.standingOrders.set(so.id, so);
        newStandingOrders.push(so);
        this.emit('standingOrderDetected', so);
      }
    }

    if (newDirectDebits.length > 0 || newStandingOrders.length > 0) {
      this.saveData();
      logger.info('Detected payment mandates', {
        directDebits: newDirectDebits.length,
        standingOrders: newStandingOrders.length,
      });
    }

    return { directDebits: newDirectDebits, standingOrders: newStandingOrders };
  }

  /**
   * Detect payment frequency from transactions
   */
  private detectFrequency(
    txs: BankTransaction[]
  ): DirectDebit['frequency'] {
    if (txs.length < 2) return 'variable';

    // Calculate average interval
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      const interval =
        new Date(txs[i].date).getTime() - new Date(txs[i - 1].date).getTime();
      intervals.push(interval / (24 * 60 * 60 * 1000)); // Days
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    if (avgInterval < 10) return 'weekly';
    if (avgInterval < 35) return 'monthly';
    if (avgInterval < 100) return 'quarterly';
    if (avgInterval < 400) return 'annually';
    return 'variable';
  }

  /**
   * Calculate expected amount from history
   */
  private calculateExpectedAmount(txs: BankTransaction[]): number {
    const amounts = txs.map((tx) => Math.abs(tx.amount));
    // Use most recent amount or average if variable
    const variance =
      amounts.reduce((sum, a) => sum + Math.pow(a - amounts[0], 2), 0) / amounts.length;

    if (variance < 1) {
      // Amounts are consistent
      return amounts[amounts.length - 1];
    }

    // Return average for variable amounts
    return amounts.reduce((a, b) => a + b, 0) / amounts.length;
  }

  /**
   * Calculate next collection date for direct debit
   */
  private calculateNextCollection(dd: DirectDebit): void {
    if (!dd.lastCollectionDate) return;

    const last = new Date(dd.lastCollectionDate);
    const next = new Date(last);

    switch (dd.frequency) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'annually':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        // Variable - estimate 30 days
        next.setDate(next.getDate() + 30);
    }

    dd.nextCollectionDate = next.getTime();
  }

  /**
   * Calculate next payment date for standing order
   */
  private calculateNextPayment(so: StandingOrder): void {
    const last = so.lastPaymentDate ? new Date(so.lastPaymentDate) : new Date(so.setupDate);
    const next = new Date(last);

    switch (so.frequency) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'fortnightly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'annually':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }

    so.nextPaymentDate = next.getTime();
  }

  /**
   * Get all direct debits
   */
  getDirectDebits(options?: {
    status?: DirectDebitStatus;
    accountId?: string;
  }): DirectDebit[] {
    let debits = Array.from(this.directDebits.values());

    if (options?.status) {
      debits = debits.filter((dd) => dd.status === options.status);
    }
    if (options?.accountId) {
      debits = debits.filter((dd) => dd.accountId === options.accountId);
    }

    return debits.sort((a, b) => (a.nextCollectionDate || 0) - (b.nextCollectionDate || 0));
  }

  /**
   * Get all standing orders
   */
  getStandingOrders(options?: {
    status?: StandingOrder['status'];
    accountId?: string;
  }): StandingOrder[] {
    let orders = Array.from(this.standingOrders.values());

    if (options?.status) {
      orders = orders.filter((so) => so.status === options.status);
    }
    if (options?.accountId) {
      orders = orders.filter((so) => so.accountId === options.accountId);
    }

    return orders.sort((a, b) => a.nextPaymentDate - b.nextPaymentDate);
  }

  /**
   * Get upcoming payments (both DD and SO)
   */
  getUpcoming(days: number = 30): Array<{
    type: 'direct_debit' | 'standing_order';
    name: string;
    amount: number;
    date: number;
    id: string;
  }> {
    const cutoff = Date.now() + days * 24 * 60 * 60 * 1000;
    const upcoming: Array<{
      type: 'direct_debit' | 'standing_order';
      name: string;
      amount: number;
      date: number;
      id: string;
    }> = [];

    for (const dd of this.directDebits.values()) {
      if (dd.status === 'active' && dd.nextCollectionDate && dd.nextCollectionDate <= cutoff) {
        upcoming.push({
          type: 'direct_debit',
          name: dd.merchantName,
          amount: dd.expectedAmount || dd.lastCollectionAmount || 0,
          date: dd.nextCollectionDate,
          id: dd.id,
        });
      }
    }

    for (const so of this.standingOrders.values()) {
      if (so.status === 'active' && so.nextPaymentDate <= cutoff) {
        upcoming.push({
          type: 'standing_order',
          name: so.recipientName,
          amount: so.amount,
          date: so.nextPaymentDate,
          id: so.id,
        });
      }
    }

    return upcoming.sort((a, b) => a.date - b.date);
  }

  /**
   * Get monthly committed amount
   */
  getMonthlyCommitted(): {
    directDebits: number;
    standingOrders: number;
    total: number;
    breakdown: Array<{ name: string; amount: number; type: string }>;
  } {
    let directDebitTotal = 0;
    let standingOrderTotal = 0;
    const breakdown: Array<{ name: string; amount: number; type: string }> = [];

    for (const dd of this.directDebits.values()) {
      if (dd.status !== 'active') continue;

      let monthlyAmount = dd.expectedAmount || dd.lastCollectionAmount || 0;
      switch (dd.frequency) {
        case 'weekly':
          monthlyAmount *= 4.33;
          break;
        case 'quarterly':
          monthlyAmount /= 3;
          break;
        case 'annually':
          monthlyAmount /= 12;
          break;
      }

      directDebitTotal += monthlyAmount;
      breakdown.push({
        name: dd.merchantName,
        amount: monthlyAmount,
        type: 'Direct Debit',
      });
    }

    for (const so of this.standingOrders.values()) {
      if (so.status !== 'active') continue;

      let monthlyAmount = so.amount;
      switch (so.frequency) {
        case 'weekly':
          monthlyAmount *= 4.33;
          break;
        case 'fortnightly':
          monthlyAmount *= 2.17;
          break;
        case 'quarterly':
          monthlyAmount /= 3;
          break;
        case 'annually':
          monthlyAmount /= 12;
          break;
      }

      standingOrderTotal += monthlyAmount;
      breakdown.push({
        name: so.recipientName,
        amount: monthlyAmount,
        type: 'Standing Order',
      });
    }

    breakdown.sort((a, b) => b.amount - a.amount);

    return {
      directDebits: directDebitTotal,
      standingOrders: standingOrderTotal,
      total: directDebitTotal + standingOrderTotal,
      breakdown,
    };
  }

  /**
   * Cancel a direct debit
   */
  cancelDirectDebit(id: string, reason?: string): boolean {
    const dd = this.directDebits.get(id);
    if (!dd) return false;

    dd.status = 'cancelled';
    dd.notes = reason ? `Cancelled: ${reason}` : 'Cancelled';
    dd.updatedAt = Date.now();
    this.saveData();

    logger.info('Cancelled direct debit', { id, merchant: dd.merchantName });
    this.emit('directDebitCancelled', dd);

    return true;
  }

  /**
   * Cancel a standing order
   */
  cancelStandingOrder(id: string, reason?: string): boolean {
    const so = this.standingOrders.get(id);
    if (!so) return false;

    so.status = 'cancelled';
    so.notes = reason ? `Cancelled: ${reason}` : 'Cancelled';
    so.updatedAt = Date.now();
    this.saveData();

    logger.info('Cancelled standing order', { id, recipient: so.recipientName });
    this.emit('standingOrderCancelled', so);

    return true;
  }

  /**
   * Add note to direct debit
   */
  addNoteToDirectDebit(id: string, note: string): boolean {
    const dd = this.directDebits.get(id);
    if (!dd) return false;

    dd.notes = note;
    dd.updatedAt = Date.now();
    this.saveData();

    return true;
  }

  /**
   * Add note to standing order
   */
  addNoteToStandingOrder(id: string, note: string): boolean {
    const so = this.standingOrders.get(id);
    if (!so) return false;

    so.notes = note;
    so.updatedAt = Date.now();
    this.saveData();

    return true;
  }

  /**
   * Get summary
   */
  getSummary(): {
    activeDirectDebits: number;
    activeStandingOrders: number;
    totalMonthly: number;
    nextPaymentDate: number | null;
    nextPaymentAmount: number;
    nextPaymentName: string;
  } {
    const activeDD = this.getDirectDebits({ status: 'active' });
    const activeSO = this.getStandingOrders({ status: 'active' });
    const monthly = this.getMonthlyCommitted();
    const upcoming = this.getUpcoming(7);

    return {
      activeDirectDebits: activeDD.length,
      activeStandingOrders: activeSO.length,
      totalMonthly: monthly.total,
      nextPaymentDate: upcoming[0]?.date || null,
      nextPaymentAmount: upcoming[0]?.amount || 0,
      nextPaymentName: upcoming[0]?.name || '',
    };
  }
}

// Singleton instance
let ddManager: DirectDebitManager | null = null;

export function getDirectDebitManager(): DirectDebitManager {
  if (!ddManager) {
    ddManager = new DirectDebitManager();
  }
  return ddManager;
}
