/**
 * Atlas Desktop - Finance Agent Tools
 *
 * Agent tools for banking and finance operations including account balances,
 * transactions, spending analysis, and budget management.
 *
 * @module agent/tools/finance
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import Decimal from 'decimal.js';
import {
  getTrueLayerClient,
  getTransactionManager,
  getBudgetManager,
  TransactionCategory,
  BudgetPeriod,
} from '../../finance';

const logger = createModuleLogger('FinanceTools');

/**
 * Convert Decimal values to strings for serialization
 */
function serializeDecimals<T>(obj: T): T {
  if (obj instanceof Decimal) {
    return obj.toString() as unknown as T;
  }
  if (obj instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of obj) {
      result[String(key)] = serializeDecimals(value);
    }
    return result as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeDecimals) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeDecimals(value);
    }
    return result as T;
  }
  return obj;
}

// =============================================================================
// Account & Balance Tools
// =============================================================================

/**
 * Get all connected bank accounts
 */
export const getAccountsTool: AgentTool = {
  name: 'finance_get_accounts',
  description:
    'Get all connected bank accounts. Shows account names, types, currencies, and providers.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const client = getTrueLayerClient();
      const result = await client.getAccounts();

      if (!result.success) {
        return { success: false, error: result.error?.message || 'Failed to get accounts' };
      }

      return {
        success: true,
        data: result.data?.map((acc) => ({
          id: acc.id,
          displayName: acc.displayName,
          type: acc.type,
          currency: acc.currency,
          provider: acc.provider.name,
        })),
      };
    } catch (error) {
      logger.error('Failed to get accounts', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get bank account balance
 */
export const getBalanceTool: AgentTool = {
  name: 'finance_get_balance',
  description:
    'Get current balance for a specific bank account or all accounts. Returns current balance, available balance, and currency.',
  parameters: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description: 'Optional account ID. If not provided, returns balances for all accounts.',
      },
    },
    required: [],
  },
  execute: async (params: { accountId?: string }): Promise<ActionResult> => {
    try {
      const client = getTrueLayerClient();

      if (params.accountId) {
        const result = await client.getBalance(params.accountId);

        if (!result.success) {
          return { success: false, error: result.error?.message || 'Failed to get balance' };
        }

        return {
          success: true,
          data: serializeDecimals({
            accountId: result.data?.accountId,
            current: result.data?.current,
            available: result.data?.available,
            currency: result.data?.currency,
            updatedAt: result.data?.updatedAt,
          }),
        };
      } else {
        const result = await client.getAllBalances();

        if (!result.success) {
          return { success: false, error: result.error?.message || 'Failed to get balances' };
        }

        return {
          success: true,
          data: serializeDecimals(result.data),
        };
      }
    } catch (error) {
      logger.error('Failed to get balance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Transaction Tools
// =============================================================================

/**
 * Get recent transactions
 */
export const getTransactionsTool: AgentTool = {
  name: 'finance_get_transactions',
  description:
    'Get recent bank transactions with optional filtering by date range, category, and amount.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format. Defaults to 30 days ago.',
      },
      to: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format. Defaults to today.',
      },
      category: {
        type: 'string',
        description:
          'Filter by category: groceries, dining, transport, utilities, entertainment, shopping, health, education, travel, subscriptions, rent, income, transfers, fees, cash, other',
      },
      search: {
        type: 'string',
        description: 'Search transactions by description or merchant name.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of transactions to return. Defaults to 20.',
      },
    },
    required: [],
  },
  execute: async (params: {
    from?: string;
    to?: string;
    category?: TransactionCategory;
    search?: string;
    limit?: number;
  }): Promise<ActionResult> => {
    try {
      const manager = getTransactionManager();
      const result = await manager.getTransactions({
        from: params.from,
        to: params.to,
        categories: params.category ? [params.category] : undefined,
        search: params.search,
        limit: params.limit || 20,
        includePending: true,
      });

      return {
        success: true,
        data: serializeDecimals({
          transactions: result.items.map((tx) => ({
            id: tx.id,
            date: tx.timestamp.split('T')[0],
            description: tx.description,
            merchant: tx.merchant,
            amount: tx.amount,
            currency: tx.currency,
            category: tx.category,
            type: tx.type,
            pending: tx.pending,
          })),
          total: result.total,
          hasMore: result.hasMore,
        }),
      };
    } catch (error) {
      logger.error('Failed to get transactions', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Spending Analysis Tools
// =============================================================================

/**
 * Get spending by category
 */
export const getSpendingTool: AgentTool = {
  name: 'finance_get_spending',
  description:
    'Get spending breakdown by category for a date range. Shows amount spent, transaction count, and percentage per category.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format. Defaults to start of current month.',
      },
      to: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format. Defaults to today.',
      },
      currency: {
        type: 'string',
        description: 'Currency code. Defaults to GBP.',
      },
    },
    required: [],
  },
  execute: async (params: {
    from?: string;
    to?: string;
    currency?: string;
  }): Promise<ActionResult> => {
    try {
      const manager = getTransactionManager();

      // Default to current month
      const now = new Date();
      const from =
        params.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const to = params.to || now.toISOString().split('T')[0];

      const spending = await manager.getSpendingByCategory(from, to, params.currency || 'GBP');

      return {
        success: true,
        data: serializeDecimals({
          period: { from, to },
          categories: spending.map((s) => ({
            category: s.category,
            amount: s.amount,
            currency: s.currency,
            transactionCount: s.transactionCount,
            percentage: s.percentage.toFixed(1),
            averagePerTransaction: s.averageAmount,
          })),
        }),
      };
    } catch (error) {
      logger.error('Failed to get spending', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get spending report with insights
 */
export const getSpendingReportTool: AgentTool = {
  name: 'finance_get_spending_report',
  description:
    'Get a comprehensive spending report including total spending, income, top merchants, and daily breakdown.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format. Required.',
      },
      to: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format. Required.',
      },
      currency: {
        type: 'string',
        description: 'Currency code. Defaults to GBP.',
      },
    },
    required: ['from', 'to'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const from = params.from as string;
      const to = params.to as string;
      const currency = (params.currency as string) || 'GBP';

      const manager = getTransactionManager();
      const report = await manager.getSpendingReport(from, to, currency);

      return {
        success: true,
        data: serializeDecimals({
          period: { from: report.periodStart, to: report.periodEnd },
          totalSpent: report.totalSpent,
          totalIncome: report.totalIncome,
          netSavings: report.net,
          currency: report.currency,
          topCategories: report.byCategory.slice(0, 5).map((c) => ({
            category: c.category,
            amount: c.amount,
            percentage: c.percentage.toFixed(1),
          })),
          topMerchants: report.topMerchants.slice(0, 5).map((m) => ({
            merchant: m.merchant,
            amount: m.amount,
            transactionCount: m.transactionCount,
          })),
        }),
      };
    } catch (error) {
      logger.error('Failed to get spending report', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get spending insights
 */
export const getInsightsTool: AgentTool = {
  name: 'finance_get_insights',
  description:
    'Get AI-generated spending insights including unusual spending patterns, trends, and saving opportunities.',
  parameters: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format. Defaults to 30 days ago.',
      },
      to: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format. Defaults to today.',
      },
    },
    required: [],
  },
  execute: async (params: { from?: string; to?: string }): Promise<ActionResult> => {
    try {
      const manager = getTransactionManager();

      const now = new Date();
      const from =
        params.from ||
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to = params.to || now.toISOString().split('T')[0];

      const insights = await manager.generateInsights(from, to);

      return {
        success: true,
        data: serializeDecimals(
          insights.map((i) => ({
            type: i.type,
            title: i.title,
            description: i.description,
            category: i.category,
            amount: i.amount,
            currency: i.currency,
            importance: i.importance,
          }))
        ),
      };
    } catch (error) {
      logger.error('Failed to get insights', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Budget Tools
// =============================================================================

/**
 * Create a budget
 */
export const createBudgetTool: AgentTool = {
  name: 'finance_create_budget',
  description:
    'Create a new spending budget for a category. Budgets can be daily, weekly, monthly, or yearly.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'Budget category: groceries, dining, transport, utilities, entertainment, shopping, health, education, travel, subscriptions, rent, other',
      },
      amount: {
        type: 'number',
        description: 'Budget amount limit.',
      },
      period: {
        type: 'string',
        description: 'Budget period: daily, weekly, monthly, yearly. Defaults to monthly.',
      },
      alertThreshold: {
        type: 'number',
        description:
          'Alert threshold as decimal (0-1). E.g., 0.8 means alert when 80% of budget is used. Defaults to 0.8.',
      },
    },
    required: ['category', 'amount'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const category = params.category as TransactionCategory;
      const amount = params.amount as number;
      const period = (params.period as BudgetPeriod) || 'monthly';
      const alertThreshold = (params.alertThreshold as number) ?? 0.8;

      const manager = getBudgetManager();
      const budget = await manager.createBudget(category, amount, period, {
        alertThreshold,
      });

      return {
        success: true,
        data: serializeDecimals({
          id: budget.id,
          category: budget.category,
          amount: budget.amount,
          period: budget.period,
          alertThreshold: budget.alertThreshold,
          message: `Budget of ${budget.currency} ${budget.amount.toString()} per ${budget.period} created for ${budget.category}`,
        }),
      };
    } catch (error) {
      logger.error('Failed to create budget', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Get budget status
 */
export const getBudgetStatusTool: AgentTool = {
  name: 'finance_get_budget_status',
  description:
    'Get current status of all budgets showing spent amount, remaining, and whether over budget.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const manager = getBudgetManager();
      const statuses = await manager.getAllBudgetStatuses();

      if (statuses.length === 0) {
        return {
          success: true,
          data: {
            message: 'No budgets configured. Use finance_create_budget to create one.',
            budgets: [],
          },
        };
      }

      return {
        success: true,
        data: serializeDecimals({
          budgets: statuses.map((s) => ({
            category: s.budget.category,
            budgetAmount: s.budget.amount,
            spent: s.spent,
            remaining: s.remaining,
            percentUsed: s.percentUsed.toFixed(1),
            overBudget: s.overBudget,
            daysRemaining: s.daysRemaining,
            period: s.budget.period,
            projectedSpend: s.projectedSpend,
          })),
        }),
      };
    } catch (error) {
      logger.error('Failed to get budget status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Check a specific budget
 */
export const checkBudgetTool: AgentTool = {
  name: 'finance_check_budget',
  description: 'Check spending status for a specific category against its budget.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'Category to check: groceries, dining, transport, utilities, entertainment, shopping, etc.',
      },
    },
    required: ['category'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const category = params.category as TransactionCategory;
      const manager = getBudgetManager();
      const budgets = manager.getBudgetsByCategory(category);

      if (budgets.length === 0) {
        return {
          success: true,
          data: {
            message: `No budget configured for ${category}. Use finance_create_budget to create one.`,
            hasBudget: false,
          },
        };
      }

      const status = await manager.getBudgetStatus(budgets[0].id);

      if (!status) {
        return { success: false, error: 'Failed to get budget status' };
      }

      return {
        success: true,
        data: serializeDecimals({
          hasBudget: true,
          category,
          budgetAmount: status.budget.amount,
          spent: status.spent,
          remaining: status.remaining,
          percentUsed: status.percentUsed.toFixed(1),
          overBudget: status.overBudget,
          daysRemaining: status.daysRemaining,
          period: status.budget.period,
          message: status.overBudget
            ? `Over budget by ${status.budget.currency} ${status.remaining.abs().toString()}`
            : `${status.remaining.toString()} ${status.budget.currency} remaining (${(100 - status.percentUsed).toFixed(1)}%)`,
        }),
      };
    } catch (error) {
      logger.error('Failed to check budget', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Update a budget
 */
export const updateBudgetTool: AgentTool = {
  name: 'finance_update_budget',
  description: 'Update an existing budget amount, period, or alert threshold.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Category of budget to update.',
      },
      amount: {
        type: 'number',
        description: 'New budget amount.',
      },
      period: {
        type: 'string',
        description: 'New budget period: daily, weekly, monthly, yearly.',
      },
      active: {
        type: 'boolean',
        description: 'Whether budget is active.',
      },
    },
    required: ['category'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const category = params.category as TransactionCategory;
      const amount = params.amount as number | undefined;
      const period = params.period as BudgetPeriod | undefined;
      const active = params.active as boolean | undefined;

      const manager = getBudgetManager();
      const budgets = manager.getBudgetsByCategory(category);

      if (budgets.length === 0) {
        return {
          success: false,
          error: `No budget found for ${category}`,
        };
      }

      const updated = await manager.updateBudget(budgets[0].id, {
        amount,
        period,
        active,
      });

      if (!updated) {
        return { success: false, error: 'Failed to update budget' };
      }

      return {
        success: true,
        data: serializeDecimals({
          id: updated.id,
          category: updated.category,
          amount: updated.amount,
          period: updated.period,
          active: updated.active,
          message: `Budget for ${updated.category} updated`,
        }),
      };
    } catch (error) {
      logger.error('Failed to update budget', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

/**
 * Delete a budget
 */
export const deleteBudgetTool: AgentTool = {
  name: 'finance_delete_budget',
  description: 'Delete a budget for a category.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Category of budget to delete.',
      },
    },
    required: ['category'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const category = params.category as TransactionCategory;
      const manager = getBudgetManager();
      const budgets = manager.getBudgetsByCategory(category);

      if (budgets.length === 0) {
        return {
          success: false,
          error: `No budget found for ${category}`,
        };
      }

      await manager.deleteBudget(budgets[0].id);

      return {
        success: true,
        data: {
          message: `Budget for ${category} deleted`,
        },
      };
    } catch (error) {
      logger.error('Failed to delete budget', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Recurring Payments Tools
// =============================================================================

/**
 * Get direct debits and standing orders
 */
export const getRecurringPaymentsTool: AgentTool = {
  name: 'finance_get_recurring',
  description: 'Get all direct debits and standing orders for an account.',
  parameters: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description: 'Account ID to get recurring payments for.',
      },
    },
    required: ['accountId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const accountId = params.accountId as string;
      const client = getTrueLayerClient();

      const [ddResult, soResult] = await Promise.all([
        client.getDirectDebits(accountId),
        client.getStandingOrders(accountId),
      ]);

      return {
        success: true,
        data: serializeDecimals({
          directDebits: ddResult.success
            ? ddResult.data?.map((dd) => ({
                name: dd.name,
                status: dd.status,
                lastPaymentDate: dd.previousPaymentDate,
                lastPaymentAmount: dd.previousPaymentAmount,
              }))
            : [],
          standingOrders: soResult.success
            ? soResult.data?.map((so) => ({
                payee: so.payee,
                amount: so.amount,
                frequency: so.frequency,
                nextPaymentDate: so.nextPaymentDate,
                status: so.status,
              }))
            : [],
        }),
      };
    } catch (error) {
      logger.error('Failed to get recurring payments', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  },
};

// =============================================================================
// Export all tools
// =============================================================================

export const financeTools: AgentTool[] = [
  // Account & Balance
  getAccountsTool,
  getBalanceTool,
  // Transactions
  getTransactionsTool,
  // Spending Analysis
  getSpendingTool,
  getSpendingReportTool,
  getInsightsTool,
  // Budgets
  createBudgetTool,
  getBudgetStatusTool,
  checkBudgetTool,
  updateBudgetTool,
  deleteBudgetTool,
  // Recurring
  getRecurringPaymentsTool,
];

/**
 * Get all finance tools
 */
export function getFinanceTools(): AgentTool[] {
  return financeTools;
}

export default financeTools;
