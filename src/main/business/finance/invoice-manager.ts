/**
 * Atlas Desktop - Invoice Manager
 * Invoice generation, payment tracking, and reminders
 *
 * @module business/finance/invoice-manager
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { createModuleLogger } from '../../utils/logger';
import {
  Invoice,
  InvoiceStatus,
  InvoiceLineItem,
  PaymentRecord,
} from '../types';

const logger = createModuleLogger('InvoiceManager');

/**
 * Invoice Manager Events
 */
export interface InvoiceManagerEvents {
  'invoice-created': (invoice: Invoice) => void;
  'invoice-sent': (invoice: Invoice) => void;
  'payment-received': (invoice: Invoice, amount: number) => void;
  'invoice-paid': (invoice: Invoice) => void;
  'invoice-overdue': (invoice: Invoice, daysPastDue: number) => void;
}

/**
 * Invoice generation options
 */
export interface InvoiceGenerationOptions {
  clientId: string;
  projectId?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
  }>;
  dueDate?: Date;
  notes?: string;
  terms?: string;
}

/**
 * Invoice search filters
 */
export interface InvoiceSearchFilters {
  status?: InvoiceStatus[];
  clientId?: string;
  projectId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
}

/**
 * Invoice Manager
 * Handles invoicing operations for AtlasAgency
 */
export class InvoiceManager extends EventEmitter {
  private invoices: Map<string, Invoice> = new Map();
  private dataDir: string;
  private initialized = false;
  private invoiceCounter = 1000;

  // Business details (configurable)
  private businessDetails = {
    name: 'AtlasAgency',
    email: '',
    phone: '',
    address: '',
    vatNumber: '',
    bankDetails: '',
  };

  constructor() {
    super();
    this.dataDir = path.join(homedir(), '.atlas', 'business');
  }

