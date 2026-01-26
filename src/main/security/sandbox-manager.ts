/**
 * Atlas Desktop - Sandbox Manager
 * Provides sandboxed execution environment for agent tools (044-A)
 *
 * Features:
 * - Resource limits (CPU, memory, execution time)
 * - Network isolation options
 * - Filesystem sandboxing with allowed paths
 * - Process isolation and monitoring
 * - Permission levels for different operations
 *
 * @module security/sandbox-manager
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';
import { SafeTerminalExecutor, getSafeTerminalExecutor } from './safe-terminal-executor';
import type { TerminalResult, TerminalExecuteOptions } from '../../shared/types/agent';

const logger = createModuleLogger('SandboxManager');

/**
 * Sandbox permission levels
 */
export type SandboxLevel = 'none' | 'light' | 'medium' | 'strict' | 'isolated';

/**
 * Sandbox configuration for a specific operation
 */
export interface SandboxConfig {
  /** Sandbox level (higher = more restrictive) */
  level: SandboxLevel;

  /** Maximum execution time in milliseconds */
  maxExecutionTime: number;

  /** Maximum memory usage in bytes (estimated via output size) */
  maxMemory: number;

  /** Maximum output size in bytes */
  maxOutputSize: number;

  /** Allowed filesystem paths (read/write) */
  allowedPaths: string[];

  /** Read-only filesystem paths */
  readOnlyPaths: string[];

  /** Blocked filesystem paths (override allowed) */
  blockedPaths: string[];

  /** Allow network access */
  allowNetwork: boolean;

  /** Allow subprocess spawning */
  allowSubprocess: boolean;

  /** Allow environment variable access */
  allowEnvVars: boolean;

  /** Environment variables to block */
  blockedEnvVars: string[];

  /** Require user confirmation before execution */
  requireConfirmation: boolean;
}

/**
 * Default sandbox configurations by level
 */
export const SANDBOX_PRESETS: Record<SandboxLevel, SandboxConfig> = {
  none: {
    level: 'none',
    maxExecutionTime: 60000, // 1 minute
    maxMemory: 256 * 1024 * 1024, // 256MB
    maxOutputSize: 5 * 1024 * 1024, // 5MB
    allowedPaths: [],
    readOnlyPaths: [],
    blockedPaths: [],
    allowNetwork: true,
    allowSubprocess: true,
    allowEnvVars: true,
    blockedEnvVars: [],
    requireConfirmation: false,
  },
  light: {
    level: 'light',
    maxExecutionTime: 30000, // 30 seconds
    maxMemory: 128 * 1024 * 1024, // 128MB
    maxOutputSize: 2 * 1024 * 1024, // 2MB
    allowedPaths: [],
    readOnlyPaths: [],
    blockedPaths: [],
    allowNetwork: true,
    allowSubprocess: true,
    allowEnvVars: true,
    blockedEnvVars: ['AWS_SECRET', 'API_KEY', 'PASSWORD', 'TOKEN', 'SECRET'],
    requireConfirmation: false,
  },
  medium: {
    level: 'medium',
    maxExecutionTime: 15000, // 15 seconds
    maxMemory: 64 * 1024 * 1024, // 64MB
    maxOutputSize: 1024 * 1024, // 1MB
    allowedPaths: [],
    readOnlyPaths: [],
    blockedPaths: [],
    allowNetwork: false,
    allowSubprocess: true,
    allowEnvVars: false,
    blockedEnvVars: [],
    requireConfirmation: true,
  },
  strict: {
    level: 'strict',
    maxExecutionTime: 10000, // 10 seconds
    maxMemory: 32 * 1024 * 1024, // 32MB
    maxOutputSize: 512 * 1024, // 512KB
    allowedPaths: [],
    readOnlyPaths: [],
    blockedPaths: [],
    allowNetwork: false,
    allowSubprocess: false,
    allowEnvVars: false,
    blockedEnvVars: [],
    requireConfirmation: true,
  },
  isolated: {
    level: 'isolated',
    maxExecutionTime: 5000, // 5 seconds
    maxMemory: 16 * 1024 * 1024, // 16MB
    maxOutputSize: 256 * 1024, // 256KB
    allowedPaths: [],
    readOnlyPaths: [],
    blockedPaths: [],
    allowNetwork: false,
    allowSubprocess: false,
    allowEnvVars: false,
    blockedEnvVars: [],
    requireConfirmation: true,
  },
};

