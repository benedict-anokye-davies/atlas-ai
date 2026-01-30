/**
 * @fileoverview Business Voice Integration - Wire business operations into voice pipeline
 * @module business/voice-integration
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * This module bridges the business management system with Atlas's voice pipeline,
 * enabling natural voice control of:
 * - Client management (add clients, log interactions, get info)
 * - Project tracking (create projects, update status, time tracking)
 * - Invoicing (create invoices, record payments, check status)
 * - Business analytics (revenue, pipeline, performance)
 *
 * It also provides the BusinessContextSummary for personality context injection,
 * so Atlas is aware of business state during all conversations.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getClientManager } from './crm/client-manager';
import { getProjectManager } from './projects/project-manager';
import { getTimeTracker } from './projects/time-tracker';
import { getInvoiceManager } from './finance/invoice-manager';
import { getExpenseTracker } from './finance/expense-tracker';
import { getLeadManager } from './pipeline/lead-manager';
import { getFollowUpEngine } from './automation/follow-up-engine';
import { getPersonalityContextBuilder } from '../personality/personality-context-builder';
import { getVoicePipeline } from '../voice/voice-pipeline';

const logger = createModuleLogger('BusinessVoiceIntegration');

// ============================================================================
// Types
// ============================================================================

/**
 * Business context summary for voice pipeline injection.
 * This gives Atlas awareness of current business state during conversations.
 */
export interface BusinessContextSummary {
  /** Number of unpaid invoices */
  unpaidInvoices: number;
  /** Total unpaid amount in GBP */
  unpaidAmount: number;
  /** Number of overdue projects */
  overdueProjects: number;
  /** Clients needing follow-up */
  clientsNeedingFollowUp: number;
  /** Revenue this month in GBP */
  thisMonthRevenue: number;
  /** Expenses this month in GBP */
  thisMonthExpenses: number;
  /** Active projects count */
  activeProjects: number;
  /** Active timer info (if tracking time) */
  activeTimer?: {
    projectName: string;
    duration: number;
    startedAt: Date;
  };
  /** Pipeline value */
  pipelineValue: number;
  /** Active leads count */
  activeLeads: number;
  /** Business health indicator */
  healthStatus: 'excellent' | 'good' | 'caution' | 'critical';
  /** Pending follow-ups for today */
  todayFollowUps: number;
  /** Summary message for quick context */
  quickSummary: string;
}

/**
 * Voice command result for business operations
 */
export interface BusinessVoiceCommandResult {
  success: boolean;
  action: string;
  message: string;
  data?: unknown;
  followUp?: string;
}

/**
 * Events emitted by the business voice integration
 */
export interface BusinessVoiceEvents {
  'context-updated': (context: BusinessContextSummary) => void;
  'action-completed': (result: BusinessVoiceCommandResult) => void;
  'reminder-triggered': (reminder: { type: string; message: string }) => void;
  'health-alert': (alert: { type: string; severity: string; message: string }) => void;
}

// ============================================================================
// BusinessVoiceIntegration Class
// ============================================================================

/**
 * Integrates business module with Atlas voice pipeline.
 *
 * @example
 * ```typescript
 * const integration = getBusinessVoiceIntegration();
 * await integration.initialize();
 *
 * // Get current business context
 * const context = await integration.getBusinessContext();
 *
 * // Process voice command
 * const result = await integration.processVoiceCommand('How much do I have outstanding?');
 * ```
 */
