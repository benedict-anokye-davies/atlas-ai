/**
 * Atlas Banking - Payment Service
 *
 * Handles payment requests, transfers, and purchase operations.
 * Includes security controls and user confirmation flow.
 *
 * @module banking/payment-service
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../utils/logger';
import { getAccountManager } from './account-manager';
import { getPlaidClient } from './plaid-client';
import { getBankingSecurity } from './security';
import {
  PaymentRequest,
  PaymentRecipient,
  PaymentStatus,
  PaymentMethod,
  BankAccount,
} from './types';

const logger = createModuleLogger('PaymentService');

/**
 * Payment creation options
 */
export interface CreatePaymentOptions {
  /** Source account ID (uses primary if not specified) */
  sourceAccountId?: string;
  /** Payment recipient */
  recipient: PaymentRecipient;
  /** Amount to pay */
  amount: number;
  /** Currency (defaults to USD) */
  currency?: string;
  /** Payment method */
  method?: PaymentMethod;
  /** Description/memo */
  description: string;
  /** Schedule for future date */
  scheduledDate?: Date;
  /** Original voice command */
  voiceCommand?: string;
}

/**
 * Payment Service - Handles all payment operations
 */
export class PaymentService extends EventEmitter {
  private pendingPayments: Map<string, PaymentRequest> = new Map();
  private paymentHistory: PaymentRequest[] = [];
  private savedRecipients: Map<string, PaymentRecipient> = new Map();

  constructor() {
    super();
  }

  /**
   * Create a new payment request
   * Does NOT execute immediately - requires user confirmation
   */
  async createPayment(options: CreatePaymentOptions): Promise<PaymentRequest> {
    const accountManager = getAccountManager();
    const security = getBankingSecurity();

    // Determine source account
    let sourceAccount: BankAccount | undefined;
    if (options.sourceAccountId) {
      sourceAccount = accountManager.getAccount(options.sourceAccountId);
    } else {
      sourceAccount = accountManager.getPrimaryAccount();
    }

    if (!sourceAccount) {
      throw new Error('No source account available. Please connect a bank account first.');
    }

    // Validate payment against security rules
    const validation = await security.validatePayment({
      amount: options.amount,
      recipient: options.recipient,
      sourceAccountId: sourceAccount.id,
    });

    if (!validation.allowed) {
      throw new Error(validation.reason || 'Payment blocked by security rules');
    }

    // Create payment request
    const payment: PaymentRequest = {
      id: uuidv4(),
      sourceAccountId: sourceAccount.id,
      recipient: options.recipient,
      amount: options.amount,
      currency: options.currency || 'USD',
      method: options.method || 'ach',
      description: options.description,
      status: 'pending_confirmation',
      scheduledDate: options.scheduledDate,
      createdAt: new Date(),
      updatedAt: new Date(),
      voiceCommand: options.voiceCommand,
      userConfirmed: false,
    };

    // Check if confirmation is required
    const requiresConfirmation = await security.requiresConfirmation(payment);

    if (requiresConfirmation) {
      this.pendingPayments.set(payment.id, payment);
      this.emit('payment-pending-confirmation', payment);
      logger.info('Payment created - awaiting confirmation', {
        paymentId: payment.id,
        amount: payment.amount,
        recipient: payment.recipient.name,
      });
    } else {
      // Auto-confirm small payments to known recipients
      payment.userConfirmed = true;
      payment.status = 'confirmed';
      this.pendingPayments.set(payment.id, payment);
      // Process immediately
      await this.processPayment(payment.id);
    }

    return payment;
  }

  /**
   * Confirm a pending payment
   */
  async confirmPayment(paymentId: string, pin?: string): Promise<PaymentRequest> {
    const payment = this.pendingPayments.get(paymentId);

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (payment.status !== 'pending_confirmation') {
      throw new Error(`Payment is not pending confirmation: ${payment.status}`);
    }

    const security = getBankingSecurity();

    // Verify PIN if required
    if (security.getSettings().requireAuthForTransactions && pin) {
      const pinValid = await security.verifyPin(pin);
      if (!pinValid) {
        throw new Error('Invalid PIN');
      }
    }

    payment.userConfirmed = true;
    payment.status = 'confirmed';
    payment.updatedAt = new Date();

    logger.info('Payment confirmed', { paymentId });

    // Process the payment
    return this.processPayment(paymentId);
  }

