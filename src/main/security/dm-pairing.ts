/**
 * @fileoverview DM Pairing - Sender approval system for messaging channels
 * @module security/dm-pairing
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Manages approval of unknown senders in direct message channels.
 * Supports three policies:
 * - open: Accept all messages
 * - pairing: Require approval for unknown senders
 * - closed: Only accept from pre-approved senders
 *
 * Integrates with channel adapters to filter incoming messages.
 *
 * @example
 * const pairing = getDMPairing();
 *
 * // Check if sender is approved
 * const isApproved = await pairing.isSenderApproved('whatsapp', '+1234567890');
 *
 * // Request approval for new sender
 * await pairing.requestApproval('whatsapp', '+1234567890', 'John Doe');
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app, Notification, dialog, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';

const logger = createModuleLogger('DMPairing');

// ============================================================================
// Types
// ============================================================================

/**
 * DM pairing policy
 */
export type PairingPolicy = 'open' | 'pairing' | 'closed';

/**
 * Sender approval status
 */
export type ApprovalStatus = 'approved' | 'pending' | 'denied' | 'blocked';

/**
 * Approved sender entry
 */
export interface ApprovedSender {
  /** Unique identifier (platform-specific) */
  id: string;

  /** Channel type (whatsapp, telegram, etc.) */
  channel: string;

  /** Platform-specific sender ID */
  senderId: string;

  /** Display name */
  displayName: string;

  /** Approval status */
  status: ApprovalStatus;

  /** When first seen */
  firstSeen: number;

  /** When approved/denied */
  decidedAt?: number;

  /** Who approved (user or auto) */
  approvedBy?: 'user' | 'auto';

  /** Optional notes */
  notes?: string;

  /** Message count from this sender */
  messageCount: number;

  /** Last message timestamp */
  lastMessageAt?: number;
}

/**
 * Pairing request (pending approval)
 */
export interface PairingRequest {
  /** Request ID */
  id: string;

  /** Channel type */
  channel: string;

  /** Sender ID */
  senderId: string;

  /** Display name */
  displayName: string;

  /** Initial message (first message that triggered pairing) */
  initialMessage?: string;

  /** Request timestamp */
  requestedAt: number;

  /** Expiration timestamp */
  expiresAt: number;

  /** Number of messages received while pending */
  pendingMessages: number;
}

/**
 * DM Pairing configuration
 */
export interface DMPairingConfig {
  /** Default policy for all channels */
  defaultPolicy: PairingPolicy;

  /** Per-channel policy overrides */
  channelPolicies: Record<string, PairingPolicy>;

  /** Pre-approved sender IDs */
  preApproved: Array<{ channel: string; senderId: string; displayName: string }>;

  /** Blocked sender IDs */
  blocked: Array<{ channel: string; senderId: string; reason?: string }>;

  /** Pairing request timeout (ms) */
  requestTimeout: number;

  /** Auto-approve senders with mutual contacts */
  autoApproveMutual: boolean;

  /** Show notification for pairing requests */
  showNotifications: boolean;

  /** Maximum pending requests per channel */
  maxPendingPerChannel: number;
}

/**
 * DM Pairing events
 */
