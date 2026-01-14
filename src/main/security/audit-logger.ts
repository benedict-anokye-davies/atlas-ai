/**
 * Nova Desktop - Security Audit Logger
 * Tamper-evident logging for security events
 *
 * Features:
 * - SHA-256 hash chain for tamper detection
 * - Structured security event logging
 * - Automatic log rotation
 * - In-memory buffer with async file writes
 *
 * @module security/audit-logger
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  SecurityAuditEntry,
  SecurityEventCategory,
  SecuritySeverity,
} from '../../shared/types/security';

const logger = createModuleLogger('AuditLogger');

/**
 * Audit logger configuration
 */
export interface AuditLoggerConfig {
  /** Path to the audit log file */
  logPath?: string;
  /** Maximum log file size in bytes before rotation */
  maxFileSize: number;
  /** Maximum number of rotated log files to keep */
  maxFiles: number;
  /** Whether to also log to console */
  consoleOutput: boolean;
  /** Buffer size before flushing to disk */
  bufferSize: number;
  /** Flush interval in milliseconds */
  flushInterval: number;
}

/**
 * Default audit logger configuration
 */
const DEFAULT_CONFIG: AuditLoggerConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  consoleOutput: true,
  bufferSize: 100,
  flushInterval: 5000, // 5 seconds
};

/**
 * Security Audit Logger
 * Provides tamper-evident logging with hash chain verification
 */
export class AuditLogger {
  private config: AuditLoggerConfig;
  private logPath: string;
  private buffer: SecurityAuditEntry[] = [];
  private previousHash: string = 'GENESIS';
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private writePromise: Promise<void> | null = null;

  constructor(config?: Partial<AuditLoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Determine log path
    const userDataPath = app?.getPath?.('userData') ?? process.cwd();
    this.logPath = this.config.logPath ?? path.join(userDataPath, 'logs', 'security-audit.jsonl');

    // Start periodic flush
    this.startFlushTimer();

    logger.info('AuditLogger initialized', { logPath: this.logPath });
  }

