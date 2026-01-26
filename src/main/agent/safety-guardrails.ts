/**
 * Atlas Safety Guardrails
 *
 * Minimal-interruption safety checks for sensitive operations.
 * Ben's preference: Only confirm truly sensitive files (credentials, keys, etc.)
 * All other operations proceed freely with full logging for audit trail.
 *
 * @module agent/safety-guardrails
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, basename, normalize } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SafetyGuardrails');

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Operation types that can be performed */
export type OperationType = 'file' | 'git' | 'system' | 'network';

/** An operation to be checked/logged */
export interface Operation {
  type: OperationType;
  action: string;
  target: string;
  details?: Record<string, unknown>;
}

/** Result of an operation */
export interface OperationResult {
  success: boolean;
  confirmed: boolean;
  output?: string;
  error?: string;
  timestamp: Date;
}

/** Logged operation entry */
export interface OperationLog {
  id: string;
  operation: Operation;
  result: OperationResult;
  timestamp: Date;
}

/** Filter options for querying operation logs */
export interface OperationLogFilter {
  type?: OperationType;
  action?: string;
  targetPattern?: string | RegExp;
  fromDate?: Date;
  toDate?: Date;
  successOnly?: boolean;
  failedOnly?: boolean;
  confirmedOnly?: boolean;
}

/** Events emitted by SafetyGuardrails */
export interface SafetyGuardrailsEvents {
  /** Operation was logged */
  'operation-logged': (log: OperationLog) => void;
  /** Confirmation was required */
  'confirmation-required': (operation: Operation, prompt: string) => void;
  /** Sensitive file detected */
  'sensitive-file-detected': (path: string, patterns: string[]) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Patterns for sensitive files that require confirmation */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /\.env$/i,
  /\.env\.\w+$/i,
  /credentials\.json$/i,
  /secrets?\.json$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /id_rsa/i,
  /\.ssh\//i,
  /api[_-]?key/i,
  /password/i,
  /token\.json$/i,
];

/** Pattern names for logging purposes */
const SENSITIVE_PATTERN_NAMES: Map<RegExp, string> = new Map([
  [SENSITIVE_FILE_PATTERNS[0], '.env file'],
  [SENSITIVE_FILE_PATTERNS[1], '.env.* file'],
  [SENSITIVE_FILE_PATTERNS[2], 'credentials.json'],
  [SENSITIVE_FILE_PATTERNS[3], 'secrets file'],
  [SENSITIVE_FILE_PATTERNS[4], 'PEM certificate'],
  [SENSITIVE_FILE_PATTERNS[5], 'private key'],
  [SENSITIVE_FILE_PATTERNS[6], 'certificate'],
  [SENSITIVE_FILE_PATTERNS[7], 'SSH key'],
  [SENSITIVE_FILE_PATTERNS[8], 'SSH directory'],
  [SENSITIVE_FILE_PATTERNS[9], 'API key file'],
  [SENSITIVE_FILE_PATTERNS[10], 'password file'],
  [SENSITIVE_FILE_PATTERNS[11], 'token file'],
]);

/** JARVIS-style confirmation prompts */
const CONFIRMATION_PROMPTS: string[] = [
  'Ben, this involves {file}. Should I proceed?',
  'This will modify your {type}. Continue?',
  'About to touch {file}. Green light?',
  'I need to access {file}. Permission granted?',
  'This operation affects {type}. Shall I continue?',
  "Ben, I'm about to modify {file}. Go ahead?",
];

/** Default log file location - stored in Obsidian brain for visibility */
const DEFAULT_LOG_PATH = `${homedir()}/.atlas/brain/logs/operation-log.json`;

/** Maximum number of operations to keep in log */
const MAX_LOG_ENTRIES = 1000;

// ============================================================================
// SafetyGuardrails Class
// ============================================================================

