/**
 * Nova Desktop - Git Repository Commands
 * Implements: tag, remote, fetch, clone, init
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  GitOptions,
  GitCloneOptions,
  GitOperationResult,
  GitTagInfo,
  GitRemoteInfo,
} from '../types';
import { parseGitTags, parseGitRemotes, parseGitTagRefs } from '../utils/parser';
import { findGitRoot, isGitRepository, validateRemoteUrl } from '../utils/validator';
import { createModuleLogger } from '../../../../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('GitRepository');

const DEFAULT_TIMEOUT = 30000;
const CLONE_TIMEOUT = 300000; // 5 minutes for clone
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
 * Git tag - manage tags
 */
export async function gitTag(
  options: GitOptions & {
    create?: string;
    delete?: string;
    message?: string;
    annotated?: boolean;
    commit?: string;
    list?: boolean;
    pattern?: string;
  } = {}
): Promise<GitOperationResult<GitTagInfo[] | { created?: string; deleted?: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Create tag
  if (options.create) {
    logger.debug('Creating tag', {
      name: options.create,
      annotated: options.annotated,
      commit: options.commit,
    });

    const args: string[] = ['tag'];

    if (options.annotated || options.message) {
      args.push('-a');
      if (options.message) {
        args.push('-m', `"${options.message.replace(/"/g, '\\"')}"`);
      }
    }

    args.push(`"${options.create}"`);

    if (options.commit) {
      args.push(`"${options.commit}"`);
    }

    const result = await execGit(args.join(' '), { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('already exists')) {
        return {
          success: false,
          error: `Tag '${options.create}' already exists`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to create tag',
        exitCode: result.exitCode,
      };
    }

    logger.info('Tag created', { name: options.create });

    return {
      success: true,
      data: { created: options.create },
    };
  }

  // Delete tag
  if (options.delete) {
    logger.debug('Deleting tag', { name: options.delete });

    const result = await execGit(`tag -d "${options.delete}"`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('not found')) {
        return {
          success: false,
          error: `Tag '${options.delete}' not found`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to delete tag',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { deleted: options.delete },
    };
  }

  // List tags
  logger.debug('Listing tags', { pattern: options.pattern });

  const listArgs = options.pattern ? `tag -l "${options.pattern}"` : 'tag -l';
  const listResult = await execGit(listArgs, { cwd: gitRoot });

  if (listResult.exitCode !== 0) {
    return {
      success: false,
      error: listResult.stderr || 'Failed to list tags',
      exitCode: listResult.exitCode,
    };
  }

  const tags = parseGitTags(listResult.stdout);

  // Get tag hashes
  const refResult = await execGit('show-ref --tags', { cwd: gitRoot });
  if (refResult.exitCode === 0) {
    const refs = parseGitTagRefs(refResult.stdout);
    for (const tag of tags) {
      tag.hash = refs.get(tag.name) || '';
    }
  }

  return {
    success: true,
    data: tags,
  };
}

/**
 * Git remote - manage remotes
 */
export async function gitRemote(
  options: GitOptions & {
    add?: { name: string; url: string };
    remove?: string;
    rename?: { oldName: string; newName: string };
    setUrl?: { name: string; url: string };
    show?: string;
    verbose?: boolean;
  } = {}
): Promise<GitOperationResult<GitRemoteInfo[] | { action: string; name?: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  // Add remote
  if (options.add) {
    const validation = validateRemoteUrl(options.add.url);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid remote URL',
      };
    }

    logger.debug('Adding remote', { name: options.add.name, url: options.add.url });

    const result = await execGit(`remote add "${options.add.name}" "${options.add.url}"`, {
      cwd: gitRoot,
    });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('already exists')) {
        return {
          success: false,
          error: `Remote '${options.add.name}' already exists`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to add remote',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'add', name: options.add.name },
    };
  }

  // Remove remote
  if (options.remove) {
    logger.debug('Removing remote', { name: options.remove });

    const result = await execGit(`remote remove "${options.remove}"`, { cwd: gitRoot });

    if (result.exitCode !== 0) {
      if (result.stderr.includes('No such remote')) {
        return {
          success: false,
          error: `Remote '${options.remove}' not found`,
          exitCode: result.exitCode,
        };
      }
      return {
        success: false,
        error: result.stderr || 'Failed to remove remote',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'remove', name: options.remove },
    };
  }

  // Rename remote
  if (options.rename) {
    logger.debug('Renaming remote', options.rename);

    const result = await execGit(
      `remote rename "${options.rename.oldName}" "${options.rename.newName}"`,
      { cwd: gitRoot }
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to rename remote',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'rename', name: options.rename.newName },
    };
  }

  // Set URL
  if (options.setUrl) {
    const validation = validateRemoteUrl(options.setUrl.url);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || 'Invalid remote URL',
      };
    }

    logger.debug('Setting remote URL', options.setUrl);

    const result = await execGit(
      `remote set-url "${options.setUrl.name}" "${options.setUrl.url}"`,
      { cwd: gitRoot }
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to set remote URL',
        exitCode: result.exitCode,
      };
    }

    return {
      success: true,
      data: { action: 'set-url', name: options.setUrl.name },
    };
  }

  // List remotes (default)
  logger.debug('Listing remotes');

  const result = await execGit('remote -v', { cwd: gitRoot });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to list remotes',
      exitCode: result.exitCode,
    };
  }

  const remotes = parseGitRemotes(result.stdout);

  return {
    success: true,
    data: remotes,
  };
}

