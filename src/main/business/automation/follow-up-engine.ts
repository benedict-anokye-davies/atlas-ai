/**
 * Atlas Desktop - Follow-up Engine
 * Automated follow-up reminders for clients and leads
 *
 * @module business/automation/follow-up-engine
 */

import { EventEmitter } from 'events';
import { getClientManager } from '../crm/client-manager';
import { getLeadManager } from '../pipeline/lead-manager';
import { getProjectManager } from '../projects/project-manager';
import { getInvoiceManager } from '../finance/invoice-manager';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('FollowUpEngine');

// ============================================================
// Types
// ============================================================

export interface FollowUpReminder {
  id: string;
  type: 'client_follow_up' | 'lead_follow_up' | 'project_deadline' | 'invoice_overdue' | 'payment_reminder';
  entityId: string;
  entityName: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: Date;
  createdAt: Date;
  acknowledged: boolean;
  snoozedUntil?: Date;
}

export interface FollowUpEngineConfig {
  checkIntervalMs: number;
  clientFollowUpDays: number;
  leadFollowUpDays: number;
  invoiceReminderDays: number[];
  projectDeadlineWarningDays: number[];
}

export interface FollowUpEngineEvents {
  'reminder': (reminder: FollowUpReminder) => void;
  'reminders-updated': (reminders: FollowUpReminder[]) => void;
}

// ============================================================
// Implementation
// ============================================================

let instance: FollowUpEngine | null = null;

