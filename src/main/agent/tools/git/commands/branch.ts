/**
 * Atlas Desktop - Git Branch Commands
 * Implements: branch, checkout, merge, diff, log
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  GitOptions,
  GitMergeOptions,
  GitOperationResult,
  GitBranchListResult,
  GitDiffResult,
  GitLogResult,
} from '../types';
import { parseGitBranches, parseGitLog, parseGitDiff } from '../utils/parser';
import {
  findGitRoot,
  validateBranchName,
  validateMergeOperation,
} from '../utils/validator';
import { createModuleLogger } from '../../../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('GitBranch');

const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT = 1024 * 1024;

/**
 * Execute a git command
 */
async function execGit(
  command: string,
  options: GitOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = options.cwd || process.cwd();
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    };
  }
}

/**
 * Git branch - list, create, or delete branches
 */
export async function gitBranch(
  options: GitOptions & {
    create?: string;
    delete?: string;
    forceDelete?: boolean;
    all?: boolean;
  } = {}
): Promise<GitOperationResult<GitBranchListResult | { created?: string; deleted?: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Create branch
  if (options.create) {
    const validation = validateBranchName(options.create);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid branch name',
      };
    }

    logger.debug('Creating branch', { name: options.create });

    const result = await execGit(`branch "${options.create}"`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('already exists')) {
        return {
          success: false,
          error: `Branch '${options.create}' already exists`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to create branch',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { created: options.create },
    };
  }

  // Delete branch
  if (options.delete) {
    logger.debug('Deleting branch', { name: options.delete, force: options.forceDelete });

    const deleteFlag = options.forceDelete ? '-D' : '-d';
    const result = await execGit(`branch ${deleteFlag} "${options.delete}"`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('not found')) {
        return {
          success: false,
          error: `Branch '${options.delete}' not found`,
          exitCode: result.exitCode,
        };
      }
      if (result.stderr.includes('not fully merged')) {
        return {
          success: false,
          error: `Branch '${options.delete}' is not fully merged. Use forceDelete to delete anyway.`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to delete branch',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { deleted: options.delete },
    };
  }

  // List branches
  logger.debug('Listing branches', { all: options.all });

  const localResult = await execGit('branch -vv', { cwd: gitRoot });
  let remoteResult = { stdout: '', stderr: '', exitCode: 0 };

  if (options.all) {
    remoteResult = await execGit('branch -r', { cwd: gitRoot });
  }

  if (localResult.exitCode !== 0) {
    return {
      success: false,
      error: localResult.stderr || 'Failed to list branches',
      exitCode: localResult.exitCode,
    };
  }

  const branches = parseGitBranches(localResult.stdout, options.all ? remoteResult.stdout : undefined);

  return {
    success: true,
    data: branches,
  };
}

/**
 * Git checkout - switch branches or restore files
 */
export async function gitCheckout(
  target: string,
  options: GitOptions & {
    createBranch?: boolean;
    files?: string[];
  } = {}
): Promise<GitOperationResult<{ branch?: string; files?: string[] }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Checkout files
  if (options.files && options.files.length > 0) {
    logger.debug('Restoring files', { files: options.files, source: target });

    const filesArg = options.files.map((f) => `"${f}"`).join(' ');
    const result = await execGit(`checkout ${target} -- ${filesArg}`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to restore files',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { files: options.files },
    };
  }

  // Validate branch name if creating
  if (options.createBranch) {
    const validation = validateBranchName(target);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid branch name',
      };
    }
  }

  logger.debug('Checking out', { target, createBranch: options.createBranch });

  // Build command
  const args: string[] = ['checkout'];
  if (options.createBranch) {
    args.push('-b');
  }
  args.push(`"${target}"`);

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('already exists')) {
      return {
        success: false,
        error: `Branch '${target}' already exists`,
        exitCode: result.exitCode,
      };
    }
    if (result.stderr.includes("didn't match any")) {
      return {
        success: false,
        error: `Branch or path '${target}' not found`,
        exitCode: result.exitCode,
      };
    }
    if (result.stderr.includes('local changes')) {
      return {
        success: false,
        error: 'You have local changes that would be overwritten. Commit or stash them first.',
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to checkout',
      exitCode: result.exitCode,
    };
  }

  logger.info('Checkout successful', { branch: target });

  return {
    success: true,
    data: { branch: target },
  };
}

