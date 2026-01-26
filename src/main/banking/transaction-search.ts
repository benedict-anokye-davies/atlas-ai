/**
 * Atlas Banking - Transaction Search & Export
 *
 * Advanced transaction search and CSV/PDF export functionality.
 *
 * @module banking/transaction-search
 */

import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { BankTransaction } from './types';

const logger = createModuleLogger('TransactionSearch');

/**
 * Search filter options
 */
export interface TransactionSearchFilter {
  query?: string;
  startDate?: Date | number;
  endDate?: Date | number;
  minAmount?: number;
  maxAmount?: number;
  category?: string;
  merchantName?: string;
  type?: 'income' | 'expense' | 'all';
  accountId?: string;
  tags?: string[];
}

/**
 * Search result
 */
export interface TransactionSearchResult {
  transactions: BankTransaction[];
  total: number;
  totalAmount: number;
  averageAmount: number;
  dateRange: { start: Date; end: Date } | null;
  categories: Record<string, number>;
}

/**
 * Export format
 */
export type ExportFormat = 'csv' | 'json' | 'qif' | 'ofx';

/**
 * Transaction Search Engine
 */
export class TransactionSearchEngine {
  private exportPath: string;

  constructor() {
    this.exportPath = join(app.getPath('documents'), 'Atlas Banking Exports');
  }

  /**
   * Search transactions with filters
   */
  search(
    transactions: BankTransaction[],
    filter: TransactionSearchFilter
  ): TransactionSearchResult {
    let filtered = [...transactions];

    // Text search
    if (filter.query) {
      const query = filter.query.toLowerCase();
      filtered = filtered.filter(
        (tx) =>
          tx.description.toLowerCase().includes(query) ||
          tx.merchantName?.toLowerCase().includes(query) ||
          tx.category?.toLowerCase().includes(query) ||
          tx.reference?.toLowerCase().includes(query)
      );
    }

    // Date range
    if (filter.startDate) {
      const start =
        typeof filter.startDate === 'number'
          ? filter.startDate
          : filter.startDate.getTime();
      filtered = filtered.filter((tx) => new Date(tx.date).getTime() >= start);
    }
    if (filter.endDate) {
      const end =
        typeof filter.endDate === 'number'
          ? filter.endDate
          : filter.endDate.getTime();
      filtered = filtered.filter((tx) => new Date(tx.date).getTime() <= end);
    }

    // Amount range
    if (filter.minAmount !== undefined) {
      filtered = filtered.filter((tx) => Math.abs(tx.amount) >= filter.minAmount!);
    }
    if (filter.maxAmount !== undefined) {
      filtered = filtered.filter((tx) => Math.abs(tx.amount) <= filter.maxAmount!);
    }

    // Category
    if (filter.category) {
      const cat = filter.category.toLowerCase();
      filtered = filtered.filter((tx) => tx.category?.toLowerCase() === cat);
    }

    // Merchant
    if (filter.merchantName) {
      const merchant = filter.merchantName.toLowerCase();
      filtered = filtered.filter((tx) =>
        tx.merchantName?.toLowerCase().includes(merchant)
      );
    }

    // Type (income/expense)
    if (filter.type && filter.type !== 'all') {
      if (filter.type === 'income') {
        filtered = filtered.filter((tx) => tx.amount > 0);
      } else {
        filtered = filtered.filter((tx) => tx.amount < 0);
      }
    }

    // Account
    if (filter.accountId) {
      filtered = filtered.filter((tx) => tx.accountId === filter.accountId);
    }

    // Sort by date (most recent first)
    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate summary
    const total = filtered.length;
    const totalAmount = filtered.reduce((sum, tx) => sum + tx.amount, 0);
    const averageAmount = total > 0 ? totalAmount / total : 0;

    // Date range
    let dateRange: { start: Date; end: Date } | null = null;
    if (filtered.length > 0) {
      const dates = filtered.map((tx) => new Date(tx.date));
      dateRange = {
        start: new Date(Math.min(...dates.map((d) => d.getTime()))),
        end: new Date(Math.max(...dates.map((d) => d.getTime()))),
      };
    }

    // Category breakdown
    const categories: Record<string, number> = {};
    for (const tx of filtered) {
      const cat = tx.category || 'uncategorized';
      categories[cat] = (categories[cat] || 0) + Math.abs(tx.amount);
    }

    return {
      transactions: filtered,
      total,
      totalAmount,
      averageAmount,
      dateRange,
      categories,
    };
  }

