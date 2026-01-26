/**
 * Atlas Desktop - Email Integration
 *
 * Provides email functionality for Gmail and Outlook including:
 * - Reading and summarizing emails
 * - Composing and sending emails via voice
 * - Searching emails by sender/subject/content
 * - Handling attachments
 * - Local processing for privacy
 *
 * @module integrations/email
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { withRetry } from '../utils/errors';
import { isoDate } from '../../shared/utils';
import {
  EmailAuthManager,
  getEmailAuthManager,
  EmailAccount,
  EmailProvider,
  EmailAuthConfig,
} from './email-auth';

const logger = createModuleLogger('Email');

// ============================================================================
// Types
// ============================================================================

export interface Email {
  id: string;
  threadId: string;
  provider: EmailProvider;
  accountId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  snippet: string;
  body: EmailBody;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  labels: string[];
  hasAttachments: boolean;
  attachments: EmailAttachment[];
  inReplyTo?: string;
  references?: string[];
}

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailBody {
  plain: string;
  html?: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
}

export interface EmailDraft {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: EmailAttachmentDraft[];
  inReplyTo?: string;
  threadId?: string;
}

export interface EmailAttachmentDraft {
  filename: string;
  content: Buffer | string;
  mimeType: string;
  contentId?: string;
  isInline?: boolean;
}

export interface EmailSearchOptions {
  query?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  after?: Date;
  before?: Date;
  labels?: string[];
  maxResults?: number;
}

export interface EmailSummary {
  email: Email;
  summary: string;
  keyPoints: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  priority: 'high' | 'medium' | 'low';
  suggestedAction?: string;
}

export interface UnreadSummary {
  totalUnread: number;
  byPriority: {
    high: EmailSummary[];
    medium: EmailSummary[];
    low: EmailSummary[];
  };
  bySender: Map<string, Email[]>;
  overallSummary: string;
}

// ============================================================================
// Gmail API Helpers
// ============================================================================

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailMessagePayload;
  internalDate: string;
}

interface GmailMessagePayload {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Array<{ name: string; value: string }>;
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePayload[];
}

/**
 * Parse Gmail message to our Email format
 */
function parseGmailMessage(message: GmailMessage, accountId: string): Email {
  const headers = message.payload.headers;
  const getHeader = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const from = parseEmailAddress(getHeader('From'));
  const to = parseEmailAddresses(getHeader('To'));
  const cc = parseEmailAddresses(getHeader('Cc'));
  const subject = getHeader('Subject');
  const date = parseInt(message.internalDate, 10);

  // Extract body
  const body = extractGmailBody(message.payload);

  // Extract attachments
  const attachments = extractGmailAttachments(message.payload);

  return {
    id: message.id,
    threadId: message.threadId,
    provider: 'gmail',
    accountId,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    snippet: message.snippet,
    body,
    date,
    isRead: !message.labelIds.includes('UNREAD'),
    isStarred: message.labelIds.includes('STARRED'),
    labels: message.labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    inReplyTo: getHeader('In-Reply-To') || undefined,
    references: getHeader('References')?.split(/\s+/).filter(Boolean),
  };
}

/**
 * Extract body from Gmail message payload
 */
function extractGmailBody(payload: GmailMessagePayload): EmailBody {
  let plain = '';
  let html: string | undefined;

  function extractPart(part: GmailMessagePayload): void {
    if (part.mimeType === 'text/plain' && part.body.data) {
      plain = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body.data) {
      html = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      for (const subPart of part.parts) {
        extractPart(subPart);
      }
    }
  }

  extractPart(payload);

  // If no plain text, strip HTML tags
  if (!plain && html) {
    plain = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { plain, html };
}

/**
 * Extract attachments from Gmail message payload
 */
function extractGmailAttachments(payload: GmailMessagePayload): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  function extractPart(part: GmailMessagePayload): void {
    if (part.filename && part.body.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
        contentId: part.headers?.find((h) => h.name === 'Content-ID')?.value,
        isInline: part.headers?.some(
          (h) => h.name === 'Content-Disposition' && h.value.includes('inline')
        ) || false,
      });
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        extractPart(subPart);
      }
    }
  }

  extractPart(payload);
  return attachments;
}

// ============================================================================
// Microsoft Graph API Helpers
// ============================================================================

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface OutlookMessage {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  ccRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  isRead: boolean;
  flag: { flagStatus: string };
  hasAttachments: boolean;
  attachments?: OutlookAttachment[];
  inReplyTo?: { id: string };
}

