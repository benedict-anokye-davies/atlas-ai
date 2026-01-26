/**
 * Atlas Desktop - Expense Tracker
 * Business expense tracking with VAT and receipt management
 *
 * @module business/finance/expense-tracker
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import { Expense, ExpenseCategory } from '../types';

const logger = createModuleLogger('ExpenseTracker');

/**
 * Expense Tracker Events
 */
export interface ExpenseTrackerEvents {
  'expense-created': (expense: Expense) => void;
  'expense-updated': (expense: Expense) => void;
  'expense-deleted': (expenseId: string) => void;
}

/**
 * Expense search filters
 */
export interface ExpenseSearchFilters {
  category?: ExpenseCategory[];
  projectId?: string;
  clientId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  hasReceipt?: boolean;
}

/**
 * Expense Tracker
 * Handles business expense tracking for AtlasAgency
 */
export class ExpenseTracker extends EventEmitter {
  private expenses: Map<string, Expense> = new Map();
  private dataDir: string;
  private receiptsDir: string;
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
    this.receiptsDir = path.join(this.dataDir, 'receipts');
  }

  /**
   * Initialize the expense tracker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(this.receiptsDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('ExpenseTracker initialized', { expenseCount: this.expenses.size });
    } catch (error) {
      logger.error('Failed to initialize ExpenseTracker', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const expensesPath = path.join(this.dataDir, 'expenses.json');

    try {
      const expensesData = await fs.readFile(expensesPath, 'utf-8');
      const expenses = JSON.parse(expensesData) as Expense[];
      for (const expense of expenses) {
        expense.date = new Date(expense.date);
        expense.createdAt = new Date(expense.createdAt);
        this.expenses.set(expense.id, expense);
      }
    } catch {
      // File doesn't exist, start fresh
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const expensesPath = path.join(this.dataDir, 'expenses.json');
    await fs.writeFile(expensesPath, JSON.stringify([...this.expenses.values()], null, 2));
  }

  // ============================================================
  // Expense CRUD
  // ============================================================

  /**
   * Create a new expense
   */
  async createExpense(data: {
    description: string;
    amount: number;
    currency?: string;
    date?: Date;
    category: ExpenseCategory;
    projectId?: string;
    clientId?: string;
    vatAmount?: number;
    vatRate?: number;
    vendor?: string;
    receiptPath?: string;
    notes?: string;
  }): Promise<Expense> {
    const expense: Expense = {
      id: randomUUID(),
      description: data.description,
      amount: data.amount,
      currency: data.currency || 'GBP',
      date: data.date || new Date(),
      category: data.category,
      projectId: data.projectId,
      clientId: data.clientId,
      vatAmount: data.vatAmount || 0,
      vatRate: data.vatRate || 0,
      vendor: data.vendor,
      receiptPath: data.receiptPath,
      notes: data.notes,
      createdAt: new Date(),
    };

    this.expenses.set(expense.id, expense);
    await this.saveData();

    this.emit('expense-created', expense);
    logger.info('Expense created', { expenseId: expense.id, amount: expense.amount });

    return expense;
  }

  /**
   * Get an expense by ID
   */
  getExpense(expenseId: string): Expense | undefined {
    return this.expenses.get(expenseId);
  }

  /**
   * Get all expenses
   */
  getAllExpenses(): Expense[] {
    return [...this.expenses.values()].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Search expenses with filters
   */
  searchExpenses(filters: ExpenseSearchFilters): Expense[] {
    let results = [...this.expenses.values()];

    if (filters.category && filters.category.length > 0) {
      results = results.filter(e => filters.category!.includes(e.category));
    }

    if (filters.projectId) {
      results = results.filter(e => e.projectId === filters.projectId);
    }

    if (filters.clientId) {
      results = results.filter(e => e.clientId === filters.clientId);
    }

    if (filters.startDate) {
      results = results.filter(e => new Date(e.date) >= filters.startDate!);
    }

    if (filters.endDate) {
      results = results.filter(e => new Date(e.date) <= filters.endDate!);
    }

    if (filters.minAmount !== undefined) {
      results = results.filter(e => e.amount >= filters.minAmount!);
    }

    if (filters.maxAmount !== undefined) {
      results = results.filter(e => e.amount <= filters.maxAmount!);
    }

    if (filters.hasReceipt !== undefined) {
      results = results.filter(e => 
        filters.hasReceipt ? !!e.receiptPath : !e.receiptPath
      );
    }

    return results.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Update an expense
   */
  async updateExpense(expenseId: string, updates: Partial<Omit<Expense, 'id' | 'createdAt'>>): Promise<Expense | undefined> {
    const expense = this.expenses.get(expenseId);
    if (!expense) return undefined;

    const updatedExpense: Expense = {
      ...expense,
      ...updates,
    };

    this.expenses.set(expenseId, updatedExpense);
    await this.saveData();

    this.emit('expense-updated', updatedExpense);
    return updatedExpense;
  }

  /**
   * Delete an expense
   */
  async deleteExpense(expenseId: string): Promise<boolean> {
    const expense = this.expenses.get(expenseId);
    if (!expense) return false;

    // Delete associated receipt if exists
    if (expense.receiptPath) {
      try {
        await fs.unlink(expense.receiptPath);
      } catch {
        // Receipt file may not exist
      }
    }

    this.expenses.delete(expenseId);
    await this.saveData();

    this.emit('expense-deleted', expenseId);
    logger.info('Expense deleted', { expenseId });
    return true;
  }

  // ============================================================
  // Receipt Management
  // ============================================================

  /**
   * Save a receipt for an expense
   */
  async saveReceipt(expenseId: string, receiptBuffer: Buffer, filename: string): Promise<string | undefined> {
    const expense = this.expenses.get(expenseId);
    if (!expense) return undefined;

    const ext = path.extname(filename) || '.jpg';
    const receiptFilename = `${expenseId}${ext}`;
    const receiptPath = path.join(this.receiptsDir, receiptFilename);

    await fs.writeFile(receiptPath, receiptBuffer);

    expense.receiptPath = receiptPath;
    await this.saveData();

    logger.info('Receipt saved', { expenseId, receiptPath });
    return receiptPath;
  }

  /**
   * Get receipt for an expense
   */
  async getReceipt(expenseId: string): Promise<Buffer | undefined> {
    const expense = this.expenses.get(expenseId);
    if (!expense?.receiptPath) return undefined;

    try {
      return await fs.readFile(expense.receiptPath);
    } catch {
      return undefined;
    }
  }

  /**
   * Get expenses missing receipts
   */
  getExpensesMissingReceipts(): Expense[] {
    return [...this.expenses.values()].filter(e => !e.receiptPath);
  }

  // ============================================================
  // Category-based Queries
  // ============================================================

  /**
   * Get expenses by category
   */
  getExpensesByCategory(category: ExpenseCategory): Expense[] {
    return this.searchExpenses({ category: [category] });
  }

  /**
   * Get expense breakdown by category for a period
   */
  getCategoryBreakdown(startDate?: Date, endDate?: Date): Record<ExpenseCategory, number> {
    const breakdown: Record<ExpenseCategory, number> = {
      software: 0,
      hardware: 0,
      travel: 0,
      meals: 0,
      office: 0,
      marketing: 0,
      professional_services: 0,
      training: 0,
      utilities: 0,
      insurance: 0,
      other: 0,
    };

    let expenses = this.getAllExpenses();
    
    if (startDate) {
      expenses = expenses.filter(e => new Date(e.date) >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter(e => new Date(e.date) <= endDate);
    }

    for (const expense of expenses) {
      breakdown[expense.category] += expense.amount;
    }

    return breakdown;
  }

  // ============================================================
  // Time-based Queries
  // ============================================================

  /**
   * Get expenses for a date range
   */
  getExpensesForDateRange(startDate: Date, endDate: Date): Expense[] {
    return this.searchExpenses({ startDate, endDate });
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): Expense[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getExpensesForDateRange(today, tomorrow);
  }

  /**
   * Get this month's expenses
   */
  getThisMonthExpenses(): Expense[] {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getExpensesForDateRange(startOfMonth, now);
  }

  /**
   * Get expenses for tax year (UK: April 6 - April 5)
   */
  getTaxYearExpenses(year?: number): Expense[] {
    const now = new Date();
    const currentYear = year || (now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6) 
      ? now.getFullYear() - 1 
      : now.getFullYear());
    
    const startDate = new Date(currentYear, 3, 6); // April 6
    const endDate = new Date(currentYear + 1, 3, 5); // April 5 next year
    
    return this.getExpensesForDateRange(startDate, endDate);
  }

  // ============================================================
  // VAT & Tax Reporting
  // ============================================================

  /**
   * Get total VAT reclaimable for a period
   */
  getVATReclaimable(startDate?: Date, endDate?: Date): number {
    let expenses = this.getAllExpenses();
    
    if (startDate) {
      expenses = expenses.filter(e => new Date(e.date) >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter(e => new Date(e.date) <= endDate);
    }

    return expenses.reduce((sum, e) => sum + (e.vatAmount || 0), 0);
  }

  /**
   * Get quarterly VAT summary (for MTD)
   */
  getQuarterlyVATSummary(year: number, quarter: 1 | 2 | 3 | 4): {
    totalExpenses: number;
    totalVAT: number;
    byCategory: Record<ExpenseCategory, { amount: number; vat: number }>;
  } {
    const startMonth = (quarter - 1) * 3;
    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, startMonth + 3, 0);

    const expenses = this.getExpensesForDateRange(startDate, endDate);

    const byCategory: Record<ExpenseCategory, { amount: number; vat: number }> = {
      software: { amount: 0, vat: 0 },
      hardware: { amount: 0, vat: 0 },
      travel: { amount: 0, vat: 0 },
      meals: { amount: 0, vat: 0 },
      office: { amount: 0, vat: 0 },
      marketing: { amount: 0, vat: 0 },
      professional_services: { amount: 0, vat: 0 },
      training: { amount: 0, vat: 0 },
      utilities: { amount: 0, vat: 0 },
      insurance: { amount: 0, vat: 0 },
      other: { amount: 0, vat: 0 },
    };

    let totalExpenses = 0;
    let totalVAT = 0;

    for (const expense of expenses) {
      byCategory[expense.category].amount += expense.amount;
      byCategory[expense.category].vat += expense.vatAmount || 0;
      totalExpenses += expense.amount;
      totalVAT += expense.vatAmount || 0;
    }

    return { totalExpenses, totalVAT, byCategory };
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get total expenses for a period
   */
  getTotalExpenses(startDate?: Date, endDate?: Date): number {
    let expenses = this.getAllExpenses();
    
    if (startDate) {
      expenses = expenses.filter(e => new Date(e.date) >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter(e => new Date(e.date) <= endDate);
    }

    return expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Get this month's total
   */
  getThisMonthTotal(): number {
    return this.getThisMonthExpenses().reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Get expense statistics
   */
  getStats(): {
    totalExpenses: number;
    totalVAT: number;
    thisMonthTotal: number;
    thisMonthVAT: number;
    topCategory: ExpenseCategory | null;
    expenseCount: number;
    missingReceipts: number;
  } {
    const all = this.getAllExpenses();
    const thisMonth = this.getThisMonthExpenses();
    const breakdown = this.getCategoryBreakdown();

    let topCategory: ExpenseCategory | null = null;
    let topAmount = 0;
    for (const [cat, amount] of Object.entries(breakdown)) {
      if (amount > topAmount) {
        topAmount = amount;
        topCategory = cat as ExpenseCategory;
      }
    }

    return {
      totalExpenses: all.reduce((sum, e) => sum + e.amount, 0),
      totalVAT: all.reduce((sum, e) => sum + (e.vatAmount || 0), 0),
      thisMonthTotal: thisMonth.reduce((sum, e) => sum + e.amount, 0),
      thisMonthVAT: thisMonth.reduce((sum, e) => sum + (e.vatAmount || 0), 0),
      topCategory,
      expenseCount: all.length,
      missingReceipts: this.getExpensesMissingReceipts().length,
    };
  }
}

// Singleton instance
let instance: ExpenseTracker | null = null;

/**
 * Get the singleton Expense Tracker instance
 */
export function getExpenseTracker(): ExpenseTracker {
  if (!instance) {
    instance = new ExpenseTracker();
  }
  return instance;
}

/**
 * Initialize the Expense Tracker (call on app startup)
 */
export async function initializeExpenseTracker(): Promise<ExpenseTracker> {
  const tracker = getExpenseTracker();
  await tracker.initialize();
  return tracker;
}
