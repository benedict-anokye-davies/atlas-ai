/**
 * Nova Desktop - Safe Terminal Executor
 * Security-hardened command execution with whitelisting and sandboxing
 *
 * Features:
 * - Command whitelisting with argument validation
 * - Dangerous pattern blocking (fork bombs, system destruction, etc.)
 * - Rate limiting per session
 * - Audit logging of all command executions
 * - Path traversal prevention
 * - Shell metacharacter escaping
 *
 * @module security/safe-terminal-executor
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';
import {
  CommandValidationResult,
  SecurityConfig,
  DEFAULT_SECURITY_CONFIG,
  CRITICAL_BLOCKED_PATTERNS,
  DEFAULT_COMMAND_WHITELIST,
  WhitelistEntry,
  BLOCKED_PATH_PATTERNS,
  SHELL_METACHARACTERS,
  RateLimitStatus,
} from '../../shared/types/security';
import { TerminalResult, TerminalExecuteOptions } from '../../shared/types/agent';

const logger = createModuleLogger('SafeTerminalExecutor');

/**
 * Safe Terminal Executor configuration
 */
export interface SafeTerminalExecutorConfig extends Partial<SecurityConfig> {
  /** Custom whitelist entries to add */
  additionalWhitelist?: WhitelistEntry[];
  /** Whether to use strict whitelist mode (only whitelisted commands allowed) */
  strictMode?: boolean;
  /** Allowed working directories (empty = all allowed) */
  allowedWorkingDirs?: string[];
  /** Session ID for rate limiting */
  sessionId?: string;
}

/**
 * Rate limiter state
 */
interface RateLimiterState {
  requestCount: number;
  windowStart: number;
  burstCount: number;
  burstWindowStart: number;
}

/**
 * Safe Terminal Executor
 * Provides security-hardened command execution
 */
export class SafeTerminalExecutor {
  private config: SecurityConfig;
  private whitelist: Map<string, WhitelistEntry>;
  private auditLogger: AuditLogger;
  private rateLimiters: Map<string, RateLimiterState> = new Map();
  private strictMode: boolean;
  private allowedWorkingDirs: string[];
  private sessionId: string;

  constructor(config?: SafeTerminalExecutorConfig) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
    this.strictMode = config?.strictMode ?? true;
    this.allowedWorkingDirs = config?.allowedWorkingDirs ?? [];
    this.sessionId = config?.sessionId ?? 'default';

    // Build whitelist map
    this.whitelist = new Map();
    for (const entry of DEFAULT_COMMAND_WHITELIST) {
      this.whitelist.set(entry.command.toLowerCase(), entry);
    }

    // Add custom whitelist entries
    if (config?.additionalWhitelist) {
      for (const entry of config.additionalWhitelist) {
        this.whitelist.set(entry.command.toLowerCase(), entry);
      }
    }

    this.auditLogger = getAuditLogger();

