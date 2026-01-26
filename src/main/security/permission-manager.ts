/**
 * Atlas Desktop - Permission Manager
 * User approval system for dangerous operations (044-B)
 *
 * Features:
 * - Permission levels for different operation types
 * - User preference storage for operation approvals
 * - IPC integration for permission requests
 * - Permission history and revocation
 * - Temporary and permanent permissions
 *
 * @module security/permission-manager
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';

const logger = createModuleLogger('PermissionManager');

/**
 * Permission categories for different operation types
 */
export type PermissionCategory =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'terminal_execute'
  | 'network_access'
  | 'system_settings'
  | 'browser_automation'
  | 'clipboard_access'
  | 'screenshot'
  | 'memory_access'
  | 'git_operations'
  | 'api_calls'
  | 'custom';

/**
 * Permission risk levels
 */
export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Permission request
 */
export interface PermissionRequest {
  id: string;
  category: PermissionCategory;
  operation: string;
  description: string;
  riskLevel: PermissionRiskLevel;
  resource?: string;
  details?: Record<string, unknown>;
  timestamp: number;
  expiresAt?: number;
}

/**
 * Permission grant
 */
export interface PermissionGrant {
  requestId: string;
  category: PermissionCategory;
  operation: string;
  resource?: string;
  granted: boolean;
  grantedAt: number;
  expiresAt?: number;
  permanent: boolean;
  reason?: string;
  grantedBy: 'user' | 'system' | 'preset';
}

/**
 * User permission preferences
 */
export interface PermissionPreferences {
  /** Always allow these categories without prompting */
  autoApprove: PermissionCategory[];

  /** Always block these categories */
  autoBlock: PermissionCategory[];

  /** Remember choices for session duration */
  rememberForSession: boolean;

  /** Remember choices permanently */
  rememberPermanently: boolean;

  /** Show detailed permission info */
  showDetails: boolean;

  /** Default decision when timeout */
  defaultOnTimeout: 'allow' | 'deny';

  /** Timeout for permission dialog (ms) */
  dialogTimeout: number;

  /** Require confirmation for critical operations */
  alwaysConfirmCritical: boolean;
}

/**
 * Default permission preferences
 */
export const DEFAULT_PERMISSION_PREFERENCES: PermissionPreferences = {
  autoApprove: ['file_read', 'api_calls'],
  autoBlock: [],
  rememberForSession: true,
  rememberPermanently: false,
  showDetails: true,
  defaultOnTimeout: 'deny',
  dialogTimeout: 30000, // 30 seconds
  alwaysConfirmCritical: true,
};

/**
 * Risk level configuration for categories
 */
export const CATEGORY_RISK_LEVELS: Record<PermissionCategory, PermissionRiskLevel> = {
  file_read: 'low',
  api_calls: 'low',
  memory_access: 'low',
  file_write: 'medium',
  network_access: 'medium',
  clipboard_access: 'medium',
  screenshot: 'medium',
  git_operations: 'medium',
  browser_automation: 'high',
  terminal_execute: 'high',
  file_delete: 'high',
  system_settings: 'critical',
  custom: 'medium',
};

/**
 * Human-readable category descriptions
 */
export const CATEGORY_DESCRIPTIONS: Record<PermissionCategory, string> = {
  file_read: 'Read files from your computer',
  file_write: 'Create or modify files',
  file_delete: 'Delete files or directories',
  terminal_execute: 'Run commands in the terminal',
  network_access: 'Access network resources',
  system_settings: 'Modify system settings',
  browser_automation: 'Control web browsers',
  clipboard_access: 'Access clipboard contents',
  screenshot: 'Capture screenshots',
  memory_access: 'Access conversation memory',
  git_operations: 'Perform Git operations',
  api_calls: 'Make API calls to external services',
  custom: 'Perform a custom operation',
};

/**
 * Permission Manager
 * Handles user approval for dangerous operations
 */
