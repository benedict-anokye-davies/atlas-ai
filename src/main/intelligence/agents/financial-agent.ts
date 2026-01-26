/**
 * Financial Intelligence Agent
 * Analyzes finances, budgets, and provides financial insights
 */

import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction, TradeEntity } from '../types';
import { BaseIntelligenceAgent } from './base-agent';
import {
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  FinancialSummary,
  BudgetStatus,
} from './types';

const logger = createModuleLogger('FinancialAgent');

// ============================================================================
// FINANCIAL AGENT
// ============================================================================

export class FinancialAgent extends BaseIntelligenceAgent {
  id = 'financial';
  name = 'Financial Intelligence';
  description = 'Analyzes finances, spending patterns, and provides financial insights';
  capabilities: AgentCapability[] = [
    'entity_query',
    'temporal_query',
    'pattern_detection',
    'prediction',
    'recommendation',
    'alert_generation',
  ];
  focusEntities: EntityType[] = ['trade']; // Uses trade entities for transactions

  // Budget definitions (would typically come from user settings)
  private budgets: Map<string, { amount: number; period: 'monthly' | 'weekly' }> = new Map([
    ['Food & Dining', { amount: 400, period: 'monthly' }],
    ['Entertainment', { amount: 200, period: 'monthly' }],
    ['Shopping', { amount: 300, period: 'monthly' }],
    ['Transport', { amount: 150, period: 'monthly' }],
    ['Utilities', { amount: 200, period: 'monthly' }],
  ]);

  // --------------------------------------------------------------------------
  // QUERY HANDLING
  // --------------------------------------------------------------------------

  protected async handleQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const lowerQuery = query.query.toLowerCase();

    if (lowerQuery.includes('spend') || lowerQuery.includes('expense')) {
      return this.handleSpendingQuery(query);
    }

    if (lowerQuery.includes('budget')) {
      return this.handleBudgetQuery(query);
    }

    if (lowerQuery.includes('save') || lowerQuery.includes('saving')) {
      return this.handleSavingsQuery(query);
    }

    if (lowerQuery.includes('income') || lowerQuery.includes('earn')) {
      return this.handleIncomeQuery(query);
    }

    if (lowerQuery.includes('summary') || lowerQuery.includes('overview')) {
      return this.handleSummaryQuery(query);
    }