interface OutlookAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
}

/**
 * Parse Outlook message to our Email format
 */
function parseOutlookMessage(message: OutlookMessage, accountId: string): Email {
  const from: EmailAddress = {
    name: message.from?.emailAddress?.name,
    email: message.from?.emailAddress?.address || '',
  };

  const to = message.toRecipients?.map((r) => ({
    name: r.emailAddress.name,
    email: r.emailAddress.address,
  })) || [];

  const cc = message.ccRecipients?.map((r) => ({
    name: r.emailAddress.name,
    email: r.emailAddress.address,
  }));

  const body: EmailBody = {
    plain:
      message.body.contentType === 'text'
        ? message.body.content
        : stripHtml(message.body.content),
    html: message.body.contentType === 'html' ? message.body.content : undefined,
  };

  const attachments = (message.attachments || []).map((a) => ({
    id: a.id,
    filename: a.name,
    mimeType: a.contentType,
    size: a.size,
    contentId: a.contentId,
    isInline: a.isInline,
  }));

  return {
    id: message.id,
    threadId: message.conversationId,
    provider: 'outlook',
    accountId,
    from,
    to,
    cc: cc && cc.length > 0 ? cc : undefined,
    subject: message.subject,
    snippet: message.bodyPreview,
    body,
    date: new Date(message.receivedDateTime).getTime(),
    isRead: message.isRead,
    isStarred: message.flag?.flagStatus === 'flagged',
    labels: [],
    hasAttachments: message.hasAttachments,
    attachments,
    inReplyTo: message.inReplyTo?.id,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse email address string to EmailAddress object
 */
function parseEmailAddress(str: string): EmailAddress {
  const match = str.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
  if (match) {
    return {
      name: match[1]?.trim() || undefined,
      email: match[2].trim(),
    };
  }
  return { email: str.trim() };
}

/**
 * Parse multiple email addresses
 */
function parseEmailAddresses(str: string): EmailAddress[] {
  if (!str) return [];
  return str.split(',').map((s) => parseEmailAddress(s.trim()));
}

/**
 * Format email address for sending
 */
function formatEmailAddress(addr: EmailAddress): string {
  if (addr.name) {
    return `"${addr.name}" <${addr.email}>`;
  }
  return addr.email;
}

/**
 * Strip HTML tags from content
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Local email prioritization based on keywords and patterns
 * This runs entirely locally for privacy
 */
function analyzePriority(email: Email): 'high' | 'medium' | 'low' {
  const text = `${email.subject} ${email.snippet}`.toLowerCase();

  // High priority indicators
  const highPriorityKeywords = [
    'urgent',
    'asap',
    'immediately',
    'critical',
    'emergency',
    'deadline',
    'action required',
    'time sensitive',
    'important',
    'priority',
  ];

  if (highPriorityKeywords.some((kw) => text.includes(kw))) {
    return 'high';
  }

  // Medium priority: direct emails, meeting requests
  const mediumPriorityPatterns = [
    'meeting',
    'calendar',
    'schedule',
    'review',
    'feedback',
    'question',
    'request',
  ];

  if (mediumPriorityPatterns.some((p) => text.includes(p))) {
    return 'medium';
  }

  // Low priority: newsletters, notifications
  const lowPriorityPatterns = [
    'unsubscribe',
    'newsletter',
    'notification',
    'digest',
    'weekly',
    'monthly',
    'no-reply',
    'noreply',
  ];

  if (lowPriorityPatterns.some((p) => text.includes(p))) {
    return 'low';
  }

  return 'medium';
}

/**
 * Local sentiment analysis (basic heuristic-based)
 * Runs entirely locally for privacy
 */
function analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  const lowerText = text.toLowerCase();

  const positiveWords = [
    'thank',
    'great',
    'excellent',
    'good',
    'happy',
    'pleased',
    'appreciate',
    'wonderful',
    'fantastic',
    'congrat',
    'success',
    'approved',
  ];

  const negativeWords = [
    'sorry',
    'unfortunately',
    'problem',
    'issue',
    'concern',
    'disappointed',
    'fail',
    'error',
    'urgent',
    'complaint',
    'reject',
    'denied',
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of positiveWords) {
    if (lowerText.includes(word)) positiveCount++;
  }

  for (const word of negativeWords) {
    if (lowerText.includes(word)) negativeCount++;
  }

  if (positiveCount > negativeCount + 1) return 'positive';
  if (negativeCount > positiveCount + 1) return 'negative';
  return 'neutral';
}

/**
 * Generate local summary of email content
 * Uses extractive summarization (first few sentences) for privacy
 */
function generateLocalSummary(email: Email): string {
  const text = email.body.plain;
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  // Take first 2-3 sentences as summary
  const summaryParts = sentences.slice(0, 3);

  if (summaryParts.length === 0) {
    return email.snippet;
  }

  return summaryParts.join('. ') + '.';
}

/**
 * Extract key points from email (local processing)
 */
function extractKeyPoints(email: Email): string[] {
  const text = email.body.plain;
  const keyPoints: string[] = [];

  // Look for bullet points or numbered items
  const bulletMatches = text.match(/^[\s]*[-*\u2022]\s+.+$/gm);
  if (bulletMatches) {
    keyPoints.push(...bulletMatches.slice(0, 5).map((m) => m.trim().replace(/^[-*\u2022]\s+/, '')));
  }

  // Look for numbered lists
  const numberedMatches = text.match(/^\s*\d+[.)]\s+.+$/gm);
  if (numberedMatches) {
    keyPoints.push(
      ...numberedMatches.slice(0, 5).map((m) => m.trim().replace(/^\d+[.)]\s+/, ''))
    );
  }

  // If no lists found, extract key sentences
  if (keyPoints.length === 0) {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    // Look for action-oriented sentences
    const actionSentences = sentences.filter(
      (s) =>
        s.toLowerCase().includes('please') ||
        s.toLowerCase().includes('need') ||
        s.toLowerCase().includes('would') ||
        s.toLowerCase().includes('should')
    );
    keyPoints.push(...actionSentences.slice(0, 3).map((s) => s.trim()));
  }

  return keyPoints;
}

