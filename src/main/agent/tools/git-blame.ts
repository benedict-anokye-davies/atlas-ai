/**
 * Atlas Desktop - Git Blame Tool
 *
 * Provides comprehensive git blame functionality with voice navigation support.
 * Shows line-by-line blame information with author, date, and commit details.
 *
 * Features:
 * - Line-by-line blame with author and date
 * - Voice commands: "Who wrote this?", "Blame line 50"
 * - Navigate to commit from blame
 * - Group consecutive lines by same commit
 * - Highlight recent vs old changes
 * - Integration with editor/viewer
 *
 * @module agent/tools/git-blame
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitBlameTool');

// Configuration
const DEFAULT_TIMEOUT = 60000; // 60 seconds for large files
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB for blame output
const MAX_LINES_FOR_FULL_BLAME = 5000; // Limit for full file blame

// ============================================================================
// Types
// ============================================================================

/**
 * Individual blame line information
 */
export interface BlameLine {
  /** Line number in the file (1-based) */
  lineNumber: number;
  /** Commit SHA (short) */
  commitSha: string;
  /** Full commit SHA */
  commitShaFull: string;
  /** Author name */
  author: string;
  /** Author email */
  authorEmail: string;
  /** Author timestamp (ISO format) */
  authorDate: string;
  /** Committer name */
  committer: string;
  /** Committer email */
  committerEmail: string;
  /** Commit timestamp (ISO format) */
  committerDate: string;
  /** Commit summary/message */
  summary: string;
  /** Original line number (before any renames) */
  originalLineNumber: number;
  /** Original file path (if renamed) */
  originalFilePath?: string;
  /** The actual line content */
  lineContent: string;
  /** Whether this is the boundary commit (initial add) */
  isBoundary: boolean;
}

/**
 * Grouped blame information for consecutive lines from same commit
 */
export interface BlameGroup {
  /** Starting line number (1-based) */
  startLine: number;
  /** Ending line number (1-based) */
  endLine: number;
  /** Number of lines in this group */
  lineCount: number;
  /** Commit SHA (short) */
  commitSha: string;
  /** Full commit SHA */
  commitShaFull: string;
  /** Author name */
  author: string;
  /** Author email */
  authorEmail: string;
  /** Author timestamp (ISO format) */
  authorDate: string;
  /** Commit summary/message */
  summary: string;
  /** Age indicator: 'recent', 'moderate', 'old', 'ancient' */
  age: 'recent' | 'moderate' | 'old' | 'ancient';
  /** Days since commit */
  daysAgo: number;
  /** Line contents in this group */
  lines: string[];
}

/**
 * Complete blame result for a file
 */
export interface BlameResult {
  /** File path (relative to repo root) */
  filePath: string;
  /** Absolute file path */
  absolutePath: string;
  /** Repository root */
  repoRoot: string;
  /** Current branch */
  branch: string;
  /** Total lines in file */
  totalLines: number;
  /** Individual blame lines */
  blameLines: BlameLine[];
  /** Grouped blame information */
  groups: BlameGroup[];
  /** Unique authors in this file */
  authors: AuthorStats[];
  /** Statistics */
  statistics: BlameStatistics;
  /** Whether output was truncated */
  truncated: boolean;
}

/**
 * Author statistics for the file
 */
export interface AuthorStats {
  /** Author name */
  name: string;
  /** Author email */
  email: string;
  /** Number of lines authored */
  lineCount: number;
  /** Percentage of file */
  percentage: number;
  /** Most recent commit date */
  lastCommitDate: string;
  /** Oldest commit date */
  firstCommitDate: string;
}

/**
 * Blame statistics
 */
export interface BlameStatistics {
  /** Total unique commits */
  uniqueCommits: number;
  /** Total unique authors */
  uniqueAuthors: number;
  /** Oldest commit date */
  oldestCommit: string;
  /** Newest commit date */
  newestCommit: string;
  /** Average lines per commit */
  avgLinesPerCommit: number;
  /** Age distribution */
  ageDistribution: {
    recent: number; // < 7 days
    moderate: number; // 7-30 days
    old: number; // 30-180 days
    ancient: number; // > 180 days
  };
}

