# Atlas Business Management Module - PRD

**Version:** 1.0  
**Created:** January 2026  
**Author:** Ben  
**Status:** Specification

---

## Overview

A comprehensive business management system integrated into Atlas that enables voice-controlled freelance/consulting business operations. Designed to help Ben manage AtlasAgency and freelance work without leaving the Atlas interface.

## Goals

1. **Zero-friction business ops** - Voice commands for all common tasks
2. **Single source of truth** - All client/project data in one place
3. **Proactive assistance** - Atlas reminds you before things slip
4. **Financial clarity** - Real-time revenue, expenses, profit tracking
5. **Time savings** - Automate invoicing, follow-ups, reporting

---

## Module Architecture

```
src/main/business/
├── types.ts                 # Core business types
├── index.ts                 # Module exports
├── crm/
│   ├── client-manager.ts    # Client CRUD operations
│   ├── contact-store.ts     # Contact database (SQLite)
│   └── interaction-log.ts   # Track all client touchpoints
├── projects/
│   ├── project-manager.ts   # Project lifecycle
│   ├── milestone-tracker.ts # Deliverables & deadlines
│   └── time-tracker.ts      # Billable hours
├── finance/
│   ├── invoice-manager.ts   # Create, send, track invoices
│   ├── expense-tracker.ts   # Business expenses
│   ├── revenue-dashboard.ts # Income analytics
│   └── tax-estimator.ts     # Quarterly tax calculations
├── pipeline/
│   ├── lead-manager.ts      # Lead tracking
│   ├── proposal-generator.ts # Quote templates
│   └── deal-tracker.ts      # Sales funnel
└── automation/
    ├── follow-up-engine.ts  # Automated reminders
    ├── invoice-scheduler.ts # Recurring invoices
    └── report-generator.ts  # Weekly/monthly reports
```

---

## Data Models

### Client

```typescript
interface Client {
  id: string;
  name: string;
  company?: string;
  email: string;
  phone?: string;
  address?: string;
  
  // Relationship
  status: 'lead' | 'prospect' | 'active' | 'past' | 'lost';
  source: string; // How they found you
  industry: string;
  
  // Preferences
  preferredContact: 'email' | 'phone' | 'whatsapp';
  timezone: string;
  notes: string;
  tags: string[];
  
  // Financials
  totalRevenue: number;
  outstandingBalance: number;
  paymentTerms: number; // Days
  
  // Metadata
  createdAt: Date;
  lastContactAt: Date;
  nextFollowUp?: Date;
}
```

### Project

```typescript
interface Project {
  id: string;
  clientId: string;
  name: string;
  description: string;
  
  // Status
  status: 'proposal' | 'negotiation' | 'active' | 'paused' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  // Timeline
  startDate?: Date;
  dueDate?: Date;
  completedDate?: Date;
  
  // Financials
  type: 'fixed' | 'hourly' | 'retainer';
  quotedAmount: number;
  hourlyRate?: number;
  hoursEstimated?: number;
  hoursLogged: number;
  
  // Deliverables
  milestones: Milestone[];
  
  // Files
  repositoryUrl?: string;
  documentsFolder?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

interface Milestone {
  id: string;
  name: string;
  description?: string;
  dueDate: Date;
  status: 'pending' | 'in-progress' | 'review' | 'completed';
  deliverables: string[];
  paymentAmount?: number; // If milestone-based billing
}
```

### Invoice

```typescript
interface Invoice {
  id: string;
  invoiceNumber: string; // INV-2026-001
  clientId: string;
  projectId?: string;
  
  // Line items
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  
  // Status
  status: 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled';
  
  // Dates
  issueDate: Date;
  dueDate: Date;
  paidDate?: Date;
  
  // Payment
  paymentMethod?: string;
  paymentReference?: string;
  
  // Communication
  sentAt?: Date;
  reminders: ReminderLog[];
  
  // Files
  pdfPath?: string;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ReminderLog {
  sentAt: Date;
  type: 'email' | 'sms' | 'manual';
  response?: string;
}
```