/**
 * Git merge - merge branches
 */
export async function gitMerge(
  options: GitMergeOptions
): Promise<GitOperationResult<{ merged: string; conflicts: boolean }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Handle abort
  if (options.abort) {
    logger.debug('Aborting merge');
    const result = await execGit('merge --abort', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to abort merge',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { merged: 'aborted', conflicts: false },
    };
  }

  // Validate merge
  const validation = validateMergeOperation(options);
  for (const warning of validation.warnings) {
    logger.warn('Merge warning', { warning });
  }

  logger.debug('Merging branch', { branch: options.branch, noFf: options.noFf, squash: options.squash });

  // Build merge command
  const args: string[] = ['merge'];

  if (options.noFf) {
    args.push('--no-ff');
  }

  if (options.squash) {
    args.push('--squash');
  }

  if (options.message) {
    args.push('-m', `"${options.message.replace(/"/g, '\\"')}"`);
  }

  args.push(`"${options.branch}"`);

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  const hasConflicts =
    result.stderr.includes('CONFLICT') ||
    result.stdout.includes('Automatic merge failed') ||
    result.stdout.includes('CONFLICT');

  if (result.exitCode !== 0 && !hasConflicts) {
    if (result.stderr.includes('not something we can merge')) {
      return {
        success: false,
        error: `Cannot merge '${options.branch}' - not a valid branch or commit`,
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to merge',
      exitCode: result.exitCode,
    };
  }

  if (hasConflicts) {
    logger.warn('Merge completed with conflicts');
    return {
      success: true,
      data: { merged: options.branch, conflicts: true },
    };
  }

  logger.info('Merge successful', { branch: options.branch });

  return {
    success: true,
    data: { merged: options.branch, conflicts: false },
  };
}

/**
 * Git diff - show changes
 */
export async function gitDiff(
  options: GitOptions & {
    staged?: boolean;
    commit?: string;
    base?: string;
    files?: string[];
    stat?: boolean;
  } = {}
): Promise<GitOperationResult<GitDiffResult>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  logger.debug('Getting diff', { staged: options.staged, commit: options.commit });

  // Build diff command for numstat (structured output)
  const args: string[] = ['diff', '--numstat'];

  if (options.staged) {
    args.push('--staged');
  }

  if (options.base && options.commit) {
    args.push(`${options.base}...${options.commit}`);
  } else if (options.commit) {
    args.push(options.commit);
  }

  if (options.files && options.files.length > 0) {
    args.push('--');
    args.push(...options.files.map((f) => `"${f}"`));
  }

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get diff',
      exitCode: result.exitCode,
    };
  }

  const diffResult = parseGitDiff(result.stdout);

  return {
    success: true,
    data: diffResult,
  };
}

/**
 * Git log - show commit history
 */
export async function gitLog(
  options: GitOptions & {
    count?: number;
    branch?: string;
    author?: string;
    since?: string;
    until?: string;
    oneline?: boolean;
  } = {}
): Promise<GitOperationResult<GitLogResult>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  const count = options.count || 20;
  const branch = options.branch || 'HEAD';

  logger.debug('Getting log', { count, branch });

  // Build log command with structured format
  const format = '%H|%h|%an|%ae|%ai|%s';
  const args: string[] = ['log', `--format="${format}"`, `-n ${count}`];

  if (options.author) {
    args.push(`--author="${options.author}"`);
  }

  if (options.since) {
    args.push(`--since="${options.since}"`);
  }

  if (options.until) {
    args.push(`--until="${options.until}"`);
  }

  args.push(branch);

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('unknown revision')) {
      return {
        success: false,
        error: `Unknown revision: ${branch}`,
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to get log',
      exitCode: result.exitCode,
    };
  }

  const logResult = parseGitLog(result.stdout, branch);

  return {
    success: true,
    data: logResult,
  };
}

export default {
  gitBranch,
  gitCheckout,
  gitMerge,
  gitDiff,
  gitLog,
};
