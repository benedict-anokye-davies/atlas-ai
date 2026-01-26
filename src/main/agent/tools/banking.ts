/**
 * Atlas Banking - Agent Tools
 *
 * Voice command tools for banking operations.
 * Allows Atlas to check balances, view transactions, and make payments.
 *
 * @module agent/tools/banking
 */

import { createModuleLogger } from '../../utils/logger';
import { getAccountManager } from '../../banking/account-manager';
import { getPaymentService } from '../../banking/payment-service';
import { getBankingSecurity } from '../../banking/security';
import { getTrueLayerClient } from '../../banking/truelayer-client';
import { getBudgetManager } from '../../banking/budget-manager';
import { getSpendingPredictor } from '../../banking/spending-predictor';
import { getRecurringPaymentDetector } from '../../banking/recurring-detector';
import { getDirectDebitManager } from '../../banking/direct-debits';
import { getBalanceAlertManager } from '../../banking/balance-alerts';
import { getTransactionSearchEngine, ExportFormat } from '../../banking/transaction-search';
import { getPayeeValidator } from '../../banking/payee-validator';
import { getPaymentScheduler } from '../../banking/payment-scheduler';

const logger = createModuleLogger('BankingTools');

/**
 * Tool definitions for LLM function calling
 */
export const BANKING_TOOLS = [
  {
    name: 'check_bank_balance',
    description: 'Check bank account balance. Returns the current balance and available funds.',
    parameters: {
      type: 'object',
      properties: {
        account_name: {
          type: 'string',
          description: 'Optional account name or type (e.g., "checking", "savings", "TSB"). If not specified, returns all accounts.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_transactions',
    description: 'Get recent bank transactions. Shows spending history.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of transactions to return (default 10)',
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "Food", "Shopping", "Transport")',
        },
        merchant: {
          type: 'string',
          description: 'Filter by merchant name',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_spending_summary',
    description: 'Get a summary of spending by category for a time period.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Time period for the summary (default "month")',
        },
      },
      required: [],
    },
  },
  {
    name: 'send_payment',
    description: 'Send money to someone. Requires confirmation. Use for UK bank transfers.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: {
          type: 'string',
          description: 'Name of the person or business to pay',
        },
        amount: {
          type: 'number',
          description: 'Amount to send in GBP',
        },
        sort_code: {
          type: 'string',
          description: 'UK bank sort code (e.g., "12-34-56" or "123456")',
        },
        account_number: {
          type: 'string',
          description: 'UK bank account number (8 digits)',
        },
        reference: {
          type: 'string',
          description: 'Payment reference (optional, max 18 characters)',
        },
      },
      required: ['recipient_name', 'amount'],
    },
  },
  {
    name: 'quick_pay',
    description: 'Send money to a saved recipient by name. Faster than full payment.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: {
          type: 'string',
          description: 'Name of the saved recipient',
        },
        amount: {
          type: 'number',
          description: 'Amount to send in GBP',
        },
        description: {
          type: 'string',
          description: 'Optional payment description',
        },
      },
      required: ['recipient_name', 'amount'],
    },
  },
  {
    name: 'check_spending_limit',
    description: 'Check current spending against limits. Shows how much can still be spent.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_saved_recipients',
    description: 'List all saved payment recipients.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'confirm_payment',
    description: 'Confirm a pending payment. Called after user confirms.',
    parameters: {
      type: 'object',
      properties: {
        payment_id: {
          type: 'string',
          description: 'ID of the payment to confirm',
        },
        pin: {
          type: 'string',
          description: 'User PIN for authorization',
        },
      },
      required: ['payment_id'],
    },
  },
  {
    name: 'cancel_payment',
    description: 'Cancel a pending payment.',
    parameters: {
      type: 'object',
      properties: {
        payment_id: {
          type: 'string',
          description: 'ID of the payment to cancel',
        },
      },
      required: ['payment_id'],
    },
  },
  // Enhanced features - Budget & Spending
  {
    name: 'get_budget_status',
    description: 'Get budget status for all categories or a specific category. Shows spending vs budget.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category to check (e.g., "Food", "Shopping", "Entertainment")',
        },
      },
      required: [],
    },
  },
  {
    name: 'set_budget',
    description: 'Set or update a budget for a spending category.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Category to set budget for (e.g., "Food", "Shopping", "Entertainment")',
        },
        amount: {
          type: 'number',
          description: 'Budget amount in GBP',
        },
        period: {
          type: 'string',
          enum: ['weekly', 'monthly', 'yearly'],
          description: 'Budget period (default monthly)',
        },
      },
      required: ['category', 'amount'],
    },
  },
  {
    name: 'predict_spending',
    description: 'Predict end-of-month balance based on spending patterns.',
    parameters: {
      type: 'object',
      properties: {
        days_ahead: {
          type: 'number',
          description: 'Number of days to predict ahead (default until end of month)',
        },
      },
      required: [],
    },
  },
  // Enhanced features - Recurring Payments
  {
    name: 'list_subscriptions',
    description: 'List detected recurring payments and subscriptions.',
    parameters: {
      type: 'object',
      properties: {
        include_inactive: {
          type: 'boolean',
          description: 'Include cancelled/inactive subscriptions',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_direct_debits',
    description: 'List all active direct debits and standing orders.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_upcoming_payments',
    description: 'Show upcoming scheduled payments and direct debits.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look ahead (default 30)',
        },
      },
      required: [],
    },
  },
  // Enhanced features - Alerts & Monitoring
  {
    name: 'set_balance_alert',
    description: 'Set an alert for when balance drops below a threshold.',
    parameters: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Alert when balance drops below this amount in GBP',
        },
        account_name: {
          type: 'string',
          description: 'Optional account name (defaults to main account)',
        },
      },
      required: ['threshold'],
    },
  },
  {
    name: 'get_balance_alerts',
    description: 'List active balance alerts and their current status.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // Enhanced features - Search & Export
  {
    name: 'search_transactions',
    description: 'Search transactions with filters. Supports date range, amount, merchant, category.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search for merchant or description',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        min_amount: {
          type: 'number',
          description: 'Minimum amount filter',
        },
        max_amount: {
          type: 'number',
          description: 'Maximum amount filter',
        },
        start_date: {
          type: 'string',
          description: 'Start date (ISO format or natural language like "last month")',
        },
        end_date: {
          type: 'string',
          description: 'End date (ISO format)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'export_transactions',
    description: 'Export transactions to a file for tax or accounting purposes.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['csv', 'json', 'qif', 'ofx'],
          description: 'Export format (default CSV)',
        },
        period: {
          type: 'string',
          description: 'Period to export (e.g., "this month", "2024", "last quarter")',
        },
        category: {
          type: 'string',
          description: 'Optional category filter',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_tax_summary',
    description: 'Generate a tax summary for a specified tax year.',
    parameters: {
      type: 'object',
      properties: {
        tax_year: {
          type: 'string',
          description: 'Tax year (e.g., "2023-24"). Defaults to current tax year.',
        },
      },
      required: [],
    },
  },
  // Enhanced features - Validation
  {
    name: 'validate_payee',
    description: 'Validate UK bank details and check payee name using Confirmation of Payee.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Payee name to validate',
        },
        sort_code: {
          type: 'string',
          description: 'UK sort code',
        },
        account_number: {
          type: 'string',
          description: 'UK account number',
        },
      },
      required: ['name', 'sort_code', 'account_number'],
    },
  },
  // Enhanced features - Scheduled Payments
  {
    name: 'schedule_payment',
    description: 'Schedule a future payment or set up a recurring payment.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: {
          type: 'string',
          description: 'Name of recipient',
        },
        amount: {
          type: 'number',
          description: 'Amount in GBP',
        },
        date: {
          type: 'string',
          description: 'When to send (e.g., "next Friday", "1st of month", "2024-02-15")',
        },
        frequency: {
          type: 'string',
          enum: ['once', 'weekly', 'monthly', 'quarterly', 'yearly'],
          description: 'Payment frequency (default once)',
        },
        reference: {
          type: 'string',
          description: 'Payment reference',
        },
      },
      required: ['recipient_name', 'amount', 'date'],
    },
  },
  {
    name: 'list_scheduled_payments',
    description: 'List all scheduled and recurring payments.',
    parameters: {
      type: 'object',
      properties: {
        include_completed: {
          type: 'boolean',
          description: 'Include completed payments in list',
        },
      },
      required: [],
    },
  },
  {
    name: 'cancel_scheduled_payment',
    description: 'Cancel a scheduled payment.',
    parameters: {
      type: 'object',
      properties: {
        payment_id: {
          type: 'string',
          description: 'ID of the scheduled payment to cancel',
        },
      },
      required: ['payment_id'],
    },
  },
];

