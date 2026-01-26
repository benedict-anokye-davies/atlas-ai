/**
 * Atlas Desktop - Business Tools
 * LLM-callable tools for business operations
 *
 * @module agent/tools/business
 */

import { ToolDefinition } from '../../../shared/types/tools';
import { getClientManager } from '../../business/crm/client-manager';
import { getProjectManager } from '../../business/projects/project-manager';
import { getTimeTracker } from '../../business/projects/time-tracker';
import { getInvoiceManager } from '../../business/finance/invoice-manager';
import { getExpenseTracker } from '../../business/finance/expense-tracker';
import { getLeadManager } from '../../business/pipeline/lead-manager';

// ============================================================
// Client Management Tools
// ============================================================

export const createClientTool: ToolDefinition = {
  name: 'create_client',
  description: 'Create a new client in the CRM. Use when Ben wants to add a new client.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Client name' },
      company: { type: 'string', description: 'Company name (optional)' },
      email: { type: 'string', description: 'Email address' },
      phone: { type: 'string', description: 'Phone number (optional)' },
      source: { type: 'string', enum: ['referral', 'website', 'linkedin', 'cold_outreach', 'upwork', 'toptal', 'other'], description: 'How the client found us' },
      hourlyRate: { type: 'number', description: 'Default hourly rate for this client' },
      notes: { type: 'string', description: 'Notes about the client' },
    },
    required: ['name', 'email'],
  },
  handler: async (params: { name: string; company?: string; email: string; phone?: string; source?: string; hourlyRate?: number; notes?: string }) => {
    const manager = getClientManager();
    const client = await manager.createClient({
      name: params.name,
      company: params.company,
      email: params.email,
      phone: params.phone,
      source: (params.source as any) || 'other',
      defaultHourlyRate: params.hourlyRate,
      notes: params.notes,
    });
    return { success: true, client };
  },
};

export const getClientsTool: ToolDefinition = {
  name: 'get_clients',
  description: 'Get list of clients. Can filter by status.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'lead', 'prospect', 'past', 'lost'], description: 'Filter by status' },
      search: { type: 'string', description: 'Search by name or company' },
    },
  },
  handler: async (params: { status?: string; search?: string }) => {
    const manager = getClientManager();
    const clients = manager.searchClients({
      status: params.status ? [params.status as any] : undefined,
      searchText: params.search,
    });
    return { success: true, clients, count: clients.length };
  },
};

export const logClientInteractionTool: ToolDefinition = {
  name: 'log_client_interaction',
  description: 'Log an interaction with a client (call, email, meeting).',
  parameters: {
    type: 'object',
    properties: {
      clientName: { type: 'string', description: 'Client name to log interaction for' },
      type: { type: 'string', enum: ['call', 'email', 'meeting', 'message', 'note'], description: 'Type of interaction' },
      summary: { type: 'string', description: 'Summary of the interaction' },
      followUpDays: { type: 'number', description: 'Schedule follow-up in X days' },
    },
    required: ['clientName', 'type', 'summary'],
  },
  handler: async (params: { clientName: string; type: string; summary: string; followUpDays?: number }) => {
    const manager = getClientManager();
    const client = manager.getClientByName(params.clientName);
    if (!client) {
      return { success: false, error: `Client "${params.clientName}" not found` };
    }

    const followUpDate = params.followUpDays 
      ? new Date(Date.now() + params.followUpDays * 24 * 60 * 60 * 1000)
      : undefined;

    const interaction = await manager.logInteraction({
      clientId: client.id,
      type: params.type as any,
      summary: params.summary,
      followUpDate,
    });

    return { success: true, interaction };
  },
};

// ============================================================
// Project Management Tools
// ============================================================

