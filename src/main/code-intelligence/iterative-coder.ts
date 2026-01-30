/**
 * Atlas Desktop - Iterative Coder
 *
 * Enables Atlas to code iteratively: make change → validate → fix errors → repeat.
 * This gives Atlas the same tight feedback loop that makes IDE-based coding efficient.
 *
 * @module code-intelligence/iterative-coder
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getCodebaseIndexer } from './codebase-indexer';
import {
  CodeChange,
  ChangeResult,
  ValidationError,
  CodingSession,
} from './types';

const logger = createModuleLogger('IterativeCoder');

// =============================================================================
// Constants
// =============================================================================

const MAX_AUTO_FIX_ATTEMPTS = 3;

// =============================================================================
// Iterative Coder Class
// =============================================================================

/**
 * Enables iterative coding with validation feedback.
 *
 * @example
 * ```typescript
 * const coder = new IterativeCoder('/path/to/project');
 *
 * // Start a coding session
 * const session = coder.startSession('Add error handling to VoicePipeline');
 *
 * // Make a change
 * const result = await coder.applyChange({
 *   filePath: 'src/main/voice/voice-pipeline.ts',
 *   changeType: 'modify',
 *   oldContent: 'async start() {',
 *   newContent: 'async start() {\n    try {',
 *   description: 'Add try block',
 * });
 *
 * // Check for errors
 * if (result.validationErrors?.length) {
 *   // Atlas can see the errors and fix them
 * }
 *
 * // End session
 * coder.endSession(session.id);
 * ```
 */
export class IterativeCoder extends EventEmitter {
  private workspaceRoot: string;
  private sessions: Map<string, CodingSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Start a new coding session
   */
  startSession(task: string): CodingSession {
    const session: CodingSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      task,
      activeFiles: [],
      changes: [],
      validationState: {
        hasErrors: false,
        errorCount: 0,
        warningCount: 0,
        errors: [],
      },
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;

    logger.info('Started coding session', { id: session.id, task });
    this.emit('session-started', session);

    return session;
  }

