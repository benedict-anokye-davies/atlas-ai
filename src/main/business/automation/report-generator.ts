/**
 * Atlas Desktop - Report Generator
 * Automated business report generation
 *
 * @module business/automation/report-generator
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';
import { getClientManager } from '../crm/client-manager';
import { getProjectManager } from '../projects/project-manager';
import { getTimeTracker } from '../projects/time-tracker';
import { getInvoiceManager } from '../finance/invoice-manager';
import { getExpenseTracker } from '../finance/expense-tracker';
import { getLeadManager } from '../pipeline/lead-manager';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('ReportGenerator');

// ============================================================
// Types
// ============================================================

export interface ReportPeriod {
  start: Date;
  end: Date;
  name: string;
}

export interface WeeklyReport {
  period: ReportPeriod;
  generatedAt: Date;
  highlights: string[];
  time: {
    hoursWorked: number;
    billableHours: number;
    unbilledValue: number;
    projectBreakdown: Array<{ project: string; hours: number }>;
  };
  revenue: {
    invoicesSent: number;
    invoiceValue: number;
    paymentsReceived: number;
    outstanding: number;
  };
  pipeline: {
    newLeads: number;
    leadsConverted: number;
    leadsLost: number;
    pipelineValue: number;
  };
  projects: {
    started: number;
    completed: number;
    active: number;
  };
}

export interface MonthlyReport extends WeeklyReport {
  expenses: {
    total: number;
    byCategory: Record<string, number>;
    vatReclaimable: number;
  };
  profitLoss: {
    revenue: number;
    expenses: number;
    grossProfit: number;
    profitMargin: number;
  };
  clientMetrics: {
    totalClients: number;
    newClients: number;
    clientRetention: number;
    topClientsByRevenue: Array<{ name: string; revenue: number }>;
  };
}

export interface QuarterlyReport extends MonthlyReport {
  quarterNumber: number;
  yearToDate: {
    revenue: number;
    expenses: number;
    profit: number;
  };
  projections: {
    nextQuarterRevenue: number;
    yearEndRevenue: number;
    growthRate: number;
  };
  vatSummary: {
    vatCollected: number;
    vatPaid: number;
    netVAT: number;
  };
}

export interface ReportGeneratorConfig {
  reportsDir: string;
  autoGenerateWeekly: boolean;
  autoGenerateMonthly: boolean;
  weeklyReportDay: number; // 0 = Sunday, 1 = Monday, etc.
}

// ============================================================
// Implementation
// ============================================================

let instance: ReportGenerator | null = null;

export class ReportGenerator extends EventEmitter {
  private config: ReportGeneratorConfig;
  private initialized = false;

  constructor(config?: Partial<ReportGeneratorConfig>) {
    super();
    this.config = {
      reportsDir: path.join(app.getPath('userData'), 'business', 'reports'),
      autoGenerateWeekly: true,
      autoGenerateMonthly: true,
      weeklyReportDay: 1, // Monday
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await fs.mkdir(this.config.reportsDir, { recursive: true });
    this.initialized = true;
    logger.info('Report generator initialized');
  }

  // ============================================================
  // Weekly Report
  // ============================================================

  async generateWeeklyReport(weekStart?: Date): Promise<WeeklyReport> {
    const period = this.getWeekPeriod(weekStart);
    logger.info(`Generating weekly report for ${period.name}`);

    const timeTracker = getTimeTracker();
    const invoiceManager = getInvoiceManager();
    const leadManager = getLeadManager();
    const projectManager = getProjectManager();

    // Time tracking
    const timeEntries = timeTracker.getEntriesForPeriod(period.start, period.end);
    const projectBreakdown = this.aggregateTimeByProject(timeEntries);
    const unbilledEntries = timeEntries.filter(e => !e.invoiced && e.billable);
    const unbilledValue = unbilledEntries.reduce((sum, e) => sum + (e.hours * (e.hourlyRate || 0)), 0);

    // Revenue
    const invoices = invoiceManager.getInvoicesForPeriod(period.start, period.end);
    const payments = invoiceManager.getPaymentsForPeriod(period.start, period.end);
    const stats = invoiceManager.getStats();

    // Pipeline
    const leadStats = leadManager.getStats();

    // Projects
    const projects = projectManager.searchProjects({});
    const startedThisWeek = projects.filter(p => 
      new Date(p.startDate || p.createdAt) >= period.start &&
      new Date(p.startDate || p.createdAt) <= period.end
    ).length;
    const completedThisWeek = projects.filter(p =>
      p.completedDate &&
      new Date(p.completedDate) >= period.start &&
      new Date(p.completedDate) <= period.end
    ).length;

    const report: WeeklyReport = {
      period,
      generatedAt: new Date(),
      highlights: this.generateHighlights('weekly', {
        hoursWorked: timeEntries.reduce((sum, e) => sum + e.hours, 0),
        revenue: payments.reduce((sum, p) => sum + p.amount, 0),
        newLeads: leadStats.active,
      }),
      time: {
        hoursWorked: timeEntries.reduce((sum, e) => sum + e.hours, 0),
        billableHours: timeEntries.filter(e => e.billable).reduce((sum, e) => sum + e.hours, 0),
        unbilledValue,
        projectBreakdown,
      },
      revenue: {
        invoicesSent: invoices.length,
        invoiceValue: invoices.reduce((sum, i) => sum + i.total, 0),
        paymentsReceived: payments.reduce((sum, p) => sum + p.amount, 0),
        outstanding: stats.totalOutstanding,
      },
      pipeline: {
        newLeads: leadStats.active,
        leadsConverted: leadStats.byStatus.won || 0,
        leadsLost: leadStats.byStatus.lost || 0,
        pipelineValue: leadStats.pipelineValue,
      },
      projects: {
        started: startedThisWeek,
        completed: completedThisWeek,
        active: projects.filter(p => p.status === 'in_progress').length,
      },
    };

    await this.saveReport(report, 'weekly', period);
    this.emit('report-generated', { type: 'weekly', report });
    
    return report;
  }

  // ============================================================
  // Monthly Report
  // ============================================================

  async generateMonthlyReport(month?: Date): Promise<MonthlyReport> {
    const period = this.getMonthPeriod(month);
    logger.info(`Generating monthly report for ${period.name}`);

    // Get weekly report data first
    const weeklyBase = await this.generateWeeklyReport(period.start);
    
    const expenseTracker = getExpenseTracker();
    const invoiceManager = getInvoiceManager();
    const clientManager = getClientManager();

    // Expenses
    const expenses = expenseTracker.getExpensesForPeriod(period.start, period.end);
    const categoryBreakdown = this.aggregateExpensesByCategory(expenses);
    const vatReclaimable = expenses.reduce((sum, e) => sum + (e.vatAmount || 0), 0);

    // Profit/Loss
    const payments = invoiceManager.getPaymentsForPeriod(period.start, period.end);
    const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const grossProfit = revenue - totalExpenses;

    // Client metrics
    const clients = clientManager.searchClients({});
    const newClients = clients.filter(c =>
      new Date(c.createdAt) >= period.start &&
      new Date(c.createdAt) <= period.end
    ).length;

    const report: MonthlyReport = {
      ...weeklyBase,
      period,
      highlights: this.generateHighlights('monthly', {
        revenue,
        expenses: totalExpenses,
        profit: grossProfit,
        newClients,
      }),
      expenses: {
        total: totalExpenses,
        byCategory: categoryBreakdown,
        vatReclaimable,
      },
      profitLoss: {
        revenue,
        expenses: totalExpenses,
        grossProfit,
        profitMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      },
      clientMetrics: {
        totalClients: clients.length,
        newClients,
        clientRetention: this.calculateRetention(clients),
        topClientsByRevenue: this.getTopClients(5),
      },
    };

    await this.saveReport(report, 'monthly', period);
    this.emit('report-generated', { type: 'monthly', report });
    
    return report;
  }

  // ============================================================
  // Quarterly Report
  // ============================================================

  async generateQuarterlyReport(quarter?: { year: number; quarter: number }): Promise<QuarterlyReport> {
    const q = quarter || this.getCurrentQuarter();
    const period = this.getQuarterPeriod(q.year, q.quarter);
    logger.info(`Generating quarterly report for ${period.name}`);

    // Get monthly report data
    const monthlyBase = await this.generateMonthlyReport(period.start);

    const invoiceManager = getInvoiceManager();
    const expenseTracker = getExpenseTracker();

    // Year to date
    const yearStart = new Date(q.year, 0, 1);
    const ytdPayments = invoiceManager.getPaymentsForPeriod(yearStart, period.end);
    const ytdExpenses = expenseTracker.getExpensesForPeriod(yearStart, period.end);

    // VAT summary
    const vatSummary = expenseTracker.getQuarterlyVATSummary(q.quarter, q.year);

    // Projections (simple linear projection)
    const quarterlyRevenue = monthlyBase.profitLoss.revenue;
    const growthRate = 0.05; // Assume 5% growth - could be calculated from historical data

    const report: QuarterlyReport = {
      ...monthlyBase,
      period,
      quarterNumber: q.quarter,
      highlights: this.generateHighlights('quarterly', {
        revenue: quarterlyRevenue,
        profit: monthlyBase.profitLoss.grossProfit,
        growthRate,
      }),
      yearToDate: {
        revenue: ytdPayments.reduce((sum, p) => sum + p.amount, 0),
        expenses: ytdExpenses.reduce((sum, e) => sum + e.amount, 0),
        profit: ytdPayments.reduce((sum, p) => sum + p.amount, 0) - ytdExpenses.reduce((sum, e) => sum + e.amount, 0),
      },
      projections: {
        nextQuarterRevenue: quarterlyRevenue * (1 + growthRate),
        yearEndRevenue: quarterlyRevenue * (4 - q.quarter + 1) * (1 + growthRate),
        growthRate: growthRate * 100,
      },
      vatSummary: {
        vatCollected: vatSummary.vatCollected,
        vatPaid: vatSummary.vatPaid,
        netVAT: vatSummary.vatCollected - vatSummary.vatPaid,
      },
    };

    await this.saveReport(report, 'quarterly', period);
    this.emit('report-generated', { type: 'quarterly', report });
    
    return report;
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private getWeekPeriod(start?: Date): ReportPeriod {
    const date = start || new Date();
    const dayOfWeek = date.getDay();
    const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    
    const weekStart = new Date(date.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return {
      start: weekStart,
      end: weekEnd,
      name: `Week of ${weekStart.toLocaleDateString('en-GB')}`,
    };
  }

  private getMonthPeriod(month?: Date): ReportPeriod {
    const date = month || new Date();
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

    return {
      start: monthStart,
      end: monthEnd,
      name: monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    };
  }

  private getQuarterPeriod(year: number, quarter: number): ReportPeriod {
    const startMonth = (quarter - 1) * 3;
    const quarterStart = new Date(year, startMonth, 1);
    const quarterEnd = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);

    return {
      start: quarterStart,
      end: quarterEnd,
      name: `Q${quarter} ${year}`,
    };
  }

  private getCurrentQuarter(): { year: number; quarter: number } {
    const now = new Date();
    return {
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3) + 1,
    };
  }

  private aggregateTimeByProject(entries: Array<{ projectId: string; hours: number }>): Array<{ project: string; hours: number }> {
    const projectManager = getProjectManager();
    const byProject = new Map<string, number>();

    for (const entry of entries) {
      byProject.set(entry.projectId, (byProject.get(entry.projectId) || 0) + entry.hours);
    }

    return Array.from(byProject.entries()).map(([projectId, hours]) => {
      const project = projectManager.getProject(projectId);
      return { project: project?.name || 'Unknown', hours };
    }).sort((a, b) => b.hours - a.hours);
  }

  private aggregateExpensesByCategory(expenses: Array<{ category: string; amount: number }>): Record<string, number> {
    const byCategory: Record<string, number> = {};
    for (const expense of expenses) {
      byCategory[expense.category] = (byCategory[expense.category] || 0) + expense.amount;
    }
    return byCategory;
  }

  private calculateRetention(clients: Array<{ status: string }>): number {
    if (clients.length === 0) return 100;
    const active = clients.filter(c => c.status === 'active' || c.status === 'prospect').length;
    return (active / clients.length) * 100;
  }

  private getTopClients(limit: number): Array<{ name: string; revenue: number }> {
    const clientManager = getClientManager();
    const clients = clientManager.searchClients({});
    
    return clients
      .map(c => ({ name: c.name, revenue: c.totalPaid || 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  private generateHighlights(type: string, data: Record<string, number>): string[] {
    const highlights: string[] = [];

    if (type === 'weekly') {
      if (data.hoursWorked > 40) highlights.push(`Strong week - ${data.hoursWorked.toFixed(1)} hours logged`);
      if (data.revenue > 5000) highlights.push(`Great revenue week - £${data.revenue.toLocaleString()} received`);
      if (data.newLeads > 0) highlights.push(`${data.newLeads} new leads in pipeline`);
    } else if (type === 'monthly') {
      if (data.profit > 0) highlights.push(`Profitable month - £${data.profit.toLocaleString()} gross profit`);
      if (data.newClients > 0) highlights.push(`${data.newClients} new client${data.newClients > 1 ? 's' : ''} acquired`);
      const margin = data.revenue > 0 ? (data.profit / data.revenue * 100) : 0;
      if (margin > 50) highlights.push(`Strong margins at ${margin.toFixed(1)}%`);
    } else if (type === 'quarterly') {
      if (data.growthRate > 0) highlights.push(`${(data.growthRate * 100).toFixed(1)}% growth projected`);
    }

    return highlights;
  }

  private async saveReport(report: WeeklyReport | MonthlyReport | QuarterlyReport, type: string, period: ReportPeriod): Promise<void> {
    const filename = `${type}-${period.start.toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.config.reportsDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    logger.info(`Report saved: ${filename}`);
  }

  // ============================================================
  // Voice-Friendly Summary
  // ============================================================

  generateVoiceSummary(report: WeeklyReport | MonthlyReport): string {
    const parts: string[] = [];

    // Time
    parts.push(`You worked ${report.time.hoursWorked.toFixed(1)} hours with ${report.time.billableHours.toFixed(1)} billable.`);

    // Revenue
    if (report.revenue.paymentsReceived > 0) {
      parts.push(`Received £${report.revenue.paymentsReceived.toLocaleString()} in payments.`);
    }
    if (report.revenue.outstanding > 0) {
      parts.push(`£${report.revenue.outstanding.toLocaleString()} still outstanding.`);
    }

    // Pipeline
    if (report.pipeline.newLeads > 0) {
      parts.push(`${report.pipeline.newLeads} active leads worth £${report.pipeline.pipelineValue.toLocaleString()}.`);
    }

    // Monthly extras
    if ('profitLoss' in report) {
      const monthly = report as MonthlyReport;
      parts.push(`Monthly profit: £${monthly.profitLoss.grossProfit.toLocaleString()} (${monthly.profitLoss.profitMargin.toFixed(1)}% margin).`);
    }

    return parts.join(' ');
  }

  shutdown(): void {
    this.initialized = false;
  }
}

// ============================================================
// Singleton exports
// ============================================================

export function getReportGenerator(): ReportGenerator {
  if (!instance) {
    instance = new ReportGenerator();
  }
  return instance;
}

export async function initializeReportGenerator(): Promise<ReportGenerator> {
  const generator = getReportGenerator();
  await generator.initialize();
  return generator;
}
