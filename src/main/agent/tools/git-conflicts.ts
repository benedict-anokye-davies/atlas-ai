/**
 * Atlas Desktop - Git Conflict Resolution Tools
 *
 * Provides comprehensive git conflict detection, navigation, and resolution
 * capabilities for voice-driven merge/rebase conflict handling.
 *
 * Features:
 * - Detect merge/rebase conflicts
 * - Parse conflicting sections with context
 * - Voice commands for resolution: accept theirs, ours, both
 * - Navigate between conflicts
 * - Commit resolved files automatically
 * - Abort merge/rebase operations
 * - LLM-suggested resolutions
 *
 * @module agent/tools/git-conflicts
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitConflicts');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB
const MAX_FILE_SIZE = 1024 * 1024; // 1MB for conflict file reading

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a single conflict hunk within a file
 */
export interface ConflictHunk {
  /** Unique identifier for this hunk */
  id: string;
  /** Start line of the conflict marker <<<<<<< */
  startLine: number;
  /** End line of the conflict marker >>>>>>> */
  endLine: number;
  /** Content from the current branch (ours) */
  oursContent: string;
  /** Content from the incoming branch (theirs) */
  theirsContent: string;
  /** Base content (if 3-way merge, may be empty) */
  baseContent: string;
  /** Lines before the conflict for context */
  contextBefore: string[];
  /** Lines after the conflict for context */
  contextAfter: string[];
  /** Branch name for ours */
  oursBranch: string;
  /** Branch name for theirs */
  theirsBranch: string;
}

/**
 * Represents a file with conflicts
 */
export interface ConflictFile {
  /** File path relative to repo root */
  path: string;
  /** Absolute file path */
  absolutePath: string;
  /** Number of conflict hunks in this file */
  conflictCount: number;
  /** Conflict hunks */
  hunks: ConflictHunk[];
  /** File type/extension */
  fileType: string;
  /** Whether this is a binary file */
  isBinary: boolean;
}

/**
 * Current merge/rebase state
 */
export interface MergeState {
  /** Type of operation in progress */
  type: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'none';
  /** Whether there are conflicts */
  hasConflicts: boolean;
  /** Current branch name */
  currentBranch: string;
  /** Incoming branch/commit being merged */
  incomingRef: string;
  /** List of files with conflicts */
  conflictFiles: string[];
  /** Current step (for rebase) */
  currentStep?: number;
  /** Total steps (for rebase) */
  totalSteps?: number;
  /** Merge message if available */
  mergeMessage?: string;
}

/**
 * Resolution result
 */
export interface ResolutionResult {
  /** Whether resolution was successful */
  success: boolean;
  /** Resolved file path */
  filePath: string;
  /** Conflict hunk ID that was resolved */
  hunkId?: string;
  /** Resolution strategy used */
  strategy: 'ours' | 'theirs' | 'both' | 'manual' | 'llm';
  /** Remaining conflicts in file */
  remainingConflicts: number;
}

/**
 * LLM suggestion for conflict resolution
 */
export interface ConflictSuggestion {
  /** Suggested resolution content */
  resolvedContent: string;
  /** Explanation of the suggestion */
  explanation: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Strategy recommendation */
  recommendedStrategy: 'ours' | 'theirs' | 'both' | 'merge';
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
 * Parse conflict markers in file content
 */
function parseConflicts(content: string, filePath: string): ConflictHunk[] {
  const lines = content.split('\n');
  const hunks: ConflictHunk[] = [];
  let hunkIndex = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Look for conflict start marker
    if (line.startsWith('<<<<<<<')) {
      const startLine = i + 1; // 1-indexed
      const oursBranch = line.slice(8).trim() || 'HEAD';

      // Find separator (=======) and end marker (>>>>>>>)
      let separatorLine = -1;
      let baseSeparatorLine = -1;
      let endLine = -1;
      let theirsBranch = '';

      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('|||||||')) {
          baseSeparatorLine = j;
        } else if (lines[j].startsWith('=======')) {
          separatorLine = j;
        } else if (lines[j].startsWith('>>>>>>>')) {
          endLine = j + 1; // 1-indexed
          theirsBranch = lines[j].slice(8).trim() || 'incoming';
          break;
        }
      }