### Lead/Opportunity

```typescript
interface Lead {
  id: string;
  
  // Contact
  name: string;
  company?: string;
  email: string;
  phone?: string;
  
  // Opportunity
  source: 'referral' | 'website' | 'linkedin' | 'cold-outreach' | 'other';
  projectType: string;
  estimatedValue: number;
  probability: number; // 0-100%
  
  // Pipeline
  stage: 'new' | 'contacted' | 'qualified' | 'proposal-sent' | 'negotiation' | 'won' | 'lost';
  lostReason?: string;
  
  // Timeline
  createdAt: Date;
  lastContactAt: Date;
  nextAction: string;
  nextActionDate: Date;
  
  // Notes
  notes: string;
  interactions: Interaction[];
}

interface Interaction {
  date: Date;
  type: 'call' | 'email' | 'meeting' | 'message' | 'note';
  summary: string;
  outcome?: string;
  nextStep?: string;
}
```

### Time Entry

```typescript
interface TimeEntry {
  id: string;
  projectId: string;
  
  // Time
  date: Date;
  startTime?: Date;
  endTime?: Date;
  duration: number; // Minutes
  
  // Details
  description: string;
  billable: boolean;
  billed: boolean;
  invoiceId?: string;
  
  // Rates
  hourlyRate: number;
  amount: number;
}
```

### Expense

```typescript
interface Expense {
  id: string;
  projectId?: string; // Optional - can be general business expense
  
  // Details
  date: Date;
  category: 'software' | 'hardware' | 'travel' | 'office' | 'marketing' | 'professional' | 'other';
  vendor: string;
  description: string;
  amount: number;
  
  // Tax
  vatAmount?: number;
  taxDeductible: boolean;
  
  // Receipt
  receiptPath?: string;
  
  // Billing
  billable: boolean;
  billed: boolean;
  invoiceId?: string;
}
```

---

## Voice Commands

### Client Management

```
"Add a new client called [name] from [company]"
"Show me all active clients"
"What's the contact info for [client]?"
"When did I last talk to [client]?"
"Set a follow-up with [client] for [date]"
"Add a note to [client]: [note content]"
"How much has [client] paid me total?"
"Which clients have outstanding balances?"
```

### Project Management

```
"Create a new project for [client] called [name]"
"What projects am I working on?"
"What's due this week?"
"Show me the [project] timeline"
"Log 3 hours on [project] for [description]"
"Mark [milestone] as complete"
"What's the total time on [project]?"
"Which projects are overdue?"
```

### Invoicing

```
"Create an invoice for [client]"
"Invoice [client] for [amount] for [description]"
"Generate invoice for [project] hours"
"Send the invoice to [client]"
"What invoices are outstanding?"
"What invoices are overdue?"
"Send a reminder for invoice [number]"
"Mark invoice [number] as paid"
"How much am I owed right now?"
```

### Pipeline/Sales

```
"Add a new lead: [name] from [company]"
"Show me my sales pipeline"
"What's my pipeline value?"
"Move [lead] to proposal stage"
"Create a proposal for [lead]"
"What leads need follow-up today?"
"Mark [lead] as won"
"Why did we lose [lead]?"
```

### Time Tracking

```
"Start timer for [project]"
"Stop timer"
"Log [hours] hours on [project]"
"What did I work on today?"
"How many hours this week?"
"Show me unbilled time"
"What's my billable rate this month?"
```

### Financial Reporting

```
"What's my revenue this month?"
"Compare this month to last month"
"What are my expenses this month?"
"What's my profit margin?"
"Estimate my quarterly taxes"
"Show me revenue by client"
"What's my average project value?"
"Am I on track for my income goal?"
```

### Automation Commands

```
"Send follow-up reminders for overdue invoices"
"Generate weekly business report"
"Schedule monthly invoice for [client]"
"Set up automatic payment reminders"
"Create a proposal template"
```