export interface DMPairingEvents {
  'sender:approved': (sender: ApprovedSender) => void;
  'sender:denied': (channel: string, senderId: string) => void;
  'sender:blocked': (channel: string, senderId: string) => void;
  'request:new': (request: PairingRequest) => void;
  'request:expired': (request: PairingRequest) => void;
  'message:filtered': (channel: string, senderId: string, reason: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configuration
 */
export const DEFAULT_DM_PAIRING_CONFIG: DMPairingConfig = {
  defaultPolicy: 'pairing',
  channelPolicies: {
    desktop: 'open', // Desktop always open (local)
  },
  preApproved: [],
  blocked: [],
  requestTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
  autoApproveMutual: false,
  showNotifications: true,
  maxPendingPerChannel: 50,
};

// ============================================================================
// DM Pairing Manager
// ============================================================================

/**
 * Manages sender approval for messaging channels.
 *
 * Provides three policy modes:
 * - open: Accept all senders
 * - pairing: Require approval for unknown senders
 * - closed: Only accept pre-approved senders
 *
 * @class DMPairing
 * @extends EventEmitter
 *
 * @example
 * const pairing = getDMPairing();
 *
 * // Set channel policy
 * pairing.setChannelPolicy('whatsapp', 'pairing');
 *
 * // Check and handle incoming message
 * const approved = await pairing.handleIncomingMessage('whatsapp', senderId, name);
 * if (!approved) {
 *   console.log('Message filtered - sender not approved');
 * }
 */
export class DMPairing extends EventEmitter {
  private config: DMPairingConfig;
  private auditLogger: AuditLogger;
  private approvedSenders: Map<string, ApprovedSender> = new Map();
  private pendingRequests: Map<string, PairingRequest> = new Map();
  private configPath: string;
  private initialized = false;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: Partial<DMPairingConfig>) {
    super();
    this.config = { ...DEFAULT_DM_PAIRING_CONFIG, ...config };
    this.configPath = path.join(app.getPath('userData'), 'dm-pairing.json');
    this.auditLogger = getAuditLogger();

    // Initialize pre-approved senders
    for (const sender of this.config.preApproved) {
      const key = this._senderKey(sender.channel, sender.senderId);
      this.approvedSenders.set(key, {
        id: key,
        channel: sender.channel,
        senderId: sender.senderId,
        displayName: sender.displayName,
        status: 'approved',
        firstSeen: Date.now(),
        decidedAt: Date.now(),
        approvedBy: 'auto',
        messageCount: 0,
      });
    }

    // Initialize blocked senders
    for (const blocked of this.config.blocked) {
      const key = this._senderKey(blocked.channel, blocked.senderId);
      this.approvedSenders.set(key, {
        id: key,
        channel: blocked.channel,
        senderId: blocked.senderId,
        displayName: 'Blocked',
        status: 'blocked',
        firstSeen: Date.now(),
        decidedAt: Date.now(),
        notes: blocked.reason,
        messageCount: 0,
      });
    }

    logger.info('DMPairing initialized', {
      defaultPolicy: this.config.defaultPolicy,
      preApproved: this.config.preApproved.length,
      blocked: this.config.blocked.length,
    });
  }

  /**
   * Generate unique key for sender
   */
  private _senderKey(channel: string, senderId: string): string {
    return `${channel}:${senderId}`;
  }

  /**
   * Initialize and load persisted data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const saved = JSON.parse(data) as {
        senders: ApprovedSender[];
        requests: PairingRequest[];
        config: Partial<DMPairingConfig>;
      };

      // Merge config
      this.config = { ...this.config, ...saved.config };

      // Restore senders
      for (const sender of saved.senders) {
        this.approvedSenders.set(sender.id, sender);
      }

      // Restore non-expired requests
      const now = Date.now();
      for (const request of saved.requests) {
        if (request.expiresAt > now) {
          this.pendingRequests.set(request.id, request);
        }
      }

      logger.info('Loaded DM pairing data', {
        senders: saved.senders.length,
        pendingRequests: this.pendingRequests.size,
      });
    } catch {
      logger.debug('No persisted DM pairing data found');
    }

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanupExpiredRequests(), 60000);

    this.initialized = true;
  }

  /**
   * Save data to disk
   */
  async save(): Promise<void> {
    const data = {
      senders: Array.from(this.approvedSenders.values()),
      requests: Array.from(this.pendingRequests.values()),
      config: {
        defaultPolicy: this.config.defaultPolicy,
        channelPolicies: this.config.channelPolicies,
        requestTimeout: this.config.requestTimeout,
        autoApproveMutual: this.config.autoApproveMutual,
        showNotifications: this.config.showNotifications,
      },
    };

    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));

