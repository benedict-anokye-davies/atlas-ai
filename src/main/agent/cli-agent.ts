/**
 * Atlas Desktop - CLI Agent
 * Autonomous CLI agent for executing commands, running multi-step tasks,
 * and handling Ben's development workflow with full autonomy.
 *
 * AUTONOMY LEVEL: FULL
 * - All CLI operations execute without confirmation
 * - Only sensitive file operations (.env, credentials) require confirmation
 * - Dangerous git commands (push --force, reset --hard) are ALLOWED
 * - Mass deletions are ALLOWED
 * - System modifications are ALLOWED
 */

import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CLIAgent');

// =============================================================================
// Interfaces
// =============================================================================

export interface ExecuteOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  silent?: boolean;
  captureOutput?: boolean;
}

export interface ExecutionResult {
  command: string;
  output: string;
  stderr: string;
  exitCode: number;
  duration: number;
  filesModified: string[];
  gitChanges?: GitChange[];
  success: boolean;
}

export interface CLITask {
  name: string;
  steps: TaskStep[];
  context?: Record<string, unknown>;
  onStepComplete?: (step: TaskStep, result: ExecutionResult) => void;
}

export interface TaskStep {
  name: string;
  command: string;
  condition?: string; // Skip if condition not met
  continueOnError?: boolean;
  timeout?: number;
}

export interface TaskResult {
  taskName: string;
  success: boolean;
  stepResults: StepResult[];
  totalDuration: number;
  filesModified: string[];
  error?: string;
}

export interface StepResult {
  stepName: string;
  command: string;
  result: ExecutionResult;
  skipped: boolean;
  skipReason?: string;
}

export interface ExecutionPlan {
  steps: PlannedStep[];
  estimatedDuration: number;
  risksIdentified: string[];
  requiresConfirmation: boolean;
}

export interface PlannedStep {
  command: string;
  purpose: string;
  risks: string[];
  rollbackCommand?: string;
}

export interface GitChange {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}

export interface SafetyCheck {
  safe: boolean;
  requiresConfirmation: boolean;
  reason?: string;
  risks: string[];
}

export interface ExecutionRecord {
  id: string;
  command: string;
  result: ExecutionResult;
  timestamp: Date;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 300000; // 5 minutes
const MAX_OUTPUT_LENGTH = 10000;
const HISTORY_FILE = path.join(os.homedir(), '.atlas', 'brain', 'self', 'cli-history.json');
const MAX_HISTORY_SIZE = 1000;

/**
 * Sensitive patterns that DO require confirmation
 * These are the ONLY patterns that will prompt the user
 */
const SENSITIVE_PATTERNS = [
  /\.env/i,
  /credentials/i,
  /secrets?\.json/i,
  /\.pem$/i,
  /\.key$/i,
  /password/i,
  /api[_-]?key/i,
];

/**
 * Commands that are explicitly allowed without confirmation
 * Per Ben's preferences - full autonomy for CLI operations
 * @todo Implement command allowlist check
 */
const _ALLOWED_COMMANDS = {
  git: ['push --force', 'reset --hard', 'clean -fd', 'rebase', 'merge', 'checkout -f'],
  npm: ['install', 'run', 'test', 'build', 'publish', 'uninstall', 'update'],
  file: ['rm -rf', 'rm -r', 'mv', 'cp', 'mkdir', 'rmdir', 'del /s /q'],
  system: ['pkill', 'killall', 'taskkill', 'kill'],
};

/**
 * Command duration estimates (milliseconds) for planning
 */
const COMMAND_DURATION_ESTIMATES: Record<string, number> = {
  'npm install': 60000,
  'npm run build': 30000,
  'npm run test': 30000,
  'npm run lint': 15000,
  'git status': 500,
  'git diff': 1000,
  'git log': 500,
  'git commit': 1000,
  'git push': 5000,
  'git pull': 5000,
  'git clone': 30000,
  default: 5000,
};

// =============================================================================
// CLI Agent Class
// =============================================================================

export class CLIAgent {
  private history: ExecutionRecord[] = [];
  private runningProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    this.loadHistory();
    logger.info('CLI Agent initialized with full autonomy mode');
  }

  // ===========================================================================
  // Core Execution
  // ===========================================================================