---

## IPC Handlers

```typescript
// src/main/ipc/business-handlers.ts

// Clients
ipcMain.handle('business:client:create', async (_, data: CreateClientDTO) => {...});
ipcMain.handle('business:client:get', async (_, id: string) => {...});
ipcMain.handle('business:client:list', async (_, filters?: ClientFilters) => {...});
ipcMain.handle('business:client:update', async (_, id: string, data: UpdateClientDTO) => {...});
ipcMain.handle('business:client:delete', async (_, id: string) => {...});
ipcMain.handle('business:client:stats', async (_, id: string) => {...});

// Projects
ipcMain.handle('business:project:create', async (_, data: CreateProjectDTO) => {...});
ipcMain.handle('business:project:get', async (_, id: string) => {...});
ipcMain.handle('business:project:list', async (_, filters?: ProjectFilters) => {...});
ipcMain.handle('business:project:update', async (_, id: string, data: UpdateProjectDTO) => {...});
ipcMain.handle('business:project:timeline', async (_, id: string) => {...});

// Time Tracking
ipcMain.handle('business:time:start', async (_, projectId: string) => {...});
ipcMain.handle('business:time:stop', async () => {...});
ipcMain.handle('business:time:log', async (_, entry: CreateTimeEntryDTO) => {...});
ipcMain.handle('business:time:list', async (_, filters?: TimeFilters) => {...});
ipcMain.handle('business:time:unbilled', async () => {...});

// Invoicing
ipcMain.handle('business:invoice:create', async (_, data: CreateInvoiceDTO) => {...});
ipcMain.handle('business:invoice:generate', async (_, projectId: string) => {...});
ipcMain.handle('business:invoice:send', async (_, id: string) => {...});
ipcMain.handle('business:invoice:remind', async (_, id: string) => {...});
ipcMain.handle('business:invoice:markPaid', async (_, id: string, data: PaymentDTO) => {...});
ipcMain.handle('business:invoice:list', async (_, filters?: InvoiceFilters) => {...});
ipcMain.handle('business:invoice:overdue', async () => {...});

// Pipeline
ipcMain.handle('business:lead:create', async (_, data: CreateLeadDTO) => {...});
ipcMain.handle('business:lead:update', async (_, id: string, data: UpdateLeadDTO) => {...});
ipcMain.handle('business:lead:move', async (_, id: string, stage: LeadStage) => {...});
ipcMain.handle('business:lead:convert', async (_, id: string) => {...}); // Lead -> Client
ipcMain.handle('business:pipeline:summary', async () => {...});

// Reports
ipcMain.handle('business:report:revenue', async (_, period: ReportPeriod) => {...});
ipcMain.handle('business:report:expenses', async (_, period: ReportPeriod) => {...});
ipcMain.handle('business:report:profitLoss', async (_, period: ReportPeriod) => {...});
ipcMain.handle('business:report:clientRevenue', async (_, period: ReportPeriod) => {...});
ipcMain.handle('business:report:taxEstimate', async (_, quarter: number) => {...});
ipcMain.handle('business:report:weekly', async () => {...});

// Dashboard
ipcMain.handle('business:dashboard:summary', async () => {...});
```

---

## Agent Tools

