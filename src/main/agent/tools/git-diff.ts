/**
 * Atlas Desktop - Git Diff Viewer Tool
 *
 * Provides enhanced git diff capabilities with LLM-powered summarization
 * for voice-controlled code review workflows.
 *
 * Features:
 * - Staged and unstaged diff retrieval
 * - File-by-file diff navigation
 * - LLM-powered change summarization
 * - Voice command integration support
 *
 * @module agent/tools/git-diff
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';

const logger = createModuleLogger('GitDiffTool');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB for diffs
const MAX_SUMMARY_DIFF_SIZE = 50000; // 50KB max for LLM summarization

// ============================================================================
// Types
// ============================================================================

/**
 * Hunk information in a diff
 */
export interface DiffHunk {
  /** Starting line in old file */
  oldStart: number;
  /** Number of lines in old file */
  oldCount: number;
  /** Starting line in new file */
  newStart: number;
  /** Number of lines in new file */
  newCount: number;
  /** Hunk header context */
  header: string;
  /** Hunk content lines */
  lines: DiffLine[];
}

/**
 * A single line in a diff
 */
export interface DiffLine {
  /** Line type: addition, deletion, or context */
  type: 'add' | 'delete' | 'context';
  /** Line content */
  content: string;
  /** Old line number (for context and deletions) */
  oldLineNo?: number;
  /** New line number (for context and additions) */
  newLineNo?: number;
}

/**
 * File diff information
 */
export interface FileDiff {
  /** File path (relative to repo root) */
  path: string;
  /** Previous file path (for renames) */
  oldPath?: string;
  /** Change type */
  changeType: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  /** Whether the file is binary */
  isBinary: boolean;
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
  /** Diff hunks */
  hunks: DiffHunk[];
  /** Raw diff content */
  rawDiff: string;
  /** File mode changes */
  modeChange?: {
    old: string;
    new: string;
  };
}

/**
 * Complete diff result
 */
export interface DiffResult {
  /** Whether showing staged changes */
  staged: boolean;
  /** Files with changes */
  files: FileDiff[];
  /** Total additions across all files */
  totalAdditions: number;
  /** Total deletions across all files */
  totalDeletions: number;
  /** Total files changed */
  totalFiles: number;
  /** Repository root path */
  repoRoot: string;
  /** Current branch */
  branch: string;
  /** Commit reference if comparing to commit */
  commit?: string;
}

/**
 * Diff summary from LLM
 */
export interface DiffSummary {
  /** Overall summary of changes */
  overview: string;
  /** Key changes by category */
  keyChanges: string[];
  /** Potential issues or concerns */
  concerns: string[];
  /** Suggested commit message */
  suggestedCommitMessage?: string;
  /** Files grouped by change type */
  fileGroups: {
    added: string[];
    modified: string[];
    deleted: string[];
    renamed: string[];
  };
}

/**
 * Voice navigation state
 */