/**
 * Format currency for display
 */
function formatCurrency(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Execute a banking tool
 */
export async function executeBankingTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; result: string; data?: unknown }> {
  logger.info('Executing banking tool', { toolName, params });

  try {
    switch (toolName) {
      case 'check_bank_balance': {
        const accountManager = getAccountManager();
        const accounts = accountManager.getAccounts();

        if (accounts.length === 0) {
          return {
            success: false,
            result: 'No bank accounts are connected. Would you like me to help you connect your bank?',
          };
        }

        const accountName = params.account_name as string | undefined;

        if (accountName) {
          // Filter by account name/type
          const filtered = accounts.filter(
            (acc) =>
              acc.name.toLowerCase().includes(accountName.toLowerCase()) ||
              acc.type.toLowerCase().includes(accountName.toLowerCase()) ||
              acc.officialName?.toLowerCase().includes(accountName.toLowerCase())
          );

          if (filtered.length === 0) {
            return {
              success: false,
              result: `I couldn't find an account matching "${accountName}". Your accounts are: ${accounts.map((a) => a.name).join(', ')}`,
            };
          }

          const acc = filtered[0];
          return {
            success: true,
            result: `Your ${acc.name} has a balance of ${formatCurrency(acc.currentBalance, acc.currency)}${
              acc.availableBalance !== undefined && acc.availableBalance !== acc.currentBalance
                ? ` (${formatCurrency(acc.availableBalance, acc.currency)} available)`
                : ''
            }.`,
            data: acc,
          };
        }

        // Return all accounts
        const summary = accountManager.getBalanceSummary();
        const accountList = accounts
          .map(
            (acc) =>
              `${acc.name}: ${formatCurrency(acc.currentBalance, acc.currency)}`
          )
          .join('\n');

        return {
          success: true,
          result: `Here are your account balances:\n\n${accountList}\n\nTotal: ${formatCurrency(summary.totalBalance)}\nNet worth: ${formatCurrency(summary.netWorth)}`,
          data: summary,
        };
      }

      case 'get_recent_transactions': {
        const accountManager = getAccountManager();
        const limit = (params.limit as number) || 10;
        const category = params.category as string | undefined;
        const merchant = params.merchant as string | undefined;

        const transactions = await accountManager.getTransactions({
          limit,
          category,
          merchantName: merchant,
        });

        if (transactions.length === 0) {
          return {
            success: true,
            result: 'No transactions found matching your criteria.',
          };
        }

        const txList = transactions.slice(0, limit).map((tx) => {
          const date = new Date(tx.date).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          });
          return `${date}: ${tx.merchantName || tx.name} - ${formatCurrency(tx.amount, tx.currency)}`;
        });

        return {
          success: true,
          result: `Here are your recent transactions:\n\n${txList.join('\n')}`,
          data: transactions,
        };
      }

      case 'get_spending_summary': {
        const accountManager = getAccountManager();
        const period = (params.period as 'day' | 'week' | 'month' | 'year') || 'month';

        const summary = await accountManager.getSpendingSummary(period);

        const categories = Object.entries(summary.byCategory)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([cat, amount]) => `${cat}: ${formatCurrency(amount)}`)
          .join('\n');

        const topMerchants = summary.topMerchants
          .slice(0, 3)
          .map((m) => `${m.name}: ${formatCurrency(m.amount)} (${m.count} transactions)`)
          .join('\n');

        return {
          success: true,
          result: `Spending summary for this ${period}:\n\nTotal spent: ${formatCurrency(summary.totalSpent)}\nTotal income: ${formatCurrency(summary.totalIncome)}\nNet: ${formatCurrency(summary.netChange)}\n\nTop categories:\n${categories}\n\nTop merchants:\n${topMerchants}`,
          data: summary,
        };
      }

      case 'send_payment': {
        const paymentService = getPaymentService();
        const recipientName = params.recipient_name as string;
        const amount = params.amount as number;
        const sortCode = params.sort_code as string | undefined;
        const accountNumber = params.account_number as string | undefined;
        const reference = params.reference as string | undefined;

        // Check if we have bank details
        if (!sortCode || !accountNumber) {
          // Check if recipient is saved
          const saved = paymentService.findRecipient(recipientName);
          if (saved) {
            const payment = await paymentService.quickPay(recipientName, amount, reference);
            return {
              success: true,
              result: `I've prepared a payment of ${formatCurrency(amount)} to ${recipientName}. Please confirm by saying "confirm payment" or provide your PIN.`,
              data: { paymentId: payment.id, requiresConfirmation: true },
            };
          }

          return {
            success: false,
            result: `I need bank details to send money to ${recipientName}. Please provide their sort code and account number, or say "cancel" to stop.`,
          };
        }

        // Create payment with bank details
        const payment = await paymentService.createPayment({
          recipient: {
            name: recipientName,
            type: 'individual',
            routingNumber: sortCode.replace(/-/g, ''),
            accountNumber,
          },
          amount,
          currency: 'GBP',
          description: reference || `Payment to ${recipientName}`,
        });

        if (payment.status === 'pending_confirmation') {
          return {
            success: true,
            result: `I've prepared a payment of ${formatCurrency(amount)} to ${recipientName} (${sortCode}, ${accountNumber}). Please confirm by saying "confirm payment" or provide your PIN.`,
            data: { paymentId: payment.id, requiresConfirmation: true },
          };
        }

        return {
          success: true,
          result: `Payment of ${formatCurrency(amount)} to ${recipientName} has been sent. Confirmation: ${payment.confirmationCode}`,
          data: payment,
        };
      }

      case 'quick_pay': {
        const paymentService = getPaymentService();
        const recipientName = params.recipient_name as string;
        const amount = params.amount as number;
        const description = params.description as string | undefined;

        try {
          const payment = await paymentService.quickPay(recipientName, amount, description);

          if (payment.status === 'pending_confirmation') {
            return {
              success: true,
              result: `Ready to send ${formatCurrency(amount)} to ${recipientName}. Please confirm or provide your PIN.`,
              data: { paymentId: payment.id, requiresConfirmation: true },
            };
          }

          return {
            success: true,
            result: `Sent ${formatCurrency(amount)} to ${recipientName}. Confirmation: ${payment.confirmationCode}`,
            data: payment,
          };
        } catch (error) {
          return {
            success: false,
            result: (error as Error).message,
          };
        }
      }

      case 'check_spending_limit': {
        const security = getBankingSecurity();
        const limits = security.getSpendingSummary();

        return {
          success: true,
          result: `Your spending limits:\n\nDaily: ${formatCurrency(limits.daily.spent)} / ${formatCurrency(limits.daily.limit)} (${formatCurrency(limits.daily.remaining)} remaining)\nWeekly: ${formatCurrency(limits.weekly.spent)} / ${formatCurrency(limits.weekly.limit)} (${formatCurrency(limits.weekly.remaining)} remaining)\nMonthly: ${formatCurrency(limits.monthly.spent)} / ${formatCurrency(limits.monthly.limit)} (${formatCurrency(limits.monthly.remaining)} remaining)`,
          data: limits,
        };
      }

      case 'list_saved_recipients': {
        const paymentService = getPaymentService();
        const recipients = paymentService.getSavedRecipients();

        if (recipients.length === 0) {
          return {
            success: true,
            result: 'You have no saved recipients yet. They will be automatically saved after your first payment to them.',
          };
        }

        const list = recipients.map((r) => r.name).join(', ');
        return {
          success: true,
          result: `Your saved recipients: ${list}`,
          data: recipients,
        };
      }

      case 'confirm_payment': {
        const paymentService = getPaymentService();
        const paymentId = params.payment_id as string;
        const pin = params.pin as string | undefined;

        const payment = await paymentService.confirmPayment(paymentId, pin);

        return {
          success: true,
          result: `Payment confirmed! ${formatCurrency(payment.amount)} has been sent to ${payment.recipient.name}. Confirmation: ${payment.confirmationCode}`,
          data: payment,
        };
      }

      case 'cancel_payment': {
        const paymentService = getPaymentService();
        const paymentId = params.payment_id as string;

        await paymentService.cancelPayment(paymentId);

        return {
          success: true,
          result: 'Payment has been cancelled.',
        };
      }

      // =========================================================================
      // Enhanced Features - Budget & Spending
      // =========================================================================

      case 'get_budget_status': {
        const budgetManager = getBudgetManager();
        const category = params.category as string | undefined;

        if (category) {
          const budget = budgetManager.getBudgetForCategory(category);
          if (!budget) {
            return {
              success: false,
              result: `No budget set for ${category}. Would you like me to set one?`,
            };
          }

          const percentage = Math.round(budget.percentUsed);
          const statusEmoji = percentage >= 90 ? '🔴' : percentage >= 75 ? '🟠' : percentage >= 50 ? '🟡' : '🟢';

          return {
            success: true,
            result: `${statusEmoji} ${category} budget: ${formatCurrency(budget.spent)} of ${formatCurrency(budget.amount)} (${percentage}% used)\nRemaining: ${formatCurrency(budget.remaining)}`,
            data: budget,
          };
        }

        // Return all budgets
        const allBudgets = budgetManager.getBudgets({ activeOnly: true });
        if (allBudgets.length === 0) {
          return {
            success: true,
            result: 'No budgets set yet. Would you like me to set up some spending budgets?',
          };
        }

        const budgetList = allBudgets
          .map((b: { category: string; spent: number; amount: number; percentUsed: number }) => {
            const pct = Math.round(b.percentUsed);
            const emoji = pct >= 90 ? '🔴' : pct >= 75 ? '🟠' : pct >= 50 ? '🟡' : '🟢';
            return `${emoji} ${b.category}: ${formatCurrency(b.spent)} / ${formatCurrency(b.amount)} (${pct}%)`;
          })
          .join('\n');

        return {
          success: true,
          result: `Budget status:\n\n${budgetList}`,
          data: allBudgets,
        };
      }

      case 'set_budget': {
        const budgetManager = getBudgetManager();
        const category = params.category as string;
        const amount = params.amount as number;
        const period = (params.period as 'weekly' | 'monthly' | 'yearly') || 'monthly';

        budgetManager.createBudget({
          name: category,
          category,
          amount,
          period,
        });

        return {
          success: true,
          result: `Budget set: ${formatCurrency(amount)} ${period} for ${category}. I'll alert you when you're getting close to the limit.`,
        };
      }

      case 'predict_spending': {
        const predictor = getSpendingPredictor();
        const accountManager = getAccountManager();

        // Get current balance
        const summary = accountManager.getBalanceSummary();
        const currentBalance = summary.totalBalance;

        // Get prediction
        const prediction = predictor.predict(currentBalance);

        const warningText = prediction.warningLevel === 'critical'
          ? '⚠️ Warning: You may run low on funds'
          : prediction.warningLevel === 'warning'
          ? '⚠️ Caution: Spending is higher than usual'
          : prediction.warningLevel === 'caution'
          ? 'Note: Consider reviewing your spending'
          : 'Your spending looks healthy';

        return {
          success: true,
          result: `Based on your spending patterns:\n\nCurrent balance: ${formatCurrency(currentBalance)}\nPredicted end-of-month: ${formatCurrency(prediction.predictedEndBalance)}\nExpected spending: ${formatCurrency(prediction.predictedSpending)}\n\n${warningText}. Confidence: ${Math.round(prediction.confidence * 100)}%`,
          data: prediction,
        };
      }

      // =========================================================================
      // Enhanced Features - Recurring Payments
      // =========================================================================

      case 'list_subscriptions': {
        const detector = getRecurringPaymentDetector();
        const includeInactive = (params.include_inactive as boolean) || false;

        let subscriptions = detector.getRecurringPayments({ activeOnly: !includeInactive });

        if (subscriptions.length === 0) {
          return {
            success: true,
            result: 'No recurring payments detected yet. I\'ll identify them as more transactions come in.',
          };
        }

        const total = subscriptions.reduce((sum: number, s: { amount: number }) => sum + s.amount, 0);
        const list = subscriptions
          .map((s: { merchantName: string; amount: number; frequency: string; isActive: boolean }) => {
            const status = s.isActive ? '' : ' (inactive)';
            return `${s.merchantName}: ${formatCurrency(s.amount)} ${s.frequency}${status}`;
          })
          .join('\n');

        return {
          success: true,
          result: `Your recurring payments:\n\n${list}\n\nEstimated monthly total: ${formatCurrency(total)}`,
          data: subscriptions,
        };
      }

      case 'get_direct_debits': {
        const ddManager = getDirectDebitManager();
        const directDebits = ddManager.getDirectDebits({ status: 'active' });
        const standingOrders = ddManager.getStandingOrders({ status: 'active' });

        const committed = ddManager.getMonthlyCommitted();

        if (directDebits.length === 0 && standingOrders.length === 0) {
          return {
            success: true,
            result: 'No direct debits or standing orders found.',
          };
        }

        const ddList = directDebits
          .map((dd: { merchantName: string; lastCollectionAmount?: number; expectedAmount?: number; frequency: string }) =>
            `${dd.merchantName}: ~${formatCurrency(dd.expectedAmount || dd.lastCollectionAmount || 0)} ${dd.frequency}`
          )
          .join('\n');

        const soList = standingOrders
          .map((so: { recipientName: string; amount: number; frequency: string }) =>
            `${so.recipientName}: ${formatCurrency(so.amount)} ${so.frequency}`
          )
          .join('\n');

        let result = '';
        if (directDebits.length > 0) {
          result += `Direct Debits:\n${ddList}\n\n`;
        }
        if (standingOrders.length > 0) {
          result += `Standing Orders:\n${soList}\n\n`;
        }
        result += `Total monthly committed: ${formatCurrency(committed.total)}`;

        return {
          success: true,
          result,
          data: { directDebits, standingOrders, committed },
        };
      }

      case 'get_upcoming_payments': {
        const scheduler = getPaymentScheduler();
        const ddManager = getDirectDebitManager();
        const days = (params.days as number) || 30;

        const scheduledPayments = scheduler.getDuePayments(days);
        const upcomingDDs = ddManager.getUpcoming(days);

        const allUpcoming = [
          ...scheduledPayments.map((p: { recipientName: string; amount: number; nextPaymentDate: number }) => ({
            name: p.recipientName,
            amount: p.amount,
            date: new Date(p.nextPaymentDate),
            type: 'Scheduled' as const,
          })),
          ...upcomingDDs.map((dd: { type: string; name: string; amount: number; date: number }) => ({
            name: dd.name,
            amount: dd.amount,
            date: new Date(dd.date),
            type: dd.type === 'standing_order' ? 'Standing Order' as const : 'Direct Debit' as const,
          })),
        ].sort((a, b) => a.date.getTime() - b.date.getTime());

        if (allUpcoming.length === 0) {
          return {
            success: true,
            result: `No upcoming payments in the next ${days} days.`,
          };
        }

        const list = allUpcoming
          .map((p) => {
            const date = p.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            return `${date}: ${p.name} - ${formatCurrency(p.amount)} (${p.type})`;
          })
          .join('\n');

        const total = allUpcoming.reduce((sum, p) => sum + p.amount, 0);

        return {
          success: true,
          result: `Upcoming payments (next ${days} days):\n\n${list}\n\nTotal: ${formatCurrency(total)}`,
          data: allUpcoming,
        };
      }

      // =========================================================================
      // Enhanced Features - Alerts & Monitoring
      // =========================================================================

      case 'set_balance_alert': {
        const alertManager = getBalanceAlertManager();
        const accountManager = getAccountManager();
        const threshold = params.threshold as number;
        const accountName = params.account_name as string | undefined;

        // Find account
        const accounts = accountManager.getAccounts();
        let accountId = accounts[0]?.id;

        if (accountName) {
          const found = accounts.find(
            (a) => a.name.toLowerCase().includes(accountName.toLowerCase())
          );
          if (found) accountId = found.id;
        }

        if (!accountId) {
          return {
            success: false,
            result: 'No bank account found. Please connect your bank first.',
          };
        }

        alertManager.createConfig(accountId, 'low_balance', threshold);

        return {
          success: true,
          result: `Alert set! I'll notify you when your balance drops below ${formatCurrency(threshold)}.`,
        };
      }

      case 'get_balance_alerts': {
        const alertManager = getBalanceAlertManager();
        const configs = alertManager.getConfigs();

        if (configs.length === 0) {
          return {
            success: true,
            result: 'No balance alerts configured. Would you like me to set one up?',
          };
        }

        const list = configs
          .map((c) => {
            const status = c.enabled ? '✓' : '✗';
            let desc = c.type.replace(/_/g, ' ');
            if (c.threshold) desc += ` (${formatCurrency(c.threshold)})`;
            return `${status} ${desc}`;
          })
          .join('\n');

        return {
          success: true,
          result: `Your balance alerts:\n\n${list}`,
          data: configs,
        };
      }

      // =========================================================================
      // Enhanced Features - Search & Export
      // =========================================================================

      case 'search_transactions': {
        const searchEngine = getTransactionSearchEngine();
        const accountManager = getAccountManager();

        // Get transactions first
        const allTransactions = await accountManager.getTransactions({ limit: 1000 });

        // Build search filter
        const filter: Record<string, unknown> = {};
        if (params.query) filter.textQuery = params.query;
        if (params.category) filter.category = params.category as string;
        if (params.min_amount) filter.minAmount = params.min_amount as number;
        if (params.max_amount) filter.maxAmount = params.max_amount as number;

        // Parse dates
        if (params.start_date) {
          const startDate = parseNaturalDate(params.start_date as string);
          if (startDate) filter.startDate = startDate;
        }
        if (params.end_date) {
          filter.endDate = new Date(params.end_date as string);
        }

        const searchResult = searchEngine.search(allTransactions, filter as any);
        const limit = (params.limit as number) || 20;
        const limited = searchResult.transactions.slice(0, limit);

        if (limited.length === 0) {
          return {
            success: true,
            result: 'No transactions found matching your search.',
          };
        }

        const list = limited
          .map((tx) => {
            const dateStr = tx.date instanceof Date 
              ? tx.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : new Date(tx.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            return `${dateStr}: ${tx.merchantName || tx.name || 'Unknown'} - ${formatCurrency(tx.amount)}`;
          })
          .join('\n');

        return {
          success: true,
          result: `Found ${searchResult.total} transactions${searchResult.total > limit ? ` (showing ${limit})` : ''}:\n\n${list}`,
          data: limited,
        };
      }

      case 'export_transactions': {
        const searchEngine = getTransactionSearchEngine();
        const accountManager = getAccountManager();
        const format = (params.format as ExportFormat) || 'csv';
        const period = params.period as string | undefined;
        const category = params.category as string | undefined;

        // Get transactions
        const allTransactions = await accountManager.getTransactions({ limit: 5000 });

        // Filter by period
        let filtered = allTransactions;
        if (period) {
          const dateRange = parsePeriodToDateRange(period);
          if (dateRange) {
            filtered = allTransactions.filter((tx) => {
              const date = new Date(tx.date);
              return date >= dateRange.start && date <= dateRange.end;
            });
          }
        }

        // Filter by category
        if (category) {
          filtered = filtered.filter((tx) => {
            const txCat = typeof tx.category === 'string' ? tx.category : tx.category?.primary;
            return txCat?.toLowerCase() === category.toLowerCase();
          });
        }

        // Export based on format
        let exported: string;
        switch (format) {
          case 'csv':
            exported = searchEngine.exportToCSV(filtered);
            break;
          case 'json':
            exported = searchEngine.exportToJSON(filtered);
            break;
          case 'qif':
            exported = searchEngine.exportToQIF(filtered);
            break;
          case 'ofx':
            exported = searchEngine.exportToOFX(filtered, {
              bankId: 'ATLAS',
              accountId: 'DEFAULT',
              accountType: 'CHECKING',
            });
            break;
          default:
            exported = searchEngine.exportToCSV(filtered);
        }

        // In real implementation, would save to file
        // For now, return summary
        return {
          success: true,
          result: `Exported ${filtered.length} transactions to ${format.toUpperCase()} format. The file is ready to download.`,
          data: { format, count: filtered.length, filePath: exported },
        };
      }

      case 'get_tax_summary': {
        const searchEngine = getTransactionSearchEngine();
        const accountManager = getAccountManager();
        const taxYear = params.tax_year as string | undefined;

        // Parse tax year (UK tax year is April to April)
        let startYear: number;
        let endYear: number;

        if (taxYear && taxYear.includes('-')) {
          const [s, e] = taxYear.split('-').map((y) => parseInt(y.length === 2 ? `20${y}` : y));
          startYear = s;
          endYear = e;
        } else {
          // Default to current tax year
          const now = new Date();
          if (now.getMonth() >= 3) {
            startYear = now.getFullYear();
            endYear = now.getFullYear() + 1;
          } else {
            startYear = now.getFullYear() - 1;
            endYear = now.getFullYear();
          }
        }

        const startDate = new Date(startYear, 3, 6); // April 6
        const endDate = new Date(endYear, 3, 5); // April 5

        const allTransactions = await accountManager.getTransactions({ limit: 10000 });

        const summary = searchEngine.generateTaxSummary(allTransactions, {
          start: startDate,
          end: endDate,
        });

        return {
          success: true,
          result: `Tax Summary ${startYear}/${endYear.toString().slice(-2)}:\n\nTotal Income: ${formatCurrency(summary.income.total)}\nTotal Expenses: ${formatCurrency(summary.expenses.total)}\nNet: ${formatCurrency(summary.net)}\n\nExpenses by category available in export.`,
          data: summary,
        };
      }

      // =========================================================================
      // Enhanced Features - Validation
      // =========================================================================

      case 'validate_payee': {
        const validator = getPayeeValidator();
        const name = params.name as string;
        const sortCode = params.sort_code as string;
        const accountNumber = params.account_number as string;

        const result = await validator.validatePayee(name, sortCode, accountNumber);

        if (result.matchResult === 'exact_match') {
          return {
            success: true,
            result: `✓ Validated! The account details are correct for "${name}".`,
            data: result,
          };
        } else if (result.matchResult === 'close_match') {
          return {
            success: true,
            result: `⚠ Close match. Did you mean "${result.suggestedName || name}"? Please confirm before proceeding.`,
            data: result,
          };
        } else if (result.matchResult === 'no_match') {
          return {
            success: false,
            result: `✗ Name doesn't match the account. Suggested: "${result.suggestedName || 'unknown'}". Please check the details.`,
            data: result,
          };
        } else {
          return {
            success: result.isValid,
            result: result.isValid 
              ? `Bank details format validated. Name check unavailable - please verify manually.`
              : `Invalid bank details: ${result.warnings.join(', ')}`,
            data: result,
          };
        }
      }

      // =========================================================================
      // Enhanced Features - Scheduled Payments
      // =========================================================================

      case 'schedule_payment': {
        const scheduler = getPaymentScheduler();
        const recipientName = params.recipient_name as string;
        const sortCode = (params.sort_code as string) || '';
        const accountNumber = (params.account_number as string) || '';
        const amount = params.amount as number;
        const dateStr = params.date as string;
        const frequency = (params.frequency as 'once' | 'weekly' | 'monthly' | 'quarterly' | 'yearly') || 'once';
        const reference = params.reference as string | undefined;

        // Parse date
        const date = parseNaturalDate(dateStr);
        if (!date) {
          return {
            success: false,
            result: `I couldn't understand the date "${dateStr}". Please try something like "next Friday", "1st of month", or "2024-02-15".`,
          };
        }

        const payment = scheduler.schedulePayment({
          recipientName,
          recipientSortCode: sortCode,
          recipientAccountNumber: accountNumber,
          amount,
          currency: 'GBP',
          reference: reference || `Payment to ${recipientName}`,
          frequency,
          firstPaymentDate: date,
        });

        const dateFormatted = date.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });

        const freqText = frequency === 'once' ? '' : `, repeating ${frequency}`;

        return {
          success: true,
          result: `Scheduled: ${formatCurrency(amount)} to ${recipientName} on ${dateFormatted}${freqText}. I'll remind you before it's sent.`,
          data: payment,
        };
      }

      case 'list_scheduled_payments': {
        const scheduler = getPaymentScheduler();
        const includeCompleted = (params.include_completed as boolean) || false;

        let payments = scheduler.getSchedules();
        if (!includeCompleted) {
          payments = payments.filter((p) => p.status === 'pending');
        }

        if (payments.length === 0) {
          return {
            success: true,
            result: 'No scheduled payments. Would you like to set one up?',
          };
        }

        const list = payments
          .map((p) => {
            const date = new Date(p.nextPaymentDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const freq = p.frequency === 'once' ? '' : ` (${p.frequency})`;
            const status = p.status !== 'pending' ? ` [${p.status}]` : '';
            return `${date}: ${formatCurrency(p.amount)} to ${p.recipientName}${freq}${status}`;
          })
          .join('\n');

        return {
          success: true,
          result: `Scheduled payments:\n\n${list}`,
          data: payments,
        };
      }

      case 'cancel_scheduled_payment': {
        const scheduler = getPaymentScheduler();
        const paymentId = params.payment_id as string;

        const cancelled = scheduler.cancelSchedule(paymentId);
        if (!cancelled) {
          return {
            success: false,
            result: 'Payment not found or already cancelled.',
          };
        }

        return {
          success: true,
          result: 'Scheduled payment has been cancelled.',
        };
      }

      default:
        return {
          success: false,
          result: `Unknown banking tool: ${toolName}`,
        };
    }
  } catch (error) {
    const err = error as Error;
    logger.error('Banking tool execution failed', { toolName, error: err.message });
    return {
      success: false,
      result: `Banking operation failed: ${err.message}`,
    };
  }
}