      if (separatorLine !== -1 && endLine !== -1) {
        // Extract content sections
        let oursContent: string;
        let baseContent = '';
        let theirsContent: string;

        if (baseSeparatorLine !== -1) {
          // 3-way merge with base
          oursContent = lines.slice(i + 1, baseSeparatorLine).join('\n');
          baseContent = lines.slice(baseSeparatorLine + 1, separatorLine).join('\n');
          theirsContent = lines.slice(separatorLine + 1, endLine - 1).join('\n');
        } else {
          // Standard 2-way merge
          oursContent = lines.slice(i + 1, separatorLine).join('\n');
          theirsContent = lines.slice(separatorLine + 1, endLine - 1).join('\n');
        }

        // Get context (up to 3 lines before and after)
        const contextBefore = lines.slice(Math.max(0, i - 3), i);
        const contextAfter = lines.slice(endLine, Math.min(lines.length, endLine + 3));

        hunks.push({
          id: `${path.basename(filePath)}-hunk-${hunkIndex++}`,
          startLine,
          endLine,
          oursContent,
          theirsContent,
          baseContent,
          contextBefore,
          contextAfter,
          oursBranch,
          theirsBranch,
        });

        i = endLine;
        continue;
      }
    }

    i++;
  }

  return hunks;
}

/**
 * Resolve a specific conflict hunk with given strategy
 */
async function resolveHunk(
  filePath: string,
  hunk: ConflictHunk,
  strategy: 'ours' | 'theirs' | 'both' | 'manual',
  manualContent?: string
): Promise<string> {
  // Read current file
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // Determine resolved content
  let resolvedContent: string;
  switch (strategy) {
    case 'ours':
      resolvedContent = hunk.oursContent;
      break;
    case 'theirs':
      resolvedContent = hunk.theirsContent;
      break;
    case 'both':
      // Combine both versions with ours first
      resolvedContent = hunk.oursContent + '\n' + hunk.theirsContent;
      break;
    case 'manual':
      resolvedContent = manualContent || '';
      break;
    default:
      resolvedContent = hunk.oursContent;
  }

  // Find and replace the conflict block
  // We need to find the exact conflict markers
  let inConflict = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _conflictStart = -1;
  const newLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('<<<<<<<') && i + 1 === hunk.startLine) {
      inConflict = true;
      // conflictStart would be used for more complex resolution logic
      continue;
    }

    if (inConflict) {
      if (line.startsWith('>>>>>>>') && i + 1 === hunk.endLine) {
        // End of conflict - insert resolved content
        newLines.push(...resolvedContent.split('\n'));
        inConflict = false;
        continue;
      }
      // Skip conflict markers and conflict content
      continue;
    }

    newLines.push(line);
  }

  return newLines.join('\n');
}

// ============================================================================
// Git Conflict Detection Tool
// ============================================================================

/**
 * Detect and list all conflicts in the repository
 */
