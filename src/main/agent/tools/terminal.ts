/**
 * Atlas Desktop - Terminal Tool
 * Provides safe command execution for the agent
 *
 * SECURITY: This module integrates with SafeTerminalExecutor for:
 * - Command whitelisting
 * - Dangerous pattern blocking
 * - Rate limiting
 * - Audit logging
 *
 * UPDATED: Now includes node-pty support for real PTY terminal emulation
 */

import { spawn, SpawnOptions } from 'child_process';
import * as pty from 'node-pty';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import {
  TerminalExecuteOptions,
  TerminalResult,
  SafetyValidation,
  BLOCKED_COMMANDS,
  SAFE_COMMANDS,
} from '../../../shared/types/agent';
import { getSafeTerminalExecutor } from '../../security/safe-terminal-executor';
import { getInputValidator } from '../../security/input-validator';

const logger = createModuleLogger('TerminalTool');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
const MAX_TIMEOUT = 300000; // 5 minutes max

// Security mode flag - when true, uses SafeTerminalExecutor
let securityEnabled = true;

/**
 * Enable or disable security hardening
 */
export function setSecurityEnabled(enabled: boolean): void {
  securityEnabled = enabled;
  logger.info('Terminal security mode changed', { enabled });
}

/**
 * Check if security hardening is enabled
 */
export function isSecurityEnabled(): boolean {
  return securityEnabled;
}

/**
 * Get the appropriate shell for the current platform
 */
function getDefaultShell(): string {
  if (os.platform() === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Validate command safety
 */
function validateCommandSafety(command: string): SafetyValidation {
  const normalizedCommand = command.toLowerCase().trim();

  // Check against blocked patterns (exact substring match)
  for (const blocked of BLOCKED_COMMANDS) {
    if (normalizedCommand.includes(blocked.toLowerCase())) {
      return {
        allowed: false,
        reason: `Blocked command pattern detected: ${blocked}`,
        riskLevel: 'blocked',
        requiresConfirmation: false,
      };
    }
  }

  // Additional dangerous patterns using regex (for more complex matching)
  const dangerousPatterns = [
    { pattern: /curl\s+.*\|\s*(sh|bash)/i, reason: 'Piping curl to shell' },
    { pattern: /wget\s+.*\|\s*(sh|bash)/i, reason: 'Piping wget to shell' },
    { pattern: /(curl|wget)\s+[^|]+\|\s*sudo/i, reason: 'Piping download to sudo' },
  ];

  for (const { pattern, reason } of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: `Blocked: ${reason}`,
        riskLevel: 'blocked',
        requiresConfirmation: false,
      };
    }
  }

  // Extract the base command (first word)
  const baseCommand = normalizedCommand.split(/\s+/)[0];

  // Check if it's a known safe command
  const isSafeCommand = SAFE_COMMANDS.some(
    (safe) =>
      baseCommand === safe || baseCommand.endsWith(`/${safe}`) || baseCommand.endsWith(`\\${safe}`)
  );

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  let requiresConfirmation = false;

  if (isSafeCommand) {
    riskLevel = 'low';
    requiresConfirmation = false;
  }

  // High-risk patterns (even if base command is safe)
  const highRiskPatterns = [
    /rm\s+(-rf?|-fr?)/i,
    /del\s+\/[sfq]/i,
    /format\s/i,
    /mkfs/i,
    /dd\s+if=/i,
    />\s*\/dev\//i,
    /sudo\s/i,
    /chmod\s+[0-7]{3,4}\s/i,
    /chown\s/i,
    /npm\s+publish/i,
    /git\s+push\s+.*--force/i,
    /git\s+reset\s+--hard/i,
  ];

  for (const pattern of highRiskPatterns) {
    if (pattern.test(command)) {
      riskLevel = 'high';
      requiresConfirmation = true;
      break;
    }
  }

  // Medium-risk: commands that modify system state
  const mediumRiskPatterns = [
    /npm\s+(install|uninstall|update)/i,
    /yarn\s+(add|remove)/i,
    /pip\s+install/i,
    /git\s+(commit|merge|rebase)/i,
    /mv\s/i,
    /cp\s.*-r/i,
  ];

  if (riskLevel !== 'high') {
    for (const pattern of mediumRiskPatterns) {
      if (pattern.test(command)) {
        riskLevel = 'medium';
        break;
      }
    }
  }

  return {
    allowed: true,
    riskLevel,
    requiresConfirmation,
  };
}

/**
 * Parse shell command into command and args based on platform
 */
