/**
 * Atlas Banking - Transaction Categorizer
 *
 * ML-based transaction categorization using merchant names.
 * Learns from user corrections to improve over time.
 *
 * @module banking/transaction-categorizer
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const logger = createModuleLogger('TransactionCategorizer');

/**
 * Transaction category definitions
 */
export const CATEGORIES = {
  // Essential
  GROCERIES: 'Groceries',
  UTILITIES: 'Utilities',
  RENT_MORTGAGE: 'Rent/Mortgage',
  TRANSPORT: 'Transport',
  HEALTHCARE: 'Healthcare',
  INSURANCE: 'Insurance',

  // Lifestyle
  DINING: 'Dining Out',
  ENTERTAINMENT: 'Entertainment',
  SHOPPING: 'Shopping',
  SUBSCRIPTIONS: 'Subscriptions',
  PERSONAL_CARE: 'Personal Care',
  FITNESS: 'Fitness',

  // Financial
  TRANSFERS: 'Transfers',
  INVESTMENTS: 'Investments',
  FEES: 'Bank Fees',
  ATM: 'Cash/ATM',

  // Income
  SALARY: 'Salary',
  FREELANCE: 'Freelance Income',
  REFUND: 'Refund',
  INTEREST: 'Interest',

  // Other
  TRAVEL: 'Travel',
  EDUCATION: 'Education',
  GIFTS: 'Gifts',
  CHARITY: 'Charity',
  PETS: 'Pets',
  CHILDREN: 'Children',
  OTHER: 'Other',
} as const;

export type CategoryType = (typeof CATEGORIES)[keyof typeof CATEGORIES];

/**
 * Merchant pattern for categorization
 */
interface MerchantPattern {
  pattern: RegExp;
  category: CategoryType;
  confidence: number;
}

/**
 * User correction for learning
 */
interface CategoryCorrection {
  merchantName: string;
  originalCategory: CategoryType;
  correctedCategory: CategoryType;
  timestamp: number;
}

/**
 * Categorization result
 */
export interface CategorizationResult {
  category: CategoryType;
  confidence: number;
  source: 'rule' | 'learned' | 'default';
  alternativeCategories?: Array<{ category: CategoryType; confidence: number }>;
}

/**
 * Built-in merchant patterns (UK-focused)
 */