  /**
   * Get the active session
   */
  getActiveSession(): CodingSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): CodingSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * End a coding session
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info('Ended coding session', {
      id: sessionId,
      changesCount: session.changes.length,
      duration: Date.now() - session.startedAt,
    });

    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    this.emit('session-ended', session);
  }

  // ===========================================================================
  // Code Changes
  // ===========================================================================

  /**
   * Apply a code change and validate
   */
  async applyChange(change: CodeChange): Promise<ChangeResult> {
    const session = this.getActiveSession();
    if (!session) {
      return {
        success: false,
        change,
        error: 'No active coding session',
      };
    }

    session.lastActivity = Date.now();

    try {
      // Apply the change
      await this.executeChange(change);

      // Update active files
      if (!session.activeFiles.includes(change.filePath)) {
        session.activeFiles.push(change.filePath);
      }

      // Validate
      const errors = await this.validate();

      const result: ChangeResult = {
        success: true,
        change,
        validationErrors: errors,
      };

      // Update session state
      session.changes.push(result);
      session.validationState = {
        hasErrors: errors.some((e) => e.severity === 'error'),
        errorCount: errors.filter((e) => e.severity === 'error').length,
        warningCount: errors.filter((e) => e.severity === 'warning').length,
        errors,
      };

      // Update the codebase index
      const indexer = getCodebaseIndexer();
      if (indexer.isReady()) {
        await indexer.updateFile(change.filePath);
      }

      this.emit('change-applied', result);
      return result;
    } catch (error) {
      const result: ChangeResult = {
        success: false,
        change,
        error: error instanceof Error ? error.message : String(error),
      };

      session.changes.push(result);
      this.emit('change-failed', result);
      return result;
    }
  }

  /**
   * Apply multiple changes atomically
   */
  async applyChanges(changes: CodeChange[]): Promise<ChangeResult[]> {
    const results: ChangeResult[] = [];

    for (const change of changes) {
      const result = await this.applyChange(change);
      results.push(result);

      // Stop if a change fails
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Attempt to auto-fix validation errors
   */
  async attemptAutoFix(maxAttempts = MAX_AUTO_FIX_ATTEMPTS): Promise<boolean> {
    const session = this.getActiveSession();
    if (!session || !session.validationState.hasErrors) {
      return true; // Nothing to fix
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const errors = session.validationState.errors.filter(
        (e) => e.severity === 'error' && e.suggestedFix
      );

      if (errors.length === 0) {
        return session.validationState.errorCount === 0;
      }

      logger.info(`Auto-fix attempt ${attempt + 1}/${maxAttempts}`, {
        errorsWithFixes: errors.length,
      });

      // Apply suggested fixes
      for (const error of errors) {
        if (error.suggestedFix) {
          const change: CodeChange = {
            filePath: error.filePath,
            changeType: 'modify',
            newContent: error.suggestedFix,
            description: `Auto-fix: ${error.message}`,
            lineRange: { start: error.line, end: error.line },
          };

          const result = await this.applyChange(change);
          result.autoFixAttempted = true;
        }
      }

      // Re-validate
      const newErrors = await this.validate();
      session.validationState = {
        hasErrors: newErrors.some((e) => e.severity === 'error'),
        errorCount: newErrors.filter((e) => e.severity === 'error').length,
        warningCount: newErrors.filter((e) => e.severity === 'warning').length,
        errors: newErrors,
      };

      if (!session.validationState.hasErrors) {
        return true;
      }
    }

    return false;
  }

  /**
   * Revert the last change
   */
  async revertLastChange(): Promise<boolean> {
    const session = this.getActiveSession();
    if (!session || session.changes.length === 0) {
      return false;
    }

    const lastChange = session.changes.pop();
    if (!lastChange?.success) {
      return false;
    }

    // For modify changes, swap old and new content
    if (lastChange.change.changeType === 'modify' && lastChange.change.oldContent) {
      await this.executeChange({
        ...lastChange.change,
        oldContent: lastChange.change.newContent,
        newContent: lastChange.change.oldContent,
        description: `Revert: ${lastChange.change.description}`,
      });

      // Re-validate
      const errors = await this.validate();
      session.validationState = {
        hasErrors: errors.some((e) => e.severity === 'error'),
        errorCount: errors.filter((e) => e.severity === 'error').length,
        warningCount: errors.filter((e) => e.severity === 'warning').length,
        errors,
      };

      this.emit('change-reverted', lastChange);
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Run TypeScript type checking
   */
  async validate(): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    try {
      // Run tsc --noEmit
      const result = await this.runCommand('npx', ['tsc', '--noEmit']);

      // Parse TypeScript errors
      const tsErrors = this.parseTypeScriptErrors(result.stderr + result.stdout);
      errors.push(...tsErrors);
    } catch (error) {
      logger.warn('Validation command failed', { error });
    }

    return errors;
  }

  /**
   * Run quick validation (just the active files)
   */
  async quickValidate(files: string[]): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (files.length === 0) {
      return errors;
    }

    try {
      // Run tsc on specific files
      const result = await this.runCommand('npx', [
        'tsc',
        '--noEmit',
        '--skipLibCheck',
        ...files,
      ]);

      const tsErrors = this.parseTypeScriptErrors(result.stderr + result.stdout);
      errors.push(...tsErrors);
    } catch (error) {
      logger.warn('Quick validation failed', { error });
    }

    return errors;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Execute a code change
   */
  private async executeChange(change: CodeChange): Promise<void> {
    const absolutePath = path.isAbsolute(change.filePath)
      ? change.filePath
      : path.join(this.workspaceRoot, change.filePath);

    switch (change.changeType) {
      case 'create':
        // Ensure directory exists
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, change.newContent || '');
        logger.info('Created file', { path: absolutePath });
        break;

      case 'modify':
        if (change.oldContent && change.newContent) {
          // Read current content
          const currentContent = await fs.readFile(absolutePath, 'utf-8');

          // Replace old with new
          if (!currentContent.includes(change.oldContent)) {
            throw new Error(`Could not find content to replace in ${change.filePath}`);
          }

          const newContent = currentContent.replace(
            change.oldContent,
            change.newContent
          );
          await fs.writeFile(absolutePath, newContent);
          logger.info('Modified file', { path: absolutePath });
        } else if (change.newContent) {
          // Full file replacement
          await fs.writeFile(absolutePath, change.newContent);
          logger.info('Replaced file content', { path: absolutePath });
        }
        break;

      case 'delete':
        await fs.unlink(absolutePath);
        logger.info('Deleted file', { path: absolutePath });
        break;

      case 'rename':
        if (change.newPath) {
          const newAbsolutePath = path.isAbsolute(change.newPath)
            ? change.newPath
            : path.join(this.workspaceRoot, change.newPath);
          await fs.rename(absolutePath, newAbsolutePath);
          logger.info('Renamed file', { from: absolutePath, to: newAbsolutePath });
        }
        break;
    }
  }

  /**
   * Run a command and capture output
   */
  private runCommand(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: this.workspaceRoot,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 });
      });

      proc.on('error', (error) => {
        stderr += error.message;
        resolve({ stdout, stderr, code: 1 });
      });
    });
  }

  /**
   * Parse TypeScript error output
   */
  private parseTypeScriptErrors(output: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Match TypeScript error format: path(line,col): error TS1234: message
    const errorRegex = /(.+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/g;
    let match;

    while ((match = errorRegex.exec(output)) !== null) {
      const [, filePath, line, column, severity, code, message] = match;
      errors.push({
        filePath: path.resolve(this.workspaceRoot, filePath.trim()),
        line: parseInt(line, 10),
        column: parseInt(column, 10),
        message: message.trim(),
        code,
        severity: severity === 'error' ? 'error' : 'warning',
        source: 'typescript',
      });
    }

    return errors;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let coderInstance: IterativeCoder | null = null;

/**
 * Get the iterative coder singleton
 */
export function getIterativeCoder(workspaceRoot?: string): IterativeCoder {
  if (!coderInstance && workspaceRoot) {
    coderInstance = new IterativeCoder(workspaceRoot);
  }
  if (!coderInstance) {
    throw new Error('IterativeCoder not initialized - provide workspaceRoot');
  }
  return coderInstance;
}

/**
 * Initialize the iterative coder
 */
export function initializeIterativeCoder(workspaceRoot: string): IterativeCoder {
  coderInstance = new IterativeCoder(workspaceRoot);
  return coderInstance;
}

/**
 * Reset the coder (for testing)
 */
export function resetIterativeCoder(): void {
  coderInstance = null;
}