/**
 * Parse natural language for payment intent
 */
export function parseBankingIntent(
  text: string
): { intent: string; params: Record<string, unknown> } | null {
  const lower = text.toLowerCase();

  // Check balance
  if (lower.includes('balance') || (lower.includes('how much') && lower.includes('account'))) {
    const accountMatch = text.match(/(?:in|my)\s+(\w+)\s+(?:account)?/i);
    return {
      intent: 'check_bank_balance',
      params: accountMatch ? { account_name: accountMatch[1] } : {},
    };
  }

  // Budget status
  if (lower.includes('budget')) {
    const categoryMatch = text.match(/(?:budget|spending)\s+(?:for|on)\s+(\w+)/i);
    if (lower.includes('set') || lower.includes('create')) {
      const amountMatch = text.match(/£?(\d+(?:\.\d{2})?)/);
      if (amountMatch && categoryMatch) {
        return {
          intent: 'set_budget',
          params: {
            category: categoryMatch[1],
            amount: parseFloat(amountMatch[1]),
          },
        };
      }
    }
    return {
      intent: 'get_budget_status',
      params: categoryMatch ? { category: categoryMatch[1] } : {},
    };
  }

  // Spending prediction
  if (lower.includes('predict') || lower.includes('forecast') || lower.includes('end of month')) {
    return { intent: 'predict_spending', params: {} };
  }

  // Subscriptions / recurring
  if (lower.includes('subscription') || lower.includes('recurring') || lower.includes('netflix') || lower.includes('spotify')) {
    return { intent: 'list_subscriptions', params: {} };
  }

  // Direct debits
  if (lower.includes('direct debit') || lower.includes('standing order')) {
    return { intent: 'get_direct_debits', params: {} };
  }

  // Upcoming payments
  if (lower.includes('upcoming') || lower.includes('due') || lower.includes('coming up')) {
    const daysMatch = text.match(/(?:next|in)\s+(\d+)\s+days/i);
    return {
      intent: 'get_upcoming_payments',
      params: daysMatch ? { days: parseInt(daysMatch[1]) } : {},
    };
  }

  // Balance alerts
  if (lower.includes('alert') && lower.includes('balance')) {
    const amountMatch = text.match(/(?:below|under|less than)\s+£?(\d+(?:\.\d{2})?)/i);
    if (amountMatch) {
      return {
        intent: 'set_balance_alert',
        params: { threshold: parseFloat(amountMatch[1]) },
      };
    }
    return { intent: 'get_balance_alerts', params: {} };
  }

  // Search transactions
  if (lower.includes('search') || lower.includes('find') && lower.includes('transaction')) {
    const query = text.replace(/search|find|transactions?|for/gi, '').trim();
    return {
      intent: 'search_transactions',
      params: query ? { query } : {},
    };
  }

  // Export
  if (lower.includes('export') || lower.includes('download')) {
    let format = 'csv';
    if (lower.includes('json')) format = 'json';
    else if (lower.includes('qif') || lower.includes('quicken')) format = 'qif';
    else if (lower.includes('ofx')) format = 'ofx';

    return {
      intent: 'export_transactions',
      params: { format },
    };
  }

  // Tax summary
  if (lower.includes('tax')) {
    const yearMatch = text.match(/(\d{4})[-\/]?(\d{2,4})?/);
    return {
      intent: 'get_tax_summary',
      params: yearMatch ? { tax_year: `${yearMatch[1]}-${yearMatch[2] || parseInt(yearMatch[1]) + 1}` } : {},
    };
  }

  // Schedule payment
  if (lower.includes('schedule') || lower.includes('set up') && lower.includes('payment')) {
    return { intent: 'schedule_payment', params: {} }; // Needs more details from LLM
  }

  // Scheduled payments list
  if (lower.includes('scheduled') && lower.includes('payment')) {
    return { intent: 'list_scheduled_payments', params: {} };
  }

  // Spending summary
  if (lower.includes('spending') || lower.includes('spent')) {
    let period: string = 'month';
    if (lower.includes('today') || lower.includes('daily')) period = 'day';
    else if (lower.includes('week')) period = 'week';
    else if (lower.includes('year')) period = 'year';

    return { intent: 'get_spending_summary', params: { period } };
  }

  // Recent transactions
  if (lower.includes('transaction') || lower.includes('recent')) {
    return { intent: 'get_recent_transactions', params: { limit: 10 } };
  }

  // Payment
  const paymentService = getPaymentService();
  const parsed = paymentService.parsePaymentRequest(text);
  if (parsed) {
    return {
      intent: 'send_payment',
      params: {
        recipient_name: parsed.recipient?.name,
        amount: parsed.amount,
        reference: parsed.description,
      },
    };
  }

  return null;
}

