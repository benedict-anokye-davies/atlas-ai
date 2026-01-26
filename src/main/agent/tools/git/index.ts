/**
 * Atlas Desktop - Git Tools Index
 * Provides git operations as agent tools
 */

import { AgentTool, ActionResult } from '../../../../shared/types/agent';
import {
  gitStatus,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitPush,
  gitPull,
  gitBranch,
  gitCheckout,
  gitMerge,
  gitDiff,
  gitLog,
  gitRebase,
  gitCherryPick,
  gitStash,
  gitReset,
  gitRevert,
  gitSubmodule,
  gitTag,
  gitRemote,
  gitFetch,
  gitClone,
  gitInit,
} from './commands';

// Re-export types and utilities
export * from './types';
export * from './utils';
export * from './commands';

/**
 * Git status tool
 */
export const gitStatusTool: AgentTool = {
  name: 'git_status',
  description: 'Get the status of the git working tree, including staged and unstaged changes, untracked files, and branch info.',
  parameters: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Working directory (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitStatus({ cwd: params.cwd as string | undefined });
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  },
};

/**
 * Git add tool
 */
export const gitAddTool: AgentTool = {
  name: 'git_add',
  description: 'Stage files for commit. Use "." or omit files to stage all changes.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Files to stage (default: all changes)',
      },
      all: {
        type: 'boolean',
        description: 'Stage all changes including untracked files',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const files = params.files as string[] | undefined;
    const all = params.all as boolean | undefined;
    const cwd = params.cwd as string | undefined;

    if (all || !files || files.length === 0) {
      const result = await gitAddAll({ cwd });
      return { success: result.success, data: result.data, error: result.error };
    }

    const result = await gitAdd(files, { cwd });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git commit tool
 */
export const gitCommitTool: AgentTool = {
  name: 'git_commit',
  description: 'Create a git commit with a message.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Commit message',
      },
      amend: {
        type: 'boolean',
        description: 'Amend the previous commit',
      },
      allowEmpty: {
        type: 'boolean',
        description: 'Allow empty commits',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['message'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitCommit({
      message: params.message as string,
      amend: params.amend as boolean | undefined,
      allowEmpty: params.allowEmpty as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git push tool
 */
export const gitPushTool: AgentTool = {
  name: 'git_push',
  description: 'Push commits to a remote repository.',
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name (default: origin)',
      },
      branch: {
        type: 'string',
        description: 'Branch to push',
      },
      force: {
        type: 'boolean',
        description: 'Force push (DANGEROUS: overwrites remote history)',
      },
      setUpstream: {
        type: 'boolean',
        description: 'Set upstream tracking',
      },
      tags: {
        type: 'boolean',
        description: 'Push all tags',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitPush({
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
      force: params.force as boolean | undefined,
      setUpstream: params.setUpstream as boolean | undefined,
      tags: params.tags as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git pull tool
 */
export const gitPullTool: AgentTool = {
  name: 'git_pull',
  description: 'Pull changes from a remote repository.',
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name (default: origin)',
      },
      branch: {
        type: 'string',
        description: 'Branch to pull',
      },
      rebase: {
        type: 'boolean',
        description: 'Rebase instead of merge',
      },
      autostash: {
        type: 'boolean',
        description: 'Auto-stash changes before pull',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitPull({
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
      rebase: params.rebase as boolean | undefined,
      autostash: params.autostash as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git branch tool
 */
export const gitBranchTool: AgentTool = {
  name: 'git_branch',
  description: 'List, create, or delete branches.',
  parameters: {
    type: 'object',
    properties: {
      create: {
        type: 'string',
        description: 'Create a new branch with this name',
      },
      delete: {
        type: 'string',
        description: 'Delete this branch',
      },
      forceDelete: {
        type: 'boolean',
        description: 'Force delete even if not merged',
      },
      all: {
        type: 'boolean',
        description: 'Include remote branches in listing',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitBranch({
      create: params.create as string | undefined,
      delete: params.delete as string | undefined,
      forceDelete: params.forceDelete as boolean | undefined,
      all: params.all as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git checkout tool
 */
export const gitCheckoutTool: AgentTool = {
  name: 'git_checkout',
  description: 'Switch branches or restore files.',
  parameters: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description: 'Branch name, commit, or tag to checkout',
      },
      createBranch: {
        type: 'boolean',
        description: 'Create a new branch with the target name',
      },
      files: {
        type: 'array',
        description: 'Restore specific files from target',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['target'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitCheckout(params.target as string, {
      createBranch: params.createBranch as boolean | undefined,
      files: params.files as string[] | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git merge tool
 */
export const gitMergeTool: AgentTool = {
  name: 'git_merge',
  description: 'Merge branches.',
  parameters: {
    type: 'object',
    properties: {
      branch: {
        type: 'string',
        description: 'Branch to merge into current branch',
      },
      noFf: {
        type: 'boolean',
        description: 'Create a merge commit even if fast-forward is possible',
      },
      squash: {
        type: 'boolean',
        description: 'Squash all commits into one',
      },
      message: {
        type: 'string',
        description: 'Custom merge commit message',
      },
      abort: {
        type: 'boolean',
        description: 'Abort the current merge',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['branch'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitMerge({
      branch: params.branch as string,
      noFf: params.noFf as boolean | undefined,
      squash: params.squash as boolean | undefined,
      message: params.message as string | undefined,
      abort: params.abort as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git diff tool
 */
export const gitDiffTool: AgentTool = {
  name: 'git_diff',
  description: 'Show changes between commits, working tree, and index.',
  parameters: {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'Show staged changes',
      },
      commit: {
        type: 'string',
        description: 'Compare with specific commit',
      },
      base: {
        type: 'string',
        description: 'Base commit for comparison (used with commit)',
      },
      files: {
        type: 'array',
        description: 'Limit diff to specific files',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitDiff({
      staged: params.staged as boolean | undefined,
      commit: params.commit as string | undefined,
      base: params.base as string | undefined,
      files: params.files as string[] | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git log tool
 */
export const gitLogTool: AgentTool = {
  name: 'git_log',
  description: 'Show commit history.',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of commits to show (default: 20)',
      },
      branch: {
        type: 'string',
        description: 'Branch to show history for',
      },
      author: {
        type: 'string',
        description: 'Filter by author',
      },
      since: {
        type: 'string',
        description: 'Show commits since date (e.g., "2024-01-01")',
      },
      until: {
        type: 'string',
        description: 'Show commits until date',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitLog({
      count: params.count as number | undefined,
      branch: params.branch as string | undefined,
      author: params.author as string | undefined,
      since: params.since as string | undefined,
      until: params.until as string | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git stash tool
 */
export const gitStashTool: AgentTool = {
  name: 'git_stash',
  description: 'Stash changes in working directory.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Stash message',
      },
      includeUntracked: {
        type: 'boolean',
        description: 'Include untracked files',
      },
      list: {
        type: 'boolean',
        description: 'List all stashes',
      },
      pop: {
        type: 'number',
        description: 'Pop stash at index',
      },
      apply: {
        type: 'number',
        description: 'Apply stash at index without removing',
      },
      drop: {
        type: 'number',
        description: 'Drop stash at index',
      },
      clear: {
        type: 'boolean',
        description: 'Clear all stashes',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitStash({
      message: params.message as string | undefined,
      includeUntracked: params.includeUntracked as boolean | undefined,
      list: params.list as boolean | undefined,
      pop: params.pop as number | undefined,
      apply: params.apply as number | undefined,
      drop: params.drop as number | undefined,
      clear: params.clear as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git reset tool
 */
export const gitResetTool: AgentTool = {
  name: 'git_reset',
  description: 'Reset current HEAD to specified state. Use with caution.',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'Reset mode: soft (keep changes staged), mixed (keep changes unstaged), hard (discard all changes)',
        enum: ['soft', 'mixed', 'hard'],
      },
      to: {
        type: 'string',
        description: 'Commit, branch, or reference to reset to (e.g., "HEAD~1")',
      },
      files: {
        type: 'array',
        description: 'Unstage specific files (ignores mode)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['mode'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitReset({
      mode: params.mode as 'soft' | 'mixed' | 'hard',
      to: params.to as string | undefined,
      files: params.files as string[] | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git rebase tool
 */
export const gitRebaseTool: AgentTool = {
  name: 'git_rebase',
  description: 'Rebase current branch onto another branch or commit.',
  parameters: {
    type: 'object',
    properties: {
      onto: {
        type: 'string',
        description: 'Branch or commit to rebase onto',
      },
      abort: {
        type: 'boolean',
        description: 'Abort current rebase',
      },
      continue: {
        type: 'boolean',
        description: 'Continue after resolving conflicts',
      },
      skip: {
        type: 'boolean',
        description: 'Skip current commit and continue',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['onto'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitRebase({
      onto: params.onto as string,
      abort: params.abort as boolean | undefined,
      continue: params.continue as boolean | undefined,
      skip: params.skip as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git cherry-pick tool
 */
export const gitCherryPickTool: AgentTool = {
  name: 'git_cherry_pick',
  description: 'Apply specific commits to current branch.',
  parameters: {
    type: 'object',
    properties: {
      commits: {
        type: 'array',
        description: 'Commit hashes to cherry-pick',
      },
      noCommit: {
        type: 'boolean',
        description: 'Apply changes without committing',
      },
      abort: {
        type: 'boolean',
        description: 'Abort current cherry-pick',
      },
      continue: {
        type: 'boolean',
        description: 'Continue after resolving conflicts',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['commits'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitCherryPick(params.commits as string[], {
      noCommit: params.noCommit as boolean | undefined,
      abort: params.abort as boolean | undefined,
      continue: params.continue as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git revert tool
 */
export const gitRevertTool: AgentTool = {
  name: 'git_revert',
  description: 'Create commits that undo changes from previous commits.',
  parameters: {
    type: 'object',
    properties: {
      commits: {
        type: 'array',
        description: 'Commit hashes to revert',
      },
      noCommit: {
        type: 'boolean',
        description: 'Stage reverted changes without committing',
      },
      abort: {
        type: 'boolean',
        description: 'Abort current revert',
      },
      continue: {
        type: 'boolean',
        description: 'Continue after resolving conflicts',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: ['commits'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitRevert(params.commits as string[], {
      noCommit: params.noCommit as boolean | undefined,
      abort: params.abort as boolean | undefined,
      continue: params.continue as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git tag tool
 */
export const gitTagTool: AgentTool = {
  name: 'git_tag',
  description: 'List, create, or delete tags.',
  parameters: {
    type: 'object',
    properties: {
      create: {
        type: 'string',
        description: 'Create a new tag with this name',
      },
      delete: {
        type: 'string',
        description: 'Delete this tag',
      },
      message: {
        type: 'string',
        description: 'Tag message (creates annotated tag)',
      },
      commit: {
        type: 'string',
        description: 'Commit to tag (default: HEAD)',
      },
      pattern: {
        type: 'string',
        description: 'Filter tags by pattern',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitTag({
      create: params.create as string | undefined,
      delete: params.delete as string | undefined,
      message: params.message as string | undefined,
      commit: params.commit as string | undefined,
      pattern: params.pattern as string | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git remote tool
 */
export const gitRemoteTool: AgentTool = {
  name: 'git_remote',
  description: 'Manage remote repositories.',
  parameters: {
    type: 'object',
    properties: {
      add: {
        type: 'object',
        description: 'Add remote: { name: string, url: string }',
      },
      remove: {
        type: 'string',
        description: 'Remove remote by name',
      },
      rename: {
        type: 'object',
        description: 'Rename remote: { oldName: string, newName: string }',
      },
      setUrl: {
        type: 'object',
        description: 'Set URL: { name: string, url: string }',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitRemote({
      add: params.add as { name: string; url: string } | undefined,
      remove: params.remove as string | undefined,
      rename: params.rename as { oldName: string; newName: string } | undefined,
      setUrl: params.setUrl as { name: string; url: string } | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git fetch tool
 */
export const gitFetchTool: AgentTool = {
  name: 'git_fetch',
  description: 'Download objects and refs from remote repository.',
  parameters: {
    type: 'object',
    properties: {
      remote: {
        type: 'string',
        description: 'Remote name (default: origin)',
      },
      branch: {
        type: 'string',
        description: 'Specific branch to fetch',
      },
      all: {
        type: 'boolean',
        description: 'Fetch all remotes',
      },
      prune: {
        type: 'boolean',
        description: 'Remove remote-tracking refs that no longer exist',
      },
      tags: {
        type: 'boolean',
        description: 'Fetch all tags',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitFetch({
      remote: params.remote as string | undefined,
      branch: params.branch as string | undefined,
      all: params.all as boolean | undefined,
      prune: params.prune as boolean | undefined,
      tags: params.tags as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git clone tool
 */
export const gitCloneTool: AgentTool = {
  name: 'git_clone',
  description: 'Clone a repository.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Repository URL',
      },
      directory: {
        type: 'string',
        description: 'Target directory (default: repository name)',
      },
      branch: {
        type: 'string',
        description: 'Branch to clone',
      },
      depth: {
        type: 'number',
        description: 'Create shallow clone with history depth',
      },
      recurseSubmodules: {
        type: 'boolean',
        description: 'Clone submodules',
      },
      cwd: {
        type: 'string',
        description: 'Parent directory for clone',
      },
    },
    required: ['url'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitClone({
      url: params.url as string,
      directory: params.directory as string | undefined,
      branch: params.branch as string | undefined,
      depth: params.depth as number | undefined,
      recurseSubmodules: params.recurseSubmodules as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git init tool
 */
export const gitInitTool: AgentTool = {
  name: 'git_init',
  description: 'Initialize a new git repository.',
  parameters: {
    type: 'object',
    properties: {
      bare: {
        type: 'boolean',
        description: 'Create a bare repository',
      },
      initialBranch: {
        type: 'string',
        description: 'Initial branch name (default: default branch from config)',
      },
      cwd: {
        type: 'string',
        description: 'Directory to initialize',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitInit({
      bare: params.bare as boolean | undefined,
      initialBranch: params.initialBranch as string | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Git submodule tool
 */
export const gitSubmoduleTool: AgentTool = {
  name: 'git_submodule',
  description: 'Manage git submodules.',
  parameters: {
    type: 'object',
    properties: {
      init: {
        type: 'boolean',
        description: 'Initialize submodules',
      },
      update: {
        type: 'boolean',
        description: 'Update submodules',
      },
      add: {
        type: 'object',
        description: 'Add submodule: { url: string, path: string }',
      },
      deinit: {
        type: 'string',
        description: 'Deinitialize submodule by path',
      },
      recursive: {
        type: 'boolean',
        description: 'Apply operation recursively',
      },
      cwd: {
        type: 'string',
        description: 'Working directory',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const result = await gitSubmodule({
      init: params.init as boolean | undefined,
      update: params.update as boolean | undefined,
      add: params.add as { url: string; path: string } | undefined,
      deinit: params.deinit as string | undefined,
      recursive: params.recursive as boolean | undefined,
      cwd: params.cwd as string | undefined,
    });
    return { success: result.success, data: result.data, error: result.error };
  },
};

/**
 * Get all git tools
 */
export function getGitTools(): AgentTool[] {
  return [
    gitStatusTool,
    gitAddTool,
    gitCommitTool,
    gitPushTool,
    gitPullTool,
    gitBranchTool,
    gitCheckoutTool,
    gitMergeTool,
    gitDiffTool,
    gitLogTool,
    gitStashTool,
    gitResetTool,
    gitRebaseTool,
    gitCherryPickTool,
    gitRevertTool,
    gitTagTool,
    gitRemoteTool,
    gitFetchTool,
    gitCloneTool,
    gitInitTool,
    gitSubmoduleTool,
  ];
}

export default {
  getGitTools,
  gitStatusTool,
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitPullTool,
  gitBranchTool,
  gitCheckoutTool,
  gitMergeTool,
  gitDiffTool,
  gitLogTool,
  gitStashTool,
  gitResetTool,
  gitRebaseTool,
  gitCherryPickTool,
  gitRevertTool,
  gitTagTool,
  gitRemoteTool,
  gitFetchTool,
  gitCloneTool,
  gitInitTool,
  gitSubmoduleTool,
};