export class FollowUpEngine extends EventEmitter {
  private config: FollowUpEngineConfig;
  private reminders: Map<string, FollowUpReminder> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(config?: Partial<FollowUpEngineConfig>) {
    super();
    this.config = {
      checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
      clientFollowUpDays: 7, // Remind if no contact in 7 days
      leadFollowUpDays: 3, // Remind if lead not contacted in 3 days
      invoiceReminderDays: [7, 3, 1, 0], // Remind at 7, 3, 1, 0 days before due
      projectDeadlineWarningDays: [7, 3, 1], // Warn at 7, 3, 1 days before deadline
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing follow-up engine...');
    this.initialized = true;
    this.startChecking();
    
    // Do initial check
    await this.checkAll();
  }

  startChecking(): void {
    if (this.checkInterval) return;
    
    this.checkInterval = setInterval(async () => {
      await this.checkAll();
    }, this.config.checkIntervalMs);
    
    logger.info('Follow-up checking started');
  }

  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async checkAll(): Promise<void> {
    await Promise.all([
      this.checkClientFollowUps(),
      this.checkLeadFollowUps(),
      this.checkProjectDeadlines(),
      this.checkInvoiceReminders(),
    ]);

    this.emitUpdates();
  }

  private async checkClientFollowUps(): Promise<void> {
    try {
      const clientManager = getClientManager();
      const pendingFollowUps = clientManager.getPendingFollowUps();
      
      for (const followUp of pendingFollowUps) {
        const client = clientManager.getClient(followUp.clientId);
        if (!client) continue;

        const reminderId = `client-followup-${followUp.id}`;
        
        if (!this.reminders.has(reminderId)) {
          const daysOverdue = this.daysBetween(followUp.followUpDate!, new Date());
          const priority = daysOverdue > 3 ? 'high' : daysOverdue > 0 ? 'medium' : 'low';

          this.addReminder({
            id: reminderId,
            type: 'client_follow_up',
            entityId: client.id,
            entityName: client.name,
            message: `Follow up with ${client.name}: ${followUp.summary}`,
            priority,
            dueDate: followUp.followUpDate!,
            createdAt: new Date(),
            acknowledged: false,
          });
        }
      }
    } catch (error) {
      logger.error('Error checking client follow-ups', { error });
    }
  }

  private async checkLeadFollowUps(): Promise<void> {
    try {
      const leadManager = getLeadManager();
      const dueFollowUps = leadManager.getDueFollowUps();
      
      for (const lead of dueFollowUps) {
        const reminderId = `lead-followup-${lead.id}`;
        
        if (!this.reminders.has(reminderId)) {
          const daysSinceContact = lead.lastContactDate 
            ? this.daysBetween(new Date(lead.lastContactDate), new Date())
            : this.daysBetween(new Date(lead.createdAt), new Date());
          
          const priority = daysSinceContact > 7 ? 'high' : daysSinceContact > 3 ? 'medium' : 'low';

          this.addReminder({
            id: reminderId,
            type: 'lead_follow_up',
            entityId: lead.id,
            entityName: lead.name,
            message: `Follow up with lead: ${lead.name} (${lead.company || 'No company'}) - ${lead.projectDescription.substring(0, 50)}...`,
            priority,
            dueDate: new Date(),
            createdAt: new Date(),
            acknowledged: false,
          });
        }
      }
    } catch (error) {
      logger.error('Error checking lead follow-ups', { error });
    }
  }

  private async checkProjectDeadlines(): Promise<void> {
    try {
      const projectManager = getProjectManager();
      
      for (const warningDays of this.config.projectDeadlineWarningDays) {
        const approaching = projectManager.getProjectsWithApproachingDeadlines(warningDays);
        
        for (const project of approaching) {
          if (!project.deadline) continue;
          
          const reminderId = `project-deadline-${project.id}-${warningDays}`;
          
          if (!this.reminders.has(reminderId)) {
            const daysUntil = this.daysBetween(new Date(), new Date(project.deadline));
            const priority = daysUntil <= 1 ? 'urgent' : daysUntil <= 3 ? 'high' : 'medium';

            this.addReminder({
              id: reminderId,
              type: 'project_deadline',
              entityId: project.id,
              entityName: project.name,
              message: `Project "${project.name}" deadline in ${daysUntil} days`,
              priority,
              dueDate: new Date(project.deadline),
              createdAt: new Date(),
              acknowledged: false,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error checking project deadlines', { error });
    }
  }

  private async checkInvoiceReminders(): Promise<void> {
    try {
      const invoiceManager = getInvoiceManager();
      const overdue = invoiceManager.getOverdueInvoices();
      
      for (const invoice of overdue) {
        const reminderId = `invoice-overdue-${invoice.id}`;
        
        if (!this.reminders.has(reminderId)) {
          const daysOverdue = this.daysBetween(new Date(invoice.dueDate), new Date());

          this.addReminder({
            id: reminderId,
            type: 'invoice_overdue',
            entityId: invoice.id,
            entityName: invoice.invoiceNumber,
            message: `Invoice ${invoice.invoiceNumber} is ${daysOverdue} days overdue (£${invoice.total - invoice.amountPaid} outstanding)`,
            priority: daysOverdue > 14 ? 'urgent' : daysOverdue > 7 ? 'high' : 'medium',
            dueDate: new Date(invoice.dueDate),
            createdAt: new Date(),
            acknowledged: false,
          });
        }
      }

      // Check for invoices approaching due date
      for (const reminderDays of this.config.invoiceReminderDays) {
        const invoices = invoiceManager.searchInvoices({ status: ['sent'] });
        
        for (const invoice of invoices) {
          const daysUntilDue = this.daysBetween(new Date(), new Date(invoice.dueDate));
          
          if (daysUntilDue === reminderDays) {
            const reminderId = `invoice-reminder-${invoice.id}-${reminderDays}`;
            
            if (!this.reminders.has(reminderId)) {
              this.addReminder({
                id: reminderId,
                type: 'payment_reminder',
                entityId: invoice.id,
                entityName: invoice.invoiceNumber,
                message: `Invoice ${invoice.invoiceNumber} due in ${daysUntilDue} days (£${invoice.total - invoice.amountPaid})`,
                priority: daysUntilDue <= 1 ? 'high' : 'medium',
                dueDate: new Date(invoice.dueDate),
                createdAt: new Date(),
                acknowledged: false,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error checking invoice reminders', { error });
    }
  }

  private addReminder(reminder: FollowUpReminder): void {
    this.reminders.set(reminder.id, reminder);
    this.emit('reminder', reminder);
    logger.info(`New reminder: ${reminder.message}`, { type: reminder.type, priority: reminder.priority });
  }

  private emitUpdates(): void {
    const activeReminders = this.getActiveReminders();
    this.emit('reminders-updated', activeReminders);
  }

  private daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round((date2.getTime() - date1.getTime()) / oneDay);
  }

  // ============================================================
  // Public API
  // ============================================================

  getActiveReminders(): FollowUpReminder[] {
    const now = new Date();
    return Array.from(this.reminders.values())
      .filter(r => !r.acknowledged && (!r.snoozedUntil || new Date(r.snoozedUntil) <= now))
      .sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  getRemindersByType(type: FollowUpReminder['type']): FollowUpReminder[] {
    return this.getActiveReminders().filter(r => r.type === type);
  }

  acknowledgeReminder(reminderId: string): void {
    const reminder = this.reminders.get(reminderId);
    if (reminder) {
      reminder.acknowledged = true;
      this.emitUpdates();
    }
  }

  snoozeReminder(reminderId: string, minutes: number): void {
    const reminder = this.reminders.get(reminderId);
    if (reminder) {
      reminder.snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
      this.emitUpdates();
    }
  }

  clearReminder(reminderId: string): void {
    this.reminders.delete(reminderId);
    this.emitUpdates();
  }

  getStats(): {
    total: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  } {
    const active = this.getActiveReminders();
    
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    
    for (const reminder of active) {
      byType[reminder.type] = (byType[reminder.type] || 0) + 1;
      byPriority[reminder.priority] = (byPriority[reminder.priority] || 0) + 1;
    }

    return {
      total: active.length,
      byType,
      byPriority,
    };
  }

  // Generate a voice-friendly summary
  getVoiceSummary(): string {
    const active = this.getActiveReminders();
    
    if (active.length === 0) {
      return "No pending follow-ups or reminders.";
    }

    const urgent = active.filter(r => r.priority === 'urgent').length;
    const high = active.filter(r => r.priority === 'high').length;
    
    const parts: string[] = [];
    
    if (urgent > 0) {
      parts.push(`${urgent} urgent`);
    }
    if (high > 0) {
      parts.push(`${high} high priority`);
    }
    
    const priorityText = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    
    let summary = `You have ${active.length} pending reminder${active.length !== 1 ? 's' : ''}${priorityText}. `;
    
    // Add most urgent items
    const topItems = active.slice(0, 3);
    for (const item of topItems) {
      summary += `${item.message}. `;
    }

    return summary;
  }

  shutdown(): void {
    this.stopChecking();
    this.reminders.clear();
    this.initialized = false;
  }
}

// ============================================================
// Singleton exports
// ============================================================

export function getFollowUpEngine(): FollowUpEngine {
  if (!instance) {
    instance = new FollowUpEngine();
  }
  return instance;
}

export async function initializeFollowUpEngine(): Promise<FollowUpEngine> {
  const engine = getFollowUpEngine();
  await engine.initialize();
  return engine;
}