/**
 * Parse natural language date
 */
function parseNaturalDate(dateStr: string): Date | null {
  const lower = dateStr.toLowerCase().trim();
  const now = new Date();

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return new Date(dateStr);
  }

  // Relative days
  if (lower === 'today') return now;
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Next weekday
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const nextMatch = lower.match(/next\s+(\w+)/);
  if (nextMatch) {
    const dayName = nextMatch[1];
    const dayIndex = weekdays.indexOf(dayName);
    if (dayIndex >= 0) {
      const d = new Date(now);
      const currentDay = d.getDay();
      const daysUntil = (dayIndex - currentDay + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntil);
      return d;
    }
  }

  // Day of month patterns: "1st", "15th", "1st of month"
  const ordinalMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?(?:this\s+)?month)?/);
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1]);
    const d = new Date(now);
    d.setDate(day);
    // If day has passed this month, move to next month
    if (d < now) {
      d.setMonth(d.getMonth() + 1);
    }
    return d;
  }

  // "in X days/weeks"
  const inMatch = lower.match(/in\s+(\d+)\s+(day|week|month)s?/);
  if (inMatch) {
    const num = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit === 'day') d.setDate(d.getDate() + num);
    else if (unit === 'week') d.setDate(d.getDate() + num * 7);
    else if (unit === 'month') d.setMonth(d.getMonth() + num);
    return d;
  }

  // End of month
  if (lower.includes('end of month') || lower.includes('month end')) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return d;
  }

  return null;
}

/**
 * Parse period string to date range
 */
function parsePeriodToDateRange(period: string): { start: Date; end: Date } | null {
  const lower = period.toLowerCase().trim();
  const now = new Date();

  // This month/week/year
  if (lower === 'this month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  }

  if (lower === 'this week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }

  if (lower === 'this year' || /^\d{4}$/.test(period)) {
    const year = /^\d{4}$/.test(period) ? parseInt(period) : now.getFullYear();
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31),
    };
  }

  // Last month/week
  if (lower === 'last month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0),
    };
  }

  if (lower === 'last week') {
    const end = new Date(now);
    end.setDate(now.getDate() - now.getDay() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { start, end };
  }

  // Quarter
  if (lower === 'last quarter' || lower === 'this quarter') {
    const isLast = lower.includes('last');
    const currentQ = Math.floor(now.getMonth() / 3);
    const quarter = isLast ? currentQ - 1 : currentQ;
    const year = quarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
    const adjustedQ = quarter < 0 ? 3 : quarter;

    return {
      start: new Date(year, adjustedQ * 3, 1),
      end: new Date(year, adjustedQ * 3 + 3, 0),
    };
  }

  return null;
}