```typescript
// src/main/agent/tools/business-tools.ts

export const BUSINESS_TOOLS: Tool[] = [
  // Client tools
  {
    name: 'create_client',
    description: 'Add a new client to the CRM',
    parameters: {
      name: { type: 'string', required: true },
      company: { type: 'string' },
      email: { type: 'string', required: true },
      phone: { type: 'string' },
      industry: { type: 'string' },
      source: { type: 'string' },
    },
  },
  {
    name: 'get_client',
    description: 'Get client details by name or company',
    parameters: {
      query: { type: 'string', required: true },
    },
  },
  {
    name: 'list_clients',
    description: 'List all clients with optional filters',
    parameters: {
      status: { type: 'string', enum: ['lead', 'prospect', 'active', 'past'] },
      hasOutstanding: { type: 'boolean' },
    },
  },
  {
    name: 'log_client_interaction',
    description: 'Log an interaction with a client',
    parameters: {
      clientId: { type: 'string', required: true },
      type: { type: 'string', enum: ['call', 'email', 'meeting', 'message'] },
      summary: { type: 'string', required: true },
      nextStep: { type: 'string' },
    },
  },
  
  // Project tools
  {
    name: 'create_project',
    description: 'Create a new project for a client',
    parameters: {
      clientId: { type: 'string', required: true },
      name: { type: 'string', required: true },
      type: { type: 'string', enum: ['fixed', 'hourly', 'retainer'] },
      amount: { type: 'number', required: true },
      dueDate: { type: 'string' },
    },
  },
  {
    name: 'get_active_projects',
    description: 'Get all active projects',
    parameters: {},
  },
  {
    name: 'get_project_status',
    description: 'Get detailed status of a project',
    parameters: {
      projectId: { type: 'string', required: true },
    },
  },
  {
    name: 'update_milestone',
    description: 'Update a project milestone status',
    parameters: {
      projectId: { type: 'string', required: true },
      milestoneId: { type: 'string', required: true },
      status: { type: 'string', enum: ['pending', 'in-progress', 'review', 'completed'] },
    },
  },
  
  // Time tracking tools
  {
    name: 'start_timer',
    description: 'Start time tracking for a project',
    parameters: {
      projectId: { type: 'string', required: true },
      description: { type: 'string' },
    },
  },
  {
    name: 'stop_timer',
    description: 'Stop the current time tracker',
    parameters: {},
  },
  {
    name: 'log_time',
    description: 'Log time to a project',
    parameters: {
      projectId: { type: 'string', required: true },
      hours: { type: 'number', required: true },
      description: { type: 'string', required: true },
      billable: { type: 'boolean', default: true },
    },
  },
  {
    name: 'get_time_summary',
    description: 'Get time tracking summary',
    parameters: {
      period: { type: 'string', enum: ['today', 'week', 'month'] },
      projectId: { type: 'string' },
    },
  },
  
  // Invoice tools
  {
    name: 'create_invoice',
    description: 'Create an invoice for a client',
    parameters: {
      clientId: { type: 'string', required: true },
      projectId: { type: 'string' },
      items: { type: 'array', required: true },
      dueInDays: { type: 'number', default: 14 },
    },
  },
  {
    name: 'generate_project_invoice',
    description: 'Auto-generate invoice from project hours',
    parameters: {
      projectId: { type: 'string', required: true },
    },
  },
  {
    name: 'send_invoice',
    description: 'Send invoice to client via email',
    parameters: {
      invoiceId: { type: 'string', required: true },
      message: { type: 'string' },
    },
  },
  {
    name: 'get_outstanding_invoices',
    description: 'Get all unpaid invoices',
    parameters: {
      overdueOnly: { type: 'boolean', default: false },
    },
  },
  {
    name: 'mark_invoice_paid',
    description: 'Mark an invoice as paid',
    parameters: {
      invoiceId: { type: 'string', required: true },
      paymentMethod: { type: 'string' },
      paymentDate: { type: 'string' },
    },
  },
  {
    name: 'send_payment_reminder',
    description: 'Send payment reminder for invoice',
    parameters: {
      invoiceId: { type: 'string', required: true },
    },
  },
  
  // Pipeline tools
  {
    name: 'add_lead',
    description: 'Add a new lead to the pipeline',
    parameters: {
      name: { type: 'string', required: true },
      company: { type: 'string' },
      email: { type: 'string', required: true },
      source: { type: 'string' },
      estimatedValue: { type: 'number' },
      projectType: { type: 'string' },
    },
  },
  {
    name: 'get_pipeline',
    description: 'Get sales pipeline summary',
    parameters: {},
  },
  {
    name: 'move_lead_stage',
    description: 'Move a lead to a new pipeline stage',
    parameters: {
      leadId: { type: 'string', required: true },
      stage: { type: 'string', enum: ['contacted', 'qualified', 'proposal-sent', 'negotiation', 'won', 'lost'] },
      notes: { type: 'string' },
    },
  },
  {
    name: 'generate_proposal',
    description: 'Generate a proposal document for a lead',
    parameters: {
      leadId: { type: 'string', required: true },
      template: { type: 'string', default: 'standard' },
    },
  },
  
  // Financial tools
  {
    name: 'get_revenue_report',
    description: 'Get revenue report for a period',
    parameters: {
      period: { type: 'string', enum: ['week', 'month', 'quarter', 'year'] },
    },
  },
  {
    name: 'get_expense_report',
    description: 'Get expense report for a period',
    parameters: {
      period: { type: 'string', enum: ['week', 'month', 'quarter', 'year'] },
    },
  },
  {
    name: 'estimate_quarterly_tax',
    description: 'Estimate quarterly tax liability',
    parameters: {
      quarter: { type: 'number', required: true },
    },
  },
  {
    name: 'get_business_dashboard',
    description: 'Get overall business dashboard summary',
    parameters: {},
  },
  {
    name: 'log_expense',
    description: 'Log a business expense',
    parameters: {
      category: { type: 'string', required: true },
      vendor: { type: 'string', required: true },
      amount: { type: 'number', required: true },
      description: { type: 'string' },
      projectId: { type: 'string' },
    },
  },
];
```

