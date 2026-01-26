/**
 * Atlas Desktop - Advanced Git Commands
 * Implements: rebase, cherry-pick, stash, submodule, reset, revert
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  GitOptions,
  GitRebaseOptions,
  GitResetOptions,
  GitStashOptions,
  GitOperationResult,
  GitStashEntry,
  GitSubmoduleInfo,
} from '../types';
import { parseGitStashList } from '../utils/parser';
import { findGitRoot, validateResetOperation, validateRebaseOperation } from '../utils/validator';
import { createModuleLogger } from '../../../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('GitAdvanced');

const DEFAULT_TIMEOUT = 60000; // Advanced operations may take longer
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
 * Git rebase - rebase commits
 */
export async function gitRebase(
  options: GitRebaseOptions
): Promise<GitOperationResult<{ rebased: boolean; conflicts: boolean }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Validate rebase operation
  const validation = validateRebaseOperation(options);
  for (const warning of validation.warnings) {
    logger.warn('Rebase warning', { warning });
  }

  // Handle abort
  if (options.abort) {
    logger.debug('Aborting rebase');
    const result = await execGit('rebase --abort', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('No rebase in progress')) {
        return {
          success: false,
          error: 'No rebase in progress',
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to abort rebase',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { rebased: false, conflicts: false },
    };
  }

  // Handle continue
  if (options.continue) {
    logger.debug('Continuing rebase');
    const result = await execGit('rebase --continue', { cwd: gitRoot });

    const hasConflicts = result.stderr.includes('CONFLICT') || result.stdout.includes('CONFLICT');

    if (result.exitCode !== 0 && !hasConflicts) {
      return {
        success: false,
        error: result.stderr || 'Failed to continue rebase',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { rebased: result.exitCode === 0, conflicts: hasConflicts },
    };
  }

  // Handle skip
  if (options.skip) {
    logger.debug('Skipping rebase commit');
    const result = await execGit('rebase --skip', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to skip rebase commit',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { rebased: true, conflicts: false },
    };
  }

  // Start rebase
  logger.debug('Starting rebase', { onto: options.onto, interactive: options.interactive });

  // Build rebase command
  const args: string[] = ['rebase'];

  // Note: Interactive rebase is not supported in non-interactive mode
  // It would require an editor, so we skip -i flag

  args.push(`"${options.onto}"`);

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  const hasConflicts =
    result.stderr.includes('CONFLICT') ||
    result.stdout.includes('CONFLICT') ||
    result.stderr.includes('could not apply');

  if (result.exitCode !== 0 && !hasConflicts) {
    if (result.stderr.includes('invalid upstream')) {
      return {
        success: false,
        error: `Invalid upstream: ${options.onto}`,
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to rebase',
      exitCode: result.exitCode,
    };
  }

  if (hasConflicts) {
    logger.warn('Rebase has conflicts');
    return {
      success: true,
      data: { rebased: false, conflicts: true },
    };
  }

  logger.info('Rebase successful', { onto: options.onto });

  return {
    success: true,
    data: { rebased: true, conflicts: false },
  };
}

/**
 * Git cherry-pick - apply specific commits
 */
export async function gitCherryPick(
  commits: string | string[],
  options: GitOptions & {
    noCommit?: boolean;
    abort?: boolean;
    continue?: boolean;
    skip?: boolean;
  } = {}
): Promise<GitOperationResult<{ picked: string[]; conflicts: boolean }>> {
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
    logger.debug('Aborting cherry-pick');
    const result = await execGit('cherry-pick --abort', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to abort cherry-pick',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { picked: [], conflicts: false },
    };
  }

  // Handle continue
  if (options.continue) {
    logger.debug('Continuing cherry-pick');
    const result = await execGit('cherry-pick --continue', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to continue cherry-pick',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { picked: [], conflicts: false },
    };
  }

  // Handle skip
  if (options.skip) {
    logger.debug('Skipping cherry-pick commit');
    const result = await execGit('cherry-pick --skip', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to skip cherry-pick',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { picked: [], conflicts: false },
    };
  }

  const commitList = Array.isArray(commits) ? commits : [commits];

  logger.debug('Cherry-picking commits', { commits: commitList });

  // Build cherry-pick command
  const args: string[] = ['cherry-pick'];

  if (options.noCommit) {
    args.push('-n');
  }

  args.push(...commitList.map((c) => `"${c}"`));

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  const hasConflicts = result.stderr.includes('CONFLICT') || result.stdout.includes('CONFLICT');

  if (result.exitCode !== 0 && !hasConflicts) {
    if (result.stderr.includes('bad revision')) {
      return {
        success: false,
        error: 'One or more commits not found',
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to cherry-pick',
      exitCode: result.exitCode,
    };
  }

  if (hasConflicts) {
    logger.warn('Cherry-pick has conflicts');
    return {
      success: true,
      data: { picked: commitList, conflicts: true },
    };
  }

  logger.info('Cherry-pick successful', { commits: commitList });

  return {
    success: true,
    data: { picked: commitList, conflicts: false },
  };
}

/**
 * Git stash - stash changes
 */
export async function gitStash(
  options: GitStashOptions & {
    list?: boolean;
    pop?: number;
    apply?: number;
    drop?: number;
    clear?: boolean;
  } = {}
): Promise<GitOperationResult<GitStashEntry[] | { stashed: boolean; index?: number }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // List stashes
  if (options.list) {
    logger.debug('Listing stashes');
    const result = await execGit('stash list', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to list stashes',
        exitCode: result.exitCode,
      };
    }

    const stashes = parseGitStashList(result.stdout);

    return {
      success: true,
      data: stashes,
    };
  }

  // Pop stash
  if (options.pop !== undefined) {
    logger.debug('Popping stash', { index: options.pop });
    const result = await execGit(`stash pop stash@{${options.pop}}`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes("doesn't exist")) {
        return {
          success: false,
          error: `Stash @{${options.pop}} does not exist`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to pop stash',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { stashed: false, index: options.pop },
    };
  }

  // Apply stash
  if (options.apply !== undefined) {
    logger.debug('Applying stash', { index: options.apply });
    const result = await execGit(`stash apply stash@{${options.apply}}`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to apply stash',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { stashed: false, index: options.apply },
    };
  }

  // Drop stash
  if (options.drop !== undefined) {
    logger.debug('Dropping stash', { index: options.drop });
    const result = await execGit(`stash drop stash@{${options.drop}}`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to drop stash',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { stashed: false, index: options.drop },
    };
  }

  // Clear all stashes
  if (options.clear) {
    logger.debug('Clearing all stashes');
    const result = await execGit('stash clear', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to clear stashes',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { stashed: false },
    };
  }

  // Create stash
  logger.debug('Creating stash', { message: options.message });

  const args: string[] = ['stash', 'push'];

  if (options.message) {
    args.push('-m', `"${options.message.replace(/"/g, '\\"')}"`);
  }

  if (options.includeUntracked) {
    args.push('-u');
  }

  if (options.keepIndex) {
    args.push('--keep-index');
  }

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to stash changes',
      exitCode: result.exitCode,
    };
  }

  // Check if anything was stashed
  if (result.stdout.includes('No local changes to save')) {
    return {
      success: true,
      data: { stashed: false },
    };
  }

  logger.info('Stash created');

  return {
    success: true,
    data: { stashed: true, index: 0 },
  };
}