export const createProjectTool: ToolDefinition = {
  name: 'create_project',
  description: 'Create a new project for a client.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Project name' },
      clientName: { type: 'string', description: 'Client name' },
      description: { type: 'string', description: 'Project description' },
      type: { type: 'string', enum: ['development', 'consulting', 'maintenance', 'design', 'other'], description: 'Project type' },
      pricing: { type: 'string', enum: ['fixed', 'hourly', 'retainer'], description: 'Pricing model' },
      budget: { type: 'number', description: 'Project budget in GBP' },
      hourlyRate: { type: 'number', description: 'Hourly rate if applicable' },
      deadlineDays: { type: 'number', description: 'Days until deadline' },
    },
    required: ['name', 'clientName', 'type', 'pricing'],
  },
  handler: async (params: { name: string; clientName: string; description?: string; type: string; pricing: string; budget?: number; hourlyRate?: number; deadlineDays?: number }) => {
    const clientManager = getClientManager();
    const client = clientManager.getClientByName(params.clientName);
    if (!client) {
      return { success: false, error: `Client "${params.clientName}" not found` };
    }

    const projectManager = getProjectManager();
    const deadline = params.deadlineDays 
      ? new Date(Date.now() + params.deadlineDays * 24 * 60 * 60 * 1000)
      : undefined;

    const project = await projectManager.createProject({
      name: params.name,
      clientId: client.id,
      description: params.description,
      type: params.type as any,
      pricing: params.pricing as any,
      budget: params.budget,
      hourlyRate: params.hourlyRate || client.defaultHourlyRate,
      deadline,
    });

    return { success: true, project };
  },
};

export const getProjectsTool: ToolDefinition = {
  name: 'get_projects',
  description: 'Get list of projects. Can filter by status or client.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['planning', 'in_progress', 'on_hold', 'completed', 'cancelled'], description: 'Filter by status' },
      clientName: { type: 'string', description: 'Filter by client name' },
    },
  },
  handler: async (params: { status?: string; clientName?: string }) => {
    const projectManager = getProjectManager();
    let clientId: string | undefined;

    if (params.clientName) {
      const client = getClientManager().getClientByName(params.clientName);
      if (!client) {
        return { success: false, error: `Client "${params.clientName}" not found` };
      }
      clientId = client.id;
    }

    const projects = projectManager.searchProjects({
      status: params.status ? [params.status as any] : undefined,
      clientId,
    });

    return { success: true, projects, count: projects.length };
  },
};

export const updateProjectStatusTool: ToolDefinition = {
  name: 'update_project_status',
  description: 'Update a project status (start, complete, pause, etc.).',
  parameters: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: 'Project name (partial match ok)' },
      status: { type: 'string', enum: ['planning', 'in_progress', 'on_hold', 'completed', 'cancelled'], description: 'New status' },
    },
    required: ['projectName', 'status'],
  },
  handler: async (params: { projectName: string; status: string }) => {
    const projectManager = getProjectManager();
    const projects = projectManager.searchProjects({ searchText: params.projectName });
    
    if (projects.length === 0) {
      return { success: false, error: `Project "${params.projectName}" not found` };
    }

    const project = await projectManager.updateProjectStatus(projects[0].id, params.status as any);
    return { success: true, project };
  },
};

// ============================================================
// Time Tracking Tools
// ============================================================

export const startTimerTool: ToolDefinition = {
  name: 'start_timer',
  description: 'Start a time tracking timer for a project.',
  parameters: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: 'Project name to track time for' },
      description: { type: 'string', description: 'What are you working on?' },
    },
    required: ['projectName'],
  },
  handler: async (params: { projectName: string; description?: string }) => {
    const projectManager = getProjectManager();
    const projects = projectManager.searchProjects({ searchText: params.projectName });
    
    if (projects.length === 0) {
      return { success: false, error: `Project "${params.projectName}" not found` };
    }

    const project = projects[0];
    const tracker = getTimeTracker();
    const timer = await tracker.startTimer({
      projectId: project.id,
      clientId: project.clientId,
      description: params.description,
      billable: true,
    });

    return { success: true, timer, projectName: project.name };
  },
};

export const stopTimerTool: ToolDefinition = {
  name: 'stop_timer',
  description: 'Stop the current time tracking timer.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Final description of work done' },
    },
  },
  handler: async (params: { description?: string }) => {
    const tracker = getTimeTracker();
    
    if (!tracker.isTimerRunning()) {
      return { success: false, error: 'No timer is currently running' };
    }

    const entry = await tracker.stopTimer(params.description);
    return { success: true, entry, hoursLogged: entry?.hours };
  },
};

export const getTimerStatusTool: ToolDefinition = {
  name: 'get_timer_status',
  description: 'Get the current timer status and time tracking stats.',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const tracker = getTimeTracker();
    const timer = tracker.getActiveTimer();
    const stats = tracker.getStats();

    if (timer) {
      const projectManager = getProjectManager();
      const project = projectManager.getProject(timer.projectId);
      return {
        success: true,
        timerRunning: true,
        project: project?.name,
        elapsed: tracker.getElapsedFormatted(),
        description: timer.description,
        stats,
      };
    }

    return { success: true, timerRunning: false, stats };
  },
};

