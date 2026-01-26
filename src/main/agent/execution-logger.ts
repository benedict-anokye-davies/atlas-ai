/**
 * Atlas Desktop - Execution Logger
 *
 * Provides comprehensive logging for all CLI operations per Ben's preference
 * for detailed execution tracking. Stores logs in Obsidian vault format for
 * easy review and searchability.
 *
 * Features:
 * - Structured JSON + Markdown logging for different use cases
 * - Task correlation to group logs by task ID
 * - File change tracking with diff storage for rollback
 * - Query interface for searching and filtering logs
 * - Obsidian integration - logs readable in Obsidian vault
 * - Real-time writing (no batching)
 * - Automatic log rotation and cleanup (30 days retention)
 *
 * @module agent/execution-logger
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ExecutionLogger');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Log entry types
 */
export type LogEntryType = 'command' | 'file' | 'git' | 'task' | 'error';

/**
 * A single log entry
 */
export interface LogEntry {
  /** Unique identifier */
  id: string;
  /** When the entry was created */
  timestamp: Date;
  /** Type of log entry */
  type: LogEntryType;
  /** Category for grouping (e.g., 'npm', 'git', 'filesystem') */
  category: string;
  /** Human-readable summary */
  summary: string;
  /** Detailed information */
  details: Record<string, unknown>;
  /** Associated task ID for correlation */
  taskId?: string;
  /** Whether the operation succeeded */
  success: boolean;
}

/**
 * Execution report for a task
 */
export interface ExecutionReport {
  /** Task identifier */
  taskId: string;
  /** Optional task name */
  taskName?: string;
  /** When the task started */
  startTime: Date;
  /** When the task ended */
  endTime: Date;
  /** Duration in milliseconds */
  duration: number;
  /** Number of commands executed */
  commandsExecuted: number;
  /** Number of files modified */
  filesModified: number;
  /** Whether the task succeeded overall */
  success: boolean;
  /** All log entries for this task */
  logs: LogEntry[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Filter options for querying logs
 */
export interface LogFilter {
  /** Filter by log type */
  type?: LogEntryType;
  /** Only logs after this date */
  since?: Date;
  /** Only logs before this date */
  until?: Date;
  /** Filter by task ID */
  taskId?: string;
  /** Filter by success status */
  success?: boolean;
  /** Search term for summary/details */
  searchTerm?: string;
}

/**
 * Result of a command execution
 */
export interface ExecutionResult {
  /** The command that was executed */
  command: string;
  /** Standard output */
  output: string;
  /** Standard error */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of a git operation
 */
export interface GitResult {
  /** The git operation performed */
  operation: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Command output */
  output: string;
  /** Files affected by the operation */
  filesAffected?: string[];
  /** Commit hash if applicable */
  commitHash?: string;
}

/**
 * File change types
 */
export type FileChangeType = 'create' | 'modify' | 'delete';

/**
 * Daily log summary stored in markdown
 */
interface DailyLogSummary {
  date: string;
  commandsExecuted: number;
  filesModified: number;
  gitOperations: number;
  successRate: number;
  entries: LogEntry[];
}

/**
 * Execution logger interface
 */
export interface IExecutionLogger {
  /** Log command execution */
  logCommand(command: string, result: ExecutionResult): void;

  /** Log file changes */
  logFileChange(path: string, changeType: FileChangeType, diff?: string): void;

  /** Log git operations */
  logGitOperation(operation: string, result: GitResult): void;

  /** Log task start */
  logTaskStart(taskId: string, taskName?: string): void;

  /** Log task completion */
  logTaskEnd(taskId: string, success: boolean): void;

  /** Log an error */
  logError(error: Error, context?: string): void;

  /** Generate execution report */
  generateReport(taskId: string): ExecutionReport;

  /** Get recent logs */
  getRecentLogs(limit?: number): LogEntry[];

  /** Query logs with filters */
  queryLogs(filter: LogFilter): LogEntry[];

  /** Answer "What did you change?" */
  getChangeSummary(since?: Date): string;

  /** Set current task ID for correlation */
  setCurrentTask(taskId: string | null): void;

  /** Get current task ID */
  getCurrentTask(): string | null;

  /** Cleanup old logs */
  cleanup(): Promise<void>;
}

// ============================================================================
// Configuration
// ============================================================================

const LOG_DIR_NAME = 'logs';
const BRAIN_DIR = path.join(os.homedir(), '.atlas', 'brain');
const LOGS_DIR = path.join(BRAIN_DIR, LOG_DIR_NAME);
const LOG_RETENTION_DAYS = 30;
const MAX_ENTRIES_PER_FILE = 10000;
const COMPRESS_AFTER_DAYS = 7;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensure the logs directory exists
 */
function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    logger.debug('Created logs directory', { path: LOGS_DIR });
  }
}

/**
 * Generate a unique log entry ID
 */
function generateEntryId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `log_${timestamp}_${random}`;
}