  /**
   * Initialize the invoice manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await this.loadData();
      this.initialized = true;
      logger.info('InvoiceManager initialized', { invoiceCount: this.invoices.size });
    } catch (error) {
      logger.error('Failed to initialize InvoiceManager', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Load data from disk
   */
  private async loadData(): Promise<void> {
    const invoicesPath = path.join(this.dataDir, 'invoices.json');
    const configPath = path.join(this.dataDir, 'invoice-config.json');

    try {
      const invoicesData = await fs.readFile(invoicesPath, 'utf-8');
      const invoices = JSON.parse(invoicesData) as Invoice[];
      for (const invoice of invoices) {
        invoice.issueDate = new Date(invoice.issueDate);
        invoice.dueDate = new Date(invoice.dueDate);
        if (invoice.paidDate) invoice.paidDate = new Date(invoice.paidDate);
        invoice.createdAt = new Date(invoice.createdAt);
        invoice.updatedAt = new Date(invoice.updatedAt);
        this.invoices.set(invoice.id, invoice);

        // Update counter based on existing invoices
        const num = parseInt(invoice.invoiceNumber.replace('INV-', ''), 10);
        if (num >= this.invoiceCounter) {
          this.invoiceCounter = num + 1;
        }
      }
    } catch {
      // File doesn't exist, start fresh
    }

    try {
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      this.businessDetails = { ...this.businessDetails, ...config.businessDetails };
      if (config.invoiceCounter) this.invoiceCounter = config.invoiceCounter;
    } catch {
      // No config, use defaults
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    const invoicesPath = path.join(this.dataDir, 'invoices.json');
    const configPath = path.join(this.dataDir, 'invoice-config.json');

    await fs.writeFile(invoicesPath, JSON.stringify([...this.invoices.values()], null, 2));
    await fs.writeFile(configPath, JSON.stringify({
      businessDetails: this.businessDetails,
      invoiceCounter: this.invoiceCounter,
    }, null, 2));
  }

  /**
   * Set business details
   */
  async setBusinessDetails(details: Partial<typeof this.businessDetails>): Promise<void> {
    this.businessDetails = { ...this.businessDetails, ...details };
    await this.saveData();
  }

  /**
   * Get business details
   */
  getBusinessDetails(): typeof this.businessDetails {
    return { ...this.businessDetails };
  }

  // ============================================================
  // Invoice CRUD
  // ============================================================

  /**
   * Generate a new invoice number
   */
  private generateInvoiceNumber(): string {
    return `INV-${this.invoiceCounter++}`;
  }

  /**
   * Create a new invoice
   */
  async createInvoice(options: InvoiceGenerationOptions): Promise<Invoice> {
    const lineItems: InvoiceLineItem[] = options.lineItems.map(item => ({
      id: randomUUID(),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate || 0,
      total: item.quantity * item.unitPrice * (1 + (item.taxRate || 0) / 100),
    }));

    const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxTotal = lineItems.reduce((sum, item) => {
      const itemSubtotal = item.quantity * item.unitPrice;
      return sum + (itemSubtotal * item.taxRate / 100);
    }, 0);
    const total = subtotal + taxTotal;

    const now = new Date();
    const dueDate = options.dueDate || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // Default 14 days

    const invoice: Invoice = {
      id: randomUUID(),
      invoiceNumber: this.generateInvoiceNumber(),
      clientId: options.clientId,
      projectId: options.projectId,
      status: 'draft',
      issueDate: now,
      dueDate,
      lineItems,
      subtotal,
      taxTotal,
      total,
      amountPaid: 0,
      currency: 'GBP',
      notes: options.notes,
      terms: options.terms || 'Payment due within 14 days',
      paymentRecords: [],
      createdAt: now,
      updatedAt: now,
    };

    this.invoices.set(invoice.id, invoice);
    await this.saveData();

    this.emit('invoice-created', invoice);
    logger.info('Invoice created', { invoiceId: invoice.id, number: invoice.invoiceNumber, total });

    return invoice;
  }

  /**
   * Get an invoice by ID
   */
  getInvoice(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  /**
   * Get an invoice by number
   */
  getInvoiceByNumber(invoiceNumber: string): Invoice | undefined {
    for (const invoice of this.invoices.values()) {
      if (invoice.invoiceNumber === invoiceNumber) {
        return invoice;
      }
    }
    return undefined;
  }

  /**
   * Get all invoices
   */
  getAllInvoices(): Invoice[] {
    return [...this.invoices.values()].sort((a, b) =>
      new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
    );
  }

  /**
   * Search invoices with filters
   */
  searchInvoices(filters: InvoiceSearchFilters): Invoice[] {
    let results = [...this.invoices.values()];

    if (filters.status && filters.status.length > 0) {
      results = results.filter(i => filters.status!.includes(i.status));
    }

    if (filters.clientId) {
      results = results.filter(i => i.clientId === filters.clientId);
    }

    if (filters.projectId) {
      results = results.filter(i => i.projectId === filters.projectId);
    }

    if (filters.startDate) {
      results = results.filter(i => new Date(i.issueDate) >= filters.startDate!);
    }

    if (filters.endDate) {
      results = results.filter(i => new Date(i.issueDate) <= filters.endDate!);
    }

    if (filters.minAmount !== undefined) {
      results = results.filter(i => i.total >= filters.minAmount!);
    }

    if (filters.maxAmount !== undefined) {
      results = results.filter(i => i.total <= filters.maxAmount!);
    }

    return results.sort((a, b) =>
      new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
    );
  }

  /**
   * Get invoices for a client
   */
  getClientInvoices(clientId: string): Invoice[] {
    return this.searchInvoices({ clientId });
  }

  /**
   * Update an invoice
   */
  async updateInvoice(invoiceId: string, updates: Partial<Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt'>>): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return undefined;

    // Don't allow updates to paid invoices
    if (invoice.status === 'paid') {
      logger.warn('Cannot update paid invoice', { invoiceId });
      return undefined;
    }

    const updatedInvoice: Invoice = {
      ...invoice,
      ...updates,
      updatedAt: new Date(),
    };

    // Recalculate totals if line items changed
    if (updates.lineItems) {
      updatedInvoice.subtotal = updatedInvoice.lineItems.reduce(
        (sum, item) => sum + (item.quantity * item.unitPrice), 0
      );
      updatedInvoice.taxTotal = updatedInvoice.lineItems.reduce((sum, item) => {
        const itemSubtotal = item.quantity * item.unitPrice;
        return sum + (itemSubtotal * item.taxRate / 100);
      }, 0);
      updatedInvoice.total = updatedInvoice.subtotal + updatedInvoice.taxTotal;
    }

    this.invoices.set(invoiceId, updatedInvoice);
    await this.saveData();

    return updatedInvoice;
  }

  /**
   * Delete an invoice (only drafts)
   */
  async deleteInvoice(invoiceId: string): Promise<boolean> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'draft') {
      return false;
    }

    this.invoices.delete(invoiceId);
    await this.saveData();
    logger.info('Invoice deleted', { invoiceId });
    return true;
  }

