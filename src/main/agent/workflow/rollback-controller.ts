/**
 * Rollback Controller
 * 
 * Manages checkpoints and rollback operations for workflow recovery.
 * Supports file snapshots, git state restoration, and database rollback.
 * 
 * @module agent/workflow/rollback-controller
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { executeCommand } from '../../utils/shell';
import {
  Checkpoint,
  FileSnapshot,
  GitState,
  WorkflowContext,
  WorkflowStep,
  RollbackAction,
  CodeChange,
} from './types';

const logger = createModuleLogger('RollbackController');

// ============================================================================
// Rollback Controller Class
// ============================================================================

export class RollbackController extends EventEmitter {
  private checkpointsDir: string;
  private maxSnapshots = 50; // Per workflow

  constructor() {
    super();
    this.checkpointsDir = path.join(app.getPath('userData'), 'workflow-checkpoints');
    this.ensureDir(this.checkpointsDir);
  }

  /**
   * Create a checkpoint from current context
   */
  async createCheckpoint(
    workflowId: string,
    stepId: string,
    context: WorkflowContext
  ): Promise<Checkpoint> {
    const checkpointId = `cp_${Date.now()}_${stepId}`;
    logger.info(`Creating checkpoint: ${checkpointId}`);

    try {
      // Snapshot files that have been modified
      const fileSnapshots = await this.snapshotFiles(
        context.codeChanges.map(c => c.file),
        context.workingDirectory
      );

      // Capture git state if in a git repo
      const gitState = await this.captureGitState(context.workingDirectory);

      const checkpoint: Checkpoint = {
        id: checkpointId,
        stepId,
        timestamp: Date.now(),
        context: this.cloneContext(context),
        fileSnapshots,
        gitState,
      };

      // Save checkpoint to disk
      await this.saveCheckpoint(workflowId, checkpoint);

      this.emit('checkpoint:created', { workflowId, checkpoint });
      logger.info(`Checkpoint created: ${checkpointId} with ${fileSnapshots.length} file snapshots`);

      return checkpoint;

    } catch (error) {
      logger.error(`Failed to create checkpoint: ${error}`);
      throw error;
    }
  }

  /**
   * Rollback to a specific checkpoint
   */
  async rollbackToCheckpoint(
    workflowId: string,
    checkpoint: Checkpoint,
    currentContext: WorkflowContext
  ): Promise<void> {
    logger.info(`Rolling back to checkpoint: ${checkpoint.id}`);
    this.emit('rollback:started', { workflowId, checkpointId: checkpoint.id });

    try {
      // Restore files
      await this.restoreFiles(checkpoint.fileSnapshots, currentContext.workingDirectory);

      // Restore git state if applicable
      if (checkpoint.gitState) {
        await this.restoreGitState(checkpoint.gitState, currentContext.workingDirectory);
      }

      // Clear code changes after checkpoint
      const checkpointIndex = currentContext.codeChanges.findIndex(
        c => c.timestamp >= checkpoint.timestamp
      );
      if (checkpointIndex >= 0) {
        currentContext.codeChanges.splice(checkpointIndex);
      }

      this.emit('rollback:completed', { workflowId, checkpointId: checkpoint.id });
      logger.info(`Rollback completed to checkpoint: ${checkpoint.id}`);

    } catch (error) {
      logger.error(`Rollback failed: ${error}`);
      this.emit('rollback:failed', { workflowId, checkpointId: checkpoint.id, error });
      throw error;
    }
  }

  /**
   * Execute a rollback action for a specific step
   */
  async executeRollbackAction(
    action: RollbackAction,
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<void> {
    logger.info(`Executing rollback action for step: ${step.id}`);

    try {
      switch (action.type) {
        case 'tool':
          if (action.tool) {
            const { getToolRegistry } = await import('../tool-registry');
            const registry = getToolRegistry();
            const tool = registry.getTool(action.tool.name);
            
            if (tool) {
              await tool.execute(action.tool.parameters, {
                workingDirectory: context.workingDirectory,
              });
              logger.info(`Rollback tool executed: ${action.tool.name}`);
            }
          }
          break;

        case 'custom':
          if (action.customHandler) {
            await this.executeCustomRollback(action.customHandler, step, context);
          }
          break;

        default:
          logger.warn(`Unknown rollback action type: ${action.type}`);
      }

    } catch (error) {
      logger.error(`Rollback action failed for step ${step.id}:`, error);
      throw error;
    }
  }

  /**
   * Rollback code changes made during the workflow
   */
  async rollbackCodeChanges(
    changes: CodeChange[],
    workingDirectory: string
  ): Promise<void> {
    // Process changes in reverse order
    const reversedChanges = [...changes].reverse();

    for (const change of reversedChanges) {
      const filePath = path.isAbsolute(change.file) 
        ? change.file 
        : path.join(workingDirectory, change.file);

      try {
        switch (change.type) {
          case 'create':
            // Delete the created file
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              logger.debug(`Deleted created file: ${change.file}`);
            }
            break;

          case 'delete':
            // Restore would need original content - skip if not available
            logger.warn(`Cannot restore deleted file without backup: ${change.file}`);
            break;

          case 'modify':
            // Restore would need original content
            logger.warn(`Cannot restore modified file without backup: ${change.file}`);
            break;

          case 'rename':
            // Rename back
            if (change.originalPath) {
              const originalFullPath = path.isAbsolute(change.originalPath)
                ? change.originalPath
                : path.join(workingDirectory, change.originalPath);
              
              if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, originalFullPath);
                logger.debug(`Renamed back: ${change.file} -> ${change.originalPath}`);
              }
            }
            break;
        }
      } catch (error) {
        logger.error(`Failed to rollback change for ${change.file}:`, error);
      }
    }
  }

  /**
   * Git-based rollback (revert commits)
   */
  async gitRollback(
    workingDirectory: string,
    commitHash: string,
    message?: string
  ): Promise<void> {
    logger.info(`Git rollback to commit: ${commitHash}`);

    try {
      // Check if we're in a git repo
      const { stdout: gitRoot } = await executeCommand('git rev-parse --show-toplevel', {
        cwd: workingDirectory,
      });
      
      if (!gitRoot) {
        throw new Error('Not in a git repository');
      }

      // Create a revert commit
      const revertMessage = message || `Revert to ${commitHash.substring(0, 8)}`;
      await executeCommand(`git revert --no-commit ${commitHash}..HEAD`, {
        cwd: workingDirectory,
      });
      
      await executeCommand(`git commit -m "${revertMessage}"`, {
        cwd: workingDirectory,
      });

      logger.info(`Git rollback completed`);

    } catch (error) {
      logger.error(`Git rollback failed:`, error);
      throw error;
    }
  }

  /**
   * Get list of checkpoints for a workflow
   */
  async getCheckpoints(workflowId: string): Promise<Checkpoint[]> {
    const workflowDir = path.join(this.checkpointsDir, workflowId);
    
    if (!fs.existsSync(workflowDir)) {
      return [];
    }

    const files = fs.readdirSync(workflowDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Newest first

    const checkpoints: Checkpoint[] = [];
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(workflowDir, file), 'utf-8');
        checkpoints.push(JSON.parse(content));
      } catch (error) {
        logger.warn(`Failed to load checkpoint ${file}:`, error);
      }
    }

    return checkpoints;
  }

  /**
   * Clean up old checkpoints
   */
  async cleanupCheckpoints(workflowId: string, keepCount = 5): Promise<void> {
    const checkpoints = await this.getCheckpoints(workflowId);
    
    if (checkpoints.length <= keepCount) {
      return;
    }

    const toDelete = checkpoints.slice(keepCount);
    const workflowDir = path.join(this.checkpointsDir, workflowId);

    for (const checkpoint of toDelete) {
      const filePath = path.join(workflowDir, `${checkpoint.id}.json`);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.debug(`Deleted old checkpoint: ${checkpoint.id}`);
        }
      } catch (error) {
        logger.warn(`Failed to delete checkpoint ${checkpoint.id}:`, error);
      }
    }
  }

  /**
   * Delete all checkpoints for a workflow
   */
  async deleteWorkflowCheckpoints(workflowId: string): Promise<void> {
    const workflowDir = path.join(this.checkpointsDir, workflowId);
    
    if (fs.existsSync(workflowDir)) {
      fs.rmSync(workflowDir, { recursive: true, force: true });
      logger.info(`Deleted all checkpoints for workflow: ${workflowId}`);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Snapshot files to checkpoint
   */
  private async snapshotFiles(
    filePaths: string[],
    workingDirectory: string
  ): Promise<FileSnapshot[]> {
    const snapshots: FileSnapshot[] = [];
    const seen = new Set<string>();

    for (const filePath of filePaths) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workingDirectory, filePath);

      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      try {
        const exists = fs.existsSync(fullPath);
        const content = exists ? fs.readFileSync(fullPath, 'utf-8') : '';

        snapshots.push({
          path: filePath,
          content,
          exists,
        });
      } catch (error) {
        logger.warn(`Failed to snapshot file ${filePath}:`, error);
      }
    }

    return snapshots;
  }

  /**
   * Restore files from snapshots
   */
  private async restoreFiles(
    snapshots: FileSnapshot[],
    workingDirectory: string
  ): Promise<void> {
    for (const snapshot of snapshots) {
      const fullPath = path.isAbsolute(snapshot.path)
        ? snapshot.path
        : path.join(workingDirectory, snapshot.path);

      try {
        if (snapshot.exists) {
          // Ensure directory exists
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, snapshot.content, 'utf-8');
          logger.debug(`Restored file: ${snapshot.path}`);
        } else {
          // File didn't exist before - delete it
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            logger.debug(`Deleted file: ${snapshot.path}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to restore file ${snapshot.path}:`, error);
      }
    }
  }

  /**
   * Capture current git state
   */
  private async captureGitState(workingDirectory: string): Promise<GitState | undefined> {
    try {
      // Check if this is a git repo
      const { stdout: gitRoot } = await executeCommand('git rev-parse --show-toplevel', {
        cwd: workingDirectory,
      });

      if (!gitRoot) {
        return undefined;
      }

      // Get current branch
      const { stdout: branch } = await executeCommand('git rev-parse --abbrev-ref HEAD', {
        cwd: workingDirectory,
      });

      // Get current commit
      const { stdout: commitHash } = await executeCommand('git rev-parse HEAD', {
        cwd: workingDirectory,
      });

      // Check for uncommitted changes
      const { stdout: status } = await executeCommand('git status --porcelain', {
        cwd: workingDirectory,
      });

      return {
        branch: branch.trim(),
        commitHash: commitHash.trim(),
        hasUncommittedChanges: status.trim().length > 0,
      };

    } catch {
      // Not a git repo or git not available
      return undefined;
    }
  }

  /**
   * Restore git state (checkout branch/commit)
   */
  private async restoreGitState(
    gitState: GitState,
    workingDirectory: string
  ): Promise<void> {
    try {
      // Stash any current changes
      if (gitState.hasUncommittedChanges) {
        await executeCommand('git stash', { cwd: workingDirectory });
      }

      // Checkout the branch
      await executeCommand(`git checkout ${gitState.branch}`, { cwd: workingDirectory });

      // Reset to the commit
      await executeCommand(`git reset --hard ${gitState.commitHash}`, { cwd: workingDirectory });

      logger.info(`Git state restored to ${gitState.branch}@${gitState.commitHash.substring(0, 8)}`);

    } catch (error) {
      logger.error('Failed to restore git state:', error);
      throw error;
    }
  }

  /**
   * Save checkpoint to disk
   */
  private async saveCheckpoint(workflowId: string, checkpoint: Checkpoint): Promise<void> {
    const workflowDir = path.join(this.checkpointsDir, workflowId);
    this.ensureDir(workflowDir);

    const filePath = path.join(workflowDir, `${checkpoint.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');

    // Clean up old checkpoints
    await this.cleanupCheckpoints(workflowId, this.maxSnapshots);
  }

  /**
   * Clone context for checkpoint (deep copy)
   */
  private cloneContext(context: WorkflowContext): WorkflowContext {
    return JSON.parse(JSON.stringify(context));
  }

  /**
   * Execute a custom rollback handler
   */
  private async executeCustomRollback(
    handlerName: string,
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<void> {
    // Map of custom rollback handlers
    const handlers: Record<string, (step: WorkflowStep, context: WorkflowContext) => Promise<void>> = {
      'undoFileCreation': async (s, ctx) => {
        const filePath = s.tool?.parameters?.path as string;
        if (filePath) {
          const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(ctx.workingDirectory, filePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        }
      },
      
      'undoGitCommit': async (_, ctx) => {
        await executeCommand('git reset --soft HEAD~1', { cwd: ctx.workingDirectory });
      },

      'unstageFiles': async (_, ctx) => {
        await executeCommand('git reset HEAD', { cwd: ctx.workingDirectory });
      },
    };

    const handler = handlers[handlerName];
    if (handler) {
      await handler(step, context);
      logger.info(`Custom rollback executed: ${handlerName}`);
    } else {
      logger.warn(`Unknown custom rollback handler: ${handlerName}`);
    }
  }

  /**
   * Ensure directory exists
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let controllerInstance: RollbackController | null = null;

export function getRollbackController(): RollbackController {
  if (!controllerInstance) {
    controllerInstance = new RollbackController();
  }
  return controllerInstance;
}

export function resetRollbackController(): void {
  controllerInstance = null;
}
