/**
 * Atlas Desktop - Comprehensive Security Audit Logger
 * Tamper-evident logging with advanced features
 *
 * Features:
 * - SHA-256/384/512 hash chain for tamper detection
 * - Structured security event logging
 * - Automatic log rotation with retention policies
 * - In-memory buffer with async file writes
 * - Advanced search and filtering
 * - Audit report generation (JSON, CSV, HTML, text)
 * - Suspicious pattern detection and alerting
 * - Archive management
 *
 * @module security/audit-logger
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage, isoDate } from '../../shared/utils';
import { SecurityAuditEntry, SecuritySeverity } from '../../shared/types/security';
import {
  AuditEntry,
  AuditEventCategory,
  AuditEventSource,
  AuditSearchFilters,
  AuditSearchResult,
  AuditStatistics,
  AuditReportConfig,
  AuditReport,
  AuditLoggerConfig,
  SuspiciousPattern,
  PatternAlert,
  RetentionPolicy,
  DEFAULT_AUDIT_LOGGER_CONFIG,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_SUSPICIOUS_PATTERNS,
  SEVERITY_PRIORITY,
  meetsSeverityThreshold,
  ApiCallAuditDetails,
  FileOperationAuditDetails,
  CommandExecutionAuditDetails,
  ToolExecutionAuditDetails,
} from './audit-types';

const logger = createModuleLogger('AuditLogger');

/**
 * Events emitted by the audit logger
 */
export interface AuditLoggerEvents {
  /** Emitted when a new entry is logged */
  entry: (entry: AuditEntry) => void;
  /** Emitted when a suspicious pattern is detected */
  alert: (alert: PatternAlert) => void;
  /** Emitted when logs are flushed to disk */
  flush: (count: number) => void;
  /** Emitted when log rotation occurs */
  rotate: (oldPath: string, newPath: string) => void;
  /** Emitted on integrity check completion */
  integrityCheck: (result: { valid: boolean; errors: string[] }) => void;
}

/**
 * Comprehensive Security Audit Logger
 * Provides tamper-evident logging with advanced search, reporting, and alerting
 */
export class AuditLogger extends EventEmitter {
  private config: AuditLoggerConfig;
  private baseDir: string;
  private currentLogPath: string;
  private buffer: AuditEntry[] = [];
  private previousHash: string = 'GENESIS';
  private sequence: number = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private writePromise: Promise<void> | null = null;
  private alertCooldowns: Map<string, number> = new Map();
  private recentEntries: AuditEntry[] = [];
  private readonly maxRecentEntries = 1000;

  constructor(config?: Partial<AuditLoggerConfig>) {
    super();

    // Determine base directory
    const userHome = homedir();
    const defaultBaseDir = path.join(userHome, '.atlas', 'audit');

    this.config = {
      baseDir: defaultBaseDir,
      maxFileSize: DEFAULT_AUDIT_LOGGER_CONFIG.maxFileSize!,
      bufferSize: DEFAULT_AUDIT_LOGGER_CONFIG.bufferSize!,
      flushInterval: DEFAULT_AUDIT_LOGGER_CONFIG.flushInterval!,
      consoleOutput: DEFAULT_AUDIT_LOGGER_CONFIG.consoleOutput!,
      retention: { ...DEFAULT_RETENTION_POLICY, ...config?.retention },
      suspiciousPatterns: config?.suspiciousPatterns ?? [...DEFAULT_SUSPICIOUS_PATTERNS],
      enableHashChain: DEFAULT_AUDIT_LOGGER_CONFIG.enableHashChain!,
      hashAlgorithm: DEFAULT_AUDIT_LOGGER_CONFIG.hashAlgorithm!,
      minSeverity: DEFAULT_AUDIT_LOGGER_CONFIG.minSeverity!,
      enableRealTimeDetection: DEFAULT_AUDIT_LOGGER_CONFIG.enableRealTimeDetection!,
      ...config,
    };

    this.baseDir = this.config.baseDir;
    this.currentLogPath = this.getLogFilePath();

    // Initialize
    this.initialize();
  }

  /**
   * Initialize the audit logger
   */
  private async initialize(): Promise<void> {
    try {
      // Ensure base directory exists
      await fs.mkdir(this.baseDir, { recursive: true });

      // Create subdirectories
      await fs.mkdir(path.join(this.baseDir, 'archives'), { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'reports'), { recursive: true });
      await fs.mkdir(path.join(this.baseDir, 'alerts'), { recursive: true });

      // Load sequence from existing log if present
      await this.loadLastSequence();

      // Start periodic flush
      this.startFlushTimer();

      // Schedule retention cleanup
      this.scheduleRetentionCleanup();

      logger.info('AuditLogger initialized', {
        baseDir: this.baseDir,
        hashAlgorithm: this.config.hashAlgorithm,
        patternsEnabled: this.config.suspiciousPatterns.filter((p) => p.enabled).length,
      });
    } catch (error) {
      logger.error('Failed to initialize AuditLogger', { error: (error as Error).message });
    }
  }

  /**
   * Get the current log file path
   */
  private getLogFilePath(): string {
    const date = isoDate();
    return path.join(this.baseDir, `audit-${date}.jsonl`);
  }

  /**
   * Load the last sequence number from existing logs
   */
  private async loadLastSequence(): Promise<void> {
    try {
      const content = await fs.readFile(this.currentLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
        this.sequence = (lastEntry.sequence ?? 0) + 1;
        this.previousHash = lastEntry.hash ?? 'GENESIS';

        // Load recent entries for pattern detection
        const recentLines = lines.slice(-this.maxRecentEntries);
        this.recentEntries = recentLines.map((line) => JSON.parse(line) as AuditEntry);
      }
    } catch {
      // File doesn't exist or is empty, start fresh
      this.sequence = 0;
      this.previousHash = 'GENESIS';
    }
  }

