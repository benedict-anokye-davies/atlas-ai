/**
 * Transaction Analyzer
 * Analyzes financial transactions and extracts entities and patterns
 */

import { createModuleLogger } from '../../../utils/logger';
import { OntologyEntity, OntologyRelationship, TradeEntity, OrganizationEntity } from '../../types';
import {
  SemanticParser,
  TransactionParsedOutput,
  TransactionInput,
  SpendingCategory,
  SpendingPattern,
  RecurringTransaction,
} from '../types';

const logger = createModuleLogger('TransactionAnalyzer');

// ============================================================================
// CATEGORY DETECTION RULES
// ============================================================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  groceries: ['tesco', 'sainsbury', 'asda', 'morrisons', 'waitrose', 'aldi', 'lidl', 'co-op', 'marks spencer food', 'grocery', 'supermarket'],
  restaurants: ['restaurant', 'cafe', 'coffee', 'starbucks', 'costa', 'mcdonald', 'burger', 'pizza', 'uber eats', 'deliveroo', 'just eat', 'dining'],
  transport: ['uber', 'taxi', 'train', 'bus', 'tfl', 'transport', 'fuel', 'petrol', 'shell', 'bp', 'esso', 'parking'],
  utilities: ['electricity', 'gas', 'water', 'council tax', 'broadband', 'internet', 'phone', 'mobile', 'ee', 'vodafone', 'o2', 'three'],
  subscriptions: ['netflix', 'spotify', 'amazon prime', 'disney', 'apple', 'google', 'subscription', 'membership', 'gym'],
  shopping: ['amazon', 'ebay', 'john lewis', 'argos', 'currys', 'shop', 'store', 'retail'],
  healthcare: ['pharmacy', 'boots', 'doctor', 'dentist', 'hospital', 'medical', 'health', 'prescription'],
  entertainment: ['cinema', 'theatre', 'concert', 'ticket', 'game', 'playstation', 'xbox', 'steam'],
  travel: ['hotel', 'booking', 'airbnb', 'flight', 'airline', 'holiday', 'vacation', 'travel'],
  income: ['salary', 'payroll', 'dividend', 'interest', 'refund', 'deposit'],
  transfer: ['transfer', 'internal', 'savings', 'investment'],
};

// ============================================================================
// TRANSACTION ANALYZER IMPLEMENTATION
// ============================================================================

export class TransactionAnalyzer implements SemanticParser<TransactionInput | TransactionInput[], TransactionParsedOutput> {
  readonly name = 'TransactionAnalyzer';
  readonly version = '1.0.0';
  readonly sourceTypes = ['banking'] as const;

  // --------------------------------------------------------------------------
  // MAIN PARSE
  // --------------------------------------------------------------------------

