/**
 * Atlas Desktop - Git History Explorer Tool
 *
 * Provides visual git history exploration with commit graph, branch navigation,
 * filtering, and checkout/cherry-pick capabilities.
 *
 * @module agent/tools/git-history
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitHistoryTool');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB for larger history

// ============================================================================
// Git History Types
// ============================================================================

/**
 * Represents a single commit in the history
 */
export interface GitCommitInfo {
  /** Full commit SHA */
  sha: string;
  /** Short commit SHA (7 chars) */
  shortSha: string;
  /** Commit message subject (first line) */
  subject: string;
  /** Full commit message body */
  body?: string;
  /** Author name */
  author: string;
  /** Author email */
  authorEmail: string;
  /** Author date (ISO format) */
  authorDate: string;
  /** Committer name */
  committer: string;
  /** Committer email */
  committerEmail: string;
  /** Commit date (ISO format) */
  commitDate: string;
  /** Parent commit SHAs */
  parents: string[];
  /** Branch names pointing to this commit */
  branches: string[];
  /** Tag names pointing to this commit */
  tags: string[];
  /** Whether this is a merge commit */
  isMerge: boolean;
  /** Files changed in this commit */
  filesChanged?: number;
  /** Lines added */
  insertions?: number;
  /** Lines deleted */
  deletions?: number;
}

/**
 * Represents a visual graph node for commit visualization
 */
export interface GitGraphNode {
  /** Commit SHA */
  sha: string;
  /** Column position in graph (0-based) */
  column: number;
  /** Row position (0 = most recent) */
  row: number;
  /** Colors for graph lines */
  colors: string[];
  /** Connecting lines to parent commits */
  lines: GitGraphLine[];
}

/**
 * Represents a line connecting commits in the graph
 */
export interface GitGraphLine {
  /** Start column */
  fromColumn: number;
  /** End column */
  toColumn: number;
  /** Parent SHA this line connects to */
  parentSha: string;
  /** Line color */
  color: string;
}

/**
 * Result of git history query
 */
