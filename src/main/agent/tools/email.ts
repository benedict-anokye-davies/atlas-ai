/**
 * Atlas Desktop - Email Agent Tools
 * Voice-controlled email management via Gmail and Outlook
 *
 * Features:
 * - Read and search emails
 * - Send new emails
 * - Reply and forward emails
 * - Mark as read/starred
 * - Delete emails
 *
 * @module agent/tools/email
 */

import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getEmailManager, EmailSearchOptions, EmailDraft } from '../../integrations/email';

const logger = createModuleLogger('EmailTools');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format email for display
 */
function formatEmailSummary(email: {
  id: string;
  from: { name?: string; email: string };
  subject: string;
  snippet: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
}): string {
  const date = new Date(email.date);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const fromName = email.from.name || email.from.email;
  const readStatus = email.isRead ? '' : '[UNREAD] ';
  const starStatus = email.isStarred ? '[*] ' : '';
  const attachStatus = email.hasAttachments ? ' [Attachment]' : '';

  return `${readStatus}${starStatus}${fromName}: ${email.subject} (${dateStr} ${timeStr})${attachStatus}`;
}

/**
 * Parse email address from string (e.g., "John Doe <john@example.com>")
 */
function parseEmailAddressString(input: string): { name?: string; email: string } {
  const match = input.match(/^(?:(.+?)\s*)?<?([^\s<>]+@[^\s<>]+)>?$/);
  if (match) {
    return {
      name: match[1]?.trim() || undefined,
      email: match[2].trim(),
    };
  }
  return { email: input.trim() };
}

// =============================================================================
// Agent Tools
// =============================================================================

/**
 * Get unread emails
 */