export class PermissionManager extends EventEmitter {
  private preferences: PermissionPreferences;
  private sessionGrants: Map<string, PermissionGrant> = new Map();
  private permanentGrants: Map<string, PermissionGrant> = new Map();
  private pendingRequests: Map<
    string,
    {
      request: PermissionRequest;
      resolve: (granted: boolean) => void;
      timeoutId?: NodeJS.Timeout;
    }
  > = new Map();
  private auditLogger = getAuditLogger();
  private configPath: string;

  constructor(preferences?: Partial<PermissionPreferences>) {
    super();

    this.preferences = { ...DEFAULT_PERMISSION_PREFERENCES, ...preferences };
    this.configPath = path.join(homedir(), '.atlas', 'permissions.json');

    this.loadPermanentGrants().catch((err) => {
      logger.warn('Failed to load permanent grants', { error: err.message });
    });

    logger.info('PermissionManager initialized', {
      autoApprove: this.preferences.autoApprove,
      autoBlock: this.preferences.autoBlock,
    });
  }

  /**
   * Request permission for an operation
   */
  async requestPermission(
    category: PermissionCategory,
    operation: string,
    options: {
      description?: string;
      resource?: string;
      details?: Record<string, unknown>;
      riskLevel?: PermissionRiskLevel;
      skipPrompt?: boolean;
    } = {}
  ): Promise<boolean> {
    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const riskLevel = options.riskLevel || CATEGORY_RISK_LEVELS[category];

    const request: PermissionRequest = {
      id: requestId,
      category,
      operation,
      description: options.description || CATEGORY_DESCRIPTIONS[category],
      riskLevel,
      resource: options.resource,
      details: options.details,
      timestamp: Date.now(),
    };

    logger.debug('Permission requested', { requestId, category, operation });

    // Check auto-block
    if (this.preferences.autoBlock.includes(category)) {
      this.logPermissionDecision(request, false, 'auto_blocked');
      return false;
    }

    // Check auto-approve (but not for critical operations if alwaysConfirmCritical)
    if (
      this.preferences.autoApprove.includes(category) &&
      !(this.preferences.alwaysConfirmCritical && riskLevel === 'critical')
    ) {
      this.logPermissionDecision(request, true, 'auto_approved');
      return true;
    }

    // Check existing grants
    const existingGrant = this.findExistingGrant(category, operation, options.resource);
    if (existingGrant) {
      // Check if grant is still valid
      if (!existingGrant.expiresAt || existingGrant.expiresAt > Date.now()) {
        this.logPermissionDecision(request, existingGrant.granted, 'cached_grant');
        return existingGrant.granted;
      } else {
        // Grant expired, remove it
        this.removeGrant(existingGrant.requestId);
      }
    }

    // Skip prompt if requested (used for silent operations)
    if (options.skipPrompt) {
      const defaultDecision = this.preferences.defaultOnTimeout === 'allow';
      this.logPermissionDecision(request, defaultDecision, 'skipped_prompt');
      return defaultDecision;
    }

    // Request user approval
    return this.promptUser(request);
  }

  /**
   * Prompt user for permission
   */
  private promptUser(request: PermissionRequest): Promise<boolean> {
    return new Promise((resolve) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingRequests.get(request.id);
        if (pending) {
          this.pendingRequests.delete(request.id);
          const decision = this.preferences.defaultOnTimeout === 'allow';
          this.logPermissionDecision(request, decision, 'timeout');
          resolve(decision);
        }
      }, this.preferences.dialogTimeout);

      // Store pending request
      this.pendingRequests.set(request.id, {
        request,
        resolve,
        timeoutId,
      });

      // Emit event for UI
      this.emit('permission-requested', {
        ...request,
        categoryDescription: CATEGORY_DESCRIPTIONS[request.category],
        riskLabel: this.getRiskLabel(request.riskLevel),
        options: {
          canRemember: this.preferences.rememberForSession || this.preferences.rememberPermanently,
          showDetails: this.preferences.showDetails,
          timeout: this.preferences.dialogTimeout,
        },
      });

