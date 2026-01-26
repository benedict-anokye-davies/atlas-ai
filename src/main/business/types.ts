/**
 * Atlas Desktop - Business Management Types
 * Core type definitions for AtlasAgency business operations
 *
 * @module business/types
 */

// ============================================================
// Client Types
// ============================================================

export type ClientStatus = 'lead' | 'prospect' | 'active' | 'past' | 'lost';

export type ClientSource = 'referral' | 'website' | 'linkedin' | 'cold_outreach' | 'upwork' | 'toptal' | 'other';

export interface ClientContact {
  type: 'email' | 'phone' | 'linkedin' | 'other';
  value: string;
  primary: boolean;
}

export interface Client {
  id: string;
  name: string;
  company?: string;
  email: string;
  phone?: string;
  contacts: ClientContact[];
  status: ClientStatus;
  source: ClientSource;
  /** How they found us / referral source details */
  sourceDetails?: string;
  /** Payment terms in days (e.g., 14, 30) */
  paymentTerms: number;
  /** Default hourly rate for this client */
  defaultHourlyRate?: number;
  /** Outstanding balance owed */
  outstandingBalance: number;
  /** Total amount ever paid */
  totalPaid: number;
  /** Custom tags for organization */
  tags: string[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientInteraction {
  id: string;
  clientId: string;
  type: 'call' | 'email' | 'meeting' | 'message' | 'note';
  summary: string;
  details?: string;
  timestamp: Date;
  /** Next follow-up date if scheduled */
  followUpDate?: Date;
  followUpCompleted: boolean;
}

// ============================================================
// Project Types
// ============================================================

export type ProjectStatus = 'proposal' | 'negotiation' | 'active' | 'paused' | 'completed' | 'cancelled';

export type BillingType = 'fixed' | 'hourly' | 'retainer';

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  deliverables: string[];
  dueDate: Date;
  completedDate?: Date;
  amount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'invoiced';
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  billingType: BillingType;
  /** Fixed price or retainer amount */
  fixedPrice?: number;
  /** Hourly rate if billing type is hourly */
  hourlyRate?: number;
  /** Estimated hours for the project */
  estimatedHours?: number;
  /** Actual hours logged */
  actualHours: number;
  /** Budget limit (for hourly projects) */
  budgetLimit?: number;
  milestones: Milestone[];
  /** Repository URL */
  repoUrl?: string;
  /** Document folder path */
  documentsPath?: string;
  startDate?: Date;
  dueDate?: Date;
  completedDate?: Date;
  tags: string[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Time Tracking Types
// ============================================================

export interface TimeEntry {
  id: string;
  projectId: string;
  description: string;
  /** Duration in minutes */
  duration: number;
  hourlyRate: number;
  billable: boolean;
  invoiceId?: string;
  date: Date;
  startTime?: Date;
  endTime?: Date;
  createdAt: Date;
}

export interface ActiveTimer {
  projectId: string;
  description: string;
  startTime: Date;
  hourlyRate: number;
  billable: boolean;
}

// ============================================================
// Invoice Types
// ============================================================

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Reference to time entry or milestone */
  referenceId?: string;
  referenceType?: 'time_entry' | 'milestone' | 'expense' | 'custom';
}

export interface Invoice {
  id: string;
  /** Invoice number (e.g., INV-2026-001) */
  invoiceNumber: string;
  clientId: string;
  projectId?: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  /** Tax rate as decimal (e.g., 0.20 for 20% VAT) */
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  /** Payment terms in days */
  paymentTerms: number;
  issueDate: Date;
  dueDate: Date;
  paidDate?: Date;
  /** Number of reminders sent */
  remindersSent: number;
  lastReminderDate?: Date;
  notes?: string;
  /** PDF file path */
  pdfPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Lead / Pipeline Types
// ============================================================

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'negotiation' | 'won' | 'lost';

export interface Lead {
  id: string;
  name: string;
  company?: string;
  email: string;
  phone?: string;
  source: ClientSource;
  sourceDetails?: string;
  stage: LeadStage;
  /** Estimated project value */
  estimatedValue: number;
  /** Probability of closing (0-1) */
  probability: number;
  /** Weighted pipeline value */
  weightedValue: number;
  /** Project description / requirements */
  projectDescription?: string;
  /** Last contact date */
  lastContactDate?: Date;
  /** Next follow-up date */
  nextFollowUp?: Date;
  /** Reason if lost */
  lostReason?: string;
  notes: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  /** Converted to client ID if won */
  convertedClientId?: string;
}

export interface Proposal {
  id: string;
  leadId: string;
  title: string;
  description: string;
  /** Line items with pricing */
  items: Array<{
    description: string;
    amount: number;
  }>;
  totalAmount: number;
  validUntil: Date;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  sentDate?: Date;
  respondedDate?: Date;
  /** PDF file path */
  pdfPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Expense Types
// ============================================================

export type ExpenseCategory = 'software' | 'hardware' | 'travel' | 'office' | 'marketing' | 'professional' | 'education' | 'other';

export interface Expense {
  id: string;
  /** Associated project (optional) */
  projectId?: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  /** VAT amount if applicable */
  vatAmount?: number;
  /** Whether this is tax-deductible */
  taxDeductible: boolean;
  /** Whether to bill to client */
  billable: boolean;
  /** Invoice ID if billed */
  invoiceId?: string;
  date: Date;
  /** Receipt file path */
  receiptPath?: string;
  vendor?: string;
  notes?: string;
  createdAt: Date;
}

// ============================================================
// Financial / Reporting Types
// ============================================================

export interface RevenueReport {
  period: {
    start: Date;
    end: Date;
  };
  totalRevenue: number;
  invoicedAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  byClient: Array<{
    clientId: string;
    clientName: string;
    revenue: number;
  }>;
  byProject: Array<{
    projectId: string;
    projectName: string;
    revenue: number;
  }>;
}

export interface ExpenseReport {
  period: {
    start: Date;
    end: Date;
  };
  totalExpenses: number;
  taxDeductible: number;
  byCategory: Array<{
    category: ExpenseCategory;
    amount: number;
  }>;
}

export interface ProfitLossReport {
  period: {
    start: Date;
    end: Date;
  };
  revenue: number;
  expenses: number;
  profit: number;
  profitMargin: number;
}

export interface TaxEstimate {
  /** Tax year (e.g., '2025-26') */
  taxYear: string;
  grossIncome: number;
  allowableExpenses: number;
  taxableIncome: number;
  /** Estimated income tax */
  incomeTax: number;
  /** Estimated National Insurance */
  nationalInsurance: number;
  /** Student loan repayment if applicable */
  studentLoan?: number;
  totalTaxLiability: number;
  /** Suggested monthly set-aside */
  monthlySetAside: number;
}

export interface WeeklyBusinessReport {
  weekOf: Date;
  revenue: {
    invoiced: number;
    received: number;
    outstanding: number;
  };
  time: {
    billableHours: number;
    nonBillableHours: number;
    utilizationRate: number;
  };
  pipeline: {
    newLeads: number;
    pipelineValue: number;
    proposalsSent: number;
  };
  tasks: {
    followUpsDue: number;
    invoicesOverdue: number;
    milestonesThisWeek: number;
  };
}

// ============================================================
// Automation Types
// ============================================================

export interface FollowUpReminder {
  id: string;
  type: 'client' | 'lead';
  entityId: string;
  entityName: string;
  reason: string;
  dueDate: Date;
  completed: boolean;
  completedDate?: Date;
}

export interface ScheduledInvoice {
  id: string;
  clientId: string;
  projectId?: string;
  /** Template or line items to use */
  template: InvoiceLineItem[];
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  nextDate: Date;
  lastGenerated?: Date;
  active: boolean;
}

// ============================================================
// Database / Storage Types
// ============================================================

export interface BusinessDatabase {
  clients: Client[];
  interactions: ClientInteraction[];
  projects: Project[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  leads: Lead[];
  proposals: Proposal[];
  expenses: Expense[];
  followUpReminders: FollowUpReminder[];
  scheduledInvoices: ScheduledInvoice[];
  settings: BusinessSettings;
}

export interface BusinessSettings {
  /** Business name */
  businessName: string;
  /** Business address for invoices */
  address: string[];
  /** Business email */
  email: string;
  /** Business phone */
  phone?: string;
  /** Default currency */
  currency: string;
  /** Default tax rate */
  defaultTaxRate: number;
  /** Default payment terms (days) */
  defaultPaymentTerms: number;
  /** Bank details for invoices */
  bankDetails?: {
    accountName: string;
    sortCode: string;
    accountNumber: string;
  };
  /** Invoice number prefix */
  invoicePrefix: string;
  /** Next invoice number */
  nextInvoiceNumber: number;
  /** Annual income goal */
  incomeGoal?: number;
}

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  businessName: 'AtlasAgency',
  address: [],
  email: '',
  currency: 'GBP',
  defaultTaxRate: 0.20,
  defaultPaymentTerms: 14,
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
};

// ============================================================
// Event Types
// ============================================================

export interface BusinessEvents {
  'client-created': (client: Client) => void;
  'client-updated': (client: Client) => void;
  'project-created': (project: Project) => void;
  'project-updated': (project: Project) => void;
  'project-completed': (project: Project) => void;
  'time-logged': (entry: TimeEntry) => void;
  'timer-started': (timer: ActiveTimer) => void;
  'timer-stopped': (entry: TimeEntry) => void;
  'invoice-created': (invoice: Invoice) => void;
  'invoice-sent': (invoice: Invoice) => void;
  'invoice-paid': (invoice: Invoice) => void;
  'invoice-overdue': (invoice: Invoice) => void;
  'lead-created': (lead: Lead) => void;
  'lead-converted': (lead: Lead, client: Client) => void;
  'lead-lost': (lead: Lead) => void;
  'follow-up-due': (reminder: FollowUpReminder) => void;
  'milestone-due': (milestone: Milestone, project: Project) => void;
  'weekly-report': (report: WeeklyBusinessReport) => void;
}
