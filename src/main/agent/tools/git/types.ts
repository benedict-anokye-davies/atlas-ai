/**
 * Nova Desktop - Git Tool Types
 * Type definitions for git operations
 */

/**
 * Git operation categories
 */
export type GitOperation =
  | 'status'
  | 'add'
  | 'commit'
  | 'push'
  | 'pull'
  | 'branch'
  | 'checkout'
  | 'merge'
  | 'diff'
  | 'log'
  | 'rebase'
  | 'cherry-pick'
  | 'stash'
  | 'reset'
  | 'revert'
  | 'tag'
  | 'remote'
  | 'fetch'
  | 'clone'
  | 'init'
  | 'submodule';

/**
 * Git file status
 */
export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unmerged';

/**
 * Git status file entry
 */
export interface GitStatusFile {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  oldPath?: string; // For renames
}

/**
 * Git status result
 */
export interface GitStatusResult {
  branch: string;
  tracking?: string;
  ahead: number;
  behind: number;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  untracked: string[];
  conflicts: string[];
  clean: boolean;
}

/**
 * Git commit info
 */
export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  subject: string;
  body?: string;
}

/**
 * Git log result
 */
export interface GitLogResult {
  commits: GitCommitInfo[];
  total: number;
  branch: string;
}

/**
 * Git diff entry
 */
export interface GitDiffEntry {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  binary: boolean;
  hunks?: GitDiffHunk[];
}

/**
 * Git diff hunk
 */
export interface GitDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

/**
 * Git diff result
 */
export interface GitDiffResult {
  files: GitDiffEntry[];
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
}

/**
 * Git branch info
 */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  tracking?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
}

/**
 * Git branch list result
 */
export interface GitBranchListResult {
  current: string;
  local: GitBranchInfo[];
  remote: GitBranchInfo[];
}

/**
 * Git remote info
 */
export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/**
 * Git stash entry
 */
export interface GitStashEntry {
  index: number;
  message: string;
  branch: string;
  date: string;
}

/**
 * Git tag info
 */
export interface GitTagInfo {
  name: string;
  hash: string;
  message?: string;
  tagger?: string;
  date?: string;
  annotated: boolean;
}

/**
 * Git submodule info
 */
export interface GitSubmoduleInfo {
  path: string;
  url: string;
  branch?: string;
  currentCommit: string;
  initialized: boolean;
}

/**
 * Git operation options
 */
export interface GitOptions {
  /** Working directory for git operations */
  cwd?: string;
  /** Timeout for operations in ms (default: 30000) */
  timeout?: number;
}

/**
 * Git commit options
 */
export interface GitCommitOptions extends GitOptions {
  /** Commit message */
  message: string;
  /** Amend previous commit */
  amend?: boolean;
  /** Allow empty commit */
  allowEmpty?: boolean;
  /** Sign commit with GPG */
  sign?: boolean;
  /** Author name */
  author?: string;
}

/**
 * Git push options
 */
export interface GitPushOptions extends GitOptions {
  /** Remote name (default: origin) */
  remote?: string;
  /** Branch name */
  branch?: string;
  /** Force push */
  force?: boolean;
  /** Set upstream tracking */
  setUpstream?: boolean;
  /** Push tags */
  tags?: boolean;
}

/**
 * Git pull options
 */
export interface GitPullOptions extends GitOptions {
  /** Remote name (default: origin) */
  remote?: string;
  /** Branch name */
  branch?: string;
  /** Rebase instead of merge */
  rebase?: boolean;
  /** Auto-stash changes */
  autostash?: boolean;
}

/**
 * Git merge options
 */
export interface GitMergeOptions extends GitOptions {
  /** Branch to merge */
  branch: string;
  /** No fast-forward merge */
  noFf?: boolean;
  /** Squash commits */
  squash?: boolean;
  /** Merge message */
  message?: string;
  /** Abort merge */
  abort?: boolean;
}

/**
 * Git rebase options
 */
export interface GitRebaseOptions extends GitOptions {
  /** Branch or commit to rebase onto */
  onto: string;
  /** Interactive rebase */
  interactive?: boolean;
  /** Abort rebase */
  abort?: boolean;
  /** Continue rebase */
  continue?: boolean;
  /** Skip current commit */
  skip?: boolean;
}

/**
 * Git reset options
 */
export interface GitResetOptions extends GitOptions {
  /** Reset mode */
  mode: 'soft' | 'mixed' | 'hard';
  /** Commit or reference to reset to */
  to?: string;
  /** Files to reset (unstage) */
  files?: string[];
}

/**
 * Git stash options
 */
export interface GitStashOptions extends GitOptions {
  /** Stash message */
  message?: string;
  /** Include untracked files */
  includeUntracked?: boolean;
  /** Keep staged files */
  keepIndex?: boolean;
}

/**
 * Git clone options
 */
export interface GitCloneOptions extends GitOptions {
  /** Repository URL */
  url: string;
  /** Target directory */
  directory?: string;
  /** Branch to clone */
  branch?: string;
  /** Shallow clone depth */
  depth?: number;
  /** Clone submodules */
  recurseSubmodules?: boolean;
}

/**
 * Git operation result
 */
export interface GitOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stderr?: string;
  exitCode?: number;
}
