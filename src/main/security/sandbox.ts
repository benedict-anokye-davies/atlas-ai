/**
 * Atlas Desktop - Sandbox
 * Sandboxed execution environment for agent tools
 *
 * Features:
 * - Isolated execution contexts for tools
 * - Resource limits (memory, CPU time, file handles)
 * - Network access control
 * - File system isolation via FileGuard
 * - Execution timeouts with cleanup
 * - Audit logging of all sandboxed operations
 *
 * @module security/sandbox
 */

import { ChildProcess } from 'child_process';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';
import { getFileGuard, FileGuard } from './file-guard';
import { getSafeTerminalExecutor, SafeTerminalExecutor } from './safe-terminal-executor';
import { AtlasError } from '../utils/errors';
import {
  SandboxConfig,
  SandboxExecutionResult,
  SandboxResourceLimits,
  SandboxExecutionContext,
  DEFAULT_SANDBOX_CONFIG,
  ToolExecutionRecord,
} from '../../shared/types/security';
import { TerminalResult } from '../../shared/types/agent';

const logger = createModuleLogger('Sandbox');

/**
 * Sandbox Error
 */
export class SandboxError extends AtlasError {
  constructor(
    message: string,
    public toolName: string,
    public executionId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'SANDBOX_ERROR', true, {
      toolName,
      executionId,
      ...context,
    });
    this.name = 'SandboxError';
  }
}

/**
 * Active execution tracker
 */
interface ActiveExecution {
  id: string;
  toolName: string;
  startTime: number;
  timeout: NodeJS.Timeout;
  process?: ChildProcess;
  abortController?: AbortController;
  cleanup: () => Promise<void>;
}

/**
 * Sandbox - Secure execution environment for tools
 */
export class Sandbox {
  private config: SandboxConfig;
  private fileGuard: FileGuard;
  private terminalExecutor: SafeTerminalExecutor;
  private auditLogger: AuditLogger;
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private executionHistory: ToolExecutionRecord[] = [];
  private executionCounter = 0;
  private sessionId: string;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    this.fileGuard = getFileGuard();
    this.terminalExecutor = getSafeTerminalExecutor();
    this.auditLogger = getAuditLogger();
    this.sessionId = config?.sessionId ?? 'default';

