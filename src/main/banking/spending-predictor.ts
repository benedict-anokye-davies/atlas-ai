/**
 * Atlas Banking - Spending Predictor
 *
 * ML-based spending prediction to forecast end-of-month balance.
 * Uses historical patterns and recurring payments for accuracy.
 *
 * @module banking/spending-predictor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BankTransaction } from './types';

const logger = createModuleLogger('SpendingPredictor');

/**
 * Daily spending pattern
 */
interface DailyPattern {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  averageSpend: number;
  stdDev: number;
  sampleCount: number;
}

/**
 * Category spending pattern
 */
interface CategoryPattern {
  category: string;
  monthlyAverage: number;
  monthlyMax: number;
  monthlyMin: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercent: number;
}

/**
 * Spending prediction result
 */
export interface SpendingPrediction {
  predictedEndBalance: number;
  currentBalance: number;
  predictedSpending: number;
  confidence: number;
  daysRemaining: number;
  dailyBudget: number;
  warningLevel: 'ok' | 'caution' | 'warning' | 'critical';
  breakdown: Array<{
    category: string;
    predicted: number;
    confidence: number;
  }>;
  insights: string[];
  generatedAt: number;
}

/**
 * Monthly summary
 */
interface MonthlySummary {
  month: string; // YYYY-MM
  totalIncome: number;
  totalSpending: number;
  netChange: number;
  byCategory: Record<string, number>;
  byDayOfWeek: number[];
}

/**
 * Spending Predictor
 */