  /**
   * Compute SHA-256 hash of an entry
   */
  private computeHash(entry: Omit<SecurityAuditEntry, 'hash'>): string {
    const content = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      category: entry.category,
      severity: entry.severity,
      message: entry.message,
      action: entry.action,
      allowed: entry.allowed,
      reason: entry.reason,
      source: entry.source,
      sessionId: entry.sessionId,
      context: entry.context,
      previousHash: entry.previousHash,
    });

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Log a security event
   */
  log(
    category: SecurityEventCategory,
    severity: SecuritySeverity,
    message: string,
    details: {
      action: string;
      allowed: boolean;
      reason?: string;
      source: string;
      sessionId?: string;
      context?: Record<string, unknown>;
    }
  ): SecurityAuditEntry {
    const entry: SecurityAuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      severity,
      message,
      action: details.action,
      allowed: details.allowed,
      reason: details.reason,
      source: details.source,
      sessionId: details.sessionId,
      context: details.context,
      previousHash: this.previousHash,
    };

    // Compute hash for this entry
    entry.hash = this.computeHash(entry);
    this.previousHash = entry.hash;

    // Add to buffer
    this.buffer.push(entry);

    // Console output if enabled
    if (this.config.consoleOutput) {
      this.logToConsole(entry);
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }

    return entry;
  }

  /**
   * Log command execution event
   */
  logCommandExecution(
    command: string,
    allowed: boolean,
    details: {
      reason?: string;
      source: string;
      sessionId?: string;
      riskLevel?: string;
      matchedPattern?: string;
    }
  ): SecurityAuditEntry {
    const severity: SecuritySeverity = allowed ? 'info' : 'blocked';

    return this.log('command_execution', severity, `Command execution: ${command}`, {
      action: command,
      allowed,
      reason: details.reason,
      source: details.source,
      sessionId: details.sessionId,
      context: {
        riskLevel: details.riskLevel,
        matchedPattern: details.matchedPattern,
      },
    });
  }

  /**
   * Log file access event
   */
  logFileAccess(
    filePath: string,
    operation: string,
    allowed: boolean,
    details: {
      reason?: string;
      source: string;
      sessionId?: string;
    }
  ): SecurityAuditEntry {
    const severity: SecuritySeverity = allowed ? 'info' : 'blocked';

    return this.log('file_access', severity, `File ${operation}: ${filePath}`, {
      action: `${operation}:${filePath}`,
      allowed,
      reason: details.reason,
      source: details.source,
      sessionId: details.sessionId,
    });
  }

  /**
   * Log prompt injection attempt
   */
  logPromptInjection(
    input: string,
    threatType: string,
    details: {
      pattern: string;
      source: string;
      sessionId?: string;
      sanitized?: string;
    }
  ): SecurityAuditEntry {
    // Truncate input for logging (don't log huge payloads)
    const truncatedInput = input.length > 500 ? input.substring(0, 500) + '...' : input;

    return this.log('prompt_injection', 'critical', `Prompt injection detected: ${threatType}`, {
      action: 'prompt_injection_attempt',
      allowed: false,
      reason: `Detected pattern: ${details.pattern}`,
      source: details.source,
      sessionId: details.sessionId,
      context: {
        threatType,
        input: truncatedInput,
        pattern: details.pattern,
        sanitized: details.sanitized,
      },
    });
  }

  /**
   * Log input validation event
   */
  logInputValidation(
    input: string,
    threats: Array<{ type: string; pattern: string }>,
    blocked: boolean,
    details: {
      source: string;
      sessionId?: string;
      sanitized?: string;
    }
  ): SecurityAuditEntry {
    const severity: SecuritySeverity = blocked ? 'warning' : 'info';
    const truncatedInput = input.length > 500 ? input.substring(0, 500) + '...' : input;

    return this.log(
      'input_validation',
      severity,
      threats.length > 0
        ? `Input validation: ${threats.length} threats detected`
        : 'Input validation: clean',
      {
        action: 'input_validation',
        allowed: !blocked,
        reason:
          threats.length > 0 ? `Threats: ${threats.map((t) => t.type).join(', ')}` : undefined,
        source: details.source,
        sessionId: details.sessionId,
        context: {
          input: truncatedInput,
          threats,
          sanitized: details.sanitized,
        },
      }
    );
  }

  /**
   * Log rate limit event
   */
  logRateLimit(
    action: string,
    allowed: boolean,
    details: {
      source: string;
      sessionId?: string;
      remaining: number;
      resetIn: number;
    }
  ): SecurityAuditEntry {
    const severity: SecuritySeverity = allowed ? 'info' : 'warning';

    return this.log('rate_limit', severity, `Rate limit check for: ${action}`, {
      action,
      allowed,
      reason: allowed ? undefined : 'Rate limit exceeded',
      source: details.source,
      sessionId: details.sessionId,
      context: {
        remaining: details.remaining,
        resetIn: details.resetIn,
      },
    });
  }

  /**
   * Log to console with appropriate styling
   */
  private logToConsole(entry: SecurityAuditEntry): void {
    const prefix = `[AUDIT:${entry.severity.toUpperCase()}]`;
    const msg = `${prefix} ${entry.category} - ${entry.message} (allowed: ${entry.allowed})`;

    switch (entry.severity) {
      case 'critical':
      case 'blocked':
        logger.error(msg, { entry });
        break;
      case 'warning':
        logger.warn(msg, { entry });
        break;
      default:
        logger.info(msg, { entry });
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.config.flushInterval);
  }

  /**
   * Flush buffer to disk
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isShuttingDown) {
      return;
    }

    // Wait for any pending write to complete
    if (this.writePromise) {
      await this.writePromise;
    }

    // Take current buffer and clear it
    const entries = [...this.buffer];
    this.buffer = [];

    // Write to file
    this.writePromise = this.writeEntries(entries);
    await this.writePromise;
    this.writePromise = null;
  }

  /**
   * Write entries to log file
   */
  private async writeEntries(entries: SecurityAuditEntry[]): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.logPath);
      await fs.mkdir(dir, { recursive: true });

      // Check if log rotation is needed
      await this.rotateIfNeeded();

      // Append entries as JSONL
      const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.logPath, content, 'utf-8');
    } catch (error) {
      logger.error('Failed to write audit log', { error: (error as Error).message });
    }
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.logPath);

      if (stats.size >= this.config.maxFileSize) {
        // Rotate existing logs
        for (let i = this.config.maxFiles - 1; i >= 1; i--) {
          const oldPath = `${this.logPath}.${i}`;
          const newPath = `${this.logPath}.${i + 1}`;

          try {
            await fs.rename(oldPath, newPath);
          } catch {
            // File doesn't exist, skip
          }
        }

        // Move current log to .1
        await fs.rename(this.logPath, `${this.logPath}.1`);

        logger.info('Audit log rotated');
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  /**
   * Verify the integrity of the log chain
   */
  async verifyIntegrity(): Promise<{
    valid: boolean;
    entries: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let entries = 0;

    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let expectedPreviousHash = 'GENESIS';

      for (const line of lines) {
        entries++;
        const entry = JSON.parse(line) as SecurityAuditEntry;

        // Check chain link
        if (entry.previousHash !== expectedPreviousHash) {
          errors.push(
            `Entry ${entry.id}: Chain broken - expected ${expectedPreviousHash}, got ${entry.previousHash}`
          );
        }

        // Verify hash
        const storedHash = entry.hash;
        const entryWithoutHash = { ...entry };
        delete (entryWithoutHash as Record<string, unknown>).hash;
        const computedHash = this.computeHash(entryWithoutHash);

        if (storedHash !== computedHash) {
          errors.push(`Entry ${entry.id}: Hash mismatch - entry has been tampered`);
        }

        expectedPreviousHash = storedHash!;
      }
    } catch (error) {
      errors.push(`Failed to read log file: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      entries,
      errors,
    };
  }

  /**
   * Get recent entries from the log
   */
  async getRecentEntries(count: number = 100): Promise<SecurityAuditEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      return lines.slice(-count).map((line) => JSON.parse(line) as SecurityAuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get entries by severity
   */
  async getEntriesBySeverity(
    severity: SecuritySeverity,
    limit: number = 100
  ): Promise<SecurityAuditEntry[]> {
    const entries = await this.getRecentEntries(1000);
    return entries.filter((e) => e.severity === severity).slice(-limit);
  }

  /**
   * Get entries by category
   */
  async getEntriesByCategory(
    category: SecurityEventCategory,
    limit: number = 100
  ): Promise<SecurityAuditEntry[]> {
    const entries = await this.getRecentEntries(1000);
    return entries.filter((e) => e.category === category).slice(-limit);
  }

  /**
   * Get blocked actions
   */
  async getBlockedActions(limit: number = 100): Promise<SecurityAuditEntry[]> {
    const entries = await this.getRecentEntries(1000);
    return entries.filter((e) => !e.allowed).slice(-limit);
  }

  /**
   * Shutdown the logger
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();

    logger.info('AuditLogger shutdown complete');
  }
}

// Singleton instance
let auditLoggerInstance: AuditLogger | null = null;

/**
 * Get or create the singleton AuditLogger instance
 */
export function getAuditLogger(config?: Partial<AuditLoggerConfig>): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(config);
  }
  return auditLoggerInstance;
}

/**
 * Shutdown the audit logger
 */
export async function shutdownAuditLogger(): Promise<void> {
  if (auditLoggerInstance) {
    await auditLoggerInstance.shutdown();
    auditLoggerInstance = null;
  }
}

export default AuditLogger;