export interface GitHistoryResult {
  /** Commits in the history */
  commits: GitCommitInfo[];
  /** Total count of matching commits */
  totalCount: number;
  /** Graph visualization data */
  graph?: GitGraphNode[];
  /** Current branch */
  currentBranch: string;
  /** Available branches for filtering */
  branches: string[];
  /** Pagination info */
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Filter options for history queries
 */
export interface GitHistoryFilter {
  /** Branch to show history for */
  branch?: string;
  /** Filter by author name or email */
  author?: string;
  /** Filter commits after this date */
  since?: string;
  /** Filter commits before this date */
  until?: string;
  /** Search in commit messages */
  messagePattern?: string;
  /** Filter by file path */
  filePath?: string;
  /** Number of commits to retrieve */
  limit?: number;
  /** Skip this many commits (pagination) */
  skip?: number;
  /** Include merge commits */
  includeMerges?: boolean;
  /** Only show first-parent commits */
  firstParent?: boolean;
}

/**
 * Result of commit diff operation
 */
export interface GitCommitDiff {
  /** Commit SHA */
  sha: string;
  /** Files changed */
  files: GitDiffFile[];
  /** Total stats */
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  /** Raw diff output */
  rawDiff?: string;
}

/**
 * File change in a commit diff
 */
export interface GitDiffFile {
  /** File path */
  path: string;
  /** Old path (for renames) */
  oldPath?: string;
  /** Change type */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Binary file indicator */
  isBinary: boolean;
  /** Diff hunks */
  hunks?: GitDiffHunk[];
}

/**
 * Diff hunk
 */
export interface GitDiffHunk {
  /** Old file start line */
  oldStart: number;
  /** Old file line count */
  oldLines: number;
  /** New file start line */
  newStart: number;
  /** New file line count */
  newLines: number;
  /** Hunk header */
  header: string;
  /** Diff lines */
  lines: GitDiffLine[];
}

/**
 * Single diff line
 */
export interface GitDiffLine {
  /** Line type */
  type: 'context' | 'addition' | 'deletion';
  /** Line content */
  content: string;
  /** Old line number */
  oldLineNo?: number;
  /** New line number */
  newLineNo?: number;
}

/**
 * Branch comparison result
 */
export interface GitBranchComparison {
  /** Base branch */
  baseBranch: string;
  /** Compare branch */
  compareBranch: string;
  /** Common ancestor commit */
  mergeBase: string;
  /** Commits ahead of base */
  ahead: GitCommitInfo[];
  /** Commits behind base */
  behind: GitCommitInfo[];
  /** Files with differences */
  diffFiles: GitDiffFile[];
  /** Summary stats */
  stats: {
    aheadCount: number;
    behindCount: number;
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
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
 * Parse commit info from git log output
 */
function parseCommitInfo(logOutput: string): GitCommitInfo[] {
  // Format: SHA|SHORT|AUTHOR|EMAIL|DATE|COMMITTER|CEMAIL|CDATE|PARENTS|SUBJECT|BODY
  const commits: GitCommitInfo[] = [];
  const entries = logOutput.split('\x00').filter((e) => e.trim());

  for (const entry of entries) {
    const parts = entry.split('\x1f');
    if (parts.length < 10) continue;

    const [
      sha,
      shortSha,
      author,
      authorEmail,
      authorDate,
      committer,
      committerEmail,
      commitDate,
      parentsStr,
      subject,
      ...bodyParts
    ] = parts;
    const parents = parentsStr.split(' ').filter((p) => p.trim());

    commits.push({
      sha,
      shortSha,
      author,
      authorEmail,
      authorDate,
      committer,
      committerEmail,
      commitDate,
      parents,
      subject,
      body: bodyParts.join('\x1f').trim() || undefined,
      branches: [],
      tags: [],
      isMerge: parents.length > 1,
    });
  }

  return commits;
}

/**
 * Get refs (branches and tags) for commits
 */
async function getCommitRefs(
  shas: string[],
  cwd?: string
): Promise<Map<string, { branches: string[]; tags: string[] }>> {
  const refMap = new Map<string, { branches: string[]; tags: string[] }>();

  // Initialize all shas
  for (const sha of shas) {
    refMap.set(sha, { branches: [], tags: [] });
  }

  // Get branches
  const branchResult = await executeGitCommand(
    ['branch', '-a', '--contains', '--format=%(objectname)|%(refname:short)'],
    cwd
  );

  if (branchResult.success) {
    const lines = branchResult.stdout.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const [sha, branch] = line.split('|');
      if (sha && branch && refMap.has(sha)) {
        const refs = refMap.get(sha)!;
        refs.branches.push(branch);
      }
    }
  }

  // Get tags
  const tagResult = await executeGitCommand(
    ['tag', '--format=%(objectname)|%(refname:short)'],
    cwd
  );

  if (tagResult.success) {
    const lines = tagResult.stdout.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const [sha, tag] = line.split('|');
      if (sha && tag && refMap.has(sha)) {
        const refs = refMap.get(sha)!;
        refs.tags.push(tag);
      }
    }
  }

  return refMap;
}

/**
 * Build graph visualization data
 */
function buildGraphData(commits: GitCommitInfo[]): GitGraphNode[] {
  const graphNodes: GitGraphNode[] = [];
  const colors = [
    '#f97316', // orange
    '#3b82f6', // blue
    '#10b981', // green
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f59e0b', // amber
    '#6366f1', // indigo
  ];

  // Track active branches (columns)
  const activeColumns: Map<string, number> = new Map();
  let nextColumn = 0;

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    // Get or assign column for this commit
    let column = activeColumns.get(commit.sha);
    if (column === undefined) {
      column = nextColumn++;
      activeColumns.set(commit.sha, column);
    }

    const lines: GitGraphLine[] = [];

    // Process parent connections
    for (let i = 0; i < commit.parents.length; i++) {
      const parentSha = commit.parents[i];
      let parentColumn = activeColumns.get(parentSha);

      if (parentColumn === undefined) {
        // Parent not yet assigned, give it a column
        if (i === 0) {
          // First parent continues in same column
          parentColumn = column;
        } else {
          // Merge parent gets new column
          parentColumn = nextColumn++;
        }
        activeColumns.set(parentSha, parentColumn);
      }

      lines.push({
        fromColumn: column,
        toColumn: parentColumn,
        parentSha,
        color: colors[parentColumn % colors.length],
      });
    }

    // Remove this commit from active columns (it's been processed)
    activeColumns.delete(commit.sha);

    graphNodes.push({
      sha: commit.sha,
      column,
      row,
      colors: [colors[column % colors.length]],
      lines,
    });
  }