/**
 * Git reset - reset HEAD
 */
export async function gitReset(
  options: GitResetOptions
): Promise<GitOperationResult<{ reset: boolean; mode: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Validate reset operation
  const validation = validateResetOperation(options);
  for (const warning of validation.warnings) {
    logger.warn('Reset warning', { warning });
  }

  // Reset specific files (unstage)
  if (options.files && options.files.length > 0) {
    logger.debug('Unstaging files', { files: options.files });

    const filesArg = options.files.map((f) => `"${f}"`).join(' ');
    const result = await execGit(`reset HEAD -- ${filesArg}`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to unstage files',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { reset: true, mode: 'unstage' },
    };
  }

  // Reset HEAD
  logger.debug('Resetting HEAD', { mode: options.mode, to: options.to });

  const args: string[] = ['reset', `--${options.mode}`];

  if (options.to) {
    args.push(`"${options.to}"`);
  }

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('unknown revision')) {
      return {
        success: false,
        error: `Unknown revision: ${options.to}`,
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to reset',
      exitCode: result.exitCode,
    };
  }

  logger.info('Reset successful', { mode: options.mode });

  return {
    success: true,
    data: { reset: true, mode: options.mode },
  };
}

/**
 * Git revert - revert commits
 */
export async function gitRevert(
  commits: string | string[],
  options: GitOptions & {
    noCommit?: boolean;
    abort?: boolean;
    continue?: boolean;
    skip?: boolean;
  } = {}
): Promise<GitOperationResult<{ reverted: string[]; conflicts: boolean }>> {
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
    logger.debug('Aborting revert');
    const result = await execGit('revert --abort', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to abort revert',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { reverted: [], conflicts: false },
    };
  }

  // Handle continue
  if (options.continue) {
    logger.debug('Continuing revert');
    const result = await execGit('revert --continue', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to continue revert',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { reverted: [], conflicts: false },
    };
  }

  // Handle skip
  if (options.skip) {
    logger.debug('Skipping revert commit');
    const result = await execGit('revert --skip', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to skip revert',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { reverted: [], conflicts: false },
    };
  }

  const commitList = Array.isArray(commits) ? commits : [commits];

  logger.debug('Reverting commits', { commits: commitList });

  // Build revert command
  const args: string[] = ['revert'];

  if (options.noCommit) {
    args.push('-n');
  }

  args.push(...commitList.map((c) => `"${c}"`));

  const result = await execGit(args.join(' '), { cwd: gitRoot });

  const hasConflicts = result.stderr.includes('CONFLICT') || result.stdout.includes('CONFLICT');

  if (result.exitCode !== 0 && !hasConflicts) {
    if (result.stderr.includes('bad revision')) {
      return {
        success: false,
        error: 'One or more commits not found',
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to revert',
      exitCode: result.exitCode,
    };
  }

  if (hasConflicts) {
    logger.warn('Revert has conflicts');
    return {
      success: true,
      data: { reverted: commitList, conflicts: true },
    };
  }

  logger.info('Revert successful', { commits: commitList });

  return {
    success: true,
    data: { reverted: commitList, conflicts: false },
  };
}

