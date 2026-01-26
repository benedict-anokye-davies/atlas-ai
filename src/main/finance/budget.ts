/**
 * Atlas Finance - Budget Manager
 *
 * Handles budget creation, tracking, and alerts.
 *
 * @module finance/budget
 */

import Decimal from 'decimal.js';
import { EventEmitter } from 'events';
import keytar from 'keytar';
import { createModuleLogger } from '../utils/logger';
import { Budget, BudgetPeriod, BudgetStatus, TransactionCategory } from './types';
import { getTransactionManager } from './transactions';

const logger = createModuleLogger('BudgetManager');

const SERVICE_NAME = 'atlas-finance';
const BUDGETS_ACCOUNT = 'budgets';

/**
 * Get period date range
 */
function getPeriodDateRange(period: BudgetPeriod): { start: string; end: string } {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (period) {
    case 'daily':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      break;

    case 'weekly': {
      // Start from Monday
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
    }

    case 'monthly':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;

    case 'yearly':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear() + 1, 0, 1);
      break;
  }

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/**
 * Get days remaining in period
 */
function getDaysRemaining(period: BudgetPeriod): number {
  const { end } = getPeriodDateRange(period);
  const endDate = new Date(end);
  const now = new Date();
  const diffMs = endDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Budget Manager
 *
 * Creates and tracks budgets for spending categories.
 */
export class BudgetManager extends EventEmitter {
  private budgets: Map<string, Budget> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize budget manager and load saved budgets
   */
  async initialize(): Promise<void> {
    await this.loadBudgets();
    this.startMonitoring();
    logger.info('Budget manager initialized', { budgetCount: this.budgets.size });
  }

  /**
   * Load budgets from secure storage
   */
  private async loadBudgets(): Promise<void> {
    try {
      const budgetsJson = await keytar.getPassword(SERVICE_NAME, BUDGETS_ACCOUNT);

      if (budgetsJson) {
        const budgetsArray = JSON.parse(budgetsJson) as Budget[];

        for (const budget of budgetsArray) {
          // Restore Decimal objects
          budget.amount = new Decimal(budget.amount);
          this.budgets.set(budget.id, budget);
        }

        logger.debug('Loaded budgets', { count: this.budgets.size });
      }
    } catch (error) {
      logger.error('Failed to load budgets', { error: (error as Error).message });
    }
  }

  /**
   * Save budgets to secure storage
   */
  private async saveBudgets(): Promise<void> {
    try {
      const budgetsArray = Array.from(this.budgets.values()).map((b) => ({
        ...b,
        amount: b.amount.toString(),
      }));

      await keytar.setPassword(SERVICE_NAME, BUDGETS_ACCOUNT, JSON.stringify(budgetsArray));
      logger.debug('Saved budgets');
    } catch (error) {
      logger.error('Failed to save budgets', { error: (error as Error).message });
    }
  }

  /**
   * Start budget monitoring (check every hour)
   */
  private startMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Check budgets every hour
    this.checkInterval = setInterval(
      () => {
        this.checkAllBudgets();
      },
      60 * 60 * 1000
    );

    // Initial check
    this.checkAllBudgets();
  }

  /**
   * Check all budgets and emit warnings
   */
  private async checkAllBudgets(): Promise<void> {
    try {
      for (const budget of this.budgets.values()) {
        if (!budget.active) continue;

        const status = await this.getBudgetStatus(budget.id);

        if (!status) continue;

        // Check if over budget
        if (status.overBudget) {
          this.emit('budget:exceeded', status);
          logger.warn('Budget exceeded', {
            category: budget.category,
            spent: status.spent.toString(),
            budget: budget.amount.toString(),
          });
        }
        // Check if approaching threshold
        else if (budget.alertThreshold && status.percentUsed >= budget.alertThreshold * 100) {
          this.emit('budget:warning', status);
          logger.info('Budget warning', {
            category: budget.category,
            percentUsed: status.percentUsed.toFixed(1),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to check budgets', { error: (error as Error).message });
    }
  }

  /**
   * Create a new budget
   */
  async createBudget(
    category: TransactionCategory,
    amount: number | Decimal,
    period: BudgetPeriod,
    options?: {
      currency?: string;
      alertThreshold?: number;
    }
  ): Promise<Budget> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const budget: Budget = {
      id,
      category,
      amount: new Decimal(amount),
      currency: options?.currency || 'GBP',
      period,
      createdAt: now,
      updatedAt: now,
      active: true,
      alertThreshold: options?.alertThreshold,
    };

    this.budgets.set(id, budget);
    await this.saveBudgets();

    logger.info('Budget created', { id, category, amount: amount.toString(), period });
    return budget;
  }

  /**
   * Update an existing budget
   */
  async updateBudget(
    id: string,
    updates: {
      amount?: number | Decimal;
      period?: BudgetPeriod;
      alertThreshold?: number;
      active?: boolean;
    }
  ): Promise<Budget | null> {
    const budget = this.budgets.get(id);

    if (!budget) {
      logger.warn('Budget not found', { id });
      return null;
    }

    const updated: Budget = {
      ...budget,
      period: updates.period ?? budget.period,
      alertThreshold: updates.alertThreshold ?? budget.alertThreshold,
      active: updates.active ?? budget.active,
      amount: updates.amount !== undefined ? new Decimal(updates.amount) : budget.amount,
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(id, updated);
    await this.saveBudgets();

    logger.info('Budget updated', { id, updates });
    return updated;
  }

  /**
   * Delete a budget
   */
  async deleteBudget(id: string): Promise<boolean> {
    const deleted = this.budgets.delete(id);

    if (deleted) {
      await this.saveBudgets();
      logger.info('Budget deleted', { id });
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
  getAllBudgets(): Budget[] {
    return Array.from(this.budgets.values());
  }

  /**
   * Get budgets by category
   */
  getBudgetsByCategory(category: TransactionCategory): Budget[] {
    return Array.from(this.budgets.values()).filter((b) => b.category === category);
  }

  /**
   * Get budget status for a specific budget
   */
  async getBudgetStatus(budgetId: string): Promise<BudgetStatus | null> {
    const budget = this.budgets.get(budgetId);

    if (!budget) {
      return null;
    }

    try {
      const { start, end } = getPeriodDateRange(budget.period);
      const transactionManager = getTransactionManager();

      // Get spending for this category in the current period
      const spending = await transactionManager.getSpendingByCategory(start, end, budget.currency);
      const categorySpending = spending.find((s) => s.category === budget.category);

      const spent = categorySpending?.amount || new Decimal(0);
      const remaining = budget.amount.minus(spent);
      const percentUsed = budget.amount.isZero()
        ? 0
        : spent.div(budget.amount).times(100).toNumber();

      const daysRemaining = getDaysRemaining(budget.period);

      // Project spending based on current rate
      const daysInPeriod =
        budget.period === 'daily'
          ? 1
          : budget.period === 'weekly'
            ? 7
            : budget.period === 'monthly'
              ? 30
              : 365;
      const daysElapsed = Math.max(1, daysInPeriod - daysRemaining);
      const dailyRate = spent.div(daysElapsed);
      const projectedSpend = dailyRate.times(daysInPeriod);

      return {
        budget,
        periodStart: start,
        periodEnd: end,
        spent,
        remaining,
        percentUsed,
        overBudget: spent.gt(budget.amount),
        daysRemaining,
        projectedSpend,
      };
    } catch (error) {
      logger.error('Failed to get budget status', { budgetId, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Get status for all active budgets
   */
  async getAllBudgetStatuses(): Promise<BudgetStatus[]> {
    const statuses: BudgetStatus[] = [];

    for (const budget of this.budgets.values()) {
      if (!budget.active) continue;

      const status = await this.getBudgetStatus(budget.id);
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * Get summary of budget health
   */
  async getBudgetSummary(): Promise<{
    totalBudgets: number;
    activeBudgets: number;
    overBudget: number;
    nearLimit: number;
    healthy: number;
  }> {
    const statuses = await this.getAllBudgetStatuses();

    let overBudget = 0;
    let nearLimit = 0;
    let healthy = 0;

    for (const status of statuses) {
      if (status.overBudget) {
        overBudget++;
      } else if (status.percentUsed >= 80) {
        nearLimit++;
      } else {
        healthy++;
      }
    }

    return {
      totalBudgets: this.budgets.size,
      activeBudgets: statuses.length,
      overBudget,
      nearLimit,
      healthy,
    };
  }

  /**
   * Stop budget monitoring
   */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.removeAllListeners();
    logger.info('Budget manager shut down');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let budgetManagerInstance: BudgetManager | null = null;

/**
 * Get the singleton BudgetManager instance
 */
export function getBudgetManager(): BudgetManager {
  if (!budgetManagerInstance) {
    budgetManagerInstance = new BudgetManager();
  }
  return budgetManagerInstance;
}

/**
 * Initialize the budget manager
 */
export async function initializeBudgetManager(): Promise<BudgetManager> {
  const manager = getBudgetManager();
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the budget manager
 */
export function shutdownBudgetManager(): void {
  if (budgetManagerInstance) {
    budgetManagerInstance.shutdown();
    budgetManagerInstance = null;
  }
}

export default BudgetManager;