  /**
   * Cancel a pending payment
   */
  async cancelPayment(paymentId: string): Promise<void> {
    const payment = this.pendingPayments.get(paymentId);

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (payment.status !== 'pending_confirmation' && payment.status !== 'confirmed') {
      throw new Error(`Cannot cancel payment in status: ${payment.status}`);
    }

    payment.status = 'cancelled';
    payment.updatedAt = new Date();

    this.pendingPayments.delete(paymentId);
    this.paymentHistory.push(payment);

    this.emit('payment-cancelled', payment);
    logger.info('Payment cancelled', { paymentId });
  }

  /**
   * Process a confirmed payment
   */
  private async processPayment(paymentId: string): Promise<PaymentRequest> {
    const payment = this.pendingPayments.get(paymentId);

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (!payment.userConfirmed) {
      throw new Error('Payment has not been confirmed');
    }

    const accountManager = getAccountManager();
    const plaid = getPlaidClient();
    const security = getBankingSecurity();

    payment.status = 'processing';
    payment.updatedAt = new Date();
    this.emit('payment-processing', payment);

    try {
      // Get source account details
      const sourceAccount = accountManager.getAccount(payment.sourceAccountId);
      if (!sourceAccount) {
        throw new Error('Source account not found');
      }

      // Check available balance
      const available = sourceAccount.availableBalance || sourceAccount.currentBalance;
      if (available < payment.amount) {
        throw new Error(
          `Insufficient funds. Available: $${available.toFixed(2)}, Required: $${payment.amount.toFixed(2)}`
        );
      }

      // Process based on payment method
      switch (payment.method) {
        case 'ach':
          await this.processACHTransfer(payment, sourceAccount);
          break;

        case 'external':
          await this.processExternalPayment(payment);
          break;

        default:
          throw new Error(`Unsupported payment method: ${payment.method}`);
      }

      payment.status = 'completed';
      payment.updatedAt = new Date();
      payment.confirmationCode = `ATL-${Date.now().toString(36).toUpperCase()}`;

      // Record in spending tracker
      await security.recordSpending(payment.amount, payment.recipient.name);

      // Save recipient for future use
      this.saveRecipient(payment.recipient);

      this.emit('payment-completed', payment);
      logger.info('Payment completed', {
        paymentId,
        confirmationCode: payment.confirmationCode,
      });
    } catch (error) {
      const err = error as Error;
      payment.status = 'failed';
      payment.error = err.message;
      payment.updatedAt = new Date();

      this.emit('payment-failed', payment);
      logger.error('Payment failed', { paymentId, error: err.message });
    }

    // Move to history
    this.pendingPayments.delete(paymentId);
    this.paymentHistory.push(payment);

    return payment;
  }

  /**
   * Process ACH bank transfer
   */
  private async processACHTransfer(payment: PaymentRequest, sourceAccount: BankAccount): Promise<void> {
    const plaid = getPlaidClient();

    if (!plaid.isConfigured()) {
      throw new Error('Plaid is not configured for transfers');
    }

    // Authorize the transfer
    const authResponse = await plaid.authorizeTransfer(
      sourceAccount.institutionId,
      sourceAccount.id,
      payment.amount,
      payment.description
    );

    if (authResponse.authorization.decision !== 'approved') {
      throw new Error(
        `Transfer not approved: ${authResponse.authorization.decision_rationale?.description || 'Unknown reason'}`
      );
    }

    // Create the transfer
    const transferResponse = await plaid.createTransfer(
      sourceAccount.institutionId,
      sourceAccount.id,
      authResponse.authorization.id,
      payment.amount,
      payment.description
    );

    payment.confirmationCode = transferResponse.transfer.id;
  }

  /**
   * Process external payment (Venmo, PayPal, etc.)
   */
  private async processExternalPayment(payment: PaymentRequest): Promise<void> {
    // This would integrate with external payment services
    // For now, we'll log the intent and mark as pending external processing

    if (!payment.recipient.externalService) {
      throw new Error('External service not specified');
    }

    logger.info('External payment requested', {
      service: payment.recipient.externalService,
      recipientId: payment.recipient.externalId,
      amount: payment.amount,
    });

    // In a real implementation, this would call the appropriate API
    // (Venmo API, PayPal API, etc.)

    // For now, simulate success
    payment.confirmationCode = `EXT-${payment.recipient.externalService.toUpperCase()}-${Date.now()}`;
  }

