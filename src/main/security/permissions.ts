/**
 * Atlas Desktop - Granular Permission System
 * Fine-grained permission controls for tool execution
 *
 * Features:
 * - Per-tool permission requirements
 * - Context-aware permission caching
 * - User approval flow for sensitive actions
 * - Permission revocation and audit trail
 * - Default deny for dangerous operations
 *
 * @module security/permissions
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';
import type {} from '../../shared/types/agent';

const logger = createModuleLogger('Permissions');

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Permission scope types
 */
export type PermissionScope =
  | 'file' // File system operations
  | 'network' // Network access
  | 'system' // System operations
  | 'terminal' // Terminal/command execution
  | 'browser' // Browser automation
  | 'clipboard' // Clipboard access
  | 'screenshot' // Screen capture
  | 'memory' // Memory/storage access
  | 'git' // Git operations
  | 'api' // External API calls
  | 'notification' // System notifications
  | 'audio' // Audio recording/playback
  | 'process' // Process management
  | 'registry'; // Windows registry (Windows only)

/**
 * Permission action types for each scope
 */
export interface PermissionActions {
  file: 'read' | 'write' | 'delete' | 'create' | 'list' | 'execute';
  network: 'connect' | 'listen' | 'download' | 'upload';
  system: 'info' | 'settings' | 'shutdown' | 'restart';
  terminal: 'execute' | 'background' | 'interactive';
  browser: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract';
  clipboard: 'read' | 'write' | 'clear';
  screenshot: 'capture' | 'record';
  memory: 'read' | 'write' | 'delete' | 'search';
  git: 'read' | 'write' | 'push' | 'delete_branch';
  api: 'request' | 'stream';
  notification: 'send';
  audio: 'record' | 'playback';
  process: 'spawn' | 'kill' | 'list';
  registry: 'read' | 'write' | 'delete';
}

/**
 * Full permission identifier
 */
export interface PermissionId {
  scope: PermissionScope;
  action: string;
  resource?: string; // Optional resource path/URL
}

/**
 * Permission risk level
 */
export type PermissionRisk = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'blocked';

/**
 * Permission state
 */
export type PermissionState = 'granted' | 'denied' | 'pending' | 'expired';

/**
 * Permission duration type
 */
export type PermissionDuration = 'once' | 'session' | 'hour' | 'day' | 'week' | 'permanent';

/**
 * Tool permission requirement
 */
export interface ToolPermissionRequirement {
  toolName: string;
  scope: PermissionScope;
  action: string;
  risk: PermissionRisk;
  description: string;
  resourcePattern?: RegExp | string;
  requiresExplicitApproval?: boolean;
  defaultDeny?: boolean;
}

/**
 * Permission entry stored in the system
 */
export interface PermissionEntry {
  id: string;
  scope: PermissionScope;
  action: string;
  resource?: string;
  resourcePattern?: string;
  state: PermissionState;
  risk: PermissionRisk;
  grantedAt?: number;
  expiresAt?: number;
  duration: PermissionDuration;
  grantedBy: 'user' | 'system' | 'policy';
  toolName?: string;
  usageCount: number;
  lastUsed?: number;
  context?: string; // Context identifier for contextual permissions
  notes?: string;
}

/**
 * Permission request for user approval
 */
export interface PermissionApprovalRequest {
  id: string;
  scope: PermissionScope;
  action: string;
  resource?: string;
  toolName: string;
  risk: PermissionRisk;
  description: string;
  context?: string;
  timestamp: number;
  timeout: number;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  permission?: PermissionEntry;
  requiresApproval: boolean;
  risk: PermissionRisk;
  suggestedDuration?: PermissionDuration;
}

/**
 * Permission audit entry
 */
export interface PermissionAuditEntry {
  timestamp: number;
  permissionId: string;
  scope: PermissionScope;
  action: string;
  resource?: string;
  toolName?: string;
  result: 'granted' | 'denied' | 'revoked' | 'expired';
  reason?: string;
  context?: string;
}

/**
 * Permission policy configuration
 */
export interface PermissionPolicy {
  /** Default decision when no matching permission exists */
  defaultDecision: 'deny' | 'prompt';