      logger.info('Awaiting user permission decision', {
        requestId: request.id,
        category: request.category,
      });
    });
  }

  /**
   * Respond to a permission request
   */
  respondToRequest(
    requestId: string,
    granted: boolean,
    options: {
      remember?: 'session' | 'permanent' | 'none';
      reason?: string;
    } = {}
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.warn('No pending request found', { requestId });
      return false;
    }

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    this.pendingRequests.delete(requestId);

    // Create grant if remembering
    const remember = options.remember || 'none';
    if (remember !== 'none') {
      const grant: PermissionGrant = {
        requestId,
        category: pending.request.category,
        operation: pending.request.operation,
        resource: pending.request.resource,
        granted,
        grantedAt: Date.now(),
        permanent: remember === 'permanent',
        reason: options.reason,
        grantedBy: 'user',
      };

      if (remember === 'permanent') {
        this.permanentGrants.set(this.getGrantKey(grant), grant);
        this.savePermanentGrants().catch((err) => {
          logger.warn('Failed to save permanent grants', { error: err.message });
        });
      } else {
        this.sessionGrants.set(this.getGrantKey(grant), grant);
      }
    }

    // Log and resolve
    this.logPermissionDecision(pending.request, granted, `user_decision_${remember}`);

    pending.resolve(granted);

    logger.info('Permission decision received', {
      requestId,
      granted,
      remember,
    });

    return true;
  }

  /**
   * Revoke a grant
   */
  revokeGrant(category: PermissionCategory, operation?: string, resource?: string): number {
    let revoked = 0;

    // Remove from session grants
    for (const [key, grant] of this.sessionGrants.entries()) {
      if (this.matchesGrant(grant, category, operation, resource)) {
        this.sessionGrants.delete(key);
        revoked++;
      }
    }

    // Remove from permanent grants
    for (const [key, grant] of this.permanentGrants.entries()) {
      if (this.matchesGrant(grant, category, operation, resource)) {
        this.permanentGrants.delete(key);
        revoked++;
      }
    }

    if (revoked > 0) {
      this.savePermanentGrants().catch((err) => {
        logger.warn('Failed to save after revocation', { error: err.message });
      });

      logger.info('Permissions revoked', { category, operation, resource, count: revoked });
      this.emit('grants-revoked', { category, operation, resource, count: revoked });
    }

    return revoked;
  }

  /**
   * Get all active grants
   */
  getActiveGrants(): PermissionGrant[] {
    const now = Date.now();
    const grants: PermissionGrant[] = [];

    // Session grants
    for (const grant of this.sessionGrants.values()) {
      if (!grant.expiresAt || grant.expiresAt > now) {
        grants.push(grant);
      }
    }

    // Permanent grants
    for (const grant of this.permanentGrants.values()) {
      if (!grant.expiresAt || grant.expiresAt > now) {
        grants.push(grant);
      }
    }

    return grants;
  }

  /**
   * Get pending permission requests
   */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request);
  }

  /**
   * Cancel a pending request
   */
  cancelRequest(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    this.pendingRequests.delete(requestId);
    pending.resolve(false);

    logger.info('Permission request cancelled', { requestId });

    return true;
  }

  /**
   * Update preferences
   */
  updatePreferences(updates: Partial<PermissionPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    logger.info('Preferences updated', { updates });
    this.emit('preferences-changed', this.preferences);
  }

  /**
   * Get current preferences
   */
  getPreferences(): Readonly<PermissionPreferences> {
    return { ...this.preferences };
  }

  /**
   * Clear all session grants
   */
  clearSessionGrants(): void {
    this.sessionGrants.clear();
    logger.info('Session grants cleared');
    this.emit('session-grants-cleared');
  }

  /**
   * Clear all permanent grants
   */
  async clearPermanentGrants(): Promise<void> {
    this.permanentGrants.clear();
    await this.savePermanentGrants();
    logger.info('Permanent grants cleared');
    this.emit('permanent-grants-cleared');
  }

  /**
   * Check if a category is auto-approved
   */
  isAutoApproved(category: PermissionCategory): boolean {
    return this.preferences.autoApprove.includes(category);
  }

  /**
   * Check if a category is auto-blocked
   */
  isAutoBlocked(category: PermissionCategory): boolean {
    return this.preferences.autoBlock.includes(category);
  }

  /**
   * Get risk label for display
   */
  private getRiskLabel(level: PermissionRiskLevel): string {
    const labels: Record<PermissionRiskLevel, string> = {
      low: 'Low Risk',
      medium: 'Medium Risk',
      high: 'High Risk',
      critical: 'Critical - Requires Approval',
    };
    return labels[level];
  }

  /**
   * Find an existing grant
   */
  private findExistingGrant(
    category: PermissionCategory,
    operation: string,
    resource?: string
  ): PermissionGrant | undefined {
    // Check permanent grants first
    for (const grant of this.permanentGrants.values()) {
      if (this.matchesGrant(grant, category, operation, resource)) {
        return grant;
      }
    }

    // Check session grants
    for (const grant of this.sessionGrants.values()) {
      if (this.matchesGrant(grant, category, operation, resource)) {
        return grant;
      }
    }

    return undefined;
  }

  /**
   * Check if a grant matches the criteria
   */
  private matchesGrant(
    grant: PermissionGrant,
    category: PermissionCategory,
    operation?: string,
    resource?: string
  ): boolean {
    if (grant.category !== category) return false;
    if (operation && grant.operation !== operation) return false;
    if (resource && grant.resource !== resource) return false;
    return true;
  }

  /**
   * Get grant key for storage
   */
  private getGrantKey(grant: PermissionGrant): string {
    return `${grant.category}:${grant.operation}:${grant.resource || '*'}`;
  }

  /**
   * Remove a grant by request ID
   */
  private removeGrant(requestId: string): void {
    for (const [key, grant] of this.sessionGrants.entries()) {
      if (grant.requestId === requestId) {
        this.sessionGrants.delete(key);
        return;
      }
    }

    for (const [key, grant] of this.permanentGrants.entries()) {
      if (grant.requestId === requestId) {
        this.permanentGrants.delete(key);
        return;
      }
    }
  }

  /**
   * Log permission decision
   */
  private logPermissionDecision(
    request: PermissionRequest,
    granted: boolean,
    reason: string
  ): void {
    this.auditLogger.log(
      'permission_decision',
      granted ? 'info' : 'warning',
      `Permission ${granted ? 'granted' : 'denied'}: ${request.category}/${request.operation}`,
      {
        action: `${request.category}:${request.operation}`,
        allowed: granted,
        reason,
        source: 'permission_manager',
        context: {
          requestId: request.id,
          category: request.category,
          operation: request.operation,
          resource: request.resource,
          riskLevel: request.riskLevel,
        },
      }
    );
  }

  /**
   * Load permanent grants from disk
   */
  private async loadPermanentGrants(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const grants = JSON.parse(data) as PermissionGrant[];

      for (const grant of grants) {
        this.permanentGrants.set(this.getGrantKey(grant), grant);
      }

      logger.info('Loaded permanent grants', { count: grants.length });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist yet, that's fine
    }
  }

  /**
   * Save permanent grants to disk
   */
  private async savePermanentGrants(): Promise<void> {
    const grants = Array.from(this.permanentGrants.values());
    const dirPath = path.dirname(this.configPath);

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(grants, null, 2));

    logger.debug('Saved permanent grants', { count: grants.length });
  }

  /**
   * Shutdown the permission manager
   */
  shutdown(): void {
    // Cancel all pending requests
    for (const [, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.resolve(false);
    }
    this.pendingRequests.clear();

    this.removeAllListeners();

    logger.info('PermissionManager shutdown complete');
  }
}

// Singleton instance
let permissionManagerInstance: PermissionManager | null = null;

/**
 * Get or create the singleton PermissionManager instance
 */
export function getPermissionManager(
  preferences?: Partial<PermissionPreferences>
): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager(preferences);
  }
  return permissionManagerInstance;
}

/**
 * Shutdown the permission manager
 */
export function shutdownPermissionManager(): void {
  if (permissionManagerInstance) {
    permissionManagerInstance.shutdown();
    permissionManagerInstance = null;
  }
}

export default PermissionManager;
