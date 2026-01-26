/**
 * Atlas Desktop - Business Module
 * Main entry point for business management functionality
 *
 * @module business
 */

// Types
export * from './types';

// CRM
export { ClientManager, getClientManager, initializeClientManager } from './crm/client-manager';

// Projects
export { ProjectManager, getProjectManager, initializeProjectManager } from './projects/project-manager';
export { TimeTracker, getTimeTracker, initializeTimeTracker } from './projects/time-tracker';

// Finance
export { InvoiceManager, getInvoiceManager, initializeInvoiceManager } from './finance/invoice-manager';
export { ExpenseTracker, getExpenseTracker, initializeExpenseTracker } from './finance/expense-tracker';

// Pipeline
export { LeadManager, getLeadManager, initializeLeadManager } from './pipeline/lead-manager';

// Automation
export { FollowUpEngine, getFollowUpEngine, initializeFollowUpEngine } from './automation/follow-up-engine';
export { ReportGenerator, getReportGenerator, initializeReportGenerator } from './automation/report-generator';

import { createModuleLogger } from '../utils/logger';
import { initializeClientManager, getClientManager } from './crm/client-manager';
import { initializeProjectManager, getProjectManager } from './projects/project-manager';
import { initializeTimeTracker, getTimeTracker } from './projects/time-tracker';
import { initializeInvoiceManager, getInvoiceManager } from './finance/invoice-manager';
import { initializeExpenseTracker, getExpenseTracker } from './finance/expense-tracker';
import { initializeLeadManager, getLeadManager } from './pipeline/lead-manager';
import { initializeFollowUpEngine, getFollowUpEngine } from './automation/follow-up-engine';
import { initializeReportGenerator, getReportGenerator } from './automation/report-generator';

const logger = createModuleLogger('BusinessModule');

// ============================================================
// Business Module Class
// ============================================================

export class BusinessModule {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Business module already initialized');
      return;
    }

    logger.info('Initializing business module...');

    try {
      // Initialize in dependency order
      await initializeClientManager();
      await initializeProjectManager();
      await initializeTimeTracker();
      await initializeInvoiceManager();
      await initializeExpenseTracker();
      await initializeLeadManager();
      await initializeFollowUpEngine();
      await initializeReportGenerator();

      this.initialized = true;
      logger.info('Business module initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize business module', { error });
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================
  // Quick access getters
  // ============================================================

  get clients() {
    return getClientManager();
  }

  get projects() {
    return getProjectManager();
  }

  get time() {
    return getTimeTracker();
  }

  get invoices() {
    return getInvoiceManager();
  }

  get expenses() {
    return getExpenseTracker();
  }

  get leads() {
    return getLeadManager();
  }

  get followUps() {
    return getFollowUpEngine();
  }

  get reports() {
    return getReportGenerator();
  }

  // ============================================================
  // Business overview for voice
  // ============================================================

  async getOverview(): Promise<{
    summary: string;
    clients: { total: number; active: number };
    projects: { total: number; active: number };
    time: { todayHours: number; weekHours: number; timerRunning: boolean };
    finances: { outstanding: number; overdue: number; thisMonthRevenue: number };
    pipeline: { activeLeads: number; pipelineValue: number };
    reminders: { total: number; urgent: number };
  }> {
    const clientStats = this.clients.getStats();
    const projectStats = this.projects.getStats();
    const timeStats = this.time.getStats();
    const invoiceStats = this.invoices.getStats();
    const pipelineStats = this.leads.getStats();
    const reminderStats = this.followUps.getStats();

    const overview = {
      summary: '',
      clients: {
        total: clientStats.total,
        active: clientStats.byStatus.active || 0,
      },
      projects: {
        total: projectStats.total,
        active: projectStats.activeProjects,
      },
      time: {
        todayHours: timeStats.todayHours,
        weekHours: timeStats.weekHours,
        timerRunning: timeStats.timerRunning,
      },
      finances: {
        outstanding: invoiceStats.totalOutstanding,
        overdue: invoiceStats.totalOverdue,
        thisMonthRevenue: invoiceStats.thisMonthRevenue,
      },
      pipeline: {
        activeLeads: pipelineStats.active,
        pipelineValue: pipelineStats.pipelineValue,
      },
      reminders: {
        total: reminderStats.total,
        urgent: reminderStats.byPriority.urgent || 0,
      },
    };

    // Generate voice-friendly summary
    const parts: string[] = [];

    if (overview.time.timerRunning) {
      parts.push(`Timer is running.`);
    }
    parts.push(`${overview.time.todayHours.toFixed(1)} hours today, ${overview.time.weekHours.toFixed(1)} this week.`);

    if (overview.finances.outstanding > 0) {
      parts.push(`£${overview.finances.outstanding.toLocaleString()} outstanding.`);
    }
    if (overview.finances.overdue > 0) {
      parts.push(`£${overview.finances.overdue.toLocaleString()} overdue.`);
    }

    if (overview.pipeline.activeLeads > 0) {
      parts.push(`${overview.pipeline.activeLeads} active leads worth £${overview.pipeline.pipelineValue.toLocaleString()}.`);
    }

    if (overview.reminders.urgent > 0) {
      parts.push(`${overview.reminders.urgent} urgent reminders need attention.`);
    }

    overview.summary = parts.join(' ');

    return overview;
  }

  // ============================================================
  // Shutdown
  // ============================================================

  async shutdown(): Promise<void> {
    logger.info('Shutting down business module...');

    this.followUps.shutdown();
    this.reports.shutdown();

    this.initialized = false;
    logger.info('Business module shut down');
  }
}

// ============================================================
// Singleton
// ============================================================

let businessModule: BusinessModule | null = null;

export function getBusinessModule(): BusinessModule {
  if (!businessModule) {
    businessModule = new BusinessModule();
  }
  return businessModule;
}

export async function initializeBusinessModule(): Promise<BusinessModule> {
  const module = getBusinessModule();
  await module.initialize();
  return module;
}