  /** Auto-approve safe operations */
  autoApproveSafe: boolean;

  /** Maximum duration for auto-approved permissions */
  maxAutoApproveDuration: PermissionDuration;

  /** Scopes that always require explicit approval */
  alwaysPromptScopes: PermissionScope[];

  /** Risk levels that always require approval */
  alwaysPromptRisks: PermissionRisk[];

  /** Blocked scopes (never allowed) */
  blockedScopes: PermissionScope[];

  /** Timeout for approval dialogs (ms) */
  approvalTimeout: number;

  /** Decision when approval times out */
  timeoutDecision: 'deny' | 'allow';

  /** Enable contextual permissions */
  enableContextualPermissions: boolean;

  /** Maximum permissions to remember */
  maxCachedPermissions: number;
}

/**
 * Default permission policy
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  defaultDecision: 'prompt',
  autoApproveSafe: true,
  maxAutoApproveDuration: 'session',
  alwaysPromptScopes: ['system', 'registry', 'process'],
  alwaysPromptRisks: ['high', 'critical'],
  blockedScopes: [],
  approvalTimeout: 30000,
  timeoutDecision: 'deny',
  enableContextualPermissions: true,
  maxCachedPermissions: 1000,
};

// ============================================================================
// Tool Permission Requirements
// ============================================================================

/**
 * Define permission requirements for each tool
 */
export const TOOL_PERMISSION_REQUIREMENTS: ToolPermissionRequirement[] = [
  // Filesystem tools
  {
    toolName: 'file_read',
    scope: 'file',
    action: 'read',
    risk: 'low',
    description: 'Read file contents',
  },
  {
    toolName: 'file_write',
    scope: 'file',
    action: 'write',
    risk: 'medium',
    description: 'Write or modify file contents',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'file_delete',
    scope: 'file',
    action: 'delete',
    risk: 'high',
    description: 'Delete files or directories',
    requiresExplicitApproval: true,
    defaultDeny: true,
  },
  {
    toolName: 'file_list',
    scope: 'file',
    action: 'list',
    risk: 'safe',
    description: 'List directory contents',
  },
  {
    toolName: 'file_search',
    scope: 'file',
    action: 'read',
    risk: 'low',
    description: 'Search files by pattern',
  },

  // Terminal tools
  {
    toolName: 'terminal_execute',
    scope: 'terminal',
    action: 'execute',
    risk: 'high',
    description: 'Execute terminal commands',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'terminal_background',
    scope: 'terminal',
    action: 'background',
    risk: 'high',
    description: 'Run background processes',
    requiresExplicitApproval: true,
  },

  // Browser tools
  {
    toolName: 'browser_navigate',
    scope: 'browser',
    action: 'navigate',
    risk: 'medium',
    description: 'Navigate to web pages',
  },
  {
    toolName: 'browser_click',
    scope: 'browser',
    action: 'click',
    risk: 'medium',
    description: 'Click elements on web pages',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'browser_type',
    scope: 'browser',
    action: 'type',
    risk: 'high',
    description: 'Type text into web pages',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'browser_screenshot',
    scope: 'browser',
    action: 'screenshot',
    risk: 'low',
    description: 'Capture browser screenshots',
  },

  // Clipboard tools
  {
    toolName: 'clipboard_read',
    scope: 'clipboard',
    action: 'read',
    risk: 'medium',
    description: 'Read clipboard contents',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'clipboard_write',
    scope: 'clipboard',
    action: 'write',
    risk: 'low',
    description: 'Write to clipboard',
  },

  // Screenshot tools
  {
    toolName: 'screenshot_capture',
    scope: 'screenshot',
    action: 'capture',
    risk: 'medium',
    description: 'Capture screen screenshots',
    requiresExplicitApproval: true,
  },

  // Git tools
  {
    toolName: 'git_status',
    scope: 'git',
    action: 'read',
    risk: 'safe',
    description: 'Check Git repository status',
  },
  {
    toolName: 'git_diff',
    scope: 'git',
    action: 'read',
    risk: 'safe',
    description: 'View Git differences',
  },
  {
    toolName: 'git_commit',
    scope: 'git',
    action: 'write',
    risk: 'medium',
    description: 'Create Git commits',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'git_push',
    scope: 'git',
    action: 'push',
    risk: 'high',
    description: 'Push changes to remote',
    requiresExplicitApproval: true,
    defaultDeny: true,
  },
  {
    toolName: 'git_branch_delete',
    scope: 'git',
    action: 'delete_branch',
    risk: 'high',
    description: 'Delete Git branches',
    requiresExplicitApproval: true,
    defaultDeny: true,
  },

  // API/Search tools
  {
    toolName: 'web_search',
    scope: 'network',
    action: 'connect',
    risk: 'low',
    description: 'Search the web',
  },
  {
    toolName: 'fetch_url',
    scope: 'network',
    action: 'download',
    risk: 'low',
    description: 'Fetch content from URLs',
  },

  // System tools
  {
    toolName: 'app_launch',
    scope: 'process',
    action: 'spawn',
    risk: 'medium',
    description: 'Launch applications',
    requiresExplicitApproval: true,
  },
  {
    toolName: 'system_info',
    scope: 'system',
    action: 'info',
    risk: 'safe',
    description: 'Get system information',
  },
];