function parseShellCommand(command: string, shell?: string): { cmd: string; args: string[] } {
  const shellPath = shell || getDefaultShell();

  if (os.platform() === 'win32') {
    // Windows: use /c flag for cmd.exe
    if (shellPath.includes('cmd')) {
      return { cmd: shellPath, args: ['/c', command] };
    }
    // PowerShell
    if (shellPath.includes('powershell')) {
      return { cmd: shellPath, args: ['-Command', command] };
    }
  }

  // Unix-like: use -c flag
  return { cmd: shellPath, args: ['-c', command] };
}

/**
 * Execute terminal command tool
 */
export const executeCommandTool: AgentTool = {
  name: 'execute_command',
  description:
    'Execute a shell command and return the output. Use for running scripts, git commands, npm, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution (default: current directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000, max: 300000)',
      },
      env: {
        type: 'object',
        description: 'Additional environment variables',
      },
    },
    required: ['command'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const command = params.command as string;
    const options: TerminalExecuteOptions = {
      cwd: params.cwd as string | undefined,
      timeout: Math.min((params.timeout as number) || DEFAULT_TIMEOUT, MAX_TIMEOUT),
      env: params.env as Record<string, string> | undefined,
    };

    return executeCommand(command, options);
  },
};

/**
 * Core command execution function
 * Uses SafeTerminalExecutor when security is enabled
 */
export async function executeCommand(
  command: string,
  options: TerminalExecuteOptions & { sessionId?: string; source?: string } = {}
): Promise<ActionResult> {
  // Use SafeTerminalExecutor when security is enabled
  if (securityEnabled) {
    const executor = getSafeTerminalExecutor();

    // Validate input first
    const inputValidator = getInputValidator();
    const inputValidation = inputValidator.validateCommandString(command, {
      sessionId: options.sessionId,
    });

    if (!inputValidation.safe) {
      logger.warn('Command input validation failed', {
        command,
        threats: inputValidation.threats.map((t) => t.type),
      });
      return {
        success: false,
        error: `Command blocked: ${inputValidation.threats.map((t) => t.description).join('; ')}`,
      };
    }

    // Execute via SafeTerminalExecutor
    const result = await executor.execute(inputValidation.sanitized, {
      cwd: options.cwd,
      timeout: Math.min(options.timeout || DEFAULT_TIMEOUT, MAX_TIMEOUT),
      env: options.env,
      sessionId: options.sessionId,
      source: options.source ?? 'terminal_tool',
    });

    return result;
  }

  // Fallback to legacy execution (for backwards compatibility)
  return executeCommandLegacy(command, options);
}

/**
 * Legacy command execution (pre-security hardening)
 * @deprecated Use executeCommand with security enabled instead
 */
async function executeCommandLegacy(
  command: string,
  options: TerminalExecuteOptions = {}
): Promise<ActionResult> {
  const startTime = Date.now();

  try {
    // Safety validation
    const safety = validateCommandSafety(command);
    if (!safety.allowed) {
      logger.warn('Command blocked', { command, reason: safety.reason });
      return {
        success: false,
        error: safety.reason || 'Command blocked for security reasons',
      };
    }

    // Resolve working directory
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const maxOutputSize = options.maxOutputSize || MAX_OUTPUT_SIZE;

    // Parse command for shell execution
    const { cmd, args } = parseShellCommand(command, options.shell);

    logger.debug('Executing command', { command, cwd, timeout });

    // Build spawn options
    const spawnOptions: SpawnOptions = {
      cwd,
      env: { ...process.env, ...options.env },
      shell: false, // We're already using shell via parseShellCommand
      windowsHide: true, // Hide console window on Windows
    };

    return new Promise<ActionResult>((resolve) => {
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
        // Force kill after 5 seconds if SIGTERM doesn't work
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

        logger.debug('Command completed', {
          command,
          exitCode: result.exitCode,
          duration,
          timedOut: killed,
        });

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
        logger.error('Command spawn error', { command, error: error.message });

        resolve({
          success: false,
          data: {
            exitCode: -1,
            stdout: '',
            stderr: error.message,
            command,
            cwd,
            duration,
          } as TerminalResult,
          error: `Failed to execute command: ${error.message}`,
        });
      });
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Command execution error', { command, error: err.message });
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Run npm command tool - convenience wrapper
 */
export const npmCommandTool: AgentTool = {
  name: 'npm_command',
  description: 'Run an npm command (install, run, test, etc.)',
  parameters: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        description: 'npm subcommand (e.g., "install", "run test", "run build")',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: current directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000 for npm)',
      },
    },
    required: ['subcommand'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const subcommand = params.subcommand as string;
    const cwd = params.cwd as string | undefined;
    const timeout = (params.timeout as number) || 120000; // 2 minutes default for npm

    const command = `npm ${subcommand}`;
    return executeCommand(command, { cwd, timeout });
  },
};