export const getUnreadEmailsTool: AgentTool = {
  name: 'email_get_unread',
  description: 'Get unread emails from your inbox. Use this to check what new emails have arrived.',
  parameters: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'number',
        description: 'Maximum number of emails to return (default: 10)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const maxResults = (params.maxResults as number) || 10;

      const manager = getEmailManager();
      const accounts = manager.getAccounts();

      if (accounts.length === 0) {
        return {
          success: true,
          data: {
            message:
              'No email accounts connected. Please add a Gmail or Outlook account in Settings.',
            emails: [],
          },
        };
      }

      const emails = await manager.getUnreadEmails(undefined, maxResults);

      const formattedEmails = emails.map((email) => ({
        id: email.id,
        from: email.from,
        subject: email.subject,
        snippet: email.snippet,
        date: new Date(email.date).toISOString(),
        hasAttachments: email.hasAttachments,
        summary: formatEmailSummary(email),
      }));

      return {
        success: true,
        data: {
          unreadCount: formattedEmails.length,
          emails: formattedEmails,
          message:
            formattedEmails.length > 0
              ? `You have ${formattedEmails.length} unread email(s)`
              : 'No unread emails',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get unread emails', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Search emails
 */
export const searchEmailsTool: AgentTool = {
  name: 'email_search',
  description:
    'Search emails by sender, subject, content, or other criteria. Use this to find specific emails.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'General search query (searches all fields)',
      },
      from: {
        type: 'string',
        description: 'Search by sender email or name',
      },
      subject: {
        type: 'string',
        description: 'Search by subject line',
      },
      hasAttachment: {
        type: 'boolean',
        description: 'Filter to only emails with attachments',
      },
      isUnread: {
        type: 'boolean',
        description: 'Filter to only unread emails',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const manager = getEmailManager();
      const accounts = manager.getAccounts();

      if (accounts.length === 0) {
        return {
          success: true,
          data: {
            message: 'No email accounts connected.',
            emails: [],
          },
        };
      }

      const searchOptions: EmailSearchOptions = {
        query: params.query as string | undefined,
        from: params.from as string | undefined,
        subject: params.subject as string | undefined,
        hasAttachment: params.hasAttachment as boolean | undefined,
        isUnread: params.isUnread as boolean | undefined,
        maxResults: (params.maxResults as number) || 20,
      };

      const emails = await manager.searchEmails(searchOptions);

      const formattedEmails = emails.map((email) => ({
        id: email.id,
        from: email.from,
        subject: email.subject,
        snippet: email.snippet,
        date: new Date(email.date).toISOString(),
        isRead: email.isRead,
        hasAttachments: email.hasAttachments,
        summary: formatEmailSummary(email),
      }));

      return {
        success: true,
        data: {
          resultCount: formattedEmails.length,
          searchCriteria: searchOptions,
          emails: formattedEmails,
          message:
            formattedEmails.length > 0
              ? `Found ${formattedEmails.length} email(s) matching your search`
              : 'No emails found matching your criteria',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to search emails', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Read a specific email
 */
export const readEmailTool: AgentTool = {
  name: 'email_read',
  description: 'Read the full content of a specific email by its ID.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to read',
      },
    },
    required: ['emailId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;

      const manager = getEmailManager();
      const email = await manager.getEmail(emailId);

      if (!email) {
        return { success: false, error: 'Email not found' };
      }

      return {
        success: true,
        data: {
          id: email.id,
          from: email.from,
          to: email.to,
          cc: email.cc,
          subject: email.subject,
          date: new Date(email.date).toISOString(),
          body: email.body.plain,
          htmlBody: email.body.html,
          isRead: email.isRead,
          isStarred: email.isStarred,
          hasAttachments: email.hasAttachments,
          attachments: email.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
          message: `Email from ${email.from.name || email.from.email}: ${email.subject}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to read email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Send a new email
 */
export const sendEmailTool: AgentTool = {
  name: 'email_send',
  description: 'Send a new email. You can specify recipients, subject, and body content.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated for multiple',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body content (plain text)',
      },
      cc: {
        type: 'string',
        description: 'CC recipients, comma-separated (optional)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const toStr = params.to as string;
      const subject = params.subject as string;
      const body = params.body as string;
      const ccStr = params.cc as string | undefined;

      const manager = getEmailManager();
      const accounts = manager.getAccounts();

      if (accounts.length === 0) {
        return {
          success: false,
          error: 'No email accounts connected. Please add an email account first.',
        };
      }

      // Parse recipients
      const toAddresses = toStr.split(',').map((s) => parseEmailAddressString(s.trim()));
      const ccAddresses = ccStr
        ? ccStr.split(',').map((s) => parseEmailAddressString(s.trim()))
        : undefined;

      const draft: EmailDraft = {
        to: toAddresses,
        cc: ccAddresses,
        subject,
        body,
      };

      const messageId = await manager.sendEmail(draft);

      return {
        success: true,
        data: {
          messageId,
          to: toAddresses,
          subject,
          message: `Email sent successfully to ${toAddresses.map((a) => a.email).join(', ')}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to send email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Reply to an email
 */
export const replyEmailTool: AgentTool = {
  name: 'email_reply',
  description: 'Reply to an existing email.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to reply to',
      },
      body: {
        type: 'string',
        description: 'Reply message content',
      },
      replyAll: {
        type: 'boolean',
        description: 'Whether to reply to all recipients (default: false)',
      },
    },
    required: ['emailId', 'body'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;
      const body = params.body as string;
      const replyAll = (params.replyAll as boolean) || false;

      const manager = getEmailManager();
      const messageId = await manager.replyToEmail(emailId, body, replyAll);

      return {
        success: true,
        data: {
          messageId,
          inReplyTo: emailId,
          replyAll,
          message: `Reply sent successfully${replyAll ? ' to all recipients' : ''}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to reply to email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Forward an email
 */
export const forwardEmailTool: AgentTool = {
  name: 'email_forward',
  description: 'Forward an email to other recipients.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to forward',
      },
      to: {
        type: 'string',
        description: 'Recipient email address(es), comma-separated for multiple',
      },
      additionalMessage: {
        type: 'string',
        description: 'Optional message to include before the forwarded content',
      },
    },
    required: ['emailId', 'to'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;
      const toStr = params.to as string;
      const additionalMessage = params.additionalMessage as string | undefined;

      const toAddresses = toStr.split(',').map((s) => parseEmailAddressString(s.trim()));

      const manager = getEmailManager();
      const messageId = await manager.forwardEmail(emailId, toAddresses, additionalMessage);

      return {
        success: true,
        data: {
          messageId,
          forwardedFrom: emailId,
          to: toAddresses,
          message: `Email forwarded successfully to ${toAddresses.map((a) => a.email).join(', ')}`,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to forward email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Mark email as read
 */
export const markEmailReadTool: AgentTool = {
  name: 'email_mark_read',
  description: 'Mark an email as read.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to mark as read',
      },
    },
    required: ['emailId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;

      const manager = getEmailManager();
      await manager.markAsRead(emailId);

      return {
        success: true,
        data: {
          emailId,
          message: 'Email marked as read',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to mark email as read', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Star/flag an email
 */
export const starEmailTool: AgentTool = {
  name: 'email_star',
  description: 'Star or unstar an email to mark it as important.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to star/unstar',
      },
      starred: {
        type: 'boolean',
        description: 'Whether to star (true) or unstar (false) the email',
      },
    },
    required: ['emailId', 'starred'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;
      const starred = params.starred as boolean;

      const manager = getEmailManager();
      if (starred) {
        await manager.starEmail(emailId);
      } else {
        await manager.unstarEmail(emailId);
      }

      return {
        success: true,
        data: {
          emailId,
          starred,
          message: starred ? 'Email starred' : 'Email unstarred',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to star/unstar email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Delete an email
 */
export const deleteEmailTool: AgentTool = {
  name: 'email_delete',
  description: 'Delete/trash an email.',
  parameters: {
    type: 'object',
    properties: {
      emailId: {
        type: 'string',
        description: 'The ID of the email to delete',
      },
    },
    required: ['emailId'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    try {
      const emailId = params.emailId as string;

      const manager = getEmailManager();
      await manager.deleteEmail(emailId);

      return {
        success: true,
        data: {
          emailId,
          message: 'Email moved to trash',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete email', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get email account status
 */
export const getEmailStatusTool: AgentTool = {
  name: 'email_get_status',
  description: 'Get the status of connected email accounts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const manager = getEmailManager();
      const accounts = manager.getAccounts();
      const defaultAccount = manager.getDefaultAccount();

      return {
        success: true,
        data: {
          accountCount: accounts.length,
          accounts: accounts.map((a) => ({
            id: a.id,
            provider: a.provider,
            email: a.email,
            isDefault: a.id === defaultAccount?.id,
          })),
          isAuthenticated: manager.isAuthenticated(),
          message:
            accounts.length > 0
              ? `${accounts.length} email account(s) connected`
              : 'No email accounts connected. Add one in Settings.',
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get email status', { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

/**
 * Get all email tools
 */
export function getEmailTools(): AgentTool[] {
  return [
    getUnreadEmailsTool,
    searchEmailsTool,
    readEmailTool,
    sendEmailTool,
    replyEmailTool,
    forwardEmailTool,
    markEmailReadTool,
    starEmailTool,
    deleteEmailTool,
    getEmailStatusTool,
  ];
}

export default {
  getUnreadEmailsTool,
  searchEmailsTool,
  readEmailTool,
  sendEmailTool,
  replyEmailTool,
  forwardEmailTool,
  markEmailReadTool,
  starEmailTool,
  deleteEmailTool,
  getEmailStatusTool,
  getEmailTools,
};