  async parse(input: TransactionInput | TransactionInput[]): Promise<TransactionParsedOutput> {
    const transactions = Array.isArray(input) ? input : [input];
    logger.debug('Analyzing transactions', { count: transactions.length });

    // Categorize transactions
    const categorized = transactions.map(tx => ({
      ...tx,
      category: tx.category || this.categorizeTransaction(tx),
    }));

    // Calculate spending by category
    const categories = this.calculateCategorySpending(categorized);

    // Detect spending patterns
    const patterns = this.detectSpendingPatterns(categorized);

    // Detect recurring transactions
    const recurring = this.detectRecurringTransactions(categorized);

    // Extract merchants
    const merchants = this.extractMerchants(categorized);

    const output: TransactionParsedOutput = {
      sourceType: 'banking',
      parsedAt: new Date(),
      transactions: categorized,
      categories,
      patterns,
      recurring,
      merchants,
      summary: this.generateSummary(categorized, categories),
    };

    logger.info('Transaction analysis completed', {
      transactionCount: transactions.length,
      categoryCount: categories.length,
      patternCount: patterns.length,
      recurringCount: recurring.length,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // CATEGORIZATION
  // --------------------------------------------------------------------------

  private categorizeTransaction(tx: TransactionInput): string {
    const description = tx.description.toLowerCase();
    const merchant = (tx.merchantName || '').toLowerCase();
    const searchText = `${description} ${merchant}`;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        if (searchText.includes(keyword)) {
          return category;
        }
      }
    }

    // Infer from amount
    if (tx.amount > 0) return 'income';
    if (Math.abs(tx.amount) > 1000) return 'large_expense';

    return 'uncategorized';
  }

  private calculateCategorySpending(transactions: TransactionInput[]): SpendingCategory[] {
    const categoryTotals = new Map<string, { total: number; count: number; transactions: TransactionInput[] }>();

    for (const tx of transactions) {
      const category = tx.category || 'uncategorized';
      if (!categoryTotals.has(category)) {
        categoryTotals.set(category, { total: 0, count: 0, transactions: [] });
      }

      const cat = categoryTotals.get(category)!;
      cat.total += Math.abs(tx.amount);
      cat.count++;
      cat.transactions.push(tx);
    }

    const totalSpending = Array.from(categoryTotals.values())
      .reduce((sum, c) => sum + c.total, 0);

    return Array.from(categoryTotals.entries())
      .map(([name, data]) => ({
        name,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        percentage: totalSpending > 0 ? Math.round((data.total / totalSpending) * 1000) / 10 : 0,
        trend: this.calculateCategoryTrend(data.transactions),
      }))
      .sort((a, b) => b.total - a.total);
  }

  private calculateCategoryTrend(transactions: TransactionInput[]): 'increasing' | 'stable' | 'decreasing' {
    if (transactions.length < 4) return 'stable';

    // Sort by date
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Compare first half to second half
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const firstTotal = firstHalf.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    const secondTotal = secondHalf.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    const changeRatio = secondTotal / (firstTotal || 1);

    if (changeRatio > 1.2) return 'increasing';
    if (changeRatio < 0.8) return 'decreasing';
    return 'stable';
  }

  // --------------------------------------------------------------------------
  // PATTERN DETECTION
  // --------------------------------------------------------------------------

  private detectSpendingPatterns(transactions: TransactionInput[]): SpendingPattern[] {
    const patterns: SpendingPattern[] = [];

    // Group by day of week
    const dayOfWeekSpending = new Map<number, number[]>();
    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // Skip income

      const day = new Date(tx.date).getDay();
      if (!dayOfWeekSpending.has(day)) {
        dayOfWeekSpending.set(day, []);
      }
      dayOfWeekSpending.get(day)!.push(Math.abs(tx.amount));
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const [day, amounts] of dayOfWeekSpending) {
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      if (amounts.length >= 4 && avg > 50) {
        patterns.push({
          type: 'day_of_week',
          description: `Higher spending on ${dayNames[day]}`,
          frequency: 'weekly',
          averageAmount: Math.round(avg * 100) / 100,
          confidence: Math.min(0.9, 0.5 + amounts.length * 0.05),
        });
      }
    }

    // Detect payday pattern
    const largeDeposits = transactions.filter(tx => tx.amount > 1000);
    if (largeDeposits.length >= 2) {
      const depositDays = largeDeposits.map(tx => new Date(tx.date).getDate());
      const mostCommonDay = this.findMostCommon(depositDays);

      if (mostCommonDay) {
        patterns.push({
          type: 'payday',
          description: `Payday typically on day ${mostCommonDay} of month`,
          frequency: 'monthly',
          averageAmount: largeDeposits.reduce((sum, tx) => sum + tx.amount, 0) / largeDeposits.length,
          confidence: 0.8,
        });
      }
    }

    // Detect end-of-month spending spike
    const endOfMonthTx = transactions.filter(tx => {
      const date = new Date(tx.date);
      return date.getDate() >= 25 && tx.amount < 0;
    });

    const midMonthTx = transactions.filter(tx => {
      const date = new Date(tx.date);
      return date.getDate() >= 10 && date.getDate() <= 20 && tx.amount < 0;
    });

    if (endOfMonthTx.length >= 5 && midMonthTx.length >= 5) {
      const endAvg = endOfMonthTx.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) / endOfMonthTx.length;
      const midAvg = midMonthTx.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) / midMonthTx.length;

