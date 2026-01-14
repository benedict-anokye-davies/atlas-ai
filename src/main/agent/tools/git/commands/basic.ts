/**
 * Nova Desktop - Basic Git Commands
 * Implements: status, add, commit, push, pull
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import {
  GitStatusResult,
  GitOptions,
  GitCommitOptions,
  GitPushOptions,
  GitPullOptions,
  GitOperationResult,
} from '../types';
import { parseGitStatus } from '../utils/parser';
import {
  isGitRepository,
  findGitRoot,
  validateCommitMessage,
  validatePushOperation,
} from '../utils/validator';
import { createModuleLogger } from '../../../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('GitBasic');

const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT = 1024 * 1024; // 1MB

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
 * Git status - show working tree status
 */
export async function gitStatus(options: GitOptions = {}): Promise<GitOperationResult<GitStatusResult>> {
  const cwd = options.cwd || process.cwd();

  // Check if in git repository
  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository (or any of the parent directories)',
    };
  }

  logger.debug('Getting git status', { cwd: gitRoot });

  const result = await execGit('status --porcelain=v2 --branch', { ...options, cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to get git status',
      exitCode: result.exitCode,
    };
  }

  const status = parseGitStatus(result.stdout);

  return {
    success: true,
    data: status,
  };
}

/**
 * Git add - stage files for commit
 */
export async function gitAdd(
  files: string | string[],
  options: GitOptions = {}
): Promise<GitOperationResult<{ staged: string[] }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  const fileList = Array.isArray(files) ? files : [files];

  // Validate and normalize paths
  const normalizedFiles = fileList.map((f) => {
    // If path is absolute, make it relative to git root
    if (path.isAbsolute(f)) {
      return path.relative(gitRoot, f);
    }
    return f;
  });

  logger.debug('Staging files', { files: normalizedFiles });

  // Use -- to separate files from options
  const filesArg = normalizedFiles.map((f) => `"${f}"`).join(' ');
  const result = await execGit(`add -- ${filesArg}`, { ...options, cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to stage files',
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    success: true,
    data: { staged: normalizedFiles },
  };
}

/**
 * Git add all - stage all changes
 */
export async function gitAddAll(options: GitOptions = {}): Promise<GitOperationResult<{ staged: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  logger.debug('Staging all changes');

  const result = await execGit('add -A', { ...options, cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to stage all changes',
      exitCode: result.exitCode,
    };
  }

  return {
    success: true,
    data: { staged: 'all' },
  };
}

/**
 * Git commit - create a commit
 */