/**
 * Suggest action based on email content (local processing)
 */
function suggestAction(email: Email): string | undefined {
  const text = `${email.subject} ${email.body.plain}`.toLowerCase();

  if (text.includes('rsvp') || text.includes('confirm your attendance')) {
    return 'Respond to confirm attendance';
  }

  if (text.includes('please reply') || text.includes('let me know')) {
    return 'Reply needed';
  }

  if (text.includes('review') || text.includes('feedback')) {
    return 'Review and provide feedback';
  }

  if (text.includes('sign') || text.includes('signature required')) {
    return 'Document requires signature';
  }

  if (text.includes('payment') || text.includes('invoice')) {
    return 'Review payment/invoice';
  }

  return undefined;
}

// ============================================================================
// EmailManager Class
// ============================================================================

/**
 * Email Integration Manager
 *
 * Provides comprehensive email functionality including:
 * - Reading and summarizing emails
 * - Composing and sending emails
 * - Searching emails
 * - Managing attachments
 */
export class EmailManager extends EventEmitter {
  private static instance: EmailManager | null = null;
  private authManager: EmailAuthManager;
  private initialized = false;
  private emailCache: Map<string, Email> = new Map();
  private cacheTimeout = 60000; // 1 minute cache

  private constructor() {
    super();
    this.authManager = getEmailAuthManager();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EmailManager {
    if (!EmailManager.instance) {
      EmailManager.instance = new EmailManager();
    }
    return EmailManager.instance;
  }

  /**
   * Initialize the email manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.authManager.initialize();
      this.initialized = true;
      logger.info('Email manager initialized', {
        accountCount: this.authManager.getAccounts().length,
      });
    } catch (error) {
      logger.error('Failed to initialize email manager', { error });
      throw error;
    }
  }

  /**
   * Connect a new email account
   */
  async connectAccount(config: EmailAuthConfig): Promise<EmailAccount> {
    logger.info('Connecting email account', { provider: config.provider });
    return this.authManager.authenticate(config);
  }

  /**
   * Disconnect an email account
   */
  async disconnectAccount(accountId: string): Promise<void> {
    await this.authManager.removeAccount(accountId);

    // Clear cache for this account
    for (const [key, email] of this.emailCache) {
      if (email.accountId === accountId) {
        this.emailCache.delete(key);
      }
    }

    logger.info('Email account disconnected', { accountId });
  }

  /**
   * Get connected accounts
   */
  getAccounts(): EmailAccount[] {
    return this.authManager.getAccounts();
  }

  /**
   * Get default account
   */
  getDefaultAccount(): EmailAccount | null {
    return this.authManager.getDefaultAccount();
  }

  /**
   * Set default account
   */
  setDefaultAccount(accountId: string): boolean {
    return this.authManager.setDefaultAccount(accountId);
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  // ============================================================================
  // Email Reading
  // ============================================================================

  /**
   * Get unread emails
   */
  async getUnreadEmails(
    accountId?: string,
    maxResults: number = 20
  ): Promise<Email[]> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      return this.getGmailEmails(account.id, accessToken, {
        isUnread: true,
        maxResults,
      });
    } else {
      return this.getOutlookEmails(account.id, accessToken, {
        isUnread: true,
        maxResults,
      });
    }
  }