/**
 * Safety guardrails for Atlas operations.
 *
 * Implements Ben's minimal-interruption philosophy:
 * - Only sensitive files (credentials, keys, etc.) require confirmation
 * - All operations are logged regardless of confirmation status
 * - Full audit trail maintained for review
 *
 * @example
 * ```typescript
 * const guardrails = new SafetyGuardrails();
 *
 * // Check if operation needs confirmation
 * const op = { type: 'file', action: 'write', target: '.env' };
 * if (guardrails.needsConfirmation(op)) {
 *   const prompt = guardrails.getConfirmationPrompt(op);
 *   // Ask user for confirmation
 * }
 *
 * // Log the operation result
 * guardrails.logOperation(op, { success: true, confirmed: true, timestamp: new Date() });
 * ```
 */
export class SafetyGuardrails extends EventEmitter {
  private logPath: string;
  private operationLog: OperationLog[] = [];
  private bypassMode: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(logPath?: string) {
    super();
    this.logPath = logPath || DEFAULT_LOG_PATH;
    this.loadLog();
    logger.info('SafetyGuardrails initialized', { logPath: this.logPath });
  }

  // ==========================================================================
  // Confirmation Checks
  // ==========================================================================

  /**
   * Check if an operation needs confirmation.
   *
   * Per Ben's preference, only sensitive file operations require confirmation.
   * Git operations, system commands, network requests, and non-sensitive files
   * proceed freely.
   *
   * @param operation - The operation to check
   * @returns True if confirmation is required
   */
  public needsConfirmation(operation: Operation): boolean {
    // Bypass mode skips all confirmations
    if (this.bypassMode) {
      return false;
    }

    // Only file operations on sensitive files need confirmation
    if (operation.type === 'file') {
      return this.isSensitiveFile(operation.target);
    }

    // All other operations proceed freely per Ben's preference
    // This includes:
    // - git push --force, reset --hard, clean -fd
    // - Files outside project directory
    // - Mass deletions (rm -rf)
    // - System modifications
    return false;
  }

  /**
   * Check if an operation needs confirmation without logging.
   *
   * Use this for pre-flight checks where you want to know if confirmation
   * will be needed but don't want to create a log entry yet.
   *
   * @param operation - The operation to check
   * @returns True if confirmation would be required
   */
  public wouldNeedConfirmation(operation: Operation): boolean {
    // Same logic as needsConfirmation but explicitly doesn't log
    if (this.bypassMode) {
      return false;
    }

    if (operation.type === 'file') {
      return this.isSensitiveFileInternal(operation.target);
    }

    return false;
  }

  /**
   * Check if a file path is considered sensitive.
   *
   * Sensitive files include:
   * - Environment files (.env, .env.*)
   * - Credential files (credentials.json, secrets.json)
   * - Cryptographic keys (.pem, .key, .crt, id_rsa)
   * - SSH directory contents
   * - Files with api_key, password, or token in name
   *
   * @param filePath - Path to check
   * @returns True if file is sensitive
   */
  public isSensitiveFile(filePath: string): boolean {
    const isSensitive = this.isSensitiveFileInternal(filePath);

    if (isSensitive) {
      const matchedPatterns = this.getMatchingSensitivePatterns(filePath);
      this.emit('sensitive-file-detected', filePath, matchedPatterns);
      logger.debug('Sensitive file detected', { path: filePath, patterns: matchedPatterns });
    }

    return isSensitive;
  }

  /**
   * Internal sensitive file check without emitting events.
   */
  private isSensitiveFileInternal(filePath: string): boolean {
    const normalizedPath = normalize(filePath).toLowerCase();
    const fileName = basename(filePath).toLowerCase();

    // Check against all sensitive patterns
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(normalizedPath) || pattern.test(fileName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get list of sensitive patterns that match a file path.
   */
  private getMatchingSensitivePatterns(filePath: string): string[] {
    const normalizedPath = normalize(filePath).toLowerCase();
    const fileName = basename(filePath).toLowerCase();
    const matches: string[] = [];

    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(normalizedPath) || pattern.test(fileName)) {
        const name = SENSITIVE_PATTERN_NAMES.get(pattern) || pattern.source;
        matches.push(name);
      }
    }

    return matches;
  }