/**
 * Sandbox execution result
 */
export interface SandboxResult {
  success: boolean;
  data?: TerminalResult;
  error?: string;
  sandboxViolations?: string[];
  resourceUsage?: {
    executionTime: number;
    outputSize: number;
    memoryEstimate: number;
  };
  sandboxLevel: SandboxLevel;
  requiresConfirmation: boolean;
  confirmed?: boolean;
}

/**
 * Sandbox violation types
 */
export type SandboxViolationType =
  | 'path_blocked'
  | 'path_not_allowed'
  | 'network_blocked'
  | 'subprocess_blocked'
  | 'env_blocked'
  | 'time_exceeded'
  | 'memory_exceeded'
  | 'output_exceeded';

/**
 * Sandbox violation event
 */
export interface SandboxViolation {
  type: SandboxViolationType;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Sandbox Manager
 * Manages sandboxed execution of agent tools
 */
export class SandboxManager extends EventEmitter {
  private config: SandboxConfig;
  private terminalExecutor: SafeTerminalExecutor;
  private auditLogger = getAuditLogger();
  private projectRoot: string;
  private tempDir: string;
  private activeExecutions: Map<string, AbortController> = new Map();
  private pendingConfirmations: Map<
    string,
    { resolve: (confirmed: boolean) => void; config: SandboxConfig; command: string }
  > = new Map();

  constructor(projectRoot?: string, defaultLevel: SandboxLevel = 'medium') {
    super();

    this.projectRoot = projectRoot || process.cwd();
    this.tempDir = path.join(os.tmpdir(), 'atlas-sandbox');
    this.config = { ...SANDBOX_PRESETS[defaultLevel] };
    this.terminalExecutor = getSafeTerminalExecutor();

    // Set up default allowed paths based on project root
    this.config.allowedPaths = [this.projectRoot, this.tempDir, path.join(os.homedir(), '.atlas')];

    this.config.readOnlyPaths = ['/usr', '/bin', '/opt', path.join(os.homedir(), '.config')];

    // Default blocked paths (sensitive system directories)
    this.config.blockedPaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/hosts',
      path.join(os.homedir(), '.ssh'),
      path.join(os.homedir(), '.gnupg'),
      path.join(os.homedir(), '.aws'),
      'C:\\Windows\\System32',
      'C:\\Windows\\SysWOW64',
    ];

    logger.info('SandboxManager initialized', {
      projectRoot: this.projectRoot,
      defaultLevel,
      allowedPaths: this.config.allowedPaths,
    });
  }

  /**
   * Get current sandbox configuration
   */
  getConfig(): Readonly<SandboxConfig> {
    return { ...this.config };
  }

  /**
   * Update sandbox configuration
   */
  updateConfig(updates: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Sandbox config updated', { level: this.config.level });
    this.emit('config-changed', this.config);
  }

  /**
   * Set sandbox level
   */
  setLevel(level: SandboxLevel): void {
    const preset = SANDBOX_PRESETS[level];
    this.config = {
      ...preset,
      // Preserve custom paths
      allowedPaths: this.config.allowedPaths,
      readOnlyPaths: this.config.readOnlyPaths,
      blockedPaths: this.config.blockedPaths,
    };
    logger.info('Sandbox level changed', { level });
    this.emit('level-changed', level);
  }

  /**
   * Add allowed path
   */
  addAllowedPath(pathToAdd: string): void {
    const normalized = path.resolve(pathToAdd);
    if (!this.config.allowedPaths.includes(normalized)) {
      this.config.allowedPaths.push(normalized);
      logger.info('Added allowed path', { path: normalized });
    }
  }