/**
 * Commit detail information
 */
export interface CommitDetail {
  /** Full commit SHA */
  sha: string;
  /** Short SHA */
  shortSha: string;
  /** Author name */
  author: string;
  /** Author email */
  authorEmail: string;
  /** Author date */
  authorDate: string;
  /** Committer name */
  committer: string;
  /** Committer email */
  committerEmail: string;
  /** Commit date */
  commitDate: string;
  /** Full commit message */
  message: string;
  /** Changed files in this commit */
  changedFiles: {
    path: string;
    changeType: string;
    additions: number;
    deletions: number;
  }[];
  /** Parent commits */
  parents: string[];
}

/**
 * Navigation state for voice commands
 */
export interface BlameNavigationState {
  /** Current file path */
  currentFile: string | null;
  /** Current line number */
  currentLine: number;
  /** Current group index */
  currentGroupIndex: number;
  /** Total groups */
  totalGroups: number;
  /** Currently highlighted author */
  highlightedAuthor: string | null;
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
 * Get repository root path
 */
async function getRepoRoot(cwd?: string): Promise<string | null> {
  const result = await executeGitCommand(['rev-parse', '--show-toplevel'], cwd);
  return result.success ? result.stdout : null;
}

/**
 * Get current branch name
 */
async function getCurrentBranch(cwd?: string): Promise<string> {
  const result = await executeGitCommand(['branch', '--show-current'], cwd);
  return result.stdout || 'HEAD';
}

/**
 * Calculate age category based on days since commit
 */
function getAgeCategory(daysAgo: number): 'recent' | 'moderate' | 'old' | 'ancient' {
  if (daysAgo < 7) return 'recent';
  if (daysAgo < 30) return 'moderate';
  if (daysAgo < 180) return 'old';
  return 'ancient';
}

/**
 * Calculate days since a date
 */
function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Parse git blame --porcelain output
 */
function parseBlameOutput(output: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const outputLines = output.split('\n');

  let currentCommit: Partial<BlameLine> = {};
  let lineNumber = 0;

  for (let i = 0; i < outputLines.length; i++) {
    const line = outputLines[i];

    // Commit header line: SHA originalLine finalLine [numLines]
    const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
    if (headerMatch) {
      currentCommit = {
        commitShaFull: headerMatch[1],
        commitSha: headerMatch[1].substring(0, 7),
        originalLineNumber: parseInt(headerMatch[2], 10),
        lineNumber: parseInt(headerMatch[3], 10),
        isBoundary: false,
      };
      lineNumber = parseInt(headerMatch[3], 10);
      continue;
    }

    // Parse metadata lines
    if (line.startsWith('author ')) {
      currentCommit.author = line.substring(7);
    } else if (line.startsWith('author-mail ')) {
      currentCommit.authorEmail = line.substring(12).replace(/[<>]/g, '');
    } else if (line.startsWith('author-time ')) {
      const timestamp = parseInt(line.substring(12), 10);
      currentCommit.authorDate = new Date(timestamp * 1000).toISOString();
    } else if (line.startsWith('committer ')) {
      currentCommit.committer = line.substring(10);
    } else if (line.startsWith('committer-mail ')) {
      currentCommit.committerEmail = line.substring(15).replace(/[<>]/g, '');
    } else if (line.startsWith('committer-time ')) {
      const timestamp = parseInt(line.substring(15), 10);
      currentCommit.committerDate = new Date(timestamp * 1000).toISOString();
    } else if (line.startsWith('summary ')) {
      currentCommit.summary = line.substring(8);
    } else if (line.startsWith('boundary')) {
      currentCommit.isBoundary = true;
    } else if (line.startsWith('filename ')) {
      currentCommit.originalFilePath = line.substring(9);
    } else if (line.startsWith('\t')) {
      // Actual line content (starts with tab)
      currentCommit.lineContent = line.substring(1);

      // Push completed blame line
      if (currentCommit.commitShaFull) {
        lines.push({
          lineNumber: lineNumber,
          commitSha: currentCommit.commitSha || '',
          commitShaFull: currentCommit.commitShaFull,
          author: currentCommit.author || 'Unknown',
          authorEmail: currentCommit.authorEmail || '',
          authorDate: currentCommit.authorDate || '',
          committer: currentCommit.committer || 'Unknown',
          committerEmail: currentCommit.committerEmail || '',
          committerDate: currentCommit.committerDate || '',
          summary: currentCommit.summary || '',
          originalLineNumber: currentCommit.originalLineNumber || lineNumber,
          originalFilePath: currentCommit.originalFilePath,
          lineContent: currentCommit.lineContent,
          isBoundary: currentCommit.isBoundary || false,
        });
      }
    }
  }

  return lines;
}

/**
 * Group consecutive lines by the same commit
 */
function groupBlameLines(blameLines: BlameLine[]): BlameGroup[] {
  const groups: BlameGroup[] = [];
  if (blameLines.length === 0) return groups;

  let currentGroup: BlameGroup | null = null;

  for (const line of blameLines) {
    if (
      !currentGroup ||
      currentGroup.commitShaFull !== line.commitShaFull ||
      currentGroup.endLine !== line.lineNumber - 1
    ) {
      // Start new group
      if (currentGroup) {
        groups.push(currentGroup);
      }

      const daysAgo = daysSince(line.authorDate);
      currentGroup = {
        startLine: line.lineNumber,
        endLine: line.lineNumber,
        lineCount: 1,
        commitSha: line.commitSha,
        commitShaFull: line.commitShaFull,
        author: line.author,
        authorEmail: line.authorEmail,
        authorDate: line.authorDate,
        summary: line.summary,
        age: getAgeCategory(daysAgo),
        daysAgo,
        lines: [line.lineContent],
      };
    } else {
      // Extend current group
      currentGroup.endLine = line.lineNumber;
      currentGroup.lineCount++;
      currentGroup.lines.push(line.lineContent);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Calculate author statistics
 */
function calculateAuthorStats(blameLines: BlameLine[]): AuthorStats[] {
  const authorMap = new Map<
    string,
    {
      name: string;
      email: string;
      lineCount: number;
      dates: string[];
    }
  >();

  for (const line of blameLines) {
    const key = line.authorEmail || line.author;
    const existing = authorMap.get(key);

    if (existing) {
      existing.lineCount++;
      existing.dates.push(line.authorDate);
    } else {
      authorMap.set(key, {
        name: line.author,
        email: line.authorEmail,
        lineCount: 1,
        dates: [line.authorDate],
      });
    }
  }

  const totalLines = blameLines.length;
  const stats: AuthorStats[] = [];

  for (const [, data] of authorMap) {
    const sortedDates = data.dates.sort();
    stats.push({
      name: data.name,
      email: data.email,
      lineCount: data.lineCount,
      percentage: Math.round((data.lineCount / totalLines) * 100 * 10) / 10,
      firstCommitDate: sortedDates[0],
      lastCommitDate: sortedDates[sortedDates.length - 1],
    });
  }

  // Sort by line count descending
  return stats.sort((a, b) => b.lineCount - a.lineCount);
}

/**
 * Calculate blame statistics
 */
function calculateStatistics(blameLines: BlameLine[], _groups: BlameGroup[]): BlameStatistics {
  const commits = new Set<string>();
  const authors = new Set<string>();
  const dates: string[] = [];
  const ageDistribution = {
    recent: 0,
    moderate: 0,
    old: 0,
    ancient: 0,
  };

  for (const line of blameLines) {
    commits.add(line.commitShaFull);
    authors.add(line.authorEmail || line.author);
    dates.push(line.authorDate);

    const daysAgo = daysSince(line.authorDate);
    const category = getAgeCategory(daysAgo);
    ageDistribution[category]++;
  }

  const sortedDates = dates.sort();

  return {
    uniqueCommits: commits.size,
    uniqueAuthors: authors.size,
    oldestCommit: sortedDates[0] || '',
    newestCommit: sortedDates[sortedDates.length - 1] || '',
    avgLinesPerCommit:
      commits.size > 0 ? Math.round((blameLines.length / commits.size) * 10) / 10 : 0,
    ageDistribution,
  };
}

// ============================================================================
// Navigation State
// ============================================================================

/** Global navigation state for voice commands */
let navigationState: BlameNavigationState = {
  currentFile: null,
  currentLine: 1,
  currentGroupIndex: 0,
  totalGroups: 0,
  highlightedAuthor: null,
};

/** Cached blame result for navigation */
let cachedBlameResult: BlameResult | null = null;

/**
 * Reset navigation state
 */
function resetNavigation(): void {
  navigationState = {
    currentFile: null,
    currentLine: 1,
    currentGroupIndex: 0,
    totalGroups: 0,
    highlightedAuthor: null,
  };
  cachedBlameResult = null;
}

/**
 * Update navigation with new blame result
 */
function updateNavigation(result: BlameResult): void {
  cachedBlameResult = result;
  navigationState.currentFile = result.filePath;
  navigationState.currentLine = 1;
  navigationState.currentGroupIndex = 0;
  navigationState.totalGroups = result.groups.length;
  navigationState.highlightedAuthor = null;
}

// ============================================================================
// Git Blame Tool
// ============================================================================

/**
 * Get git blame for a file
 */
export const gitBlameTool: AgentTool = {
  name: 'git_blame',
  description:
    'Get line-by-line blame information for a file showing who wrote each line, when, and in which commit. Supports voice commands like "Who wrote this?" or "Blame line 50".',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path to blame (relative or absolute)',
      },
      startLine: {
        type: 'number',
        description: 'Start line number for partial blame (1-based)',
      },
      endLine: {
        type: 'number',
        description: 'End line number for partial blame (1-based)',
      },
      revision: {
        type: 'string',
        description: 'Blame from specific revision (commit SHA, branch, or tag)',
      },
      ignoreWhitespace: {
        type: 'boolean',
        description: 'Ignore whitespace changes when finding blame (default: false)',
      },
      detectMoves: {
        type: 'boolean',
        description: 'Detect lines moved/copied from other files (default: false)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['file'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const file = params.file as string;
    const startLine = params.startLine as number | undefined;
    const endLine = params.endLine as number | undefined;
    const revision = params.revision as string | undefined;
    const ignoreWhitespace = params.ignoreWhitespace === true;
    const detectMoves = params.detectMoves === true;

    try {
      // Check if it's a git repository
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();
      const branch = await getCurrentBranch(cwd);

      // Resolve file path
      const absolutePath = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
      const relativePath = path.relative(repoRoot, absolutePath);

      // Build blame command with porcelain output
      const blameArgs = ['blame', '--porcelain'];

      if (ignoreWhitespace) {
        blameArgs.push('-w');
      }

      if (detectMoves) {
        blameArgs.push('-M', '-C', '-C', '-C'); // Track moves across files
      }

      if (startLine && endLine) {
        blameArgs.push(`-L${startLine},${endLine}`);
      } else if (startLine) {
        blameArgs.push(`-L${startLine},`);
      }

      if (revision) {
        blameArgs.push(revision);
      }

      blameArgs.push('--', relativePath);

      const blameResult = await executeGitCommand(blameArgs, repoRoot);

      if (!blameResult.success) {
        // Check for common errors
        if (blameResult.stderr.includes('no such path')) {
          return {
            success: false,
            error: `File not found: ${relativePath}`,
          };
        }
        if (blameResult.stderr.includes('bad revision')) {
          return {
            success: false,
            error: `Invalid revision: ${revision}`,
          };
        }
        return {
          success: false,
          error: blameResult.stderr || 'Failed to get blame',
        };
      }

      // Parse the blame output
      const blameLines = parseBlameOutput(blameResult.stdout);

      // Check if truncation is needed
      const truncated = blameLines.length > MAX_LINES_FOR_FULL_BLAME;
      const processedLines = truncated ? blameLines.slice(0, MAX_LINES_FOR_FULL_BLAME) : blameLines;

      // Group consecutive lines
      const groups = groupBlameLines(processedLines);

      // Calculate statistics
      const authorStats = calculateAuthorStats(processedLines);
      const statistics = calculateStatistics(processedLines, groups);

      const result: BlameResult = {
        filePath: relativePath,
        absolutePath,
        repoRoot,
        branch,
        totalLines: blameLines.length,
        blameLines: processedLines,
        groups,
        authors: authorStats,
        statistics,
        truncated,
      };

      // Update navigation state
      updateNavigation(result);

      logger.info('Git blame retrieved', {
        file: relativePath,
        lines: blameLines.length,
        commits: statistics.uniqueCommits,
        authors: statistics.uniqueAuthors,
      });

      return {
        success: true,
        data: {
          ...result,
          navigation: navigationState,
        },
      };
    } catch (error) {
      logger.error('Git blame error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to get blame: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Get blame for a specific line (voice command: "Who wrote this?", "Blame line 50")
 */
export const gitBlameLineTool: AgentTool = {
  name: 'git_blame_line',
  description:
    'Get blame information for a specific line. Voice commands: "Who wrote this?", "Blame line 50", "Who wrote line 123?"',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (optional if blame is already loaded)',
      },
      line: {
        type: 'number',
        description: 'Line number to blame (1-based)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path',
      },
    },
    required: ['line'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const file = params.file as string | undefined;
    const lineNumber = params.line as number;
    const cwd = params.path as string | undefined;

    try {
      // If we have a cached result and no new file specified, use cache
      if (!file && cachedBlameResult) {
        const blameLine = cachedBlameResult.blameLines.find((l) => l.lineNumber === lineNumber);

        if (!blameLine) {
          return {
            success: false,
            error: `Line ${lineNumber} not found. File has ${cachedBlameResult.totalLines} lines.`,
          };
        }

        const daysAgo = daysSince(blameLine.authorDate);

        // Update navigation
        navigationState.currentLine = lineNumber;

        return {
          success: true,
          data: {
            line: lineNumber,
            author: blameLine.author,
            authorEmail: blameLine.authorEmail,
            date: blameLine.authorDate,
            daysAgo,
            age: getAgeCategory(daysAgo),
            commitSha: blameLine.commitSha,
            summary: blameLine.summary,
            content: blameLine.lineContent,
            isBoundary: blameLine.isBoundary,
            voiceResponse: `Line ${lineNumber} was written by ${blameLine.author}, ${daysAgo} days ago. The commit message was: ${blameLine.summary}`,
          },
        };
      }

      // Need to get fresh blame for the file
      if (!file) {
        return {
          success: false,
          error: 'No file specified and no blame loaded. Use git_blame first or specify a file.',
        };
      }

      // Get blame for just this line range (with some context)
      const startLine = Math.max(1, lineNumber - 2);
      const endLine = lineNumber + 2;

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();
      const relativePath = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;

      const blameArgs = ['blame', '--porcelain', `-L${startLine},${endLine}`, '--', relativePath];

      const blameResult = await executeGitCommand(blameArgs, repoRoot);

      if (!blameResult.success) {
        return {
          success: false,
          error: blameResult.stderr || 'Failed to get blame',
        };
      }

      const blameLines = parseBlameOutput(blameResult.stdout);
      const targetLine = blameLines.find((l) => l.lineNumber === lineNumber);

      if (!targetLine) {
        return {
          success: false,
          error: `Line ${lineNumber} not found`,
        };
      }

      const daysAgo = daysSince(targetLine.authorDate);

      return {
        success: true,
        data: {
          line: lineNumber,
          author: targetLine.author,
          authorEmail: targetLine.authorEmail,
          date: targetLine.authorDate,
          daysAgo,
          age: getAgeCategory(daysAgo),
          commitSha: targetLine.commitSha,
          summary: targetLine.summary,
          content: targetLine.lineContent,
          isBoundary: targetLine.isBoundary,
          voiceResponse: `Line ${lineNumber} was written by ${targetLine.author}, ${daysAgo} days ago. The commit message was: ${targetLine.summary}`,
        },
      };
    } catch (error) {
      logger.error('Git blame line error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to blame line: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Navigate through blame groups (voice commands: "next author", "previous change")
 */
export const gitBlameNavigateTool: AgentTool = {
  name: 'git_blame_navigate',
  description:
    'Navigate through blame groups by commit. Voice commands: "next author", "previous change", "go to oldest", "go to newest".',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Navigation action: "next_group", "prev_group", "oldest", "newest", "by_author", "by_commit"',
      },
      author: {
        type: 'string',
        description: 'Author name to find (for by_author action)',
      },
      commit: {
        type: 'string',
        description: 'Commit SHA to find (for by_commit action)',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const author = params.author as string | undefined;
    const commit = params.commit as string | undefined;

    if (!cachedBlameResult || cachedBlameResult.groups.length === 0) {
      return {
        success: false,
        error: 'No blame loaded. Use git_blame first.',
      };
    }

    const groups = cachedBlameResult.groups;

    switch (action) {
      case 'next_group':
        if (navigationState.currentGroupIndex < groups.length - 1) {
          navigationState.currentGroupIndex++;
        }
        break;

      case 'prev_group':
        if (navigationState.currentGroupIndex > 0) {
          navigationState.currentGroupIndex--;
        }
        break;

      case 'oldest': {
        // Find group with oldest commit
        let oldestIdx = 0;
        let oldestDate = groups[0].authorDate;
        for (let i = 1; i < groups.length; i++) {
          if (groups[i].authorDate < oldestDate) {
            oldestDate = groups[i].authorDate;
            oldestIdx = i;
          }
        }
        navigationState.currentGroupIndex = oldestIdx;
        break;
      }

      case 'newest': {
        // Find group with newest commit
        let newestIdx = 0;
        let newestDate = groups[0].authorDate;
        for (let i = 1; i < groups.length; i++) {
          if (groups[i].authorDate > newestDate) {
            newestDate = groups[i].authorDate;
            newestIdx = i;
          }
        }
        navigationState.currentGroupIndex = newestIdx;
        break;
      }

      case 'by_author':
        if (!author) {
          return {
            success: false,
            error: 'Author name required for by_author navigation',
          };
        }
        {
          const authorIdx = groups.findIndex((g) =>
            g.author.toLowerCase().includes(author.toLowerCase())
          );
          if (authorIdx === -1) {
            return {
              success: false,
              error: `No changes found by author matching "${author}"`,
            };
          }
          navigationState.currentGroupIndex = authorIdx;
          navigationState.highlightedAuthor = groups[authorIdx].author;
        }
        break;

      case 'by_commit':
        if (!commit) {
          return {
            success: false,
            error: 'Commit SHA required for by_commit navigation',
          };
        }
        {
          const commitIdx = groups.findIndex(
            (g) =>
              g.commitSha.startsWith(commit.toLowerCase()) ||
              g.commitShaFull.startsWith(commit.toLowerCase())
          );
          if (commitIdx === -1) {
            return {
              success: false,
              error: `Commit "${commit}" not found in blame`,
            };
          }
          navigationState.currentGroupIndex = commitIdx;
        }
        break;

      default:
        return {
          success: false,
          error: `Unknown navigation action: ${action}`,
        };
    }

    // Get current group details
    const currentGroup = groups[navigationState.currentGroupIndex];
    navigationState.currentLine = currentGroup.startLine;

    return {
      success: true,
      data: {
        navigation: {
          ...navigationState,
          position: `Group ${navigationState.currentGroupIndex + 1}/${groups.length}`,
        },
        currentGroup: {
          startLine: currentGroup.startLine,
          endLine: currentGroup.endLine,
          lineCount: currentGroup.lineCount,
          author: currentGroup.author,
          authorEmail: currentGroup.authorEmail,
          date: currentGroup.authorDate,
          daysAgo: currentGroup.daysAgo,
          age: currentGroup.age,
          commitSha: currentGroup.commitSha,
          summary: currentGroup.summary,
          preview: currentGroup.lines.slice(0, 5).join('\n'),
        },
        voiceResponse: `Lines ${currentGroup.startLine} to ${currentGroup.endLine}, ${currentGroup.lineCount} lines by ${currentGroup.author}, ${currentGroup.daysAgo} days ago: ${currentGroup.summary}`,
      },
    };
  },
};

/**
 * Get commit details from blame (voice command: "Show me this commit")
 */
export const gitBlameCommitTool: AgentTool = {
  name: 'git_blame_commit',
  description:
    'Get full commit details from blame. Voice command: "Show me this commit", "What else changed in this commit?"',
  parameters: {
    type: 'object',
    properties: {
      commit: {
        type: 'string',
        description: 'Commit SHA (optional, uses current navigation position)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    let commitSha = params.commit as string | undefined;

    // Use current navigation position if no commit specified
    if (!commitSha && cachedBlameResult) {
      const currentGroup = cachedBlameResult.groups[navigationState.currentGroupIndex];
      if (currentGroup) {
        commitSha = currentGroup.commitShaFull;
      }
    }

    if (!commitSha) {
      return {
        success: false,
        error: 'No commit specified and no blame loaded. Use git_blame first.',
      };
    }

    try {
      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();

      // Get commit details
      const showArgs = [
        'show',
        commitSha,
        '--pretty=format:%H|%h|%an|%ae|%ai|%cn|%ce|%ci|%s|%b|%P',
        '--numstat',
      ];

      const showResult = await executeGitCommand(showArgs, repoRoot);

      if (!showResult.success) {
        return {
          success: false,
          error: showResult.stderr || 'Failed to get commit details',
        };
      }

      const lines = showResult.stdout.split('\n');
      const headerLine = lines[0];
      const [
        sha,
        shortSha,
        author,
        authorEmail,
        authorDate,
        committer,
        committerEmail,
        commitDate,
        subject,
        body,
        parents,
      ] = headerLine.split('|');

      // Parse changed files from numstat
      const changedFiles: CommitDetail['changedFiles'] = [];
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (match) {
          const additions = match[1] === '-' ? 0 : parseInt(match[1], 10);
          const deletions = match[2] === '-' ? 0 : parseInt(match[2], 10);
          let changeType = 'modified';
          if (additions > 0 && deletions === 0) changeType = 'added';
          if (additions === 0 && deletions > 0) changeType = 'deleted';

          changedFiles.push({
            path: match[3],
            changeType,
            additions,
            deletions,
          });
        }
      }

      const commitDetail: CommitDetail = {
        sha,
        shortSha,
        author,
        authorEmail,
        authorDate,
        committer,
        committerEmail,
        commitDate,
        message: body ? `${subject}\n\n${body}` : subject,
        changedFiles,
        parents: parents ? parents.split(' ') : [],
      };

      return {
        success: true,
        data: {
          commit: commitDetail,
          voiceResponse: `Commit ${shortSha} by ${author}: ${subject}. This commit changed ${changedFiles.length} file${changedFiles.length !== 1 ? 's' : ''}.`,
        },
      };
    } catch (error) {
      logger.error('Git blame commit error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to get commit details: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Get blame summary for file (voice command: "Summarize blame")
 */
export const gitBlameSummaryTool: AgentTool = {
  name: 'git_blame_summary',
  description:
    'Get a summary of blame information for a file. Voice command: "Summarize blame", "Who contributed most?"',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path (optional if blame already loaded)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    // Use cached result if available
    if (cachedBlameResult) {
      const { statistics, authors, filePath } = cachedBlameResult;

      // Generate voice-friendly summary
      const topAuthor = authors[0];
      const voiceResponse = `${filePath} has ${statistics.uniqueCommits} commits from ${statistics.uniqueAuthors} author${statistics.uniqueAuthors !== 1 ? 's' : ''}. ${topAuthor.name} contributed the most with ${topAuthor.lineCount} lines, ${topAuthor.percentage}% of the file. ${statistics.ageDistribution.recent} lines changed recently, ${statistics.ageDistribution.ancient} lines are over 6 months old.`;

      return {
        success: true,
        data: {
          file: filePath,
          statistics,
          authors: authors.slice(0, 10), // Top 10 authors
          ageDistribution: statistics.ageDistribution,
          voiceResponse,
        },
      };
    }

    // Need file parameter if no cache
    const file = params.file as string | undefined;
    if (!file) {
      return {
        success: false,
        error: 'No file specified and no blame loaded. Use git_blame first.',
      };
    }

    // Get fresh blame
    const blameResult = await gitBlameTool.execute({
      file,
      path: params.path,
    });

    if (!blameResult.success) {
      return blameResult;
    }

    const data = blameResult.data as BlameResult;

    return {
      success: true,
      data: {
        file: data.filePath,
        statistics: data.statistics,
        authors: data.authors.slice(0, 10),
        ageDistribution: data.statistics.ageDistribution,
      },
    };
  },
};

/**
 * Filter blame by author (voice command: "Show only my changes")
 */
export const gitBlameFilterTool: AgentTool = {
  name: 'git_blame_filter',
  description:
    'Filter blame results by author or time range. Voice commands: "Show only my changes", "Show changes from last week".',
  parameters: {
    type: 'object',
    properties: {
      author: {
        type: 'string',
        description: 'Filter by author name or email',
      },
      age: {
        type: 'string',
        description:
          'Filter by age: "recent" (<7 days), "moderate" (7-30 days), "old" (30-180 days), "ancient" (>180 days)',
      },
      since: {
        type: 'string',
        description: 'Show changes since date (ISO format or relative like "2 weeks ago")',
      },
      until: {
        type: 'string',
        description: 'Show changes until date',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    if (!cachedBlameResult) {
      return {
        success: false,
        error: 'No blame loaded. Use git_blame first.',
      };
    }

    const author = params.author as string | undefined;
    const age = params.age as 'recent' | 'moderate' | 'old' | 'ancient' | undefined;
    const since = params.since as string | undefined;
    const until = params.until as string | undefined;

    let filteredGroups = [...cachedBlameResult.groups];

    // Filter by author
    if (author) {
      filteredGroups = filteredGroups.filter(
        (g) =>
          g.author.toLowerCase().includes(author.toLowerCase()) ||
          g.authorEmail.toLowerCase().includes(author.toLowerCase())
      );
    }

    // Filter by age category
    if (age) {
      filteredGroups = filteredGroups.filter((g) => g.age === age);
    }

    // Filter by date range
    if (since) {
      const sinceDate = new Date(since);
      filteredGroups = filteredGroups.filter((g) => new Date(g.authorDate) >= sinceDate);
    }

    if (until) {
      const untilDate = new Date(until);
      filteredGroups = filteredGroups.filter((g) => new Date(g.authorDate) <= untilDate);
    }

    // Calculate filtered stats
    const totalFilteredLines = filteredGroups.reduce((sum, g) => sum + g.lineCount, 0);
    const uniqueAuthors = new Set(filteredGroups.map((g) => g.author)).size;
    const uniqueCommits = new Set(filteredGroups.map((g) => g.commitShaFull)).size;

    return {
      success: true,
      data: {
        filter: {
          author,
          age,
          since,
          until,
        },
        totalGroups: filteredGroups.length,
        totalLines: totalFilteredLines,
        uniqueAuthors,
        uniqueCommits,
        percentageOfFile: Math.round((totalFilteredLines / cachedBlameResult.totalLines) * 100),
        groups: filteredGroups.map((g) => ({
          startLine: g.startLine,
          endLine: g.endLine,
          lineCount: g.lineCount,
          author: g.author,
          date: g.authorDate,
          age: g.age,
          summary: g.summary,
        })),
        voiceResponse:
          filteredGroups.length > 0
            ? `Found ${filteredGroups.length} sections with ${totalFilteredLines} lines matching your filter.`
            : 'No matching changes found.',
      },
    };
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git blame tools
 */
export function getGitBlameTools(): AgentTool[] {
  return [
    gitBlameTool,
    gitBlameLineTool,
    gitBlameNavigateTool,
    gitBlameCommitTool,
    gitBlameSummaryTool,
    gitBlameFilterTool,
  ];
}

/**
 * Reset blame viewer state (for cleanup)
 */
export function resetBlameViewerState(): void {
  resetNavigation();
}

export default {
  gitBlameTool,
  gitBlameLineTool,
  gitBlameNavigateTool,
  gitBlameCommitTool,
  gitBlameSummaryTool,
  gitBlameFilterTool,
  getGitBlameTools,
  resetBlameViewerState,
};