  // ==========================================================================
  // Confirmation Prompts
  // ==========================================================================

  /**
   * Generate a JARVIS-style confirmation prompt for an operation.
   *
   * @param operation - The operation needing confirmation
   * @returns Natural language prompt string
   */
  public getConfirmationPrompt(operation: Operation): string {
    const template = this.selectPromptTemplate(operation);
    const fileType = this.getSensitiveFileType(operation.target);

    const prompt = template
      .replace('{file}', this.formatTargetForPrompt(operation.target))
      .replace('{type}', fileType)
      .replace('{action}', operation.action);

    this.emit('confirmation-required', operation, prompt);
    return prompt;
  }

  /**
   * Select an appropriate prompt template based on operation type.
   */
  private selectPromptTemplate(operation: Operation): string {
    // Use a consistent but varied selection
    const hash = this.simpleHash(operation.target + operation.action);
    const index = hash % CONFIRMATION_PROMPTS.length;
    return CONFIRMATION_PROMPTS[index];
  }

  /**
   * Format a target path for display in prompts.
   */
  private formatTargetForPrompt(target: string): string {
    const fileName = basename(target);

    // For common sensitive files, use friendly names
    if (/\.env$/i.test(fileName)) return 'your .env file';
    if (/\.env\.\w+$/i.test(fileName)) return `your ${fileName} file`;
    if (/credentials\.json$/i.test(fileName)) return 'your credentials file';
    if (/secrets?\.json$/i.test(fileName)) return 'your secrets file';
    if (/id_rsa/i.test(fileName)) return 'your SSH private key';
    if (/\.pem$/i.test(fileName)) return 'a PEM certificate';
    if (/\.key$/i.test(fileName)) return 'a private key file';

    return fileName;
  }

  /**
   * Get a descriptive type for a sensitive file.
   */
  private getSensitiveFileType(target: string): string {
    const fileName = basename(target).toLowerCase();

    if (/\.env/i.test(fileName)) return 'environment configuration';
    if (/credentials/i.test(fileName)) return 'credentials';
    if (/secrets?/i.test(fileName)) return 'secrets';
    if (/id_rsa|\.pem|\.key/i.test(fileName)) return 'cryptographic key';
    if (/\.crt/i.test(fileName)) return 'certificate';
    if (/api[_-]?key/i.test(fileName)) return 'API key file';
    if (/password/i.test(fileName)) return 'password file';
    if (/token/i.test(fileName)) return 'token file';

    return 'sensitive file';
  }

  /**
   * Simple hash function for deterministic prompt selection.
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // ==========================================================================
  // Operation Logging
  // ==========================================================================

  /**
   * Log an operation and its result.
   *
   * All operations are logged regardless of whether they required confirmation.
   * This provides a complete audit trail for review.
   *
   * @param operation - The operation that was performed
   * @param result - The result of the operation
   * @returns The created log entry
   */
  public logOperation(operation: Operation, result: OperationResult): OperationLog {
    const log: OperationLog = {
      id: randomUUID(),
      operation,
      result: {
        ...result,
        timestamp: result.timestamp || new Date(),
      },
      timestamp: new Date(),
    };

    // Add to in-memory log
    this.operationLog.push(log);

    // Trim if over limit
    if (this.operationLog.length > MAX_LOG_ENTRIES) {
      this.operationLog = this.operationLog.slice(-MAX_LOG_ENTRIES);
    }

    // Persist to disk (thread-safe)
    this.persistLog();

    // Emit event
    this.emit('operation-logged', log);

    // Log to Winston as well
    const logLevel = result.success ? 'debug' : 'warn';
    logger[logLevel]('Operation logged', {
      id: log.id,
      type: operation.type,
      action: operation.action,
      target: operation.target,
      success: result.success,
      confirmed: result.confirmed,
    });

    return log;
  }