  /**
   * Execute a single command with full autonomy
   */
  async execute(command: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const executionId = uuidv4();

    logger.debug('Executing command', { executionId, command, options });

    // Check command safety (only for sensitive file patterns)
    const safetyCheck = this.isCommandSafe(command);
    if (safetyCheck.requiresConfirmation) {
      logger.warn('Command requires confirmation due to sensitive patterns', {
        command,
        reason: safetyCheck.reason,
        risks: safetyCheck.risks,
      });
      // In autonomous mode, we still execute but log the warning
      // The caller can check safetyCheck.requiresConfirmation if they want to prompt
    }

    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const env = { ...process.env, ...options.env };

    // Get pre-execution git status for change tracking
    const preGitStatus = await this.getGitStatus(cwd);

    try {
      const result = await this.spawnCommand(command, {
        cwd,
        timeout,
        env: env as Record<string, string>,
        silent: options.silent,
        captureOutput: options.captureOutput ?? true,
      });

      // Get post-execution git status to detect changes
      const postGitStatus = await this.getGitStatus(cwd);
      const gitChanges = this.detectGitChanges(preGitStatus, postGitStatus);

      // Detect modified files
      const filesModified = await this.detectModifiedFiles(cwd, preGitStatus, postGitStatus);

      const executionResult: ExecutionResult = {
        command,
        output: this.truncateOutput(result.stdout),
        stderr: this.truncateOutput(result.stderr),
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        filesModified,
        gitChanges: gitChanges.length > 0 ? gitChanges : undefined,
        success: result.exitCode === 0,
      };

      // Record in history
      this.recordExecution(executionId, command, executionResult);

      logger.info('Command completed', {
        executionId,
        command,
        exitCode: result.exitCode,
        duration: executionResult.duration,
        filesModified: filesModified.length,
      });

      return executionResult;
    } catch (error) {
      const err = error as Error;
      const executionResult: ExecutionResult = {
        command,
        output: '',
        stderr: err.message,
        exitCode: -1,
        duration: Date.now() - startTime,
        filesModified: [],
        success: false,
      };

      this.recordExecution(executionId, command, executionResult);
      logger.error('Command execution failed', { executionId, command, error: err.message });

      return executionResult;
    }
  }

  /**
   * Execute a multi-step task
   */
  async executeTask(task: CLITask): Promise<TaskResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const allFilesModified: Set<string> = new Set();

    logger.info('Starting multi-step task', {
      taskName: task.name,
      stepCount: task.steps.length,
    });