  // ============================================================
  // Invoice Lifecycle
  // ============================================================

  /**
   * Mark invoice as sent
   */
  async markAsSent(invoiceId: string): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'draft') return undefined;

    invoice.status = 'sent';
    invoice.updatedAt = new Date();
    await this.saveData();

    this.emit('invoice-sent', invoice);
    logger.info('Invoice marked as sent', { invoiceId });

    return invoice;
  }

  /**
   * Record a payment
   */
  async recordPayment(invoiceId: string, amount: number, method?: string, reference?: string): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return undefined;

    const payment: PaymentRecord = {
      id: randomUUID(),
      amount,
      date: new Date(),
      method,
      reference,
    };

    invoice.paymentRecords.push(payment);
    invoice.amountPaid += amount;

    // Check if fully paid
    if (invoice.amountPaid >= invoice.total) {
      invoice.status = 'paid';
      invoice.paidDate = new Date();
      this.emit('invoice-paid', invoice);
      logger.info('Invoice fully paid', { invoiceId });
    } else {
      invoice.status = 'partial';
    }

    invoice.updatedAt = new Date();
    await this.saveData();

    this.emit('payment-received', invoice, amount);
    logger.info('Payment recorded', { invoiceId, amount, totalPaid: invoice.amountPaid });

    return invoice;
  }

  /**
   * Mark invoice as void
   */
  async voidInvoice(invoiceId: string): Promise<Invoice | undefined> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status === 'paid') return undefined;

    invoice.status = 'void';
    invoice.updatedAt = new Date();
    await this.saveData();

    logger.info('Invoice voided', { invoiceId });
    return invoice;
  }

  // ============================================================
  // Overdue & Reminders
  // ============================================================

  /**
   * Get overdue invoices
   */
  getOverdueInvoices(): Invoice[] {
    const now = new Date();
    return [...this.invoices.values()].filter(i =>
      (i.status === 'sent' || i.status === 'partial') &&
      new Date(i.dueDate) < now
    );
  }

  /**
   * Get invoices approaching due date
   */
  getInvoicesApproachingDue(daysAhead: number = 7): Array<{ invoice: Invoice; daysUntil: number }> {
    const results: Array<{ invoice: Invoice; daysUntil: number }> = [];
    const now = new Date();

    for (const invoice of this.invoices.values()) {
      if (invoice.status !== 'sent' && invoice.status !== 'partial') continue;

      const dueDate = new Date(invoice.dueDate);
      const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil >= 0 && daysUntil <= daysAhead) {
        results.push({ invoice, daysUntil });
      }
    }

    return results.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * Calculate days overdue for an invoice
   */
  getDaysOverdue(invoiceId: string): number {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return 0;

    const now = new Date();
    const dueDate = new Date(invoice.dueDate);
    const days = Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  }

  // ============================================================
  // Statistics & Reports
  // ============================================================

  /**
   * Get total outstanding
   */
  getTotalOutstanding(): number {
    return [...this.invoices.values()]
      .filter(i => i.status === 'sent' || i.status === 'partial')
      .reduce((sum, i) => sum + (i.total - i.amountPaid), 0);
  }

  /**
   * Get total overdue
   */
  getTotalOverdue(): number {
    return this.getOverdueInvoices()
      .reduce((sum, i) => sum + (i.total - i.amountPaid), 0);
  }

  /**
   * Get revenue for a period
   */
  getRevenueForPeriod(startDate: Date, endDate: Date): number {
    return [...this.invoices.values()]
      .filter(i =>
        i.status === 'paid' &&
        i.paidDate &&
        new Date(i.paidDate) >= startDate &&
        new Date(i.paidDate) <= endDate
      )
      .reduce((sum, i) => sum + i.total, 0);
  }

  /**
   * Get this month's revenue
   */
  getThisMonthRevenue(): number {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getRevenueForPeriod(startOfMonth, now);
  }

  /**
   * Get invoice statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<InvoiceStatus, number>;
    totalInvoiced: number;
    totalPaid: number;
    totalOutstanding: number;
    totalOverdue: number;
    thisMonthRevenue: number;
    overdueCount: number;
  } {
    const byStatus: Record<InvoiceStatus, number> = {
      draft: 0,
      sent: 0,
      paid: 0,
      partial: 0,
      overdue: 0,
      void: 0,
    };
    let totalInvoiced = 0;
    let totalPaid = 0;

    for (const invoice of this.invoices.values()) {
      byStatus[invoice.status]++;
      if (invoice.status !== 'draft' && invoice.status !== 'void') {
        totalInvoiced += invoice.total;
        totalPaid += invoice.amountPaid;
      }
    }

    const overdueInvoices = this.getOverdueInvoices();

    return {
      total: this.invoices.size,
      byStatus,
      totalInvoiced,
      totalPaid,
      totalOutstanding: this.getTotalOutstanding(),
      totalOverdue: this.getTotalOverdue(),
      thisMonthRevenue: this.getThisMonthRevenue(),
      overdueCount: overdueInvoices.length,
    };
  }

  /**
   * Generate invoice text (for PDF generation or display)
   */
  generateInvoiceText(invoiceId: string): string | undefined {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return undefined;

    const lines: string[] = [
      `INVOICE`,
      ``,
      `Invoice Number: ${invoice.invoiceNumber}`,
      `Issue Date: ${new Date(invoice.issueDate).toLocaleDateString('en-GB')}`,
      `Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-GB')}`,
      ``,
      `From:`,
      this.businessDetails.name,
      this.businessDetails.address || '',
      this.businessDetails.email || '',
      this.businessDetails.vatNumber ? `VAT: ${this.businessDetails.vatNumber}` : '',
      ``,
      `Line Items:`,
      `-`.repeat(60),
    ];

    for (const item of invoice.lineItems) {
      const itemTotal = item.quantity * item.unitPrice;
      lines.push(
        `${item.description}`,
        `  ${item.quantity} x £${item.unitPrice.toFixed(2)} = £${itemTotal.toFixed(2)}${item.taxRate > 0 ? ` (+${item.taxRate}% VAT)` : ''}`
      );
    }

    lines.push(
      `-`.repeat(60),
      ``,
      `Subtotal: £${invoice.subtotal.toFixed(2)}`,
      `VAT: £${invoice.taxTotal.toFixed(2)}`,
      `Total: £${invoice.total.toFixed(2)}`,
      ``,
      invoice.amountPaid > 0 ? `Paid: £${invoice.amountPaid.toFixed(2)}` : '',
      invoice.amountPaid > 0 ? `Balance Due: £${(invoice.total - invoice.amountPaid).toFixed(2)}` : '',
      ``,
      invoice.terms ? `Terms: ${invoice.terms}` : '',
      invoice.notes ? `Notes: ${invoice.notes}` : '',
      ``,
      this.businessDetails.bankDetails ? `Bank Details: ${this.businessDetails.bankDetails}` : '',
    );

    return lines.filter(l => l !== '').join('\n');
  }
}

// Singleton instance
let instance: InvoiceManager | null = null;

/**
 * Get the singleton Invoice Manager instance
 */
export function getInvoiceManager(): InvoiceManager {
  if (!instance) {
    instance = new InvoiceManager();
  }
  return instance;
}

/**
 * Initialize the Invoice Manager (call on app startup)
 */
export async function initializeInvoiceManager(): Promise<InvoiceManager> {
  const manager = getInvoiceManager();
  await manager.initialize();
  return manager;
}