  /**
   * Get operation log entries with optional filtering.
   *
   * @param limit - Maximum number of entries to return (default: 100)
   * @param filter - Optional filter criteria
   * @returns Filtered log entries, most recent first
   */
  public getOperationLog(limit: number = 100, filter?: OperationLogFilter): OperationLog[] {
    let logs = [...this.operationLog];

    // Apply filters
    if (filter) {
      logs = logs.filter((log) => {
        if (filter.type && log.operation.type !== filter.type) return false;
        if (filter.action && log.operation.action !== filter.action) return false;

        if (filter.targetPattern) {
          const pattern =
            typeof filter.targetPattern === 'string'
              ? new RegExp(filter.targetPattern, 'i')
              : filter.targetPattern;
          if (!pattern.test(log.operation.target)) return false;
        }

        if (filter.fromDate && log.timestamp < filter.fromDate) return false;
        if (filter.toDate && log.timestamp > filter.toDate) return false;
        if (filter.successOnly && !log.result.success) return false;
        if (filter.failedOnly && log.result.success) return false;
        if (filter.confirmedOnly && !log.result.confirmed) return false;

        return true;
      });
    }

    // Return most recent first, limited
    return logs.slice(-limit).reverse();
  }

  /**
   * Get a specific operation log entry by ID.
   */
  public getOperationById(id: string): OperationLog | undefined {
    return this.operationLog.find((log) => log.id === id);
  }

  /**
   * Get summary statistics for the operation log.
   */
  public getLogStats(): {
    total: number;
    byType: Record<OperationType, number>;
    successRate: number;
    confirmedCount: number;
    recentErrors: OperationLog[];
  } {
    const total = this.operationLog.length;
    const byType: Record<OperationType, number> = { file: 0, git: 0, system: 0, network: 0 };
    let successCount = 0;
    let confirmedCount = 0;
    const recentErrors: OperationLog[] = [];

    for (const log of this.operationLog) {
      byType[log.operation.type]++;
      if (log.result.success) successCount++;
      if (log.result.confirmed) confirmedCount++;
      if (!log.result.success) recentErrors.push(log);
    }

    return {
      total,
      byType,
      successRate: total > 0 ? successCount / total : 1,
      confirmedCount,
      recentErrors: recentErrors.slice(-10).reverse(),
    };
  }

  // ==========================================================================
  // Bypass Mode
  // ==========================================================================

  /**
   * Enable bypass mode to skip all confirmations.
   *
   * Use for automated scripts or batch operations where confirmation
   * is not desired. Operations are still logged.
   */
  public enableBypassMode(): void {
    this.bypassMode = true;
    logger.warn('Bypass mode enabled - confirmations will be skipped');
  }

  /**
   * Disable bypass mode to resume normal confirmation checks.
   */
  public disableBypassMode(): void {
    this.bypassMode = false;
    logger.info('Bypass mode disabled - confirmations resumed');
  }

  /**
   * Check if bypass mode is currently enabled.
   */
  public isBypassModeEnabled(): boolean {
    return this.bypassMode;
  }