export class SpendingPredictor extends EventEmitter {
  private dailyPatterns: DailyPattern[] = [];
  private categoryPatterns: Map<string, CategoryPattern> = new Map();
  private monthlySummaries: MonthlySummary[] = [];
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
    this.initializeDailyPatterns();
  }

  /**
   * Initialize daily patterns
   */
  private initializeDailyPatterns(): void {
    if (this.dailyPatterns.length === 0) {
      for (let i = 0; i < 7; i++) {
        this.dailyPatterns.push({
          dayOfWeek: i,
          averageSpend: 0,
          stdDev: 0,
          sampleCount: 0,
        });
      }
    }
  }

  /**
   * Load predictor data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'spending-predictor.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.dailyPatterns = data.dailyPatterns || [];
        this.categoryPatterns = new Map(Object.entries(data.categoryPatterns || {}));
        this.monthlySummaries = data.monthlySummaries || [];
        logger.info('Loaded spending predictor data', {
          monthlySummaries: this.monthlySummaries.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load spending predictor data', { error: (error as Error).message });
    }
  }

  /**
   * Save predictor data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'spending-predictor.json');
      const data = {
        dailyPatterns: this.dailyPatterns,
        categoryPatterns: Object.fromEntries(this.categoryPatterns),
        monthlySummaries: this.monthlySummaries.slice(-24), // Keep 2 years
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save spending predictor data', { error: (error as Error).message });
    }
  }

  /**
   * Learn from historical transactions
   */
  learnFromTransactions(
    transactions: BankTransaction[],
    categoryFn?: (tx: BankTransaction) => string
  ): void {
    // Group by month
    const byMonth = new Map<string, BankTransaction[]>();

    for (const tx of transactions) {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(monthKey)) {
        byMonth.set(monthKey, []);
      }
      byMonth.get(monthKey)!.push(tx);
    }

    // Create monthly summaries
    for (const [month, txs] of byMonth) {
      const existing = this.monthlySummaries.find((s) => s.month === month);
      if (existing) continue; // Already have this month

      const summary: MonthlySummary = {
        month,
        totalIncome: 0,
        totalSpending: 0,
        netChange: 0,
        byCategory: {},
        byDayOfWeek: [0, 0, 0, 0, 0, 0, 0],
      };

      for (const tx of txs) {
        const amount = tx.amount;
        const date = new Date(tx.date);

        if (amount > 0) {
          summary.totalIncome += amount;
        } else {
          summary.totalSpending += Math.abs(amount);

          // By day of week
          summary.byDayOfWeek[date.getDay()] += Math.abs(amount);

          // By category
          const category = categoryFn ? categoryFn(tx) : tx.category || 'uncategorized';
          summary.byCategory[category] = (summary.byCategory[category] || 0) + Math.abs(amount);
        }
      }

      summary.netChange = summary.totalIncome - summary.totalSpending;
      this.monthlySummaries.push(summary);
    }

    // Sort summaries
    this.monthlySummaries.sort((a, b) => a.month.localeCompare(b.month));

    // Update daily patterns
    this.updateDailyPatterns();

    // Update category patterns
    this.updateCategoryPatterns();

    this.saveData();
    logger.info('Learned from transactions', {
      months: byMonth.size,
      totalTx: transactions.length,
    });
  }

  /**
   * Update daily spending patterns
   */
  private updateDailyPatterns(): void {
    const daySpending: number[][] = [[], [], [], [], [], [], []];

    for (const summary of this.monthlySummaries) {
      for (let day = 0; day < 7; day++) {
        if (summary.byDayOfWeek[day] > 0) {
          // Normalize to daily average (assuming 4 weeks per month)
          daySpending[day].push(summary.byDayOfWeek[day] / 4);
        }
      }
    }

    for (let day = 0; day < 7; day++) {
      const values = daySpending[day];
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
        this.dailyPatterns[day] = {
          dayOfWeek: day,
          averageSpend: avg,
          stdDev: Math.sqrt(variance),
          sampleCount: values.length,
        };
      }
    }
  }

  /**
   * Update category spending patterns
   */
  private updateCategoryPatterns(): void {
    const categoryMonthly: Map<string, number[]> = new Map();

    for (const summary of this.monthlySummaries) {
      for (const [category, amount] of Object.entries(summary.byCategory)) {
        if (!categoryMonthly.has(category)) {
          categoryMonthly.set(category, []);
        }
        categoryMonthly.get(category)!.push(amount);
      }
    }

    for (const [category, values] of categoryMonthly) {
      if (values.length < 2) continue;

      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);

      // Calculate trend (compare last 3 months to previous 3)
      let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      let trendPercent = 0;

      if (values.length >= 6) {
        const recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const previous = values.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
        trendPercent = ((recent - previous) / previous) * 100;

        if (trendPercent > 10) trend = 'increasing';
        else if (trendPercent < -10) trend = 'decreasing';
      }

      this.categoryPatterns.set(category, {
        category,
        monthlyAverage: avg,
        monthlyMax: max,
        monthlyMin: min,
        trend,
        trendPercent,
      });
    }
  }

  /**
   * Predict spending for the rest of the month
   */
  predict(
    currentBalance: number,
    upcomingRecurring: Array<{ amount: number; date: number }> = []
  ): SpendingPrediction {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = now.getDate();
    const daysRemaining = daysInMonth - currentDay;

    // Calculate predicted spending
    let predictedSpending = 0;
    const breakdown: Array<{ category: string; predicted: number; confidence: number }> = [];
    const insights: string[] = [];

    // Add upcoming recurring payments
    const recurringTotal = upcomingRecurring.reduce((sum, r) => sum + r.amount, 0);
    predictedSpending += recurringTotal;

    // Predict based on daily patterns
    let dailyTotal = 0;
    let dailyConfidence = 0;

    for (let i = 0; i < daysRemaining; i++) {
      const futureDate = new Date(now);
      futureDate.setDate(currentDay + i + 1);
      const dayOfWeek = futureDate.getDay();
      const pattern = this.dailyPatterns[dayOfWeek];

      if (pattern && pattern.sampleCount > 0) {
        dailyTotal += pattern.averageSpend;
        dailyConfidence += Math.min(pattern.sampleCount / 10, 1);
      }
    }

    predictedSpending += dailyTotal;
    dailyConfidence = daysRemaining > 0 ? dailyConfidence / daysRemaining : 0;

    // Add category predictions
    for (const [category, pattern] of this.categoryPatterns) {
      // Estimate remaining spending in category (proportional to days)
      const remainingRatio = daysRemaining / daysInMonth;
      const predicted = pattern.monthlyAverage * remainingRatio;
      const confidence = Math.min(this.monthlySummaries.length / 6, 1);

      breakdown.push({ category, predicted, confidence });

      // Generate insights
      if (pattern.trend === 'increasing' && pattern.trendPercent > 20) {
        insights.push(
          `Your ${category} spending has increased by ${pattern.trendPercent.toFixed(0)}% recently`
        );
      }
    }

    // Calculate predicted end balance
    const predictedEndBalance = currentBalance - predictedSpending;

    // Calculate daily budget
    const safeEndBalance = Math.max(predictedEndBalance, 100); // Keep at least £100
    const availableForSpending = currentBalance - safeEndBalance - recurringTotal;
    const dailyBudget = daysRemaining > 0 ? Math.max(availableForSpending / daysRemaining, 0) : 0;

    // Determine warning level
    let warningLevel: 'ok' | 'caution' | 'warning' | 'critical' = 'ok';
    if (predictedEndBalance < 0) {
      warningLevel = 'critical';
      insights.push('You may go into overdraft before month end');
    } else if (predictedEndBalance < 100) {
      warningLevel = 'warning';
      insights.push('Your balance will be very low at month end');
    } else if (predictedEndBalance < 500) {
      warningLevel = 'caution';
      insights.push('Consider reducing non-essential spending');
    }

    // Calculate overall confidence
    const hasEnoughHistory = this.monthlySummaries.length >= 3;
    const confidence = hasEnoughHistory ? Math.min(dailyConfidence, 0.85) : 0.5;

    if (!hasEnoughHistory) {
      insights.push('Predictions will improve as more transaction history is analyzed');
    }

    return {
      predictedEndBalance,
      currentBalance,
      predictedSpending,
      confidence,
      daysRemaining,
      dailyBudget,
      warningLevel,
      breakdown: breakdown.sort((a, b) => b.predicted - a.predicted).slice(0, 10),
      insights,
      generatedAt: Date.now(),
    };
  }

  /**
   * Get historical spending by category
   */
  getSpendingByCategory(months: number = 6): Map<string, number[]> {
    const result = new Map<string, number[]>();
    const recentSummaries = this.monthlySummaries.slice(-months);

    for (const summary of recentSummaries) {
      for (const [category, amount] of Object.entries(summary.byCategory)) {
        if (!result.has(category)) {
          result.set(category, []);
        }
        result.get(category)!.push(amount);
      }
    }

    return result;
  }

  /**
   * Get average monthly spending
   */
  getAverageMonthlySpending(): number {
    if (this.monthlySummaries.length === 0) return 0;
    const total = this.monthlySummaries.reduce((sum, s) => sum + s.totalSpending, 0);
    return total / this.monthlySummaries.length;
  }

  /**
   * Get average monthly income
   */
  getAverageMonthlyIncome(): number {
    if (this.monthlySummaries.length === 0) return 0;
    const total = this.monthlySummaries.reduce((sum, s) => sum + s.totalIncome, 0);
    return total / this.monthlySummaries.length;
  }

  /**
   * Get spending trend
   */
  getSpendingTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    percentChange: number;
    last3Months: number;
    previous3Months: number;
  } {
    if (this.monthlySummaries.length < 6) {
      return { trend: 'stable', percentChange: 0, last3Months: 0, previous3Months: 0 };
    }

    const last3 = this.monthlySummaries.slice(-3);
    const prev3 = this.monthlySummaries.slice(-6, -3);

    const last3Avg = last3.reduce((sum, s) => sum + s.totalSpending, 0) / 3;
    const prev3Avg = prev3.reduce((sum, s) => sum + s.totalSpending, 0) / 3;

    const percentChange = ((last3Avg - prev3Avg) / prev3Avg) * 100;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (percentChange > 10) trend = 'increasing';
    else if (percentChange < -10) trend = 'decreasing';

    return {
      trend,
      percentChange,
      last3Months: last3Avg,
      previous3Months: prev3Avg,
    };
  }

  /**
   * Get day of week spending patterns
   */
  getDayOfWeekPatterns(): Array<{ day: string; average: number; peak: boolean }> {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const maxSpend = Math.max(...this.dailyPatterns.map((p) => p.averageSpend));

    return this.dailyPatterns.map((pattern, i) => ({
      day: dayNames[i],
      average: pattern.averageSpend,
      peak: pattern.averageSpend === maxSpend && maxSpend > 0,
    }));
  }

  /**
   * Get category patterns
   */
  getCategoryPatterns(): CategoryPattern[] {
    return Array.from(this.categoryPatterns.values()).sort(
      (a, b) => b.monthlyAverage - a.monthlyAverage
    );
  }

  /**
   * Clear all learned data
   */
  clearData(): void {
    this.dailyPatterns = [];
    this.categoryPatterns.clear();
    this.monthlySummaries = [];
    this.initializeDailyPatterns();
    this.saveData();
    logger.info('Cleared spending predictor data');
  }
}

// Singleton instance
let predictor: SpendingPredictor | null = null;

export function getSpendingPredictor(): SpendingPredictor {
  if (!predictor) {
    predictor = new SpendingPredictor();
  }
  return predictor;
}