  /**
   * Remove allowed path
   */
  removeAllowedPath(pathToRemove: string): void {
    const normalized = path.resolve(pathToRemove);
    const index = this.config.allowedPaths.indexOf(normalized);
    if (index !== -1) {
      this.config.allowedPaths.splice(index, 1);
      logger.info('Removed allowed path', { path: normalized });
    }
  }

  /**
   * Add blocked path
   */
  addBlockedPath(pathToBlock: string): void {
    const normalized = path.resolve(pathToBlock);
    if (!this.config.blockedPaths.includes(normalized)) {
      this.config.blockedPaths.push(normalized);
      logger.info('Added blocked path', { path: normalized });
    }
  }

  /**
   * Check if a path is allowed for access
   */
  isPathAllowed(targetPath: string, mode: 'read' | 'write' = 'read'): boolean {
    const normalized = path.resolve(targetPath);

    // Check blocked paths first (they override everything)
    for (const blocked of this.config.blockedPaths) {
      const normalizedBlocked = path.resolve(blocked);
      if (normalized === normalizedBlocked || normalized.startsWith(normalizedBlocked + path.sep)) {
        return false;
      }
    }

    // For write mode, only allowed paths are permitted
    if (mode === 'write') {
      for (const allowed of this.config.allowedPaths) {
        const normalizedAllowed = path.resolve(allowed);
        if (
          normalized === normalizedAllowed ||
          normalized.startsWith(normalizedAllowed + path.sep)
        ) {
          return true;
        }
      }
      return false;
    }

    // For read mode, check allowed and read-only paths
    for (const allowed of [...this.config.allowedPaths, ...this.config.readOnlyPaths]) {
      const normalizedAllowed = path.resolve(allowed);
      if (normalized === normalizedAllowed || normalized.startsWith(normalizedAllowed + path.sep)) {
        return true;
      }
    }

    // If no explicit allowed paths are configured, allow read from anywhere
    // except blocked paths (handled above)
    return this.config.allowedPaths.length === 0;
  }

