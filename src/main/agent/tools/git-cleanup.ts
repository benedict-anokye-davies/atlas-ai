/**
 * Atlas Desktop - Git Branch Cleanup Tools
 *
 * Provides utilities for cleaning up git branches via voice commands.
 * Includes identification of merged/stale branches, batch deletion with
 * confirmation, and remote tracking branch cleanup.
 *
 * @module agent/tools/git-cleanup
 *
 * Voice commands:
 * - "Clean up branches"
 * - "Delete branch X"
 * - "Show stale branches"
 * - "List merged branches"
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitCleanupTool');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB
const STALE_BRANCH_DAYS = 30; // Branches with no commits in 30 days are stale

// Protected branches that should never be deleted
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'production', 'staging', 'release'];

// ============================================================================
// Result Types
// ============================================================================

/**
 * Branch information for cleanup analysis
 */
export interface CleanupBranchInfo {
  /** Branch name */
  name: string;
  /** Whether branch is merged into target */
  isMerged: boolean;
  /** Whether branch is stale (no recent commits) */
  isStale: boolean;
  /** Whether branch is protected */
  isProtected: boolean;
  /** Whether branch is safe to delete */
  safeToDelete: boolean;
  /** Last commit date on branch */
  lastCommitDate?: string;
  /** Days since last commit */
  daysSinceLastCommit?: number;
  /** Last commit message */
  lastCommitMessage?: string;
  /** Whether this is a remote branch */
  isRemote: boolean;
  /** Reason why branch is/isn't safe to delete */
  reason: string;
}

/**
 * Result of analyzing branches for cleanup
 */
export interface BranchCleanupAnalysis {
  /** Current branch (cannot be deleted) */
  currentBranch: string;
  /** Target branch for merge comparison (usually main/master) */
  targetBranch: string;
  /** All analyzed branches */
  branches: CleanupBranchInfo[];
  /** Branches that are merged and safe to delete */
  mergedBranches: CleanupBranchInfo[];
  /** Branches that are stale (no recent commits) */
  staleBranches: CleanupBranchInfo[];
  /** Branches safe to delete (merged + stale, not protected) */
  safeToDelete: CleanupBranchInfo[];
  /** Remote tracking branches that can be pruned */
  staleTrakingBranches: string[];
  /** Summary message */
  summary: string;
}

/**
 * Result of branch deletion operation
 */
export interface BranchDeletionResult {
  /** Successfully deleted branches */
  deleted: string[];
  /** Branches that failed to delete */
  failed: { branch: string; error: string }[];
  /** Branches that were skipped (protected or current) */
  skipped: { branch: string; reason: string }[];
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Summary message */
  summary: string;
}

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
 * Get the default branch (main or master)
 */
async function getDefaultBranch(cwd?: string): Promise<string> {
  // Try to get from remote HEAD
  const remoteResult = await executeGitCommand(
    ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
    cwd
  );
  if (remoteResult.success) {
    // Returns "origin/main" or "origin/master"
    return remoteResult.stdout.replace('origin/', '');
  }

  // Fallback: check if main or master exists
  const mainExists = await executeGitCommand(
    ['show-ref', '--verify', '--quiet', 'refs/heads/main'],
    cwd
  );
  if (mainExists.success) {
    return 'main';
  }

  const masterExists = await executeGitCommand(
    ['show-ref', '--verify', '--quiet', 'refs/heads/master'],
    cwd
  );
  if (masterExists.success) {
    return 'master';
  }

  return 'main'; // Default fallback
}

/**
 * Get current branch name
 */
async function getCurrentBranch(cwd?: string): Promise<string> {
  const result = await executeGitCommand(['branch', '--show-current'], cwd);
  return result.stdout || 'HEAD';
}

/**
 * Check if a branch is merged into target
 */
async function isBranchMerged(branch: string, target: string, cwd?: string): Promise<boolean> {
  const result = await executeGitCommand(
    ['branch', '--merged', target],
    cwd
  );
  if (!result.success) return false;

  const mergedBranches = result.stdout
    .split('\n')
    .map((b) => b.trim().replace(/^\*\s*/, ''));

  return mergedBranches.includes(branch);
}