  return graphNodes;
}

/**
 * Parse diff output into structured format
 */
function parseDiff(diffOutput: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  const fileRegex = /diff --git a\/(.*?) b\/(.*?)\n/g;
  // statsRegex used for hunk parsing if needed in future
  // const statsRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/;

  let match;
  let lastIndex = 0;

  while ((match = fileRegex.exec(diffOutput)) !== null) {
    if (files.length > 0) {
      // Parse previous file's content
      const prevContent = diffOutput.substring(lastIndex, match.index);
      parseFileContent(files[files.length - 1], prevContent);
    }

    const oldPath = match[1];
    const newPath = match[2];

    // Determine status from subsequent lines
    const nextSection = diffOutput.substring(
      match.index,
      diffOutput.indexOf('\ndiff --git', match.index + 1) || undefined
    );
    let status: GitDiffFile['status'] = 'modified';

    if (nextSection.includes('new file mode')) {
      status = 'added';
    } else if (nextSection.includes('deleted file mode')) {
      status = 'deleted';
    } else if (nextSection.includes('rename from')) {
      status = 'renamed';
    } else if (nextSection.includes('copy from')) {
      status = 'copied';
    }

    files.push({
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      status,
      additions: 0,
      deletions: 0,
      isBinary: nextSection.includes('Binary files'),
      hunks: [],
    });

    lastIndex = match.index;
  }

  // Parse last file
  if (files.length > 0) {
    parseFileContent(files[files.length - 1], diffOutput.substring(lastIndex));
  }

  return files;
}

/**
 * Parse file diff content
 */
function parseFileContent(file: GitDiffFile, content: string): void {
  const lines = content.split('\n');
  let currentHunk: GitDiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    // Hunk header
    const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
    if (hunkMatch) {
      if (currentHunk) {
        file.hunks!.push(currentHunk);
      }
      oldLineNo = parseInt(hunkMatch[1], 10);
      newLineNo = parseInt(hunkMatch[3], 10);
      currentHunk = {
        oldStart: oldLineNo,
        oldLines: parseInt(hunkMatch[2] || '1', 10),
        newStart: newLineNo,
        newLines: parseInt(hunkMatch[4] || '1', 10),
        header: hunkMatch[5]?.trim() || '',
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'addition',
        content: line.substring(1),
        newLineNo: newLineNo++,
      });
      file.additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.substring(1),
        oldLineNo: oldLineNo++,
      });
      file.deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.substring(1),
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
      });
    }
  }

  if (currentHunk) {
    file.hunks!.push(currentHunk);
  }
}

// ============================================================================
// Git History Tools
// ============================================================================

/**
 * Get git commit history with filtering and graph visualization
 */
