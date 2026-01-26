/**
 * Atlas Desktop - Git Worktree Tools
 *
 * Provides git worktree management via voice commands.
 * Worktrees allow working on multiple branches simultaneously
 * without switching branches or stashing changes.
 *
 * Voice commands supported:
 * - "Create worktree for feature X"
 * - "List my worktrees"
 * - "Switch to worktree for feature Y"
 * - "Remove the feature X worktree"
 *
 * @module agent/tools/git-worktree
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitWorktree');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB

// ============================================================================
// Types
// ============================================================================

/**
 * Worktree information
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** HEAD commit SHA */
  head: string;
  /** Branch name (if any) */
  branch?: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether the worktree is bare */
  isBare: boolean;
  /** Whether the worktree is detached HEAD */
  isDetached: boolean;
  /** Whether the worktree is locked */
  isLocked: boolean;
  /** Lock reason if locked */
  lockReason?: string;
  /** Whether the worktree directory exists */
  exists: boolean;
}

/**
 * Worktree list result
 */
export interface WorktreeListResult {
  /** All worktrees */
  worktrees: WorktreeInfo[];
  /** Main worktree path */
  mainWorktree: string;
  /** Count of worktrees */
  count: number;
  /** Count of linked (non-main) worktrees */
  linkedCount: number;
}

/**
 * Worktree creation result
 */
export interface WorktreeAddResult {
  /** Path where worktree was created */
  path: string;
  /** Branch name */
  branch: string;
  /** Whether a new branch was created */
  newBranch: boolean;
  /** Starting point (commit/branch) if specified */
  startPoint?: string;
}

/**
 * Worktree state tracking
 */
export interface WorktreeState {
  /** Path to worktree */
  path: string;
  /** Branch being worked on */
  branch: string;
  /** Last accessed timestamp */
  lastAccessed: number;
  /** Description/purpose of this worktree */
  description?: string;
  /** Whether currently active (working directory) */
  isActive: boolean;
}

// In-memory worktree state tracking
const worktreeStates = new Map<string, WorktreeState>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a git command and return the result
 */
async function executeGitCommand(
  args: string[],
  cwd?: string
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  const workingDir = cwd ? path.resolve(cwd) : process.cwd();

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: workingDir,
      shell: os.platform() === 'win32',
      windowsHide: true,
    };

    const proc = spawn('git', args, spawnOptions);
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: 'Command timed out',
        exitCode: -1,
      });
    }, DEFAULT_TIMEOUT);

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length + data.length <= MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length + data.length <= MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Check if directory is a git repository
 */
async function isGitRepository(cwd?: string): Promise<boolean> {
  const result = await executeGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
  return result.success && result.stdout === 'true';
}

/**
 * Get repository root path
 */
async function getRepoRoot(cwd?: string): Promise<string | null> {
  const result = await executeGitCommand(['rev-parse', '--show-toplevel'], cwd);
  return result.success ? result.stdout : null;
}

/**
 * Parse worktree list output (porcelain format)
 */
function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.split('\n\n').filter((block) => block.trim());

  for (const block of blocks) {
    const lines = block.split('\n');
    const info: Partial<WorktreeInfo> = {
      isMain: false,
      isBare: false,
      isDetached: false,
      isLocked: false,
      exists: true,
    };

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        info.path = line.slice(9);
        // Check if directory exists
        info.exists = fs.existsSync(info.path);
      } else if (line.startsWith('HEAD ')) {
        info.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        // Format: branch refs/heads/branch-name
        const branchRef = line.slice(7);
        info.branch = branchRef.replace('refs/heads/', '');
      } else if (line === 'bare') {
        info.isBare = true;
      } else if (line === 'detached') {
        info.isDetached = true;
      } else if (line.startsWith('locked')) {
        info.isLocked = true;
        // May have a reason: "locked some reason"
        if (line.length > 7) {
          info.lockReason = line.slice(7);
        }
      }
    }

    // First worktree is the main one
    if (worktrees.length === 0) {
      info.isMain = true;
    }

    if (info.path && info.head) {
      worktrees.push(info as WorktreeInfo);
    }
  }

  return worktrees;
}