export interface DiffNavigationState {
  /** Current file index */
  currentFileIndex: number;
  /** Current hunk index within file */
  currentHunkIndex: number;
  /** Total files */
  totalFiles: number;
  /** Current file path */
  currentFile: string | null;
  /** Summary available */
  hasSummary: boolean;
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
 * Parse unified diff output into structured format
 */
function parseDiff(diffOutput: string): FileDiff[] {
  const files: FileDiff[] = [];
  if (!diffOutput.trim()) return files;

  // Split by file diff headers
  const fileDiffs = diffOutput.split(/^diff --git /m).filter((s) => s.trim());

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');
    if (lines.length === 0) continue;

    // Parse file header: a/path b/path
    const headerMatch = lines[0].match(/a\/(.*?) b\/(.*)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    let changeType: FileDiff['changeType'] = 'modified';
    let isBinary = false;
    let modeChange: FileDiff['modeChange'] | undefined;
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    // Process diff metadata lines
    let lineIdx = 1;
    while (lineIdx < lines.length) {
      const line = lines[lineIdx];

      if (line.startsWith('new file mode')) {
        changeType = 'added';
        const modeMatch = line.match(/new file mode (\d+)/);
        if (modeMatch) {
          modeChange = { old: '000000', new: modeMatch[1] };
        }
      } else if (line.startsWith('deleted file mode')) {
        changeType = 'deleted';
        const modeMatch = line.match(/deleted file mode (\d+)/);
        if (modeMatch) {
          modeChange = { old: modeMatch[1], new: '000000' };
        }
      } else if (line.startsWith('rename from')) {
        changeType = 'renamed';
      } else if (line.startsWith('copy from')) {
        changeType = 'copied';
      } else if (line.includes('Binary files')) {
        isBinary = true;
      } else if (line.startsWith('old mode')) {
        const oldModeMatch = line.match(/old mode (\d+)/);
        if (oldModeMatch) {
          modeChange = { old: oldModeMatch[1], new: '' };
        }
      } else if (line.startsWith('new mode') && modeChange) {
        const newModeMatch = line.match(/new mode (\d+)/);
        if (newModeMatch) {
          modeChange.new = newModeMatch[1];
        }
      } else if (line.startsWith('@@')) {
        // Start of a hunk
        break;
      }
      lineIdx++;
    }

    // Parse hunks
    let currentHunk: DiffHunk | null = null;
    let oldLineNo = 0;
    let newLineNo = 0;

    for (let i = lineIdx; i < lines.length; i++) {
      const line = lines[i];

      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@ context
      const hunkMatch = line.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s*(.*)?/
      );
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        oldLineNo = parseInt(hunkMatch[1], 10);
        newLineNo = parseInt(hunkMatch[3], 10);
        currentHunk = {
          oldStart: oldLineNo,
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: newLineNo,
          newCount: parseInt(hunkMatch[4] || '1', 10),
          header: hunkMatch[5] || '',
          lines: [],
        };
        continue;
      }

      if (!currentHunk) continue;

      // Parse diff lines
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          newLineNo: newLineNo++,
        });
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({
          type: 'delete',
          content: line.substring(1),
          oldLineNo: oldLineNo++,
        });
        deletions++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNo: oldLineNo++,
          newLineNo: newLineNo++,
        });
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" - skip
        continue;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    files.push({
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      changeType,
      isBinary,
      additions,
      deletions,
      hunks,
      rawDiff: 'diff --git ' + fileDiff,
      modeChange,
    });
  }

  return files;
}

/**
 * Get file diff statistics using numstat
 */
async function getDiffStats(
  cwd?: string,
  staged = false,
  commit?: string
): Promise<Map<string, { additions: number; deletions: number }>> {
  const args = ['diff', '--numstat'];
  if (staged) args.push('--cached');
  if (commit) args.push(commit);

  const result = await executeGitCommand(args, cwd);
  const stats = new Map<string, { additions: number; deletions: number }>();

  if (result.success) {
    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const additions = match[1] === '-' ? 0 : parseInt(match[1], 10);
        const deletions = match[2] === '-' ? 0 : parseInt(match[2], 10);
        stats.set(match[3], { additions, deletions });
      }
    }
  }

  return stats;
}

/**
 * Generate diff summary using LLM
 */
async function generateDiffSummary(
  files: FileDiff[],
  totalAdditions: number,
  totalDeletions: number
): Promise<DiffSummary | null> {
  try {
    const llmManager = getLLMManager();
    if (!llmManager) {
      logger.warn('LLM manager not available for diff summarization');
      return null;
    }

    // Build a concise representation of changes
    const changesDescription: string[] = [];
    const fileGroups = {
      added: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
      renamed: [] as string[],
    };

    let totalDiffSize = 0;

    for (const file of files) {
      // Group files by change type
      switch (file.changeType) {
        case 'added':
          fileGroups.added.push(file.path);
          break;
        case 'deleted':
          fileGroups.deleted.push(file.path);
          break;
        case 'renamed':
          fileGroups.renamed.push(`${file.oldPath} -> ${file.path}`);
          break;
        default:
          fileGroups.modified.push(file.path);
      }

      // Include file content summary if not too large
      if (!file.isBinary && totalDiffSize < MAX_SUMMARY_DIFF_SIZE) {
        const fileDiffContent = file.rawDiff.substring(0, 5000);
        totalDiffSize += fileDiffContent.length;
        changesDescription.push(
          `### ${file.path} (${file.changeType})\n+${file.additions}/-${file.deletions}\n${fileDiffContent}`
        );
      } else if (!file.isBinary) {
        changesDescription.push(
          `### ${file.path} (${file.changeType}) - +${file.additions}/-${file.deletions} [truncated]`
        );
      } else {
        changesDescription.push(`### ${file.path} (${file.changeType}) - binary file`);
      }
    }

    const prompt = `Analyze the following git diff and provide a structured summary.

CHANGES OVERVIEW:
- Total files: ${files.length}
- Total additions: ${totalAdditions}
- Total deletions: ${totalDeletions}
- Added files: ${fileGroups.added.length}
- Modified files: ${fileGroups.modified.length}
- Deleted files: ${fileGroups.deleted.length}
- Renamed files: ${fileGroups.renamed.length}

DIFF CONTENT:
${changesDescription.join('\n\n')}

Please provide:
1. A brief overview (2-3 sentences) describing what these changes accomplish
2. 3-5 key changes as bullet points
3. Any potential concerns or issues (empty if none)
4. A suggested commit message following conventional commits format

Respond in JSON format:
{
  "overview": "...",
  "keyChanges": ["...", "..."],
  "concerns": ["..."],
  "suggestedCommitMessage": "type(scope): description"
}`;

    const response = await llmManager.chat(prompt, {
      maxTokens: 1000,
      temperature: 0.3,
    });

    if (response.content) {
      try {
        // Extract JSON from response (may have markdown code blocks)
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            overview: parsed.overview || 'No summary available',
            keyChanges: parsed.keyChanges || [],
            concerns: parsed.concerns || [],
            suggestedCommitMessage: parsed.suggestedCommitMessage,
            fileGroups,
          };
        }
      } catch (parseError) {
        logger.warn('Failed to parse LLM summary response', { parseError });
      }
    }

    // Return basic summary if LLM parsing fails
    return {
      overview: `Changes across ${files.length} files with ${totalAdditions} additions and ${totalDeletions} deletions.`,
      keyChanges: files.slice(0, 5).map((f) => `${f.changeType}: ${f.path}`),
      concerns: [],
      fileGroups,
    };
  } catch (error) {
    logger.error('Failed to generate diff summary', { error: (error as Error).message });
    return null;
  }
}