    logger.debug('Saved DM pairing data');
  }

  /**
   * Cleanup expired requests
   */
  private _cleanupExpiredRequests(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, request] of this.pendingRequests) {
      if (request.expiresAt < now) {
        this.pendingRequests.delete(id);
        this.emit('request:expired', request);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned expired pairing requests', { count: cleaned });
      void this.save();
    }
  }

  /**
   * Get policy for a channel
   */
  getChannelPolicy(channel: string): PairingPolicy {
    return this.config.channelPolicies[channel] ?? this.config.defaultPolicy;
  }

  /**
   * Set policy for a channel
   */
  setChannelPolicy(channel: string, policy: PairingPolicy): void {
    this.config.channelPolicies[channel] = policy;

    logger.info('Channel policy set', { channel, policy });

    this.auditLogger.log(
      'authorization',
      'info',
      `DM pairing policy changed for ${channel}: ${policy}`,
      {
        action: 'policy_changed',
        allowed: true,
        source: 'dm-pairing',
        context: { channel, policy },
      }
    );

    void this.save();
  }

  /**
   * Check if sender is approved
   */
  isSenderApproved(channel: string, senderId: string): boolean {
    const policy = this.getChannelPolicy(channel);

    // Open policy - everyone approved
    if (policy === 'open') {
      return true;
    }

    const key = this._senderKey(channel, senderId);
    const sender = this.approvedSenders.get(key);

    if (!sender) {
      return false;
    }

    return sender.status === 'approved';
  }

  /**
   * Check if sender is blocked
   */
  isSenderBlocked(channel: string, senderId: string): boolean {
    const key = this._senderKey(channel, senderId);
    const sender = this.approvedSenders.get(key);
    return sender?.status === 'blocked';
  }

  /**
   * Get sender status
   */
  getSenderStatus(channel: string, senderId: string): ApprovalStatus | null {
    const key = this._senderKey(channel, senderId);
    const sender = this.approvedSenders.get(key);
    return sender?.status ?? null;
  }

  /**
   * Handle incoming message - returns whether to allow
   */
  async handleIncomingMessage(
    channel: string,
    senderId: string,
    displayName: string,
    messagePreview?: string
  ): Promise<boolean> {
    const policy = this.getChannelPolicy(channel);
    const key = this._senderKey(channel, senderId);

    // Open policy - always allow
    if (policy === 'open') {
      this._updateMessageCount(key, channel, senderId, displayName);
      return true;
    }

    // Check existing status
    const existing = this.approvedSenders.get(key);

    if (existing) {
      switch (existing.status) {
        case 'approved':
          this._updateMessageCount(key, channel, senderId, displayName);
          return true;

        case 'blocked':
          this.emit('message:filtered', channel, senderId, 'blocked');
          return false;

        case 'denied':
          this.emit('message:filtered', channel, senderId, 'denied');
          return false;

        case 'pending':
          // Update pending request message count
          const request = this.pendingRequests.get(key);
          if (request) {
            request.pendingMessages++;
          }
          this.emit('message:filtered', channel, senderId, 'pending approval');
          return false;
      }
    }

    // Closed policy - deny unknown
    if (policy === 'closed') {
      this.emit('message:filtered', channel, senderId, 'closed policy');
      return false;
    }

    // Pairing policy - create request
    await this._createPairingRequest(channel, senderId, displayName, messagePreview);
    this.emit('message:filtered', channel, senderId, 'pending approval');
    return false;
  }

  /**
   * Update message count for sender
   */
  private _updateMessageCount(
    key: string,
    channel: string,
    senderId: string,
    displayName: string
  ): void {
    const existing = this.approvedSenders.get(key);
    if (existing) {
      existing.messageCount++;
      existing.lastMessageAt = Date.now();
    } else {
      // Auto-create for open policy
      this.approvedSenders.set(key, {
        id: key,
        channel,
        senderId,
        displayName,
        status: 'approved',
        firstSeen: Date.now(),
        approvedBy: 'auto',
        messageCount: 1,
        lastMessageAt: Date.now(),
      });
    }
  }

  /**
   * Create pairing request
   */
  private async _createPairingRequest(
    channel: string,
    senderId: string,
    displayName: string,
    initialMessage?: string
  ): Promise<void> {
    const key = this._senderKey(channel, senderId);

    // Check if request already exists
    if (this.pendingRequests.has(key)) {
      const existing = this.pendingRequests.get(key)!;
      existing.pendingMessages++;
      return;
    }

    // Check max pending per channel
    const channelPending = Array.from(this.pendingRequests.values())
      .filter(r => r.channel === channel).length;

    if (channelPending >= this.config.maxPendingPerChannel) {
      logger.warn('Max pending requests reached for channel', { channel });
      return;
    }

    const request: PairingRequest = {
      id: key,
      channel,
      senderId,
      displayName,
      initialMessage,
      requestedAt: Date.now(),
      expiresAt: Date.now() + this.config.requestTimeout,
      pendingMessages: 1,
    };

    this.pendingRequests.set(key, request);

    // Mark sender as pending
    this.approvedSenders.set(key, {
      id: key,
      channel,
      senderId,
      displayName,
      status: 'pending',
      firstSeen: Date.now(),
      messageCount: 0,
    });

    this.emit('request:new', request);

    // Show notification
    if (this.config.showNotifications) {
      this._showPairingNotification(request);
    }

    logger.info('Pairing request created', { channel, senderId, displayName });

    this.auditLogger.log(
      'authorization',
      'info',
      `DM pairing request: ${displayName} (${channel})`,
      {
        action: 'pairing_request',
        allowed: false,
        source: 'dm-pairing',
        context: { channel, senderId, displayName },
      }
    );

    void this.save();
  }

  /**
   * Show notification for pairing request
   */
  private _showPairingNotification(request: PairingRequest): void {
    const notification = new Notification({
      title: 'New Message Request',
      body: `${request.displayName} (${request.channel}) wants to message you`,
      actions: [
        { type: 'button', text: 'Approve' },
        { type: 'button', text: 'Deny' },
      ],
    });

    notification.on('action', (_event, index) => {
      if (index === 0) {
        void this.approveSender(request.channel, request.senderId);
      } else {
        void this.denySender(request.channel, request.senderId);
      }
    });

    notification.on('click', () => {
      // Open approval dialog
      void this._showApprovalDialog(request);
    });

    notification.show();
  }

  /**
   * Show approval dialog
   */
  private async _showApprovalDialog(request: PairingRequest): Promise<void> {
    const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Message Request',
      message: `${request.displayName} wants to message you`,
      detail: [
        `Channel: ${request.channel}`,
        `Sender ID: ${request.senderId}`,
        request.initialMessage ? `Message: "${request.initialMessage}"` : '',
        `Pending messages: ${request.pendingMessages}`,
      ].filter(Boolean).join('\n'),
      buttons: ['Deny', 'Approve', 'Block'],
      defaultId: 1,
      cancelId: 0,
    });

    switch (response) {
      case 1:
        await this.approveSender(request.channel, request.senderId);
        break;
      case 2:
        await this.blockSender(request.channel, request.senderId, 'Blocked by user');
        break;
      default:
        await this.denySender(request.channel, request.senderId);
    }
  }

  /**
   * Approve a sender
   */
  async approveSender(channel: string, senderId: string, notes?: string): Promise<void> {
    const key = this._senderKey(channel, senderId);
    const existing = this.approvedSenders.get(key);
    const request = this.pendingRequests.get(key);

    const sender: ApprovedSender = {
      id: key,
      channel,
      senderId,
      displayName: existing?.displayName ?? request?.displayName ?? senderId,
      status: 'approved',
      firstSeen: existing?.firstSeen ?? Date.now(),
      decidedAt: Date.now(),
      approvedBy: 'user',
      notes,
      messageCount: existing?.messageCount ?? 0,
      lastMessageAt: existing?.lastMessageAt,
    };

    this.approvedSenders.set(key, sender);
    this.pendingRequests.delete(key);

    this.emit('sender:approved', sender);

    logger.info('Sender approved', { channel, senderId });

    this.auditLogger.log(
      'authorization',
      'info',
      `DM sender approved: ${sender.displayName} (${channel})`,
      {
        action: 'sender_approved',
        allowed: true,
        source: 'dm-pairing',
        context: { channel, senderId, displayName: sender.displayName },
      }
    );

    await this.save();
  }

  /**
   * Deny a sender (soft rejection - can be changed)
   */
  async denySender(channel: string, senderId: string, notes?: string): Promise<void> {
    const key = this._senderKey(channel, senderId);
    const existing = this.approvedSenders.get(key);

    this.approvedSenders.set(key, {
      id: key,
      channel,
      senderId,
      displayName: existing?.displayName ?? senderId,
      status: 'denied',
      firstSeen: existing?.firstSeen ?? Date.now(),
      decidedAt: Date.now(),
      notes,
      messageCount: existing?.messageCount ?? 0,
    });

    this.pendingRequests.delete(key);

    this.emit('sender:denied', channel, senderId);

    logger.info('Sender denied', { channel, senderId });

    this.auditLogger.log(
      'authorization',
      'info',
      `DM sender denied: ${senderId} (${channel})`,
      {
        action: 'sender_denied',
        allowed: false,
        source: 'dm-pairing',
        context: { channel, senderId },
      }
    );

    await this.save();
  }

  /**
   * Block a sender (permanent rejection)
   */
  async blockSender(channel: string, senderId: string, reason?: string): Promise<void> {
    const key = this._senderKey(channel, senderId);
    const existing = this.approvedSenders.get(key);

    this.approvedSenders.set(key, {
      id: key,
      channel,
      senderId,
      displayName: existing?.displayName ?? senderId,
      status: 'blocked',
      firstSeen: existing?.firstSeen ?? Date.now(),
      decidedAt: Date.now(),
      notes: reason,
      messageCount: existing?.messageCount ?? 0,
    });

    this.pendingRequests.delete(key);

    this.emit('sender:blocked', channel, senderId);

    logger.info('Sender blocked', { channel, senderId, reason });

    this.auditLogger.log(
      'authorization',
      'warning',
      `DM sender blocked: ${senderId} (${channel})`,
      {
        action: 'sender_blocked',
        allowed: false,
        reason: reason ?? 'blocked by user',
        source: 'dm-pairing',
        context: { channel, senderId, reason },
      }
    );

    await this.save();
  }

  /**
   * Unblock a sender
   */
  async unblockSender(channel: string, senderId: string): Promise<void> {
    const key = this._senderKey(channel, senderId);
    const existing = this.approvedSenders.get(key);

    if (existing && existing.status === 'blocked') {
      existing.status = 'denied'; // Move to denied, not approved
      existing.decidedAt = Date.now();
      await this.save();
      logger.info('Sender unblocked', { channel, senderId });
    }
  }

  /**
   * Get all approved senders
   */
  getApprovedSenders(channel?: string): ApprovedSender[] {
    const senders = Array.from(this.approvedSenders.values())
      .filter(s => s.status === 'approved');

    if (channel) {
      return senders.filter(s => s.channel === channel);
    }

    return senders;
  }

  /**
   * Get all pending requests
   */
  getPendingRequests(channel?: string): PairingRequest[] {
    const requests = Array.from(this.pendingRequests.values());

    if (channel) {
      return requests.filter(r => r.channel === channel);
    }

    return requests;
  }

  /**
   * Get blocked senders
   */
  getBlockedSenders(channel?: string): ApprovedSender[] {
    const senders = Array.from(this.approvedSenders.values())
      .filter(s => s.status === 'blocked');

    if (channel) {
      return senders.filter(s => s.channel === channel);
    }

    return senders;
  }

  /**
   * Get sender by ID
   */
  getSender(channel: string, senderId: string): ApprovedSender | undefined {
    const key = this._senderKey(channel, senderId);
    return this.approvedSenders.get(key);
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    await this.save();

    this.approvedSenders.clear();
    this.pendingRequests.clear();

    logger.info('DMPairing shutdown');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: DMPairing | null = null;

/**
 * Get the singleton DMPairing instance
 */
export function getDMPairing(): DMPairing {
  if (!instance) {
    instance = new DMPairing();
  }
  return instance;
}

/**
 * Shutdown DMPairing
 */
export async function shutdownDMPairing(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