---

## Database Schema

```sql
-- SQLite schema for business data

-- Clients
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  status TEXT DEFAULT 'lead',
  source TEXT,
  industry TEXT,
  preferred_contact TEXT DEFAULT 'email',
  timezone TEXT DEFAULT 'Europe/London',
  notes TEXT,
  tags TEXT, -- JSON array
  total_revenue REAL DEFAULT 0,
  outstanding_balance REAL DEFAULT 0,
  payment_terms INTEGER DEFAULT 14,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_contact_at DATETIME,
  next_follow_up DATETIME
);

-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'proposal',
  priority TEXT DEFAULT 'medium',
  type TEXT DEFAULT 'fixed',
  quoted_amount REAL,
  hourly_rate REAL,
  hours_estimated REAL,
  hours_logged REAL DEFAULT 0,
  start_date DATE,
  due_date DATE,
  completed_date DATE,
  repository_url TEXT,
  documents_folder TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Milestones
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT DEFAULT 'pending',
  deliverables TEXT, -- JSON array
  payment_amount REAL,
  completed_at DATETIME,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Time Entries
CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  date DATE NOT NULL,
  start_time DATETIME,
  end_time DATETIME,
  duration INTEGER NOT NULL, -- minutes
  description TEXT NOT NULL,
  billable BOOLEAN DEFAULT 1,
  billed BOOLEAN DEFAULT 0,
  invoice_id TEXT,
  hourly_rate REAL,
  amount REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Invoices
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT,
  items TEXT NOT NULL, -- JSON array
  subtotal REAL NOT NULL,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'draft',
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  payment_method TEXT,
  payment_reference TEXT,
  sent_at DATETIME,
  pdf_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Invoice Reminders
CREATE TABLE invoice_reminders (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  sent_at DATETIME NOT NULL,
  type TEXT NOT NULL,
  response TEXT,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- Leads
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT,
  project_type TEXT,
  estimated_value REAL,
  probability INTEGER DEFAULT 50,
  stage TEXT DEFAULT 'new',
  lost_reason TEXT,
  next_action TEXT,
  next_action_date DATE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_contact_at DATETIME
);

-- Interactions (for both clients and leads)
CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'client' or 'lead'
  entity_id TEXT NOT NULL,
  date DATETIME NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  outcome TEXT,
  next_step TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Expenses
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  date DATE NOT NULL,
  category TEXT NOT NULL,
  vendor TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  vat_amount REAL,
  tax_deductible BOOLEAN DEFAULT 1,
  receipt_path TEXT,
  billable BOOLEAN DEFAULT 0,
  billed BOOLEAN DEFAULT 0,
  invoice_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Indexes
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_time_entries_date ON time_entries(date);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_expenses_date ON expenses(date);
```