export const gitHistoryTool: AgentTool = {
  name: 'git_history',
  description:
    'Get git commit history with visual graph, filtering by author, date, message, and branch. ' +
    'Supports voice commands like "Show last 10 commits", "Show commits by John", "Show commits from last week".',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of commits to show (default: 20, max: 500)',
      },
      skip: {
        type: 'number',
        description: 'Number of commits to skip for pagination',
      },
      branch: {
        type: 'string',
        description: 'Branch to show history for (default: current branch)',
      },
      author: {
        type: 'string',
        description: 'Filter by author name or email',
      },
      since: {
        type: 'string',
        description: 'Show commits after date (e.g., "2024-01-01", "1 week ago", "yesterday")',
      },
      until: {
        type: 'string',
        description: 'Show commits before date',
      },
      messagePattern: {
        type: 'string',
        description: 'Search pattern for commit messages',
      },
      filePath: {
        type: 'string',
        description: 'Show history for specific file or directory',
      },
      includeMerges: {
        type: 'boolean',
        description: 'Include merge commits (default: true)',
      },
      firstParent: {
        type: 'boolean',
        description: 'Only follow first parent (linear history)',
      },
      includeGraph: {
        type: 'boolean',
        description: 'Include graph visualization data (default: true)',
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
    const limit = Math.min(Math.max((params.limit as number) || 20, 1), 500);
    const skip = (params.skip as number) || 0;
    const branch = params.branch as string | undefined;
    const author = params.author as string | undefined;
    const since = params.since as string | undefined;
    const until = params.until as string | undefined;
    const messagePattern = params.messagePattern as string | undefined;
    const filePath = params.filePath as string | undefined;
    const includeMerges = params.includeMerges !== false;
    const firstParent = params.firstParent === true;
    const includeGraph = params.includeGraph !== false;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Build log command
      // Format: SHA|SHORT|AUTHOR|EMAIL|DATE|COMMITTER|CEMAIL|CDATE|PARENTS|SUBJECT|BODY
      const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1f%s%x1f%b%x00';
      const logArgs = ['log', `--format=${format}`, `-n${limit + 1}`, `--skip=${skip}`];

      if (branch) {
        logArgs.push(branch);
      }

      if (author) {
        logArgs.push(`--author=${author}`);
      }

      if (since) {
        logArgs.push(`--since=${since}`);
      }

      if (until) {
        logArgs.push(`--until=${until}`);
      }

      if (messagePattern) {
        logArgs.push(`--grep=${messagePattern}`, '-i');
      }

      if (!includeMerges) {
        logArgs.push('--no-merges');
      }

      if (firstParent) {
        logArgs.push('--first-parent');
      }

      if (filePath) {
        logArgs.push('--', filePath);
      }

      const logResult = await executeGitCommand(logArgs, cwd);

      if (!logResult.success) {
        return { success: false, error: logResult.stderr || 'Failed to get history' };
      }

      // Parse commits
      let commits = parseCommitInfo(logResult.stdout);
      const hasMore = commits.length > limit;
      if (hasMore) {
        commits = commits.slice(0, limit);
      }

      // Get current branch
      const branchResult = await executeGitCommand(['branch', '--show-current'], cwd);
      const currentBranch = branchResult.stdout || 'HEAD';

      // Get all branches
      const branchListResult = await executeGitCommand(
        ['branch', '-a', '--format=%(refname:short)'],
        cwd
      );
      const branches = branchListResult.stdout.split('\n').filter((b) => b.trim());

      // Get refs for commits
      if (commits.length > 0) {
        const refs = await getCommitRefs(
          commits.map((c) => c.sha),
          cwd
        );
        for (const commit of commits) {
          const commitRefs = refs.get(commit.sha);
          if (commitRefs) {
            commit.branches = commitRefs.branches;
            commit.tags = commitRefs.tags;
          }
        }
      }

      // Build graph if requested
      let graph: GitGraphNode[] | undefined;
      if (includeGraph) {
        graph = buildGraphData(commits);
      }

      // Get total count
      const countArgs = ['rev-list', '--count'];
      if (branch) {
        countArgs.push(branch);
      } else {
        countArgs.push('HEAD');
      }
      if (author) countArgs.push(`--author=${author}`);
      if (since) countArgs.push(`--since=${since}`);
      if (until) countArgs.push(`--until=${until}`);
      if (messagePattern) countArgs.push(`--grep=${messagePattern}`, '-i');
      if (!includeMerges) countArgs.push('--no-merges');
      if (firstParent) countArgs.push('--first-parent');
      if (filePath) countArgs.push('--', filePath);

      const countResult = await executeGitCommand(countArgs, cwd);
      const totalCount = parseInt(countResult.stdout, 10) || commits.length;

      const result: GitHistoryResult = {
        commits,
        totalCount,
        graph,
        currentBranch,
        branches,
        page: Math.floor(skip / limit),
        pageSize: limit,
        hasMore,
      };

      logger.debug('Git history retrieved', {
        commits: commits.length,
        totalCount,
        branch: branch || currentBranch,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Git history error', { error: (error as Error).message });
      return { success: false, error: `Failed to get history: ${(error as Error).message}` };
    }
  },
};

/**
 * Get detailed commit information
 */
