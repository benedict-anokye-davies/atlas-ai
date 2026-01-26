/**
 * Atlas Banking - Budget Manager
 *
 * Category-based budget tracking with alerts and progress monitoring.
 * Supports monthly budgets with rollover options.
 *
 * @module banking/budget-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BankTransaction } from './types';

const logger = createModuleLogger('BudgetManager');

/**
 * Budget period type
 */
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

/**
 * Budget configuration
 */
export interface Budget {
  id: string;
  name: string;
  category: string;
  amount: number;
  period: BudgetPeriod;
  spent: number;
  remaining: number;
  percentUsed: number;
  startDate: number;
  endDate: number;
  rollover: boolean;
  carryOver: number;
  alerts: {
    at50: boolean;
    at75: boolean;
    at90: boolean;
    atLimit: boolean;
  };
  alertsSent: {
    at50: boolean;
    at75: boolean;
    at90: boolean;
    atLimit: boolean;
  };
  createdAt: number;
  isActive: boolean;
}

/**
 * Budget alert
 */
export interface BudgetAlert {
  id: string;
  budgetId: string;
  budgetName: string;
  category: string;
  type: '50%' | '75%' | '90%' | '100%' | 'exceeded';
  spent: number;
  limit: number;
  percentUsed: number;
  triggeredAt: number;
  acknowledged: boolean;
}

/**
 * Budget summary
 */
export interface BudgetSummary {
  totalBudgeted: number;
  totalSpent: number;
  totalRemaining: number;
  overallPercent: number;
  budgetsOverLimit: number;
  budgetsOnTrack: number;
  budgetsCautionary: number;
}

/**
 * Budget Manager
 */