export const logTimeTool: ToolDefinition = {
  name: 'log_time',
  description: 'Manually log time for a project.',
  parameters: {
    type: 'object',
    properties: {
      projectName: { type: 'string', description: 'Project name' },
      hours: { type: 'number', description: 'Hours worked' },
      description: { type: 'string', description: 'What was done' },
      date: { type: 'string', description: 'Date (YYYY-MM-DD), defaults to today' },
    },
    required: ['projectName', 'hours', 'description'],
  },
  handler: async (params: { projectName: string; hours: number; description: string; date?: string }) => {
    const projectManager = getProjectManager();
    const projects = projectManager.searchProjects({ searchText: params.projectName });
    
    if (projects.length === 0) {
      return { success: false, error: `Project "${params.projectName}" not found` };
    }

    const project = projects[0];
    const tracker = getTimeTracker();
    const entry = await tracker.createEntry({
      projectId: project.id,
      clientId: project.clientId,
      description: params.description,
      date: params.date ? new Date(params.date) : new Date(),
      hours: params.hours,
      billable: true,
    });

    // Update project hours
    await projectManager.addHours(project.id, params.hours);

    return { success: true, entry, projectName: project.name };
  },
};

// ============================================================
// Invoice Tools
// ============================================================

export const createInvoiceTool: ToolDefinition = {
  name: 'create_invoice',
  description: 'Create an invoice for a client.',
  parameters: {
    type: 'object',
    properties: {
      clientName: { type: 'string', description: 'Client name' },
      projectName: { type: 'string', description: 'Project name (optional)' },
      description: { type: 'string', description: 'Line item description' },
      amount: { type: 'number', description: 'Amount in GBP' },
      quantity: { type: 'number', description: 'Quantity (default 1)' },
      vatRate: { type: 'number', description: 'VAT rate % (default 0)' },
      dueDays: { type: 'number', description: 'Days until due (default 14)' },
    },
    required: ['clientName', 'description', 'amount'],
  },
  handler: async (params: { clientName: string; projectName?: string; description: string; amount: number; quantity?: number; vatRate?: number; dueDays?: number }) => {
    const clientManager = getClientManager();
    const client = clientManager.getClientByName(params.clientName);
    if (!client) {
      return { success: false, error: `Client "${params.clientName}" not found` };
    }

    let projectId: string | undefined;
    if (params.projectName) {
      const projects = getProjectManager().searchProjects({ 
        searchText: params.projectName, 
        clientId: client.id 
      });
      if (projects.length > 0) {
        projectId = projects[0].id;
      }
    }

    const invoiceManager = getInvoiceManager();
    const dueDate = new Date(Date.now() + (params.dueDays || 14) * 24 * 60 * 60 * 1000);

    const invoice = await invoiceManager.createInvoice({
      clientId: client.id,
      projectId,
      lineItems: [{
        description: params.description,
        quantity: params.quantity || 1,
        unitPrice: params.amount,
        taxRate: params.vatRate || 0,
      }],
      dueDate,
    });

    return { 
      success: true, 
      invoice: {
        number: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
      }
    };
  },
};

export const getInvoicesTool: ToolDefinition = {
  name: 'get_invoices',
  description: 'Get invoices. Can filter by status or client.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['draft', 'sent', 'paid', 'partial', 'overdue', 'void'], description: 'Filter by status' },
      clientName: { type: 'string', description: 'Filter by client name' },
    },
  },
  handler: async (params: { status?: string; clientName?: string }) => {
    const invoiceManager = getInvoiceManager();
    let clientId: string | undefined;

    if (params.clientName) {
      const client = getClientManager().getClientByName(params.clientName);
      if (client) clientId = client.id;
    }

    const invoices = invoiceManager.searchInvoices({
      status: params.status ? [params.status as any] : undefined,
      clientId,
    });

    const summary = invoices.map(i => ({
      number: i.invoiceNumber,
      client: params.clientName || clientId,
      total: i.total,
      status: i.status,
      dueDate: i.dueDate,
    }));

    return { success: true, invoices: summary, count: invoices.length };
  },
};