---

## UI Components

### Business Dashboard Widget

```typescript
// src/renderer/components/BusinessDashboard.tsx

interface BusinessDashboardProps {
  compact?: boolean; // For sidebar widget
}

// Shows:
// - Revenue this month (vs last month)
// - Outstanding invoices count + total
// - Active projects count
// - Upcoming deadlines (next 7 days)
// - Pipeline value
// - Quick actions: New invoice, Log time, Add lead
```

### Client List View

```typescript
// src/renderer/components/ClientList.tsx

// Table view with:
// - Name, Company, Status, Total Revenue, Outstanding, Last Contact
// - Filter by status
// - Search by name/company
// - Click to expand details
// - Quick actions: Email, Log interaction, Create invoice
```

### Project Kanban Board

```typescript
// src/renderer/components/ProjectBoard.tsx

// Kanban columns:
// - Proposal | Negotiation | Active | Review | Completed
// - Drag-drop cards
// - Card shows: Client, Due date, Value, Progress
// - Click to expand full project view
```

### Invoice Manager

```typescript
// src/renderer/components/InvoiceManager.tsx

// List view:
// - Invoice #, Client, Amount, Status, Due Date
// - Status badges: Draft, Sent, Viewed, Paid, Overdue
// - Actions: Send, Remind, Mark Paid, Download PDF
// - Generate new invoice modal
```

### Time Tracker Widget

```typescript
// src/renderer/components/TimeTracker.tsx

// Persistent widget showing:
// - Current timer (if running)
// - Project selector
// - Start/Stop button
// - Quick log entry
// - Today's logged time
```

### Pipeline Funnel

```typescript
// src/renderer/components/PipelineFunnel.tsx

// Visual funnel showing:
// - Stages with lead counts
// - Total value per stage
// - Conversion rates
// - Click stage to see leads
```

### Financial Charts

```typescript
// src/renderer/components/FinancialCharts.tsx

// Charts:
// - Monthly revenue trend (bar chart)
// - Revenue by client (pie chart)
// - Income vs Expenses (line chart)
// - Tax estimate summary
```

---

## Automations

### Follow-up Reminders

```typescript
// Runs daily at 9am
async function checkFollowUps() {
  const dueToday = await getClientsNeedingFollowUp();
  for (const client of dueToday) {
    await sendNotification({
      title: `Follow up with ${client.name}`,
      body: `Scheduled follow-up is due today`,
      actions: ['Call', 'Email', 'Snooze'],
    });
  }
}
```

### Overdue Invoice Alerts

```typescript
// Runs daily at 10am
async function checkOverdueInvoices() {
  const overdue = await getOverdueInvoices();
  if (overdue.length > 0) {
    const total = overdue.reduce((sum, inv) => sum + inv.total, 0);
    await sendNotification({
      title: `${overdue.length} overdue invoices`,
      body: `Total: £${total.toLocaleString()} outstanding`,
      actions: ['Send Reminders', 'View All'],
    });
  }
}
```

### Weekly Report Generation

```typescript
// Runs Sunday evening
async function generateWeeklyReport() {
  const report = {
    revenue: await getWeekRevenue(),
    hoursLogged: await getWeekHours(),
    invoicesSent: await getWeekInvoicesSent(),
    invoicesPaid: await getWeekInvoicesPaid(),
    newLeads: await getWeekNewLeads(),
    projectsCompleted: await getWeekCompletedProjects(),
  };
  
  await saveReport(report);
  await notifyUser(`Weekly report ready: £${report.revenue} revenue, ${report.hoursLogged}hrs logged`);
}
```