/**
 * Sanitize branch/worktree name from voice input
 */
function sanitizeName(name: string): string {
  // Remove common voice artifacts and normalize
  return name
    .toLowerCase()
    .replace(/['"]/g, '') // Remove quotes
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/[^a-z0-9\-_/]/g, '') // Remove invalid chars
    .replace(/^-+|-+$/g, '') // Trim dashes
    .slice(0, 100); // Limit length
}

/**
 * Generate worktree path from branch name
 */
function generateWorktreePath(repoRoot: string, branchName: string): string {
  // Create worktrees in a sibling directory to the main repo
  const repoName = path.basename(repoRoot);
  const parentDir = path.dirname(repoRoot);
  const safeBranchName = branchName.replace(/\//g, '-');
  return path.join(parentDir, `${repoName}-worktree-${safeBranchName}`);
}

/**
 * Update worktree state tracking
 */
function updateWorktreeState(
  worktreePath: string,
  branch: string,
  description?: string
): void {
  const existing = worktreeStates.get(worktreePath);
  worktreeStates.set(worktreePath, {
    path: worktreePath,
    branch,
    lastAccessed: Date.now(),
    description: description || existing?.description,
    isActive: false,
  });
}

/**
 * Get tracked worktree states
 */
export function getWorktreeStates(): WorktreeState[] {
  return Array.from(worktreeStates.values()).sort(
    (a, b) => b.lastAccessed - a.lastAccessed
  );
}

// ============================================================================
// Worktree List Tool
// ============================================================================

/**
 * List all git worktrees
 */
export const gitWorktreeListTool: AgentTool = {
  name: 'git_worktree_list',
  description:
    'List all git worktrees for the repository. Shows path, branch, and status of each worktree. ' +
    'Voice commands: "List my worktrees", "Show all worktrees", "What worktrees do I have".',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const result = await executeGitCommand(['worktree', 'list', '--porcelain'], cwd);

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to list worktrees',
        };
      }

      const worktrees = parseWorktreeList(result.stdout);
      const mainWorktree = worktrees.find((w) => w.isMain)?.path || '';
      const linkedCount = worktrees.filter((w) => !w.isMain).length;

      // Update state tracking for each worktree
      for (const wt of worktrees) {
        if (wt.branch) {
          updateWorktreeState(wt.path, wt.branch);
        }
      }

      const listResult: WorktreeListResult = {
        worktrees,
        mainWorktree,
        count: worktrees.length,
        linkedCount,
      };

      logger.debug('Worktrees listed', {
        count: worktrees.length,
        linkedCount,
      });

      return {
        success: true,
        data: listResult,
        metadata: {
          voiceResponse:
            linkedCount === 0
              ? 'You have no linked worktrees. Only the main repository worktree exists.'
              : `You have ${linkedCount} linked worktree${linkedCount === 1 ? '' : 's'}. ` +
                worktrees
                  .filter((w) => !w.isMain)
                  .slice(0, 3)
                  .map((w) => `${w.branch || 'detached'} at ${path.basename(w.path)}`)
                  .join(', '),
        },
      };
    } catch (error) {
      logger.error('Worktree list error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to list worktrees: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Add/Create Tool
// ============================================================================

/**
 * Create a new git worktree
 */
export const gitWorktreeAddTool: AgentTool = {
  name: 'git_worktree_add',
  description:
    'Create a new git worktree for working on a branch without switching. ' +
    'Voice commands: "Create worktree for feature X", "Add worktree for bug fix", ' +
    '"Make a new worktree called feature-login".',
  parameters: {
    type: 'object',
    properties: {
      branch: {
        type: 'string',
        description:
          'Branch name for the worktree. If it does not exist, it will be created.',
      },
      worktreePath: {
        type: 'string',
        description:
          'Path where the worktree should be created. If not provided, a default path is generated.',
      },
      startPoint: {
        type: 'string',
        description:
          'Commit, branch, or tag to start from (for new branches). Default: current HEAD.',
      },
      createBranch: {
        type: 'boolean',
        description:
          'Create a new branch (default: true if branch does not exist)',
      },
      force: {
        type: 'boolean',
        description:
          'Force creation even if branch is checked out elsewhere (default: false)',
      },
      detach: {
        type: 'boolean',
        description:
          'Create worktree with detached HEAD instead of a branch (default: false)',
      },
      description: {
        type: 'string',
        description: 'Optional description of the worktree purpose for tracking',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['branch'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const branchInput = params.branch as string;
    const worktreePathInput = params.worktreePath as string | undefined;
    const startPoint = params.startPoint as string | undefined;
    const createBranch = params.createBranch as boolean | undefined;
    const force = params.force === true;
    const detach = params.detach === true;
    const description = params.description as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Get repo root for path generation
      const repoRoot = await getRepoRoot(cwd);
      if (!repoRoot) {
        return {
          success: false,
          error: 'Could not determine repository root',
        };
      }

      // Sanitize branch name from voice input
      const branch = sanitizeName(branchInput);
      if (!branch) {
        return {
          success: false,
          error: 'Invalid branch name provided',
        };
      }

      // Determine worktree path
      const worktreePath = worktreePathInput
        ? path.resolve(worktreePathInput)
        : generateWorktreePath(repoRoot, branch);

      // Check if path already exists
      if (fs.existsSync(worktreePath)) {
        return {
          success: false,
          error: `Worktree path already exists: ${worktreePath}`,
          metadata: {
            suggestion: 'Use a different path or remove the existing directory',
          },
        };
      }

      // Check if branch exists
      const branchCheck = await executeGitCommand(
        ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
        cwd
      );
      const branchExists = branchCheck.success;

      // Build worktree add command
      const addArgs = ['worktree', 'add'];

      if (force) {
        addArgs.push('--force');
      }

      if (detach) {
        addArgs.push('--detach');
        addArgs.push(worktreePath);
        if (startPoint) {
          addArgs.push(startPoint);
        }
      } else if (!branchExists || createBranch === true) {
        // Create new branch
        addArgs.push('-b', branch);
        addArgs.push(worktreePath);
        if (startPoint) {
          addArgs.push(startPoint);
        }
      } else {
        // Use existing branch
        addArgs.push(worktreePath);
        addArgs.push(branch);
      }

      logger.info('Creating worktree', {
        branch,
        worktreePath,
        newBranch: !branchExists,
        startPoint,
      });

      const result = await executeGitCommand(addArgs, cwd);

      if (!result.success) {
        // Handle common errors
        if (result.stderr.includes('already checked out')) {
          return {
            success: false,
            error: `Branch '${branch}' is already checked out in another worktree. Use force: true to override.`,
          };
        }
        if (result.stderr.includes('already exists')) {
          return {
            success: false,
            error: `Branch '${branch}' already exists. Set createBranch: false to use existing branch.`,
          };
        }
        return {
          success: false,
          error: result.stderr || 'Failed to create worktree',
        };
      }

      // Update state tracking
      updateWorktreeState(worktreePath, branch, description);

      const addResult: WorktreeAddResult = {
        path: worktreePath,
        branch: detach ? 'detached' : branch,
        newBranch: !branchExists && !detach,
        startPoint,
      };

      logger.info('Worktree created', {
        path: worktreePath,
        branch,
        newBranch: addResult.newBranch,
      });

      return {
        success: true,
        data: addResult,
        metadata: {
          voiceResponse: `Created worktree for ${detach ? 'detached HEAD' : `branch ${branch}`} at ${path.basename(worktreePath)}. ${!branchExists && !detach ? 'A new branch was created.' : ''}`,
        },
      };
    } catch (error) {
      logger.error('Worktree add error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to create worktree: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Remove Tool
// ============================================================================

/**
 * Remove a git worktree
 */
export const gitWorktreeRemoveTool: AgentTool = {
  name: 'git_worktree_remove',
  description:
    'Remove a git worktree. The branch is kept but the working directory is removed. ' +
    'Voice commands: "Remove the feature X worktree", "Delete worktree for bug fix", ' +
    '"Clean up the feature-login worktree".',
  parameters: {
    type: 'object',
    properties: {
      worktree: {
        type: 'string',
        description:
          'Worktree path or branch name to remove',
      },
      force: {
        type: 'boolean',
        description:
          'Force removal even with uncommitted changes (default: false)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['worktree'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const worktreeInput = params.worktree as string;
    const force = params.force === true;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // List worktrees to find the target
      const listResult = await executeGitCommand(
        ['worktree', 'list', '--porcelain'],
        cwd
      );
      const worktrees = parseWorktreeList(listResult.stdout);

      // Find matching worktree by path or branch
      const sanitizedInput = sanitizeName(worktreeInput);
      const targetWorktree = worktrees.find((w) => {
        // Match by full path
        if (w.path === worktreeInput || w.path === path.resolve(worktreeInput)) {
          return true;
        }
        // Match by branch name
        if (w.branch && sanitizeName(w.branch) === sanitizedInput) {
          return true;
        }
        // Match by directory name
        if (path.basename(w.path).includes(sanitizedInput)) {
          return true;
        }
        return false;
      });

      if (!targetWorktree) {
        return {
          success: false,
          error: `Worktree not found: ${worktreeInput}`,
          metadata: {
            available: worktrees
              .filter((w) => !w.isMain)
              .map((w) => w.branch || path.basename(w.path)),
            suggestion: 'Use git_worktree_list to see available worktrees',
          },
        };
      }

      if (targetWorktree.isMain) {
        return {
          success: false,
          error: 'Cannot remove the main worktree',
        };
      }

      if (targetWorktree.isLocked && !force) {
        return {
          success: false,
          error: `Worktree is locked${targetWorktree.lockReason ? `: ${targetWorktree.lockReason}` : ''}. Use force: true to override.`,
        };
      }

      // Build remove command
      const removeArgs = ['worktree', 'remove'];
      if (force) {
        removeArgs.push('--force');
      }
      removeArgs.push(targetWorktree.path);

      const result = await executeGitCommand(removeArgs, cwd);

      if (!result.success) {
        if (result.stderr.includes('contains modified or untracked files')) {
          return {
            success: false,
            error: 'Worktree has uncommitted changes. Commit or discard them, or use force: true.',
          };
        }
        return {
          success: false,
          error: result.stderr || 'Failed to remove worktree',
        };
      }

      // Remove from state tracking
      worktreeStates.delete(targetWorktree.path);

      logger.info('Worktree removed', {
        path: targetWorktree.path,
        branch: targetWorktree.branch,
      });

      return {
        success: true,
        data: {
          removed: targetWorktree.path,
          branch: targetWorktree.branch,
          forced: force,
        },
        metadata: {
          voiceResponse: `Removed worktree for ${targetWorktree.branch || 'detached HEAD'}. The branch still exists if you need it.`,
        },
      };
    } catch (error) {
      logger.error('Worktree remove error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to remove worktree: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Switch Tool
// ============================================================================

/**
 * Switch to a different worktree (open in file explorer or terminal)
 */
export const gitWorktreeSwitchTool: AgentTool = {
  name: 'git_worktree_switch',
  description:
    'Switch to a different worktree. Returns the path for navigation. ' +
    'Voice commands: "Switch to worktree for feature X", "Go to the bug fix worktree", ' +
    '"Open the feature-login worktree".',
  parameters: {
    type: 'object',
    properties: {
      worktree: {
        type: 'string',
        description:
          'Worktree path or branch name to switch to',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['worktree'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const worktreeInput = params.worktree as string;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // List worktrees to find the target
      const listResult = await executeGitCommand(
        ['worktree', 'list', '--porcelain'],
        cwd
      );
      const worktrees = parseWorktreeList(listResult.stdout);

      // Find matching worktree
      const sanitizedInput = sanitizeName(worktreeInput);
      const targetWorktree = worktrees.find((w) => {
        if (w.path === worktreeInput || w.path === path.resolve(worktreeInput)) {
          return true;
        }
        if (w.branch && sanitizeName(w.branch) === sanitizedInput) {
          return true;
        }
        if (path.basename(w.path).includes(sanitizedInput)) {
          return true;
        }
        return false;
      });

      if (!targetWorktree) {
        return {
          success: false,
          error: `Worktree not found: ${worktreeInput}`,
          metadata: {
            available: worktrees.map((w) => w.branch || path.basename(w.path)),
            suggestion: 'Use git_worktree_list to see available worktrees',
          },
        };
      }

      if (!targetWorktree.exists) {
        return {
          success: false,
          error: `Worktree directory does not exist: ${targetWorktree.path}. It may have been deleted. Run git worktree prune to clean up.`,
        };
      }

      // Update state tracking with access time
      if (targetWorktree.branch) {
        const state = worktreeStates.get(targetWorktree.path);
        worktreeStates.set(targetWorktree.path, {
          path: targetWorktree.path,
          branch: targetWorktree.branch,
          lastAccessed: Date.now(),
          description: state?.description,
          isActive: true,
        });

        // Mark other worktrees as not active
        for (const [key, value] of worktreeStates) {
          if (key !== targetWorktree.path) {
            value.isActive = false;
          }
        }
      }

      logger.info('Switching to worktree', {
        path: targetWorktree.path,
        branch: targetWorktree.branch,
      });

      return {
        success: true,
        data: {
          path: targetWorktree.path,
          branch: targetWorktree.branch,
          head: targetWorktree.head,
          isMain: targetWorktree.isMain,
        },
        metadata: {
          voiceResponse: `Switched to worktree for ${targetWorktree.branch || 'detached HEAD'}. The path is ${targetWorktree.path}.`,
          // Can be used by the frontend to change working directory
          changeCwd: targetWorktree.path,
        },
      };
    } catch (error) {
      logger.error('Worktree switch error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to switch worktree: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Lock/Unlock Tool
// ============================================================================

/**
 * Lock or unlock a worktree to prevent accidental removal
 */
export const gitWorktreeLockTool: AgentTool = {
  name: 'git_worktree_lock',
  description:
    'Lock or unlock a worktree to prevent accidental removal. ' +
    'Voice commands: "Lock the feature X worktree", "Unlock the bug fix worktree".',
  parameters: {
    type: 'object',
    properties: {
      worktree: {
        type: 'string',
        description: 'Worktree path or branch name',
      },
      unlock: {
        type: 'boolean',
        description: 'Unlock instead of lock (default: false, meaning lock)',
      },
      reason: {
        type: 'string',
        description: 'Reason for locking (optional)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['worktree'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const worktreeInput = params.worktree as string;
    const unlock = params.unlock === true;
    const reason = params.reason as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // List worktrees to find the target
      const listResult = await executeGitCommand(
        ['worktree', 'list', '--porcelain'],
        cwd
      );
      const worktrees = parseWorktreeList(listResult.stdout);

      const sanitizedInput = sanitizeName(worktreeInput);
      const targetWorktree = worktrees.find((w) => {
        if (w.path === worktreeInput || w.path === path.resolve(worktreeInput)) {
          return true;
        }
        if (w.branch && sanitizeName(w.branch) === sanitizedInput) {
          return true;
        }
        return false;
      });

      if (!targetWorktree) {
        return {
          success: false,
          error: `Worktree not found: ${worktreeInput}`,
        };
      }

      if (targetWorktree.isMain) {
        return {
          success: false,
          error: 'Cannot lock/unlock the main worktree',
        };
      }

      // Build lock/unlock command
      const lockArgs = ['worktree', unlock ? 'unlock' : 'lock'];
      if (!unlock && reason) {
        lockArgs.push('--reason', reason);
      }
      lockArgs.push(targetWorktree.path);

      const result = await executeGitCommand(lockArgs, cwd);

      if (!result.success) {
        if (result.stderr.includes('is not locked')) {
          return {
            success: false,
            error: 'Worktree is not locked',
          };
        }
        if (result.stderr.includes('is locked')) {
          return {
            success: false,
            error: 'Worktree is already locked',
          };
        }
        return {
          success: false,
          error: result.stderr || `Failed to ${unlock ? 'unlock' : 'lock'} worktree`,
        };
      }

      logger.info(`Worktree ${unlock ? 'unlocked' : 'locked'}`, {
        path: targetWorktree.path,
        branch: targetWorktree.branch,
        reason,
      });

      return {
        success: true,
        data: {
          path: targetWorktree.path,
          branch: targetWorktree.branch,
          locked: !unlock,
          reason: unlock ? undefined : reason,
        },
        metadata: {
          voiceResponse: unlock
            ? `Unlocked worktree for ${targetWorktree.branch}.`
            : `Locked worktree for ${targetWorktree.branch}${reason ? ` with reason: ${reason}` : ''}.`,
        },
      };
    } catch (error) {
      logger.error('Worktree lock error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to ${params.unlock ? 'unlock' : 'lock'} worktree: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Prune Tool
// ============================================================================

/**
 * Prune stale worktree information
 */
export const gitWorktreePruneTool: AgentTool = {
  name: 'git_worktree_prune',
  description:
    'Clean up stale worktree references where the directory no longer exists. ' +
    'Voice commands: "Clean up worktrees", "Prune stale worktrees".',
  parameters: {
    type: 'object',
    properties: {
      dryRun: {
        type: 'boolean',
        description:
          'Only report what would be pruned without actually pruning (default: false)',
      },
      verbose: {
        type: 'boolean',
        description: 'Report all removals (default: true)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const dryRun = params.dryRun === true;
    const verbose = params.verbose !== false;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // First check what would be pruned
      const checkArgs = ['worktree', 'prune', '--dry-run'];
      if (verbose) {
        checkArgs.push('--verbose');
      }

      const checkResult = await executeGitCommand(checkArgs, cwd);
      const staleEntries = checkResult.stdout
        .split('\n')
        .filter((l) => l.includes('Removing'));

      if (dryRun) {
        return {
          success: true,
          data: {
            dryRun: true,
            staleCount: staleEntries.length,
            entries: staleEntries,
          },
          metadata: {
            voiceResponse:
              staleEntries.length === 0
                ? 'No stale worktrees to prune.'
                : `Found ${staleEntries.length} stale worktree${staleEntries.length === 1 ? '' : 's'} to prune.`,
          },
        };
      }

      // Actually prune
      const pruneArgs = ['worktree', 'prune'];
      if (verbose) {
        pruneArgs.push('--verbose');
      }

      const result = await executeGitCommand(pruneArgs, cwd);

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to prune worktrees',
        };
      }

      // Clean up state tracking for pruned worktrees
      for (const [path] of worktreeStates) {
        if (!fs.existsSync(path)) {
          worktreeStates.delete(path);
        }
      }

      logger.info('Worktrees pruned', { count: staleEntries.length });

      return {
        success: true,
        data: {
          pruned: staleEntries.length,
          entries: staleEntries,
        },
        metadata: {
          voiceResponse:
            staleEntries.length === 0
              ? 'No stale worktrees found.'
              : `Pruned ${staleEntries.length} stale worktree${staleEntries.length === 1 ? '' : 's'}.`,
        },
      };
    } catch (error) {
      logger.error('Worktree prune error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to prune worktrees: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Worktree Move Tool
// ============================================================================

/**
 * Move a worktree to a new location
 */
export const gitWorktreeMoveTool: AgentTool = {
  name: 'git_worktree_move',
  description:
    'Move a worktree to a new location on the filesystem. ' +
    'Voice commands: "Move worktree to new location", "Relocate the feature X worktree".',
  parameters: {
    type: 'object',
    properties: {
      worktree: {
        type: 'string',
        description: 'Current worktree path or branch name',
      },
      newPath: {
        type: 'string',
        description: 'New path for the worktree',
      },
      force: {
        type: 'boolean',
        description: 'Force move even if worktree is locked (default: false)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['worktree', 'newPath'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const worktreeInput = params.worktree as string;
    const newPath = params.newPath as string;
    const force = params.force === true;

    try {
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // List worktrees to find the target
      const listResult = await executeGitCommand(
        ['worktree', 'list', '--porcelain'],
        cwd
      );
      const worktrees = parseWorktreeList(listResult.stdout);

      const sanitizedInput = sanitizeName(worktreeInput);
      const targetWorktree = worktrees.find((w) => {
        if (w.path === worktreeInput || w.path === path.resolve(worktreeInput)) {
          return true;
        }
        if (w.branch && sanitizeName(w.branch) === sanitizedInput) {
          return true;
        }
        return false;
      });

      if (!targetWorktree) {
        return {
          success: false,
          error: `Worktree not found: ${worktreeInput}`,
        };
      }

      if (targetWorktree.isMain) {
        return {
          success: false,
          error: 'Cannot move the main worktree',
        };
      }

      const resolvedNewPath = path.resolve(newPath);

      if (fs.existsSync(resolvedNewPath)) {
        return {
          success: false,
          error: `Target path already exists: ${resolvedNewPath}`,
        };
      }

      // Build move command
      const moveArgs = ['worktree', 'move'];
      if (force) {
        moveArgs.push('--force');
      }
      moveArgs.push(targetWorktree.path, resolvedNewPath);

      const result = await executeGitCommand(moveArgs, cwd);

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to move worktree',
        };
      }

      // Update state tracking
      const oldState = worktreeStates.get(targetWorktree.path);
      worktreeStates.delete(targetWorktree.path);
      if (targetWorktree.branch) {
        worktreeStates.set(resolvedNewPath, {
          path: resolvedNewPath,
          branch: targetWorktree.branch,
          lastAccessed: Date.now(),
          description: oldState?.description,
          isActive: oldState?.isActive || false,
        });
      }

      logger.info('Worktree moved', {
        from: targetWorktree.path,
        to: resolvedNewPath,
        branch: targetWorktree.branch,
      });

      return {
        success: true,
        data: {
          oldPath: targetWorktree.path,
          newPath: resolvedNewPath,
          branch: targetWorktree.branch,
        },
        metadata: {
          voiceResponse: `Moved worktree for ${targetWorktree.branch} to ${path.basename(resolvedNewPath)}.`,
        },
      };
    } catch (error) {
      logger.error('Worktree move error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to move worktree: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git worktree tools
 */
export function getGitWorktreeTools(): AgentTool[] {
  return [
    gitWorktreeListTool,
    gitWorktreeAddTool,
    gitWorktreeRemoveTool,
    gitWorktreeSwitchTool,
    gitWorktreeLockTool,
    gitWorktreePruneTool,
    gitWorktreeMoveTool,
  ];
}

export default {
  gitWorktreeListTool,
  gitWorktreeAddTool,
  gitWorktreeRemoveTool,
  gitWorktreeSwitchTool,
  gitWorktreeLockTool,
  gitWorktreePruneTool,
  gitWorktreeMoveTool,
  getGitWorktreeTools,
  getWorktreeStates,
};