export const gitCommitDetailTool: AgentTool = {
  name: 'git_commit_detail',
  description:
    'Get detailed information about a specific commit including diff, file changes, and statistics. ' +
    'Use with voice command "Go to commit X" or "Show commit details for abc123".',
  parameters: {
    type: 'object',
    properties: {
      sha: {
        type: 'string',
        description: 'Commit SHA (full or short)',
      },
      includeDiff: {
        type: 'boolean',
        description: 'Include full diff (default: true)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['sha'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const sha = params.sha as string;
    const includeDiff = params.includeDiff !== false;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get commit info
      const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1f%s%x1f%b%x00';
      const logResult = await executeGitCommand(['log', '-1', `--format=${format}`, sha], cwd);

      if (!logResult.success) {
        return { success: false, error: `Commit not found: ${sha}` };
      }

      const commits = parseCommitInfo(logResult.stdout);
      if (commits.length === 0) {
        return { success: false, error: `Invalid commit: ${sha}` };
      }

      const commit = commits[0];

      // Get stats
      const statsResult = await executeGitCommand(['show', '--stat', '--format=', sha], cwd);

      if (statsResult.success) {
        const statsMatch = statsResult.stdout.match(
          /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
        );
        if (statsMatch) {
          commit.filesChanged = parseInt(statsMatch[1], 10) || 0;
          commit.insertions = parseInt(statsMatch[2], 10) || 0;
          commit.deletions = parseInt(statsMatch[3], 10) || 0;
        }
      }

      // Get refs
      const refs = await getCommitRefs([commit.sha], cwd);
      const commitRefs = refs.get(commit.sha);
      if (commitRefs) {
        commit.branches = commitRefs.branches;
        commit.tags = commitRefs.tags;
      }

      // Get diff if requested
      let diff: GitCommitDiff | undefined;
      if (includeDiff) {
        const diffResult = await executeGitCommand(['show', '--format=', '-p', sha], cwd);

        if (diffResult.success) {
          const files = parseDiff(diffResult.stdout);
          diff = {
            sha: commit.sha,
            files,
            stats: {
              filesChanged: files.length,
              insertions: files.reduce((sum, f) => sum + f.additions, 0),
              deletions: files.reduce((sum, f) => sum + f.deletions, 0),
            },
            rawDiff: diffResult.stdout,
          };
        }
      }

      logger.debug('Commit detail retrieved', { sha: commit.sha });

      return {
        success: true,
        data: {
          commit,
          diff,
        },
      };
    } catch (error) {
      logger.error('Git commit detail error', { error: (error as Error).message });
      return { success: false, error: `Failed to get commit: ${(error as Error).message}` };
    }
  },
};

/**
 * Search commit messages
 */
export const gitSearchCommitsTool: AgentTool = {
  name: 'git_search_commits',
  description:
    'Search commit messages for a pattern. Supports regex patterns. ' +
    'Use with voice command "Search commits for bug fix" or "Find commits mentioning feature X".',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search pattern (regex supported)',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: false)',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 50)',
      },
      branch: {
        type: 'string',
        description: 'Search in specific branch',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const query = params.query as string;
    const caseSensitive = params.caseSensitive === true;
    const limit = Math.min((params.limit as number) || 50, 200);
    const branch = params.branch as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1f%s%x1f%b%x00';
      const searchArgs = ['log', `--format=${format}`, `-n${limit}`, `--grep=${query}`];

      if (!caseSensitive) {
        searchArgs.push('-i');
      }

      searchArgs.push('--regexp-ignore-case');

      if (branch) {
        searchArgs.push(branch);
      }

      const result = await executeGitCommand(searchArgs, cwd);

      if (!result.success && result.stderr) {
        return { success: false, error: result.stderr };
      }

      const commits = parseCommitInfo(result.stdout);

      logger.debug('Git search completed', { query, results: commits.length });

      return {
        success: true,
        data: {
          query,
          commits,
          count: commits.length,
        },
      };
    } catch (error) {
      logger.error('Git search error', { error: (error as Error).message });
      return { success: false, error: `Search failed: ${(error as Error).message}` };
    }
  },
};

/**
 * Compare branches
 */