  /**
   * Validate path access and return violations
   */
  validatePathAccess(targetPath: string, mode: 'read' | 'write'): SandboxViolation | null {
    const normalized = path.resolve(targetPath);

    // Check blocked paths
    for (const blocked of this.config.blockedPaths) {
      const normalizedBlocked = path.resolve(blocked);
      if (normalized === normalizedBlocked || normalized.startsWith(normalizedBlocked + path.sep)) {
        return {
          type: 'path_blocked',
          message: `Access to path "${targetPath}" is blocked`,
          details: { path: normalized, blockedPattern: normalizedBlocked },
          timestamp: Date.now(),
        };
      }
    }

    if (!this.isPathAllowed(targetPath, mode)) {
      return {
        type: 'path_not_allowed',
        message: `${mode === 'write' ? 'Write' : 'Read'} access to path "${targetPath}" is not allowed`,
        details: { path: normalized, mode },
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Filter environment variables based on sandbox config
   */
  filterEnvironment(): Record<string, string> {
    if (!this.config.allowEnvVars) {
      // Return minimal environment
      return {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || process.env.USERPROFILE || '',
        TEMP: process.env.TEMP || '/tmp',
        TMP: process.env.TMP || '/tmp',
      };
    }

    // Filter out blocked env vars
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      // Check if this env var should be blocked
      const shouldBlock = this.config.blockedEnvVars.some((blocked) =>
        key.toUpperCase().includes(blocked.toUpperCase())
      );

      if (!shouldBlock) {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(
    command: string,
    options: TerminalExecuteOptions & {
      sandboxLevel?: SandboxLevel;
      skipConfirmation?: boolean;
    } = {}
  ): Promise<SandboxResult> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startTime = Date.now();
    const violations: SandboxViolation[] = [];

    // Get effective config
    const effectiveConfig = options.sandboxLevel
      ? { ...SANDBOX_PRESETS[options.sandboxLevel], ...this.getPathConfig() }
      : this.config;

    logger.debug('Sandbox execution started', {
      executionId,
      command,
      level: effectiveConfig.level,
    });

    // Check if confirmation is required
    if (effectiveConfig.requireConfirmation && !options.skipConfirmation) {
      const confirmationResult: SandboxResult = {
        success: false,
        sandboxLevel: effectiveConfig.level,
        requiresConfirmation: true,
        confirmed: false,
      };

      // Emit event and wait for confirmation
      const confirmed = await this.requestConfirmation(executionId, command, effectiveConfig);

      if (!confirmed) {
        this.auditLogger.logSandboxExecution(command, false, {
          reason: 'User declined confirmation',
          sandboxLevel: effectiveConfig.level,
        });

        return confirmationResult;
      }

      confirmationResult.confirmed = true;
    }

    // Validate working directory
    if (options.cwd) {
      const cwdViolation = this.validatePathAccess(options.cwd, 'read');
      if (cwdViolation) {
        violations.push(cwdViolation);
        return {
          success: false,
          error: cwdViolation.message,
          sandboxViolations: violations.map((v) => v.message),
          sandboxLevel: effectiveConfig.level,
          requiresConfirmation: false,
        };
      }
    }

    // Set up abort controller for cancellation
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    try {
      // Execute with filtered environment
      const filteredEnv = this.filterEnvironment();

      const result = await this.terminalExecutor.execute(command, {
        ...options,
        cwd: options.cwd || this.projectRoot,
        timeout: Math.min(
          options.timeout || effectiveConfig.maxExecutionTime,
          effectiveConfig.maxExecutionTime
        ),
        maxOutputSize: effectiveConfig.maxOutputSize,
        env: filteredEnv,
      });

      const executionTime = Date.now() - startTime;
      const outputSize = (result.data?.stdout?.length || 0) + (result.data?.stderr?.length || 0);

      // Check for resource violations
      if (executionTime > effectiveConfig.maxExecutionTime) {
        violations.push({
          type: 'time_exceeded',
          message: `Execution time (${executionTime}ms) exceeded limit (${effectiveConfig.maxExecutionTime}ms)`,
          details: { actual: executionTime, limit: effectiveConfig.maxExecutionTime },
          timestamp: Date.now(),
        });
      }

      if (outputSize > effectiveConfig.maxOutputSize) {
        violations.push({
          type: 'output_exceeded',
          message: `Output size (${outputSize} bytes) exceeded limit (${effectiveConfig.maxOutputSize} bytes)`,
          details: { actual: outputSize, limit: effectiveConfig.maxOutputSize },
          timestamp: Date.now(),
        });
      }

      // Log the execution
      this.auditLogger.logSandboxExecution(command, result.success, {
        sandboxLevel: effectiveConfig.level,
        executionTime,
        violations: violations.map((v) => v.type),
      });

      // Emit completion event
      this.emit('execution-complete', {
        executionId,
        command,
        success: result.success,
        violations,
      });

      return {
        success: result.success && violations.length === 0,
        data: result.data,
        error: result.error || (violations.length > 0 ? violations[0].message : undefined),
        sandboxViolations: violations.map((v) => v.message),
        resourceUsage: {
          executionTime,
          outputSize,
          memoryEstimate: outputSize * 2, // Rough estimate
        },
        sandboxLevel: effectiveConfig.level,
        requiresConfirmation: false,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error('Sandbox execution failed', {
        executionId,
        command,
        error: err.message,
      });

      this.auditLogger.logSandboxExecution(command, false, {
        sandboxLevel: effectiveConfig.level,
        error: err.message,
      });

      return {
        success: false,
        error: err.message,
        sandboxLevel: effectiveConfig.level,
        requiresConfirmation: false,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Request user confirmation for an operation
   */
  private requestConfirmation(
    executionId: string,
    command: string,
    config: SandboxConfig
  ): Promise<boolean> {
    return new Promise((resolve) => {
      // Store the pending confirmation
      this.pendingConfirmations.set(executionId, { resolve, config, command });

      // Emit event for UI to handle
      this.emit('confirmation-required', {
        executionId,
        command,
        sandboxLevel: config.level,
        timestamp: Date.now(),
      });

      // Auto-reject after 30 seconds
      setTimeout(() => {
        const pending = this.pendingConfirmations.get(executionId);
        if (pending) {
          this.pendingConfirmations.delete(executionId);
          resolve(false);
        }
      }, 30000);
    });
  }

  /**
   * Confirm or reject a pending execution
   */
  confirmExecution(executionId: string, confirmed: boolean): boolean {
    const pending = this.pendingConfirmations.get(executionId);
    if (!pending) {
      return false;
    }

    this.pendingConfirmations.delete(executionId);
    pending.resolve(confirmed);

    logger.info('Execution confirmation received', {
      executionId,
      confirmed,
      command: pending.command,
    });

    return true;
  }

  /**
   * Cancel an active execution
   */
  cancelExecution(executionId: string): boolean {
    const controller = this.activeExecutions.get(executionId);
    if (!controller) {
      return false;
    }

    controller.abort();
    this.activeExecutions.delete(executionId);

    logger.info('Execution cancelled', { executionId });
    this.emit('execution-cancelled', { executionId });

    return true;
  }

  /**
   * Get pending confirmations
   */
  getPendingConfirmations(): Array<{
    executionId: string;
    command: string;
    sandboxLevel: SandboxLevel;
  }> {
    return Array.from(this.pendingConfirmations.entries()).map(([id, pending]) => ({
      executionId: id,
      command: pending.command,
      sandboxLevel: pending.config.level,
    }));
  }

  /**
   * Get path configuration (for merging with presets)
   */
  private getPathConfig(): Pick<SandboxConfig, 'allowedPaths' | 'readOnlyPaths' | 'blockedPaths'> {
    return {
      allowedPaths: this.config.allowedPaths,
      readOnlyPaths: this.config.readOnlyPaths,
      blockedPaths: this.config.blockedPaths,
    };
  }

  /**
   * Create a sandbox temp directory
   */
  async createSandboxTempDir(): Promise<string> {
    const dirName = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dirPath = path.join(this.tempDir, dirName);

    await fs.mkdir(dirPath, { recursive: true });
    this.addAllowedPath(dirPath);

    logger.debug('Created sandbox temp directory', { path: dirPath });

    return dirPath;
  }

  /**
   * Clean up sandbox temp directories
   */
  async cleanupTempDirs(maxAge: number = 3600000): Promise<number> {
    let cleaned = 0;

    try {
      const entries = await fs.readdir(this.tempDir, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('sandbox-')) {
          const dirPath = path.join(this.tempDir, entry.name);
          const stats = await fs.stat(dirPath);

          if (now - stats.ctimeMs > maxAge) {
            await fs.rm(dirPath, { recursive: true, force: true });
            this.removeAllowedPath(dirPath);
            cleaned++;
          }
        }
      }
    } catch (error) {
      // Temp dir might not exist yet
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to cleanup temp dirs', { error });
      }
    }

    logger.debug('Cleaned up sandbox temp directories', { count: cleaned });

    return cleaned;
  }

  /**
   * Shutdown the sandbox manager
   */
  shutdown(): void {
    // Cancel all active executions
    for (const [executionId, controller] of this.activeExecutions.entries()) {
      controller.abort();
      logger.debug('Cancelled execution on shutdown', { executionId });
    }
    this.activeExecutions.clear();

    // Reject all pending confirmations
    for (const [, pending] of this.pendingConfirmations.entries()) {
      pending.resolve(false);
    }
    this.pendingConfirmations.clear();

    this.removeAllListeners();

    logger.info('SandboxManager shutdown complete');
  }
}

// Singleton instance
let sandboxManagerInstance: SandboxManager | null = null;

/**
 * Get or create the singleton SandboxManager instance
 */
export function getSandboxManager(
  projectRoot?: string,
  defaultLevel?: SandboxLevel
): SandboxManager {
  if (!sandboxManagerInstance) {
    sandboxManagerInstance = new SandboxManager(projectRoot, defaultLevel);
  }
  return sandboxManagerInstance;
}

/**
 * Shutdown the sandbox manager
 */
export function shutdownSandboxManager(): void {
  if (sandboxManagerInstance) {
    sandboxManagerInstance.shutdown();
    sandboxManagerInstance = null;
  }
}

export default SandboxManager;