export const recordPaymentTool: ToolDefinition = {
  name: 'record_payment',
  description: 'Record a payment received for an invoice.',
  parameters: {
    type: 'object',
    properties: {
      invoiceNumber: { type: 'string', description: 'Invoice number (e.g., INV-1001)' },
      amount: { type: 'number', description: 'Payment amount' },
      method: { type: 'string', description: 'Payment method (bank transfer, card, etc.)' },
    },
    required: ['invoiceNumber', 'amount'],
  },
  handler: async (params: { invoiceNumber: string; amount: number; method?: string }) => {
    const invoiceManager = getInvoiceManager();
    const invoice = invoiceManager.getInvoiceByNumber(params.invoiceNumber);
    
    if (!invoice) {
      return { success: false, error: `Invoice "${params.invoiceNumber}" not found` };
    }

    const updated = await invoiceManager.recordPayment(invoice.id, params.amount, params.method);
    
    // Also update client's payment records
    if (updated) {
      await getClientManager().recordPayment(updated.clientId, params.amount);
    }

    return { 
      success: true, 
      status: updated?.status,
      amountPaid: updated?.amountPaid,
      remaining: updated ? updated.total - updated.amountPaid : 0,
    };
  },
};

// ============================================================
// Expense Tools
// ============================================================

export const logExpenseTool: ToolDefinition = {
  name: 'log_expense',
  description: 'Log a business expense.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'What was purchased' },
      amount: { type: 'number', description: 'Amount in GBP' },
      category: { type: 'string', enum: ['software', 'hardware', 'travel', 'meals', 'office', 'marketing', 'professional_services', 'training', 'utilities', 'insurance', 'other'], description: 'Expense category' },
      vendor: { type: 'string', description: 'Vendor/merchant name' },
      vatAmount: { type: 'number', description: 'VAT amount included' },
      projectName: { type: 'string', description: 'Associate with project (optional)' },
    },
    required: ['description', 'amount', 'category'],
  },
  handler: async (params: { description: string; amount: number; category: string; vendor?: string; vatAmount?: number; projectName?: string }) => {
    let projectId: string | undefined;
    let clientId: string | undefined;

    if (params.projectName) {
      const projects = getProjectManager().searchProjects({ searchText: params.projectName });
      if (projects.length > 0) {
        projectId = projects[0].id;
        clientId = projects[0].clientId;
      }
    }

    const tracker = getExpenseTracker();
    const expense = await tracker.createExpense({
      description: params.description,
      amount: params.amount,
      category: params.category as any,
      vendor: params.vendor,
      vatAmount: params.vatAmount,
      projectId,
      clientId,
    });

    return { success: true, expense };
  },
};

export const getExpensesTool: ToolDefinition = {
  name: 'get_expenses',
  description: 'Get expenses. Can filter by category or date range.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Filter by category' },
      thisMonth: { type: 'boolean', description: 'Only this month' },
    },
  },
  handler: async (params: { category?: string; thisMonth?: boolean }) => {
    const tracker = getExpenseTracker();
    
    let expenses;
    if (params.thisMonth) {
      expenses = tracker.getThisMonthExpenses();
    } else if (params.category) {
      expenses = tracker.getExpensesByCategory(params.category as any);
    } else {
      expenses = tracker.getAllExpenses();
    }

    const stats = tracker.getStats();
    return { 
      success: true, 
      expenses: expenses.slice(0, 20), 
      count: expenses.length,
      thisMonthTotal: stats.thisMonthTotal,
    };
  },
};

// ============================================================
// Lead/Pipeline Tools
// ============================================================

export const createLeadTool: ToolDefinition = {
  name: 'create_lead',
  description: 'Create a new sales lead.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Lead name' },
      company: { type: 'string', description: 'Company name' },
      email: { type: 'string', description: 'Email address' },
      source: { type: 'string', enum: ['referral', 'website', 'linkedin', 'cold_outreach', 'upwork', 'toptal', 'other'], description: 'Lead source' },
      projectDescription: { type: 'string', description: 'What they need' },
      estimatedValue: { type: 'number', description: 'Estimated project value' },
    },
    required: ['name', 'email', 'source', 'projectDescription'],
  },
  handler: async (params: { name: string; company?: string; email: string; source: string; projectDescription: string; estimatedValue?: number }) => {
    const manager = getLeadManager();
    const lead = await manager.createLead({
      name: params.name,
      company: params.company,
      email: params.email,
      source: params.source as any,
      projectDescription: params.projectDescription,
      estimatedValue: params.estimatedValue,
    });

    return { success: true, lead };
  },
};