/**
 * Git submodule - manage submodules
 */
export async function gitSubmodule(
  options: GitOptions & {
    init?: boolean;
    update?: boolean;
    add?: { url: string; path: string };
    status?: boolean;
    deinit?: string;
    recursive?: boolean;
  } = {}
): Promise<GitOperationResult<GitSubmoduleInfo[] | { action: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Init submodules
  if (options.init) {
    logger.debug('Initializing submodules');
    const result = await execGit('submodule init', { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to initialize submodules',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'init' },
    };
  }

  // Update submodules
  if (options.update) {
    logger.debug('Updating submodules', { recursive: options.recursive });

    const args: string[] = ['submodule', 'update'];
    if (options.recursive) {
      args.push('--recursive');
    }

    const result = await execGit(args.join(' '), { cwd: gitRoot, timeout: 120000 });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to update submodules',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'update' },
    };
  }

  // Add submodule
  if (options.add) {
    logger.debug('Adding submodule', { url: options.add.url, path: options.add.path });

    const result = await execGit(
      `submodule add "${options.add.url}" "${options.add.path}"`,
      { cwd: gitRoot, timeout: 120000 }
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to add submodule',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'add' },
    };
  }

  // Deinit submodule
  if (options.deinit) {
    logger.debug('Deinitializing submodule', { path: options.deinit });

    const result = await execGit(`submodule deinit "${options.deinit}"`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to deinitialize submodule',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'deinit' },
    };
  }

  // Status (default)
  logger.debug('Getting submodule status');
  const result = await execGit('submodule status', { cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get submodule status',
      exitCode: result.exitCode,
    };
  }

  // Parse submodule status
  const submodules: GitSubmoduleInfo[] = [];
  const lines = result.stdout.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    // Format: <status><commit> <path> (<description>)
    const match = line.match(/^([+\-U ])([a-f0-9]+)\s+(\S+)(?:\s+\((.+)\))?$/);
    if (match) {
      const [, status, commit, subPath] = match;
      submodules.push({
        path: subPath,
        url: '', // Would need config read for URL
        currentCommit: commit,
        initialized: status !== '-',
      });
    }
  }

  return {
    success: true,
    data: submodules,
  };
}

export default {
  gitRebase,
  gitCherryPick,
  gitStash,
  gitReset,
  gitRevert,
  gitSubmodule,
};