/**
 * Format date for file names (YYYY-MM-DD)
 */
function formatDateForFile(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format time for display (HH:MM)
 */
function formatTime(date: Date): string {
  return date.toTimeString().split(' ')[0].substring(0, 5);
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Get the JSON log file path for a date
 */
function getJsonLogPath(date: Date): string {
  return path.join(LOGS_DIR, `${formatDateForFile(date)}-execution.json`);
}

/**
 * Get the Markdown log file path for a date
 */
function getMarkdownLogPath(date: Date): string {
  return path.join(LOGS_DIR, `${formatDateForFile(date)}-execution.md`);
}

/**
 * Format a date for Obsidian frontmatter
 */
function formatDateForObsidian(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Truncate long strings for display
 */
function truncate(str: string, maxLength: number = 200): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

/**
 * Escape markdown special characters
 */
function escapeMarkdown(str: string): string {
  return str.replace(/[`*_{}[\]()#+\-.!]/g, '\\$&');
}

// ============================================================================
// Lock for Thread-Safe Writing
// ============================================================================

/**
 * Simple file lock for thread-safe writing
 */
class FileLock {
  private locks: Map<string, Promise<void>> = new Map();

  async acquire(filePath: string): Promise<() => void> {
    // Wait for any existing lock on this file
    while (this.locks.has(filePath)) {
      await this.locks.get(filePath);
    }

    // Create a new lock
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(filePath, lockPromise);

    // Return release function
    return () => {
      this.locks.delete(filePath);
      release!();
    };
  }
}

const fileLock = new FileLock();

// ============================================================================
// ExecutionLogger Class
// ============================================================================

/**
 * ExecutionLogger provides comprehensive logging for all CLI operations.
 *
 * Logs are stored in both JSON (for querying) and Markdown (for Obsidian)
 * formats. Supports task correlation, file change tracking, and generates
 * human-readable reports and summaries.
 */
export class ExecutionLogger implements IExecutionLogger {
  private currentTaskId: string | null = null;
  private taskStartTimes: Map<string, Date> = new Map();
  private initialized = false;
  private entriesCache: Map<string, LogEntry[]> = new Map();

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the logger
   */
  private initialize(): void {
    try {
      ensureLogsDir();
      this.initialized = true;
      logger.debug('ExecutionLogger initialized', { logsDir: LOGS_DIR });
    } catch (error) {
      logger.error('Failed to initialize ExecutionLogger', {
        error: (error as Error).message,
      });
    }
  }

  // ==========================================================================
  // Core Logging Methods
  // ==========================================================================

  /**
   * Log a command execution
   */
  logCommand(command: string, result: ExecutionResult): void {
    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'command',
      category: this.categorizeCommand(command),
      summary: `Executed: ${truncate(command, 100)}`,
      details: {
        command: result.command,
        output: truncate(result.output, 1000),
        stderr: result.stderr ? truncate(result.stderr, 500) : undefined,
        exitCode: result.exitCode,
        duration: result.duration,
        durationFormatted: formatDuration(result.duration),
      },
      taskId: this.currentTaskId || undefined,
      success: result.exitCode === 0,
    };

    this.writeEntry(entry);
    logger.debug('Logged command', { command: truncate(command, 50), success: entry.success });
  }

  /**
   * Log a file change
   */
  logFileChange(filePath: string, changeType: FileChangeType, diff?: string): void {
    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'file',
      category: 'filesystem',
      summary: `${changeType.charAt(0).toUpperCase() + changeType.slice(1)}d: ${path.basename(filePath)}`,
      details: {
        path: filePath,
        changeType,
        diff: diff ? truncate(diff, 2000) : undefined,
        directory: path.dirname(filePath),
        extension: path.extname(filePath),
      },
      taskId: this.currentTaskId || undefined,
      success: true,
    };

    this.writeEntry(entry);
    logger.debug('Logged file change', { path: filePath, changeType });
  }

  /**
   * Log a git operation
   */
  logGitOperation(operation: string, result: GitResult): void {
    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'git',
      category: 'git',
      summary: `Git ${operation}: ${result.success ? 'Success' : 'Failed'}`,
      details: {
        operation,
        output: truncate(result.output, 1000),
        filesAffected: result.filesAffected,
        filesAffectedCount: result.filesAffected?.length || 0,
        commitHash: result.commitHash,
      },
      taskId: this.currentTaskId || undefined,
      success: result.success,
    };

    this.writeEntry(entry);
    logger.debug('Logged git operation', { operation, success: result.success });
  }

  /**
   * Log task start
   */
  logTaskStart(taskId: string, taskName?: string): void {
    this.taskStartTimes.set(taskId, new Date());

    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'task',
      category: 'task',
      summary: `Task started: ${taskName || taskId}`,
      details: {
        taskId,
        taskName,
        action: 'start',
      },
      taskId,
      success: true,
    };

    this.writeEntry(entry);
    logger.info('Task started', { taskId, taskName });
  }

  /**
   * Log task completion
   */
  logTaskEnd(taskId: string, success: boolean): void {
    const startTime = this.taskStartTimes.get(taskId);
    const duration = startTime ? Date.now() - startTime.getTime() : 0;

    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'task',
      category: 'task',
      summary: `Task ${success ? 'completed' : 'failed'}: ${taskId}`,
      details: {
        taskId,
        action: 'end',
        duration,
        durationFormatted: formatDuration(duration),
      },
      taskId,
      success,
    };

    this.writeEntry(entry);
    this.taskStartTimes.delete(taskId);

    if (taskId === this.currentTaskId) {
      this.currentTaskId = null;
    }

    logger.info('Task ended', { taskId, success, duration: formatDuration(duration) });
  }

  /**
   * Log an error
   */
  logError(error: Error, context?: string): void {
    const entry: LogEntry = {
      id: generateEntryId(),
      timestamp: new Date(),
      type: 'error',
      category: 'error',
      summary: context ? `${context}: ${error.message}` : error.message,
      details: {
        message: error.message,
        name: error.name,
        stack: error.stack,
        context,
      },
      taskId: this.currentTaskId || undefined,
      success: false,
    };

    this.writeEntry(entry);
    logger.error('Logged error', { error: error.message, context });
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  /**
   * Set the current task ID for correlation
   */
  setCurrentTask(taskId: string | null): void {
    this.currentTaskId = taskId;
  }

  /**
   * Get the current task ID
   */
  getCurrentTask(): string | null {
    return this.currentTaskId;
  }

  // ==========================================================================
  // Report Generation
  // ==========================================================================

  /**
   * Generate an execution report for a task
   */
  generateReport(taskId: string): ExecutionReport {
    const allLogs = this.getAllLogs();
    const taskLogs = allLogs.filter((log) => log.taskId === taskId);

    if (taskLogs.length === 0) {
      return {
        taskId,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        commandsExecuted: 0,
        filesModified: 0,
        success: false,
        logs: [],
        summary: `No logs found for task: ${taskId}`,
      };
    }

    // Find task name from start entry
    const startEntry = taskLogs.find(
      (log) => log.type === 'task' && log.details.action === 'start'
    );
    const endEntry = taskLogs.find((log) => log.type === 'task' && log.details.action === 'end');

    const startTime = startEntry?.timestamp || taskLogs[0].timestamp;
    const endTime = endEntry?.timestamp || taskLogs[taskLogs.length - 1].timestamp;

    const commandsExecuted = taskLogs.filter((log) => log.type === 'command').length;
    const filesModified = taskLogs.filter((log) => log.type === 'file').length;
    const gitOperations = taskLogs.filter((log) => log.type === 'git').length;
    const errors = taskLogs.filter((log) => log.type === 'error').length;
    const success = errors === 0 && (endEntry?.success ?? true);

    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();

    // Build summary
    const summaryParts: string[] = [];
    if (commandsExecuted > 0) summaryParts.push(`${commandsExecuted} commands`);
    if (filesModified > 0) summaryParts.push(`${filesModified} file changes`);
    if (gitOperations > 0) summaryParts.push(`${gitOperations} git operations`);
    if (errors > 0) summaryParts.push(`${errors} errors`);

    const summary = success
      ? `Completed successfully: ${summaryParts.join(', ')}`
      : `Failed with ${errors} error(s): ${summaryParts.join(', ')}`;

    return {
      taskId,
      taskName: (startEntry?.details.taskName as string) || undefined,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      duration,
      commandsExecuted,
      filesModified,
      success,
      logs: taskLogs,
      summary,
    };
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get recent log entries
   */
  getRecentLogs(limit: number = 50): LogEntry[] {
    const allLogs = this.getAllLogs();
    return allLogs.slice(-limit).reverse();
  }

  /**
   * Query logs with filters
   */
  queryLogs(filter: LogFilter): LogEntry[] {
    let logs = this.getAllLogs();

    // Filter by type
    if (filter.type) {
      logs = logs.filter((log) => log.type === filter.type);
    }

    // Filter by date range
    if (filter.since) {
      const sinceTime = new Date(filter.since).getTime();
      logs = logs.filter((log) => new Date(log.timestamp).getTime() >= sinceTime);
    }

    if (filter.until) {
      const untilTime = new Date(filter.until).getTime();
      logs = logs.filter((log) => new Date(log.timestamp).getTime() <= untilTime);
    }

    // Filter by task ID
    if (filter.taskId) {
      logs = logs.filter((log) => log.taskId === filter.taskId);
    }

    // Filter by success status
    if (filter.success !== undefined) {
      logs = logs.filter((log) => log.success === filter.success);
    }

    // Filter by search term
    if (filter.searchTerm) {
      const term = filter.searchTerm.toLowerCase();
      logs = logs.filter(
        (log) =>
          log.summary.toLowerCase().includes(term) ||
          JSON.stringify(log.details).toLowerCase().includes(term)
      );
    }

    return logs;
  }

  /**
   * Get a human-readable summary of changes since a given time
   * Answers the question: "What did you change?"
   */
  getChangeSummary(since?: Date): string {
    const sinceDate = since || new Date(Date.now() - 60 * 60 * 1000); // Default: last hour
    const logs = this.queryLogs({ since: sinceDate });

    if (logs.length === 0) {
      const timeDesc = since ? `since ${sinceDate.toLocaleTimeString()}` : 'in the last hour';
      return `No changes recorded ${timeDesc}.`;
    }

    // Group by type
    const commands = logs.filter((l) => l.type === 'command');
    const fileChanges = logs.filter((l) => l.type === 'file');
    const gitOps = logs.filter((l) => l.type === 'git');
    const errors = logs.filter((l) => l.type === 'error');

    // Build summary parts
    const parts: string[] = [];
    const timePeriod = since ? `since ${sinceDate.toLocaleTimeString()}` : 'in the last hour';

    parts.push(`${timePeriod}, I made the following changes:`);

    // File changes
    if (fileChanges.length > 0) {
      const byDir = new Map<string, number>();
      for (const log of fileChanges) {
        const dir = (log.details.directory as string) || 'unknown';
        const shortDir = dir.split(path.sep).slice(-2).join('/');
        byDir.set(shortDir, (byDir.get(shortDir) || 0) + 1);
      }

      for (const [dir, count] of Array.from(byDir.entries())) {
        parts.push(`- Modified ${count} file${count > 1 ? 's' : ''} in ${dir}/`);
      }
    }

    // Commands
    if (commands.length > 0) {
      const significantCommands = commands.filter((c) => {
        const cmd = (c.details.command as string) || '';
        return (
          cmd.startsWith('npm ') ||
          cmd.startsWith('git ') ||
          cmd.startsWith('yarn ') ||
          cmd.startsWith('pnpm ')
        );
      });

      for (const cmd of significantCommands.slice(0, 5)) {
        const command = truncate((cmd.details.command as string) || cmd.summary, 50);
        const status = cmd.success ? 'passed' : 'failed';
        parts.push(`- Ran '${command}' (${status})`);
      }

      if (significantCommands.length > 5) {
        parts.push(`- ...and ${significantCommands.length - 5} more commands`);
      }
    }

    // Git operations
    if (gitOps.length > 0) {
      const commits = gitOps.filter((g) => g.details.operation === 'commit');
      const pushes = gitOps.filter((g) => g.details.operation === 'push');

      for (const commit of commits) {
        const hash = commit.details.commitHash
          ? (commit.details.commitHash as string).substring(0, 7)
          : '';
        parts.push(`- Committed changes${hash ? ` (${hash})` : ''}`);
      }

      for (const push of pushes) {
        const output = (push.details.output as string) || '';
        const branchMatch = output.match(/-> (\S+)/);
        const branch = branchMatch ? branchMatch[1] : 'remote';
        parts.push(`- Pushed to ${branch}`);
      }
    }

    // Errors
    if (errors.length > 0) {
      parts.push(`- Encountered ${errors.length} error${errors.length > 1 ? 's' : ''}`);
    }

    return parts.join('\n');
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  /**
   * Write an entry to both JSON and Markdown logs
   */
  private async writeEntry(entry: LogEntry): Promise<void> {
    if (!this.initialized) {
      logger.warn('ExecutionLogger not initialized, skipping write');
      return;
    }

    const today = new Date();
    const jsonPath = getJsonLogPath(today);
    const mdPath = getMarkdownLogPath(today);

    // Write to JSON file (thread-safe)
    const releaseJson = await fileLock.acquire(jsonPath);
    try {
      await this.appendToJsonLog(jsonPath, entry);
    } finally {
      releaseJson();
    }

    // Write to Markdown file (thread-safe)
    const releaseMd = await fileLock.acquire(mdPath);
    try {
      await this.appendToMarkdownLog(mdPath, entry, today);
    } finally {
      releaseMd();
    }

    // Update cache
    const dateKey = formatDateForFile(today);
    if (!this.entriesCache.has(dateKey)) {
      this.entriesCache.set(dateKey, []);
    }
    this.entriesCache.get(dateKey)!.push(entry);
  }

  /**
   * Append entry to JSON log file
   */
  private async appendToJsonLog(filePath: string, entry: LogEntry): Promise<void> {
    try {
      let entries: LogEntry[] = [];

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          entries = JSON.parse(content);
        } catch {
          // File corrupted, start fresh
          logger.warn('JSON log file corrupted, starting fresh', { path: filePath });
        }
      }

      entries.push(entry);

      // Trim if too many entries
      if (entries.length > MAX_ENTRIES_PER_FILE) {
        entries = entries.slice(-MAX_ENTRIES_PER_FILE);
      }

      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to write JSON log', {
        path: filePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Append entry to Markdown log file
   */
  private async appendToMarkdownLog(filePath: string, entry: LogEntry, date: Date): Promise<void> {
    try {
      const isNewFile = !fs.existsSync(filePath);

      if (isNewFile) {
        // Create header for new file
        const header = this.generateMarkdownHeader(date);
        fs.writeFileSync(filePath, header, 'utf-8');
      }

      // Append entry
      const mdEntry = this.formatEntryAsMarkdown(entry);
      fs.appendFileSync(filePath, mdEntry, 'utf-8');

      // Update summary section (rebuild it)
      await this.updateMarkdownSummary(filePath, date);
    } catch (error) {
      logger.error('Failed to write Markdown log', {
        path: filePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Generate Markdown header for daily log
   */
  private generateMarkdownHeader(date: Date): string {
    return `# Execution Log - ${formatDateForObsidian(date)}

---
tags: [execution-log, atlas]
date: ${formatDateForFile(date)}
---

## Summary

_Summary will be updated as entries are added..._

## Timeline

`;
  }

  /**
   * Format a log entry as Markdown
   */
  private formatEntryAsMarkdown(entry: LogEntry): string {
    const time = formatTime(new Date(entry.timestamp));
    const icon = this.getEntryIcon(entry);
    const status = entry.success ? '✓' : '✗';

    let md = `\n### ${time} - ${icon} ${entry.summary}\n`;

    switch (entry.type) {
      case 'command':
        md += `- **Command:** \`${escapeMarkdown(truncate((entry.details.command as string) || '', 80))}\`\n`;
        md += `- **Duration:** ${entry.details.durationFormatted || 'N/A'}\n`;
        md += `- **Result:** ${status} Exit code ${entry.details.exitCode}\n`;
        if (entry.details.output && (entry.details.output as string).length > 0) {
          md += `- **Output:**\n\`\`\`\n${truncate(entry.details.output as string, 500)}\n\`\`\`\n`;
        }
        break;

      case 'file':
        md += `- **File:** \`${entry.details.path}\`\n`;
        md += `- **Change:** ${entry.details.changeType}\n`;
        if (entry.details.diff) {
          md += `- **Diff:**\n\`\`\`diff\n${truncate(entry.details.diff as string, 500)}\n\`\`\`\n`;
        }
        break;

      case 'git':
        md += `- **Operation:** ${entry.details.operation}\n`;
        md += `- **Result:** ${status}\n`;
        if (entry.details.filesAffectedCount) {
          md += `- **Files affected:** ${entry.details.filesAffectedCount}\n`;
        }
        if (entry.details.commitHash) {
          md += `- **Commit:** \`${entry.details.commitHash}\`\n`;
        }
        break;

      case 'task':
        if (entry.details.action === 'start') {
          md += `- **Task ID:** ${entry.details.taskId}\n`;
          if (entry.details.taskName) {
            md += `- **Name:** ${entry.details.taskName}\n`;
          }
        } else {
          md += `- **Duration:** ${entry.details.durationFormatted || 'N/A'}\n`;
          md += `- **Result:** ${status}\n`;
        }
        break;

      case 'error':
        md += `- **Error:** ${entry.details.message}\n`;
        if (entry.details.context) {
          md += `- **Context:** ${entry.details.context}\n`;
        }
        break;
    }

    return md;
  }

  /**
   * Get icon for entry type
   */
  private getEntryIcon(entry: LogEntry): string {
    switch (entry.type) {
      case 'command':
        return 'Terminal';
      case 'file':
        return 'File';
      case 'git':
        return 'Git';
      case 'task':
        return entry.details.action === 'start' ? 'Task Start' : 'Task End';
      case 'error':
        return 'Error';
      default:
        return 'Log';
    }
  }

  /**
   * Update the summary section of the Markdown log
   */
  private async updateMarkdownSummary(filePath: string, date: Date): Promise<void> {
    try {
      const jsonPath = getJsonLogPath(date);
      if (!fs.existsSync(jsonPath)) return;

      const content = fs.readFileSync(jsonPath, 'utf-8');
      const entries: LogEntry[] = JSON.parse(content);

      const summary = this.calculateDailySummary(entries);

      // Read current markdown
      const mdContent = fs.readFileSync(filePath, 'utf-8');

      // Replace summary section
      const summaryMarkdown = `## Summary

- **Commands executed:** ${summary.commandsExecuted}
- **Files modified:** ${summary.filesModified}
- **Git operations:** ${summary.gitOperations}
- **Success rate:** ${summary.successRate.toFixed(0)}%

`;

      const newContent = mdContent.replace(/## Summary\n[\s\S]*?(?=## Timeline)/, summaryMarkdown);

      fs.writeFileSync(filePath, newContent, 'utf-8');
    } catch (error) {
      // Non-critical, just log
      logger.debug('Failed to update markdown summary', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Calculate daily summary statistics
   */
  private calculateDailySummary(entries: LogEntry[]): DailyLogSummary {
    const commandsExecuted = entries.filter((e) => e.type === 'command').length;
    const filesModified = entries.filter((e) => e.type === 'file').length;
    const gitOperations = entries.filter((e) => e.type === 'git').length;

    const totalOps = commandsExecuted + gitOperations;
    const successfulOps = entries.filter(
      (e) => (e.type === 'command' || e.type === 'git') && e.success
    ).length;
    const successRate = totalOps > 0 ? (successfulOps / totalOps) * 100 : 100;

    return {
      date: formatDateForFile(new Date()),
      commandsExecuted,
      filesModified,
      gitOperations,
      successRate,
      entries,
    };
  }

  /**
   * Get all logs (from cache or disk)
   */
  private getAllLogs(): LogEntry[] {
    const allEntries: LogEntry[] = [];

    // Get list of JSON log files
    if (!fs.existsSync(LOGS_DIR)) {
      return allEntries;
    }

    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('-execution.json'));

    for (const file of files) {
      const dateKey = file.replace('-execution.json', '');

      // Check cache first
      if (this.entriesCache.has(dateKey)) {
        allEntries.push(...this.entriesCache.get(dateKey)!);
        continue;
      }

      // Load from disk
      try {
        const filePath = path.join(LOGS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const entries: LogEntry[] = JSON.parse(content);

        // Convert timestamps back to Date objects
        for (const entry of entries) {
          entry.timestamp = new Date(entry.timestamp);
        }

        this.entriesCache.set(dateKey, entries);
        allEntries.push(...entries);
      } catch (error) {
        logger.warn('Failed to load log file', { file, error: (error as Error).message });
      }
    }

    // Sort by timestamp
    allEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return allEntries;
  }

  /**
   * Categorize a command for logging
   */
  private categorizeCommand(command: string): string {
    const cmd = command.toLowerCase().trim();

    if (cmd.startsWith('git ')) return 'git';
    if (cmd.startsWith('npm ') || cmd.startsWith('yarn ') || cmd.startsWith('pnpm '))
      return 'package-manager';
    if (cmd.startsWith('node ') || cmd.startsWith('npx ')) return 'node';
    if (cmd.startsWith('docker ')) return 'docker';
    if (cmd.startsWith('cd ') || cmd.startsWith('mkdir ') || cmd.startsWith('rm '))
      return 'filesystem';
    if (cmd.startsWith('curl ') || cmd.startsWith('wget ')) return 'network';

    return 'command';
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up old logs and compress aging logs
   */
  async cleanup(): Promise<void> {
    if (!fs.existsSync(LOGS_DIR)) return;

    const now = Date.now();
    const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const compressMs = COMPRESS_AFTER_DAYS * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(LOGS_DIR);
    let deletedCount = 0;
    let compressedCount = 0;

    for (const file of files) {
      // Skip compressed files and non-log files
      if (file.endsWith('.gz') || (!file.endsWith('.json') && !file.endsWith('.md'))) {
        continue;
      }

      // Extract date from filename
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const fileDate = new Date(dateMatch[1]).getTime();
      const age = now - fileDate;

      const filePath = path.join(LOGS_DIR, file);

      // Delete old files
      if (age > retentionMs) {
        try {
          fs.unlinkSync(filePath);
          deletedCount++;

          // Also delete compressed version if exists
          const gzPath = filePath + '.gz';
          if (fs.existsSync(gzPath)) {
            fs.unlinkSync(gzPath);
          }
        } catch (error) {
          logger.warn('Failed to delete old log', { file, error: (error as Error).message });
        }
        continue;
      }

      // Compress aging files (only JSON files, skip today's)
      if (age > compressMs && file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(filePath);
          const compressed = zlib.gzipSync(content);
          fs.writeFileSync(filePath + '.gz', compressed);
          fs.unlinkSync(filePath);
          compressedCount++;
        } catch (error) {
          logger.warn('Failed to compress log', { file, error: (error as Error).message });
        }
      }
    }

    // Clear cache for deleted files
    this.entriesCache.clear();

    logger.info('Log cleanup completed', {
      deleted: deletedCount,
      compressed: compressedCount,
    });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: ExecutionLogger | null = null;

/**
 * Get the singleton ExecutionLogger instance
 */
export function getExecutionLogger(): ExecutionLogger {
  if (!instance) {
    instance = new ExecutionLogger();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetExecutionLogger(): void {
  instance = null;
}

export default {
  ExecutionLogger,
  getExecutionLogger,
  resetExecutionLogger,
};