export async function gitCommit(
  options: GitCommitOptions
): Promise<GitOperationResult<{ hash: string; message: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Validate commit message
  const validation = validateCommitMessage(options.message);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid commit message',
    };
  }

  logger.debug('Creating commit', { amend: options.amend });

  // Build commit command
  const args: string[] = ['commit'];

  // Escape the message for command line
  const escapedMessage = options.message.replace(/"/g, '\\"');
  args.push('-m', `"${escapedMessage}"`);

  if (options.amend) {
    args.push('--amend');
  }

  if (options.allowEmpty) {
    args.push('--allow-empty');
  }

  if (options.sign) {
    args.push('-S');
  }

  if (options.author) {
    args.push('--author', `"${options.author}"`);
  }

  const result = await execGit(args.join(' '), { ...options, cwd: gitRoot });

  if (result.exitCode !== 0) {
    // Check for common errors
    if (result.stderr.includes('nothing to commit')) {
      return {
        success: false,
        error: 'Nothing to commit. Stage changes with git add first.',
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    if (result.stderr.includes('empty commit message')) {
      return {
        success: false,
        error: 'Commit message cannot be empty',
        exitCode: result.exitCode,
      };
    }

    return {
      success: false,
      error: result.stderr || 'Failed to create commit',
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  // Get the commit hash
  const hashResult = await execGit('rev-parse HEAD', { cwd: gitRoot });
  const hash = hashResult.stdout.trim();

  logger.info('Commit created', { hash: hash.substring(0, 7) });

  return {
    success: true,
    data: {
      hash,
      message: options.message,
    },
  };
}

/**
 * Git push - push to remote
 */
export async function gitPush(
  options: GitPushOptions = {}
): Promise<GitOperationResult<{ remote: string; branch: string; pushed: boolean }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Validate push operation
  const validation = validatePushOperation(options);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid push operation',
    };
  }

  // Log warnings
  for (const warning of validation.warnings) {
    logger.warn('Push warning', { warning });
  }

  const remote = options.remote || 'origin';
  const branch = options.branch || '';

  logger.debug('Pushing to remote', { remote, branch, force: options.force });

  // Build push command
  const args: string[] = ['push'];

  if (options.setUpstream) {
    args.push('-u');
  }

  if (options.force) {
    args.push('--force');
  }

  if (options.tags) {
    args.push('--tags');
  }

  args.push(remote);

  if (branch) {
    args.push(branch);
  }

  const result = await execGit(args.join(' '), { ...options, cwd: gitRoot, timeout: 60000 });

  if (result.exitCode !== 0) {
    // Check for common errors
    if (result.stderr.includes('no upstream branch')) {
      return {
        success: false,
        error: 'No upstream branch configured. Use setUpstream: true or specify a branch.',
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    if (result.stderr.includes('rejected')) {
      return {
        success: false,
        error: 'Push rejected. Remote contains commits not in local branch. Pull first or use force.',
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    if (result.stderr.includes('Authentication failed')) {
      return {
        success: false,
        error: 'Authentication failed. Check your credentials.',
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    return {
      success: false,
      error: result.stderr || 'Failed to push',
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  logger.info('Push successful', { remote, branch });

  return {
    success: true,
    data: {
      remote,
      branch: branch || 'current',
      pushed: true,
    },
  };
}

/**
 * Git pull - pull from remote
 */
export async function gitPull(
  options: GitPullOptions = {}
): Promise<GitOperationResult<{ remote: string; branch: string; updated: boolean; conflicts: boolean }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  const remote = options.remote || 'origin';
  const branch = options.branch || '';

  logger.debug('Pulling from remote', { remote, branch, rebase: options.rebase });

  // Build pull command
  const args: string[] = ['pull'];

  if (options.rebase) {
    args.push('--rebase');
  }

  if (options.autostash) {
    args.push('--autostash');
  }

  args.push(remote);

  if (branch) {
    args.push(branch);
  }

  const result = await execGit(args.join(' '), { ...options, cwd: gitRoot, timeout: 60000 });

  // Check for conflicts (exit code 1 but with specific message)
  const hasConflicts =
    result.stderr.includes('CONFLICT') || result.stdout.includes('Automatic merge failed');

  if (result.exitCode !== 0 && !hasConflicts) {
    if (result.stderr.includes('not a git repository')) {
      return {
        success: false,
        error: 'Not a git repository',
        exitCode: result.exitCode,
      };
    }

    if (result.stderr.includes("couldn't find remote ref")) {
      return {
        success: false,
        error: `Remote branch '${branch}' not found`,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    if (result.stderr.includes('You have unstaged changes')) {
      return {
        success: false,
        error: 'You have unstaged changes. Commit or stash them first.',
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    }

    return {
      success: false,
      error: result.stderr || 'Failed to pull',
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  // Determine if anything was updated
  const alreadyUpToDate =
    result.stdout.includes('Already up to date') || result.stdout.includes('Already up-to-date');

  if (hasConflicts) {
    logger.warn('Pull completed with conflicts');
  } else {
    logger.info('Pull successful', { remote, branch, updated: !alreadyUpToDate });
  }

  return {
    success: true,
    data: {
      remote,
      branch: branch || 'current',
      updated: !alreadyUpToDate,
      conflicts: hasConflicts,
    },
  };
}

export default {
  gitStatus,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitPush,
  gitPull,
};