export class BudgetManager extends EventEmitter {
  private budgets: Map<string, Budget> = new Map();
  private alerts: BudgetAlert[] = [];
  private transactionCache: Map<string, number> = new Map(); // txId -> budgetId mapping
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load budget data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'budgets.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.budgets = new Map(Object.entries(data.budgets || {}));
        this.alerts = data.alerts || [];
        this.transactionCache = new Map(Object.entries(data.transactionCache || {}));
        logger.info('Loaded budget data', { budgets: this.budgets.size });
      }
    } catch (error) {
      logger.warn('Failed to load budget data', { error: (error as Error).message });
    }
  }

  /**
   * Save budget data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'budgets.json');
      const data = {
        budgets: Object.fromEntries(this.budgets),
        alerts: this.alerts.slice(-200),
        transactionCache: Object.fromEntries(this.transactionCache),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save budget data', { error: (error as Error).message });
    }
  }

  /**
   * Calculate period start and end dates
   */
  private calculatePeriodDates(period: BudgetPeriod): { start: number; end: number } {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (period) {
      case 'weekly':
        // Start from Monday
        start = new Date(now);
        start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;

      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;

      case 'yearly':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;
    }

    return { start: start.getTime(), end: end.getTime() };
  }

  /**
   * Create a new budget
   */
  createBudget(options: {
    name: string;
    category: string;
    amount: number;
    period?: BudgetPeriod;
    rollover?: boolean;
    alerts?: {
      at50?: boolean;
      at75?: boolean;
      at90?: boolean;
      atLimit?: boolean;
    };
  }): Budget {
    const period = options.period || 'monthly';
    const { start, end } = this.calculatePeriodDates(period);

    const budget: Budget = {
      id: `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: options.name,
      category: options.category.toLowerCase(),
      amount: options.amount,
      period,
      spent: 0,
      remaining: options.amount,
      percentUsed: 0,
      startDate: start,
      endDate: end,
      rollover: options.rollover ?? false,
      carryOver: 0,
      alerts: {
        at50: options.alerts?.at50 ?? true,
        at75: options.alerts?.at75 ?? true,
        at90: options.alerts?.at90 ?? true,
        atLimit: options.alerts?.atLimit ?? true,
      },
      alertsSent: {
        at50: false,
        at75: false,
        at90: false,
        atLimit: false,
      },
      createdAt: Date.now(),
      isActive: true,
    };

    this.budgets.set(budget.id, budget);
    this.saveData();

    logger.info('Created budget', { budget: budget.name, amount: budget.amount });
    this.emit('created', budget);

    return budget;
  }

  /**
   * Update a budget
   */
  updateBudget(id: string, updates: Partial<Omit<Budget, 'id' | 'createdAt'>>): Budget | null {
    const budget = this.budgets.get(id);
    if (!budget) return null;

    // Handle amount change
    if (updates.amount !== undefined && updates.amount !== budget.amount) {
      budget.amount = updates.amount;
      budget.remaining = budget.amount + budget.carryOver - budget.spent;
      budget.percentUsed = (budget.spent / (budget.amount + budget.carryOver)) * 100;
    }

    // Apply other updates
    Object.assign(budget, updates);
    this.budgets.set(id, budget);
    this.saveData();

    this.emit('updated', budget);
    return budget;
  }

  /**
   * Delete a budget
   */
  deleteBudget(id: string): boolean {
    const deleted = this.budgets.delete(id);
    if (deleted) {
      this.saveData();
      this.emit('deleted', id);
    }
    return deleted;
  }

  /**
   * Get a budget by ID
   */
  getBudget(id: string): Budget | undefined {
    return this.budgets.get(id);
  }

  /**
   * Get all budgets
   */
  getBudgets(options?: {
    activeOnly?: boolean;
    category?: string;
    period?: BudgetPeriod;
  }): Budget[] {
    let budgets = Array.from(this.budgets.values());

    if (options?.activeOnly) {
      budgets = budgets.filter((b) => b.isActive);
    }
    if (options?.category) {
      budgets = budgets.filter((b) => b.category === options.category.toLowerCase());
    }
    if (options?.period) {
      budgets = budgets.filter((b) => b.period === options.period);
    }

    return budgets.sort((a, b) => b.percentUsed - a.percentUsed);
  }

  /**
   * Get budget for a category
   */
  getBudgetForCategory(category: string): Budget | undefined {
    const normalizedCategory = category.toLowerCase();
    return Array.from(this.budgets.values()).find(
      (b) => b.category === normalizedCategory && b.isActive
    );
  }

  /**
   * Process transactions to update budget spending
   */
  processTransactions(
    transactions: BankTransaction[],
    categoryFn?: (tx: BankTransaction) => string
  ): BudgetAlert[] {
    const newAlerts: BudgetAlert[] = [];

    // Reset all budget spending for fresh calculation
    for (const budget of this.budgets.values()) {
      if (!budget.isActive) continue;

      // Check if budget period has ended
      if (Date.now() > budget.endDate) {
        this.rolloverBudget(budget);
        continue;
      }

      budget.spent = 0;
    }

    // Calculate spending from transactions
    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // Only consider outgoing

      const txDate = new Date(tx.date).getTime();
      const category = categoryFn ? categoryFn(tx) : tx.category || 'uncategorized';
      const normalizedCategory = category.toLowerCase();

      // Find matching budget
      const budget = Array.from(this.budgets.values()).find(
        (b) =>
          b.category === normalizedCategory &&
          b.isActive &&
          txDate >= b.startDate &&
          txDate <= b.endDate
      );

      if (budget) {
        budget.spent += Math.abs(tx.amount);
        this.transactionCache.set(tx.id, Date.now());
      }
    }

    // Update budget calculations and check alerts
    for (const budget of this.budgets.values()) {
      if (!budget.isActive) continue;

      const totalBudget = budget.amount + budget.carryOver;
      budget.remaining = Math.max(0, totalBudget - budget.spent);
      budget.percentUsed = (budget.spent / totalBudget) * 100;

      // Check alert thresholds
      const alerts = this.checkBudgetAlerts(budget);
      newAlerts.push(...alerts);
    }

    this.saveData();
    return newAlerts;
  }

  /**
   * Check and generate budget alerts
   */
  private checkBudgetAlerts(budget: Budget): BudgetAlert[] {
    const newAlerts: BudgetAlert[] = [];

    const checkThreshold = (
      threshold: number,
      type: '50%' | '75%' | '90%' | '100%',
      key: 'at50' | 'at75' | 'at90' | 'atLimit'
    ) => {
      if (
        budget.alerts[key] &&
        !budget.alertsSent[key] &&
        budget.percentUsed >= threshold
      ) {
        const alert: BudgetAlert = {
          id: `ba_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          budgetId: budget.id,
          budgetName: budget.name,
          category: budget.category,
          type,
          spent: budget.spent,
          limit: budget.amount + budget.carryOver,
          percentUsed: budget.percentUsed,
          triggeredAt: Date.now(),
          acknowledged: false,
        };
        this.alerts.push(alert);
        newAlerts.push(alert);
        budget.alertsSent[key] = true;
        this.emit('alert', alert);
      }
    };

    checkThreshold(50, '50%', 'at50');
    checkThreshold(75, '75%', 'at75');
    checkThreshold(90, '90%', 'at90');
    checkThreshold(100, '100%', 'atLimit');

    // Check if exceeded
    if (budget.percentUsed > 100) {
      const existingExceeded = this.alerts.find(
        (a) =>
          a.budgetId === budget.id &&
          a.type === 'exceeded' &&
          Date.now() - a.triggeredAt < 24 * 60 * 60 * 1000
      );

      if (!existingExceeded) {
        const alert: BudgetAlert = {
          id: `ba_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          budgetId: budget.id,
          budgetName: budget.name,
          category: budget.category,
          type: 'exceeded',
          spent: budget.spent,
          limit: budget.amount + budget.carryOver,
          percentUsed: budget.percentUsed,
          triggeredAt: Date.now(),
          acknowledged: false,
        };
        this.alerts.push(alert);
        newAlerts.push(alert);
        this.emit('alert', alert);
      }
    }

    return newAlerts;
  }

  /**
   * Rollover budget to new period
   */
  private rolloverBudget(budget: Budget): void {
    const { start, end } = this.calculatePeriodDates(budget.period);

    // Calculate carryover
    if (budget.rollover && budget.remaining > 0) {
      budget.carryOver = Math.min(budget.remaining, budget.amount * 0.5); // Max 50% carryover
    } else {
      budget.carryOver = 0;
    }

    // Reset for new period
    budget.spent = 0;
    budget.remaining = budget.amount + budget.carryOver;
    budget.percentUsed = 0;
    budget.startDate = start;
    budget.endDate = end;
    budget.alertsSent = {
      at50: false,
      at75: false,
      at90: false,
      atLimit: false,
    };

    logger.info('Budget rolled over', {
      budget: budget.name,
      carryOver: budget.carryOver,
    });

    this.emit('rollover', budget);
    this.saveData();
  }

  /**
   * Get budget summary
   */
  getSummary(): BudgetSummary {
    const activeBudgets = this.getBudgets({ activeOnly: true });

    const summary: BudgetSummary = {
      totalBudgeted: 0,
      totalSpent: 0,
      totalRemaining: 0,
      overallPercent: 0,
      budgetsOverLimit: 0,
      budgetsOnTrack: 0,
      budgetsCautionary: 0,
    };

    for (const budget of activeBudgets) {
      summary.totalBudgeted += budget.amount + budget.carryOver;
      summary.totalSpent += budget.spent;
      summary.totalRemaining += budget.remaining;

      if (budget.percentUsed > 100) {
        summary.budgetsOverLimit++;
      } else if (budget.percentUsed > 75) {
        summary.budgetsCautionary++;
      } else {
        summary.budgetsOnTrack++;
      }
    }

    summary.overallPercent =
      summary.totalBudgeted > 0 ? (summary.totalSpent / summary.totalBudgeted) * 100 : 0;

    return summary;
  }

  /**
   * Get unacknowledged alerts
   */
  getActiveAlerts(): BudgetAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.saveData();
      return true;
    }
    return false;
  }

  /**
   * Get spending progress for a category this period
   */
  getCategoryProgress(category: string): {
    hasBudget: boolean;
    budget?: Budget;
    spent: number;
    remaining: number;
    percentUsed: number;
    daysRemaining: number;
    dailyBudget: number;
  } | null {
    const budget = this.getBudgetForCategory(category);
    if (!budget) {
      return { hasBudget: false, spent: 0, remaining: 0, percentUsed: 0, daysRemaining: 0, dailyBudget: 0 };
    }

    const daysRemaining = Math.ceil(
      (budget.endDate - Date.now()) / (24 * 60 * 60 * 1000)
    );
    const dailyBudget = daysRemaining > 0 ? budget.remaining / daysRemaining : 0;

    return {
      hasBudget: true,
      budget,
      spent: budget.spent,
      remaining: budget.remaining,
      percentUsed: budget.percentUsed,
      daysRemaining,
      dailyBudget,
    };
  }

  /**
   * Quick budget creation with smart defaults
   */
  createQuickBudget(category: string, monthlyAmount: number): Budget {
    const name = `${category.charAt(0).toUpperCase() + category.slice(1)} Budget`;
    return this.createBudget({
      name,
      category,
      amount: monthlyAmount,
      period: 'monthly',
      rollover: true,
    });
  }

  /**
   * Get suggested budgets based on spending history
   */
  getSuggestedBudgets(
    spendingByCategory: Record<string, number>
  ): Array<{ category: string; suggested: number; current?: number }> {
    const suggestions: Array<{ category: string; suggested: number; current?: number }> = [];
    const existingBudgets = this.getBudgets({ activeOnly: true });

    for (const [category, spent] of Object.entries(spendingByCategory)) {
      // Add 10% buffer to average spending
      const suggested = Math.round((spent * 1.1) / 10) * 10; // Round to nearest £10

      const existing = existingBudgets.find((b) => b.category === category.toLowerCase());

      if (!existing || existing.amount !== suggested) {
        suggestions.push({
          category,
          suggested,
          current: existing?.amount,
        });
      }
    }

    return suggestions.sort((a, b) => b.suggested - a.suggested);
  }
}

// Singleton instance
let budgetManager: BudgetManager | null = null;

export function getBudgetManager(): BudgetManager {
  if (!budgetManager) {
    budgetManager = new BudgetManager();
  }
  return budgetManager;
}
