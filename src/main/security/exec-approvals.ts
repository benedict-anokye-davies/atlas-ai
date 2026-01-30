/**
 * @fileoverview Exec Approvals - Command execution approval system
 * @module security/exec-approvals
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Provides configurable approval modes for command execution:
 * - deny: Block all exec commands
 * - allowlist: Only allow pre-approved command patterns
 * - ask: Prompt user for each command
 * - full: Allow all commands (dangerous)
 *
 * Integrates with the SafeTerminalExecutor for command validation.
 *
 * @example
 * const approvals = getExecApprovals();
 * const result = await approvals.checkCommand('git pull origin main');
 * if (result.approved) {
 *   await executor.execute(result.command);
 * }
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app, dialog, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';

const logger = createModuleLogger('ExecApprovals');

// ============================================================================
// Types
// ============================================================================

/**
 * Execution approval modes
 */
export type ExecApprovalMode = 'deny' | 'allowlist' | 'ask' | 'full';

/**
 * Command pattern entry for allowlist/denylist
 */
export interface CommandPattern {
  /** Pattern ID */
  id: string;

  /** Pattern (supports glob-like matching) */
  pattern: string;

  /** Human-readable description */
  description: string;

  /** Risk level */
  riskLevel: 'safe' | 'moderate' | 'dangerous';

  /** Whether this is a regex pattern */
  isRegex: boolean;

  /** Creation timestamp */
  createdAt: number;

  /** Who added this pattern */
  addedBy: 'system' | 'user';
}

/**
 * Approval result
 */
export interface ApprovalResult {
  /** Whether the command was approved */
  approved: boolean;

  /** Reason for decision */
  reason: string;

  /** The (possibly sanitized) command */
  command: string;

  /** Matched pattern if applicable */
  matchedPattern?: string;

  /** Whether user was prompted */
  userPrompted: boolean;

  /** User's response if prompted */
  userResponse?: 'allow' | 'deny' | 'allow_always' | 'deny_always' | 'timeout';

  /** Processing time in ms */
  processingTime: number;
}

/**
 * Pending approval request
 */
export interface PendingApproval {
  id: string;
  command: string;
  sessionId: string;
  requestedAt: number;
  resolve: (result: ApprovalResult) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Exec approval configuration
 */
export interface ExecApprovalConfig {
  /** Approval mode */
  mode: ExecApprovalMode;

  /** Allowed command patterns (for allowlist mode) */
  allowlist: CommandPattern[];

  /** Blocked command patterns (always checked, wins over allowlist) */
  denylist: CommandPattern[];

  /** Timeout for user prompts (ms) */
  promptTimeout: number;

  /** Default decision on timeout */
  defaultOnTimeout: 'deny' | 'allow';

  /** Whether to remember user decisions */
  rememberDecisions: boolean;