    return this.handleGeneralQuery(query);
  }

  private async handleSpendingQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const transactions = this.getTransactions(30);
    const expenses = transactions.filter(t => (t.properties?.amount as number ?? 0) < 0);
    const totalSpent = Math.abs(expenses.reduce((sum, t) => sum + ((t.properties?.amount as number) ?? 0), 0));

    // Group by category
    const byCategory = new Map<string, number>();
    for (const expense of expenses) {
      const category = (expense.properties?.category as string) ?? 'Other';
      byCategory.set(category, (byCategory.get(category) ?? 0) + Math.abs((expense.properties?.amount as number) ?? 0));
    }

    const topCategories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      answer: `You've spent £${totalSpent.toFixed(2)} in the last 30 days. ` +
        `Top categories: ${topCategories.map(([cat, amt]) => `${cat} (£${amt.toFixed(2)})`).join(', ')}`,
      confidence: 0.9,
      evidence: expenses.slice(0, 5).map(t => ({
        entityId: t.id,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${t.properties?.merchant ?? t.name}: £${Math.abs((t.properties?.amount as number) ?? 0).toFixed(2)}`,
      })),
      insights: this.generateSpendingInsights(expenses, byCategory),
      followUpQueries: [
        'What did I spend most on?',
        'How does this compare to last month?',
        'Am I within budget?',
      ],
      suggestedActions: [],
    };
  }

  private async handleBudgetQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const status = await this.getBudgetStatus();

    const overBudget = status.budgets.filter(b => b.percentUsed > 100);
    const nearLimit = status.budgets.filter(b => b.percentUsed > 80 && b.percentUsed <= 100);

    return {
      answer: overBudget.length > 0
        ? `You're over budget in ${overBudget.length} categor${overBudget.length > 1 ? 'ies' : 'y'}: ${overBudget.map(b => `${b.category} (${b.percentUsed.toFixed(0)}%)`).join(', ')}`
        : nearLimit.length > 0
          ? `You're on track but ${nearLimit.length} categor${nearLimit.length > 1 ? 'ies are' : 'y is'} near the limit.`
          : 'You\'re within budget across all categories!',
      confidence: 0.9,
      evidence: status.budgets.map(b => ({
        entityId: `budget_${b.category}`,
        entityType: 'trade' as EntityType,
        relevance: b.percentUsed / 100,
        snippet: `${b.category}: £${b.spent.toFixed(2)}/£${b.budgeted.toFixed(2)} (${b.percentUsed.toFixed(0)}%)`,
      })),
      insights: [],
      followUpQueries: ['Where can I cut back?', 'What\'s my biggest expense?'],
      suggestedActions: overBudget.length > 0 ? [{
        type: 'review_spending',
        description: 'Review spending in over-budget categories',
        parameters: { categories: overBudget.map(b => b.category) },
      }] : [],
    };
  }

  private async handleSavingsQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const summary = await this.getFinancialSummary(30);

    return {
      answer: summary.netSavings >= 0
        ? `You've saved £${summary.netSavings.toFixed(2)} this month (${(summary.savingsRate * 100).toFixed(1)}% savings rate). Keep it up!`
        : `You're £${Math.abs(summary.netSavings).toFixed(2)} in the red this month. Consider reducing expenses.`,
      confidence: 0.85,
      evidence: [],
      insights: summary.netSavings < 0 ? [{
        id: this.generateId(),
        type: 'warning',
        title: 'Negative Savings',
        description: 'You\'re spending more than you earn this month',
        confidence: 1,
        relatedEntityIds: [],
        actionable: true,
      }] : [],
      followUpQueries: ['How can I save more?', 'What are my biggest expenses?'],
      suggestedActions: [],
    };
  }

  private async handleIncomeQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const transactions = this.getTransactions(30);
    const income = transactions.filter(t => (t.properties?.amount as number ?? 0) > 0);
    const totalIncome = income.reduce((sum, t) => sum + ((t.properties?.amount as number) ?? 0), 0);

    return {
      answer: `Your income this month is £${totalIncome.toFixed(2)} from ${income.length} source(s).`,
      confidence: 0.9,
      evidence: income.map(t => ({
        entityId: t.id,
        entityType: 'trade' as EntityType,
        relevance: 1,
        snippet: `${t.properties?.merchant ?? t.name}: +£${((t.properties?.amount as number) ?? 0).toFixed(2)}`,
      })),
      insights: [],
      followUpQueries: ['How does this compare to expenses?', 'What\'s my net savings?'],
      suggestedActions: [],
    };
  }

  private async handleSummaryQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const summary = await this.getFinancialSummary(30);

    return {
      answer: `This month: Income £${summary.income.toFixed(2)}, Expenses £${summary.expenses.toFixed(2)}, ` +
        `Net ${summary.netSavings >= 0 ? '+' : ''}£${summary.netSavings.toFixed(2)} (${(summary.savingsRate * 100).toFixed(1)}% rate)`,
      confidence: 0.9,
      evidence: summary.expenseBreakdown.slice(0, 5).map(e => ({
        entityId: `category_${e.category}`,
        entityType: 'trade' as EntityType,
        relevance: e.percent / 100,
        snippet: `${e.category}: £${e.amount.toFixed(2)} (${e.percent.toFixed(1)}%)`,
      })),
      insights: summary.insights.map(insight => ({
        id: this.generateId(),
        type: 'pattern' as const,
        title: 'Financial Insight',
        description: insight,
        confidence: 0.8,
        relatedEntityIds: [],
        actionable: false,
      })),
      followUpQueries: ['Am I within budget?', 'Where can I cut back?', 'Show spending trends'],
      suggestedActions: [],
    };
  }

  private async handleGeneralQuery(query: AgentQuery): Promise<AgentQueryResult> {
    return {
      answer: 'I can help with financial analysis. Try asking about spending, budgets, savings, or income.',
      confidence: 0.5,
      evidence: [],
      insights: [],
      followUpQueries: [
        'How much have I spent this month?',
        'Am I within budget?',
        'What\'s my savings rate?',
      ],
      suggestedActions: [],
    };
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  protected async computeInsights(context: AgentContext): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const transactions = this.getTransactions(30);
    const previousTransactions = this.getTransactions(60).filter(t =>
      new Date(t.updatedAt).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    // Spending trend
    const currentSpending = Math.abs(transactions
      .filter(t => (t.properties?.amount as number ?? 0) < 0)
      .reduce((sum, t) => sum + ((t.properties?.amount as number) ?? 0), 0));

    const previousSpending = Math.abs(previousTransactions
      .filter(t => (t.properties?.amount as number ?? 0) < 0)
      .reduce((sum, t) => sum + ((t.properties?.amount as number) ?? 0), 0));

    if (previousSpending > 0) {
      const change = ((currentSpending - previousSpending) / previousSpending) * 100;

      if (change > 20) {
        insights.push({
          id: this.generateId(),
          type: 'warning',
          title: 'Spending Increase',
          description: `Your spending is up ${change.toFixed(1)}% compared to last month`,
          confidence: 0.85,
          relatedEntityIds: [],
          actionable: true,
        });
      } else if (change < -10) {
        insights.push({
          id: this.generateId(),
          type: 'achievement',
          title: 'Spending Reduced',
          description: `Great job! Your spending is down ${Math.abs(change).toFixed(1)}% from last month`,
          confidence: 0.85,
          relatedEntityIds: [],
          actionable: false,
        });
      }
    }

    // Unusual transactions
    const avgTransaction = currentSpending / transactions.length || 0;
    const unusual = transactions.filter(t =>
      Math.abs((t.properties?.amount as number ?? 0)) > avgTransaction * 3
    );

    if (unusual.length > 0) {
      insights.push({
        id: this.generateId(),
        type: 'pattern',
        title: 'Unusual Transactions',
        description: `${unusual.length} transaction(s) significantly larger than your average`,
        confidence: 0.75,
        relatedEntityIds: unusual.map(t => t.id),
        actionable: false,
      });
    }

    return insights;
  }

  private generateSpendingInsights(expenses: TradeEntity[], byCategory: Map<string, number>): AgentInsight[] {
    const insights: AgentInsight[] = [];

    // Find dominant category
    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0 && sorted[0][1] > 0) {
      const totalSpent = sorted.reduce((sum, [_, amt]) => sum + amt, 0);
      const topPercent = (sorted[0][1] / totalSpent) * 100;

      if (topPercent > 40) {
        insights.push({
          id: this.generateId(),
          type: 'pattern',
          title: 'Dominant Expense',
          description: `${sorted[0][0]} accounts for ${topPercent.toFixed(1)}% of your spending`,
          confidence: 0.9,
          relatedEntityIds: expenses.filter(e => e.properties?.category === sorted[0][0]).slice(0, 3).map(e => e.id),
          actionable: true,
        });
      }
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  protected async computeAlerts(context: AgentContext): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];
    const status = await this.getBudgetStatus();

    // Over budget alerts
    for (const budget of status.budgets) {
      if (budget.percentUsed > 100) {
        alerts.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'warning',
          title: 'Over Budget',
          description: `${budget.category} is ${(budget.percentUsed - 100).toFixed(0)}% over budget`,
          relatedEntities: [],
          priority: 7,
          actionable: true,
          suggestedActions: [{
            type: 'reduce_spending',
            description: `Reduce ${budget.category} spending`,
            parameters: { category: budget.category },
          }],
          createdAt: new Date(),
          dismissed: false,
        });
      } else if (budget.percentUsed > 90 && budget.daysRemaining > 5) {
        alerts.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'info',
          title: 'Near Budget Limit',
          description: `${budget.category} is at ${budget.percentUsed.toFixed(0)}% with ${budget.daysRemaining} days remaining`,
          relatedEntities: [],
          priority: 5,
          actionable: true,
          suggestedActions: [{
            type: 'monitor_spending',
            description: `Monitor ${budget.category} spending`,
            parameters: { category: budget.category },
          }],
          createdAt: new Date(),
          dismissed: false,
        });
      }
    }

    // Large transaction alert
    const transactions = this.getTransactions(1);
    const large = transactions.filter(t => Math.abs((t.properties?.amount as number ?? 0)) > 500);

    for (const transaction of large) {
      alerts.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'info',
        title: 'Large Transaction',
        description: `${transaction.properties?.merchant ?? transaction.name}: £${Math.abs((transaction.properties?.amount as number) ?? 0).toFixed(2)}`,
        relatedEntities: [transaction.id],
        priority: 4,
        actionable: false,
        suggestedActions: [],
        createdAt: new Date(),
        dismissed: false,
      });
    }

    return alerts;
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  protected async computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];
    const summary = await this.getFinancialSummary(30);

    // Savings rate recommendation
    if (summary.savingsRate < 0.2) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'savings',
        title: 'Improve Savings Rate',
        description: `Your current savings rate is ${(summary.savingsRate * 100).toFixed(1)}%`,
        rationale: 'Financial experts recommend saving at least 20% of income',
        confidence: 0.85,
        impact: 'high',
        effort: 'medium',
        relatedEntities: [],
        actions: [{
          type: 'set_budget',
          description: 'Set stricter budgets for non-essential categories',
          parameters: {},
        }],
        createdAt: new Date(),
      });
    }

    // Category-specific recommendations
    for (const expense of summary.expenseBreakdown) {
      if (expense.trend === 'up' && expense.percent > 20) {
        recommendations.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'spending_reduction',
          title: `Review ${expense.category}`,
          description: `${expense.category} spending is trending up and represents ${expense.percent.toFixed(1)}% of expenses`,
          rationale: 'Reducing this category could significantly improve your financial position',
          confidence: 0.75,
          impact: 'medium',
          effort: 'low',
          relatedEntities: [],
          actions: [{
            type: 'review_category',
            description: `Review ${expense.category} transactions`,
            parameters: { category: expense.category },
          }],
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  protected async handleAction(action: AgentAction): Promise<AgentResponse> {
    switch (action.type) {
      case 'review_spending':
        return {
          success: true,
          message: 'Spending review initiated for the specified categories.',
        };

      case 'set_budget':
        return {
          success: true,
          message: 'Budget adjustment noted. Update your budget settings to apply.',
        };

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private getTransactions(days: number): TradeEntity[] {
    const store = this.getStore();
    // Using trade entities as transactions (would be separate in a real implementation)
    const trades = store.getEntitiesByType('trade', 500) as TradeEntity[];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return trades.filter(t =>
      t.properties?.type === 'transaction' &&
      new Date(t.updatedAt).getTime() > cutoff
    );
  }

  async getFinancialSummary(days: number): Promise<FinancialSummary> {
    const transactions = this.getTransactions(days);
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    let income = 0;
    let expenses = 0;
    const categoryTotals = new Map<string, number>();

    for (const transaction of transactions) {
      const amount = (transaction.properties?.amount as number) ?? 0;
      const category = (transaction.properties?.category as string) ?? 'Other';

      if (amount > 0) {
        income += amount;
      } else {
        expenses += Math.abs(amount);
        categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + Math.abs(amount));
      }
    }

    const netSavings = income - expenses;
    const savingsRate = income > 0 ? netSavings / income : 0;

    const expenseBreakdown = [...categoryTotals.entries()]
      .map(([category, amount]) => ({
        category,
        amount,
        percent: expenses > 0 ? (amount / expenses) * 100 : 0,
        trend: 'stable' as const, // Would need historical data to calculate
      }))
      .sort((a, b) => b.amount - a.amount);

    const insights: string[] = [];
    const warnings: string[] = [];

    if (savingsRate < 0) {
      warnings.push('You\'re spending more than you earn');
    } else if (savingsRate < 0.1) {
      warnings.push('Your savings rate is below 10%');
    }

    if (expenseBreakdown.length > 0 && expenseBreakdown[0].percent > 50) {
      insights.push(`${expenseBreakdown[0].category} dominates your spending`);
    }

    return {
      period: { start, end: now },
      income,
      expenses,
      netSavings,
      savingsRate,
      expenseBreakdown,
      insights,
      warnings,
    };
  }

  async getBudgetStatus(): Promise<BudgetStatus> {
    const transactions = this.getTransactions(30);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate();

    const budgetStatuses: BudgetStatus['budgets'] = [];
    let overallStatus: 'under_budget' | 'on_track' | 'over_budget' = 'under_budget';

    for (const [category, config] of this.budgets) {
      const categoryTransactions = transactions.filter(t =>
        t.properties?.category === category &&
        new Date(t.updatedAt) >= monthStart
      );

      const spent = Math.abs(
        categoryTransactions.reduce((sum, t) => sum + ((t.properties?.amount as number) ?? 0), 0)
      );

      const percentUsed = (spent / config.amount) * 100;
      const projectedOverspend = Math.max(0, (spent / (daysInMonth - daysRemaining)) * daysInMonth - config.amount);

      budgetStatuses.push({
        category,
        budgeted: config.amount,
        spent,
        remaining: Math.max(0, config.amount - spent),
        percentUsed,
        daysRemaining,
        projectedOverspend,
      });

      if (percentUsed > 100) {
        overallStatus = 'over_budget';
      } else if (percentUsed > 80 && overallStatus !== 'over_budget') {
        overallStatus = 'on_track';
      }
    }

    return {
      budgets: budgetStatuses.sort((a, b) => b.percentUsed - a.percentUsed),
      overallStatus,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: FinancialAgent | null = null;

export function getFinancialAgent(): FinancialAgent {
  if (!instance) {
    instance = new FinancialAgent();
  }
  return instance;
}