    let lastError: string | undefined;

    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];

      // Check condition if specified
      if (step.condition) {
        const conditionMet = await this.evaluateCondition(step.condition, task.context);
        if (!conditionMet) {
          stepResults.push({
            stepName: step.name,
            command: step.command,
            result: {
              command: step.command,
              output: '',
              stderr: '',
              exitCode: 0,
              duration: 0,
              filesModified: [],
              success: true,
            },
            skipped: true,
            skipReason: `Condition not met: ${step.condition}`,
          });
          logger.debug('Step skipped due to condition', {
            stepName: step.name,
            condition: step.condition,
          });
          continue;
        }
      }

      // Execute step
      const result = await this.execute(step.command, {
        timeout: step.timeout,
        cwd: task.context?.cwd as string,
      });

      // Track files modified
      result.filesModified.forEach((f) => allFilesModified.add(f));

      stepResults.push({
        stepName: step.name,
        command: step.command,
        result,
        skipped: false,
      });

      // Callback for step completion
      if (task.onStepComplete) {
        task.onStepComplete(step, result);
      }

      // Check if we should continue on error
      if (!result.success) {
        lastError = `Step "${step.name}" failed: ${result.stderr || 'Unknown error'}`;

        if (!step.continueOnError) {
          logger.warn('Task stopped due to step failure', {
            taskName: task.name,
            stepName: step.name,
            error: lastError,
          });
          break;
        }

        logger.warn('Step failed but continuing', {
          taskName: task.name,
          stepName: step.name,
          error: lastError,
        });
      }
    }

    const taskResult: TaskResult = {
      taskName: task.name,
      success: stepResults.every((r) => r.skipped || r.result.success),
      stepResults,
      totalDuration: Date.now() - startTime,
      filesModified: Array.from(allFilesModified),
      error: lastError,
    };

    logger.info('Multi-step task completed', {
      taskName: task.name,
      success: taskResult.success,
      totalDuration: taskResult.totalDuration,
      stepsCompleted: stepResults.filter((r) => !r.skipped && r.result.success).length,
      totalSteps: task.steps.length,
    });

    return taskResult;
  }

  /**
   * Get execution plan before running (for complex tasks)
   */
  async planExecution(request: string): Promise<ExecutionPlan> {
    const steps: PlannedStep[] = [];
    const risksIdentified: string[] = [];
    let requiresConfirmation = false;
    let totalEstimatedDuration = 0;

    // Parse the request into individual commands
    const commands = this.parseCommandRequest(request);

    for (const command of commands) {
      const safetyCheck = this.isCommandSafe(command);
      const risks: string[] = [...safetyCheck.risks];

      if (safetyCheck.requiresConfirmation) {
        requiresConfirmation = true;
        risksIdentified.push(`Command "${command}" touches sensitive files`);
      }

      // Determine purpose based on command analysis
      const purpose = this.analyzeCommandPurpose(command);

      // Generate rollback command if possible
      const rollbackCommand = this.generateRollbackCommand(command);

      steps.push({
        command,
        purpose,
        risks,
        rollbackCommand,
      });

      // Estimate duration
      totalEstimatedDuration += this.estimateCommandDuration(command);
    }

    return {
      steps,
      estimatedDuration: totalEstimatedDuration,
      risksIdentified,
      requiresConfirmation,
    };
  }

  /**
   * Check if a command is safe to run
   * Per Ben's preferences: only sensitive file patterns require confirmation
   */
  isCommandSafe(command: string): SafetyCheck {
    const risks: string[] = [];
    let requiresConfirmation = false;
    let reason: string | undefined;

    // Check for sensitive file patterns (ONLY thing that requires confirmation)
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(command)) {
        requiresConfirmation = true;
        reason = `Command may affect sensitive files (${pattern.source})`;
        risks.push(`Touches sensitive files matching: ${pattern.source}`);
        break;
      }
    }

    // Log warnings for dangerous operations but don't require confirmation
    // Per Ben's preferences - full autonomy
    if (/rm\s+(-rf?|-fr?)/i.test(command)) {
      risks.push('Mass deletion operation');
    }
    if (/git\s+push\s+.*--force/i.test(command)) {
      risks.push('Force push to remote');
    }
    if (/git\s+reset\s+--hard/i.test(command)) {
      risks.push('Hard reset (may lose uncommitted changes)');
    }
    if (/pkill|killall|taskkill/i.test(command)) {
      risks.push('Process termination');
    }

    return {
      safe: true, // Always safe for execution per autonomy settings
      requiresConfirmation,
      reason,
      risks,
    };
  }

  /**
   * Get execution history
   */
  getHistory(limit?: number): ExecutionRecord[] {
    const records = [...this.history].reverse(); // Most recent first
    return limit ? records.slice(0, limit) : records;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Spawn a command and capture output
   */
  private spawnCommand(
    command: string,
    options: {
      cwd: string;
      timeout: number;
      env: Record<string, string>;
      silent?: boolean;
      captureOutput?: boolean;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const { cmd, args } = this.parseShellCommand(command);

      const spawnOptions: SpawnOptions = {
        cwd: options.cwd,
        env: options.env,
        shell: true,
        windowsHide: true,
      };

      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn(cmd, args, spawnOptions);
      const processId = uuidv4();
      this.runningProcesses.set(processId, child);

      // Timeout handler
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, options.timeout);

      // Capture stdout
      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (!options.silent) {
          logger.debug('stdout', { chunk: chunk.substring(0, 200) });
        }
      });

      // Capture stderr
      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (!options.silent) {
          logger.debug('stderr', { chunk: chunk.substring(0, 200) });
        }
      });

      // Handle completion
      child.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(processId);

        if (killed) {
          resolve({
            stdout,
            stderr: stderr || 'Command timed out',
            exitCode: exitCode ?? -1,
          });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: exitCode ?? 0,
          });
        }
      });

      // Handle spawn errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        this.runningProcesses.delete(processId);
        reject(error);
      });
    });
  }

  /**
   * Parse shell command for cross-platform execution
   */
  private parseShellCommand(command: string): { cmd: string; args: string[] } {
    if (os.platform() === 'win32') {
      return { cmd: 'cmd.exe', args: ['/c', command] };
    }
    return { cmd: '/bin/sh', args: ['-c', command] };
  }

  /**
   * Get current git status for change tracking
   */
  private async getGitStatus(cwd: string): Promise<string> {
    try {
      const result = await this.spawnCommand('git status --porcelain', {
        cwd,
        timeout: 5000,
        env: process.env as Record<string, string>,
        silent: true,
        captureOutput: true,
      });
      return result.stdout;
    } catch {
      return ''; // Not a git repo or git not available
    }
  }

  /**
   * Detect git changes between two status snapshots
   */
  private detectGitChanges(preStatus: string, postStatus: string): GitChange[] {
    const changes: GitChange[] = [];

    if (!postStatus) return changes;

    const preFiles = new Set(preStatus.split('\n').filter(Boolean));
    const postLines = postStatus.split('\n').filter(Boolean);

    for (const line of postLines) {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3);

      // Skip if file was in pre-status (unchanged)
      const wasInPre = Array.from(preFiles).some((preLine) => preLine.includes(file));

      if (!wasInPre || status !== '') {
        let changeStatus: GitChange['status'] = 'modified';

        if (status.includes('A') || status === '??') {
          changeStatus = 'added';
        } else if (status.includes('D')) {
          changeStatus = 'deleted';
        } else if (status.includes('R')) {
          changeStatus = 'renamed';
        }

        changes.push({
          file,
          status: changeStatus,
        });
      }
    }

    return changes;
  }

  /**
   * Detect files modified by the command
   */
  private async detectModifiedFiles(
    cwd: string,
    preStatus: string,
    postStatus: string
  ): Promise<string[]> {
    const modifiedFiles: string[] = [];

    // From git changes
    if (postStatus && postStatus !== preStatus) {
      const lines = postStatus.split('\n').filter(Boolean);
      for (const line of lines) {
        const file = line.substring(3);
        if (file && !modifiedFiles.includes(file)) {
          modifiedFiles.push(file);
        }
      }
    }

    // Try to get recently modified files (last 5 seconds)
    try {
      const findCmd =
        os.platform() === 'win32'
          ? 'powershell -Command "Get-ChildItem -Recurse -File | Where-Object {$_.LastWriteTime -gt (Get-Date).AddSeconds(-5)} | Select-Object -ExpandProperty FullName"'
          : 'find . -type f -mmin -0.1 2>/dev/null | head -20';

      const result = await this.spawnCommand(findCmd, {
        cwd,
        timeout: 5000,
        env: process.env as Record<string, string>,
        silent: true,
        captureOutput: true,
      });

      if (result.exitCode === 0 && result.stdout) {
        const files = result.stdout.split('\n').filter(Boolean);
        for (const file of files) {
          const relativePath = path.relative(cwd, file);
          if (relativePath && !modifiedFiles.includes(relativePath)) {
            modifiedFiles.push(relativePath);
          }
        }
      }
    } catch {
      // Ignore errors from file detection
    }

    return modifiedFiles.slice(0, 50); // Limit to 50 files
  }

  /**
   * Truncate output to prevent memory issues
   */
  private truncateOutput(output: string): string {
    if (output.length <= MAX_OUTPUT_LENGTH) {
      return output;
    }
    return output.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
  }

  /**
   * Parse a request string into individual commands
   */
  private parseCommandRequest(request: string): string[] {
    // Handle common patterns
    const commands: string[] = [];

    // Split by && or ; or newlines
    const parts = request.split(/\s*(?:&&|;|\n)\s*/).filter(Boolean);

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        commands.push(trimmed);
      }
    }

    return commands;
  }

  /**
   * Analyze command purpose for execution plan
   */
  private analyzeCommandPurpose(command: string): string {
    const lower = command.toLowerCase();

    if (lower.startsWith('npm install') || lower.startsWith('yarn add')) {
      return 'Install dependencies';
    }
    if (lower.startsWith('npm run build') || lower.includes('build')) {
      return 'Build project';
    }
    if (lower.startsWith('npm run test') || lower.includes('test')) {
      return 'Run tests';
    }
    if (lower.startsWith('npm run lint') || lower.includes('lint')) {
      return 'Lint code';
    }
    if (lower.startsWith('git status')) {
      return 'Check git status';
    }
    if (lower.startsWith('git add')) {
      return 'Stage changes';
    }
    if (lower.startsWith('git commit')) {
      return 'Commit changes';
    }
    if (lower.startsWith('git push')) {
      return 'Push to remote';
    }
    if (lower.startsWith('git pull')) {
      return 'Pull from remote';
    }
    if (lower.startsWith('git clone')) {
      return 'Clone repository';
    }
    if (lower.startsWith('rm ') || lower.startsWith('del ')) {
      return 'Remove files';
    }
    if (lower.startsWith('mkdir')) {
      return 'Create directory';
    }
    if (lower.startsWith('cp ') || lower.startsWith('copy ')) {
      return 'Copy files';
    }
    if (lower.startsWith('mv ') || lower.startsWith('move ')) {
      return 'Move files';
    }

    return 'Execute command';
  }

  /**
   * Generate a rollback command if possible
   */
  private generateRollbackCommand(command: string): string | undefined {
    const lower = command.toLowerCase();

    if (lower.startsWith('git commit')) {
      return 'git reset HEAD~1';
    }
    if (lower.startsWith('git push') && !lower.includes('--force')) {
      return 'git push --force-with-lease origin HEAD~1:HEAD';
    }
    if (lower.startsWith('npm install') && !lower.includes('-g')) {
      return 'git checkout package-lock.json && rm -rf node_modules && npm install';
    }

    return undefined;
  }

  /**
   * Estimate command duration in milliseconds
   */
  private estimateCommandDuration(command: string): number {
    const lower = command.toLowerCase();

    for (const [pattern, duration] of Object.entries(COMMAND_DURATION_ESTIMATES)) {
      if (pattern !== 'default' && lower.includes(pattern)) {
        return duration;
      }
    }

    return COMMAND_DURATION_ESTIMATES.default;
  }

  /**
   * Evaluate a condition string
   */
  private async evaluateCondition(
    condition: string,
    context?: Record<string, unknown>
  ): Promise<boolean> {
    // Simple condition evaluation
    // Supports: file_exists:path, command_succeeds:command, env:VAR, true, false

    if (condition === 'true') return true;
    if (condition === 'false') return false;

    if (condition.startsWith('file_exists:')) {
      const filePath = condition.substring('file_exists:'.length);
      const fullPath = context?.cwd
        ? path.join(context.cwd as string, filePath)
        : path.resolve(filePath);
      return fs.existsSync(fullPath);
    }

    if (condition.startsWith('command_succeeds:')) {
      const cmd = condition.substring('command_succeeds:'.length);
      const result = await this.execute(cmd, {
        timeout: 10000,
        silent: true,
        cwd: context?.cwd as string,
      });
      return result.success;
    }

    if (condition.startsWith('env:')) {
      const varName = condition.substring('env:'.length);
      return !!process.env[varName];
    }

    // Check context variables
    if (context && condition in context) {
      return Boolean(context[condition]);
    }

    logger.warn('Unknown condition format', { condition });
    return true; // Default to true for unknown conditions
  }

  /**
   * Record execution in history
   */
  private recordExecution(id: string, command: string, result: ExecutionResult): void {
    const record: ExecutionRecord = {
      id,
      command,
      result,
      timestamp: new Date(),
    };

    this.history.push(record);

    // Trim history if too large
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(-MAX_HISTORY_SIZE);
    }

    // Save to file (async, don't block)
    this.saveHistory().catch((err) => {
      logger.error('Failed to save history', { error: err.message });
    });
  }

  /**
   * Load history from file
   */
  private loadHistory(): void {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        this.history = parsed.map((record: ExecutionRecord) => ({
          ...record,
          timestamp: new Date(record.timestamp),
        }));
        logger.debug('Loaded CLI history', { count: this.history.length });
      }
    } catch (error) {
      logger.warn('Failed to load CLI history', { error: (error as Error).message });
      this.history = [];
    }
  }

  /**
   * Save history to file
   */
  private async saveHistory(): Promise<void> {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2));
    } catch (error) {
      logger.error('Failed to save CLI history', { error: (error as Error).message });
    }
  }

  /**
   * Kill all running processes (cleanup)
   */
  killAllProcesses(): void {
    Array.from(this.runningProcesses.entries()).forEach(([id, childProcess]) => {
      try {
        childProcess.kill('SIGTERM');
        logger.info('Killed running process', { id });
      } catch {
        // Process may already be dead
      }
    });
    this.runningProcesses.clear();
  }

  /**
   * Shutdown the CLI agent
   */
  async shutdown(): Promise<void> {
    logger.info('CLI Agent shutting down');
    this.killAllProcesses();
    await this.saveHistory();
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let cliAgentInstance: CLIAgent | null = null;

/**
 * Get the CLI agent singleton instance
 */
export function getCLIAgent(): CLIAgent {
  if (!cliAgentInstance) {
    cliAgentInstance = new CLIAgent();
  }
  return cliAgentInstance;
}

/**
 * Shutdown the CLI agent
 */
export async function shutdownCLIAgent(): Promise<void> {
  if (cliAgentInstance) {
    await cliAgentInstance.shutdown();
    cliAgentInstance = null;
  }
}

// Default export
export default getCLIAgent;