  /**
   * Execute a function with bypass mode temporarily enabled.
   *
   * Bypass mode is automatically restored to its previous state after
   * the function completes, even if it throws an error.
   *
   * @param fn - Function to execute
   * @returns Result of the function
   */
  public async withBypass<T>(fn: () => T | Promise<T>): Promise<T> {
    const previousState = this.bypassMode;
    this.bypassMode = true;

    try {
      return await fn();
    } finally {
      this.bypassMode = previousState;
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load operation log from disk.
   */
  private loadLog(): void {
    try {
      if (existsSync(this.logPath)) {
        const data = readFileSync(this.logPath, 'utf-8');
        const parsed = JSON.parse(data);

        // Validate and parse log entries
        if (Array.isArray(parsed)) {
          this.operationLog = parsed.map((entry) => ({
            ...entry,
            timestamp: new Date(entry.timestamp),
            result: {
              ...entry.result,
              timestamp: new Date(entry.result.timestamp),
            },
          }));

          logger.debug('Operation log loaded', { entries: this.operationLog.length });
        }
      }
    } catch (error) {
      logger.warn('Failed to load operation log, starting fresh', {
        error: (error as Error).message,
      });
      this.operationLog = [];
    }
  }

  /**
   * Persist operation log to disk (thread-safe).
   */
  private persistLog(): void {
    // Chain writes to prevent concurrent file access
    this.writeLock = this.writeLock.then(async () => {
      try {
        // Ensure directory exists
        const dir = dirname(this.logPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Write atomically by writing to temp file first
        const tempPath = `${this.logPath}.tmp`;
        writeFileSync(tempPath, JSON.stringify(this.operationLog, null, 2));

        // Rename to final path (atomic on most filesystems)
        const { renameSync } = await import('fs');
        renameSync(tempPath, this.logPath);
      } catch (error) {
        logger.error('Failed to persist operation log', { error: (error as Error).message });
      }
    });
  }

  /**
   * Force save the operation log immediately.
   */
  public async flush(): Promise<void> {
    this.persistLog();
    await this.writeLock;
  }

  /**
   * Clear the operation log (for testing or reset).
   */
  public clearLog(): void {
    this.operationLog = [];
    this.persistLog();
    logger.info('Operation log cleared');
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Add custom sensitive file patterns.
   *
   * @param patterns - Regex patterns to add
   */
  public addSensitivePatterns(patterns: RegExp[]): void {
    SENSITIVE_FILE_PATTERNS.push(...patterns);
    logger.debug('Added custom sensitive patterns', { count: patterns.length });
  }

  /**
   * Check if a path is within a specific directory.
   */
  public isPathWithin(filePath: string, directory: string): boolean {
    const normalizedFile = normalize(filePath).toLowerCase();
    const normalizedDir = normalize(directory).toLowerCase();
    return normalizedFile.startsWith(normalizedDir);
  }

  /**
   * Create an operation object helper.
   */
  public createOperation(
    type: OperationType,
    action: string,
    target: string,
    details?: Record<string, unknown>
  ): Operation {
    return { type, action, target, details };
  }

  /**
   * Create a success result helper.
   */
  public createSuccessResult(output?: string, confirmed: boolean = false): OperationResult {
    return {
      success: true,
      confirmed,
      output,
      timestamp: new Date(),
    };
  }

  /**
   * Create a failure result helper.
   */
  public createFailureResult(error: string, confirmed: boolean = false): OperationResult {
    return {
      success: false,
      confirmed,
      error,
      timestamp: new Date(),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let guardrailsInstance: SafetyGuardrails | null = null;

/**
 * Get or create the SafetyGuardrails singleton instance.
 *
 * @param logPath - Optional custom log file path (only used on first call)
 * @returns SafetyGuardrails instance
 */
export function getSafetyGuardrails(logPath?: string): SafetyGuardrails {
  if (!guardrailsInstance) {
    guardrailsInstance = new SafetyGuardrails(logPath);
    logger.info('SafetyGuardrails singleton created');
  }
  return guardrailsInstance;
}

/**
 * Shutdown and cleanup SafetyGuardrails singleton.
 */
export async function shutdownSafetyGuardrails(): Promise<void> {
  if (guardrailsInstance) {
    await guardrailsInstance.flush();
    guardrailsInstance.removeAllListeners();
    guardrailsInstance = null;
    logger.info('SafetyGuardrails shutdown complete');
  }
}

/**
 * Reset SafetyGuardrails singleton (for testing).
 */
export function resetSafetyGuardrails(): void {
  guardrailsInstance = null;
}

// ============================================================================
// Convenience Exports
// ============================================================================

export { SENSITIVE_FILE_PATTERNS };