// ============================================================================
// Risk Configuration
// ============================================================================

/**
 * Risk level descriptions for UI
 */
export const RISK_DESCRIPTIONS: Record<
  PermissionRisk,
  {
    label: string;
    description: string;
    color: string;
  }
> = {
  safe: {
    label: 'Safe',
    description: 'No risk - read-only or informational',
    color: '#4CAF50',
  },
  low: {
    label: 'Low Risk',
    description: 'Minimal risk - limited impact if misused',
    color: '#8BC34A',
  },
  medium: {
    label: 'Medium Risk',
    description: 'Moderate risk - could affect files or network',
    color: '#FFC107',
  },
  high: {
    label: 'High Risk',
    description: 'Significant risk - could delete data or execute code',
    color: '#FF9800',
  },
  critical: {
    label: 'Critical',
    description: 'Extreme risk - system-level access required',
    color: '#F44336',
  },
  blocked: {
    label: 'Blocked',
    description: 'This operation is not allowed',
    color: '#9E9E9E',
  },
};

/**
 * Suggested durations based on risk level
 */
export const RISK_SUGGESTED_DURATIONS: Record<PermissionRisk, PermissionDuration> = {
  safe: 'permanent',
  low: 'session',
  medium: 'session',
  high: 'once',
  critical: 'once',
  blocked: 'once',
};

// ============================================================================
// Permission Controller
// ============================================================================

/**
 * Granular Permission Controller
 * Manages fine-grained permissions for tool execution
 */
export class PermissionController extends EventEmitter {
  private policy: PermissionPolicy;
  private permissions: Map<string, PermissionEntry> = new Map();
  private pendingApprovals: Map<
    string,
    {
      request: PermissionApprovalRequest;
      resolve: (result: { approved: boolean; duration?: PermissionDuration }) => void;
      timeoutId?: NodeJS.Timeout;
    }
  > = new Map();
  private auditLog: PermissionAuditEntry[] = [];
  private configPath: string;
  private auditLogger = getAuditLogger();
  private toolRequirements: Map<string, ToolPermissionRequirement> = new Map();

  constructor(policy?: Partial<PermissionPolicy>) {
    super();

    this.policy = { ...DEFAULT_PERMISSION_POLICY, ...policy };
    this.configPath = path.join(homedir(), '.atlas', 'permissions-v2.json');

    // Index tool requirements for fast lookup
    for (const req of TOOL_PERMISSION_REQUIREMENTS) {
      this.toolRequirements.set(req.toolName, req);
    }

    // Load saved permissions
    this.loadPermissions().catch((err) => {
      logger.warn('Failed to load permissions', { error: err.message });
    });

    // Start cleanup timer for expired permissions
    this.startCleanupTimer();

    logger.info('PermissionController initialized', {
      policy: this.policy,
      toolCount: this.toolRequirements.size,
    });
  }