/**
 * Run git command tool - convenience wrapper
 */
export const gitCommandTool: AgentTool = {
  name: 'git_command',
  description: 'Run a git command (status, log, diff, commit, etc.)',
  parameters: {
    type: 'object',
    properties: {
      subcommand: {
        type: 'string',
        description: 'git subcommand (e.g., "status", "log --oneline -10", "diff")',
      },
      cwd: {
        type: 'string',
        description: 'Repository directory (default: current directory)',
      },
    },
    required: ['subcommand'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const subcommand = params.subcommand as string;
    const cwd = params.cwd as string | undefined;

    // Block dangerous git commands
    const dangerousPatterns = [/push\s+.*--force/i, /reset\s+--hard/i, /clean\s+-f/i];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(subcommand)) {
        return {
          success: false,
          error: `Dangerous git command blocked: ${subcommand}`,
        };
      }
    }

    const command = `git ${subcommand}`;
    return executeCommand(command, { cwd, timeout: 60000 });
  },
};

/**
 * Get working directory info tool
 */
export const pwdTool: AgentTool = {
  name: 'get_working_directory',
  description: 'Get the current working directory',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (): Promise<ActionResult> => {
    try {
      const cwd = process.cwd();
      return {
        success: true,
        data: {
          path: cwd,
          basename: path.basename(cwd),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
};

/**
 * Check if command exists tool
 */
export const whichCommandTool: AgentTool = {
  name: 'which_command',
  description: 'Check if a command exists and get its path',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command name to check (e.g., "node", "python", "git")',
      },
    },
    required: ['command'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const commandName = params.command as string;

    // Use 'where' on Windows, 'which' on Unix
    const whichCmd = os.platform() === 'win32' ? 'where' : 'which';
    const result = await executeCommand(`${whichCmd} ${commandName}`, { timeout: 5000 });

    if (result.success && result.data) {
      const data = result.data as TerminalResult;
      return {
        success: true,
        data: {
          command: commandName,
          exists: true,
          path: data.stdout.split('\n')[0].trim(),
        },
      };
    }

    return {
      success: true,
      data: {
        command: commandName,
        exists: false,
      },
    };
  },
};

/**
 * Get all terminal tools
 */
export function getTerminalTools(): AgentTool[] {
  return [executeCommandTool, npmCommandTool, gitCommandTool, pwdTool, whichCommandTool];
}

// ==============================================================================
// TERMINAL TOOL CLASS (PTY-based)
// Uses node-pty for real terminal emulation - ideal for interactive processes
// ==============================================================================

/**
 * Input interface for TerminalTool PTY execution
 */
export interface TerminalToolInput {
  command: string;
  workingDirectory?: string;
  timeout?: number; // ms, default 30000
  shell?: 'powershell' | 'cmd' | 'bash';
}

/**
 * Output interface for TerminalTool PTY execution
 */
export interface TerminalToolOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number; // ms
}

/**
 * TerminalTool class using node-pty for real PTY terminal emulation.
 *
 * This class provides true terminal emulation suitable for:
 * - Interactive processes that need TTY
 * - Commands with ANSI escape sequences
 * - Real-time streaming output
 * - Full xterm compatibility
 */
export class TerminalTool {
  private shell: string;
  private shellArgs: string[];
  private readonly logger = createModuleLogger('TerminalToolPTY');

  constructor() {
    if (os.platform() === 'win32') {
      this.shell = 'powershell.exe';
      this.shellArgs = ['-NoProfile', '-NonInteractive'];
    } else {
      this.shell = process.env.SHELL || '/bin/bash';
      this.shellArgs = [];
    }
  }

  /**
   * Execute a command using PTY (pseudo-terminal)
   * @param input Command input with options
   * @returns Execution result with stdout, stderr, exit code
   */
  async execute(input: TerminalToolInput): Promise<TerminalToolOutput> {
    const startTime = Date.now();
    const timeout = input.timeout || DEFAULT_TIMEOUT;

    // Validate command safety first
    const safety = validateCommandSafety(input.command);
    if (!safety.allowed) {
      this.logger.warn('PTY command blocked', { command: input.command, reason: safety.reason });
      return {
        success: false,
        stdout: '',
        stderr: safety.reason || 'Command blocked for security reasons',
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      let output = '';
      let resolved = false;

      // Determine shell based on input or default
      let shellPath = this.shell;
      let shellArguments = [...this.shellArgs];

      if (input.shell) {
        if (input.shell === 'powershell') {
          shellPath = 'powershell.exe';
          shellArguments = ['-NoProfile', '-NonInteractive'];
        } else if (input.shell === 'cmd') {
          shellPath = 'cmd.exe';
          shellArguments = [];
        } else if (input.shell === 'bash') {
          shellPath = '/bin/bash';
          shellArguments = [];
        }
      }

      try {
        const term = pty.spawn(shellPath, shellArguments, {
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          cwd: input.workingDirectory || os.homedir(),
          env: process.env as Record<string, string>,
        });

        // Timeout handler
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            term.kill();
            this.logger.warn('PTY command timed out', { command: input.command, timeout });
            resolve({
              success: false,
              stdout: this.cleanOutput(output),
              stderr: 'Command timed out',
              exitCode: -1,
              duration: Date.now() - startTime,
            });
          }
        }, timeout);

        // Collect output
        term.onData((data) => {
          output += data;
        });

        // Handle process exit
        term.onExit(({ exitCode }) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);

            const duration = Date.now() - startTime;
            this.logger.debug('PTY command completed', {
              command: input.command,
              exitCode,
              duration,
            });

            resolve({
              success: exitCode === 0,
              stdout: this.cleanOutput(output),
              stderr: '',
              exitCode,
              duration,
            });
          }
        });

        // Write command and exit
        term.write(`${input.command}\r`);
        term.write('exit\r');
      } catch (error) {
        if (!resolved) {
          resolved = true;
          const err = error as Error;
          this.logger.error('PTY spawn error', { command: input.command, error: err.message });
          resolve({
            success: false,
            stdout: '',
            stderr: err.message,
            exitCode: -1,
            duration: Date.now() - startTime,
          });
        }
      }
    });
  }

  /**
   * Execute a command with streaming output callback
   * @param input Command input with options
   * @param onOutput Callback called with each chunk of output
   * @returns Execution result
   */
  async executeStreaming(
    input: TerminalToolInput,
    onOutput: (data: string) => void
  ): Promise<TerminalToolOutput> {
    const startTime = Date.now();
    const timeout = input.timeout || DEFAULT_TIMEOUT;
    let fullOutput = '';
    let resolved = false;

    // Validate command safety first
    const safety = validateCommandSafety(input.command);
    if (!safety.allowed) {
      this.logger.warn('PTY streaming command blocked', {
        command: input.command,
        reason: safety.reason,
      });
      return {
        success: false,
        stdout: '',
        stderr: safety.reason || 'Command blocked for security reasons',
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      try {
        const term = pty.spawn(this.shell, this.shellArgs, {
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          cwd: input.workingDirectory || os.homedir(),
          env: process.env as Record<string, string>,
        });

        // Timeout handler
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            term.kill();
            resolve({
              success: false,
              stdout: this.cleanOutput(fullOutput),
              stderr: 'Command timed out',
              exitCode: -1,
              duration: Date.now() - startTime,
            });
          }
        }, timeout);

        // Stream output to callback and collect
        term.onData((data) => {
          fullOutput += data;
          onOutput(data);
        });

        term.onExit(({ exitCode }) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve({
              success: exitCode === 0,
              stdout: this.cleanOutput(fullOutput),
              stderr: '',
              exitCode,
              duration: Date.now() - startTime,
            });
          }
        });

        term.write(`${input.command}\r`);
        term.write('exit\r');
      } catch (error) {
        if (!resolved) {
          resolved = true;
          const err = error as Error;
          resolve({
            success: false,
            stdout: '',
            stderr: err.message,
            exitCode: -1,
            duration: Date.now() - startTime,
          });
        }
      }
    });
  }

  /**
   * Clean output by removing ANSI escape codes
   */
  private cleanOutput(output: string): string {
    // Remove ANSI escape codes (colors, cursor movement, etc.)
    // eslint-disable-next-line no-control-regex
    return output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
  }
}

// Singleton instance for convenience
export const terminalTool = new TerminalTool();

export default {
  executeCommandTool,
  npmCommandTool,
  gitCommandTool,
  pwdTool,
  whichCommandTool,
  getTerminalTools,
  executeCommand,
  validateCommandSafety,
  setSecurityEnabled,
  isSecurityEnabled,
  TerminalTool,
  terminalTool,
};