      if (endAvg > midAvg * 1.3) {
        patterns.push({
          type: 'end_of_month_spike',
          description: 'Spending increases towards end of month',
          frequency: 'monthly',
          averageAmount: Math.round(endAvg * 100) / 100,
          confidence: 0.7,
        });
      }
    }

    return patterns;
  }

  private findMostCommon<T>(arr: T[]): T | null {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon: T | null = null;

    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    }

    return mostCommon;
  }

  // --------------------------------------------------------------------------
  // RECURRING TRANSACTION DETECTION
  // --------------------------------------------------------------------------

  private detectRecurringTransactions(transactions: TransactionInput[]): RecurringTransaction[] {
    const recurring: RecurringTransaction[] = [];

    // Group by merchant/description similarity
    const merchantGroups = new Map<string, TransactionInput[]>();

    for (const tx of transactions) {
      const key = this.normalizeDescription(tx.merchantName || tx.description);
      if (!merchantGroups.has(key)) {
        merchantGroups.set(key, []);
      }
      merchantGroups.get(key)!.push(tx);
    }

    for (const [merchant, txs] of merchantGroups) {
      if (txs.length < 2) continue;

      // Check if amounts are similar (within 10%)
      const amounts = txs.map(tx => Math.abs(tx.amount));
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const amountVariance = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.1);

      if (!amountVariance) continue;

      // Check for regular intervals
      const sortedDates = txs
        .map(tx => new Date(tx.date).getTime())
        .sort((a, b) => a - b);

      const intervals: number[] = [];
      for (let i = 1; i < sortedDates.length; i++) {
        intervals.push((sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24));
      }

      if (intervals.length < 1) continue;

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const intervalVariance = intervals.every(i => Math.abs(i - avgInterval) / avgInterval < 0.2);

      if (!intervalVariance) continue;

      // Determine frequency
      let frequency: RecurringTransaction['frequency'];
      if (avgInterval <= 8) frequency = 'weekly';
      else if (avgInterval <= 16) frequency = 'biweekly';
      else if (avgInterval <= 35) frequency = 'monthly';
      else if (avgInterval <= 100) frequency = 'quarterly';
      else frequency = 'yearly';

      // Calculate next expected date
      const lastDate = new Date(Math.max(...sortedDates));
      const nextDate = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + Math.round(avgInterval));

      recurring.push({
        merchantName: txs[0].merchantName || merchant,
        amount: Math.round(avgAmount * 100) / 100,
        frequency,
        lastDate: lastDate.toISOString(),
        nextExpectedDate: nextDate.toISOString(),
        category: txs[0].category || 'subscriptions',
        confidence: Math.min(0.95, 0.6 + txs.length * 0.1),
      });
    }

    return recurring.sort((a, b) => b.confidence - a.confidence);
  }

  private normalizeDescription(desc: string): string {
    return desc
      .toLowerCase()
      .replace(/[0-9]+/g, '') // Remove numbers (dates, reference numbers)
      .replace(/[^a-z\s]/g, '') // Remove special chars
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30); // Limit length
  }

  // --------------------------------------------------------------------------
  // MERCHANT EXTRACTION
  // --------------------------------------------------------------------------

  private extractMerchants(
    transactions: TransactionInput[]
  ): Array<{ name: string; totalSpent: number; transactionCount: number; category: string }> {
    const merchants = new Map<string, { total: number; count: number; category: string }>();

    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // Skip income

      const name = tx.merchantName || this.extractMerchantName(tx.description);
      if (!name) continue;

      if (!merchants.has(name)) {
        merchants.set(name, { total: 0, count: 0, category: tx.category || 'uncategorized' });
      }

      const m = merchants.get(name)!;
      m.total += Math.abs(tx.amount);
      m.count++;
    }

    return Array.from(merchants.entries())
      .map(([name, data]) => ({
        name,
        totalSpent: Math.round(data.total * 100) / 100,
        transactionCount: data.count,
        category: data.category,
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 50); // Top 50 merchants
  }

  private extractMerchantName(description: string): string {
    // Remove common prefixes and suffixes
    let name = description
      .replace(/^(card payment to|direct debit to|standing order to|transfer to)/gi, '')
      .replace(/\s*(ltd|limited|plc|inc|corp|llc)\.?$/gi, '')
      .trim();

    // Take first meaningful part
    const parts = name.split(/[*#@]/);
    name = parts[0].trim();

    return name.slice(0, 50);
  }

  // --------------------------------------------------------------------------
  // SUMMARY GENERATION
  // --------------------------------------------------------------------------

  private generateSummary(
    transactions: TransactionInput[],
    categories: SpendingCategory[]
  ): TransactionParsedOutput['summary'] {
    const income = transactions.filter(tx => tx.amount > 0);
    const expenses = transactions.filter(tx => tx.amount < 0);

    const totalIncome = income.reduce((sum, tx) => sum + tx.amount, 0);
    const totalExpenses = Math.abs(expenses.reduce((sum, tx) => sum + tx.amount, 0));

    // Find date range
    const dates = transactions.map(tx => new Date(tx.date).getTime());
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    const periodDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

    // Top spending categories (excluding income/transfers)
    const spendingCategories = categories.filter(c =>
      !['income', 'transfer', 'savings'].includes(c.name)
    );

    return {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netCashflow: Math.round((totalIncome - totalExpenses) * 100) / 100,
      averageDailySpend: Math.round((totalExpenses / periodDays) * 100) / 100,
      topCategories: spendingCategories.slice(0, 5).map(c => c.name),
      periodStart: minDate.toISOString(),
      periodEnd: maxDate.toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // ENTITY EXTRACTION
  // --------------------------------------------------------------------------

  extractEntities(output: TransactionParsedOutput): OntologyEntity[] {
    const entities: OntologyEntity[] = [];

    // Create Trade entities for significant transactions
    for (const tx of output.transactions) {
      // Only create entities for larger transactions or recurring ones
      if (Math.abs(tx.amount) < 50 && !output.recurring.some(r => r.merchantName === tx.merchantName)) {
        continue;
      }

      const trade: TradeEntity = {
        id: `trade_${tx.id}`,
        type: 'Trade',
        name: tx.description.slice(0, 100),
        createdAt: new Date(tx.date),
        updatedAt: new Date(tx.date),
        sources: ['banking'],
        confidence: 0.95,
        tradeType: tx.amount > 0 ? 'income' : 'expense',
        asset: tx.currency,
        amount: Math.abs(tx.amount),
        price: 1, // For fiat transactions
        executedAt: new Date(tx.date),
        status: 'executed',
        tags: [tx.category || 'uncategorized'],
        notes: tx.merchantName ? `Merchant: ${tx.merchantName}` : undefined,
      };

      entities.push(trade);
    }

    // Create Organization entities for merchants
    for (const merchant of output.merchants) {
      if (merchant.transactionCount < 3) continue; // Only frequent merchants

      const org: OrganizationEntity = {
        id: `org_${merchant.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        type: 'Organization',
        name: merchant.name,
        createdAt: new Date(),
        updatedAt: new Date(),
        sources: ['banking'],
        confidence: 0.6,
        organizationType: 'company',
        tags: [merchant.category],
        contacts: [],
        socialProfiles: [],
      };

      entities.push(org);
    }

    logger.debug('Extracted entities from transactions', {
      tradeCount: entities.filter(e => e.type === 'Trade').length,
      merchantCount: entities.filter(e => e.type === 'Organization').length,
    });

    return entities;
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIP EXTRACTION
  // --------------------------------------------------------------------------

  extractRelationships(output: TransactionParsedOutput): OntologyRelationship[] {
    const relationships: OntologyRelationship[] = [];

    // Link transactions to merchants
    for (const tx of output.transactions) {
      const merchantName = tx.merchantName || this.extractMerchantName(tx.description);
      const merchant = output.merchants.find(m => m.name === merchantName);

      if (merchant && merchant.transactionCount >= 3) {
        const tradeId = `trade_${tx.id}`;
        const merchantId = `org_${merchant.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        relationships.push({
          id: `${tradeId}_at_${merchantId}`,
          sourceId: tradeId,
          sourceType: 'Trade',
          targetId: merchantId,
          targetType: 'Organization',
          relationshipType: 'PURCHASED_FROM',
          createdAt: new Date(),
          strength: 0.9,
          confidence: 0.9,
          properties: {
            amount: tx.amount,
            date: tx.date,
          },
        });
      }
    }

    logger.debug('Extracted relationships from transactions', { count: relationships.length });
    return relationships;
  }

  // --------------------------------------------------------------------------
  // EMBEDDING GENERATION
  // --------------------------------------------------------------------------

  async generateEmbeddings(output: TransactionParsedOutput): Promise<Map<string, number[]>> {
    const embeddings = new Map<string, number[]>();

    // Placeholder - would integrate with actual embedding model
    logger.debug('Embedding generation skipped (placeholder)', {
      transactionCount: output.transactions.length,
    });

    return embeddings;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: TransactionAnalyzer | null = null;

export function getTransactionAnalyzer(): TransactionAnalyzer {
  if (!instance) {
    instance = new TransactionAnalyzer();
  }
  return instance;
}