  /**
   * Quick search by text
   */
  quickSearch(transactions: BankTransaction[], query: string): BankTransaction[] {
    return this.search(transactions, { query }).transactions;
  }

  /**
   * Get transactions for date range
   */
  getByDateRange(
    transactions: BankTransaction[],
    start: Date,
    end: Date
  ): BankTransaction[] {
    return this.search(transactions, { startDate: start, endDate: end }).transactions;
  }

  /**
   * Get transactions by category
   */
  getByCategory(transactions: BankTransaction[], category: string): BankTransaction[] {
    return this.search(transactions, { category }).transactions;
  }

  /**
   * Get large transactions
   */
  getLargeTransactions(
    transactions: BankTransaction[],
    threshold: number = 100
  ): BankTransaction[] {
    return this.search(transactions, { minAmount: threshold }).transactions;
  }

  /**
   * Export transactions to CSV
   */
  exportToCSV(transactions: BankTransaction[], filename?: string): string {
    const headers = [
      'Date',
      'Description',
      'Merchant',
      'Category',
      'Amount',
      'Currency',
      'Balance',
      'Reference',
      'Type',
    ];

    const rows = transactions.map((tx) => [
      new Date(tx.date).toISOString().split('T')[0],
      `"${(tx.description || '').replace(/"/g, '""')}"`,
      `"${(tx.merchantName || '').replace(/"/g, '""')}"`,
      tx.category || '',
      tx.amount.toFixed(2),
      tx.currency || 'GBP',
      tx.runningBalance?.toFixed(2) || '',
      tx.reference || '',
      tx.amount >= 0 ? 'Credit' : 'Debit',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    // Save file
    const exportFilename = filename || `transactions_${Date.now()}.csv`;
    const filePath = this.saveExport(exportFilename, csv);

    logger.info('Exported transactions to CSV', {
      count: transactions.length,
      path: filePath,
    });

    return filePath;
  }

  /**
   * Export transactions to JSON
   */
  exportToJSON(transactions: BankTransaction[], filename?: string): string {
    const data = {
      exportDate: new Date().toISOString(),
      transactionCount: transactions.length,
      transactions: transactions.map((tx) => ({
        date: tx.date,
        description: tx.description,
        merchantName: tx.merchantName,
        category: tx.category,
        amount: tx.amount,
        currency: tx.currency || 'GBP',
        runningBalance: tx.runningBalance,
        reference: tx.reference,
        type: tx.amount >= 0 ? 'credit' : 'debit',
      })),
    };

    const json = JSON.stringify(data, null, 2);

    const exportFilename = filename || `transactions_${Date.now()}.json`;
    const filePath = this.saveExport(exportFilename, json);

    logger.info('Exported transactions to JSON', {
      count: transactions.length,
      path: filePath,
    });

    return filePath;
  }

  /**
   * Export to QIF format (Quicken Interchange Format)
   */
  exportToQIF(transactions: BankTransaction[], filename?: string): string {
    const lines: string[] = ['!Type:Bank'];

    for (const tx of transactions) {
      lines.push(`D${new Date(tx.date).toLocaleDateString('en-GB')}`);
      lines.push(`T${tx.amount.toFixed(2)}`);
      lines.push(`P${tx.merchantName || tx.description}`);
      if (tx.category) {
        lines.push(`L${tx.category}`);
      }
      if (tx.reference) {
        lines.push(`M${tx.reference}`);
      }
      lines.push('^'); // End of transaction
    }

    const qif = lines.join('\n');

    const exportFilename = filename || `transactions_${Date.now()}.qif`;
    const filePath = this.saveExport(exportFilename, qif);

    logger.info('Exported transactions to QIF', {
      count: transactions.length,
      path: filePath,
    });

    return filePath;
  }

  /**
   * Export to OFX format (Open Financial Exchange)
   */
  exportToOFX(
    transactions: BankTransaction[],
    accountInfo: { bankId: string; accountId: string; accountType: string },
    filename?: string
  ): string {
    const now = new Date();
    const dtServer = this.formatOFXDate(now);

    let minDate = now;
    let maxDate = now;
    const stmtTrans: string[] = [];

    for (const tx of transactions) {
      const txDate = new Date(tx.date);
      if (txDate < minDate) minDate = txDate;
      if (txDate > maxDate) maxDate = txDate;

      stmtTrans.push(`
<STMTTRN>
<TRNTYPE>${tx.amount >= 0 ? 'CREDIT' : 'DEBIT'}
<DTPOSTED>${this.formatOFXDate(txDate)}
<TRNAMT>${tx.amount.toFixed(2)}
<FITID>${tx.id}
<NAME>${this.escapeXML(tx.merchantName || tx.description)}
${tx.reference ? `<MEMO>${this.escapeXML(tx.reference)}` : ''}
</STMTTRN>`);
    }

    const ofx = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dtServer}
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>${Date.now()}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>GBP
<BANKACCTFROM>
<BANKID>${accountInfo.bankId}
<ACCTID>${accountInfo.accountId}
<ACCTTYPE>${accountInfo.accountType}
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${this.formatOFXDate(minDate)}
<DTEND>${this.formatOFXDate(maxDate)}
${stmtTrans.join('')}
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    const exportFilename = filename || `transactions_${Date.now()}.ofx`;
    const filePath = this.saveExport(exportFilename, ofx);

    logger.info('Exported transactions to OFX', {
      count: transactions.length,
      path: filePath,
    });

    return filePath;
  }

  /**
   * Format date for OFX
   */
  private formatOFXDate(date: Date): string {
    return date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  }

  /**
   * Escape XML special characters
   */
  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Save export file
   */
  private saveExport(filename: string, content: string): string {
    if (!existsSync(this.exportPath)) {
      mkdirSync(this.exportPath, { recursive: true });
    }

    const filePath = join(this.exportPath, filename);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Get export path
   */
  getExportPath(): string {
    return this.exportPath;
  }

  /**
   * Generate tax summary
   */
  generateTaxSummary(
    transactions: BankTransaction[],
    taxYear: { start: Date; end: Date }
  ): {
    income: { total: number; byCategory: Record<string, number> };
    expenses: { total: number; byCategory: Record<string, number> };
    net: number;
    transactionCount: number;
  } {
    const filtered = this.search(transactions, {
      startDate: taxYear.start,
      endDate: taxYear.end,
    }).transactions;

    const income = { total: 0, byCategory: {} as Record<string, number> };
    const expenses = { total: 0, byCategory: {} as Record<string, number> };

    for (const tx of filtered) {
      const category = tx.category || 'uncategorized';

      if (tx.amount > 0) {
        income.total += tx.amount;
        income.byCategory[category] = (income.byCategory[category] || 0) + tx.amount;
      } else {
        expenses.total += Math.abs(tx.amount);
        expenses.byCategory[category] =
          (expenses.byCategory[category] || 0) + Math.abs(tx.amount);
      }
    }

    return {
      income,
      expenses,
      net: income.total - expenses.total,
      transactionCount: filtered.length,
    };
  }

  /**
   * Get spending summary by period
   */
  getSpendingSummary(
    transactions: BankTransaction[],
    period: 'day' | 'week' | 'month'
  ): Array<{ period: string; income: number; expenses: number; net: number }> {
    const grouped = new Map<string, { income: number; expenses: number }>();

    for (const tx of transactions) {
      const date = new Date(tx.date);
      let key: string;

      switch (period) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      if (!grouped.has(key)) {
        grouped.set(key, { income: 0, expenses: 0 });
      }

      const entry = grouped.get(key)!;
      if (tx.amount > 0) {
        entry.income += tx.amount;
      } else {
        entry.expenses += Math.abs(tx.amount);
      }
    }

    return Array.from(grouped.entries())
      .map(([period, data]) => ({
        period,
        income: data.income,
        expenses: data.expenses,
        net: data.income - data.expenses,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }
}

// Singleton instance
let searchEngine: TransactionSearchEngine | null = null;

export function getTransactionSearchEngine(): TransactionSearchEngine {
  if (!searchEngine) {
    searchEngine = new TransactionSearchEngine();
  }
  return searchEngine;
}
