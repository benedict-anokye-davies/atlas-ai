/**
 * Atlas Finance - Transaction Manager
 *
 * Handles transaction categorization, filtering, and analysis.
 *
 * @module finance/transactions
 */

import Decimal from 'decimal.js';
import { createModuleLogger } from '../utils/logger';
import {
  Transaction,
  TransactionFilter,
  TransactionCategory,
  CategorySpending,
  SpendingReport,
  SpendingInsight,
  PaginatedResult,
} from './types';
import { getTrueLayerClient } from './truelayer';

const logger = createModuleLogger('TransactionManager');

/**
 * Category keywords for ML-free categorization
 */
const CATEGORY_KEYWORDS: Record<TransactionCategory, string[]> = {
  groceries: [
    'tesco',
    'sainsbury',
    'asda',
    'morrisons',
    'lidl',
    'aldi',
    'waitrose',
    'co-op',
    'grocery',
    'supermarket',
    'iceland',
    'ocado',
    'whole foods',
  ],
  dining: [
    'restaurant',
    'cafe',
    'coffee',
    'starbucks',
    'costa',
    'pret',
    'mcdonald',
    'burger',
    'pizza',
    'uber eats',
    'deliveroo',
    'just eat',
    'nandos',
    'kfc',
    'subway',
    'greggs',
    'eat',
    'food',
  ],
  transport: [
    'uber',
    'lyft',
    'taxi',
    'train',
    'bus',
    'tube',
    'tfl',
    'national rail',
    'petrol',
    'fuel',
    'shell',
    'bp',
    'esso',
    'parking',
    'ncp',
    'dart charge',
    'congestion',
    'oyster',
    'railcard',
  ],
  utilities: [
    'electric',
    'gas',
    'water',
    'council tax',
    'bt',
    'virgin media',
    'sky',
    'broadband',
    'internet',
    'eon',
    'edf',
    'octopus',
    'bulb',
    'thames water',
    'severn trent',
    'phone',
    'mobile',
    'ee',
    'vodafone',
    'three',
    'o2',
  ],
  entertainment: [
    'netflix',
    'spotify',
    'disney',
    'prime video',
    'cinema',
    'vue',
    'odeon',
    'cineworld',
    'amazon prime',
    'apple music',
    'youtube',
    'hulu',
    'hbo',
    'playstation',
    'xbox',
    'steam',
    'nintendo',
    'gaming',
    'theatre',
    'concert',
  ],
  shopping: [
    'amazon',
    'ebay',
    'argos',
    'john lewis',
    'next',
    'asos',
    'zara',
    'h&m',
    'primark',
    'tk maxx',
    'boots',
    'superdrug',
    'currys',
    'ikea',
    'b&q',
    'homebase',
    'screwfix',
    'halfords',
  ],
  health: [
    'pharmacy',
    'doctor',
    'hospital',
    'dentist',
    'optician',
    'boots opticians',
    'specsavers',
    'bupa',
    'vitality',
    'gym',
    'fitness',
    'puregym',
    'david lloyd',
    'nuffield',
    'nhs',
  ],
  education: [
    'university',
    'college',
    'school',
    'course',
    'udemy',
    'coursera',
    'skillshare',
    'book',
    'waterstones',
    'whsmith',
    'tuition',
    'student',
  ],
  travel: [
    'hotel',
    'airbnb',
    'booking.com',
    'expedia',
    'flight',
    'airline',
    'british airways',
    'easyjet',
    'ryanair',
    'eurostar',
    'ferry',
    'holiday',
    'travel',
    'passport',
  ],
  subscriptions: [
    'subscription',
    'monthly',
    'membership',
    'patreon',
    'substack',
    'medium',
    'linkedin premium',
    'adobe',
    'microsoft 365',
    'icloud',
    'dropbox',
  ],
  rent: ['rent', 'letting', 'landlord', 'mortgage', 'housing', 'lease'],
  income: [
    'salary',
    'wages',
    'payroll',
    'pension',
    'dividend',
    'interest',
    'refund',
    'hmrc',
    'tax refund',
    'bonus',
  ],
  transfers: ['transfer', 'sent to', 'received from', 'standing order to', 'payment to'],
  fees: ['fee', 'charge', 'overdraft', 'interest charge', 'late payment', 'penalty'],
  cash: ['atm', 'cash', 'withdrawal', 'cashback'],
  other: [],
};