const BUILT_IN_PATTERNS: MerchantPattern[] = [
  // Supermarkets
  { pattern: /tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|co-?op|ocado|iceland/i, category: CATEGORIES.GROCERIES, confidence: 0.95 },
  { pattern: /marks.*spencer|m&s/i, category: CATEGORIES.GROCERIES, confidence: 0.8 },

  // Transport
  { pattern: /uber|bolt|lyft|addison.*lee/i, category: CATEGORIES.TRANSPORT, confidence: 0.95 },
  { pattern: /tfl|transport.*london|oyster|contactless.*tfl/i, category: CATEGORIES.TRANSPORT, confidence: 0.98 },
  { pattern: /trainline|national.*rail|gwr|avanti|lner|southeastern|thameslink/i, category: CATEGORIES.TRANSPORT, confidence: 0.95 },
  { pattern: /bp|shell|esso|texaco|petrol|fuel/i, category: CATEGORIES.TRANSPORT, confidence: 0.9 },
  { pattern: /parking|ncp|q-?park|justpark/i, category: CATEGORIES.TRANSPORT, confidence: 0.9 },

  // Dining
  { pattern: /deliveroo|uber.*eats|just.*eat|dominos|pizza.*hut|papa.*john/i, category: CATEGORIES.DINING, confidence: 0.95 },
  { pattern: /mcdonald|burger.*king|kfc|nandos|wagamama|pret|greggs|costa|starbucks|caffe.*nero/i, category: CATEGORIES.DINING, confidence: 0.95 },
  { pattern: /restaurant|cafe|coffee|pub|bar|grill|kitchen|bistro|tavern/i, category: CATEGORIES.DINING, confidence: 0.7 },

  // Subscriptions
  { pattern: /netflix|spotify|apple.*music|amazon.*prime|disney|youtube.*premium|audible/i, category: CATEGORIES.SUBSCRIPTIONS, confidence: 0.98 },
  { pattern: /sky|virgin.*media|bt.*sport|now.*tv|britbox|hayu/i, category: CATEGORIES.SUBSCRIPTIONS, confidence: 0.95 },
  { pattern: /gym|puregym|the.*gym|anytime.*fitness|david.*lloyd|nuffield/i, category: CATEGORIES.FITNESS, confidence: 0.95 },

  // Utilities
  { pattern: /british.*gas|edf|eon|octopus.*energy|bulb|ovo|scottish.*power/i, category: CATEGORIES.UTILITIES, confidence: 0.95 },
  { pattern: /thames.*water|severn.*trent|anglian.*water|united.*utilities/i, category: CATEGORIES.UTILITIES, confidence: 0.95 },
  { pattern: /council.*tax|hmrc/i, category: CATEGORIES.UTILITIES, confidence: 0.9 },

  // Shopping
  { pattern: /amazon|ebay|argos|currys|john.*lewis|next|asos|boohoo|zara|h&m|primark/i, category: CATEGORIES.SHOPPING, confidence: 0.85 },
  { pattern: /apple\.com|google.*store|microsoft/i, category: CATEGORIES.SHOPPING, confidence: 0.8 },

  // Entertainment
  { pattern: /cinema|odeon|cineworld|vue|showcase/i, category: CATEGORIES.ENTERTAINMENT, confidence: 0.95 },
  { pattern: /ticketmaster|eventbrite|seetickets|dice/i, category: CATEGORIES.ENTERTAINMENT, confidence: 0.9 },
  { pattern: /playstation|xbox|steam|nintendo/i, category: CATEGORIES.ENTERTAINMENT, confidence: 0.9 },

  // Healthcare
  { pattern: /boots|superdrug|pharmacy|chemist/i, category: CATEGORIES.HEALTHCARE, confidence: 0.7 },
  { pattern: /dentist|dental|doctor|gp|nhs|bupa|vitality/i, category: CATEGORIES.HEALTHCARE, confidence: 0.9 },

  // Insurance
  { pattern: /admiral|direct.*line|aviva|axa|zurich|more.*than|hastings/i, category: CATEGORIES.INSURANCE, confidence: 0.9 },

  // Financial
  { pattern: /interest|dividend/i, category: CATEGORIES.INTEREST, confidence: 0.9 },
  { pattern: /fee|charge|overdraft/i, category: CATEGORIES.FEES, confidence: 0.85 },
  { pattern: /atm|cash.*machine|cashpoint/i, category: CATEGORIES.ATM, confidence: 0.95 },
  { pattern: /transfer|sent.*to|payment.*to/i, category: CATEGORIES.TRANSFERS, confidence: 0.7 },

  // Income
  { pattern: /salary|wages|payroll/i, category: CATEGORIES.SALARY, confidence: 0.95 },
  { pattern: /refund|returned|cashback/i, category: CATEGORIES.REFUND, confidence: 0.85 },

  // Travel
  { pattern: /hotel|airbnb|booking\.com|expedia|trivago|premier.*inn|travelodge/i, category: CATEGORIES.TRAVEL, confidence: 0.9 },
  { pattern: /british.*airways|easyjet|ryanair|jet2|tui|virgin.*atlantic/i, category: CATEGORIES.TRAVEL, confidence: 0.95 },

  // Personal Care
  { pattern: /haircut|salon|barber|spa|beauty/i, category: CATEGORIES.PERSONAL_CARE, confidence: 0.85 },

  // Charity
  { pattern: /donate|donation|charity|oxfam|red.*cross|cancer.*research/i, category: CATEGORIES.CHARITY, confidence: 0.9 },

  // Pets
  { pattern: /pets.*home|pet.*shop|vet|veterinary/i, category: CATEGORIES.PETS, confidence: 0.9 },

  // Education
  { pattern: /university|college|school|tuition|udemy|coursera|skillshare/i, category: CATEGORIES.EDUCATION, confidence: 0.85 },
];

/**
 * Transaction Categorizer with ML learning
 */