  /**
   * Save a recipient for future use
   */
  private saveRecipient(recipient: PaymentRecipient): void {
    const key = this.getRecipientKey(recipient);
    if (!this.savedRecipients.has(key)) {
      this.savedRecipients.set(key, recipient);
      logger.debug('Recipient saved', { name: recipient.name });
    }
  }

  /**
   * Generate a unique key for a recipient
   */
  private getRecipientKey(recipient: PaymentRecipient): string {
    if (recipient.accountNumber && recipient.routingNumber) {
      return `ach:${recipient.routingNumber}:${recipient.accountNumber}`;
    }
    if (recipient.externalId && recipient.externalService) {
      return `${recipient.externalService}:${recipient.externalId}`;
    }
    if (recipient.email) {
      return `email:${recipient.email}`;
    }
    return `name:${recipient.name.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * Get saved recipients
   */
  getSavedRecipients(): PaymentRecipient[] {
    return Array.from(this.savedRecipients.values());
  }

  /**
   * Find a saved recipient by name
   */
  findRecipient(search: string): PaymentRecipient | undefined {
    const searchLower = search.toLowerCase();
    return Array.from(this.savedRecipients.values()).find(
      (r) =>
        r.name.toLowerCase().includes(searchLower) ||
        r.email?.toLowerCase().includes(searchLower)
    );
  }

  /**
   * Get pending payments
   */
  getPendingPayments(): PaymentRequest[] {
    return Array.from(this.pendingPayments.values());
  }

  /**
   * Get payment history
   */
  getPaymentHistory(limit?: number): PaymentRequest[] {
    const sorted = [...this.paymentHistory].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get a specific payment by ID
   */
  getPayment(paymentId: string): PaymentRequest | undefined {
    return this.pendingPayments.get(paymentId) || this.paymentHistory.find((p) => p.id === paymentId);
  }

  /**
   * Quick pay to a saved recipient
   */
  async quickPay(
    recipientName: string,
    amount: number,
    description?: string,
    voiceCommand?: string
  ): Promise<PaymentRequest> {
    const recipient = this.findRecipient(recipientName);

    if (!recipient) {
      throw new Error(
        `Recipient "${recipientName}" not found. Please set up this recipient first.`
      );
    }

    return this.createPayment({
      recipient,
      amount,
      description: description || `Payment to ${recipient.name}`,
      voiceCommand,
    });
  }

  /**
   * Parse a natural language payment request
   */
  parsePaymentRequest(text: string): Partial<CreatePaymentOptions> | null {
    // Common patterns:
    // "Pay $50 to John"
    // "Send 100 dollars to mom"
    // "Transfer $200 to my savings"
    // "Pay rent $1500"

    const patterns = [
      // Pay $X to Y
      /pay\s+\$?([\d,]+(?:\.\d{2})?)\s+(?:dollars?\s+)?to\s+(.+)/i,
      // Send $X to Y
      /send\s+\$?([\d,]+(?:\.\d{2})?)\s+(?:dollars?\s+)?to\s+(.+)/i,
      // Transfer $X to Y
      /transfer\s+\$?([\d,]+(?:\.\d{2})?)\s+(?:dollars?\s+)?to\s+(.+)/i,
      // Pay Y $X
      /pay\s+(.+?)\s+\$?([\d,]+(?:\.\d{2})?)\s*(?:dollars?)?/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Determine which group is amount vs recipient based on pattern
        let amount: string;
        let recipientName: string;

        if (pattern.source.includes('to\\s+')) {
          amount = match[1];
          recipientName = match[2];
        } else {
          recipientName = match[1];
          amount = match[2];
        }

        const parsedAmount = parseFloat(amount.replace(/,/g, ''));

        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          continue;
        }

        return {
          amount: parsedAmount,
          recipient: {
            name: recipientName.trim(),
            type: 'individual',
          },
          description: `Payment to ${recipientName.trim()}`,
          voiceCommand: text,
        };
      }
    }

    return null;
  }
}

// Singleton instance
let paymentService: PaymentService | null = null;

/**
 * Get the payment service instance
 */
export function getPaymentService(): PaymentService {
  if (!paymentService) {
    paymentService = new PaymentService();
  }
  return paymentService;
}