/**
 * Categorize a transaction based on description keywords
 */
export function categorizeByKeywords(description: string): TransactionCategory {
  const desc = description.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'other') continue;

    for (const keyword of keywords) {
      if (desc.includes(keyword)) {
        return category as TransactionCategory;
      }
    }
  }

  return 'other';
}

/**
 * Extract merchant name from transaction description
 */
export function extractMerchant(description: string): string | undefined {
  // Common patterns to clean up
  const cleaned = description
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '') // Remove dates
    .replace(/\d{2}:\d{2}/g, '') // Remove times
    .replace(/[*#]/g, '') // Remove special chars
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();

  // Take first meaningful part (often the merchant name)
  const parts = cleaned.split(/[,\-|]/);
  if (parts.length > 0) {
    const merchant = parts[0].trim();
    if (merchant.length > 2 && merchant.length < 50) {
      return merchant;
    }
  }

  return undefined;
}

/**
 * Transaction Manager
 *
 * Provides transaction filtering, categorization, and spending analysis.
 */
export class TransactionManager {
  private cachedTransactions: Transaction[] = [];
  private cacheTimestamp: number = 0;
  private readonly cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Get transactions with optional filtering
   */
  async getTransactions(filter?: TransactionFilter): Promise<PaginatedResult<Transaction>> {
    try {
      // Refresh cache if needed
      await this.refreshCache(filter?.from, filter?.to);

      let transactions = [...this.cachedTransactions];

      // Apply filters
      if (filter) {
        if (filter.accountIds?.length) {
          transactions = transactions.filter((t) => filter.accountIds!.includes(t.accountId));
        }

        if (filter.from) {
          const fromDate = new Date(filter.from);
          transactions = transactions.filter((t) => new Date(t.timestamp) >= fromDate);
        }

        if (filter.to) {
          const toDate = new Date(filter.to);
          transactions = transactions.filter((t) => new Date(t.timestamp) <= toDate);
        }

        if (filter.categories?.length) {
          transactions = transactions.filter((t) => filter.categories!.includes(t.category));
        }

        if (filter.types?.length) {
          transactions = transactions.filter((t) => filter.types!.includes(t.type));
        }

        if (filter.minAmount !== undefined) {
          transactions = transactions.filter((t) => t.amount.abs().gte(filter.minAmount!));
        }

        if (filter.maxAmount !== undefined) {
          transactions = transactions.filter((t) => t.amount.abs().lte(filter.maxAmount!));
        }

        if (filter.search) {
          const searchLower = filter.search.toLowerCase();
          transactions = transactions.filter(
            (t) =>
              t.description.toLowerCase().includes(searchLower) ||
              t.merchant?.toLowerCase().includes(searchLower)
          );
        }

        if (!filter.includePending) {
          transactions = transactions.filter((t) => !t.pending);
        }
      }

      // Sort by date descending
      transactions.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      // Apply pagination
      const offset = filter?.offset || 0;
      const limit = filter?.limit || 50;
      const total = transactions.length;
      const paginatedItems = transactions.slice(offset, offset + limit);

      return {
        items: paginatedItems,
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      };
    } catch (error) {
      logger.error('Failed to get transactions', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Refresh transaction cache from bank
   */
  private async refreshCache(from?: string, to?: string): Promise<void> {
    const now = Date.now();

    // Only refresh if cache is stale
    if (now - this.cacheTimestamp < this.cacheMaxAge && this.cachedTransactions.length > 0) {
      return;
    }

    try {
      const client = getTrueLayerClient();
      const result = await client.getAllTransactions(from, to);

      if (result.success && result.data) {
        // Enrich transactions with merchant info
        this.cachedTransactions = result.data.map((tx) => ({
          ...tx,
          merchant: tx.merchant || extractMerchant(tx.description),
        }));
        this.cacheTimestamp = now;

        logger.debug('Transaction cache refreshed', { count: this.cachedTransactions.length });
      }
    } catch (error) {
      logger.error('Failed to refresh transaction cache', { error: (error as Error).message });
      // Keep using stale cache if available
      if (this.cachedTransactions.length === 0) {
        throw error;
      }
    }
  }

  /**
   * Get spending breakdown by category
   */
  async getSpendingByCategory(
    from?: string,
    to?: string,
    currency: string = 'GBP'
  ): Promise<CategorySpending[]> {
    const result = await this.getTransactions({ from, to, includePending: false });

    // Filter to debits only (spending)
    const spending = result.items.filter((t) => t.amount.isNegative() && t.currency === currency);

    // Group by category
    const byCategory = new Map<TransactionCategory, { amount: Decimal; count: number }>();

    for (const tx of spending) {
      const existing = byCategory.get(tx.category) || { amount: new Decimal(0), count: 0 };
      byCategory.set(tx.category, {
        amount: existing.amount.plus(tx.amount.abs()),
        count: existing.count + 1,
      });
    }

    // Calculate total for percentages
    let total = new Decimal(0);
    for (const { amount } of byCategory.values()) {
      total = total.plus(amount);
    }

    // Build result
    const categorySpending: CategorySpending[] = [];

    for (const [category, { amount, count }] of byCategory.entries()) {
      categorySpending.push({
        category,
        amount,
        currency,
        transactionCount: count,
        percentage: total.isZero() ? 0 : amount.div(total).times(100).toNumber(),
        averageAmount: count > 0 ? amount.div(count) : new Decimal(0),
      });
    }

    // Sort by amount descending
    categorySpending.sort((a, b) => b.amount.minus(a.amount).toNumber());

    return categorySpending;
  }

  /**
   * Generate a spending report for a period
   */
  async getSpendingReport(
    from: string,
    to: string,
    currency: string = 'GBP'
  ): Promise<SpendingReport> {
    const result = await this.getTransactions({ from, to, includePending: false });

    const transactions = result.items.filter((t) => t.currency === currency);

    // Calculate totals
    let totalSpent = new Decimal(0);
    let totalIncome = new Decimal(0);

    for (const tx of transactions) {
      if (tx.amount.isNegative()) {
        totalSpent = totalSpent.plus(tx.amount.abs());
      } else {
        totalIncome = totalIncome.plus(tx.amount);
      }
    }

    // Get category breakdown
    const byCategory = await this.getSpendingByCategory(from, to, currency);

    // Get top merchants
    const merchantSpending = new Map<string, { amount: Decimal; count: number }>();

    for (const tx of transactions) {
      if (tx.amount.isNegative() && tx.merchant) {
        const existing = merchantSpending.get(tx.merchant) || { amount: new Decimal(0), count: 0 };
        merchantSpending.set(tx.merchant, {
          amount: existing.amount.plus(tx.amount.abs()),
          count: existing.count + 1,
        });
      }
    }

    const topMerchants = Array.from(merchantSpending.entries())
      .map(([merchant, { amount, count }]) => ({ merchant, amount, transactionCount: count }))
      .sort((a, b) => b.amount.minus(a.amount).toNumber())
      .slice(0, 10);

    // Calculate daily spending
    const dailyMap = new Map<string, Decimal>();

    for (const tx of transactions) {
      if (tx.amount.isNegative()) {
        const date = tx.timestamp.split('T')[0];
        const existing = dailyMap.get(date) || new Decimal(0);
        dailyMap.set(date, existing.plus(tx.amount.abs()));
      }
    }

    const dailySpending = Array.from(dailyMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      periodStart: from,
      periodEnd: to,
      totalSpent,
      totalIncome,
      net: totalIncome.minus(totalSpent),
      currency,
      byCategory,
      topMerchants,
      dailySpending,
    };
  }

  /**
   * Generate spending insights
   */
  async generateInsights(from: string, to: string): Promise<SpendingInsight[]> {
    const insights: SpendingInsight[] = [];
    const now = new Date().toISOString();

    try {
      const report = await this.getSpendingReport(from, to);

      // Insight: High spending in a category
      for (const cat of report.byCategory) {
        if (cat.percentage > 30 && cat.category !== 'rent' && cat.category !== 'income') {
          insights.push({
            type: 'unusual_spending',
            title: `High ${cat.category} spending`,
            description: `You spent ${cat.percentage.toFixed(1)}% of your budget on ${cat.category} this period (${cat.currency} ${cat.amount.toFixed(2)})`,
            category: cat.category,
            amount: cat.amount,
            currency: cat.currency,
            importance: cat.percentage > 50 ? 5 : 4,
            timestamp: now,
          });
        }
      }

      // Insight: Top merchant spending
      if (report.topMerchants.length > 0) {
        const topMerchant = report.topMerchants[0];
        const percentage = report.totalSpent.isZero()
          ? 0
          : topMerchant.amount.div(report.totalSpent).times(100).toNumber();

        if (percentage > 15) {
          insights.push({
            type: 'trend',
            title: `Frequent spending at ${topMerchant.merchant}`,
            description: `You made ${topMerchant.transactionCount} transactions at ${topMerchant.merchant}, totaling ${report.currency} ${topMerchant.amount.toFixed(2)} (${percentage.toFixed(1)}% of spending)`,
            amount: topMerchant.amount,
            currency: report.currency,
            importance: 3,
            timestamp: now,
          });
        }
      }

      // Insight: Net income/spending
      if (report.net.isNegative()) {
        insights.push({
          type: 'trend',
          title: 'Spending exceeds income',
          description: `You spent ${report.currency} ${report.net.abs().toFixed(2)} more than you earned this period`,
          amount: report.net.abs(),
          currency: report.currency,
          importance: 5,
          timestamp: now,
        });
      } else if (report.net.gt(report.totalIncome.times(0.2))) {
        insights.push({
          type: 'saving_opportunity',
          title: 'Good savings rate',
          description: `You saved ${report.currency} ${report.net.toFixed(2)} this period (${report.net.div(report.totalIncome).times(100).toFixed(1)}% of income)`,
          amount: report.net,
          currency: report.currency,
          importance: 2,
          timestamp: now,
        });
      }
    } catch (error) {
      logger.error('Failed to generate insights', { error: (error as Error).message });
    }

    // Sort by importance
    insights.sort((a, b) => b.importance - a.importance);

    return insights;
  }

  /**
   * Re-categorize a transaction manually
   */
  async recategorize(transactionId: string, category: TransactionCategory): Promise<boolean> {
    const index = this.cachedTransactions.findIndex((t) => t.id === transactionId);

    if (index === -1) {
      logger.warn('Transaction not found for recategorization', { transactionId });
      return false;
    }

    this.cachedTransactions[index] = {
      ...this.cachedTransactions[index],
      category,
    };

    logger.info('Transaction recategorized', { transactionId, category });
    return true;
  }

  /**
   * Clear cached transactions
   */
  clearCache(): void {
    this.cachedTransactions = [];
    this.cacheTimestamp = 0;
    logger.debug('Transaction cache cleared');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let transactionManagerInstance: TransactionManager | null = null;

/**
 * Get the singleton TransactionManager instance
 */
export function getTransactionManager(): TransactionManager {
  if (!transactionManagerInstance) {
    transactionManagerInstance = new TransactionManager();
  }
  return transactionManagerInstance;
}

export default TransactionManager;