  /** Auto-approve safe commands even in ask mode */
  autoApproveSafe: boolean;
}

/**
 * Exec approval events
 */
export interface ExecApprovalEvents {
  'command:approved': (command: string, reason: string) => void;
  'command:denied': (command: string, reason: string) => void;
  'command:pending': (command: string, id: string) => void;
  'mode:changed': (oldMode: ExecApprovalMode, newMode: ExecApprovalMode) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default safe command patterns
 */
export const DEFAULT_SAFE_PATTERNS: CommandPattern[] = [
  {
    id: 'git-info',
    pattern: 'git (status|log|diff|branch|remote|tag)',
    description: 'Git information commands (read-only)',
    riskLevel: 'safe',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'npm-info',
    pattern: 'npm (list|ls|outdated|view|info|audit)',
    description: 'NPM information commands',
    riskLevel: 'safe',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'list-commands',
    pattern: '(ls|dir|cat|type|head|tail|wc|pwd|echo)',
    description: 'Basic listing/read commands',
    riskLevel: 'safe',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
];

/**
 * Default dangerous patterns (always blocked)
 */
export const DEFAULT_DANGEROUS_PATTERNS: CommandPattern[] = [
  {
    id: 'rm-rf',
    pattern: 'rm\\s+-rf?\\s+/',
    description: 'Recursive force delete from root',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'format-drive',
    pattern: '(format|mkfs|fdisk)',
    description: 'Disk formatting commands',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'system-shutdown',
    pattern: '(shutdown|reboot|halt|poweroff)',
    description: 'System shutdown commands',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'registry-edit',
    pattern: '(reg|regedit)',
    description: 'Windows registry editing',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'curl-bash',
    pattern: 'curl.*\\|.*bash',
    description: 'Piping curl to bash (code execution)',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
  {
    id: 'fork-bomb',
    pattern: ':\\(\\)\\{\\s*:|:&\\s*\\};:',
    description: 'Fork bomb pattern',
    riskLevel: 'dangerous',
    isRegex: true,
    createdAt: Date.now(),
    addedBy: 'system',
  },
];

/**
 * Default configuration
 */
export const DEFAULT_EXEC_APPROVAL_CONFIG: ExecApprovalConfig = {
  mode: 'allowlist',
  allowlist: [...DEFAULT_SAFE_PATTERNS],
  denylist: [...DEFAULT_DANGEROUS_PATTERNS],
  promptTimeout: 30000,
  defaultOnTimeout: 'deny',
  rememberDecisions: true,
  autoApproveSafe: true,
};

// ============================================================================
// Exec Approvals Manager
// ============================================================================

/**
 * Manages command execution approvals with configurable policies.
 *
 * Supports four modes:
 * - deny: Block all commands
 * - allowlist: Only allow pre-approved patterns
 * - ask: Prompt user for each command
 * - full: Allow all commands
 *
 * @class ExecApprovals
 * @extends EventEmitter
 *
 * @example
 * const approvals = getExecApprovals();
 *
 * // Set mode
 * approvals.setMode('allowlist');
 *
 * // Check a command
 * const result = await approvals.checkCommand('git status');
 * if (result.approved) {
 *   console.log('Command approved:', result.reason);
 * }
 */
export class ExecApprovals extends EventEmitter {
  private config: ExecApprovalConfig;
  private auditLogger: AuditLogger;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private rememberedDecisions: Map<string, 'allow' | 'deny'> = new Map();
  private configPath: string;
  private initialized = false;

  constructor(config?: Partial<ExecApprovalConfig>) {
    super();
    this.config = { ...DEFAULT_EXEC_APPROVAL_CONFIG, ...config };
    this.configPath = path.join(app.getPath('userData'), 'exec-approvals.json');
    this.auditLogger = getAuditLogger();

    logger.info('ExecApprovals initialized', {
      mode: this.config.mode,
      allowlistCount: this.config.allowlist.length,
      denylistCount: this.config.denylist.length,
    });
  }

  /**
   * Initialize and load persisted config
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const saved = JSON.parse(data) as Partial<ExecApprovalConfig> & {
        rememberedDecisions?: Record<string, 'allow' | 'deny'>;
      };

      // Merge saved config
      this.config = {
        ...this.config,
        mode: saved.mode ?? this.config.mode,
        allowlist: [...DEFAULT_SAFE_PATTERNS, ...(saved.allowlist ?? []).filter(p => p.addedBy === 'user')],
        denylist: [...DEFAULT_DANGEROUS_PATTERNS, ...(saved.denylist ?? []).filter(p => p.addedBy === 'user')],
      };

      // Restore remembered decisions
      if (saved.rememberedDecisions) {
        for (const [cmd, decision] of Object.entries(saved.rememberedDecisions)) {
          this.rememberedDecisions.set(cmd, decision);
        }
      }

      logger.info('Loaded exec approval config', {
        mode: this.config.mode,
        rememberedDecisions: this.rememberedDecisions.size,
      });
    } catch {
      logger.debug('No persisted exec approval config found');
    }

    this.initialized = true;
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<void> {
    const data = {
      mode: this.config.mode,
      allowlist: this.config.allowlist.filter(p => p.addedBy === 'user'),
      denylist: this.config.denylist.filter(p => p.addedBy === 'user'),
      promptTimeout: this.config.promptTimeout,
      defaultOnTimeout: this.config.defaultOnTimeout,
      rememberDecisions: this.config.rememberDecisions,
      autoApproveSafe: this.config.autoApproveSafe,
      rememberedDecisions: Object.fromEntries(this.rememberedDecisions),
    };

    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));

    logger.debug('Saved exec approval config');
  }

  /**
   * Match command against a pattern
   */
  private _matchPattern(command: string, pattern: CommandPattern): boolean {
    try {
      if (pattern.isRegex) {
        const regex = new RegExp(pattern.pattern, 'i');
        return regex.test(command);
      } else {
        // Simple glob-like matching
        const regexPattern = pattern.pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(command);
      }
    } catch (error) {
      logger.warn('Pattern matching error', { pattern: pattern.pattern, error });
      return false;
    }
  }

  /**
   * Check if command matches denylist
   */
  private _isDenied(command: string): CommandPattern | undefined {
    return this.config.denylist.find(p => this._matchPattern(command, p));
  }

  /**
   * Check if command matches allowlist
   */
  private _isAllowed(command: string): CommandPattern | undefined {
    return this.config.allowlist.find(p => this._matchPattern(command, p));
  }

  /**
   * Prompt user for approval
   */
  private async _promptUser(command: string, sessionId: string): Promise<ApprovalResult> {
    const startTime = Date.now();
    const id = `approval-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    return new Promise<ApprovalResult>((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(id);

        const result: ApprovalResult = {
          approved: this.config.defaultOnTimeout === 'allow',
          reason: 'Approval timeout',
          command,
          userPrompted: true,
          userResponse: 'timeout',
          processingTime: Date.now() - startTime,
        };

        logger.warn('Approval timeout', { command, sessionId });
        resolve(result);
      }, this.config.promptTimeout);

      // Store pending approval
      this.pendingApprovals.set(id, {
        id,
        command,
        sessionId,
        requestedAt: Date.now(),
        resolve: (result) => {
          clearTimeout(timeout);
          this.pendingApprovals.delete(id);
          resolve(result);
        },
        timeout,
      });

      this.emit('command:pending', command, id);

      // Show dialog
      const mainWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

      if (!mainWindow) {
        // No window, use default decision
        clearTimeout(timeout);
        this.pendingApprovals.delete(id);
        resolve({
          approved: this.config.defaultOnTimeout === 'allow',
          reason: 'No window available for prompt',
          command,
          userPrompted: false,
          processingTime: Date.now() - startTime,
        });
        return;
      }

      dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Command Approval Required',
        message: 'Atlas wants to run a command',
        detail: `Command: ${command}\n\nDo you want to allow this?`,
        buttons: ['Deny', 'Allow', 'Always Allow', 'Always Deny'],
        defaultId: 0,
        cancelId: 0,
      }).then(({ response }) => {
        clearTimeout(timeout);
        this.pendingApprovals.delete(id);

        let approved = false;
        let userResponse: ApprovalResult['userResponse'];

        switch (response) {
          case 1: // Allow
            approved = true;
            userResponse = 'allow';
            break;
          case 2: // Always Allow
            approved = true;
            userResponse = 'allow_always';
            if (this.config.rememberDecisions) {
              this.rememberedDecisions.set(command, 'allow');
              void this.save();
            }
            break;
          case 3: // Always Deny
            approved = false;
            userResponse = 'deny_always';
            if (this.config.rememberDecisions) {
              this.rememberedDecisions.set(command, 'deny');
              void this.save();
            }
            break;
          default: // Deny
            approved = false;
            userResponse = 'deny';
        }

        resolve({
          approved,
          reason: `User ${approved ? 'approved' : 'denied'}`,
          command,
          userPrompted: true,
          userResponse,
          processingTime: Date.now() - startTime,
        });
      }).catch(() => {
        clearTimeout(timeout);
        this.pendingApprovals.delete(id);
        resolve({
          approved: false,
          reason: 'Dialog error',
          command,
          userPrompted: true,
          processingTime: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Check if a command is approved for execution
   */
  async checkCommand(command: string, sessionId?: string): Promise<ApprovalResult> {
    const startTime = Date.now();
    const effectiveSessionId = sessionId ?? 'default';

    // Always check denylist first
    const deniedPattern = this._isDenied(command);
    if (deniedPattern) {
      const result: ApprovalResult = {
        approved: false,
        reason: `Blocked by denylist: ${deniedPattern.description}`,
        command,
        matchedPattern: deniedPattern.pattern,
        userPrompted: false,
        processingTime: Date.now() - startTime,
      };

      this.emit('command:denied', command, result.reason);
      this.auditLogger.log(
        'authorization',
        'warning',
        `Exec denied: ${command}`,
        {
          action: 'exec_denied',
          allowed: false,
          reason: 'denylist',
          source: 'exec-approvals',
          sessionId: effectiveSessionId,
          context: {
            command,
            pattern: deniedPattern.pattern,
          },
        }
      );

      return result;
    }

    // Check remembered decisions
    const remembered = this.rememberedDecisions.get(command);
    if (remembered) {
      const approved = remembered === 'allow';
      const result: ApprovalResult = {
        approved,
        reason: `Remembered decision: ${remembered}`,
        command,
        userPrompted: false,
        processingTime: Date.now() - startTime,
      };

      this.emit(approved ? 'command:approved' : 'command:denied', command, result.reason);
      return result;
    }

    // Handle based on mode
    switch (this.config.mode) {
      case 'deny': {
        const result: ApprovalResult = {
          approved: false,
          reason: 'Mode: deny - all commands blocked',
          command,
          userPrompted: false,
          processingTime: Date.now() - startTime,
        };
        this.emit('command:denied', command, result.reason);
        return result;
      }

      case 'full': {
        const result: ApprovalResult = {
          approved: true,
          reason: 'Mode: full - all commands allowed',
          command,
          userPrompted: false,
          processingTime: Date.now() - startTime,
        };
        this.emit('command:approved', command, result.reason);

        this.auditLogger.log(
          'authorization',
          'info',
          `Exec approved (full mode): ${command}`,
          {
            action: 'exec_approved',
            allowed: true,
            reason: 'full_mode',
            source: 'exec-approvals',
            sessionId: effectiveSessionId,
            context: { command },
          }
        );

        return result;
      }

      case 'allowlist': {
        const allowedPattern = this._isAllowed(command);
        if (allowedPattern) {
          const result: ApprovalResult = {
            approved: true,
            reason: `Matched allowlist: ${allowedPattern.description}`,
            command,
            matchedPattern: allowedPattern.pattern,
            userPrompted: false,
            processingTime: Date.now() - startTime,
          };
          this.emit('command:approved', command, result.reason);

          this.auditLogger.log(
            'authorization',
            'info',
            `Exec approved (allowlist): ${command}`,
            {
              action: 'exec_approved',
              allowed: true,
              reason: 'allowlist',
              source: 'exec-approvals',
              sessionId: effectiveSessionId,
              context: {
                command,
                pattern: allowedPattern.pattern,
              },
            }
          );

          return result;
        }

        const result: ApprovalResult = {
          approved: false,
          reason: 'Not in allowlist',
          command,
          userPrompted: false,
          processingTime: Date.now() - startTime,
        };
        this.emit('command:denied', command, result.reason);
        return result;
      }

      case 'ask': {
        // Auto-approve safe commands if enabled
        if (this.config.autoApproveSafe) {
          const safePattern = this._isAllowed(command);
          if (safePattern && safePattern.riskLevel === 'safe') {
            const result: ApprovalResult = {
              approved: true,
              reason: `Auto-approved safe command: ${safePattern.description}`,
              command,
              matchedPattern: safePattern.pattern,
              userPrompted: false,
              processingTime: Date.now() - startTime,
            };
            this.emit('command:approved', command, result.reason);
            return result;
          }
        }

        // Prompt user
        return this._promptUser(command, effectiveSessionId);
      }

      default: {
        logger.error('Unknown approval mode', { mode: this.config.mode });
        return {
          approved: false,
          reason: 'Unknown mode',
          command,
          userPrompted: false,
          processingTime: Date.now() - startTime,
        };
      }
    }
  }

  /**
   * Set approval mode
   */
  setMode(mode: ExecApprovalMode): void {
    const oldMode = this.config.mode;
    this.config.mode = mode;

    this.emit('mode:changed', oldMode, mode);

    logger.info('Approval mode changed', { oldMode, newMode: mode });

    this.auditLogger.log(
      'authorization',
      'warning',
      `Exec approval mode changed from ${oldMode} to ${mode}`,
      {
        action: 'mode_changed',
        allowed: true,
        source: 'exec-approvals',
        context: { oldMode, newMode: mode },
      }
    );

    void this.save();
  }

  /**
   * Get current mode
   */
  getMode(): ExecApprovalMode {
    return this.config.mode;
  }

  /**
   * Add pattern to allowlist
   */
  addToAllowlist(pattern: Omit<CommandPattern, 'id' | 'createdAt' | 'addedBy'>): CommandPattern {
    const entry: CommandPattern = {
      ...pattern,
      id: `user-allow-${Date.now().toString(36)}`,
      createdAt: Date.now(),
      addedBy: 'user',
    };

    this.config.allowlist.push(entry);
    logger.info('Added to allowlist', { pattern: entry.pattern });
    void this.save();

    return entry;
  }

  /**
   * Add pattern to denylist
   */
  addToDenylist(pattern: Omit<CommandPattern, 'id' | 'createdAt' | 'addedBy'>): CommandPattern {
    const entry: CommandPattern = {
      ...pattern,
      id: `user-deny-${Date.now().toString(36)}`,
      createdAt: Date.now(),
      addedBy: 'user',
    };

    this.config.denylist.push(entry);
    logger.info('Added to denylist', { pattern: entry.pattern });
    void this.save();

    return entry;
  }

  /**
   * Remove pattern from allowlist
   */
  removeFromAllowlist(patternId: string): boolean {
    const index = this.config.allowlist.findIndex(p => p.id === patternId && p.addedBy === 'user');
    if (index >= 0) {
      this.config.allowlist.splice(index, 1);
      void this.save();
      return true;
    }
    return false;
  }

  /**
   * Remove pattern from denylist
   */
  removeFromDenylist(patternId: string): boolean {
    const index = this.config.denylist.findIndex(p => p.id === patternId && p.addedBy === 'user');
    if (index >= 0) {
      this.config.denylist.splice(index, 1);
      void this.save();
      return true;
    }
    return false;
  }

  /**
   * Get allowlist
   */
  getAllowlist(): CommandPattern[] {
    return [...this.config.allowlist];
  }

  /**
   * Get denylist
   */
  getDenylist(): CommandPattern[] {
    return [...this.config.denylist];
  }

  /**
   * Clear remembered decisions
   */
  clearRememberedDecisions(): void {
    this.rememberedDecisions.clear();
    void this.save();
    logger.info('Cleared remembered decisions');
  }

  /**
   * Cancel pending approval
   */
  cancelPendingApproval(id: string, deny = true): void {
    const pending = this.pendingApprovals.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        approved: !deny,
        reason: 'Cancelled',
        command: pending.command,
        userPrompted: true,
        processingTime: Date.now() - pending.requestedAt,
      });
      this.pendingApprovals.delete(id);
    }
  }

  /**
   * Get all pending approvals
   */
  getPendingApprovals(): Array<{ id: string; command: string; sessionId: string; requestedAt: number }> {
    return Array.from(this.pendingApprovals.values()).map(p => ({
      id: p.id,
      command: p.command,
      sessionId: p.sessionId,
      requestedAt: p.requestedAt,
    }));
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    // Cancel all pending approvals
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timeout);
      pending.resolve({
        approved: false,
        reason: 'Shutdown',
        command: pending.command,
        userPrompted: false,
        processingTime: Date.now() - pending.requestedAt,
      });
    }
    this.pendingApprovals.clear();

    await this.save();
    logger.info('ExecApprovals shutdown');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ExecApprovals | null = null;

/**
 * Get the singleton ExecApprovals instance
 */
export function getExecApprovals(): ExecApprovals {
  if (!instance) {
    instance = new ExecApprovals();
  }
  return instance;
}

/**
 * Shutdown ExecApprovals
 */
export async function shutdownExecApprovals(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
