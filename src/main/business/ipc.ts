/**
 * Atlas Desktop - Business IPC Handlers
 * IPC communication layer for business module
 *
 * @module business/ipc
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getBusinessModule } from './index';
import { getClientManager } from './crm/client-manager';
import { getProjectManager } from './projects/project-manager';
import { getTimeTracker } from './projects/time-tracker';
import { getInvoiceManager } from './finance/invoice-manager';
import { getExpenseTracker } from './finance/expense-tracker';
import { getLeadManager } from './pipeline/lead-manager';
import { getFollowUpEngine } from './automation/follow-up-engine';
import { getReportGenerator } from './automation/report-generator';

const logger = createModuleLogger('BusinessIPC');

// ============================================================
// IPC Result Helper
// ============================================================

interface IPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function success<T>(data: T): IPCResult<T> {
  return { success: true, data };
}

function error(message: string): IPCResult {
  return { success: false, error: message };
}

// ============================================================
// Register Handlers
// ============================================================

export function registerBusinessIPCHandlers(): void {
  logger.info('Registering business IPC handlers...');

  // ============================================================
  // Overview
  // ============================================================

  ipcMain.handle('business:overview', async () => {
    try {
      const overview = await getBusinessModule().getOverview();
      return success(overview);
    } catch (err) {
      logger.error('business:overview failed', { error: err });
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Client Handlers
  // ============================================================

  ipcMain.handle('business:clients:list', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const clients = getClientManager().searchClients(filters as any || {});
      return success(clients);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:clients:get', async (_: IpcMainInvokeEvent, clientId: string) => {
    try {
      const client = getClientManager().getClient(clientId);
      return client ? success(client) : error('Client not found');
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:clients:create', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const client = await getClientManager().createClient(data as any);
      return success(client);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:clients:update', async (_: IpcMainInvokeEvent, clientId: string, data: Record<string, unknown>) => {
    try {
      const client = await getClientManager().updateClient(clientId, data as any);
      return success(client);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:clients:log-interaction', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const interaction = await getClientManager().logInteraction(data as any);
      return success(interaction);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:clients:stats', async () => {
    try {
      return success(getClientManager().getStats());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Project Handlers
  // ============================================================

  ipcMain.handle('business:projects:list', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const projects = getProjectManager().searchProjects(filters as any || {});
      return success(projects);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:projects:get', async (_: IpcMainInvokeEvent, projectId: string) => {
    try {
      const project = getProjectManager().getProject(projectId);
      return project ? success(project) : error('Project not found');
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:projects:create', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const project = await getProjectManager().createProject(data as any);
      return success(project);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:projects:update-status', async (_: IpcMainInvokeEvent, projectId: string, status: string) => {
    try {
      const project = await getProjectManager().updateProjectStatus(projectId, status as any);
      return success(project);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:projects:add-milestone', async (_: IpcMainInvokeEvent, projectId: string, data: Record<string, unknown>) => {
    try {
      const milestone = await getProjectManager().addMilestone(projectId, data as any);
      return success(milestone);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:projects:stats', async () => {
    try {
      return success(getProjectManager().getStats());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Time Tracking Handlers
  // ============================================================

  ipcMain.handle('business:time:start', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const timer = await getTimeTracker().startTimer(data as any);
      return success(timer);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:time:stop', async (_: IpcMainInvokeEvent, description?: string) => {
    try {
      const entry = await getTimeTracker().stopTimer(description);
      return success(entry);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:time:status', async () => {
    try {
      const tracker = getTimeTracker();
      return success({
        running: tracker.isTimerRunning(),
        timer: tracker.getActiveTimer(),
        elapsed: tracker.getElapsedFormatted(),
        stats: tracker.getStats(),
      });
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:time:create-entry', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const entry = await getTimeTracker().createEntry(data as any);
      return success(entry);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:time:entries', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const entries = getTimeTracker().getEntriesForPeriod(
        filters?.start ? new Date(filters.start as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        filters?.end ? new Date(filters.end as string) : new Date()
      );
      return success(entries);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Invoice Handlers
  // ============================================================

  ipcMain.handle('business:invoices:list', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const invoices = getInvoiceManager().searchInvoices(filters as any || {});
      return success(invoices);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:get', async (_: IpcMainInvokeEvent, invoiceId: string) => {
    try {
      const invoice = getInvoiceManager().getInvoice(invoiceId);
      return invoice ? success(invoice) : error('Invoice not found');
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:create', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const invoice = await getInvoiceManager().createInvoice(data as any);
      return success(invoice);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:record-payment', async (_: IpcMainInvokeEvent, invoiceId: string, amount: number, method?: string) => {
    try {
      const invoice = await getInvoiceManager().recordPayment(invoiceId, amount, method);
      return success(invoice);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:mark-sent', async (_: IpcMainInvokeEvent, invoiceId: string) => {
    try {
      const invoice = await getInvoiceManager().markAsSent(invoiceId);
      return success(invoice);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:generate-text', async (_: IpcMainInvokeEvent, invoiceId: string) => {
    try {
      const text = getInvoiceManager().generateInvoiceText(invoiceId);
      return success(text);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:invoices:stats', async () => {
    try {
      return success(getInvoiceManager().getStats());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Expense Handlers
  // ============================================================

  ipcMain.handle('business:expenses:list', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const tracker = getExpenseTracker();
      let expenses;

      if (filters?.category) {
        expenses = tracker.getExpensesByCategory(filters.category as any);
      } else if (filters?.start && filters?.end) {
        expenses = tracker.getExpensesForPeriod(new Date(filters.start as string), new Date(filters.end as string));
      } else {
        expenses = tracker.getAllExpenses();
      }

      return success(expenses);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:expenses:create', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const expense = await getExpenseTracker().createExpense(data as any);
      return success(expense);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:expenses:category-breakdown', async () => {
    try {
      return success(getExpenseTracker().getCategoryBreakdown());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:expenses:vat-summary', async (_: IpcMainInvokeEvent, quarter: number, year: number) => {
    try {
      return success(getExpenseTracker().getQuarterlyVATSummary(quarter, year));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:expenses:stats', async () => {
    try {
      return success(getExpenseTracker().getStats());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Lead/Pipeline Handlers
  // ============================================================

  ipcMain.handle('business:leads:list', async (_: IpcMainInvokeEvent, filters?: Record<string, unknown>) => {
    try {
      const leads = getLeadManager().searchLeads(filters as any || {});
      return success(leads);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:leads:get', async (_: IpcMainInvokeEvent, leadId: string) => {
    try {
      const lead = getLeadManager().getLead(leadId);
      return lead ? success(lead) : error('Lead not found');
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:leads:create', async (_: IpcMainInvokeEvent, data: Record<string, unknown>) => {
    try {
      const lead = await getLeadManager().createLead(data as any);
      return success(lead);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:leads:update-status', async (_: IpcMainInvokeEvent, leadId: string, status: string, notes?: string) => {
    try {
      const lead = await getLeadManager().updateLeadStatus(leadId, status as any);
      if (notes) {
        await getLeadManager().addNote(leadId, notes);
      }
      return success(lead);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:leads:convert-to-client', async (_: IpcMainInvokeEvent, leadId: string) => {
    try {
      const result = await getLeadManager().convertToClient(leadId);
      return success(result);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:leads:pipeline', async () => {
    try {
      return success({
        value: getLeadManager().getPipelineValue(),
        stats: getLeadManager().getStats(),
        dueFollowUps: getLeadManager().getDueFollowUps(),
      });
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Follow-up/Reminder Handlers
  // ============================================================

  ipcMain.handle('business:reminders:list', async () => {
    try {
      return success(getFollowUpEngine().getActiveReminders());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:reminders:acknowledge', async (_: IpcMainInvokeEvent, reminderId: string) => {
    try {
      getFollowUpEngine().acknowledgeReminder(reminderId);
      return success(true);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:reminders:snooze', async (_: IpcMainInvokeEvent, reminderId: string, minutes: number) => {
    try {
      getFollowUpEngine().snoozeReminder(reminderId, minutes);
      return success(true);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:reminders:voice-summary', async () => {
    try {
      return success(getFollowUpEngine().getVoiceSummary());
    } catch (err) {
      return error((err as Error).message);
    }
  });

  // ============================================================
  // Report Handlers
  // ============================================================

  ipcMain.handle('business:reports:weekly', async (_: IpcMainInvokeEvent, weekStart?: string) => {
    try {
      const report = await getReportGenerator().generateWeeklyReport(
        weekStart ? new Date(weekStart) : undefined
      );
      return success(report);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:reports:monthly', async (_: IpcMainInvokeEvent, month?: string) => {
    try {
      const report = await getReportGenerator().generateMonthlyReport(
        month ? new Date(month) : undefined
      );
      return success(report);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  ipcMain.handle('business:reports:quarterly', async (_: IpcMainInvokeEvent, quarter?: { year: number; quarter: number }) => {
    try {
      const report = await getReportGenerator().generateQuarterlyReport(quarter);
      return success(report);
    } catch (err) {
      return error((err as Error).message);
    }
  });

  logger.info('Business IPC handlers registered');
}