    logger.info('SafeTerminalExecutor initialized', {
      strictMode: this.strictMode,
      whitelistSize: this.whitelist.size,
    });
  }

  /**
   * Validate a command for security
   */
  validateCommand(command: string): CommandValidationResult {
    // Check command length
    if (command.length > this.config.maxCommandLength) {
      return {
        allowed: false,
        reason: `Command exceeds maximum length of ${this.config.maxCommandLength} characters`,
        severity: 'blocked',
        riskLevel: 'critical',
        requiresConfirmation: false,
      };
    }

    // Check for critical blocked patterns FIRST (these are ALWAYS blocked)
    for (const pattern of CRITICAL_BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: 'Command matches critical security pattern and is blocked',
          severity: 'blocked',
          riskLevel: 'critical',
          matchedPattern: pattern.source,
          requiresConfirmation: false,
        };
      }
    }

    // Parse the command to extract base command and arguments
    const { baseCommand, args } = this.parseCommand(command);

    // Check if command is in whitelist
    const whitelistEntry = this.whitelist.get(baseCommand.toLowerCase());

    if (this.strictMode && !whitelistEntry) {
      return {
        allowed: false,
        reason: `Command "${baseCommand}" is not in the whitelist. Only whitelisted commands are allowed.`,
        severity: 'blocked',
        riskLevel: 'high',
        requiresConfirmation: false,
      };
    }

    if (whitelistEntry) {
      // Check blocked arguments
      if (whitelistEntry.blockedArgs) {
        const argsJoined = args.join(' ');
        for (const blockedArg of whitelistEntry.blockedArgs) {
          if (argsJoined.includes(blockedArg)) {
            return {
              allowed: false,
              reason: `Argument "${blockedArg}" is blocked for command "${baseCommand}"`,
              severity: 'blocked',
              riskLevel: 'high',
              matchedPattern: blockedArg,
              requiresConfirmation: false,
            };
          }
        }
      }

      // Check allowed arguments (if restricted)
      if (whitelistEntry.allowedArgs && whitelistEntry.allowedArgs.length > 0) {
        // For commands with allowed args, check that all flags are in the list
        const flags = args.filter((arg) => arg.startsWith('-'));
        for (const flag of flags) {
          // Check if this flag or any prefix of it is in allowed args
          const isAllowed = whitelistEntry.allowedArgs.some(
            (allowed) => flag === allowed || flag.startsWith(allowed)
          );

          if (!isAllowed) {
            return {
              allowed: false,
              reason: `Argument "${flag}" is not in the allowed list for "${baseCommand}"`,
              severity: 'warning',
              riskLevel: 'medium',
              requiresConfirmation: true,
            };
          }
        }
      }

      // Determine risk level from whitelist entry
      const riskLevel = this.getConfirmationRiskLevel(whitelistEntry.confirmationLevel);

      return {
        allowed: true,
        reason: 'Command is whitelisted and passes security checks',
        severity: 'info',
        riskLevel,
        requiresConfirmation: whitelistEntry.confirmationLevel !== 'none',
      };
    }

    // Non-strict mode: allow unknown commands with medium risk
    return {
      allowed: true,
      reason: 'Command allowed (non-strict mode)',
      severity: 'warning',
      riskLevel: 'medium',
      requiresConfirmation: true,
    };
  }

  /**
   * Check if a path is allowed
   */
  validatePath(filePath: string): CommandValidationResult {
    const normalizedPath = path.normalize(filePath);

    // Check against blocked path patterns
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(normalizedPath) || pattern.test(filePath)) {
        return {
          allowed: false,
          reason: `Path "${filePath}" matches blocked pattern`,
          severity: 'blocked',
          riskLevel: 'critical',
          matchedPattern: pattern.source,
          requiresConfirmation: false,
        };
      }
    }

    // Check path traversal
    if (filePath.includes('..')) {
      return {
        allowed: false,
        reason: 'Path traversal attempt detected',
        severity: 'blocked',
        riskLevel: 'critical',
        matchedPattern: '..',
        requiresConfirmation: false,
      };
    }

    return {
      allowed: true,
      reason: 'Path is allowed',
      severity: 'info',
      riskLevel: 'safe',
      requiresConfirmation: false,
    };
  }

  /**
   * Check working directory
   */
  validateWorkingDirectory(cwd: string): CommandValidationResult {
    const normalizedCwd = path.resolve(cwd);

    // If allowed directories are specified, check against them
    if (this.allowedWorkingDirs.length > 0) {
      const isAllowed = this.allowedWorkingDirs.some((allowedDir) => {
        const normalizedAllowed = path.resolve(allowedDir);
        return (
          normalizedCwd === normalizedAllowed ||
          normalizedCwd.startsWith(normalizedAllowed + path.sep)
        );
      });

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Working directory "${cwd}" is not in the allowed list`,
          severity: 'blocked',
          riskLevel: 'high',
          requiresConfirmation: false,
        };
      }
    }

    // Check against blocked paths
    return this.validatePath(normalizedCwd);
  }

  /**
   * Check rate limit
   */
  checkRateLimit(sessionId?: string): RateLimitStatus {
    const id = sessionId ?? this.sessionId;
    const now = Date.now();
    const config = this.config.rateLimit;

    let state = this.rateLimiters.get(id);

    if (!state) {
      state = {
        requestCount: 0,
        windowStart: now,
        burstCount: 0,
        burstWindowStart: now,
      };
      this.rateLimiters.set(id, state);
    }

    // Check if window needs reset
    if (now - state.windowStart >= config.windowMs) {
      state.requestCount = 0;
      state.windowStart = now;
    }

    // Check if burst window needs reset (1 second window)
    if (now - state.burstWindowStart >= 1000) {
      state.burstCount = 0;
      state.burstWindowStart = now;
    }

    // Check limits
    const burstLimit = config.burstLimit ?? 5;
    const remaining = config.maxRequests - state.requestCount;
    const resetIn = config.windowMs - (now - state.windowStart);

    if (state.burstCount >= burstLimit) {
      return {
        allowed: false,
        remaining,
        resetIn: 1000 - (now - state.burstWindowStart),
        currentCount: state.requestCount,
      };
    }

    if (state.requestCount >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        currentCount: state.requestCount,
      };
    }

    // Increment counters
    state.requestCount++;
    state.burstCount++;

    return {
      allowed: true,
      remaining: remaining - 1,
      resetIn,
      currentCount: state.requestCount,
    };
  }

  /**
   * Execute a command with full security validation
   */
  async execute(
    command: string,
    options: TerminalExecuteOptions & { sessionId?: string; source?: string } = {}
  ): Promise<{ success: boolean; data?: TerminalResult; error?: string }> {
    const startTime = Date.now();
    const source = options.source ?? 'terminal';
    const sessionId = options.sessionId ?? this.sessionId;

    // Check rate limit
    if (this.config.enableRateLimiting) {
      const rateLimitStatus = this.checkRateLimit(sessionId);

      if (!rateLimitStatus.allowed) {
        this.auditLogger.logRateLimit(command, false, {
          source,
          sessionId,
          remaining: rateLimitStatus.remaining,
          resetIn: rateLimitStatus.resetIn,
        });

        return {
          success: false,
          error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimitStatus.resetIn / 1000)} seconds.`,
        };
      }
    }

    // Validate command
    const validation = this.validateCommand(command);

    if (!validation.allowed) {
      // Log blocked command
      this.auditLogger.logCommandExecution(command, false, {
        reason: validation.reason,
        source,
        sessionId,
        riskLevel: validation.riskLevel,
        matchedPattern: validation.matchedPattern,
      });

      return {
        success: false,
        error: validation.reason,
      };
    }

    // Validate working directory if specified
    if (options.cwd) {
      const cwdValidation = this.validateWorkingDirectory(options.cwd);

      if (!cwdValidation.allowed) {
        this.auditLogger.logCommandExecution(command, false, {
          reason: cwdValidation.reason,
          source,
          sessionId,
          riskLevel: cwdValidation.riskLevel,
        });

        return {
          success: false,
          error: cwdValidation.reason,
        };
      }
    }

    // Log the execution attempt
    this.auditLogger.logCommandExecution(command, true, {
      reason: validation.reason,
      source,
      sessionId,
      riskLevel: validation.riskLevel,
    });

    // Get whitelist entry for timeout
    const { baseCommand } = this.parseCommand(command);
    const whitelistEntry = this.whitelist.get(baseCommand.toLowerCase());
    const timeout = options.timeout ?? whitelistEntry?.maxTimeout ?? 30000;

    try {
      // Execute the command
      const result = await this.executeCommand(command, {
        ...options,
        timeout,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error('Command execution error', { command, error: err.message });

      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Parse command into base command and arguments
   */
  private parseCommand(command: string): { baseCommand: string; args: string[] } {
    const trimmed = command.trim();

    // Handle quoted commands
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of trimmed) {
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuote && current) {
        parts.push(current);
        current = '';
      } else if (char !== ' ' || inQuote) {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    const baseCommand = parts[0] || '';
    const args = parts.slice(1);

    // Extract just the command name (not path)
    const commandName = path.basename(baseCommand);

    return {
      baseCommand: commandName,
      args,
    };
  }

  /**
   * Get risk level from confirmation level
   */
  private getConfirmationRiskLevel(
    confirmationLevel: WhitelistEntry['confirmationLevel']
  ): CommandValidationResult['riskLevel'] {
    switch (confirmationLevel) {
      case 'none':
        return 'safe';
      case 'low_risk':
        return 'low';
      case 'medium_risk':
        return 'medium';
      case 'high_risk':
      case 'always':
        return 'high';
      default:
        return 'medium';
    }
  }

  /**
   * Get the appropriate shell for the current platform
   */
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * Parse shell command into command and args
   */
  private parseShellCommand(command: string, shell?: string): { cmd: string; args: string[] } {
    const shellPath = shell || this.getDefaultShell();

    if (os.platform() === 'win32') {
      if (shellPath.includes('cmd')) {
        return { cmd: shellPath, args: ['/c', command] };
      }
      if (shellPath.includes('powershell')) {
        return { cmd: shellPath, args: ['-Command', command] };
      }
    }

    return { cmd: shellPath, args: ['-c', command] };
  }

  /**
   * Execute command (internal implementation)
   */
  private executeCommand(
    command: string,
    options: TerminalExecuteOptions
  ): Promise<{ success: boolean; data?: TerminalResult; error?: string }> {
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const timeout = options.timeout ?? 30000;
    const maxOutputSize = options.maxOutputSize ?? 1024 * 1024;

    const { cmd, args } = this.parseShellCommand(command, options.shell);

    const spawnOptions: SpawnOptions = {
      cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
    };

    return new Promise((resolve) => {
      const startTime = Date.now();
      const childProcess = spawn(cmd, args, spawnOptions);

      let stdout = '';
      let stderr = '';
      let killed = false;
      let stdoutTruncated = false;
      let stderrTruncated = false;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        childProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      // Collect stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        if (stdout.length + data.length <= maxOutputSize) {
          stdout += data.toString();
        } else if (!stdoutTruncated) {
          stdout += data.toString().slice(0, maxOutputSize - stdout.length);
          stdout += '\n... (output truncated)';
          stdoutTruncated = true;
        }
      });

      // Collect stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        if (stderr.length + data.length <= maxOutputSize) {
          stderr += data.toString();
        } else if (!stderrTruncated) {
          stderr += data.toString().slice(0, maxOutputSize - stderr.length);
          stderr += '\n... (output truncated)';
          stderrTruncated = true;
        }
      });

      // Handle completion
      childProcess.on('close', (exitCode) => {
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        const result: TerminalResult = {
          exitCode: exitCode ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command,
          cwd,
          duration,
          truncated: stdoutTruncated || stderrTruncated,
          timedOut: killed,
        };

        resolve({
          success: result.exitCode === 0,
          data: result,
          error:
            result.exitCode !== 0
              ? killed
                ? 'Command timed out'
                : `Command failed with exit code ${result.exitCode}`
              : undefined,
        });
      });

      // Handle spawn errors
      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;

        resolve({
          success: false,
          data: {
            exitCode: -1,
            stdout: '',
            stderr: error.message,
            command,
            cwd,
            duration,
          },
          error: `Failed to execute command: ${error.message}`,
        });
      });
    });
  }

  /**
   * Escape shell metacharacters in a string
   */
  escapeShellArg(arg: string): string {
    if (os.platform() === 'win32') {
      // Windows escaping
      return `"${arg.replace(/"/g, '""')}"`;
    }

    // Unix escaping - wrap in single quotes, escape existing single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Check if a string contains shell metacharacters
   */
  containsMetacharacters(str: string): boolean {
    return SHELL_METACHARACTERS.some((char) => str.includes(char));
  }

  /**
   * Get the current whitelist
   */
  getWhitelist(): WhitelistEntry[] {
    return Array.from(this.whitelist.values());
  }

  /**
   * Add a command to the whitelist
   */
  addToWhitelist(entry: WhitelistEntry): void {
    this.whitelist.set(entry.command.toLowerCase(), entry);
    logger.info('Command added to whitelist', { command: entry.command });
  }

  /**
   * Remove a command from the whitelist
   */
  removeFromWhitelist(command: string): boolean {
    const removed = this.whitelist.delete(command.toLowerCase());
    if (removed) {
      logger.info('Command removed from whitelist', { command });
    }
    return removed;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SafeTerminalExecutorConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.strictMode !== undefined) {
      this.strictMode = config.strictMode;
    }
    if (config.allowedWorkingDirs) {
      this.allowedWorkingDirs = config.allowedWorkingDirs;
    }
    logger.info('SafeTerminalExecutor config updated');
  }
}

// Singleton instance
let safeTerminalExecutorInstance: SafeTerminalExecutor | null = null;

/**
 * Get or create the singleton SafeTerminalExecutor instance
 */
export function getSafeTerminalExecutor(config?: SafeTerminalExecutorConfig): SafeTerminalExecutor {
  if (!safeTerminalExecutorInstance) {
    safeTerminalExecutorInstance = new SafeTerminalExecutor(config);
  }
  return safeTerminalExecutorInstance;
}

/**
 * Shutdown the safe terminal executor
 */
export function shutdownSafeTerminalExecutor(): void {
  safeTerminalExecutorInstance = null;
}

export default SafeTerminalExecutor;