  // ============================================================================
  // Core Permission Checking
  // ============================================================================

  /**
   * Check if a tool has permission to perform an action
   */
  async checkToolPermission(
    toolName: string,
    resource?: string,
    context?: string
  ): Promise<PermissionCheckResult> {
    const requirement = this.toolRequirements.get(toolName);

    if (!requirement) {
      // Unknown tool - use default behavior
      return {
        allowed: this.policy.defaultDecision === 'allow',
        reason: 'Unknown tool - no permission requirement defined',
        requiresApproval: this.policy.defaultDecision === 'prompt',
        risk: 'medium',
      };
    }

    return this.checkPermission(requirement.scope, requirement.action, resource, toolName, context);
  }

  /**
   * Check permission for a scope/action combination
   */
  async checkPermission(
    scope: PermissionScope,
    action: string,
    resource?: string,
    toolName?: string,
    context?: string
  ): Promise<PermissionCheckResult> {
    const permissionKey = this.buildPermissionKey(scope, action, resource, context);
    const requirement = toolName ? this.toolRequirements.get(toolName) : undefined;
    const risk = requirement?.risk ?? this.inferRisk(scope, action);

    // Check if scope is blocked
    if (this.policy.blockedScopes.includes(scope)) {
      this.logAudit(
        permissionKey,
        scope,
        action,
        resource,
        toolName,
        'denied',
        'Scope is blocked',
        context
      );
      return {
        allowed: false,
        reason: `Permission scope "${scope}" is blocked by policy`,
        requiresApproval: false,
        risk: 'blocked',
      };
    }

    // Check for existing permission
    const existing = this.findMatchingPermission(scope, action, resource, context);
    if (existing) {
      // Check if permission is still valid
      if (existing.expiresAt && existing.expiresAt < Date.now()) {
        // Permission expired
        this.permissions.delete(existing.id);
        this.logAudit(
          existing.id,
          scope,
          action,
          resource,
          toolName,
          'expired',
          'Permission expired',
          context
        );
      } else if (existing.state === 'granted') {
        // Update usage stats
        existing.usageCount++;
        existing.lastUsed = Date.now();
        await this.savePermissions();

        this.logAudit(
          existing.id,
          scope,
          action,
          resource,
          toolName,
          'granted',
          'Cached permission',
          context
        );
        return {
          allowed: true,
          reason: 'Permission granted (cached)',
          permission: existing,
          requiresApproval: false,
          risk,
        };
      } else if (existing.state === 'denied') {
        this.logAudit(
          existing.id,
          scope,
          action,
          resource,
          toolName,
          'denied',
          'Previously denied',
          context
        );
        return {
          allowed: false,
          reason: 'Permission was previously denied',
          permission: existing,
          requiresApproval: false,
          risk,
        };
      }
    }

    // Auto-approve safe operations if policy allows
    if (this.policy.autoApproveSafe && risk === 'safe') {
      const entry = await this.grantPermission(
        scope,
        action,
        resource,
        this.policy.maxAutoApproveDuration,
        'system',
        risk,
        toolName,
        context
      );

      this.logAudit(
        entry.id,
        scope,
        action,
        resource,
        toolName,
        'granted',
        'Auto-approved (safe)',
        context
      );
      return {
        allowed: true,
        reason: 'Auto-approved as safe operation',
        permission: entry,
        requiresApproval: false,
        risk,
      };
    }

    // Check if explicit approval is required
    const needsApproval = this.requiresExplicitApproval(scope, action, risk, requirement);

    if (needsApproval) {
      return {
        allowed: false,
        reason: 'User approval required',
        requiresApproval: true,
        risk,
        suggestedDuration: RISK_SUGGESTED_DURATIONS[risk],
      };
    }

    // Default decision based on policy
    if (this.policy.defaultDecision === 'deny') {
      return {
        allowed: false,
        reason: 'Default policy is to deny',
        requiresApproval: false,
        risk,
      };
    }

    // Default: prompt for approval
    return {
      allowed: false,
      reason: 'User approval required',
      requiresApproval: true,
      risk,
      suggestedDuration: RISK_SUGGESTED_DURATIONS[risk],
    };
  }