  /**
   * Get emails with search options
   */
  async searchEmails(
    options: EmailSearchOptions,
    accountId?: string
  ): Promise<Email[]> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      return this.getGmailEmails(account.id, accessToken, options);
    } else {
      return this.getOutlookEmails(account.id, accessToken, options);
    }
  }

  /**
   * Get a specific email by ID
   */
  async getEmail(emailId: string, accountId?: string): Promise<Email | null> {
    // Check cache first
    const cacheKey = `${accountId || 'default'}_${emailId}`;
    const cached = this.emailCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    let email: Email | null = null;

    if (account.provider === 'gmail') {
      email = await this.getGmailEmail(account.id, accessToken, emailId);
    } else {
      email = await this.getOutlookEmail(account.id, accessToken, emailId);
    }

    if (email) {
      this.emailCache.set(cacheKey, email);
      setTimeout(() => this.emailCache.delete(cacheKey), this.cacheTimeout);
    }

    return email;
  }

  /**
   * Get Gmail emails
   */
  private async getGmailEmails(
    accountId: string,
    accessToken: string,
    options: EmailSearchOptions
  ): Promise<Email[]> {
    const query = this.buildGmailQuery(options);
    const maxResults = options.maxResults || 20;

    const listUrl = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    listUrl.searchParams.set('maxResults', maxResults.toString());
    if (query) {
      listUrl.searchParams.set('q', query);
    }

    const listResponse = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to fetch Gmail messages: ${listResponse.status}`);
    }

    const listData = await listResponse.json();
    const messageIds = listData.messages || [];

    // Fetch full messages
    const emails: Email[] = [];
    for (const msg of messageIds) {
      const email = await this.getGmailEmail(accountId, accessToken, msg.id);
      if (email) {
        emails.push(email);
      }
    }

    return emails;
  }

  /**
   * Get single Gmail email
   */
  private async getGmailEmail(
    accountId: string,
    accessToken: string,
    messageId: string
  ): Promise<Email | null> {
    const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`;

    const response = await withRetry(
      () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      { maxAttempts: 3 }
    );

    if (!response.ok) {
      logger.error('Failed to fetch Gmail message', { messageId, status: response.status });
      return null;
    }

    const message: GmailMessage = await response.json();
    return parseGmailMessage(message, accountId);
  }

  /**
   * Build Gmail search query
   */
  private buildGmailQuery(options: EmailSearchOptions): string {
    const parts: string[] = [];

    if (options.query) {
      parts.push(options.query);
    }
    if (options.from) {
      parts.push(`from:${options.from}`);
    }
    if (options.to) {
      parts.push(`to:${options.to}`);
    }
    if (options.subject) {
      parts.push(`subject:${options.subject}`);
    }
    if (options.isUnread) {
      parts.push('is:unread');
    }
    if (options.isStarred) {
      parts.push('is:starred');
    }
    if (options.hasAttachment) {
      parts.push('has:attachment');
    }
    if (options.after) {
      parts.push(`after:${isoDate(options.after)}`);
    }
    if (options.before) {
      parts.push(`before:${isoDate(options.before)}`);
    }
    if (options.labels) {
      for (const label of options.labels) {
        parts.push(`label:${label}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Get Outlook emails
   */
  private async getOutlookEmails(
    accountId: string,
    accessToken: string,
    options: EmailSearchOptions
  ): Promise<Email[]> {
    const url = new URL(`${GRAPH_API_BASE}/me/messages`);
    url.searchParams.set('$top', (options.maxResults || 20).toString());
    url.searchParams.set('$select', 'id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,hasAttachments');
    url.searchParams.set('$expand', 'attachments($select=id,name,contentType,size,contentId,isInline)');

    const filters = this.buildOutlookFilter(options);
    if (filters) {
      url.searchParams.set('$filter', filters);
    }

    if (options.query) {
      url.searchParams.set('$search', `"${options.query}"`);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Outlook messages: ${response.status}`);
    }

    const data = await response.json();
    return (data.value || []).map((msg: OutlookMessage) =>
      parseOutlookMessage(msg, accountId)
    );
  }

  /**
   * Get single Outlook email
   */
  private async getOutlookEmail(
    accountId: string,
    accessToken: string,
    messageId: string
  ): Promise<Email | null> {
    const url = `${GRAPH_API_BASE}/me/messages/${messageId}?$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,flag,hasAttachments&$expand=attachments`;

    const response = await withRetry(
      () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      { maxAttempts: 3 }
    );

    if (!response.ok) {
      logger.error('Failed to fetch Outlook message', { messageId, status: response.status });
      return null;
    }

    const message: OutlookMessage = await response.json();
    return parseOutlookMessage(message, accountId);
  }

  /**
   * Build Outlook OData filter
   */
  private buildOutlookFilter(options: EmailSearchOptions): string {
    const filters: string[] = [];

    if (options.isUnread) {
      filters.push('isRead eq false');
    }
    if (options.from) {
      filters.push(`from/emailAddress/address eq '${options.from}'`);
    }
    if (options.hasAttachment) {
      filters.push('hasAttachments eq true');
    }
    if (options.after) {
      filters.push(`receivedDateTime ge ${options.after.toISOString()}`);
    }
    if (options.before) {
      filters.push(`receivedDateTime le ${options.before.toISOString()}`);
    }

    return filters.join(' and ');
  }

  // ============================================================================
  // Email Summarization (Local Processing)
  // ============================================================================

  /**
   * Summarize a single email locally
   */
  summarizeEmail(email: Email): EmailSummary {
    return {
      email,
      summary: generateLocalSummary(email),
      keyPoints: extractKeyPoints(email),
      sentiment: analyzeSentiment(email.body.plain),
      priority: analyzePriority(email),
      suggestedAction: suggestAction(email),
    };
  }

  /**
   * Get summary of all unread emails
   */
  async getUnreadSummary(accountId?: string): Promise<UnreadSummary> {
    const emails = await this.getUnreadEmails(accountId, 50);

    const summaries = emails.map((email) => this.summarizeEmail(email));

    const byPriority = {
      high: summaries.filter((s) => s.priority === 'high'),
      medium: summaries.filter((s) => s.priority === 'medium'),
      low: summaries.filter((s) => s.priority === 'low'),
    };

    const bySender = new Map<string, Email[]>();
    for (const email of emails) {
      const sender = email.from.email;
      if (!bySender.has(sender)) {
        bySender.set(sender, []);
      }
      bySender.get(sender)!.push(email);
    }

    let overallSummary = `You have ${emails.length} unread email${emails.length !== 1 ? 's' : ''}.`;

    if (byPriority.high.length > 0) {
      overallSummary += ` ${byPriority.high.length} appear${byPriority.high.length !== 1 ? '' : 's'} to be high priority.`;
    }

    const topSenders = Array.from(bySender.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);

    if (topSenders.length > 0) {
      const senderNames = topSenders.map(
        ([email, emails]) => `${email.split('@')[0]} (${emails.length})`
      );
      overallSummary += ` Most emails are from: ${senderNames.join(', ')}.`;
    }

    return {
      totalUnread: emails.length,
      byPriority,
      bySender,
      overallSummary,
    };
  }

  // ============================================================================
  // Email Composition and Sending
  // ============================================================================

  /**
   * Send an email
   */
  async sendEmail(draft: EmailDraft, accountId?: string): Promise<string> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    logger.info('Sending email', {
      provider: account.provider,
      to: draft.to.map((t) => t.email),
      subject: draft.subject,
    });

    if (account.provider === 'gmail') {
      return this.sendGmailEmail(accessToken, draft, account);
    } else {
      return this.sendOutlookEmail(accessToken, draft);
    }
  }

  /**
   * Send email via Gmail
   */
  private async sendGmailEmail(
    accessToken: string,
    draft: EmailDraft,
    account: EmailAccount
  ): Promise<string> {
    // Build MIME message
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const hasAttachments = draft.attachments && draft.attachments.length > 0;

    let message = '';

    // Headers
    message += `From: ${account.email}\r\n`;
    message += `To: ${draft.to.map(formatEmailAddress).join(', ')}\r\n`;
    if (draft.cc && draft.cc.length > 0) {
      message += `Cc: ${draft.cc.map(formatEmailAddress).join(', ')}\r\n`;
    }
    if (draft.bcc && draft.bcc.length > 0) {
      message += `Bcc: ${draft.bcc.map(formatEmailAddress).join(', ')}\r\n`;
    }
    message += `Subject: ${draft.subject}\r\n`;
    message += `MIME-Version: 1.0\r\n`;

    if (draft.inReplyTo) {
      message += `In-Reply-To: ${draft.inReplyTo}\r\n`;
      message += `References: ${draft.inReplyTo}\r\n`;
    }

    if (hasAttachments) {
      message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
      message += `--${boundary}\r\n`;
    }

    // Body
    const contentType = draft.isHtml ? 'text/html' : 'text/plain';
    message += `Content-Type: ${contentType}; charset=utf-8\r\n`;
    message += `Content-Transfer-Encoding: base64\r\n\r\n`;
    message += Buffer.from(draft.body).toString('base64') + '\r\n';

    // Attachments
    if (hasAttachments) {
      for (const attachment of draft.attachments!) {
        message += `--${boundary}\r\n`;
        message += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
        message += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        message += `Content-Transfer-Encoding: base64\r\n`;
        if (attachment.contentId) {
          message += `Content-ID: <${attachment.contentId}>\r\n`;
        }
        message += '\r\n';

        const content =
          typeof attachment.content === 'string'
            ? attachment.content
            : attachment.content.toString('base64');
        message += content + '\r\n';
      }
      message += `--${boundary}--\r\n`;
    }

    // Encode message
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send
    const url = draft.threadId
      ? `${GMAIL_API_BASE}/users/me/messages/send?threadId=${draft.threadId}`
      : `${GMAIL_API_BASE}/users/me/messages/send`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send Gmail: ${response.status} - ${error}`);
    }

    const result = await response.json();
    logger.info('Gmail sent successfully', { messageId: result.id });
    return result.id;
  }

  /**
   * Send email via Outlook
   */
  private async sendOutlookEmail(
    accessToken: string,
    draft: EmailDraft
  ): Promise<string> {
    const message: Record<string, unknown> = {
      subject: draft.subject,
      body: {
        contentType: draft.isHtml ? 'HTML' : 'Text',
        content: draft.body,
      },
      toRecipients: draft.to.map((addr) => ({
        emailAddress: { address: addr.email, name: addr.name },
      })),
    };

    if (draft.cc && draft.cc.length > 0) {
      message.ccRecipients = draft.cc.map((addr) => ({
        emailAddress: { address: addr.email, name: addr.name },
      }));
    }

    if (draft.bcc && draft.bcc.length > 0) {
      message.bccRecipients = draft.bcc.map((addr) => ({
        emailAddress: { address: addr.email, name: addr.name },
      }));
    }

    // Create draft first if there are attachments
    if (draft.attachments && draft.attachments.length > 0) {
      // Create message
      const createResponse = await fetch(`${GRAPH_API_BASE}/me/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create Outlook draft: ${createResponse.status}`);
      }

      const createdMessage = await createResponse.json();

      // Add attachments
      for (const attachment of draft.attachments) {
        const attachmentData = {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.filename,
          contentType: attachment.mimeType,
          contentBytes:
            typeof attachment.content === 'string'
              ? attachment.content
              : attachment.content.toString('base64'),
          isInline: attachment.isInline || false,
        };

        if (attachment.contentId) {
          (attachmentData as Record<string, unknown>).contentId = attachment.contentId;
        }

        await fetch(
          `${GRAPH_API_BASE}/me/messages/${createdMessage.id}/attachments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(attachmentData),
          }
        );
      }

      // Send the message
      const sendResponse = await fetch(
        `${GRAPH_API_BASE}/me/messages/${createdMessage.id}/send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!sendResponse.ok) {
        throw new Error(`Failed to send Outlook email: ${sendResponse.status}`);
      }

      logger.info('Outlook email sent successfully', { messageId: createdMessage.id });
      return createdMessage.id;
    }

    // Direct send without attachments
    const response = await fetch(`${GRAPH_API_BASE}/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send Outlook email: ${response.status} - ${error}`);
    }

    logger.info('Outlook email sent successfully');
    return 'sent'; // Microsoft doesn't return message ID for direct send
  }

  /**
   * Reply to an email
   */
  async replyToEmail(
    emailId: string,
    body: string,
    replyAll: boolean = false,
    accountId?: string
  ): Promise<string> {
    const email = await this.getEmail(emailId, accountId);
    if (!email) {
      throw new Error('Email not found');
    }

    const recipients = replyAll
      ? [email.from, ...(email.to || []), ...(email.cc || [])]
      : [email.from];

    // Remove duplicates and own email
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    const uniqueRecipients = recipients.filter(
      (r, i, arr) =>
        arr.findIndex((x) => x.email === r.email) === i &&
        r.email !== account?.email
    );

    const draft: EmailDraft = {
      to: uniqueRecipients,
      subject: email.subject.startsWith('Re:')
        ? email.subject
        : `Re: ${email.subject}`,
      body,
      inReplyTo: email.id,
      threadId: email.threadId,
    };

    return this.sendEmail(draft, accountId);
  }

  /**
   * Forward an email
   */
  async forwardEmail(
    emailId: string,
    to: EmailAddress[],
    additionalBody?: string,
    accountId?: string
  ): Promise<string> {
    const email = await this.getEmail(emailId, accountId);
    if (!email) {
      throw new Error('Email not found');
    }

    let body = '';
    if (additionalBody) {
      body += additionalBody + '\n\n';
    }
    body += '---------- Forwarded message ---------\n';
    body += `From: ${formatEmailAddress(email.from)}\n`;
    body += `Date: ${new Date(email.date).toLocaleString()}\n`;
    body += `Subject: ${email.subject}\n`;
    body += `To: ${email.to.map(formatEmailAddress).join(', ')}\n\n`;
    body += email.body.plain;

    const draft: EmailDraft = {
      to,
      subject: email.subject.startsWith('Fwd:')
        ? email.subject
        : `Fwd: ${email.subject}`,
      body,
    };

    return this.sendEmail(draft, accountId);
  }

  // ============================================================================
  // Email Actions
  // ============================================================================

  /**
   * Mark email as read
   */
  async markAsRead(emailId: string, accountId?: string): Promise<void> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${emailId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        }
      );
    } else {
      await fetch(`${GRAPH_API_BASE}/me/messages/${emailId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: true }),
      });
    }

    // Update cache
    const cacheKey = `${account.id}_${emailId}`;
    const cached = this.emailCache.get(cacheKey);
    if (cached) {
      cached.isRead = true;
    }
  }

  /**
   * Mark email as unread
   */
  async markAsUnread(emailId: string, accountId?: string): Promise<void> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${emailId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
        }
      );
    } else {
      await fetch(`${GRAPH_API_BASE}/me/messages/${emailId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isRead: false }),
      });
    }

    // Update cache
    const cacheKey = `${account.id}_${emailId}`;
    const cached = this.emailCache.get(cacheKey);
    if (cached) {
      cached.isRead = false;
    }
  }

  /**
   * Star/flag an email
   */
  async starEmail(emailId: string, accountId?: string): Promise<void> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${emailId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ addLabelIds: ['STARRED'] }),
        }
      );
    } else {
      await fetch(`${GRAPH_API_BASE}/me/messages/${emailId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ flag: { flagStatus: 'flagged' } }),
      });
    }
  }

  /**
   * Unstar/unflag an email
   */
  async unstarEmail(emailId: string, accountId?: string): Promise<void> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${emailId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ removeLabelIds: ['STARRED'] }),
        }
      );
    } else {
      await fetch(`${GRAPH_API_BASE}/me/messages/${emailId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ flag: { flagStatus: 'notFlagged' } }),
      });
    }
  }

  /**
   * Delete/trash an email
   */
  async deleteEmail(emailId: string, accountId?: string): Promise<void> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      // Move to trash
      await fetch(
        `${GMAIL_API_BASE}/users/me/messages/${emailId}/trash`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
    } else {
      // Move to deleted items
      await fetch(`${GRAPH_API_BASE}/me/messages/${emailId}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destinationId: 'deleteditems' }),
      });
    }

    // Remove from cache
    const cacheKey = `${account.id}_${emailId}`;
    this.emailCache.delete(cacheKey);
  }

  // ============================================================================
  // Attachment Handling
  // ============================================================================

  /**
   * Download an attachment
   */
  async downloadAttachment(
    emailId: string,
    attachmentId: string,
    accountId?: string
  ): Promise<{ filename: string; mimeType: string; data: Buffer }> {
    const account = accountId
      ? this.authManager.getAccount(accountId)
      : this.authManager.getDefaultAccount();

    if (!account) {
      throw new Error('No email account connected');
    }

    const accessToken = await this.authManager.getValidAccessToken(account.id);
    if (!accessToken) {
      throw new Error('Failed to get valid access token');
    }

    if (account.provider === 'gmail') {
      const url = `${GMAIL_API_BASE}/users/me/messages/${emailId}/attachments/${attachmentId}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to download attachment: ${response.status}`);
      }

      const data = await response.json();

      // Get email to find attachment metadata
      const email = await this.getEmail(emailId, accountId);
      const attachment = email?.attachments.find((a) => a.id === attachmentId);

      return {
        filename: attachment?.filename || 'attachment',
        mimeType: attachment?.mimeType || 'application/octet-stream',
        data: Buffer.from(data.data, 'base64'),
      };
    } else {
      const url = `${GRAPH_API_BASE}/me/messages/${emailId}/attachments/${attachmentId}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to download attachment: ${response.status}`);
      }

      const attachment = await response.json();

      return {
        filename: attachment.name,
        mimeType: attachment.contentType,
        data: Buffer.from(attachment.contentBytes, 'base64'),
      };
    }
  }

  // ============================================================================
  // Voice Command Helpers
  // ============================================================================

  /**
   * Parse voice command for sending email
   * "Send email to John about the meeting"
   */
  parseVoiceCommand(command: string): {
    action: 'send' | 'read' | 'search' | 'reply' | 'forward' | 'delete' | 'unknown';
    recipient?: string;
    subject?: string;
    query?: string;
  } {
    const lowerCommand = command.toLowerCase();

    // Send email pattern
    const sendMatch = lowerCommand.match(
      /send\s+(?:an?\s+)?email\s+to\s+([^\s]+(?:\s+[^\s]+)?)\s*(?:about\s+(.+))?/i
    );
    if (sendMatch) {
      return {
        action: 'send',
        recipient: sendMatch[1],
        subject: sendMatch[2],
      };
    }

    // Read emails pattern
    if (
      lowerCommand.includes('read') &&
      (lowerCommand.includes('email') || lowerCommand.includes('mail'))
    ) {
      const fromMatch = lowerCommand.match(/from\s+([^\s]+)/);
      return {
        action: 'read',
        query: fromMatch ? fromMatch[1] : undefined,
      };
    }

    // Search pattern
    if (
      lowerCommand.includes('search') ||
      lowerCommand.includes('find')
    ) {
      const queryMatch = lowerCommand.match(/(?:search|find)\s+(?:email|mail)s?\s+(?:for|about|from)?\s*(.+)/i);
      return {
        action: 'search',
        query: queryMatch ? queryMatch[1] : undefined,
      };
    }

    // Reply pattern
    if (lowerCommand.includes('reply')) {
      return { action: 'reply' };
    }

    // Forward pattern
    if (lowerCommand.includes('forward')) {
      const toMatch = lowerCommand.match(/forward\s+(?:to|this\s+to)\s+([^\s]+)/);
      return {
        action: 'forward',
        recipient: toMatch ? toMatch[1] : undefined,
      };
    }

    // Delete pattern
    if (lowerCommand.includes('delete') || lowerCommand.includes('trash')) {
      return { action: 'delete' };
    }

    return { action: 'unknown' };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear email cache
   */
  clearCache(): void {
    this.emailCache.clear();
  }

  /**
   * Shutdown the email manager
   */
  async shutdown(): Promise<void> {
    this.clearCache();
    this.removeAllListeners();
    EmailManager.instance = null;
    logger.info('Email manager shutdown');
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Get the email manager singleton
 */
export function getEmailManager(): EmailManager {
  return EmailManager.getInstance();
}

/**
 * Initialize and get the email manager
 */
export async function initializeEmailManager(): Promise<EmailManager> {
  const manager = getEmailManager();
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the email manager
 */
export async function shutdownEmailManager(): Promise<void> {
  const manager = EmailManager.getInstance();
  await manager.shutdown();
}

export default {
  EmailManager,
  getEmailManager,
  initializeEmailManager,
  shutdownEmailManager,
};