export class BusinessVoiceIntegration extends EventEmitter {
  private initialized = false;
  private contextUpdateInterval: NodeJS.Timeout | null = null;
  private lastContext: BusinessContextSummary | null = null;

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the business voice integration.
   * Connects to personality context builder and sets up periodic updates.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('BusinessVoiceIntegration already initialized');
      return;
    }

    logger.info('Initializing BusinessVoiceIntegration...');

    try {
      // Wire business context provider to PersonalityContextBuilder
      const contextBuilder = getPersonalityContextBuilder();
      contextBuilder.setBusinessContextProvider(() => this.getBusinessContext());

      // Start periodic context updates (every 2 minutes)
      this.startContextUpdates();

      // Check for alerts/reminders
      await this.checkBusinessAlerts();

      this.initialized = true;
      logger.info('BusinessVoiceIntegration initialized');
    } catch (error) {
      logger.error('Failed to initialize BusinessVoiceIntegration', { error });
      throw error;
    }
  }

  /**
   * Start periodic business context updates
   */
  private startContextUpdates(): void {
    // Update context every 2 minutes
    this.contextUpdateInterval = setInterval(async () => {
      try {
        const context = await this.getBusinessContext();
        this.lastContext = context;
        this.emit('context-updated', context);

        // Check for health alerts
        if (context.healthStatus === 'critical') {
          this.emit('health-alert', {
            type: 'business_health',
            severity: 'high',
            message: context.quickSummary,
          });
        }
      } catch (error) {
        logger.warn('Failed to update business context', { error });
      }
    }, 2 * 60 * 1000);
  }

  // ============================================================================
  // Context Provider
  // ============================================================================

  /**
   * Get comprehensive business context for voice pipeline.
   * This is injected into conversations so Atlas knows business state.
   */
  async getBusinessContext(): Promise<BusinessContextSummary> {
    try {
      const clientManager = getClientManager();
      const projectManager = getProjectManager();
      const timeTracker = getTimeTracker();
      const invoiceManager = getInvoiceManager();
      const expenseTracker = getExpenseTracker();
      const leadManager = getLeadManager();
      const followUpEngine = getFollowUpEngine();

      // Get invoice stats
      const invoiceStats = invoiceManager.getInvoiceStats();
      const unpaidInvoices = invoiceManager.getUnpaidInvoices();
      const overdueInvoices = invoiceManager.getOverdueInvoices();

      // Get project stats
      const activeProjects = projectManager.getProjectsByStatus('in_progress');
      const overdueProjects = projectManager.getOverdueProjects();

      // Get expense stats
      const expenseStats = expenseTracker.getExpenseStats();

      // Get pipeline stats
      const pipelineStats = leadManager.getPipelineStats();

      // Get follow-up info
      const todayFollowUps = followUpEngine.getTodayFollowUps().length;
      const clientsNeedingFollowUp = clientManager.getClientsNeedingFollowUp().length;

      // Get active timer
      const activeTimer = timeTracker.getActiveSession();

      // Calculate health status
      const healthStatus = this.calculateHealthStatus({
        overdueInvoicesCount: overdueInvoices.length,
        overdueProjectsCount: overdueProjects.length,
        unpaidAmount: invoiceStats.totalUnpaid,
        clientsNeedingFollowUp,
      });

      // Generate quick summary
      const quickSummary = this.generateQuickSummary({
        unpaidInvoices: unpaidInvoices.length,
        unpaidAmount: invoiceStats.totalUnpaid,
        overdueProjects: overdueProjects.length,
        activeProjects: activeProjects.length,
        todayFollowUps,
        healthStatus,
        activeTimer: activeTimer ? {
          projectName: activeTimer.projectName || 'Unknown',
          duration: activeTimer.duration,
          startedAt: new Date(activeTimer.startTime),
        } : undefined,
      });

      return {
        unpaidInvoices: unpaidInvoices.length,
        unpaidAmount: invoiceStats.totalUnpaid,
        overdueProjects: overdueProjects.length,
        clientsNeedingFollowUp,
        thisMonthRevenue: invoiceStats.thisMonthRevenue,
        thisMonthExpenses: expenseStats.thisMonthTotal,
        activeProjects: activeProjects.length,
        activeTimer: activeTimer ? {
          projectName: activeTimer.projectName || 'Unknown',
          duration: activeTimer.duration,
          startedAt: new Date(activeTimer.startTime),
        } : undefined,
        pipelineValue: pipelineStats.pipelineValue,
        activeLeads: pipelineStats.active,
        healthStatus,
        todayFollowUps,
        quickSummary,
      };
    } catch (error) {
      logger.error('Failed to get business context', { error });
      // Return minimal context on error
      return {
        unpaidInvoices: 0,
        unpaidAmount: 0,
        overdueProjects: 0,
        clientsNeedingFollowUp: 0,
        thisMonthRevenue: 0,
        thisMonthExpenses: 0,
        activeProjects: 0,
        pipelineValue: 0,
        activeLeads: 0,
        healthStatus: 'good',
        todayFollowUps: 0,
        quickSummary: 'Business data unavailable',
      };
    }
  }

  /**
   * Calculate business health status based on key metrics
   */
  private calculateHealthStatus(metrics: {
    overdueInvoicesCount: number;
    overdueProjectsCount: number;
    unpaidAmount: number;
    clientsNeedingFollowUp: number;
  }): 'excellent' | 'good' | 'caution' | 'critical' {
    let score = 100;

    // Deduct for overdue invoices (serious)
    score -= metrics.overdueInvoicesCount * 15;
    
    // Deduct for overdue projects (serious)
    score -= metrics.overdueProjectsCount * 20;
    
    // Deduct for high unpaid amount (over £5000)
    if (metrics.unpaidAmount > 10000) score -= 20;
    else if (metrics.unpaidAmount > 5000) score -= 10;
    
    // Deduct for clients needing follow-up
    score -= Math.min(metrics.clientsNeedingFollowUp * 5, 15);

    if (score >= 85) return 'excellent';
    if (score >= 65) return 'good';
    if (score >= 40) return 'caution';
    return 'critical';
  }

  /**
   * Generate a quick natural language summary of business state
   */
  private generateQuickSummary(data: {
    unpaidInvoices: number;
    unpaidAmount: number;
    overdueProjects: number;
    activeProjects: number;
    todayFollowUps: number;
    healthStatus: string;
    activeTimer?: { projectName: string; duration: number };
  }): string {
    const parts: string[] = [];

    // Active work
    if (data.activeTimer) {
      const mins = Math.floor(data.activeTimer.duration / 60000);
      parts.push(`Timer running on "${data.activeTimer.projectName}" (${mins}m)`);
    }

    // Projects
    if (data.activeProjects > 0) {
      parts.push(`${data.activeProjects} active project${data.activeProjects > 1 ? 's' : ''}`);
    }

    // Money owed
    if (data.unpaidInvoices > 0) {
      parts.push(`£${data.unpaidAmount.toFixed(0)} outstanding (${data.unpaidInvoices} invoice${data.unpaidInvoices > 1 ? 's' : ''})`);
    }

    // Overdue items (urgent)
    if (data.overdueProjects > 0) {
      parts.push(`⚠️ ${data.overdueProjects} overdue project${data.overdueProjects > 1 ? 's' : ''}`);
    }

    // Follow-ups
    if (data.todayFollowUps > 0) {
      parts.push(`${data.todayFollowUps} follow-up${data.todayFollowUps > 1 ? 's' : ''} due today`);
    }

    if (parts.length === 0) {
      return 'Business dashboard clear';
    }

    return parts.join('. ') + '.';
  }

  // ============================================================================
  // Voice Command Processing
  // ============================================================================

  /**
   * Process natural language business commands.
   * This is called when Atlas detects business-related intent.
   */
  async processVoiceCommand(command: string): Promise<BusinessVoiceCommandResult> {
    const lowerCommand = command.toLowerCase();

    // Quick status queries
    if (this.matchesPatterns(lowerCommand, ['how much', 'outstanding', 'owed', 'unpaid'])) {
      return this.handleUnpaidQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['business', 'overview', 'summary', "how's business", 'how is business'])) {
      return this.handleBusinessOverview();
    }

    if (this.matchesPatterns(lowerCommand, ['follow up', 'follow-up', 'need to call', 'need to contact'])) {
      return this.handleFollowUpQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['overdue', 'late', 'deadline'])) {
      return this.handleOverdueQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['timer', 'tracking', 'how long', 'time on'])) {
      return this.handleTimerQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['revenue', 'income', 'earned', 'made'])) {
      return this.handleRevenueQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['expenses', 'spent', 'costs'])) {
      return this.handleExpenseQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['pipeline', 'leads', 'prospects'])) {
      return this.handlePipelineQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['clients', 'customers'])) {
      return this.handleClientsQuery();
    }

    if (this.matchesPatterns(lowerCommand, ['projects', 'work', 'active'])) {
      return this.handleProjectsQuery();
    }

    // Default - general help
    return {
      success: true,
      action: 'help',
      message: 'I can help with: outstanding invoices, business overview, follow-ups, overdue items, time tracking, revenue, expenses, pipeline, clients, and projects. What would you like to know?',
    };
  }

  // ============================================================================
  // Query Handlers
  // ============================================================================

  private async handleUnpaidQuery(): Promise<BusinessVoiceCommandResult> {
    const context = await this.getBusinessContext();
    
    if (context.unpaidInvoices === 0) {
      return {
        success: true,
        action: 'check_unpaid',
        message: "Great news! You've got no outstanding invoices. All caught up!",
        data: { unpaidInvoices: 0, unpaidAmount: 0 },
      };
    }

    const invoiceManager = getInvoiceManager();
    const unpaid = invoiceManager.getUnpaidInvoices();
    const overdue = unpaid.filter((inv: { dueDate: Date }) => new Date(inv.dueDate) < new Date());

    let message = `You have £${context.unpaidAmount.toFixed(0)} outstanding across ${context.unpaidInvoices} invoice${context.unpaidInvoices > 1 ? 's' : ''}.`;
    
    if (overdue.length > 0) {
      const overdueAmount = overdue.reduce((sum: number, inv: { total: number }) => sum + inv.total, 0);
      message += ` Warning: £${overdueAmount.toFixed(0)} is overdue across ${overdue.length} invoice${overdue.length > 1 ? 's' : ''}. Want me to send reminders?`;
    }

    return {
      success: true,
      action: 'check_unpaid',
      message,
      data: { unpaidInvoices: unpaid, total: context.unpaidAmount },
      followUp: overdue.length > 0 ? 'send_reminders' : undefined,
    };
  }

  private async handleBusinessOverview(): Promise<BusinessVoiceCommandResult> {
    const context = await this.getBusinessContext();
    
    const netThisMonth = context.thisMonthRevenue - context.thisMonthExpenses;
    const profitStatus = netThisMonth >= 0 ? 'profit' : 'loss';
    
    let message = `Business overview: `;
    message += `This month you've made £${context.thisMonthRevenue.toFixed(0)} revenue with £${context.thisMonthExpenses.toFixed(0)} expenses - that's a ${Math.abs(netThisMonth).toFixed(0)} ${profitStatus}. `;
    message += `You have ${context.activeProjects} active project${context.activeProjects !== 1 ? 's' : ''} and ${context.activeLeads} lead${context.activeLeads !== 1 ? 's' : ''} in the pipeline worth £${context.pipelineValue.toFixed(0)}. `;
    
    if (context.unpaidAmount > 0) {
      message += `£${context.unpaidAmount.toFixed(0)} is outstanding. `;
    }
    
    if (context.todayFollowUps > 0) {
      message += `You have ${context.todayFollowUps} follow-up${context.todayFollowUps !== 1 ? 's' : ''} scheduled for today. `;
    }

    message += `Overall health: ${context.healthStatus}.`;

    return {
      success: true,
      action: 'business_overview',
      message,
      data: context,
    };
  }

  private async handleFollowUpQuery(): Promise<BusinessVoiceCommandResult> {
    const followUpEngine = getFollowUpEngine();
    const todayFollowUps = followUpEngine.getTodayFollowUps();
    const clientManager = getClientManager();
    const needsFollowUp = clientManager.getClientsNeedingFollowUp();

    if (todayFollowUps.length === 0 && needsFollowUp.length === 0) {
      return {
        success: true,
        action: 'check_followups',
        message: "You're all caught up on follow-ups! No one needs contacting right now.",
        data: { todayFollowUps: [], needsFollowUp: [] },
      };
    }

    let message = '';
    
    if (todayFollowUps.length > 0) {
      message += `You have ${todayFollowUps.length} follow-up${todayFollowUps.length > 1 ? 's' : ''} scheduled for today. `;
      const names = todayFollowUps.slice(0, 3).map((f: { clientName: string }) => f.clientName).join(', ');
      message += `Including: ${names}. `;
    }

    if (needsFollowUp.length > 0) {
      message += `${needsFollowUp.length} client${needsFollowUp.length > 1 ? 's' : ''} haven't been contacted recently. `;
    }

    message += 'Would you like me to help you draft any messages?';

    return {
      success: true,
      action: 'check_followups',
      message,
      data: { todayFollowUps, needsFollowUp },
      followUp: 'draft_message',
    };
  }

  private async handleOverdueQuery(): Promise<BusinessVoiceCommandResult> {
    const projectManager = getProjectManager();
    const invoiceManager = getInvoiceManager();
    
    const overdueProjects = projectManager.getOverdueProjects();
    const overdueInvoices = invoiceManager.getOverdueInvoices();

    if (overdueProjects.length === 0 && overdueInvoices.length === 0) {
      return {
        success: true,
        action: 'check_overdue',
        message: "Nothing overdue! All projects and invoices are on track.",
        data: { overdueProjects: [], overdueInvoices: [] },
      };
    }

    let message = '';
    
    if (overdueProjects.length > 0) {
      message += `⚠️ ${overdueProjects.length} project${overdueProjects.length > 1 ? 's are' : ' is'} overdue. `;
      const projectNames = overdueProjects.slice(0, 2).map((p: { name: string }) => p.name).join(' and ');
      message += `Including: ${projectNames}. `;
    }

    if (overdueInvoices.length > 0) {
      const overdueAmount = overdueInvoices.reduce((sum: number, inv: { total: number }) => sum + inv.total, 0);
      message += `💰 ${overdueInvoices.length} invoice${overdueInvoices.length > 1 ? 's are' : ' is'} overdue totalling £${overdueAmount.toFixed(0)}. `;
    }

    message += 'What would you like to tackle first?';

    return {
      success: true,
      action: 'check_overdue',
      message,
      data: { overdueProjects, overdueInvoices },
      followUp: 'prioritize',
    };
  }

  private async handleTimerQuery(): Promise<BusinessVoiceCommandResult> {
    const timeTracker = getTimeTracker();
    const activeSession = timeTracker.getActiveSession();

    if (!activeSession) {
      return {
        success: true,
        action: 'check_timer',
        message: "No timer running right now. Would you like me to start one?",
        data: { active: false },
        followUp: 'start_timer',
      };
    }

    const minutes = Math.floor(activeSession.duration / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;

    let timeStr = '';
    if (hours > 0) {
      timeStr = `${hours} hour${hours > 1 ? 's' : ''} and ${remainingMins} minute${remainingMins !== 1 ? 's' : ''}`;
    } else {
      timeStr = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }

    return {
      success: true,
      action: 'check_timer',
      message: `Timer running on "${activeSession.projectName}" for ${timeStr}. Say "stop timer" when you're done.`,
      data: { active: true, session: activeSession },
      followUp: 'stop_timer',
    };
  }

  private async handleRevenueQuery(): Promise<BusinessVoiceCommandResult> {
    const invoiceManager = getInvoiceManager();
    const stats = invoiceManager.getInvoiceStats();

    return {
      success: true,
      action: 'check_revenue',
      message: `This month you've invoiced £${stats.thisMonthRevenue.toFixed(0)}. You have £${stats.totalPaid.toFixed(0)} paid and £${stats.totalUnpaid.toFixed(0)} still outstanding.`,
      data: stats,
    };
  }

  private async handleExpenseQuery(): Promise<BusinessVoiceCommandResult> {
    const expenseTracker = getExpenseTracker();
    const stats = expenseTracker.getExpenseStats();

    return {
      success: true,
      action: 'check_expenses',
      message: `This month you've spent £${stats.thisMonthTotal.toFixed(0)}. VAT reclaimable: £${stats.thisMonthVAT.toFixed(0)}. Biggest categories: ${stats.topCategories?.slice(0, 2).map((c: { name: string }) => c.name).join(', ') || 'various'}.`,
      data: stats,
    };
  }

  private async handlePipelineQuery(): Promise<BusinessVoiceCommandResult> {
    const leadManager = getLeadManager();
    const stats = leadManager.getPipelineStats();

    return {
      success: true,
      action: 'check_pipeline',
      message: `Pipeline: ${stats.active} active lead${stats.active !== 1 ? 's' : ''} worth £${stats.pipelineValue.toFixed(0)}. Weighted value: £${stats.weightedValue.toFixed(0)}. Conversion rate: ${(stats.conversionRate * 100).toFixed(0)}%.`,
      data: stats,
    };
  }

  private async handleClientsQuery(): Promise<BusinessVoiceCommandResult> {
    const clientManager = getClientManager();
    const activeClients = clientManager.getActiveClients();
    const totalClients = clientManager.getAllClients();

    return {
      success: true,
      action: 'check_clients',
      message: `You have ${activeClients.length} active client${activeClients.length !== 1 ? 's' : ''} out of ${totalClients.length} total. Your top clients by revenue this year: ${activeClients.slice(0, 3).map((c: { name: string }) => c.name).join(', ')}.`,
      data: { active: activeClients.length, total: totalClients.length },
    };
  }

  private async handleProjectsQuery(): Promise<BusinessVoiceCommandResult> {
    const projectManager = getProjectManager();
    const activeProjects = projectManager.getProjectsByStatus('in_progress');
    const completedThisMonth = projectManager.getCompletedThisMonth();

    let message = `You have ${activeProjects.length} active project${activeProjects.length !== 1 ? 's' : ''}`;
    
    if (activeProjects.length > 0) {
      const projectNames = activeProjects.slice(0, 3).map((p: { name: string }) => p.name).join(', ');
      message += `: ${projectNames}`;
    }
    
    if (completedThisMonth.length > 0) {
      message += `. Completed ${completedThisMonth.length} this month`;
    }
    
    message += '.';

    return {
      success: true,
      action: 'check_projects',
      message,
      data: { active: activeProjects, completedThisMonth },
    };
  }

  // ============================================================================
  // Alert System
  // ============================================================================

  /**
   * Check for business alerts that should trigger proactive notifications
   */
  private async checkBusinessAlerts(): Promise<void> {
    const context = await this.getBusinessContext();

    // Check for critical items
    if (context.overdueProjects > 0) {
      this.emit('reminder-triggered', {
        type: 'overdue_project',
        message: `You have ${context.overdueProjects} overdue project${context.overdueProjects > 1 ? 's' : ''}. Want to review priorities?`,
      });
    }

    if (context.unpaidAmount > 5000) {
      const overdueInvoices = getInvoiceManager().getOverdueInvoices();
      if (overdueInvoices.length > 0) {
        this.emit('reminder-triggered', {
          type: 'overdue_invoices',
          message: `You have overdue invoices totaling £${overdueInvoices.reduce((sum: number, inv: { total: number }) => sum + inv.total, 0).toFixed(0)}. Should I help send reminders?`,
        });
      }
    }

    if (context.todayFollowUps > 3) {
      this.emit('reminder-triggered', {
        type: 'followups_due',
        message: `You have ${context.todayFollowUps} follow-ups scheduled for today. Want me to prioritize them?`,
      });
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if a command matches any of the given patterns
   */
  private matchesPatterns(command: string, patterns: string[]): boolean {
    return patterns.some(pattern => command.includes(pattern));
  }

  /**
   * Get the last cached context (for quick access)
   */
  getLastContext(): BusinessContextSummary | null {
    return this.lastContext;
  }

  /**
   * Shutdown the integration
   */
  shutdown(): void {
    if (this.contextUpdateInterval) {
      clearInterval(this.contextUpdateInterval);
      this.contextUpdateInterval = null;
    }
    this.initialized = false;
    logger.info('BusinessVoiceIntegration shutdown');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BusinessVoiceIntegration | null = null;

/**
 * Get the BusinessVoiceIntegration singleton
 */
export function getBusinessVoiceIntegration(): BusinessVoiceIntegration {
  if (!instance) {
    instance = new BusinessVoiceIntegration();
  }
  return instance;
}

/**
 * Initialize the business voice integration
 */
export async function initializeBusinessVoiceIntegration(): Promise<void> {
  const integration = getBusinessVoiceIntegration();
  await integration.initialize();
}

/**
 * Shutdown the business voice integration
 */
export function shutdownBusinessVoiceIntegration(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

export default BusinessVoiceIntegration;