  /**
   * Request user approval for a permission
   */
  async requestApproval(
    scope: PermissionScope,
    action: string,
    resource: string | undefined,
    toolName: string,
    description?: string,
    context?: string
  ): Promise<{ approved: boolean; duration?: PermissionDuration }> {
    const requirement = this.toolRequirements.get(toolName);
    const risk = requirement?.risk ?? this.inferRisk(scope, action);

    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const request: PermissionApprovalRequest = {
      id: requestId,
      scope,
      action,
      resource,
      toolName,
      risk,
      description:
        description ??
        requirement?.description ??
        `${toolName} requires ${scope}:${action} permission`,
      context,
      timestamp: Date.now(),
      timeout: this.policy.approvalTimeout,
    };

    return new Promise((resolve) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingApprovals.get(requestId);
        if (pending) {
          this.pendingApprovals.delete(requestId);

          const decision = this.policy.timeoutDecision === 'allow';
          this.logAudit(
            requestId,
            scope,
            action,
            resource,
            toolName,
            decision ? 'granted' : 'denied',
            'Approval timeout',
            context
          );

          resolve({ approved: decision });
        }
      }, this.policy.approvalTimeout);

      // Store pending request
      this.pendingApprovals.set(requestId, {
        request,
        resolve,
        timeoutId,
      });

      // Emit event for UI
      this.emit('approval-requested', request);