### Recurring Invoice Generation

```typescript
// For retainer clients - runs on schedule
async function generateRecurringInvoice(schedule: RecurringSchedule) {
  const invoice = await createInvoice({
    clientId: schedule.clientId,
    items: schedule.items,
    dueInDays: schedule.paymentTerms,
  });
  
  if (schedule.autoSend) {
    await sendInvoice(invoice.id);
  }
}
```

---

## Integration Points

### Email Integration

```typescript
// Send invoices and reminders via configured email
interface EmailConfig {
  provider: 'gmail' | 'outlook' | 'smtp';
  templates: {
    invoice: string;
    reminder: string;
    proposal: string;
    followUp: string;
  };
}
```

### Calendar Sync

```typescript
// Sync deadlines and meetings to calendar
interface CalendarSync {
  syncMilestones: boolean;
  syncFollowUps: boolean;
  syncClientMeetings: boolean;
  calendarId: string;
}
```

### Banking/Payment Integration (Future)

```typescript
// For automatic payment reconciliation
interface BankingIntegration {
  provider: 'stripe' | 'wise' | 'revolut';
  autoReconcile: boolean;
  webhookUrl: string;
}
```

---

## Implementation Phases

### Phase 1: Core CRM (Week 1-2)
- [ ] Database schema setup
- [ ] Client CRUD operations
- [ ] Project management basics
- [ ] IPC handlers
- [ ] Basic voice commands

### Phase 2: Time & Invoicing (Week 3-4)
- [ ] Time tracking (start/stop/log)
- [ ] Invoice generation
- [ ] PDF invoice creation
- [ ] Email sending
- [ ] Payment tracking

### Phase 3: Pipeline & Reporting (Week 5-6)
- [ ] Lead management
- [ ] Pipeline stages
- [ ] Revenue reports
- [ ] Expense tracking
- [ ] Tax estimation

### Phase 4: UI & Automation (Week 7-8)
- [ ] Dashboard widget
- [ ] Client/project views
- [ ] Invoice manager UI
- [ ] Automated reminders
- [ ] Weekly reports

### Phase 5: Polish & Integration (Week 9-10)
- [ ] Calendar sync
- [ ] Email templates
- [ ] Proposal generator
- [ ] Mobile notifications
- [ ] Testing & refinement

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to log hours | <5 seconds (voice) |
| Time to create invoice | <30 seconds (voice) |
| Invoice payment tracking | 100% automated |
| Follow-up compliance | 90% on-time |
| Weekly report generation | Fully automated |
| Tax estimation accuracy | Within 10% |

---

## Example Workflows

### New Client Onboarding
```
1. "Atlas, add a new client: John Smith from Dental Plus, email john@dentalplus.co.uk"
2. "Create a project for Dental Plus: Voice booking system, fixed price £11,000, due in 6 weeks"
3. "Add milestone: Discovery complete, due in 1 week, £1,000 payment"
4. Atlas creates client, project, milestone
5. Atlas sets follow-up reminder for kick-off call
```

### End of Week Billing
```
1. "Atlas, what unbilled time do I have?"
2. "35 hours across 3 projects"
3. "Generate invoices for all unbilled time"
4. "Created 3 invoices totaling £2,450. Send them?"
5. "Yes, send all"
6. Invoices emailed to clients, status updated to 'sent'
```

### Pipeline Review
```
1. "Atlas, show me my pipeline"
2. "You have 5 leads worth £55,000. 2 need follow-up today."
3. "Who needs follow-up?"
4. "Sarah from RealtyCorp (proposal stage) and Mike from AutoShop (contacted)"
5. "Move Sarah to negotiation, she wants to proceed"
6. "Updated. Should I schedule a contract discussion?"
```

---

This module turns Atlas into your complete business operations center. Voice-first, automated, and designed for a one-person consultancy workflow.