export class TransactionCategorizer extends EventEmitter {
  private learnedPatterns: Map<string, { category: CategoryType; count: number }> = new Map();
  private corrections: CategoryCorrection[] = [];
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadLearnedData();
  }

  /**
   * Load learned categorization data
   */
  private loadLearnedData(): void {
    try {
      const filePath = join(this.dataPath, 'categorizer-data.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.learnedPatterns = new Map(Object.entries(data.patterns || {}));
        this.corrections = data.corrections || [];
        logger.info('Loaded learned categorization data', {
          patterns: this.learnedPatterns.size,
          corrections: this.corrections.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load categorizer data', { error: (error as Error).message });
    }
  }

  /**
   * Save learned categorization data
   */
  private saveLearnedData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'categorizer-data.json');
      const data = {
        patterns: Object.fromEntries(this.learnedPatterns),
        corrections: this.corrections.slice(-1000), // Keep last 1000 corrections
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save categorizer data', { error: (error as Error).message });
    }
  }

  /**
   * Normalize merchant name for matching
   */
  private normalizeMerchant(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Categorize a transaction
   */
  categorize(merchantName: string, amount?: number): CategorizationResult {
    const normalized = this.normalizeMerchant(merchantName);

    // 1. Check learned patterns first (user corrections)
    const learned = this.learnedPatterns.get(normalized);
    if (learned && learned.count >= 2) {
      return {
        category: learned.category,
        confidence: Math.min(0.95, 0.7 + learned.count * 0.05),
        source: 'learned',
      };
    }

    // 2. Check built-in patterns
    const matches: Array<{ category: CategoryType; confidence: number }> = [];

    for (const pattern of BUILT_IN_PATTERNS) {
      if (pattern.pattern.test(merchantName)) {
        matches.push({
          category: pattern.category,
          confidence: pattern.confidence,
        });
      }
    }

    if (matches.length > 0) {
      // Sort by confidence and return best match
      matches.sort((a, b) => b.confidence - a.confidence);
      return {
        category: matches[0].category,
        confidence: matches[0].confidence,
        source: 'rule',
        alternativeCategories: matches.slice(1, 4),
      };
    }

    // 3. Use amount-based heuristics
    if (amount !== undefined) {
      // Large positive amounts are likely income
      if (amount > 500) {
        return {
          category: CATEGORIES.SALARY,
          confidence: 0.3,
          source: 'default',
        };
      }
      // Small recurring amounts might be subscriptions
      if (amount < 20 && amount > 0) {
        return {
          category: CATEGORIES.SUBSCRIPTIONS,
          confidence: 0.2,
          source: 'default',
        };
      }
    }

    // 4. Default to Other
    return {
      category: CATEGORIES.OTHER,
      confidence: 0.1,
      source: 'default',
    };
  }

  /**
   * Batch categorize transactions
   */
  categorizeMany(transactions: Array<{ merchantName: string; amount?: number }>): CategorizationResult[] {
    return transactions.map((tx) => this.categorize(tx.merchantName, tx.amount));
  }

  /**
   * Learn from user correction
   */
  correct(merchantName: string, originalCategory: CategoryType, correctedCategory: CategoryType): void {
    const normalized = this.normalizeMerchant(merchantName);

    // Update learned patterns
    const existing = this.learnedPatterns.get(normalized);
    if (existing) {
      if (existing.category === correctedCategory) {
        existing.count++;
      } else {
        // Override with new category
        this.learnedPatterns.set(normalized, { category: correctedCategory, count: 1 });
      }
    } else {
      this.learnedPatterns.set(normalized, { category: correctedCategory, count: 1 });
    }

    // Record correction
    this.corrections.push({
      merchantName,
      originalCategory,
      correctedCategory,
      timestamp: Date.now(),
    });

    this.saveLearnedData();
    this.emit('correction', { merchantName, originalCategory, correctedCategory });

    logger.info('Learned category correction', { merchantName, originalCategory, correctedCategory });
  }

  /**
   * Get category statistics
   */
  getStatistics(): {
    totalPatterns: number;
    learnedPatterns: number;
    totalCorrections: number;
    topCategories: Array<{ category: CategoryType; count: number }>;
  } {
    const categoryCounts = new Map<CategoryType, number>();

    for (const { category } of this.learnedPatterns.values()) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    const topCategories = Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPatterns: BUILT_IN_PATTERNS.length,
      learnedPatterns: this.learnedPatterns.size,
      totalCorrections: this.corrections.length,
      topCategories,
    };
  }

  /**
   * Get all categories
   */
  getAllCategories(): CategoryType[] {
    return Object.values(CATEGORIES);
  }

  /**
   * Suggest category based on partial merchant name
   */
  suggest(partialName: string): Array<{ category: CategoryType; confidence: number }> {
    const results: Array<{ category: CategoryType; confidence: number }> = [];

    for (const pattern of BUILT_IN_PATTERNS) {
      if (pattern.pattern.test(partialName)) {
        results.push({
          category: pattern.category,
          confidence: pattern.confidence * 0.8,
        });
      }
    }

    // Deduplicate and sort
    const seen = new Set<CategoryType>();
    return results
      .filter((r) => {
        if (seen.has(r.category)) return false;
        seen.add(r.category);
        return true;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}

// Singleton instance
let categorizer: TransactionCategorizer | null = null;

export function getTransactionCategorizer(): TransactionCategorizer {
  if (!categorizer) {
    categorizer = new TransactionCategorizer();
  }
  return categorizer;
}