export const gitConflictDetectTool: AgentTool = {
  name: 'git_conflict_detect',
  description:
    'Detect merge, rebase, or cherry-pick conflicts in the repository. Returns detailed information about each conflicting file and the current merge state.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();

      // Determine merge state
      const mergeState: MergeState = {
        type: 'none',
        hasConflicts: false,
        currentBranch: '',
        incomingRef: '',
        conflictFiles: [],
      };

      // Get current branch
      const branchResult = await executeGitCommand(['branch', '--show-current'], cwd);
      mergeState.currentBranch = branchResult.stdout || 'HEAD';

      // Check for merge in progress
      const mergeHeadResult = await executeGitCommand(['rev-parse', '--verify', 'MERGE_HEAD'], cwd);
      if (mergeHeadResult.success) {
        mergeState.type = 'merge';
        const mergeBranchResult = await executeGitCommand(
          ['name-rev', '--name-only', 'MERGE_HEAD'],
          cwd
        );
        mergeState.incomingRef = mergeBranchResult.stdout || 'MERGE_HEAD';

        // Try to get merge message
        try {
          const mergeMsgPath = path.join(repoRoot, '.git', 'MERGE_MSG');
          mergeState.mergeMessage = await fs.readFile(mergeMsgPath, 'utf-8');
        } catch {
          // No merge message available
        }
      }

      // Check for rebase in progress
      const rebaseHeadResult = await executeGitCommand(
        ['rev-parse', '--verify', 'REBASE_HEAD'],
        cwd
      );
      if (
        rebaseHeadResult.success ||
        (await fs
          .access(path.join(repoRoot, '.git', 'rebase-merge'))
          .then(() => true)
          .catch(() => false)) ||
        (await fs
          .access(path.join(repoRoot, '.git', 'rebase-apply'))
          .then(() => true)
          .catch(() => false))
      ) {
        mergeState.type = 'rebase';

        // Try to get rebase progress
        try {
          const rebaseMergePath = path.join(repoRoot, '.git', 'rebase-merge');
          const msgNumContent = await fs
            .readFile(path.join(rebaseMergePath, 'msgnum'), 'utf-8')
            .catch(() => '');
          const endContent = await fs
            .readFile(path.join(rebaseMergePath, 'end'), 'utf-8')
            .catch(() => '');

          if (msgNumContent && endContent) {
            mergeState.currentStep = parseInt(msgNumContent.trim(), 10);
            mergeState.totalSteps = parseInt(endContent.trim(), 10);
          }

          const ontoBranch = await fs
            .readFile(path.join(rebaseMergePath, 'onto'), 'utf-8')
            .catch(() => '');
          if (ontoBranch) {
            const ontoNameResult = await executeGitCommand(
              ['name-rev', '--name-only', ontoBranch.trim()],
              cwd
            );
            mergeState.incomingRef = ontoNameResult.stdout || ontoBranch.trim();
          }
        } catch {
          // Rebase info not fully available
        }
      }

      // Check for cherry-pick in progress
      const cherryPickHeadResult = await executeGitCommand(
        ['rev-parse', '--verify', 'CHERRY_PICK_HEAD'],
        cwd
      );
      if (cherryPickHeadResult.success) {
        mergeState.type = 'cherry-pick';
        mergeState.incomingRef = cherryPickHeadResult.stdout.slice(0, 8);
      }

      // Check for revert in progress
      const revertHeadResult = await executeGitCommand(
        ['rev-parse', '--verify', 'REVERT_HEAD'],
        cwd
      );
      if (revertHeadResult.success) {
        mergeState.type = 'revert';
        mergeState.incomingRef = revertHeadResult.stdout.slice(0, 8);
      }

      // Get list of conflicting files
      const statusResult = await executeGitCommand(['status', '--porcelain=v2'], cwd);

      const conflictFiles: ConflictFile[] = [];

      for (const line of statusResult.stdout.split('\n')) {
        // Unmerged entries start with 'u'
        if (line.startsWith('u ')) {
          const parts = line.split('\t');
          const filePath = parts[parts.length - 1] || '';
          const absolutePath = path.join(repoRoot, filePath);

          // Check if file is binary
          const isBinaryResult = await executeGitCommand(
            ['diff', '--numstat', '--', filePath],
            cwd
          );
          const isBinary = isBinaryResult.stdout.startsWith('-\t-');

          if (isBinary) {
            conflictFiles.push({
              path: filePath,
              absolutePath,
              conflictCount: 1,
              hunks: [],
              fileType: path.extname(filePath) || 'binary',
              isBinary: true,
            });
          } else {
            // Parse conflict hunks for text files
            try {
              const fileContent = await fs.readFile(absolutePath, 'utf-8');
              const hunks = parseConflicts(fileContent, filePath);

              conflictFiles.push({
                path: filePath,
                absolutePath,
                conflictCount: hunks.length,
                hunks,
                fileType: path.extname(filePath) || 'text',
                isBinary: false,
              });
            } catch (error) {
              logger.warn('Failed to parse conflict file', {
                file: filePath,
                error: (error as Error).message,
              });
              conflictFiles.push({
                path: filePath,
                absolutePath,
                conflictCount: 1,
                hunks: [],
                fileType: path.extname(filePath) || 'unknown',
                isBinary: false,
              });
            }
          }

          mergeState.conflictFiles.push(filePath);
        }
      }

      mergeState.hasConflicts = conflictFiles.length > 0;

      const totalConflicts = conflictFiles.reduce((sum, file) => sum + file.conflictCount, 0);

      logger.info('Conflict detection complete', {
        mergeType: mergeState.type,
        fileCount: conflictFiles.length,
        totalConflicts,
      });

      return {
        success: true,
        data: {
          mergeState,
          conflictFiles,
          totalConflicts,
          summary: mergeState.hasConflicts
            ? `Found ${totalConflicts} conflict(s) in ${conflictFiles.length} file(s) during ${mergeState.type}`
            : 'No conflicts detected',
        },
      };
    } catch (error) {
      logger.error('Conflict detection error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to detect conflicts: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Show Tool
// ============================================================================

/**
 * Show details of a specific conflict
 */
export const gitConflictShowTool: AgentTool = {
  name: 'git_conflict_show',
  description:
    'Show detailed information about a specific conflict, including the conflicting sections and context. Use this to understand what needs to be resolved.',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the conflicting file',
      },
      hunkIndex: {
        type: 'number',
        description:
          'Index of the conflict hunk to show (0-based). Omit to show all conflicts in the file.',
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
    const hunkIndex = params.hunkIndex as number | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();
      const absolutePath = path.isAbsolute(file) ? file : path.join(repoRoot, file);

      // Check if file exists
      try {
        const stats = await fs.stat(absolutePath);
        if (stats.size > MAX_FILE_SIZE) {
          return {
            success: false,
            error: 'File too large to parse for conflicts',
          };
        }
      } catch {
        return { success: false, error: `File not found: ${file}` };
      }

      // Read and parse conflicts
      const content = await fs.readFile(absolutePath, 'utf-8');
      const hunks = parseConflicts(content, file);

      if (hunks.length === 0) {
        return {
          success: true,
          data: {
            file,
            hasConflicts: false,
            message: 'No conflicts found in this file',
          },
        };
      }

      // Return specific hunk or all hunks
      if (hunkIndex !== undefined) {
        if (hunkIndex < 0 || hunkIndex >= hunks.length) {
          return {
            success: false,
            error: `Invalid hunk index. File has ${hunks.length} conflict(s) (0-${hunks.length - 1})`,
          };
        }

        const hunk = hunks[hunkIndex];
        return {
          success: true,
          data: {
            file,
            hunkIndex,
            totalHunks: hunks.length,
            hunk,
            summary: `Conflict ${hunkIndex + 1}/${hunks.length}: Lines ${hunk.startLine}-${hunk.endLine}`,
          },
        };
      }

      return {
        success: true,
        data: {
          file,
          totalHunks: hunks.length,
          hunks,
          summary: `${hunks.length} conflict(s) found in ${file}`,
        },
      };
    } catch (error) {
      logger.error('Show conflict error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to show conflict: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Resolve Tool
// ============================================================================

/**
 * Resolve a conflict using a specific strategy
 */
export const gitConflictResolveTool: AgentTool = {
  name: 'git_conflict_resolve',
  description:
    'Resolve a git conflict using a specified strategy. Can accept "ours" (keep our version), "theirs" (accept incoming version), or "both" (keep both versions).',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the conflicting file',
      },
      strategy: {
        type: 'string',
        description: 'Resolution strategy: "ours", "theirs", "both", or "manual"',
        enum: ['ours', 'theirs', 'both', 'manual'],
      },
      hunkIndex: {
        type: 'number',
        description:
          'Index of specific conflict hunk to resolve (0-based). Omit to resolve all conflicts in the file.',
      },
      manualContent: {
        type: 'string',
        description: 'Manual resolution content (required when strategy is "manual")',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['file', 'strategy'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const file = params.file as string;
    const strategy = params.strategy as 'ours' | 'theirs' | 'both' | 'manual';
    const hunkIndex = params.hunkIndex as number | undefined;
    const manualContent = params.manualContent as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (strategy === 'manual' && !manualContent) {
        return {
          success: false,
          error: 'Manual resolution requires manualContent parameter',
        };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();
      const absolutePath = path.isAbsolute(file) ? file : path.join(repoRoot, file);

      // Read and parse current conflicts
      const content = await fs.readFile(absolutePath, 'utf-8');
      const hunks = parseConflicts(content, file);

      if (hunks.length === 0) {
        return {
          success: true,
          data: {
            file,
            resolved: false,
            message: 'No conflicts found in this file',
          },
        };
      }

      let resolvedContent: string;
      let resolvedHunks = 0;

      if (hunkIndex !== undefined) {
        // Resolve specific hunk
        if (hunkIndex < 0 || hunkIndex >= hunks.length) {
          return {
            success: false,
            error: `Invalid hunk index. File has ${hunks.length} conflict(s)`,
          };
        }

        resolvedContent = await resolveHunk(
          absolutePath,
          hunks[hunkIndex],
          strategy,
          manualContent
        );
        resolvedHunks = 1;
      } else {
        // Resolve all hunks in reverse order to preserve line numbers
        let currentContent = content;
        const sortedHunks = [...hunks].sort((a, b) => b.startLine - a.startLine);

        for (const hunk of sortedHunks) {
          // Re-parse to get updated positions
          const currentHunks = parseConflicts(currentContent, file);
          const matchingHunk = currentHunks.find((h) => h.startLine === hunk.startLine);

          if (matchingHunk) {
            // Write temp file, resolve, read back
            const tempPath = absolutePath + '.tmp';
            await fs.writeFile(tempPath, currentContent);
            currentContent = await resolveHunk(tempPath, matchingHunk, strategy, manualContent);
            await fs.unlink(tempPath);
            resolvedHunks++;
          }
        }

        resolvedContent = currentContent;
      }

      // Write resolved content
      await fs.writeFile(absolutePath, resolvedContent);

      // Check remaining conflicts
      const remainingHunks = parseConflicts(resolvedContent, file);

      // Stage the file if no conflicts remain
      if (remainingHunks.length === 0) {
        await executeGitCommand(['add', file], cwd);
      }

      logger.info('Conflict resolved', {
        file,
        strategy,
        resolvedHunks,
        remainingConflicts: remainingHunks.length,
      });

      return {
        success: true,
        data: {
          success: true,
          filePath: file,
          strategy,
          remainingConflicts: remainingHunks.length,
          resolvedHunks,
          staged: remainingHunks.length === 0,
          message:
            remainingHunks.length === 0
              ? `Resolved all conflicts in ${file} and staged for commit`
              : `Resolved ${resolvedHunks} conflict(s), ${remainingHunks.length} remaining`,
        } as ResolutionResult & { resolvedHunks: number; staged: boolean; message: string },
      };
    } catch (error) {
      logger.error('Conflict resolution error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to resolve conflict: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Accept File Tool
// ============================================================================

/**
 * Accept entire file using ours or theirs version
 */
export const gitConflictAcceptFileTool: AgentTool = {
  name: 'git_conflict_accept_file',
  description:
    "Accept an entire file using either our version or their version. Useful when you want to completely discard one side's changes.",
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the conflicting file',
      },
      accept: {
        type: 'string',
        description: 'Which version to accept: "ours" or "theirs"',
        enum: ['ours', 'theirs'],
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['file', 'accept'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const file = params.file as string;
    const accept = params.accept as 'ours' | 'theirs';

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Use git checkout --ours/--theirs
      const checkoutArg = accept === 'ours' ? '--ours' : '--theirs';
      const result = await executeGitCommand(['checkout', checkoutArg, '--', file], cwd);

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || `Failed to accept ${accept} version`,
        };
      }

      // Stage the resolved file
      await executeGitCommand(['add', file], cwd);

      logger.info('File accepted', { file, accept });

      return {
        success: true,
        data: {
          file,
          accepted: accept,
          staged: true,
          message: `Accepted ${accept} version of ${file} and staged for commit`,
        },
      };
    } catch (error) {
      logger.error('Accept file error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to accept file: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Abort Tool
// ============================================================================

/**
 * Abort current merge, rebase, cherry-pick, or revert operation
 */
export const gitConflictAbortTool: AgentTool = {
  name: 'git_conflict_abort',
  description:
    'Abort the current merge, rebase, cherry-pick, or revert operation. This will restore the repository to its state before the operation started.',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description:
          'Operation to abort: "merge", "rebase", "cherry-pick", or "revert". If not specified, will auto-detect.',
        enum: ['merge', 'rebase', 'cherry-pick', 'revert'],
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
    let operation = params.operation as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Auto-detect operation if not specified
      if (!operation) {
        const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();

        // Check merge
        const mergeHeadResult = await executeGitCommand(
          ['rev-parse', '--verify', 'MERGE_HEAD'],
          cwd
        );
        if (mergeHeadResult.success) {
          operation = 'merge';
        }

        // Check rebase
        if (!operation) {
          const rebaseExists =
            (await fs
              .access(path.join(repoRoot, '.git', 'rebase-merge'))
              .then(() => true)
              .catch(() => false)) ||
            (await fs
              .access(path.join(repoRoot, '.git', 'rebase-apply'))
              .then(() => true)
              .catch(() => false));
          if (rebaseExists) {
            operation = 'rebase';
          }
        }

        // Check cherry-pick
        if (!operation) {
          const cherryPickResult = await executeGitCommand(
            ['rev-parse', '--verify', 'CHERRY_PICK_HEAD'],
            cwd
          );
          if (cherryPickResult.success) {
            operation = 'cherry-pick';
          }
        }

        // Check revert
        if (!operation) {
          const revertResult = await executeGitCommand(
            ['rev-parse', '--verify', 'REVERT_HEAD'],
            cwd
          );
          if (revertResult.success) {
            operation = 'revert';
          }
        }

        if (!operation) {
          return {
            success: false,
            error: 'No merge, rebase, cherry-pick, or revert operation in progress',
          };
        }
      }

      // Execute abort
      const abortResult = await executeGitCommand([operation, '--abort'], cwd);

      if (!abortResult.success) {
        return {
          success: false,
          error: abortResult.stderr || `Failed to abort ${operation}`,
        };
      }

      logger.info('Operation aborted', { operation });

      return {
        success: true,
        data: {
          operation,
          aborted: true,
          message: `Successfully aborted ${operation} operation`,
        },
      };
    } catch (error) {
      logger.error('Abort operation error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to abort operation: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Continue Tool
// ============================================================================

/**
 * Continue after resolving conflicts
 */
export const gitConflictContinueTool: AgentTool = {
  name: 'git_conflict_continue',
  description:
    'Continue the current merge, rebase, cherry-pick, or revert operation after resolving all conflicts. For merge, this creates a merge commit.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'Commit message (for merge operations). If not provided, default merge message is used.',
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
    const message = params.message as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();

      // Check for remaining conflicts
      const statusResult = await executeGitCommand(['status', '--porcelain=v2'], cwd);

      const hasConflicts = statusResult.stdout.split('\n').some((line) => line.startsWith('u '));

      if (hasConflicts) {
        return {
          success: false,
          error: 'Cannot continue: there are still unresolved conflicts',
        };
      }

      // Detect operation type
      let operation: string | null = null;

      const mergeHeadResult = await executeGitCommand(['rev-parse', '--verify', 'MERGE_HEAD'], cwd);
      if (mergeHeadResult.success) {
        operation = 'merge';
      }

      if (!operation) {
        const rebaseExists =
          (await fs
            .access(path.join(repoRoot, '.git', 'rebase-merge'))
            .then(() => true)
            .catch(() => false)) ||
          (await fs
            .access(path.join(repoRoot, '.git', 'rebase-apply'))
            .then(() => true)
            .catch(() => false));
        if (rebaseExists) {
          operation = 'rebase';
        }
      }

      if (!operation) {
        const cherryPickResult = await executeGitCommand(
          ['rev-parse', '--verify', 'CHERRY_PICK_HEAD'],
          cwd
        );
        if (cherryPickResult.success) {
          operation = 'cherry-pick';
        }
      }

      if (!operation) {
        const revertResult = await executeGitCommand(['rev-parse', '--verify', 'REVERT_HEAD'], cwd);
        if (revertResult.success) {
          operation = 'revert';
        }
      }

      if (!operation) {
        return {
          success: false,
          error: 'No merge, rebase, cherry-pick, or revert operation in progress',
        };
      }

      let result;
      if (operation === 'merge') {
        // For merge, we commit directly
        const commitArgs = ['commit'];
        if (message) {
          commitArgs.push('-m', message);
        } else {
          commitArgs.push('--no-edit');
        }
        result = await executeGitCommand(commitArgs, cwd);
      } else {
        // For rebase, cherry-pick, revert - use --continue
        result = await executeGitCommand([operation, '--continue'], cwd);
      }

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || `Failed to continue ${operation}`,
        };
      }

      logger.info('Operation continued', { operation });

      return {
        success: true,
        data: {
          operation,
          continued: true,
          message: `Successfully continued ${operation} operation`,
          output: result.stdout,
        },
      };
    } catch (error) {
      logger.error('Continue operation error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to continue operation: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Navigate Tool
// ============================================================================

/**
 * Navigate between conflicts (for voice navigation)
 */
export const gitConflictNavigateTool: AgentTool = {
  name: 'git_conflict_navigate',
  description:
    'Navigate between conflicts for voice-driven conflict resolution. Returns the next or previous conflict based on current position.',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        description: 'Navigation direction: "next" or "previous"',
        enum: ['next', 'previous'],
      },
      currentFile: {
        type: 'string',
        description: 'Current file path (for context)',
      },
      currentHunkIndex: {
        type: 'number',
        description: 'Current hunk index within file (0-based)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['direction'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const direction = params.direction as 'next' | 'previous';
    const currentFile = params.currentFile as string | undefined;
    const currentHunkIndex = params.currentHunkIndex as number | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();

      // Get all conflict files
      const statusResult = await executeGitCommand(['status', '--porcelain=v2'], cwd);

      const conflictFilePaths: string[] = [];
      for (const line of statusResult.stdout.split('\n')) {
        if (line.startsWith('u ')) {
          const parts = line.split('\t');
          const filePath = parts[parts.length - 1] || '';
          conflictFilePaths.push(filePath);
        }
      }

      if (conflictFilePaths.length === 0) {
        return {
          success: true,
          data: {
            hasMore: false,
            message: 'No conflicts to navigate',
          },
        };
      }

      // Build flat list of all conflict positions
      const allConflicts: Array<{ file: string; hunkIndex: number; hunk: ConflictHunk }> = [];

      for (const filePath of conflictFilePaths) {
        const absolutePath = path.join(repoRoot, filePath);
        try {
          const content = await fs.readFile(absolutePath, 'utf-8');
          const hunks = parseConflicts(content, filePath);
          hunks.forEach((hunk, index) => {
            allConflicts.push({ file: filePath, hunkIndex: index, hunk });
          });
        } catch {
          // Skip files that can't be read
        }
      }

      if (allConflicts.length === 0) {
        return {
          success: true,
          data: {
            hasMore: false,
            message: 'No conflicts found in files',
          },
        };
      }

      // Find current position
      let currentPosition = -1;
      if (currentFile !== undefined && currentHunkIndex !== undefined) {
        currentPosition = allConflicts.findIndex(
          (c) => c.file === currentFile && c.hunkIndex === currentHunkIndex
        );
      }

      // Calculate next position
      let nextPosition: number;
      if (direction === 'next') {
        nextPosition = currentPosition + 1;
        if (nextPosition >= allConflicts.length) {
          return {
            success: true,
            data: {
              hasMore: false,
              message: 'No more conflicts ahead',
              currentPosition: currentPosition,
              totalConflicts: allConflicts.length,
            },
          };
        }
      } else {
        nextPosition = currentPosition - 1;
        if (nextPosition < 0) {
          return {
            success: true,
            data: {
              hasMore: false,
              message: 'No more conflicts before',
              currentPosition: currentPosition,
              totalConflicts: allConflicts.length,
            },
          };
        }
      }

      const nextConflict = allConflicts[nextPosition];

      return {
        success: true,
        data: {
          hasMore: true,
          file: nextConflict.file,
          hunkIndex: nextConflict.hunkIndex,
          hunk: nextConflict.hunk,
          position: nextPosition + 1,
          total: allConflicts.length,
          message: `Conflict ${nextPosition + 1} of ${allConflicts.length}: ${nextConflict.file}`,
        },
      };
    } catch (error) {
      logger.error('Navigate conflicts error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to navigate conflicts: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Git Conflict Suggest Tool (LLM Integration)
// ============================================================================

/**
 * Get LLM suggestions for conflict resolution
 * Note: This tool generates a prompt for the LLM to analyze, but actual LLM
 * call should be made by the agent orchestrator
 */
export const gitConflictSuggestTool: AgentTool = {
  name: 'git_conflict_suggest',
  description:
    'Generate a detailed analysis prompt for LLM to suggest how to resolve a conflict. Returns the conflict context formatted for LLM analysis.',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the conflicting file',
      },
      hunkIndex: {
        type: 'number',
        description: 'Index of the conflict hunk to analyze (0-based)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['file', 'hunkIndex'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const file = params.file as string;
    const hunkIndex = params.hunkIndex as number;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = (await getRepoRoot(cwd)) || cwd || process.cwd();
      const absolutePath = path.isAbsolute(file) ? file : path.join(repoRoot, file);

      // Read and parse conflicts
      const content = await fs.readFile(absolutePath, 'utf-8');
      const hunks = parseConflicts(content, file);

      if (hunkIndex < 0 || hunkIndex >= hunks.length) {
        return {
          success: false,
          error: `Invalid hunk index. File has ${hunks.length} conflict(s)`,
        };
      }

      const hunk = hunks[hunkIndex];
      const fileExtension = path.extname(file);

      // Generate analysis prompt
      const analysisPrompt = `
Analyze this git merge conflict and suggest the best resolution:

**File:** ${file} (${fileExtension || 'text'})

**Context Before:**
\`\`\`
${hunk.contextBefore.join('\n')}
\`\`\`

**Our Changes (${hunk.oursBranch}):**
\`\`\`${fileExtension}
${hunk.oursContent}
\`\`\`

**Their Changes (${hunk.theirsBranch}):**
\`\`\`${fileExtension}
${hunk.theirsContent}
\`\`\`

${
  hunk.baseContent
    ? `**Common Base:**
\`\`\`${fileExtension}
${hunk.baseContent}
\`\`\`
`
    : ''
}

**Context After:**
\`\`\`
${hunk.contextAfter.join('\n')}
\`\`\`

Please analyze:
1. What is the purpose of each change?
2. Are the changes compatible or truly conflicting?
3. Recommend a resolution strategy: "ours", "theirs", "both", or a merged version
4. If merging is recommended, provide the merged code

Respond with:
- **Recommendation:** [strategy]
- **Confidence:** [high/medium/low]
- **Explanation:** [brief explanation]
- **Merged Code (if applicable):**
\`\`\`${fileExtension}
[merged code here]
\`\`\`
`;

      return {
        success: true,
        data: {
          file,
          hunkIndex,
          hunk,
          analysisPrompt,
          message: 'Analysis prompt generated. Send to LLM for resolution suggestion.',
        },
      };
    } catch (error) {
      logger.error('Suggest conflict error', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to generate suggestion: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git conflict resolution tools
 */
export function getGitConflictTools(): AgentTool[] {
  return [
    gitConflictDetectTool,
    gitConflictShowTool,
    gitConflictResolveTool,
    gitConflictAcceptFileTool,
    gitConflictAbortTool,
    gitConflictContinueTool,
    gitConflictNavigateTool,
    gitConflictSuggestTool,
  ];
}

export default {
  gitConflictDetectTool,
  gitConflictShowTool,
  gitConflictResolveTool,
  gitConflictAcceptFileTool,
  gitConflictAbortTool,
  gitConflictContinueTool,
  gitConflictNavigateTool,
  gitConflictSuggestTool,
  getGitConflictTools,
};