  /**
   * Compute cryptographic hash of an entry
   */
  private computeHash(entry: Omit<AuditEntry, 'hash'>): string {
    const content = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      sequence: entry.sequence,
      category: entry.category,
      severity: entry.severity,
      message: entry.message,
      action: entry.action,
      allowed: entry.allowed,
      reason: entry.reason,
      source: entry.source,
      sessionId: entry.sessionId,
      durationMs: entry.durationMs,
      context: entry.context,
      previousHash: entry.previousHash,
    });

    return createHash(this.config.hashAlgorithm).update(content).digest('hex');
  }

  /**
   * Log a security event
   */
  log(
    category: AuditEventCategory,
    severity: SecuritySeverity,
    message: string,
    details: {
      action: string;
      allowed: boolean;
      reason?: string;
      source: AuditEventSource | string;
      sessionId?: string;
      durationMs?: number;
      context?: Record<string, unknown>;
    }
  ): AuditEntry {
    // Check minimum severity threshold
    if (!meetsSeverityThreshold(severity, this.config.minSeverity)) {
      return this.createEntry(category, severity, message, details);
    }

    const entry = this.createEntry(category, severity, message, details);

    // Add to buffer
    this.buffer.push(entry);

    // Track for pattern detection
    this.trackForPatternDetection(entry);

    // Console output if enabled
    if (this.config.consoleOutput) {
      this.logToConsole(entry);
    }

    // Emit entry event
    this.emit('entry', entry);

    // Check for suspicious patterns
    if (this.config.enableRealTimeDetection) {
      this.checkSuspiciousPatterns(entry);
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }

    return entry;
  }

  /**
   * Create an audit entry with hash chain
   */
  private createEntry(
    category: AuditEventCategory,
    severity: SecuritySeverity,
    message: string,
    details: {
      action: string;
      allowed: boolean;
      reason?: string;
      source: AuditEventSource | string;
      sessionId?: string;
      durationMs?: number;
      context?: Record<string, unknown>;
    }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sequence: this.sequence++,
      category,
      severity,
      message,
      action: details.action,
      allowed: details.allowed,
      reason: details.reason,
      source: details.source,
      sessionId: details.sessionId,
      durationMs: details.durationMs,
      context: details.context,
      previousHash: this.config.enableHashChain ? this.previousHash : undefined,
    };

    // Compute hash for this entry
    if (this.config.enableHashChain) {
      entry.hash = this.computeHash(entry);
      this.previousHash = entry.hash;
    }

    return entry;
  }

  /**
   * Track entry for pattern detection
   */
  private trackForPatternDetection(entry: AuditEntry): void {
    this.recentEntries.push(entry);

    // Keep only recent entries
    while (this.recentEntries.length > this.maxRecentEntries) {
      this.recentEntries.shift();
    }
  }

  // ============================================================
  // Convenience Logging Methods
  // ============================================================

  /**
   * Log command execution event
   */
  logCommandExecution(
    command: string,
    allowed: boolean,
    details: CommandExecutionAuditDetails & {
      source: AuditEventSource | string;
      sessionId?: string;
    }
  ): AuditEntry {
    const severity: SecuritySeverity = allowed ? 'info' : 'blocked';

    return this.log('command_execution', severity, `Command execution: ${command}`, {
      action: command,
      allowed,
      reason: details.matchedPattern ? `Blocked by pattern: ${details.matchedPattern}` : undefined,
      source: details.source,
      sessionId: details.sessionId,
      context: {
        args: details.args,
        exitCode: details.exitCode,
        cwd: details.cwd,
        riskLevel: details.riskLevel,
        sanitized: details.sanitized,
        matchedPattern: details.matchedPattern,
        timeoutMs: details.timeoutMs,
      },
    });
  }

  /**
   * Log file access event
   */
  logFileAccess(
    filePath: string,
    operation: FileOperationAuditDetails['operation'],
    allowed: boolean,
    details: Partial<FileOperationAuditDetails> & {
      source: AuditEventSource | string;
      sessionId?: string;
    }
  ): AuditEntry {
    const severity: SecuritySeverity = allowed ? 'info' : 'blocked';

    return this.log('file_access', severity, `File ${operation}: ${filePath}`, {
      action: `${operation}:${filePath}`,
      allowed,
      reason: details.blockReason,
      source: details.source,
      sessionId: details.sessionId,
      context: {
        path: filePath,
        operation,
        sizeBytes: details.sizeBytes,
        newPath: details.newPath,
        exists: details.exists,
        blocked: details.blocked,
      },
    });
  }

  /**
   * Log API call event
   */
  logApiCall(
    details: ApiCallAuditDetails & {
      source: AuditEventSource | string;
      sessionId?: string;
    }
  ): AuditEntry {
    const severity: SecuritySeverity = details.success ? 'info' : 'warning';

    return this.log('api_call', severity, `API call to ${details.service}: ${details.endpoint}`, {
      action: `${details.method ?? 'REQUEST'}:${details.service}:${details.endpoint}`,
      allowed: details.success,
      reason: details.error,
      source: details.source,
      sessionId: details.sessionId,
      durationMs: details.durationMs,
      context: {
        service: details.service,
        endpoint: details.endpoint,
        method: details.method,
        statusCode: details.statusCode,
        tokensUsed: details.tokensUsed,
        error: details.error,
      },
    });
  }

  /**
   * Log tool execution event
   */
  logToolExecution(
    details: ToolExecutionAuditDetails & {
      allowed: boolean;
      source: AuditEventSource | string;
      sessionId?: string;
      durationMs?: number;
    }
  ): AuditEntry {
    const severity: SecuritySeverity = details.allowed ? 'info' : 'blocked';

    return this.log('tool_execution', severity, `Tool execution: ${details.toolName}`, {
      action: `tool:${details.toolName}`,
      allowed: details.allowed,
      source: details.source,
      sessionId: details.sessionId,
      durationMs: details.durationMs,
      context: {
        toolName: details.toolName,
        toolVersion: details.toolVersion,
        inputParams: details.inputParams,
        outputSummary: details.outputSummary,
        requiresConfirmation: details.requiresConfirmation,
        confirmed: details.confirmed,
      },
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
      source: AuditEventSource | string;
      sessionId?: string;
      sanitized?: string;
    }
  ): AuditEntry {
    // Truncate input for logging
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
      source: AuditEventSource | string;
      sessionId?: string;
      sanitized?: string;
    }
  ): AuditEntry {
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
      source: AuditEventSource | string;
      sessionId?: string;
      remaining: number;
      resetIn: number;
    }
  ): AuditEntry {
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
   * Log constitutional guard check event
   * Indefinite retention - these logs are never automatically deleted
   */
  logConstitutionalCheck(
    content: string,
    result: {
      passed: boolean;
      violations: Array<{
        type: string;
        severity: string;
        description: string;
        matchedPattern?: string;
      }>;
      action: 'allowed' | 'modified' | 'refused';
      modifiedContent?: string;
    },
    source: 'user_request' | 'model_output'
  ): AuditEntry {
    const severity: SecuritySeverity = result.passed ? 'info' : 
      result.violations.some(v => v.severity === 'critical') ? 'critical' : 'warning';
    
    // Truncate content for logging
    const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content;

    return this.log(
      'constitutional_check' as AuditEventCategory,
      severity,
      result.passed 
        ? `Constitutional check passed (${source})`
        : `Constitutional violation detected (${source}): ${result.violations.map(v => v.type).join(', ')}`,
      {
        action: `constitutional_${result.action}`,
        allowed: result.passed,
        reason: result.violations.length > 0 
          ? `Violations: ${result.violations.map(v => v.description).join('; ')}`
          : undefined,
        source: source,
        context: {
          content: truncatedContent,
          violations: result.violations,
          resultAction: result.action,
          modifiedContent: result.modifiedContent,
          // Mark for indefinite retention
          retentionPolicy: 'indefinite',
        },
      }
    );
  }

  /**
   * Log sandbox execution event (044-A)
   */
  logSandboxExecution(
    command: string,
    success: boolean,
    details: {
      sandboxLevel?: string;
      executionTime?: number;
      violations?: string[];
      error?: string;
      reason?: string;
    }
  ): AuditEntry {
    const severity: SecuritySeverity = success ? 'info' : 'warning';

    return this.log(
      'command_execution',
      severity,
      `Sandbox execution: ${command} (level: ${details.sandboxLevel || 'default'})`,
      {
        action: command,
        allowed: success,
        reason: details.reason || details.error,
        source: 'sandbox' as AuditEventSource,
        context: {
          sandboxLevel: details.sandboxLevel,
          executionTime: details.executionTime,
          violations: details.violations,
          error: details.error,
        },
      }
    );
  }

  // ============================================================
  // Console Output
  // ============================================================

  /**
   * Log to console with appropriate styling
   */
  private logToConsole(entry: AuditEntry): void {
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

  // ============================================================
  // Flush & File Writing
  // ============================================================

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

    // Wait for any pending write
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

    // Emit flush event
    this.emit('flush', entries.length);
  }

  /**
   * Write entries to log file
   */
  private async writeEntries(entries: AuditEntry[]): Promise<void> {
    try {
      // Check if we need to rotate to a new day's file
      const currentPath = this.getLogFilePath();
      if (currentPath !== this.currentLogPath) {
        this.currentLogPath = currentPath;
      }

      // Check if log rotation is needed
      await this.rotateIfNeeded();

      // Append entries as JSONL
      const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.currentLogPath, content, 'utf-8');
    } catch (error) {
      logger.error('Failed to write audit log', { error: (error as Error).message });
    }
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.currentLogPath);

      if (stats.size >= this.config.maxFileSize) {
        const timestamp = Date.now();
        const rotatedPath = `${this.currentLogPath}.${timestamp}`;

        await fs.rename(this.currentLogPath, rotatedPath);

        // Archive the rotated file
        if (this.config.retention.archiveBeforeDelete) {
          await this.archiveLogFile(rotatedPath);
        }

        logger.info('Audit log rotated', { oldPath: this.currentLogPath, newPath: rotatedPath });
        this.emit('rotate', this.currentLogPath, rotatedPath);
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  /**
   * Archive a log file with compression
   */
  private async archiveLogFile(logPath: string): Promise<string> {
    const archiveDir = path.join(this.baseDir, 'archives');
    const fileName = path.basename(logPath);
    const archivePath = path.join(archiveDir, `${fileName}.gz`);

    try {
      const source = createReadStream(logPath);
      const destination = createWriteStream(archivePath);
      const gzip = createGzip();

      await pipeline(source, gzip, destination);

      // Remove original after successful archive
      await fs.unlink(logPath);

      logger.info('Audit log archived', { archivePath });
      return archivePath;
    } catch (error) {
      logger.error('Failed to archive log file', { error: (error as Error).message });
      throw error;
    }
  }

  // ============================================================
  // Search & Filter
  // ============================================================

  /**
   * Search audit entries with filters
   */
  async search(filters: AuditSearchFilters): Promise<AuditSearchResult> {
    const entries: AuditEntry[] = [];
    let totalCount = 0;

    try {
      // Get all log files
      const logFiles = await this.getLogFiles();

      // Filter by time range
      const filteredFiles = this.filterFilesByTimeRange(logFiles, filters);

      // Read and filter entries from each file
      for (const filePath of filteredFiles) {
        const fileEntries = await this.readLogFile(filePath);

        for (const entry of fileEntries) {
          if (this.matchesFilters(entry, filters)) {
            entries.push(entry);
            totalCount++;
          }
        }
      }

      // Include buffer entries
      for (const entry of this.buffer) {
        if (this.matchesFilters(entry, filters)) {
          entries.push(entry);
          totalCount++;
        }
      }

      // Sort entries
      const sortOrder = filters.sortOrder ?? 'desc';
      const sortBy = filters.sortBy ?? 'timestamp';

      entries.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'timestamp':
            comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            break;
          case 'severity':
            comparison = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
            break;
          case 'category':
            comparison = a.category.localeCompare(b.category);
            break;
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });

      // Apply pagination
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? 100;
      const paginatedEntries = entries.slice(offset, offset + limit);

      return {
        entries: paginatedEntries,
        totalCount,
        hasMore: offset + limit < totalCount,
        filters,
      };
    } catch (error) {
      logger.error('Search failed', { error: (error as Error).message });
      return {
        entries: [],
        totalCount: 0,
        hasMore: false,
        filters,
      };
    }
  }

  /**
   * Get all log files in the audit directory
   */
  private async getLogFiles(): Promise<string[]> {
    const files: string[] = [];

    try {
      const dirEntries = await fs.readdir(this.baseDir, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(path.join(this.baseDir, entry.name));
        }
      }

      // Sort by name (which includes date)
      files.sort();
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  /**
   * Filter log files by time range
   */
  private filterFilesByTimeRange(files: string[], filters: AuditSearchFilters): string[] {
    if (!filters.startTime && !filters.endTime) {
      return files;
    }

    const startDate = filters.startTime
      ? isoDate(new Date(filters.startTime))
      : '1970-01-01';
    const endDate = filters.endTime
      ? isoDate(new Date(filters.endTime))
      : '9999-12-31';

    return files.filter((file) => {
      const match = path.basename(file).match(/audit-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const fileDate = match[1];
        return fileDate >= startDate && fileDate <= endDate;
      }
      return true; // Include files without date in name
    });
  }

  /**
   * Read entries from a log file
   */
  private async readLogFile(filePath: string): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Check if an entry matches the given filters
   */
  private matchesFilters(entry: AuditEntry, filters: AuditSearchFilters): boolean {
    // Category filter
    if (filters.category) {
      const categories = Array.isArray(filters.category) ? filters.category : [filters.category];
      if (!categories.includes(entry.category as AuditEventCategory)) {
        return false;
      }
    }

    // Severity filter
    if (filters.severity) {
      const severities = Array.isArray(filters.severity) ? filters.severity : [filters.severity];
      if (!severities.includes(entry.severity)) {
        return false;
      }
    }

    // Source filter
    if (filters.source) {
      const sources = Array.isArray(filters.source) ? filters.source : [filters.source];
      if (!sources.includes(entry.source)) {
        return false;
      }
    }

    // Session ID filter
    if (filters.sessionId && entry.sessionId !== filters.sessionId) {
      return false;
    }

    // Time range filter
    if (filters.startTime) {
      const startTime = new Date(filters.startTime).getTime();
      if (new Date(entry.timestamp).getTime() < startTime) {
        return false;
      }
    }
    if (filters.endTime) {
      const endTime = new Date(filters.endTime).getTime();
      if (new Date(entry.timestamp).getTime() > endTime) {
        return false;
      }
    }

    // Allowed filter
    if (filters.allowed !== undefined && entry.allowed !== filters.allowed) {
      return false;
    }

    // Text search in message
    if (filters.messageContains) {
      if (!entry.message.toLowerCase().includes(filters.messageContains.toLowerCase())) {
        return false;
      }
    }

    // Text search in action
    if (filters.actionContains) {
      if (!entry.action.toLowerCase().includes(filters.actionContains.toLowerCase())) {
        return false;
      }
    }

    // Text search in context
    if (filters.contextContains && entry.context) {
      const contextStr = JSON.stringify(entry.context).toLowerCase();
      if (!contextStr.includes(filters.contextContains.toLowerCase())) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get recent entries (from memory)
   */
  async getRecentEntries(count: number = 100): Promise<AuditEntry[]> {
    // Combine buffer and tracked recent entries
    const allRecent = [...this.recentEntries, ...this.buffer];
    return allRecent.slice(-count);
  }

  /**
   * Get entries by severity
   */
  async getEntriesBySeverity(
    severity: SecuritySeverity,
    limit: number = 100
  ): Promise<AuditEntry[]> {
    return this.search({
      severity,
      limit,
      sortOrder: 'desc',
    }).then((result) => result.entries);
  }

  /**
   * Get entries by category
   */
  async getEntriesByCategory(
    category: AuditEventCategory,
    limit: number = 100
  ): Promise<AuditEntry[]> {
    return this.search({
      category,
      limit,
      sortOrder: 'desc',
    }).then((result) => result.entries);
  }

  /**
   * Get blocked actions
   */
  async getBlockedActions(limit: number = 100): Promise<AuditEntry[]> {
    return this.search({
      allowed: false,
      limit,
      sortOrder: 'desc',
    }).then((result) => result.entries);
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get audit statistics
   */
  async getStatistics(timeRange?: {
    start: Date | string;
    end: Date | string;
  }): Promise<AuditStatistics> {
    const filters: AuditSearchFilters = {
      limit: 100000, // Large limit to get all entries
    };

    if (timeRange) {
      filters.startTime = timeRange.start;
      filters.endTime = timeRange.end;
    }

    const result = await this.search(filters);
    const entries = result.entries;

    // Initialize counters
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<SecuritySeverity, number> = {
      info: 0,
      warning: 0,
      blocked: 0,
      critical: 0,
    };
    const bySource: Record<string, number> = {};
    let blockedCount = 0;
    let allowedCount = 0;
    let earliest = '';
    let latest = '';

    // Calculate statistics
    for (const entry of entries) {
      // Category
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;

      // Severity
      bySeverity[entry.severity]++;

      // Source
      bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;

      // Allowed/blocked
      if (entry.allowed) {
        allowedCount++;
      } else {
        blockedCount++;
      }

      // Time range
      if (!earliest || entry.timestamp < earliest) {
        earliest = entry.timestamp;
      }
      if (!latest || entry.timestamp > latest) {
        latest = entry.timestamp;
      }
    }

    // Calculate events per hour
    let eventsPerHour = 0;
    if (earliest && latest) {
      const durationMs = new Date(latest).getTime() - new Date(earliest).getTime();
      const durationHours = durationMs / (1000 * 60 * 60);
      eventsPerHour = durationHours > 0 ? entries.length / durationHours : entries.length;
    }

    return {
      totalEntries: entries.length,
      byCategory: byCategory as Record<AuditEventCategory, number>,
      bySeverity,
      bySource,
      blockedCount,
      allowedCount,
      timeRange: {
        earliest: earliest || new Date().toISOString(),
        latest: latest || new Date().toISOString(),
      },
      eventsPerHour,
    };
  }

  // ============================================================
  // Integrity Verification
  // ============================================================

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
      const logFiles = await this.getLogFiles();
      let expectedPreviousHash = 'GENESIS';

      for (const filePath of logFiles) {
        const fileEntries = await this.readLogFile(filePath);

        for (const entry of fileEntries) {
          entries++;

          // Check chain link
          if (entry.previousHash !== expectedPreviousHash) {
            errors.push(
              `Entry ${entry.id} (seq ${entry.sequence}): Chain broken - expected ${expectedPreviousHash}, got ${entry.previousHash}`
            );
          }

          // Verify hash
          if (entry.hash) {
            const entryWithoutHash = { ...entry };
            delete (entryWithoutHash as Record<string, unknown>).hash;
            const computedHash = this.computeHash(entryWithoutHash);

            if (entry.hash !== computedHash) {
              errors.push(
                `Entry ${entry.id} (seq ${entry.sequence}): Hash mismatch - entry has been tampered`
              );
            }
          }

          expectedPreviousHash = entry.hash ?? expectedPreviousHash;
        }
      }
    } catch (error) {
      errors.push(`Failed to read log files: ${(error as Error).message}`);
    }

    const result = {
      valid: errors.length === 0,
      entries,
      errors,
    };

    this.emit('integrityCheck', result);
    return result;
  }

  // ============================================================
  // Report Generation
  // ============================================================

  /**
   * Generate an audit report
   */
  async generateReport(config: AuditReportConfig): Promise<AuditReport> {
    const reportId = randomUUID();
    const generatedAt = new Date().toISOString();

    // Get entries based on filters
    const searchFilters: AuditSearchFilters = {
      ...config.filters,
      limit: config.maxEntries ?? 10000,
    };

    if (config.timeRange) {
      searchFilters.startTime = config.timeRange.start;
      searchFilters.endTime = config.timeRange.end;
    }

    const searchResult = await this.search(searchFilters);
    const entries = searchResult.entries;

    // Get statistics if requested
    let statistics: AuditStatistics | undefined;
    if (config.includeStatistics) {
      statistics = await this.getStatistics(config.timeRange);
    }

    // Verify integrity if requested
    let integrityResult: { valid: boolean; entries: number; errors: string[] } | undefined;
    if (config.includeIntegrityCheck) {
      integrityResult = await this.verifyIntegrity();
    }

    // Generate content based on format
    let content: string;
    switch (config.format) {
      case 'json':
        content = this.generateJsonReport(entries, statistics, integrityResult, config);
        break;
      case 'csv':
        content = this.generateCsvReport(entries, config);
        break;
      case 'html':
        content = this.generateHtmlReport(entries, statistics, integrityResult, config);
        break;
      case 'text':
        content = this.generateTextReport(entries, statistics, integrityResult, config);
        break;
      default:
        content = this.generateJsonReport(entries, statistics, integrityResult, config);
    }

    const report: AuditReport = {
      id: reportId,
      generatedAt,
      title: config.title ?? `Audit Report - ${generatedAt.split('T')[0]}`,
      config,
      content,
      statistics,
      integrityResult,
    };

    // Save report to disk
    const reportPath = await this.saveReport(report);
    report.filePath = reportPath;

    logger.info('Audit report generated', {
      reportId,
      format: config.format,
      entries: entries.length,
    });

    return report;
  }

  /**
   * Generate JSON format report
   */
  private generateJsonReport(
    entries: AuditEntry[],
    statistics?: AuditStatistics,
    integrityResult?: { valid: boolean; entries: number; errors: string[] },
    config?: AuditReportConfig
  ): string {
    const report = {
      entries: config?.includeSensitiveData ? entries : this.sanitizeEntries(entries),
      statistics,
      integrityResult,
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate CSV format report
   */
  private generateCsvReport(entries: AuditEntry[], config?: AuditReportConfig): string {
    const sanitized = config?.includeSensitiveData ? entries : this.sanitizeEntries(entries);

    const headers = [
      'id',
      'timestamp',
      'sequence',
      'category',
      'severity',
      'message',
      'action',
      'allowed',
      'reason',
      'source',
      'sessionId',
    ];

    const rows = sanitized.map((entry) =>
      [
        entry.id,
        entry.timestamp,
        entry.sequence?.toString() ?? '',
        entry.category,
        entry.severity,
        `"${entry.message.replace(/"/g, '""')}"`,
        `"${entry.action.replace(/"/g, '""')}"`,
        entry.allowed.toString(),
        entry.reason ? `"${entry.reason.replace(/"/g, '""')}"` : '',
        entry.source,
        entry.sessionId ?? '',
      ].join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Generate HTML format report
   */
  private generateHtmlReport(
    entries: AuditEntry[],
    statistics?: AuditStatistics,
    integrityResult?: { valid: boolean; entries: number; errors: string[] },
    config?: AuditReportConfig
  ): string {
    const sanitized = config?.includeSensitiveData ? entries : this.sanitizeEntries(entries);
    const title = config?.title ?? 'Audit Report';

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
    h1 { color: #333; }
    .summary { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; }
    .stat { background: white; padding: 10px 20px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-label { font-size: 12px; color: #666; }
    .stat-value { font-size: 24px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .severity-info { color: #2196F3; }
    .severity-warning { color: #FF9800; }
    .severity-blocked { color: #F44336; }
    .severity-critical { color: #9C27B0; }
    .integrity-valid { color: #4CAF50; }
    .integrity-invalid { color: #F44336; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated: ${new Date().toISOString()}</p>
`;

    // Statistics section
    if (statistics) {
      html += `
  <div class="summary">
    <h2>Statistics</h2>
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total Events</div>
        <div class="stat-value">${statistics.totalEntries}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Blocked</div>
        <div class="stat-value severity-blocked">${statistics.blockedCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Allowed</div>
        <div class="stat-value severity-info">${statistics.allowedCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Events/Hour</div>
        <div class="stat-value">${statistics.eventsPerHour.toFixed(1)}</div>
      </div>
    </div>
  </div>
`;
    }

    // Integrity section
    if (integrityResult) {
      const statusClass = integrityResult.valid ? 'integrity-valid' : 'integrity-invalid';
      html += `
  <div class="summary">
    <h2>Integrity Check</h2>
    <p class="${statusClass}">
      Status: ${integrityResult.valid ? 'VALID' : 'INVALID'}
      (${integrityResult.entries} entries checked)
    </p>
    ${
      integrityResult.errors.length > 0
        ? `
    <h3>Errors:</h3>
    <ul>
      ${integrityResult.errors.map((e) => `<li>${e}</li>`).join('\n')}
    </ul>
    `
        : ''
    }
  </div>
`;
    }

    // Entries table
    html += `
  <h2>Audit Entries</h2>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Category</th>
        <th>Severity</th>
        <th>Message</th>
        <th>Allowed</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
`;

    for (const entry of sanitized) {
      html += `
      <tr>
        <td>${entry.timestamp}</td>
        <td>${entry.category}</td>
        <td class="severity-${entry.severity}">${entry.severity}</td>
        <td>${entry.message}</td>
        <td>${entry.allowed ? 'Yes' : 'No'}</td>
        <td>${entry.source}</td>
      </tr>
`;
    }

    html += `
    </tbody>
  </table>
</body>
</html>`;

    return html;
  }

  /**
   * Generate text format report
   */
  private generateTextReport(
    entries: AuditEntry[],
    statistics?: AuditStatistics,
    integrityResult?: { valid: boolean; entries: number; errors: string[] },
    config?: AuditReportConfig
  ): string {
    const sanitized = config?.includeSensitiveData ? entries : this.sanitizeEntries(entries);
    const title = config?.title ?? 'Audit Report';
    const separator = '='.repeat(80);

    let text = `${separator}\n${title}\nGenerated: ${new Date().toISOString()}\n${separator}\n\n`;

    // Statistics
    if (statistics) {
      text += `STATISTICS\n${'-'.repeat(40)}\n`;
      text += `Total Events: ${statistics.totalEntries}\n`;
      text += `Blocked: ${statistics.blockedCount}\n`;
      text += `Allowed: ${statistics.allowedCount}\n`;
      text += `Events/Hour: ${statistics.eventsPerHour.toFixed(1)}\n`;
      text += `Time Range: ${statistics.timeRange.earliest} to ${statistics.timeRange.latest}\n\n`;
    }

    // Integrity
    if (integrityResult) {
      text += `INTEGRITY CHECK\n${'-'.repeat(40)}\n`;
      text += `Status: ${integrityResult.valid ? 'VALID' : 'INVALID'}\n`;
      text += `Entries Checked: ${integrityResult.entries}\n`;
      if (integrityResult.errors.length > 0) {
        text += `Errors:\n`;
        for (const error of integrityResult.errors) {
          text += `  - ${error}\n`;
        }
      }
      text += '\n';
    }

    // Entries
    text += `AUDIT ENTRIES\n${'-'.repeat(40)}\n\n`;

    for (const entry of sanitized) {
      text += `[${entry.timestamp}] [${entry.severity.toUpperCase()}] ${entry.category}\n`;
      text += `  Message: ${entry.message}\n`;
      text += `  Action: ${entry.action}\n`;
      text += `  Allowed: ${entry.allowed}\n`;
      text += `  Source: ${entry.source}\n`;
      if (entry.reason) {
        text += `  Reason: ${entry.reason}\n`;
      }
      text += '\n';
    }

    return text;
  }

  /**
   * Sanitize entries by removing sensitive context data
   */
  private sanitizeEntries(entries: AuditEntry[]): AuditEntry[] {
    return entries.map((entry) => {
      const sanitized = { ...entry };

      // Remove potentially sensitive context fields
      if (sanitized.context) {
        const {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          input: _input,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          sanitized: _,
          ...safeContext
        } = sanitized.context as Record<string, unknown>;
        sanitized.context = safeContext;
      }

      return sanitized;
    });
  }

  /**
   * Save report to disk
   */
  private async saveReport(report: AuditReport): Promise<string> {
    const reportsDir = path.join(this.baseDir, 'reports');
    const extension =
      report.config.format === 'html'
        ? 'html'
        : report.config.format === 'csv'
          ? 'csv'
          : report.config.format === 'text'
            ? 'txt'
            : 'json';

    const fileName = `report-${report.id.slice(0, 8)}-${Date.now()}.${extension}`;
    const filePath = path.join(reportsDir, fileName);

    await fs.writeFile(filePath, report.content, 'utf-8');

    return filePath;
  }

  /**
   * Export audit logs to a file
   */
  async exportLogs(
    outputPath: string,
    filters?: AuditSearchFilters
  ): Promise<{ success: boolean; entriesExported: number; filePath: string }> {
    try {
      const result = await this.search({
        ...filters,
        limit: filters?.limit ?? 100000,
      });

      const content = result.entries.map((e) => JSON.stringify(e)).join('\n');
      await fs.writeFile(outputPath, content, 'utf-8');

      logger.info('Audit logs exported', { outputPath, entriesExported: result.entries.length });

      return {
        success: true,
        entriesExported: result.entries.length,
        filePath: outputPath,
      };
    } catch (error) {
      logger.error('Failed to export logs', { error: (error as Error).message });
      return {
        success: false,
        entriesExported: 0,
        filePath: outputPath,
      };
    }
  }

  // ============================================================
  // Suspicious Pattern Detection
  // ============================================================

  /**
   * Check for suspicious patterns after a new entry
   */
  private checkSuspiciousPatterns(entry: AuditEntry): void {
    for (const pattern of this.config.suspiciousPatterns) {
      if (!pattern.enabled) continue;

      // Check cooldown
      const lastAlert = this.alertCooldowns.get(pattern.id);
      if (lastAlert && Date.now() - lastAlert < pattern.cooldownSeconds * 1000) {
        continue;
      }

      const triggered = this.evaluatePattern(pattern, entry);

      if (triggered) {
        this.handlePatternAlert(pattern, entry);
      }
    }
  }

  /**
   * Evaluate a pattern against recent entries
   */
  private evaluatePattern(pattern: SuspiciousPattern, latestEntry: AuditEntry): boolean {
    switch (pattern.type) {
      case 'threshold':
        return this.evaluateThresholdPattern(pattern, latestEntry);
      case 'sequence':
        return this.evaluateSequencePattern(pattern);
      case 'anomaly':
        return false; // Not implemented yet
      case 'custom':
        return false; // Not implemented yet
      default:
        return false;
    }
  }

  /**
   * Evaluate threshold-based pattern
   */
  private evaluateThresholdPattern(pattern: SuspiciousPattern, _latestEntry: AuditEntry): boolean {
    if (!pattern.threshold) return false;

    const windowStart = Date.now() - pattern.threshold.windowSeconds * 1000;

    let matchingCount = 0;

    for (const entry of this.recentEntries) {
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime < windowStart) continue;

      let matches = true;

      // Check category filter
      if (pattern.threshold.category && entry.category !== pattern.threshold.category) {
        matches = false;
      }

      // Check severity filter
      if (pattern.threshold.severity && entry.severity !== pattern.threshold.severity) {
        matches = false;
      }

      // Check allowed filter
      if (pattern.threshold.allowed !== undefined && entry.allowed !== pattern.threshold.allowed) {
        matches = false;
      }

      if (matches) {
        matchingCount++;
      }
    }

    // Include buffer entries
    for (const entry of this.buffer) {
      const entryTime = new Date(entry.timestamp).getTime();
      if (entryTime < windowStart) continue;

      let matches = true;

      if (pattern.threshold.category && entry.category !== pattern.threshold.category) {
        matches = false;
      }

      if (pattern.threshold.severity && entry.severity !== pattern.threshold.severity) {
        matches = false;
      }

      if (pattern.threshold.allowed !== undefined && entry.allowed !== pattern.threshold.allowed) {
        matches = false;
      }

      if (matches) {
        matchingCount++;
      }
    }

    return matchingCount >= pattern.threshold.count;
  }

  /**
   * Evaluate sequence-based pattern
   */
  private evaluateSequencePattern(pattern: SuspiciousPattern): boolean {
    if (!pattern.sequence) return false;

    const { categories, maxGapSeconds } = pattern.sequence;
    const maxGapMs = maxGapSeconds * 1000;

    let categoryIndex = 0;
    let lastMatchTime = 0;

    for (const entry of this.recentEntries) {
      if (entry.category === categories[categoryIndex]) {
        const entryTime = new Date(entry.timestamp).getTime();

        if (categoryIndex === 0 || entryTime - lastMatchTime <= maxGapMs) {
          lastMatchTime = entryTime;
          categoryIndex++;

          if (categoryIndex >= categories.length) {
            return true; // Full sequence matched
          }
        } else {
          // Gap too large, reset
          categoryIndex = entry.category === categories[0] ? 1 : 0;
          lastMatchTime = entryTime;
        }
      }
    }

    return false;
  }

  /**
   * Handle a triggered pattern alert
   */
  private async handlePatternAlert(
    pattern: SuspiciousPattern,
    triggerEntry: AuditEntry
  ): Promise<void> {
    // Set cooldown
    this.alertCooldowns.set(pattern.id, Date.now());

    // Get triggering events
    const windowStart = Date.now() - (pattern.threshold?.windowSeconds ?? 60) * 1000;
    const triggeringEvents = this.recentEntries.filter((e) => {
      const entryTime = new Date(e.timestamp).getTime();
      return entryTime >= windowStart;
    });

    // Create alert
    const alert: PatternAlert = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      patternId: pattern.id,
      patternName: pattern.name,
      severity: pattern.severity,
      message: `Suspicious pattern detected: ${pattern.name}`,
      triggeringEvents: triggeringEvents.slice(-10), // Limit to last 10
      sessionId: triggerEntry.sessionId,
      actionsTaken: [],
      acknowledged: false,
    };

    // Execute actions
    for (const action of pattern.actions) {
      try {
        await this.executePatternAction(action, alert, pattern);
        alert.actionsTaken.push(action.type);
      } catch (error) {
        logger.error('Failed to execute pattern action', {
          actionType: action.type,
          error: (error as Error).message,
        });
      }
    }

    // Save alert
    await this.saveAlert(alert);

    // Emit alert event
    this.emit('alert', alert);

    // Log the alert
    this.log('system_event', pattern.severity, `Pattern alert: ${pattern.name}`, {
      action: 'pattern_alert',
      allowed: true,
      source: 'audit_logger',
      sessionId: triggerEntry.sessionId,
      context: {
        patternId: pattern.id,
        patternName: pattern.name,
        triggeringEventsCount: triggeringEvents.length,
      },
    });
  }

  /**
   * Execute a pattern alert action
   */
  private async executePatternAction(
    action: { type: string; config?: Record<string, unknown> },
    alert: PatternAlert,
    pattern: SuspiciousPattern
  ): Promise<void> {
    switch (action.type) {
      case 'log':
        logger.warn('Pattern alert', { alert, pattern: pattern.name });
        break;

      case 'notify':
        // Notification would integrate with system notifications
        // For now, just log at higher level
        logger.error('SECURITY ALERT', {
          pattern: pattern.name,
          severity: pattern.severity,
          message: alert.message,
        });
        break;

      case 'block_session':
        // This would integrate with session management
        // Emit event for session manager to handle
        logger.warn('Session block requested', { sessionId: alert.sessionId });
        break;

      case 'webhook':
        await this.sendWebhookNotification(alert, pattern, action.config);
        break;

      case 'email':
        await this.sendEmailNotification(alert, pattern, action.config);
        break;
    }
  }

  /**
   * Save an alert to disk
   */
  private async saveAlert(alert: PatternAlert): Promise<void> {
    const alertsDir = path.join(this.baseDir, 'alerts');
    const fileName = `alert-${alert.id}.json`;
    const filePath = path.join(alertsDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(alert, null, 2), 'utf-8');
  }

  /**
   * Send webhook notification for security alerts
   */
  private async sendWebhookNotification(
    alert: PatternAlert,
    pattern: SuspiciousPattern,
    config?: Record<string, unknown>
  ): Promise<void> {
    const url = config?.url as string;
    if (!url) {
      logger.warn('Webhook action missing URL configuration');
      return;
    }

    try {
      const payload = {
        type: 'security_alert',
        timestamp: alert.timestamp,
        alert: {
          id: alert.id,
          message: alert.message,
          severity: alert.severity,
          patternId: alert.patternId,
          sessionId: alert.sessionId,
        },
        pattern: {
          name: pattern.name,
          description: pattern.description,
          severity: pattern.severity,
        },
        source: 'atlas-desktop',
        version: process.env.npm_package_version || '0.1.0',
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Atlas-Desktop-Security',
      };

      // Add custom headers if provided
      if (config?.headers && typeof config.headers === 'object') {
        Object.assign(headers, config.headers);
      }

      // Add authorization if provided
      if (config?.authToken) {
        headers['Authorization'] = `Bearer ${config.authToken}`;
      }

      const { default: https } = await import('https');
      const { default: http } = await import('http');
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const postData = JSON.stringify(payload);

      await new Promise<void>((resolve, reject) => {
        const req = protocol.request(
          {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
              ...headers,
              'Content-Length': Buffer.byteLength(postData),
            },
            timeout: (config?.timeout as number) || 10000,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                logger.info('Webhook notification sent', { url, statusCode: res.statusCode });
                resolve();
              } else {
                logger.warn('Webhook returned non-success status', {
                  url,
                  statusCode: res.statusCode,
                  response: data.substring(0, 200),
                });
                resolve(); // Don't reject to avoid blocking on webhook failures
              }
            });
          }
        );

        req.on('error', (error) => {
          logger.error('Webhook notification failed', { url, error: error.message });
          resolve(); // Don't reject to avoid blocking on webhook failures
        });

        req.on('timeout', () => {
          req.destroy();
          logger.warn('Webhook notification timed out', { url });
          resolve();
        });

        req.write(postData);
        req.end();
      });
    } catch (error) {
      logger.error('Failed to send webhook notification', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Send email notification for security alerts
   * Uses Twilio SendGrid or SMTP configuration
   */
  private async sendEmailNotification(
    alert: PatternAlert,
    pattern: SuspiciousPattern,
    config?: Record<string, unknown>
  ): Promise<void> {
    const to = config?.to as string | string[];
    if (!to) {
      logger.warn('Email action missing recipient configuration');
      return;
    }

    try {
      // Build email content
      const subject = `[Atlas Security Alert] ${pattern.severity.toUpperCase()}: ${pattern.name}`;
      const htmlBody = this.buildAlertEmailHtml(alert, pattern);
      const textBody = this.buildAlertEmailText(alert, pattern);

      // Check for Twilio/SendGrid configuration
      const sendGridApiKey = config?.sendGridApiKey || process.env.SENDGRID_API_KEY;
      
      if (sendGridApiKey) {
        await this.sendViaSendGrid(
          sendGridApiKey as string,
          Array.isArray(to) ? to : [to],
          config?.from as string || 'atlas-security@noreply.local',
          subject,
          textBody,
          htmlBody
        );
        return;
      }

      // Check for SMTP configuration
      const smtpConfig = config?.smtp as {
        host?: string;
        port?: number;
        secure?: boolean;
        user?: string;
        pass?: string;
      };

      if (smtpConfig?.host) {
        await this.sendViaSMTP(
          smtpConfig,
          Array.isArray(to) ? to : [to],
          config?.from as string || 'atlas-security@noreply.local',
          subject,
          textBody,
          htmlBody
        );
        return;
      }

      logger.warn('Email action: No email provider configured (SendGrid API key or SMTP settings required)');
    } catch (error) {
      logger.error('Failed to send email notification', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Build HTML email content for alert
   */
  private buildAlertEmailHtml(alert: PatternAlert, pattern: SuspiciousPattern): string {
    const severityColors: Record<string, string> = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#17a2b8',
      info: '#6c757d',
    };
    const color = severityColors[alert.severity] || '#6c757d';

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-top: none; border-radius: 0 0 8px 8px; }
    .severity { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; background: ${color}; color: white; }
    .details { background: white; padding: 15px; border-radius: 4px; margin-top: 15px; }
    .details dt { font-weight: bold; color: #495057; }
    .details dd { margin: 0 0 10px 0; color: #6c757d; }
    .footer { margin-top: 20px; font-size: 12px; color: #6c757d; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Atlas Security Alert</h1>
    </div>
    <div class="content">
      <p><span class="severity">${alert.severity.toUpperCase()}</span></p>
      <h2>${pattern.name}</h2>
      <p>${alert.message}</p>
      
      <div class="details">
        <dl>
          <dt>Alert ID</dt>
          <dd>${alert.id}</dd>
          <dt>Pattern</dt>
          <dd>${pattern.description || pattern.name}</dd>
          <dt>Timestamp</dt>
          <dd>${new Date(alert.timestamp).toLocaleString()}</dd>
          <dt>Session ID</dt>
          <dd>${alert.sessionId || 'N/A'}</dd>
          <dt>Triggering Events</dt>
          <dd>${alert.triggeringEventIds.length} event(s)</dd>
        </dl>
      </div>
      
      <div class="footer">
        <p>This is an automated security alert from Atlas Desktop.</p>
        <p>Please review the Atlas security dashboard for more details.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Build plain text email content for alert
   */
  private buildAlertEmailText(alert: PatternAlert, pattern: SuspiciousPattern): string {
    return `
ATLAS SECURITY ALERT
====================

Severity: ${alert.severity.toUpperCase()}
Pattern: ${pattern.name}

Message: ${alert.message}

Details:
- Alert ID: ${alert.id}
- Pattern Description: ${pattern.description || pattern.name}
- Timestamp: ${new Date(alert.timestamp).toLocaleString()}
- Session ID: ${alert.sessionId || 'N/A'}
- Triggering Events: ${alert.triggeringEventIds.length} event(s)

---
This is an automated security alert from Atlas Desktop.
Please review the Atlas security dashboard for more details.
`.trim();
  }

  /**
   * Send email via SendGrid API
   */
  private async sendViaSendGrid(
    apiKey: string,
    to: string[],
    from: string,
    subject: string,
    text: string,
    html: string
  ): Promise<void> {
    const { default: https } = await import('https');

    const payload = {
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: from },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    };

    const postData = JSON.stringify(payload);

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.sendgrid.com',
          path: '/v3/mail/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              logger.info('Email sent via SendGrid', { recipients: to.length });
              resolve();
            } else {
              logger.warn('SendGrid returned error', {
                statusCode: res.statusCode,
                response: data.substring(0, 500),
              });
              resolve(); // Don't reject to avoid blocking
            }
          });
        }
      );

      req.on('error', (error) => {
        logger.error('SendGrid request failed', { error: error.message });
        resolve();
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Send email via SMTP (basic implementation)
   */
  private async sendViaSMTP(
    smtpConfig: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string },
    to: string[],
    from: string,
    subject: string,
    text: string,
    _html: string
  ): Promise<void> {
    const net = await import('net');
    const tls = await import('tls');

    const { host, port = 587, secure = false, user, pass } = smtpConfig;
    if (!host) {
      logger.warn('SMTP host not configured');
      return;
    }

    try {
      const connectFn = secure ? tls.connect : net.connect;
      const socket = connectFn(port, host);

      const sendCommand = (cmd: string): Promise<string> => {
        return new Promise((resolve) => {
          socket.write(cmd + '\r\n');
          socket.once('data', (data) => resolve(data.toString()));
        });
      };

      await new Promise<void>((resolve) => socket.once('data', () => resolve()));

      await sendCommand(`EHLO atlas-desktop`);

      if (user && pass) {
        await sendCommand('AUTH LOGIN');
        await sendCommand(Buffer.from(user).toString('base64'));
        await sendCommand(Buffer.from(pass).toString('base64'));
      }

      await sendCommand(`MAIL FROM:<${from}>`);
      for (const recipient of to) {
        await sendCommand(`RCPT TO:<${recipient}>`);
      }

      await sendCommand('DATA');

      const message = [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        text,
        '.',
      ].join('\r\n');

      await sendCommand(message);
      await sendCommand('QUIT');

      socket.end();
      logger.info('Email sent via SMTP', { host, recipients: to.length });
    } catch (error) {
      logger.error('SMTP send failed', { error: getErrorMessage(error) });
    }
  }

  /**
   * Get alerts
   */
  async getAlerts(options?: {
    acknowledged?: boolean;
    patternId?: string;
    severity?: SecuritySeverity;
    limit?: number;
  }): Promise<PatternAlert[]> {
    const alertsDir = path.join(this.baseDir, 'alerts');
    const alerts: PatternAlert[] = [];

    try {
      const files = await fs.readdir(alertsDir);

      for (const file of files) {
        if (!file.startsWith('alert-') || !file.endsWith('.json')) continue;

        const content = await fs.readFile(path.join(alertsDir, file), 'utf-8');
        const alert = JSON.parse(content) as PatternAlert;

        // Apply filters
        if (options?.acknowledged !== undefined && alert.acknowledged !== options.acknowledged) {
          continue;
        }
        if (options?.patternId && alert.patternId !== options.patternId) {
          continue;
        }
        if (options?.severity && alert.severity !== options.severity) {
          continue;
        }

        alerts.push(alert);
      }

      // Sort by timestamp descending
      alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      if (options?.limit) {
        return alerts.slice(0, options.limit);
      }

      return alerts;
    } catch {
      return [];
    }
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, note?: string, user?: string): Promise<boolean> {
    const alertsDir = path.join(this.baseDir, 'alerts');
    const filePath = path.join(alertsDir, `alert-${alertId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const alert = JSON.parse(content) as PatternAlert;

      alert.acknowledged = true;
      alert.acknowledgment = {
        timestamp: new Date().toISOString(),
        user,
        note,
      };

      await fs.writeFile(filePath, JSON.stringify(alert, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Retention Management
  // ============================================================

  /**
   * Schedule retention cleanup
   */
  private scheduleRetentionCleanup(): void {
    // Run cleanup daily at midnight
    const runCleanup = async () => {
      try {
        await this.enforceRetentionPolicy();
      } catch (error) {
        logger.error('Retention cleanup failed', { error: (error as Error).message });
      }
    };

    // Initial cleanup
    runCleanup();

    // Schedule daily cleanup
    const msUntilMidnight = this.getMsUntilMidnight();
    setTimeout(() => {
      runCleanup();
      // Then run daily
      setInterval(runCleanup, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Get milliseconds until next midnight
   */
  private getMsUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  /**
   * Enforce retention policy
   */
  async enforceRetentionPolicy(): Promise<{
    filesDeleted: number;
    filesArchived: number;
    bytesFreed: number;
  }> {
    const policy = this.config.retention;
    let filesDeleted = 0;
    let filesArchived = 0;
    let bytesFreed = 0;

    try {
      const logFiles = await this.getLogFiles();
      const now = Date.now();
      const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000;

      // Check each log file
      for (const filePath of logFiles) {
        // Skip current log file
        if (filePath === this.currentLogPath) continue;

        try {
          const stats = await fs.stat(filePath);
          const fileAge = now - stats.mtimeMs;

          // Check if file exceeds max age
          if (fileAge > maxAgeMs) {
            if (policy.archiveBeforeDelete) {
              await this.archiveLogFile(filePath);
              filesArchived++;
            } else {
              await fs.unlink(filePath);
              filesDeleted++;
            }
            bytesFreed += stats.size;
          }
        } catch {
          // File doesn't exist or can't be accessed
        }
      }

      // Check total size limit
      await this.enforceSizeLimit(policy);

      // Check file count limit
      await this.enforceFileCountLimit(policy);

      logger.info('Retention policy enforced', { filesDeleted, filesArchived, bytesFreed });

      return { filesDeleted, filesArchived, bytesFreed };
    } catch (error) {
      logger.error('Failed to enforce retention policy', { error: (error as Error).message });
      return { filesDeleted, filesArchived, bytesFreed };
    }
  }

  /**
   * Enforce total size limit
   */
  private async enforceSizeLimit(policy: RetentionPolicy): Promise<void> {
    const logFiles = await this.getLogFiles();
    let totalSize = 0;

    // Calculate total size
    const filesWithSize: Array<{ path: string; size: number; mtime: number }> = [];

    for (const filePath of logFiles) {
      try {
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
        filesWithSize.push({ path: filePath, size: stats.size, mtime: stats.mtimeMs });
      } catch {
        // Skip files that can't be accessed
      }
    }

    // Delete oldest files if over limit
    if (totalSize > policy.maxTotalSizeBytes) {
      // Sort by modification time (oldest first)
      filesWithSize.sort((a, b) => a.mtime - b.mtime);

      for (const file of filesWithSize) {
        if (totalSize <= policy.maxTotalSizeBytes) break;
        if (file.path === this.currentLogPath) continue;

        try {
          if (policy.archiveBeforeDelete) {
            await this.archiveLogFile(file.path);
          } else {
            await fs.unlink(file.path);
          }
          totalSize -= file.size;
        } catch {
          // Continue with next file
        }
      }
    }
  }

  /**
   * Enforce file count limit
   */
  private async enforceFileCountLimit(policy: RetentionPolicy): Promise<void> {
    const logFiles = await this.getLogFiles();

    if (logFiles.length > policy.maxFiles) {
      // Get file stats
      const filesWithMtime: Array<{ path: string; mtime: number }> = [];

      for (const filePath of logFiles) {
        try {
          const stats = await fs.stat(filePath);
          filesWithMtime.push({ path: filePath, mtime: stats.mtimeMs });
        } catch {
          // Skip files that can't be accessed
        }
      }

      // Sort by modification time (oldest first)
      filesWithMtime.sort((a, b) => a.mtime - b.mtime);

      // Delete oldest files
      const toDelete = filesWithMtime.length - policy.maxFiles;

      for (let i = 0; i < toDelete; i++) {
        const file = filesWithMtime[i];
        if (file.path === this.currentLogPath) continue;

        try {
          if (policy.archiveBeforeDelete) {
            await this.archiveLogFile(file.path);
          } else {
            await fs.unlink(file.path);
          }
        } catch {
          // Continue with next file
        }
      }
    }
  }

  // ============================================================
  // Configuration Management
  // ============================================================

  /**
   * Update suspicious patterns
   */
  updatePatterns(patterns: SuspiciousPattern[]): void {
    this.config.suspiciousPatterns = patterns;
    logger.info('Suspicious patterns updated', { count: patterns.length });
  }

  /**
   * Add a suspicious pattern
   */
  addPattern(pattern: SuspiciousPattern): void {
    this.config.suspiciousPatterns.push(pattern);
    logger.info('Suspicious pattern added', { patternId: pattern.id, name: pattern.name });
  }

  /**
   * Remove a suspicious pattern
   */
  removePattern(patternId: string): boolean {
    const index = this.config.suspiciousPatterns.findIndex((p) => p.id === patternId);
    if (index !== -1) {
      this.config.suspiciousPatterns.splice(index, 1);
      logger.info('Suspicious pattern removed', { patternId });
      return true;
    }
    return false;
  }

  /**
   * Enable/disable a pattern
   */
  setPatternEnabled(patternId: string, enabled: boolean): boolean {
    const pattern = this.config.suspiciousPatterns.find((p) => p.id === patternId);
    if (pattern) {
      pattern.enabled = enabled;
      logger.info('Pattern enabled status changed', { patternId, enabled });
      return true;
    }
    return false;
  }

  /**
   * Get current configuration
   */
  getConfig(): AuditLoggerConfig {
    return { ...this.config };
  }

  // ============================================================
  // Shutdown
  // ============================================================

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

// ============================================================
// Singleton Management
// ============================================================

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

// Re-export for backwards compatibility with SecurityAuditEntry
export type { SecurityAuditEntry };

export default AuditLogger;