export const gitCompareBranchesTool: AgentTool = {
  name: 'git_compare_branches',
  description:
    'Compare two branches showing commits ahead/behind and file differences. ' +
    'Use with voice command "Compare main to feature-branch" or "Show differences between branches".',
  parameters: {
    type: 'object',
    properties: {
      base: {
        type: 'string',
        description: 'Base branch for comparison (default: main or master)',
      },
      compare: {
        type: 'string',
        description: 'Branch to compare against base (default: current branch)',
      },
      includeDiff: {
        type: 'boolean',
        description: 'Include file-level diff (default: true)',
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
    let base = params.base as string | undefined;
    let compare = params.compare as string | undefined;
    const includeDiff = params.includeDiff !== false;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Get current branch if compare not specified
      if (!compare) {
        const currentResult = await executeGitCommand(['branch', '--show-current'], cwd);
        compare = currentResult.stdout || 'HEAD';
      }

      // Get default base branch if not specified
      if (!base) {
        const mainResult = await executeGitCommand(
          ['show-ref', '--verify', 'refs/heads/main'],
          cwd
        );
        if (mainResult.success) {
          base = 'main';
        } else {
          const masterResult = await executeGitCommand(
            ['show-ref', '--verify', 'refs/heads/master'],
            cwd
          );
          base = masterResult.success ? 'master' : 'HEAD~10';
        }
      }

      // Get merge base
      const mergeBaseResult = await executeGitCommand(['merge-base', base, compare], cwd);
      const mergeBase = mergeBaseResult.stdout || '';

      // Get commits ahead (in compare but not in base)
      const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1f%s%x1f%b%x00';
      const aheadResult = await executeGitCommand(
        ['log', `--format=${format}`, `${base}..${compare}`],
        cwd
      );
      const ahead = parseCommitInfo(aheadResult.stdout);

      // Get commits behind (in base but not in compare)
      const behindResult = await executeGitCommand(
        ['log', `--format=${format}`, `${compare}..${base}`],
        cwd
      );
      const behind = parseCommitInfo(behindResult.stdout);

      // Get diff stats
      let diffFiles: GitDiffFile[] = [];
      let stats = { insertions: 0, deletions: 0, filesChanged: 0 };

      if (includeDiff) {
        const diffResult = await executeGitCommand(['diff', '--stat', `${base}...${compare}`], cwd);

        const statMatch = diffResult.stdout.match(
          /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
        );

        if (statMatch) {
          stats = {
            filesChanged: parseInt(statMatch[1], 10) || 0,
            insertions: parseInt(statMatch[2], 10) || 0,
            deletions: parseInt(statMatch[3], 10) || 0,
          };
        }

        // Get changed files list
        const filesResult = await executeGitCommand(
          ['diff', '--name-status', `${base}...${compare}`],
          cwd
        );

        if (filesResult.success) {
          diffFiles = filesResult.stdout
            .split('\n')
            .filter((l) => l.trim())
            .map((line) => {
              const [status, ...pathParts] = line.split('\t');
              const filePath = pathParts.join('\t');
              let fileStatus: GitDiffFile['status'] = 'modified';

              switch (status.charAt(0)) {
                case 'A':
                  fileStatus = 'added';
                  break;
                case 'D':
                  fileStatus = 'deleted';
                  break;
                case 'R':
                  fileStatus = 'renamed';
                  break;
                case 'C':
                  fileStatus = 'copied';
                  break;
              }

              return {
                path: filePath,
                status: fileStatus,
                additions: 0,
                deletions: 0,
                isBinary: false,
              };
            });
        }
      }

      const result: GitBranchComparison = {
        baseBranch: base,
        compareBranch: compare,
        mergeBase,
        ahead,
        behind,
        diffFiles,
        stats: {
          aheadCount: ahead.length,
          behindCount: behind.length,
          ...stats,
        },
      };

      logger.debug('Branch comparison complete', {
        base,
        compare,
        ahead: ahead.length,
        behind: behind.length,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Branch comparison error', { error: (error as Error).message });
      return { success: false, error: `Comparison failed: ${(error as Error).message}` };
    }
  },
};

/**
 * Checkout a specific commit or branch
 */
export const gitCheckoutTool: AgentTool = {
  name: 'git_checkout_commit',
  description:
    'Checkout a specific commit or branch from history. Creates detached HEAD for commits. ' +
    'Use with voice command "Go to commit X" or "Checkout that commit".',
  parameters: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Commit SHA, branch name, or tag to checkout',
      },
      createBranch: {
        type: 'string',
        description: 'Create a new branch at this commit with the given name',
      },
      force: {
        type: 'boolean',
        description: 'Force checkout, discarding local changes (default: false)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['ref'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const ref = params.ref as string;
    const createBranch = params.createBranch as string | undefined;
    const force = params.force === true;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Check for uncommitted changes
      if (!force) {
        const statusResult = await executeGitCommand(['status', '--porcelain'], cwd);
        if (statusResult.stdout.trim()) {
          return {
            success: false,
            error:
              'Uncommitted changes present. Use force: true to discard or commit/stash changes first.',
            metadata: {
              hasChanges: true,
              changedFiles: statusResult.stdout
                .split('\n')
                .filter((l) => l.trim())
                .slice(0, 5),
            },
          };
        }
      }

      const checkoutArgs = ['checkout'];

      if (force) {
        checkoutArgs.push('-f');
      }

      if (createBranch) {
        checkoutArgs.push('-b', createBranch);
      }

      checkoutArgs.push(ref);

      const result = await executeGitCommand(checkoutArgs, cwd);

      if (!result.success) {
        return { success: false, error: result.stderr || 'Checkout failed' };
      }

      // Get current position
      const headResult = await executeGitCommand(['rev-parse', 'HEAD'], cwd);
      const branchResult = await executeGitCommand(['branch', '--show-current'], cwd);

      const isDetached = !branchResult.stdout.trim();

      logger.info('Checkout completed', {
        ref,
        createBranch,
        detached: isDetached,
      });

      return {
        success: true,
        data: {
          checkedOut: ref,
          currentSha: headResult.stdout,
          currentBranch: branchResult.stdout || null,
          isDetached,
          newBranch: createBranch || null,
        },
      };
    } catch (error) {
      logger.error('Git checkout error', { error: (error as Error).message });
      return { success: false, error: `Checkout failed: ${(error as Error).message}` };
    }
  },
};

/**
 * Cherry-pick a commit
 */
export const gitCherryPickTool: AgentTool = {
  name: 'git_cherry_pick',
  description:
    'Apply a specific commit from history to the current branch. ' +
    'Use with voice command "Cherry-pick commit X" or "Apply that commit here".',
  parameters: {
    type: 'object',
    properties: {
      sha: {
        type: 'string',
        description: 'Commit SHA to cherry-pick',
      },
      noCommit: {
        type: 'boolean',
        description: 'Apply changes without creating a commit (default: false)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['sha'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const sha = params.sha as string;
    const noCommit = params.noCommit === true;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const cherryPickArgs = ['cherry-pick'];

      if (noCommit) {
        cherryPickArgs.push('-n');
      }

      cherryPickArgs.push(sha);

      const result = await executeGitCommand(cherryPickArgs, cwd);

      if (!result.success) {
        if (result.stderr.includes('conflict')) {
          return {
            success: false,
            error:
              'Cherry-pick resulted in conflicts. Resolve conflicts and run git cherry-pick --continue',
            metadata: {
              hasConflicts: true,
              suggestion:
                'Resolve conflicts manually, then run git_commit or git cherry-pick --continue',
            },
          };
        }
        return { success: false, error: result.stderr || 'Cherry-pick failed' };
      }

      // Get the new commit SHA if created
      let newSha: string | null = null;
      if (!noCommit) {
        const headResult = await executeGitCommand(['rev-parse', 'HEAD'], cwd);
        newSha = headResult.stdout;
      }

      logger.info('Cherry-pick completed', { sha, noCommit, newSha });

      return {
        success: true,
        data: {
          originalSha: sha,
          newSha,
          applied: true,
          committed: !noCommit,
        },
      };
    } catch (error) {
      logger.error('Git cherry-pick error', { error: (error as Error).message });
      return { success: false, error: `Cherry-pick failed: ${(error as Error).message}` };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git history tools
 */
export function getGitHistoryTools(): AgentTool[] {
  return [
    gitHistoryTool,
    gitCommitDetailTool,
    gitSearchCommitsTool,
    gitCompareBranchesTool,
    gitCheckoutTool,
    gitCherryPickTool,
  ];
}

export default {
  gitHistoryTool,
  gitCommitDetailTool,
  gitSearchCommitsTool,
  gitCompareBranchesTool,
  gitCheckoutTool,
  gitCherryPickTool,
  getGitHistoryTools,
};