/**
 * Get last commit date for a branch
 */
async function getLastCommitInfo(
  branch: string,
  cwd?: string
): Promise<{ date: string; message: string; daysAgo: number } | null> {
  const result = await executeGitCommand(
    ['log', '-1', '--format=%ci|%s', branch],
    cwd
  );

  if (!result.success || !result.stdout) return null;

  const [date, ...messageParts] = result.stdout.split('|');
  const message = messageParts.join('|');

  // Calculate days since last commit
  const commitDate = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - commitDate.getTime();
  const daysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return {
    date,
    message,
    daysAgo,
  };
}

/**
 * Check if branch name is protected
 */
function isProtectedBranch(name: string, additionalProtected: string[] = []): boolean {
  const allProtected = [...PROTECTED_BRANCHES, ...additionalProtected];
  const cleanName = name.replace(/^origin\//, '');
  return allProtected.some(
    (p) => cleanName === p || cleanName.startsWith(`${p}/`)
  );
}

// ============================================================================
// Git Branch Cleanup Analysis Tool
// ============================================================================

/**
 * Analyze branches for cleanup opportunities
 */
export const gitBranchCleanupAnalyzeTool: AgentTool = {
  name: 'git_branch_cleanup_analyze',
  description:
    'Analyze git branches to identify merged and stale branches that are safe to delete. Lists branches with their status and reasons for deletion recommendations.',
  parameters: {
    type: 'object',
    properties: {
      targetBranch: {
        type: 'string',
        description:
          'Branch to check merges against (default: auto-detect main/master)',
      },
      staleDays: {
        type: 'number',
        description: `Days without commits to consider stale (default: ${STALE_BRANCH_DAYS})`,
      },
      includeRemote: {
        type: 'boolean',
        description: 'Include remote branches in analysis (default: false)',
      },
      additionalProtected: {
        type: 'array',
        description: 'Additional branch names to protect from deletion',
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
    const staleDays = (params.staleDays as number) || STALE_BRANCH_DAYS;
    const includeRemote = params.includeRemote === true;
    const additionalProtected = (params.additionalProtected as string[]) || [];

    try {
      // Validate repository
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get target branch for comparison
      const targetBranch =
        (params.targetBranch as string) || (await getDefaultBranch(cwd));

      // Get current branch
      const currentBranch = await getCurrentBranch(cwd);

      // Fetch latest remote info
      await executeGitCommand(['fetch', '--prune'], cwd);

      // Get all local branches
      const localResult = await executeGitCommand(
        ['branch', '--format=%(refname:short)'],
        cwd
      );
      const localBranches = localResult.stdout
        .split('\n')
        .filter((b) => b.trim());

      // Get remote branches if requested
      let remoteBranches: string[] = [];
      if (includeRemote) {
        const remoteResult = await executeGitCommand(
          ['branch', '-r', '--format=%(refname:short)'],
          cwd
        );
        remoteBranches = remoteResult.stdout
          .split('\n')
          .filter((b) => b.trim() && !b.includes('HEAD'));
      }

      // Analyze each branch
      const analyzedBranches: CleanupBranchInfo[] = [];

      for (const branch of localBranches) {
        const isProtected = isProtectedBranch(branch, additionalProtected);
        const isCurrent = branch === currentBranch;
        const isMerged = await isBranchMerged(branch, targetBranch, cwd);
        const commitInfo = await getLastCommitInfo(branch, cwd);
        const isStale = commitInfo ? commitInfo.daysAgo >= staleDays : false;

        let reason: string;
        let safeToDelete = false;

        if (isCurrent) {
          reason = 'Current branch - cannot delete';
        } else if (isProtected) {
          reason = 'Protected branch';
        } else if (isMerged) {
          reason = `Merged into ${targetBranch}`;
          safeToDelete = true;
        } else if (isStale) {
          reason = `No commits in ${commitInfo?.daysAgo} days`;
          // Stale but not merged - be cautious
          safeToDelete = false;
        } else {
          reason = 'Active branch with unmerged changes';
        }

        analyzedBranches.push({
          name: branch,
          isMerged,
          isStale,
          isProtected,
          safeToDelete,
          lastCommitDate: commitInfo?.date,
          daysSinceLastCommit: commitInfo?.daysAgo,
          lastCommitMessage: commitInfo?.message,
          isRemote: false,
          reason,
        });
      }

      // Analyze remote branches if included
      for (const branch of remoteBranches) {
        const cleanName = branch.replace(/^origin\//, '');
        const isProtected = isProtectedBranch(cleanName, additionalProtected);
        const isMerged = await isBranchMerged(branch, `origin/${targetBranch}`, cwd);
        const commitInfo = await getLastCommitInfo(branch, cwd);
        const isStale = commitInfo ? commitInfo.daysAgo >= staleDays : false;

        let reason: string;
        let safeToDelete = false;

        if (isProtected) {
          reason = 'Protected branch';
        } else if (isMerged) {
          reason = `Merged into ${targetBranch}`;
          safeToDelete = true;
        } else if (isStale) {
          reason = `No commits in ${commitInfo?.daysAgo} days`;
        } else {
          reason = 'Active remote branch';
        }

        analyzedBranches.push({
          name: branch,
          isMerged,
          isStale,
          isProtected,
          safeToDelete,
          lastCommitDate: commitInfo?.date,
          daysSinceLastCommit: commitInfo?.daysAgo,
          lastCommitMessage: commitInfo?.message,
          isRemote: true,
          reason,
        });
      }

      // Categorize branches
      const mergedBranches = analyzedBranches.filter((b) => b.isMerged && !b.isProtected);
      const staleBranches = analyzedBranches.filter((b) => b.isStale && !b.isProtected);
      const safeToDelete = analyzedBranches.filter((b) => b.safeToDelete);

      // Get stale tracking branches
      const pruneResult = await executeGitCommand(
        ['remote', 'prune', 'origin', '--dry-run'],
        cwd
      );
      const staleTrackingBranches = pruneResult.stdout
        .split('\n')
        .filter((line) => line.includes('[would prune]'))
        .map((line) => line.replace(/.*\[would prune\]\s*/, '').trim());

      // Generate summary
      const summary = [
        `Found ${localBranches.length} local branches${includeRemote ? ` and ${remoteBranches.length} remote branches` : ''}.`,
        mergedBranches.length > 0
          ? `${mergedBranches.length} branches are merged and can be deleted.`
          : 'No merged branches to clean up.',
        staleBranches.length > 0
          ? `${staleBranches.length} branches have no commits in ${staleDays}+ days.`
          : '',
        staleTrackingBranches.length > 0
          ? `${staleTrackingBranches.length} stale remote tracking references can be pruned.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      const result: BranchCleanupAnalysis = {
        currentBranch,
        targetBranch,
        branches: analyzedBranches,
        mergedBranches,
        staleBranches,
        safeToDelete,
        staleTrakingBranches: staleTrackingBranches,
        summary,
      };

      logger.info('Branch cleanup analysis complete', {
        total: analyzedBranches.length,
        merged: mergedBranches.length,
        stale: staleBranches.length,
        safeToDelete: safeToDelete.length,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Branch cleanup analysis error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to analyze branches: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Branch Cleanup Delete Tool
// ============================================================================

/**
 * Delete branches identified for cleanup
 */
export const gitBranchCleanupDeleteTool: AgentTool = {
  name: 'git_branch_cleanup_delete',
  description:
    'Delete git branches that are merged or specified. Supports batch deletion with confirmation. Protected branches (main, master, develop, production) are never deleted unless force is used.',
  parameters: {
    type: 'object',
    properties: {
      branches: {
        type: 'array',
        description:
          'Array of branch names to delete. Use ["merged"] to delete all merged branches.',
      },
      deleteMerged: {
        type: 'boolean',
        description: 'Delete all merged branches (alternative to specifying branches)',
      },
      includeRemote: {
        type: 'boolean',
        description: 'Also delete remote branches (default: false)',
      },
      force: {
        type: 'boolean',
        description:
          'Force delete unmerged branches (default: false). Does NOT bypass protected branch check.',
      },
      forceProtected: {
        type: 'boolean',
        description:
          'Allow deletion of protected branches. Requires explicit confirmation (default: false)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Show what would be deleted without actually deleting (default: false)',
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
    const branches = (params.branches as string[]) || [];
    const deleteMerged = params.deleteMerged === true;
    const includeRemote = params.includeRemote === true;
    const force = params.force === true;
    const forceProtected = params.forceProtected === true;
    const dryRun = params.dryRun === true;

    try {
      // Validate repository
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get current branch
      const currentBranch = await getCurrentBranch(cwd);
      const targetBranch = await getDefaultBranch(cwd);

      // Determine branches to delete
      let branchesToDelete: string[] = [...branches];

      if (deleteMerged || branches.includes('merged')) {
        // Get all merged branches
        const mergedResult = await executeGitCommand(
          ['branch', '--merged', targetBranch, '--format=%(refname:short)'],
          cwd
        );
        const mergedBranches = mergedResult.stdout
          .split('\n')
          .filter((b) => b.trim() && b !== targetBranch && b !== currentBranch);

        branchesToDelete = Array.from(
          new Set([
            ...branchesToDelete.filter((b) => b !== 'merged'),
            ...mergedBranches,
          ])
        );
      }

      if (branchesToDelete.length === 0) {
        return {
          success: true,
          data: {
            deleted: [],
            failed: [],
            skipped: [],
            dryRun,
            summary: 'No branches to delete',
          } as BranchDeletionResult,
        };
      }

      const deleted: string[] = [];
      const failed: { branch: string; error: string }[] = [];
      const skipped: { branch: string; reason: string }[] = [];

      for (const branch of branchesToDelete) {
        const isRemote = branch.startsWith('origin/');
        const cleanName = branch.replace(/^origin\//, '');

        // Check if it's the current branch
        if (cleanName === currentBranch) {
          skipped.push({
            branch,
            reason: 'Cannot delete current branch',
          });
          continue;
        }

        // Check if it's protected
        if (isProtectedBranch(cleanName) && !forceProtected) {
          skipped.push({
            branch,
            reason: 'Protected branch (use forceProtected: true to override)',
          });
          continue;
        }

        if (dryRun) {
          // Simulate deletion
          deleted.push(branch);
          continue;
        }

        // Delete the branch
        let deleteResult;
        if (isRemote) {
          if (includeRemote) {
            deleteResult = await executeGitCommand(
              ['push', 'origin', '--delete', cleanName],
              cwd
            );
          } else {
            skipped.push({
              branch,
              reason: 'Remote branch (use includeRemote: true to delete)',
            });
            continue;
          }
        } else {
          deleteResult = await executeGitCommand(
            ['branch', force ? '-D' : '-d', branch],
            cwd
          );
        }

        if (deleteResult.success) {
          deleted.push(branch);
          logger.info('Branch deleted', { branch, isRemote, force });
        } else {
          failed.push({
            branch,
            error: deleteResult.stderr || 'Unknown error',
          });
        }
      }

      const summary = [
        dryRun ? '[DRY RUN] ' : '',
        `Deleted: ${deleted.length}`,
        failed.length > 0 ? `, Failed: ${failed.length}` : '',
        skipped.length > 0 ? `, Skipped: ${skipped.length}` : '',
      ].join('');

      const result: BranchDeletionResult = {
        deleted,
        failed,
        skipped,
        dryRun,
        summary,
      };

      logger.info('Branch cleanup complete', {
        deleted: deleted.length,
        failed: failed.length,
        skipped: skipped.length,
        dryRun,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Branch cleanup delete error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to delete branches: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Prune Remote Tracking Tool
// ============================================================================

/**
 * Prune stale remote tracking branches
 */
export const gitPruneRemoteTool: AgentTool = {
  name: 'git_prune_remote',
  description:
    'Clean up stale remote tracking branches that no longer exist on the remote. This removes local references to deleted remote branches.',
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name to prune (default: origin)',
      },
      dryRun: {
        type: 'boolean',
        description: 'Show what would be pruned without actually pruning (default: false)',
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
    const remote = (params.remote as string) || 'origin';
    const dryRun = params.dryRun === true;

    try {
      // Validate repository
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // First, fetch to update remote info
      await executeGitCommand(['fetch', remote], cwd);

      // Run prune (with or without dry-run)
      const pruneArgs = ['remote', 'prune', remote];
      if (dryRun) {
        pruneArgs.push('--dry-run');
      }

      const result = await executeGitCommand(pruneArgs, cwd);

      if (!result.success && result.stderr) {
        return {
          success: false,
          error: result.stderr,
        };
      }

      // Parse pruned branches from output
      const prunedBranches = result.stdout
        .split('\n')
        .filter((line) => line.includes('[would prune]') || line.includes('Pruning'))
        .map((line) => {
          const match = line.match(/(?:\[would prune\]|\* \[pruned\])\s+(.+)/);
          return match ? match[1].trim() : line.trim();
        })
        .filter(Boolean);

      logger.info('Remote prune complete', {
        remote,
        prunedCount: prunedBranches.length,
        dryRun,
      });

      return {
        success: true,
        data: {
          remote,
          pruned: prunedBranches,
          count: prunedBranches.length,
          dryRun,
          summary:
            prunedBranches.length > 0
              ? `${dryRun ? 'Would prune' : 'Pruned'} ${prunedBranches.length} stale tracking reference(s)`
              : 'No stale tracking references to prune',
        },
      };
    } catch (error) {
      logger.error('Git prune remote error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to prune remote: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git List Stale Branches Tool
// ============================================================================

/**
 * List stale branches with no recent commits
 */
export const gitListStaleBranchesTool: AgentTool = {
  name: 'git_list_stale_branches',
  description:
    'List branches that have no commits within a specified number of days. Helps identify abandoned branches.',
  parameters: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: `Days without commits to consider stale (default: ${STALE_BRANCH_DAYS})`,
      },
      includeRemote: {
        type: 'boolean',
        description: 'Include remote branches (default: false)',
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
    const days = (params.days as number) || STALE_BRANCH_DAYS;
    const includeRemote = params.includeRemote === true;

    try {
      // Validate repository
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get branches
      const branchArgs = includeRemote ? ['branch', '-a'] : ['branch'];
      branchArgs.push('--format=%(refname:short)');

      const branchResult = await executeGitCommand(branchArgs, cwd);
      const branches = branchResult.stdout
        .split('\n')
        .filter((b) => b.trim() && !b.includes('HEAD'));

      const staleBranches: Array<{
        name: string;
        lastCommitDate: string;
        daysSinceLastCommit: number;
        lastCommitMessage: string;
        isRemote: boolean;
        isProtected: boolean;
      }> = [];

      for (const branch of branches) {
        const commitInfo = await getLastCommitInfo(branch, cwd);
        if (!commitInfo) continue;

        if (commitInfo.daysAgo >= days) {
          const isRemote = branch.startsWith('origin/') || branch.includes('/');
          staleBranches.push({
            name: branch,
            lastCommitDate: commitInfo.date,
            daysSinceLastCommit: commitInfo.daysAgo,
            lastCommitMessage: commitInfo.message,
            isRemote,
            isProtected: isProtectedBranch(branch.replace(/^origin\//, '')),
          });
        }
      }

      // Sort by most stale first
      staleBranches.sort((a, b) => b.daysSinceLastCommit - a.daysSinceLastCommit);

      logger.debug('Listed stale branches', { count: staleBranches.length, days });

      return {
        success: true,
        data: {
          staleBranches,
          count: staleBranches.length,
          threshold: days,
          summary:
            staleBranches.length > 0
              ? `Found ${staleBranches.length} branch(es) with no commits in ${days}+ days`
              : `No branches found with commits older than ${days} days`,
        },
      };
    } catch (error) {
      logger.error('List stale branches error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to list stale branches: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git List Merged Branches Tool
// ============================================================================

/**
 * List branches that are merged into target branch
 */
export const gitListMergedBranchesTool: AgentTool = {
  name: 'git_list_merged_branches',
  description:
    'List branches that have been merged into the target branch (usually main or master) and are safe to delete.',
  parameters: {
    type: 'object',
    properties: {
      targetBranch: {
        type: 'string',
        description: 'Branch to check merges against (default: auto-detect main/master)',
      },
      includeRemote: {
        type: 'boolean',
        description: 'Include remote branches (default: false)',
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
    const includeRemote = params.includeRemote === true;

    try {
      // Validate repository
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get target branch
      const targetBranch =
        (params.targetBranch as string) || (await getDefaultBranch(cwd));
      const currentBranch = await getCurrentBranch(cwd);

      // Get merged local branches
      const localResult = await executeGitCommand(
        ['branch', '--merged', targetBranch, '--format=%(refname:short)'],
        cwd
      );
      const localMerged = localResult.stdout
        .split('\n')
        .filter(
          (b) =>
            b.trim() &&
            b !== targetBranch &&
            b !== currentBranch
        );

      // Get merged remote branches if requested
      let remoteMerged: string[] = [];
      if (includeRemote) {
        const remoteResult = await executeGitCommand(
          ['branch', '-r', '--merged', `origin/${targetBranch}`, '--format=%(refname:short)'],
          cwd
        );
        remoteMerged = remoteResult.stdout
          .split('\n')
          .filter(
            (b) =>
              b.trim() &&
              !b.includes('HEAD') &&
              b !== `origin/${targetBranch}`
          );
      }

      // Build detailed info for each branch
      const mergedBranches: Array<{
        name: string;
        isRemote: boolean;
        isProtected: boolean;
        canDelete: boolean;
        lastCommitDate?: string;
        lastCommitMessage?: string;
      }> = [];

      for (const branch of localMerged) {
        const commitInfo = await getLastCommitInfo(branch, cwd);
        const isProtected = isProtectedBranch(branch);
        mergedBranches.push({
          name: branch,
          isRemote: false,
          isProtected,
          canDelete: !isProtected,
          lastCommitDate: commitInfo?.date,
          lastCommitMessage: commitInfo?.message,
        });
      }

      for (const branch of remoteMerged) {
        const commitInfo = await getLastCommitInfo(branch, cwd);
        const cleanName = branch.replace(/^origin\//, '');
        const isProtected = isProtectedBranch(cleanName);
        mergedBranches.push({
          name: branch,
          isRemote: true,
          isProtected,
          canDelete: !isProtected,
          lastCommitDate: commitInfo?.date,
          lastCommitMessage: commitInfo?.message,
        });
      }

      const deletable = mergedBranches.filter((b) => b.canDelete);

      logger.debug('Listed merged branches', {
        total: mergedBranches.length,
        deletable: deletable.length,
        targetBranch,
      });

      return {
        success: true,
        data: {
          targetBranch,
          currentBranch,
          mergedBranches,
          deletableBranches: deletable,
          totalMerged: mergedBranches.length,
          totalDeletable: deletable.length,
          summary:
            deletable.length > 0
              ? `Found ${deletable.length} merged branch(es) safe to delete`
              : 'No merged branches to clean up',
        },
      };
    } catch (error) {
      logger.error('List merged branches error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to list merged branches: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git cleanup tools
 */
export function getGitCleanupTools(): AgentTool[] {
  return [
    gitBranchCleanupAnalyzeTool,
    gitBranchCleanupDeleteTool,
    gitPruneRemoteTool,
    gitListStaleBranchesTool,
    gitListMergedBranchesTool,
  ];
}

export default {
  gitBranchCleanupAnalyzeTool,
  gitBranchCleanupDeleteTool,
  gitPruneRemoteTool,
  gitListStaleBranchesTool,
  gitListMergedBranchesTool,
  getGitCleanupTools,
};