// ============================================================================
// Diff Navigation State (for voice commands)
// ============================================================================

/** Global navigation state for voice commands */
let navigationState: DiffNavigationState = {
  currentFileIndex: 0,
  currentHunkIndex: 0,
  totalFiles: 0,
  currentFile: null,
  hasSummary: false,
};

/** Cached diff result for navigation */
let cachedDiffResult: DiffResult | null = null;

/**
 * Reset navigation state
 */
function resetNavigation(): void {
  navigationState = {
    currentFileIndex: 0,
    currentHunkIndex: 0,
    totalFiles: 0,
    currentFile: null,
    hasSummary: false,
  };
  cachedDiffResult = null;
}

/**
 * Update navigation to current position
 */
function updateNavigation(result: DiffResult): void {
  cachedDiffResult = result;
  navigationState.totalFiles = result.files.length;
  if (result.files.length > 0) {
    navigationState.currentFile = result.files[0].path;
  }
}

// ============================================================================
// Git Diff Viewer Tool
// ============================================================================

/**
 * Get comprehensive git diff with structured output
 */
export const gitDiffViewerTool: AgentTool = {
  name: 'git_diff_viewer',
  description:
    'Get a comprehensive view of git changes with file-by-file diffs, statistics, and optional LLM-powered summarization. Supports both staged and unstaged changes.',
  parameters: {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'Show staged changes only (default: false shows unstaged)',
      },
      commit: {
        type: 'string',
        description: 'Compare with specific commit (e.g., HEAD~1, abc123)',
      },
      file: {
        type: 'string',
        description: 'Show diff for specific file only',
      },
      summarize: {
        type: 'boolean',
        description: 'Generate LLM-powered summary of changes (default: true)',
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
    const staged = params.staged === true;
    const commit = params.commit as string | undefined;
    const file = params.file as string | undefined;
    const summarize = params.summarize !== false;

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

      // Build diff command
      const diffArgs = ['diff', '--unified=3'];
      if (staged) diffArgs.push('--cached');
      if (commit) diffArgs.push(commit);
      if (file) diffArgs.push('--', file);

      const diffResult = await executeGitCommand(diffArgs, cwd);

      // Parse the diff
      const files = parseDiff(diffResult.stdout);

      // Get stats for accurate counts
      const stats = await getDiffStats(cwd, staged, commit);

      // Calculate totals
      let totalAdditions = 0;
      let totalDeletions = 0;

      for (const fileDiff of files) {
        const fileStats = stats.get(fileDiff.path);
        if (fileStats) {
          fileDiff.additions = fileStats.additions;
          fileDiff.deletions = fileStats.deletions;
        }
        totalAdditions += fileDiff.additions;
        totalDeletions += fileDiff.deletions;
      }

      const result: DiffResult = {
        staged,
        files,
        totalAdditions,
        totalDeletions,
        totalFiles: files.length,
        repoRoot,
        branch,
        commit,
      };

      // Update navigation state
      updateNavigation(result);

      // Generate summary if requested and there are changes
      let summary: DiffSummary | null = null;
      if (summarize && files.length > 0) {
        summary = await generateDiffSummary(files, totalAdditions, totalDeletions);
        if (summary) {
          navigationState.hasSummary = true;
        }
      }

      logger.info('Git diff viewer retrieved', {
        staged,
        filesCount: files.length,
        totalAdditions,
        totalDeletions,
      });

      return {
        success: true,
        data: {
          ...result,
          summary,
          navigation: navigationState,
        },
      };
    } catch (error) {
      logger.error('Git diff viewer error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to get diff: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Navigate to next/previous file in diff
 */
export const gitDiffNavigateTool: AgentTool = {
  name: 'git_diff_navigate',
  description:
    'Navigate through git diff files and hunks via voice commands. Use "next file", "previous file", "next hunk", or "previous hunk".',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Navigation action: "next_file", "prev_file", "next_hunk", "prev_hunk", "first_file", "last_file", "go_to_file"',
      },
      fileIndex: {
        type: 'number',
        description: 'File index for go_to_file action (0-based)',
      },
      fileName: {
        type: 'string',
        description: 'File name pattern to navigate to',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const fileIndex = params.fileIndex as number | undefined;
    const fileName = params.fileName as string | undefined;

    if (!cachedDiffResult || cachedDiffResult.files.length === 0) {
      return {
        success: false,
        error: 'No diff loaded. Use git_diff_viewer first to show changes.',
      };
    }

    const files = cachedDiffResult.files;

    switch (action) {
      case 'next_file':
        if (navigationState.currentFileIndex < files.length - 1) {
          navigationState.currentFileIndex++;
          navigationState.currentHunkIndex = 0;
        }
        break;

      case 'prev_file':
        if (navigationState.currentFileIndex > 0) {
          navigationState.currentFileIndex--;
          navigationState.currentHunkIndex = 0;
        }
        break;

      case 'first_file':
        navigationState.currentFileIndex = 0;
        navigationState.currentHunkIndex = 0;
        break;

      case 'last_file':
        navigationState.currentFileIndex = files.length - 1;
        navigationState.currentHunkIndex = 0;
        break;

      case 'next_hunk': {
        const currentFile = files[navigationState.currentFileIndex];
        if (currentFile && navigationState.currentHunkIndex < currentFile.hunks.length - 1) {
          navigationState.currentHunkIndex++;
        } else if (navigationState.currentFileIndex < files.length - 1) {
          // Move to next file
          navigationState.currentFileIndex++;
          navigationState.currentHunkIndex = 0;
        }
        break;
      }

      case 'prev_hunk': {
        if (navigationState.currentHunkIndex > 0) {
          navigationState.currentHunkIndex--;
        } else if (navigationState.currentFileIndex > 0) {
          // Move to previous file's last hunk
          navigationState.currentFileIndex--;
          const prevFile = files[navigationState.currentFileIndex];
          navigationState.currentHunkIndex = Math.max(0, prevFile.hunks.length - 1);
        }
        break;
      }

      case 'go_to_file':
        if (fileIndex !== undefined && fileIndex >= 0 && fileIndex < files.length) {
          navigationState.currentFileIndex = fileIndex;
          navigationState.currentHunkIndex = 0;
        } else if (fileName) {
          const idx = files.findIndex(
            (f) => f.path.toLowerCase().includes(fileName.toLowerCase())
          );
          if (idx >= 0) {
            navigationState.currentFileIndex = idx;
            navigationState.currentHunkIndex = 0;
          } else {
            return {
              success: false,
              error: `File "${fileName}" not found in diff`,
            };
          }
        } else {
          return {
            success: false,
            error: 'Provide fileIndex or fileName for go_to_file',
          };
        }
        break;

      default:
        return {
          success: false,
          error: `Unknown navigation action: ${action}`,
        };
    }

    // Get current file details
    const currentFile = files[navigationState.currentFileIndex];
    navigationState.currentFile = currentFile.path;

    const currentHunk =
      currentFile.hunks.length > 0
        ? currentFile.hunks[navigationState.currentHunkIndex]
        : null;

    return {
      success: true,
      data: {
        navigation: {
          ...navigationState,
          totalHunks: currentFile.hunks.length,
        },
        currentFile: {
          path: currentFile.path,
          changeType: currentFile.changeType,
          additions: currentFile.additions,
          deletions: currentFile.deletions,
          isBinary: currentFile.isBinary,
        },
        currentHunk: currentHunk
          ? {
              header: currentHunk.header,
              oldStart: currentHunk.oldStart,
              newStart: currentHunk.newStart,
              lineCount: currentHunk.lines.length,
              preview: currentHunk.lines.slice(0, 10).map((l) => ({
                type: l.type,
                content: l.content.substring(0, 100),
              })),
            }
          : null,
        position: `File ${navigationState.currentFileIndex + 1}/${files.length}${
          currentHunk ? `, Hunk ${navigationState.currentHunkIndex + 1}/${currentFile.hunks.length}` : ''
        }`,
      },
    };
  },
};

/**
 * Get diff summary for current navigation position
 */
export const gitDiffSummaryTool: AgentTool = {
  name: 'git_diff_summary',
  description:
    'Get a summary of the current file or overall diff changes. Voice command: "summarize changes" or "summarize this file".',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Summary scope: "all" for entire diff, "file" for current file',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const scope = (params.scope as string) || 'all';

    if (!cachedDiffResult || cachedDiffResult.files.length === 0) {
      return {
        success: false,
        error: 'No diff loaded. Use git_diff_viewer first.',
      };
    }

    if (scope === 'file') {
      const currentFile = cachedDiffResult.files[navigationState.currentFileIndex];
      if (!currentFile) {
        return {
          success: false,
          error: 'No current file selected',
        };
      }

      // Generate file-specific summary
      const fileSummary = await generateDiffSummary(
        [currentFile],
        currentFile.additions,
        currentFile.deletions
      );

      return {
        success: true,
        data: {
          scope: 'file',
          file: currentFile.path,
          changeType: currentFile.changeType,
          statistics: {
            additions: currentFile.additions,
            deletions: currentFile.deletions,
            hunks: currentFile.hunks.length,
          },
          summary: fileSummary,
        },
      };
    }

    // Generate overall summary
    const overallSummary = await generateDiffSummary(
      cachedDiffResult.files,
      cachedDiffResult.totalAdditions,
      cachedDiffResult.totalDeletions
    );

    return {
      success: true,
      data: {
        scope: 'all',
        statistics: {
          totalFiles: cachedDiffResult.totalFiles,
          totalAdditions: cachedDiffResult.totalAdditions,
          totalDeletions: cachedDiffResult.totalDeletions,
          staged: cachedDiffResult.staged,
          branch: cachedDiffResult.branch,
        },
        summary: overallSummary,
        files: cachedDiffResult.files.map((f) => ({
          path: f.path,
          changeType: f.changeType,
          additions: f.additions,
          deletions: f.deletions,
        })),
      },
    };
  },
};

/**
 * Accept or reject changes (voice command handler)
 */
export const gitDiffActionTool: AgentTool = {
  name: 'git_diff_action',
  description:
    'Perform actions on diff files. Voice commands: "accept change", "stage file", "unstage file", "discard changes".',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: "stage", "unstage", "discard", "stage_all", "unstage_all"',
      },
      file: {
        type: 'string',
        description:
          'File path (optional, defaults to current navigation file)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const action = params.action as string;
    const cwd = params.path as string | undefined;
    let file = params.file as string | undefined;

    // Use current navigation file if not specified
    if (!file && cachedDiffResult && navigationState.currentFile) {
      file = navigationState.currentFile;
    }

    try {
      switch (action) {
        case 'stage':
          if (!file) {
            return { success: false, error: 'No file specified to stage' };
          }
          await executeGitCommand(['add', file], cwd);
          return {
            success: true,
            data: { action: 'staged', file },
          };

        case 'unstage':
          if (!file) {
            return { success: false, error: 'No file specified to unstage' };
          }
          await executeGitCommand(['reset', 'HEAD', '--', file], cwd);
          return {
            success: true,
            data: { action: 'unstaged', file },
          };

        case 'discard':
          if (!file) {
            return { success: false, error: 'No file specified to discard' };
          }
          await executeGitCommand(['checkout', '--', file], cwd);
          return {
            success: true,
            data: { action: 'discarded', file },
          };

        case 'stage_all':
          await executeGitCommand(['add', '-A'], cwd);
          return {
            success: true,
            data: { action: 'staged_all' },
          };

        case 'unstage_all':
          await executeGitCommand(['reset', 'HEAD'], cwd);
          return {
            success: true,
            data: { action: 'unstaged_all' },
          };

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Action failed: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git diff viewer tools
 */
export function getGitDiffTools(): AgentTool[] {
  return [
    gitDiffViewerTool,
    gitDiffNavigateTool,
    gitDiffSummaryTool,
    gitDiffActionTool,
  ];
}

/**
 * Reset diff viewer state (for cleanup)
 */
export function resetDiffViewerState(): void {
  resetNavigation();
}

export default {
  gitDiffViewerTool,
  gitDiffNavigateTool,
  gitDiffSummaryTool,
  gitDiffActionTool,
  getGitDiffTools,
  resetDiffViewerState,
};