      logger.info('Permission approval requested', {
        requestId,
        scope,
        action,
        toolName,
        risk,
      });
    });
  }

  /**
   * Respond to a pending approval request
   */
  async respondToApproval(
    requestId: string,
    approved: boolean,
    duration: PermissionDuration = 'once',
    notes?: string
  ): Promise<boolean> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      logger.warn('No pending approval found', { requestId });
      return false;
    }

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    this.pendingApprovals.delete(requestId);

    const { request } = pending;

    // Create permission entry if approved
    if (approved) {
      await this.grantPermission(
        request.scope,
        request.action,
        request.resource,
        duration,
        'user',
        request.risk,
        request.toolName,
        request.context,
        notes
      );
    } else {
      // Store denial to remember user's choice
      const entry = await this.createPermissionEntry(
        request.scope,
        request.action,
        request.resource,
        'denied',
        duration,
        'user',
        request.risk,
        request.toolName,
        request.context,
        notes
      );
      this.permissions.set(entry.id, entry);
      await this.savePermissions();
    }

    this.logAudit(
      requestId,
      request.scope,
      request.action,
      request.resource,
      request.toolName,
      approved ? 'granted' : 'denied',
      approved ? `User approved (${duration})` : 'User denied',
      request.context
    );

    // Resolve the promise
    pending.resolve({ approved, duration });

    // Emit event
    this.emit('approval-responded', { requestId, approved, duration });

    logger.info('Permission approval responded', {
      requestId,
      approved,
      duration,
      toolName: request.toolName,
    });

    return true;
  }

  // ============================================================================
  // Permission Management
  // ============================================================================

  /**
   * Grant a permission
   */
  async grantPermission(
    scope: PermissionScope,
    action: string,
    resource: string | undefined,
    duration: PermissionDuration,
    grantedBy: 'user' | 'system' | 'policy',
    risk: PermissionRisk,
    toolName?: string,
    context?: string,
    notes?: string
  ): Promise<PermissionEntry> {
    const entry = await this.createPermissionEntry(
      scope,
      action,
      resource,
      'granted',
      duration,
      grantedBy,
      risk,
      toolName,
      context,
      notes
    );

    this.permissions.set(entry.id, entry);
    await this.savePermissions();

    this.emit('permission-granted', entry);

    logger.info('Permission granted', {
      id: entry.id,
      scope,
      action,
      resource,
      duration,
      toolName,
    });

    return entry;
  }

  /**
   * Revoke a permission
   */
  async revokePermission(permissionId: string, reason?: string): Promise<boolean> {
    const permission = this.permissions.get(permissionId);
    if (!permission) {
      return false;
    }

    this.permissions.delete(permissionId);
    await this.savePermissions();

    this.logAudit(
      permissionId,
      permission.scope,
      permission.action,
      permission.resource,
      permission.toolName,
      'revoked',
      reason ?? 'User revoked',
      permission.context
    );

    this.emit('permission-revoked', { permissionId, permission, reason });

    logger.info('Permission revoked', { permissionId, reason });

    return true;
  }

  /**
   * Revoke all permissions for a scope
   */
  async revokeByScope(scope: PermissionScope, reason?: string): Promise<number> {
    let count = 0;

    for (const [id, permission] of this.permissions.entries()) {
      if (permission.scope === scope) {
        await this.revokePermission(id, reason);
        count++;
      }
    }

    return count;
  }

  /**
   * Revoke all permissions for a tool
   */
  async revokeByTool(toolName: string, reason?: string): Promise<number> {
    let count = 0;

    for (const [id, permission] of this.permissions.entries()) {
      if (permission.toolName === toolName) {
        await this.revokePermission(id, reason);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear all session permissions
   */
  async clearSessionPermissions(): Promise<number> {
    let count = 0;

    for (const [id, permission] of this.permissions.entries()) {
      if (permission.duration === 'session') {
        this.permissions.delete(id);
        count++;
      }
    }

    if (count > 0) {
      await this.savePermissions();
      this.emit('session-permissions-cleared', { count });
    }

    logger.info('Session permissions cleared', { count });

    return count;
  }

  /**
   * Clear all permissions
   */
  async clearAllPermissions(reason?: string): Promise<number> {
    const count = this.permissions.size;

    this.permissions.clear();
    await this.savePermissions();

    this.emit('all-permissions-cleared', { count, reason });

    logger.info('All permissions cleared', { count, reason });

    return count;
  }

  // ============================================================================
  // Permission Query
  // ============================================================================

  /**
   * Get all permissions
   */
  getAllPermissions(): PermissionEntry[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Get permissions by scope
   */
  getPermissionsByScope(scope: PermissionScope): PermissionEntry[] {
    return Array.from(this.permissions.values()).filter((p) => p.scope === scope);
  }

  /**
   * Get permissions by tool
   */
  getPermissionsByTool(toolName: string): PermissionEntry[] {
    return Array.from(this.permissions.values()).filter((p) => p.toolName === toolName);
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): PermissionApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((p) => p.request);
  }

  /**
   * Get permission statistics
   */
  getStatistics(): {
    total: number;
    granted: number;
    denied: number;
    expired: number;
    byScope: Record<PermissionScope, number>;
    byRisk: Record<PermissionRisk, number>;
    pendingApprovals: number;
  } {
    const stats = {
      total: this.permissions.size,
      granted: 0,
      denied: 0,
      expired: 0,
      byScope: {} as Record<PermissionScope, number>,
      byRisk: {} as Record<PermissionRisk, number>,
      pendingApprovals: this.pendingApprovals.size,
    };

    const now = Date.now();

    for (const permission of this.permissions.values()) {
      if (permission.expiresAt && permission.expiresAt < now) {
        stats.expired++;
      } else if (permission.state === 'granted') {
        stats.granted++;
      } else if (permission.state === 'denied') {
        stats.denied++;
      }

      stats.byScope[permission.scope] = (stats.byScope[permission.scope] ?? 0) + 1;
      stats.byRisk[permission.risk] = (stats.byRisk[permission.risk] ?? 0) + 1;
    }

    return stats;
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit: number = 100): PermissionAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Get tool permission requirements
   */
  getToolRequirements(): ToolPermissionRequirement[] {
    return Array.from(this.toolRequirements.values());
  }

  /**
   * Get requirement for a specific tool
   */
  getToolRequirement(toolName: string): ToolPermissionRequirement | undefined {
    return this.toolRequirements.get(toolName);
  }

  // ============================================================================
  // Policy Management
  // ============================================================================

  /**
   * Get current policy
   */
  getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }

  /**
   * Update policy
   */
  updatePolicy(updates: Partial<PermissionPolicy>): void {
    this.policy = { ...this.policy, ...updates };

    this.emit('policy-updated', this.policy);

    logger.info('Permission policy updated', { updates });
  }

  /**
   * Add a scope to the blocked list
   */
  blockScope(scope: PermissionScope): void {
    if (!this.policy.blockedScopes.includes(scope)) {
      this.policy.blockedScopes.push(scope);
      this.emit('scope-blocked', { scope });
    }
  }

  /**
   * Remove a scope from the blocked list
   */
  unblockScope(scope: PermissionScope): void {
    const index = this.policy.blockedScopes.indexOf(scope);
    if (index !== -1) {
      this.policy.blockedScopes.splice(index, 1);
      this.emit('scope-unblocked', { scope });
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build a unique permission key
   */
  private buildPermissionKey(
    scope: PermissionScope,
    action: string,
    resource?: string,
    context?: string
  ): string {
    const parts = [scope, action];
    if (resource) parts.push(resource);
    if (context && this.policy.enableContextualPermissions) parts.push(context);
    return parts.join(':');
  }

  /**
   * Find a matching permission entry
   */
  private findMatchingPermission(
    scope: PermissionScope,
    action: string,
    resource?: string,
    context?: string
  ): PermissionEntry | undefined {
    for (const permission of this.permissions.values()) {
      if (permission.scope !== scope || permission.action !== action) {
        continue;
      }

      // Check resource match
      if (permission.resource && resource) {
        if (permission.resourcePattern) {
          const pattern = new RegExp(permission.resourcePattern);
          if (!pattern.test(resource)) continue;
        } else if (permission.resource !== resource) {
          continue;
        }
      }

      // Check context match if contextual permissions are enabled
      if (this.policy.enableContextualPermissions && permission.context && context) {
        if (permission.context !== context) continue;
      }

      return permission;
    }

    return undefined;
  }

  /**
   * Check if explicit approval is required
   */
  private requiresExplicitApproval(
    scope: PermissionScope,
    action: string,
    risk: PermissionRisk,
    requirement?: ToolPermissionRequirement
  ): boolean {
    // Check if requirement explicitly requires approval
    if (requirement?.requiresExplicitApproval) {
      return true;
    }

    // Check if requirement has default deny
    if (requirement?.defaultDeny) {
      return true;
    }

    // Check if scope always requires approval
    if (this.policy.alwaysPromptScopes.includes(scope)) {
      return true;
    }

    // Check if risk level always requires approval
    if (this.policy.alwaysPromptRisks.includes(risk)) {
      return true;
    }

    return false;
  }

  /**
   * Infer risk level from scope and action
   */
  private inferRisk(scope: PermissionScope, action: string): PermissionRisk {
    // System-level operations are high risk
    if (['system', 'registry', 'process'].includes(scope)) {
      return 'critical';
    }

    // Delete operations are high risk
    if (['delete', 'remove', 'kill'].includes(action)) {
      return 'high';
    }

    // Write operations are medium risk
    if (['write', 'modify', 'create', 'push'].includes(action)) {
      return 'medium';
    }

    // Read operations are low risk
    if (['read', 'list', 'info', 'status'].includes(action)) {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Create a permission entry
   */
  private async createPermissionEntry(
    scope: PermissionScope,
    action: string,
    resource: string | undefined,
    state: PermissionState,
    duration: PermissionDuration,
    grantedBy: 'user' | 'system' | 'policy',
    risk: PermissionRisk,
    toolName?: string,
    context?: string,
    notes?: string
  ): Promise<PermissionEntry> {
    const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();

    let expiresAt: number | undefined;
    switch (duration) {
      case 'once':
        expiresAt = now + 1; // Expires immediately after first use
        break;
      case 'hour':
        expiresAt = now + 60 * 60 * 1000;
        break;
      case 'day':
        expiresAt = now + 24 * 60 * 60 * 1000;
        break;
      case 'week':
        expiresAt = now + 7 * 24 * 60 * 60 * 1000;
        break;
      case 'session':
      case 'permanent':
        expiresAt = undefined; // Session permissions cleared on restart
        break;
    }

    return {
      id,
      scope,
      action,
      resource,
      state,
      risk,
      grantedAt: now,
      expiresAt,
      duration,
      grantedBy,
      toolName,
      usageCount: 0,
      context,
      notes,
    };
  }

  /**
   * Log permission audit entry
   */
  private logAudit(
    permissionId: string,
    scope: PermissionScope,
    action: string,
    resource: string | undefined,
    toolName: string | undefined,
    result: 'granted' | 'denied' | 'revoked' | 'expired',
    reason?: string,
    context?: string
  ): void {
    const entry: PermissionAuditEntry = {
      timestamp: Date.now(),
      permissionId,
      scope,
      action,
      resource,
      toolName,
      result,
      reason,
      context,
    };

    this.auditLog.push(entry);

    // Keep audit log size manageable
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }

    // Also log to the security audit logger
    this.auditLogger.log(
      'authorization',
      result === 'denied' || result === 'revoked' ? 'warning' : 'info',
      `Permission ${result}: ${scope}:${action}${resource ? ` (${resource})` : ''}`,
      {
        action: `permission:${scope}:${action}`,
        allowed: result === 'granted',
        reason,
        source: 'permission_controller',
        context: {
          permissionId,
          scope,
          action: action,
          resource,
          toolName,
          result,
          context,
        },
      }
    );
  }

  /**
   * Load permissions from disk
   */
  private async loadPermissions(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const saved = JSON.parse(data) as {
        permissions: PermissionEntry[];
        policy?: Partial<PermissionPolicy>;
      };

      // Load permissions (skip expired ones)
      const now = Date.now();
      for (const permission of saved.permissions) {
        // Skip session permissions (they expire on restart)
        if (permission.duration === 'session') {
          continue;
        }

        // Skip expired permissions
        if (permission.expiresAt && permission.expiresAt < now) {
          continue;
        }

        this.permissions.set(permission.id, permission);
      }

      // Load policy updates
      if (saved.policy) {
        this.policy = { ...this.policy, ...saved.policy };
      }

      logger.info('Permissions loaded', { count: this.permissions.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist yet, that's fine
    }
  }

  /**
   * Save permissions to disk
   */
  private async savePermissions(): Promise<void> {
    // Only save non-session permissions
    const permissionsToSave = Array.from(this.permissions.values()).filter(
      (p) => p.duration !== 'session' && p.duration !== 'once'
    );

    const data = {
      permissions: permissionsToSave,
      policy: this.policy,
    };

    const dirPath = path.dirname(this.configPath);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));

    logger.debug('Permissions saved', { count: permissionsToSave.length });
  }

  /**
   * Start cleanup timer for expired permissions
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredPermissions();
    }, 60000); // Every minute
  }

  /**
   * Clean up expired permissions
   */
  private cleanupExpiredPermissions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, permission] of this.permissions.entries()) {
      if (permission.expiresAt && permission.expiresAt < now) {
        this.permissions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.savePermissions().catch((err) => {
        logger.warn('Failed to save after cleanup', { error: err.message });
      });

      logger.debug('Expired permissions cleaned', { count: cleaned });
    }
  }

  /**
   * Shutdown the permission controller
   */
  async shutdown(): Promise<void> {
    // Cancel all pending approvals
    for (const [, pending] of this.pendingApprovals.entries()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.resolve({ approved: false });
    }
    this.pendingApprovals.clear();

    // Save permissions
    await this.savePermissions();

    this.removeAllListeners();

    logger.info('PermissionController shutdown complete');
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

let permissionControllerInstance: PermissionController | null = null;

/**
 * Get or create the singleton PermissionController instance
 */
export function getPermissionController(policy?: Partial<PermissionPolicy>): PermissionController {
  if (!permissionControllerInstance) {
    permissionControllerInstance = new PermissionController(policy);
  }
  return permissionControllerInstance;
}

/**
 * Shutdown the permission controller
 */
export async function shutdownPermissionController(): Promise<void> {
  if (permissionControllerInstance) {
    await permissionControllerInstance.shutdown();
    permissionControllerInstance = null;
  }
}

export default PermissionController;