/**
 * Git fetch - fetch from remote
 */
export async function gitFetch(
  options: GitOptions & {
    remote?: string;
    branch?: string;
    all?: boolean;
    prune?: boolean;
    tags?: boolean;
  } = {}
): Promise<GitOperationResult<{ fetched: boolean; remote: string }>> {
  const cwd = options.cwd || process.cwd();

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      error: 'Not a git repository',
    };
  }

  const remote = options.remote || 'origin';

  logger.debug('Fetching', { remote, all: options.all, prune: options.prune });

  const args: string[] = ['fetch'];

  if (options.all) {
    args.push('--all');
  } else {
    args.push(remote);
    if (options.branch) {
      args.push(options.branch);
    }
  }

  if (options.prune) {
    args.push('--prune');
  }

  if (options.tags) {
    args.push('--tags');
  }

  const result = await execGit(args.join(' '), { cwd: gitRoot, timeout: 60000 });

  if (result.exitCode !== 0) {
    if (result.stderr.includes("couldn't find remote ref")) {
      return {
        success: false,
        error: `Remote ref '${options.branch}' not found`,
        exitCode: result.exitCode,
      };
    }
    if (result.stderr.includes('Could not read from remote')) {
      return {
        success: false,
        error: 'Could not connect to remote. Check your network or credentials.',
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to fetch',
      exitCode: result.exitCode,
    };
  }

  logger.info('Fetch successful', { remote });

  return {
    success: true,
    data: { fetched: true, remote: options.all ? 'all' : remote },
  };
}

/**
 * Git clone - clone a repository
 */
export async function gitClone(
  options: GitCloneOptions
): Promise<GitOperationResult<{ cloned: boolean; directory: string }>> {
  const cwd = options.cwd || process.cwd();

  // Validate URL
  const validation = validateRemoteUrl(options.url);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid repository URL',
    };
  }

  // Determine target directory
  let targetDir = options.directory;
  if (!targetDir) {
    // Extract repo name from URL
    const urlParts = options.url.split('/');
    let repoName = urlParts[urlParts.length - 1];
    repoName = repoName.replace(/\.git$/, '');
    targetDir = path.join(cwd, repoName);
  } else if (!path.isAbsolute(targetDir)) {
    targetDir = path.join(cwd, targetDir);
  }

  // Check if directory already exists
  try {
    await fs.access(targetDir);
    return {
      success: false,
      error: `Directory '${targetDir}' already exists`,
    };
  } catch {
    // Directory doesn't exist, good
  }

  logger.debug('Cloning repository', {
    url: options.url,
    directory: targetDir,
    branch: options.branch,
    depth: options.depth,
  });

  const args: string[] = ['clone'];

  if (options.branch) {
    args.push('-b', `"${options.branch}"`);
  }

  if (options.depth) {
    args.push('--depth', String(options.depth));
  }

  if (options.recurseSubmodules) {
    args.push('--recurse-submodules');
  }

  args.push(`"${options.url}"`);
  args.push(`"${targetDir}"`);

  const result = await execGit(args.join(' '), { cwd, timeout: CLONE_TIMEOUT });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('Repository not found')) {
      return {
        success: false,
        error: 'Repository not found. Check the URL.',
        exitCode: result.exitCode,
      };
    }
    if (result.stderr.includes('Authentication failed')) {
      return {
        success: false,
        error: 'Authentication failed. Check your credentials.',
        exitCode: result.exitCode,
      };
    }
    return {
      success: false,
      error: result.stderr || 'Failed to clone repository',
      exitCode: result.exitCode,
    };
  }

  logger.info('Clone successful', { directory: targetDir });

  return {
    success: true,
    data: { cloned: true, directory: targetDir },
  };
}

/**
 * Git init - initialize a new repository
 */
export async function gitInit(
  options: GitOptions & {
    bare?: boolean;
    initialBranch?: string;
  } = {}
): Promise<GitOperationResult<{ initialized: boolean; directory: string }>> {
  const cwd = options.cwd || process.cwd();

  // Check if already a git repository
  if (await isGitRepository(cwd)) {
    return {
      success: false,
      error: 'Already a git repository',
    };
  }

  logger.debug('Initializing repository', { cwd, bare: options.bare });

  const args: string[] = ['init'];

  if (options.bare) {
    args.push('--bare');
  }

  if (options.initialBranch) {
    args.push('-b', `"${options.initialBranch}"`);
  }

  const result = await execGit(args.join(' '), { cwd });

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr || 'Failed to initialize repository',
      exitCode: result.exitCode,
    };
  }

  logger.info('Repository initialized', { directory: cwd });

  return {
    success: true,
    data: { initialized: true, directory: cwd },
  };
}

export default {
  gitTag,
  gitRemote,
  gitFetch,
  gitClone,
  gitInit,
};