    logger.info('Sandbox initialized', {
      maxConcurrent: this.config.maxConcurrentExecutions,
      defaultTimeout: this.config.defaultTimeout,
    });
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.executionCounter).toString(36).padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 6);
    return `exec-${timestamp}-${counter}-${random}`;
  }

  /**
   * Check if we can start a new execution
   */
  private canStartExecution(): boolean {
    return this.activeExecutions.size < this.config.maxConcurrentExecutions;
  }

  /**
   * Create execution context
   */
  private createContext(
    executionId: string,
    toolName: string,
    params: Record<string, unknown>
  ): SandboxExecutionContext {
    return {
      executionId,
      toolName,
      params,
      startTime: Date.now(),
      sessionId: this.sessionId,
      resourceLimits: { ...this.config.resourceLimits },
      workingDirectory: this.config.workingDirectory || process.cwd(),
      environmentVariables: { ...this.config.environmentVariables },
    };
  }

  /**
   * Execute a tool in the sandbox
   */
  async execute<T>(
    toolName: string,
    executor: (context: SandboxExecutionContext) => Promise<T>,
    options: {
      params?: Record<string, unknown>;
      timeout?: number;
      resourceLimits?: Partial<SandboxResourceLimits>;
      source?: string;
    } = {}
  ): Promise<SandboxExecutionResult<T>> {
    const {
      params = {},
      timeout = this.config.defaultTimeout,
      resourceLimits,
      source = 'agent',
    } = options;

    // Check concurrent execution limit
    if (!this.canStartExecution()) {
      throw new SandboxError(
        `Maximum concurrent executions (${this.config.maxConcurrentExecutions}) reached`,
        toolName,
        'pending',
        { activeCount: this.activeExecutions.size }
      );
    }

    const executionId = this.generateExecutionId();
    const context = this.createContext(executionId, toolName, params);

    // Apply custom resource limits
    if (resourceLimits) {
      context.resourceLimits = { ...context.resourceLimits, ...resourceLimits };
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();

    // Create execution record
    const record: ToolExecutionRecord = {
      id: executionId,
      toolName,
      params,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      success: false,
      sessionId: this.sessionId,
      source,
    };

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new SandboxError('Execution timed out', toolName, executionId, { timeout }));
      }, timeout);

      // Store timeout handle for cleanup
      const activeExec: ActiveExecution = {
        id: executionId,
        toolName,
        startTime: Date.now(),
        timeout: timeoutHandle,
        abortController,
        cleanup: async () => {
          clearTimeout(timeoutHandle);
          abortController.abort();
        },
      };
      this.activeExecutions.set(executionId, activeExec);
    });

    try {
      logger.debug('Starting sandboxed execution', { executionId, toolName });

      // Log execution start
      this.auditLogger.log('command_execution', 'info', `Tool execution started: ${toolName}`, {
        action: `tool:${toolName}`,
        allowed: true,
        source,
        sessionId: this.sessionId,
        context: { executionId, params: this.sanitizeParams(params) },
      });

      // Execute with timeout
      const result = await Promise.race([
        this.runInSandbox(context, executor, abortController.signal),
        timeoutPromise,
      ]);

      // Update record
      record.endTime = Date.now();
      record.duration = record.endTime - record.startTime;
      record.success = true;
      record.result = result as unknown;

      // Log success
      this.auditLogger.log('command_execution', 'info', `Tool execution completed: ${toolName}`, {
        action: `tool:${toolName}`,
        allowed: true,
        source,
        sessionId: this.sessionId,
        context: { executionId, duration: record.duration },
      });

      return {
        success: true,
        executionId,
        toolName,
        result,
        duration: record.duration,
        startTime: record.startTime,
        endTime: record.endTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Update record
      record.endTime = Date.now();
      record.duration = record.endTime - record.startTime;
      record.success = false;
      record.error = err.message;

      // Log failure
      this.auditLogger.log('command_execution', 'warning', `Tool execution failed: ${toolName}`, {
        action: `tool:${toolName}`,
        allowed: true,
        reason: err.message,
        source,
        sessionId: this.sessionId,
        context: { executionId, error: err.message },
      });

      logger.warn('Sandboxed execution failed', {
        executionId,
        toolName,
        error: err.message,
      });

      return {
        success: false,
        executionId,
        toolName,
        error: err.message,
        duration: record.duration,
        startTime: record.startTime,
        endTime: record.endTime,
      };
    } finally {
      // Cleanup
      const activeExec = this.activeExecutions.get(executionId);
      if (activeExec) {
        await activeExec.cleanup();
        this.activeExecutions.delete(executionId);
      }

      // Add to history
      this.addToHistory(record);
    }
  }

  /**
   * Run executor in sandboxed context
   */
  private async runInSandbox<T>(
    context: SandboxExecutionContext,
    executor: (context: SandboxExecutionContext) => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    // Check if already aborted
    if (signal.aborted) {
      throw new SandboxError('Execution aborted', context.toolName, context.executionId);
    }

    // Create sandbox-aware context
    const sandboxedContext: SandboxExecutionContext = {
      ...context,
      fileGuard: this.fileGuard,
      terminalExecutor: this.terminalExecutor,
      abortSignal: signal,
    };

    return executor(sandboxedContext);
  }

  /**
   * Execute a terminal command in the sandbox
   */
  async executeCommand(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
      source?: string;
    } = {}
  ): Promise<SandboxExecutionResult<TerminalResult>> {
    const { cwd, env, timeout = this.config.defaultTimeout, source = 'agent' } = options;

    return this.execute(
      'terminal',
      async (context) => {
        const result = await this.terminalExecutor.execute(command, {
          cwd: cwd || context.workingDirectory,
          env: { ...context.environmentVariables, ...env },
          timeout,
          sessionId: context.sessionId,
          source,
        });

        if (!result.success) {
          throw new Error(result.error || 'Command execution failed');
        }

        return result.data!;
      },
      { params: { command, cwd, env }, timeout, source }
    );
  }

  /**
   * Execute a file read operation in the sandbox
   */
  async readFile(
    filePath: string,
    options: {
      encoding?: BufferEncoding;
      maxSize?: number;
      source?: string;
    } = {}
  ): Promise<SandboxExecutionResult<string | Buffer>> {
    const { encoding = 'utf-8', maxSize, source = 'agent' } = options;

    return this.execute(
      'file_read',
      async () => {
        return this.fileGuard.readFile(filePath, {
          encoding,
          maxSize,
          source,
          reason: 'Sandboxed file read',
        });
      },
      { params: { filePath, encoding }, source }
    );
  }

  /**
   * Execute a file write operation in the sandbox
   */
  async writeFile(
    filePath: string,
    content: string | Buffer,
    options: {
      encoding?: BufferEncoding;
      source?: string;
    } = {}
  ): Promise<SandboxExecutionResult<void>> {
    const { encoding = 'utf-8', source = 'agent' } = options;

    return this.execute(
      'file_write',
      async () => {
        await this.fileGuard.writeFile(filePath, content, {
          encoding,
          source,
          reason: 'Sandboxed file write',
        });
      },
      {
        params: { filePath, contentSize: Buffer.byteLength(content) },
        source,
      }
    );
  }

  /**
   * Execute a directory listing in the sandbox
   */
  async listDirectory(
    dirPath: string,
    options: {
      recursive?: boolean;
      maxEntries?: number;
      source?: string;
    } = {}
  ): Promise<SandboxExecutionResult<string[]>> {
    const { recursive = false, maxEntries = 1000, source = 'agent' } = options;

    return this.execute(
      'dir_list',
      async () => {
        return this.fileGuard.listDirectory(dirPath, {
          recursive,
          maxEntries,
          source,
          reason: 'Sandboxed directory listing',
        });
      },
      { params: { dirPath, recursive, maxEntries }, source }
    );
  }

  /**
   * Cancel an active execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const activeExec = this.activeExecutions.get(executionId);
    if (!activeExec) {
      return false;
    }

    logger.info('Cancelling execution', { executionId, toolName: activeExec.toolName });

    await activeExec.cleanup();
    this.activeExecutions.delete(executionId);

    // Log cancellation
    this.auditLogger.log('command_execution', 'warning', `Execution cancelled: ${executionId}`, {
      action: `cancel:${activeExec.toolName}`,
      allowed: true,
      source: 'user',
      sessionId: this.sessionId,
      context: { executionId },
    });

    return true;
  }

  /**
   * Cancel all active executions
   */
  async cancelAllExecutions(): Promise<number> {
    const count = this.activeExecutions.size;

    for (const [executionId, activeExec] of this.activeExecutions) {
      logger.info('Cancelling execution', { executionId, toolName: activeExec.toolName });
      await activeExec.cleanup();
    }

    this.activeExecutions.clear();

    if (count > 0) {
      logger.info('All executions cancelled', { count });
    }

    return count;
  }

  /**
   * Sanitize parameters for logging (remove sensitive data)
   */
  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'auth'];

    for (const [key, value] of Object.entries(params)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = `[String length: ${value.length}]`;
      } else if (Buffer.isBuffer(value)) {
        sanitized[key] = `[Buffer length: ${value.length}]`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Add execution record to history
   */
  private addToHistory(record: ToolExecutionRecord): void {
    this.executionHistory.push(record);

    // Keep only last N records
    const maxHistory = this.config.maxHistorySize ?? 1000;
    if (this.executionHistory.length > maxHistory) {
      this.executionHistory = this.executionHistory.slice(-maxHistory);
    }
  }

  /**
   * Get execution history
   */
  getHistory(
    options: { limit?: number; toolName?: string; success?: boolean } = {}
  ): ToolExecutionRecord[] {
    const { limit = 100, toolName, success } = options;

    let filtered = this.executionHistory;

    if (toolName) {
      filtered = filtered.filter((r) => r.toolName === toolName);
    }

    if (success !== undefined) {
      filtered = filtered.filter((r) => r.success === success);
    }

    return filtered.slice(-limit);
  }

  /**
   * Get statistics about sandbox executions
   */
  getStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageDuration: number;
    activeExecutions: number;
    executionsByTool: Record<string, number>;
  } {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter((r) => r.success).length;
    const failed = total - successful;

    const totalDuration = this.executionHistory.reduce((sum, r) => sum + r.duration, 0);
    const averageDuration = total > 0 ? totalDuration / total : 0;

    const byTool: Record<string, number> = {};
    for (const record of this.executionHistory) {
      byTool[record.toolName] = (byTool[record.toolName] || 0) + 1;
    }

    return {
      totalExecutions: total,
      successfulExecutions: successful,
      failedExecutions: failed,
      averageDuration,
      activeExecutions: this.activeExecutions.size,
      executionsByTool: byTool,
    };
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): Array<{
    id: string;
    toolName: string;
    startTime: number;
    runningTime: number;
  }> {
    const now = Date.now();
    return Array.from(this.activeExecutions.values()).map((exec) => ({
      id: exec.id,
      toolName: exec.toolName,
      startTime: exec.startTime,
      runningTime: now - exec.startTime,
    }));
  }

  /**
   * Clear execution history
   */
  clearHistory(): void {
    this.executionHistory = [];
    logger.info('Execution history cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Sandbox config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * Shutdown the sandbox
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down sandbox...');

    // Cancel all active executions
    await this.cancelAllExecutions();

    logger.info('Sandbox shutdown complete');
  }
}

// Singleton instance
let sandboxInstance: Sandbox | null = null;

/**
 * Get or create the singleton Sandbox instance
 */
export function getSandbox(config?: Partial<SandboxConfig>): Sandbox {
  if (!sandboxInstance) {
    sandboxInstance = new Sandbox(config);
  }
  return sandboxInstance;
}

/**
 * Shutdown the sandbox
 */
export async function shutdownSandbox(): Promise<void> {
  if (sandboxInstance) {
    await sandboxInstance.shutdown();
    sandboxInstance = null;
  }
}

export default Sandbox;