export const getPipelineTool: ToolDefinition = {
  name: 'get_pipeline',
  description: 'Get sales pipeline overview.',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const manager = getLeadManager();
    const stats = manager.getStats();
    const dueFollowUps = manager.getDueFollowUps();
    const pipeline = manager.getPipelineValue();

    return {
      success: true,
      totalLeads: stats.total,
      activeLeads: stats.active,
      pipelineValue: pipeline.total,
      weightedValue: pipeline.weighted,
      conversionRate: stats.conversionRate.toFixed(1) + '%',
      dueFollowUps: dueFollowUps.length,
      byStage: stats.byStatus,
    };
  },
};

export const updateLeadStageTool: ToolDefinition = {
  name: 'update_lead_stage',
  description: 'Move a lead through the sales pipeline.',
  parameters: {
    type: 'object',
    properties: {
      leadName: { type: 'string', description: 'Lead name to update' },
      stage: { type: 'string', enum: ['contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], description: 'New stage' },
      notes: { type: 'string', description: 'Notes about the update' },
    },
    required: ['leadName', 'stage'],
  },
  handler: async (params: { leadName: string; stage: string; notes?: string }) => {
    const manager = getLeadManager();
    const leads = manager.searchLeads({ searchText: params.leadName });
    
    if (leads.length === 0) {
      return { success: false, error: `Lead "${params.leadName}" not found` };
    }

    let lead;
    switch (params.stage) {
      case 'contacted':
        lead = await manager.markContacted(leads[0].id, params.notes);
        break;
      case 'qualified':
        lead = await manager.markQualified(leads[0].id, params.notes);
        break;
      case 'negotiation':
        lead = await manager.markNegotiating(leads[0].id, params.notes);
        break;
      case 'lost':
        lead = await manager.markLost(leads[0].id, params.notes);
        break;
      default:
        lead = await manager.updateLeadStatus(leads[0].id, params.stage as any);
    }

    return { success: true, lead };
  },
};

// ============================================================
// Business Overview Tool
// ============================================================

export const getBusinessOverviewTool: ToolDefinition = {
  name: 'get_business_overview',
  description: 'Get a complete overview of the business - clients, projects, revenue, pipeline.',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const clientStats = getClientManager().getStats();
    const projectStats = getProjectManager().getStats();
    const timeStats = getTimeTracker().getStats();
    const invoiceStats = getInvoiceManager().getStats();
    const expenseStats = getExpenseTracker().getStats();
    const pipelineStats = getLeadManager().getStats();

    return {
      success: true,
      clients: {
        total: clientStats.total,
        active: clientStats.byStatus.active,
        outstanding: clientStats.totalOutstanding,
      },
      projects: {
        total: projectStats.total,
        active: projectStats.activeProjects,
        hoursLogged: projectStats.totalHours,
      },
      time: {
        timerRunning: timeStats.timerRunning,
        todayHours: timeStats.todayHours,
        weekHours: timeStats.weekHours,
        unbilledHours: timeStats.unbilledHours,
      },
      invoices: {
        outstanding: invoiceStats.totalOutstanding,
        overdue: invoiceStats.totalOverdue,
        thisMonthRevenue: invoiceStats.thisMonthRevenue,
      },
      expenses: {
        thisMonth: expenseStats.thisMonthTotal,
        vatReclaimable: expenseStats.thisMonthVAT,
      },
      pipeline: {
        activeLeads: pipelineStats.active,
        pipelineValue: pipelineStats.pipelineValue,
        weightedValue: pipelineStats.weightedValue,
        conversionRate: pipelineStats.conversionRate.toFixed(1) + '%',
      },
    };
  },
};

// ============================================================
// Export all tools
// ============================================================

export function getBusinessTools(): ToolDefinition[] {
  return [
    // Clients
    createClientTool,
    getClientsTool,
    logClientInteractionTool,
    // Projects
    createProjectTool,
    getProjectsTool,
    updateProjectStatusTool,
    // Time
    startTimerTool,
    stopTimerTool,
    getTimerStatusTool,
    logTimeTool,
    // Invoices
    createInvoiceTool,
    getInvoicesTool,
    recordPaymentTool,
    // Expenses
    logExpenseTool,
    getExpensesTool,
    // Pipeline
    createLeadTool,
    getPipelineTool,
    updateLeadStageTool,
    // Overview
    getBusinessOverviewTool,
  ];
}
