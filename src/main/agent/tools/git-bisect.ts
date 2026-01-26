/**
 * Atlas Desktop - Git Bisect Assistant Tool
 *
 * Provides comprehensive git bisect functionality for finding bug-introducing commits.
 * Supports voice commands like "Start bisect", "Mark as good", "Mark as bad",
 * automated test execution, progress tracking, and session history.
 *
 * @module agent/tools/git-bisect
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitBisectTool');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const TEST_TIMEOUT = 120000; // 2 minutes for tests
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB
const BISECT_HISTORY_FILE = '.atlas-bisect-history.json';

// ============================================================================
// Git Bisect Types
// ============================================================================

/**
 * Current bisect session state
 */
export interface BisectSessionState {
  /** Whether a bisect is currently in progress */
  inProgress: boolean;
  /** Good (known working) commit SHA */
  goodCommit?: string;
  /** Bad (known broken) commit SHA */
  badCommit?: string;
  /** Current commit being tested */
  currentCommit?: string;
  /** Total number of commits to test */
  totalCommits: number;
  /** Number of commits remaining */
  remainingCommits: number;
  /** Estimated steps remaining */
  stepsRemaining: number;
  /** History of tested commits */
  testedCommits: BisectCommitResult[];
  /** Start time of bisect session */
  startTime?: number;
  /** Test command for automated testing */
  testCommand?: string;
  /** Session ID */
  sessionId?: string;
}

/**
 * Result of testing a single commit during bisect
 */
export interface BisectCommitResult {
  /** Commit SHA */
  sha: string;
  /** Short SHA */
  shortSha: string;
  /** Commit message subject */
  subject: string;
  /** Whether commit was marked good */
  isGood?: boolean;
  /** Whether commit was marked bad */
  isBad?: boolean;
  /** Whether commit was skipped */
  isSkipped?: boolean;
  /** Test output if automated */
  testOutput?: string;
  /** Test exit code if automated */
  testExitCode?: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Commit suggestion for next test
 */
export interface BisectCommitSuggestion {
  /** Suggested commit SHA */
  sha: string;
  /** Short SHA */
  shortSha: string;
  /** Commit message subject */
  subject: string;
  /** Author */
  author: string;
  /** Commit date */
  date: string;
  /** Why this commit is suggested */
  reason: string;
  /** Number of commits this would eliminate */
  eliminates: number;
}

/**
 * Bisect completion result
 */
export interface BisectCompletionResult {
  /** Found culprit commit SHA */
  culpritSha: string;
  /** Short SHA */
  culpritShortSha: string;
  /** Commit message */
  culpritMessage: string;
  /** Author */
  culpritAuthor: string;
  /** Commit date */
  culpritDate: string;
  /** Files changed in culprit commit */
  filesChanged: string[];
  /** Total steps taken */
  stepsTaken: number;
  /** Total time elapsed (ms) */
  timeElapsed: number;
  /** Session history */
  history: BisectCommitResult[];
}

/**
 * Bisect session history entry
 */
export interface BisectHistoryEntry {
  /** Session ID */
  sessionId: string;
  /** Start time */
  startTime: number;
  /** End time */
  endTime?: number;
  /** Repository path */
  repoPath: string;
  /** Good commit */
  goodCommit: string;
  /** Bad commit */
  badCommit: string;
  /** Culprit commit (if found) */
  culpritCommit?: string;
  /** Test command used */
  testCommand?: string;
  /** Steps taken */
  stepsTaken: number;
  /** Status */
  status: 'completed' | 'aborted' | 'in_progress';
  /** Tested commits */
  testedCommits: BisectCommitResult[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a git command and return the result
 */
async function executeGitCommand(
  args: string[],
  cwd?: string,
  timeout: number = DEFAULT_TIMEOUT
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

    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: 'Command timed out',
        exitCode: -1,
      });
    }, timeout);

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
      clearTimeout(timeoutHandle);
      resolve({
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutHandle);
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
 * Execute a shell command (for running tests)
 */
async function executeShellCommand(
  command: string,
  cwd?: string,
  timeout: number = TEST_TIMEOUT
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  const workingDir = cwd ? path.resolve(cwd) : process.cwd();
  const isWindows = os.platform() === 'win32';

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: workingDir,
      shell: true,
      windowsHide: true,
    };

    const proc = isWindows
      ? spawn('cmd', ['/c', command], spawnOptions)
      : spawn('sh', ['-c', command], spawnOptions);

    let stdout = '';
    let stderr = '';

    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: 'Test command timed out',
        exitCode: -1,
      });
    }, timeout);

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
      clearTimeout(timeoutHandle);
      resolve({
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutHandle);
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
 * Check if a bisect is in progress
 */
async function isBisectInProgress(cwd?: string): Promise<boolean> {
  const result = await executeGitCommand(['bisect', 'log'], cwd);
  return result.success && result.stdout.length > 0;
}

/**
 * Get commit info by SHA
 */
async function getCommitInfo(
  sha: string,
  cwd?: string
): Promise<{ sha: string; shortSha: string; subject: string; author: string; date: string } | null> {
  const result = await executeGitCommand(
    ['log', '-1', '--format=%H|%h|%s|%an|%aI', sha],
    cwd
  );

  if (!result.success || !result.stdout) {
    return null;
  }

  const [fullSha, shortSha, subject, author, date] = result.stdout.split('|');
  return { sha: fullSha, shortSha, subject, author, date };
}

/**
 * Get repository root path
 */
async function getRepoRoot(cwd?: string): Promise<string | null> {
  const result = await executeGitCommand(['rev-parse', '--show-toplevel'], cwd);
  return result.success ? result.stdout : null;
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return `bisect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Load bisect history from file
 */
async function loadBisectHistory(repoPath: string): Promise<BisectHistoryEntry[]> {
  const historyPath = path.join(repoPath, BISECT_HISTORY_FILE);
  try {
    const content = await fs.readFile(historyPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Save bisect history to file
 */
async function saveBisectHistory(repoPath: string, history: BisectHistoryEntry[]): Promise<void> {
  const historyPath = path.join(repoPath, BISECT_HISTORY_FILE);
  try {
    // Keep only last 50 entries
    const trimmedHistory = history.slice(-50);
    await fs.writeFile(historyPath, JSON.stringify(trimmedHistory, null, 2));
  } catch (error) {
    logger.warn('Failed to save bisect history', { error: (error as Error).message });
  }
}

/**
 * Parse bisect log to get current state
 */
async function parseBisectState(cwd?: string): Promise<BisectSessionState> {
  const logResult = await executeGitCommand(['bisect', 'log'], cwd);

  const state: BisectSessionState = {
    inProgress: false,
    totalCommits: 0,
    remainingCommits: 0,
    stepsRemaining: 0,
    testedCommits: [],
  };

  if (!logResult.success || !logResult.stdout) {
    return state;
  }

  state.inProgress = true;
  const lines = logResult.stdout.split('\n');

  for (const line of lines) {
    // Parse good commit
    const goodMatch = line.match(/git bisect good ([a-f0-9]+)/);
    if (goodMatch) {
      state.goodCommit = goodMatch[1];
      continue;
    }

    // Parse bad commit
    const badMatch = line.match(/git bisect bad ([a-f0-9]+)/);
    if (badMatch) {
      state.badCommit = badMatch[1];
      continue;
    }

    // Parse start
    const startMatch = line.match(/git bisect start/);
    if (startMatch) {
      continue;
    }
  }

  // Get current HEAD
  const headResult = await executeGitCommand(['rev-parse', 'HEAD'], cwd);
  if (headResult.success) {
    state.currentCommit = headResult.stdout;
  }

  // Get remaining steps estimate
  const visualizeResult = await executeGitCommand(['bisect', 'visualize', '--oneline'], cwd);
  if (visualizeResult.success) {
    const commits = visualizeResult.stdout.split('\n').filter((l) => l.trim());
    state.totalCommits = commits.length;
    state.remainingCommits = commits.length;
    state.stepsRemaining = Math.ceil(Math.log2(commits.length + 1));
  }

  return state;
}

/**
 * Calculate number of commits between two refs
 */
async function getCommitCount(goodRef: string, badRef: string, cwd?: string): Promise<number> {
  const result = await executeGitCommand(
    ['rev-list', '--count', `${goodRef}..${badRef}`],
    cwd
  );
  return result.success ? parseInt(result.stdout, 10) || 0 : 0;
}

// ============================================================================
// Git Bisect Tools
// ============================================================================

/**
 * Start a git bisect session
 */
export const gitBisectStartTool: AgentTool = {
  name: 'git_bisect_start',
  description:
    'Start a git bisect session to find the commit that introduced a bug. ' +
    'Specify a known good commit (working) and a bad commit (broken). ' +
    'Voice: "Start bisect", "Find when bug was introduced", "Bisect from commit X to Y".',
  parameters: {
    type: 'object',
    properties: {
      goodCommit: {
        type: 'string',
        description: 'SHA or ref of a known good (working) commit',
      },
      badCommit: {
        type: 'string',
        description: 'SHA or ref of a known bad (broken) commit. Default: HEAD',
      },
      testCommand: {
        type: 'string',
        description:
          'Optional test command to run automatically. If exit code is 0, commit is good; otherwise bad.',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['goodCommit'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const goodCommit = params.goodCommit as string;
    const badCommit = (params.badCommit as string) || 'HEAD';
    const testCommand = params.testCommand as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Check if bisect already in progress
      if (await isBisectInProgress(cwd)) {
        return {
          success: false,
          error: 'A bisect session is already in progress. Use git_bisect_abort to cancel it first.',
        };
      }

      // Verify commits exist
      const goodInfo = await getCommitInfo(goodCommit, cwd);
      if (!goodInfo) {
        return { success: false, error: `Good commit not found: ${goodCommit}` };
      }

      const badInfo = await getCommitInfo(badCommit, cwd);
      if (!badInfo) {
        return { success: false, error: `Bad commit not found: ${badCommit}` };
      }

      // Check if there are uncommitted changes
      const statusResult = await executeGitCommand(['status', '--porcelain'], cwd);
      if (statusResult.stdout.trim()) {
        return {
          success: false,
          error: 'Uncommitted changes present. Commit or stash changes before starting bisect.',
        };
      }

      // Start bisect
      const startResult = await executeGitCommand(['bisect', 'start'], cwd);
      if (!startResult.success) {
        return { success: false, error: startResult.stderr || 'Failed to start bisect' };
      }

      // Mark bad commit
      const badResult = await executeGitCommand(['bisect', 'bad', badCommit], cwd);
      if (!badResult.success) {
        await executeGitCommand(['bisect', 'reset'], cwd);
        return { success: false, error: badResult.stderr || 'Failed to mark bad commit' };
      }

      // Mark good commit
      const goodResult = await executeGitCommand(['bisect', 'good', goodCommit], cwd);
      if (!goodResult.success) {
        await executeGitCommand(['bisect', 'reset'], cwd);
        return { success: false, error: goodResult.stderr || 'Failed to mark good commit' };
      }

      // Get current state
      const state = await parseBisectState(cwd);
      const currentInfo = state.currentCommit
        ? await getCommitInfo(state.currentCommit, cwd)
        : null;

      // Calculate commit count
      const commitCount = await getCommitCount(goodCommit, badCommit, cwd);

      // Create session history entry
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot) {
        const sessionId = generateSessionId();
        state.sessionId = sessionId;

        const history = await loadBisectHistory(repoRoot);
        history.push({
          sessionId,
          startTime: Date.now(),
          repoPath: repoRoot,
          goodCommit: goodInfo.sha,
          badCommit: badInfo.sha,
          testCommand,
          stepsTaken: 0,
          status: 'in_progress',
          testedCommits: [],
        });
        await saveBisectHistory(repoRoot, history);
      }

      logger.info('Bisect started', {
        goodCommit: goodInfo.shortSha,
        badCommit: badInfo.shortSha,
        commitCount,
      });

      return {
        success: true,
        data: {
          started: true,
          goodCommit: goodInfo,
          badCommit: badInfo,
          currentCommit: currentInfo,
          commitCount,
          estimatedSteps: Math.ceil(Math.log2(commitCount + 1)),
          testCommand,
          message: `Bisect started. Testing ${commitCount} commits (~${Math.ceil(Math.log2(commitCount + 1))} steps).`,
          nextStep: currentInfo
            ? `Test commit ${currentInfo.shortSha}: "${currentInfo.subject}"`
            : 'Test the current commit and mark as good or bad.',
        },
      };
    } catch (error) {
      logger.error('Git bisect start error', { error: (error as Error).message });
      return { success: false, error: `Failed to start bisect: ${(error as Error).message}` };
    }
  },
};

/**
 * Mark current commit as good
 */
export const gitBisectGoodTool: AgentTool = {
  name: 'git_bisect_good',
  description:
    'Mark the current commit as good (bug not present). Git will checkout the next commit to test. ' +
    'Voice: "Mark as good", "This commit is good", "Bug not here".',
  parameters: {
    type: 'object',
    properties: {
      commit: {
        type: 'string',
        description: 'Specific commit to mark as good (default: current HEAD)',
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
    const commit = params.commit as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (!(await isBisectInProgress(cwd))) {
        return { success: false, error: 'No bisect in progress. Use git_bisect_start first.' };
      }

      // Get current commit info before marking
      const beforeCommit = commit || (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const beforeInfo = await getCommitInfo(beforeCommit, cwd);

      // Mark as good
      const goodArgs = ['bisect', 'good'];
      if (commit) {
        goodArgs.push(commit);
      }

      const result = await executeGitCommand(goodArgs, cwd);

      // Check if bisect is complete
      if (result.stdout.includes('is the first bad commit')) {
        // Bisect complete - found the culprit
        const culpritMatch = result.stdout.match(/([a-f0-9]+) is the first bad commit/);
        const culpritSha = culpritMatch ? culpritMatch[1] : '';
        const culpritInfo = await getCommitInfo(culpritSha, cwd);

        // Get files changed in culprit commit
        const filesResult = await executeGitCommand(
          ['diff-tree', '--no-commit-id', '--name-only', '-r', culpritSha],
          cwd
        );
        const filesChanged = filesResult.stdout.split('\n').filter((f) => f.trim());

        // Update history
        const repoRoot = await getRepoRoot(cwd);
        if (repoRoot) {
          const history = await loadBisectHistory(repoRoot);
          const currentSession = history.find((h) => h.status === 'in_progress');
          if (currentSession) {
            currentSession.endTime = Date.now();
            currentSession.culpritCommit = culpritSha;
            currentSession.status = 'completed';
            currentSession.stepsTaken++;
            if (beforeInfo) {
              currentSession.testedCommits.push({
                sha: beforeInfo.sha,
                shortSha: beforeInfo.shortSha,
                subject: beforeInfo.subject,
                isGood: true,
                timestamp: Date.now(),
              });
            }
            await saveBisectHistory(repoRoot, history);
          }
        }

        logger.info('Bisect complete', { culprit: culpritSha });

        return {
          success: true,
          data: {
            complete: true,
            culprit: culpritInfo,
            filesChanged,
            message: `Found the bug-introducing commit: ${culpritInfo?.shortSha} - "${culpritInfo?.subject}"`,
            output: result.stdout,
          },
        };
      }

      if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to mark commit as good' };
      }

      // Get new current commit
      const newCommit = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const newInfo = await getCommitInfo(newCommit, cwd);
      const state = await parseBisectState(cwd);

      // Update history
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot && beforeInfo) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          currentSession.stepsTaken++;
          currentSession.testedCommits.push({
            sha: beforeInfo.sha,
            shortSha: beforeInfo.shortSha,
            subject: beforeInfo.subject,
            isGood: true,
            timestamp: Date.now(),
          });
          await saveBisectHistory(repoRoot, history);
        }
      }

      logger.debug('Marked good', { commit: beforeCommit, next: newCommit });

      return {
        success: true,
        data: {
          markedGood: beforeInfo,
          nextCommit: newInfo,
          remainingSteps: state.stepsRemaining,
          remainingCommits: state.remainingCommits,
          message: `Marked ${beforeInfo?.shortSha} as good. ~${state.stepsRemaining} steps remaining.`,
          nextStep: newInfo
            ? `Test commit ${newInfo.shortSha}: "${newInfo.subject}"`
            : 'Continue testing.',
        },
      };
    } catch (error) {
      logger.error('Git bisect good error', { error: (error as Error).message });
      return { success: false, error: `Failed to mark good: ${(error as Error).message}` };
    }
  },
};

/**
 * Mark current commit as bad
 */
export const gitBisectBadTool: AgentTool = {
  name: 'git_bisect_bad',
  description:
    'Mark the current commit as bad (bug is present). Git will checkout the next commit to test. ' +
    'Voice: "Mark as bad", "This commit is bad", "Bug is here".',
  parameters: {
    type: 'object',
    properties: {
      commit: {
        type: 'string',
        description: 'Specific commit to mark as bad (default: current HEAD)',
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
    const commit = params.commit as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (!(await isBisectInProgress(cwd))) {
        return { success: false, error: 'No bisect in progress. Use git_bisect_start first.' };
      }

      // Get current commit info before marking
      const beforeCommit = commit || (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const beforeInfo = await getCommitInfo(beforeCommit, cwd);

      // Mark as bad
      const badArgs = ['bisect', 'bad'];
      if (commit) {
        badArgs.push(commit);
      }

      const result = await executeGitCommand(badArgs, cwd);

      // Check if bisect is complete
      if (result.stdout.includes('is the first bad commit')) {
        // Bisect complete - found the culprit
        const culpritMatch = result.stdout.match(/([a-f0-9]+) is the first bad commit/);
        const culpritSha = culpritMatch ? culpritMatch[1] : beforeCommit;
        const culpritInfo = await getCommitInfo(culpritSha, cwd);

        // Get files changed in culprit commit
        const filesResult = await executeGitCommand(
          ['diff-tree', '--no-commit-id', '--name-only', '-r', culpritSha],
          cwd
        );
        const filesChanged = filesResult.stdout.split('\n').filter((f) => f.trim());

        // Update history
        const repoRoot = await getRepoRoot(cwd);
        if (repoRoot) {
          const history = await loadBisectHistory(repoRoot);
          const currentSession = history.find((h) => h.status === 'in_progress');
          if (currentSession) {
            currentSession.endTime = Date.now();
            currentSession.culpritCommit = culpritSha;
            currentSession.status = 'completed';
            currentSession.stepsTaken++;
            if (beforeInfo) {
              currentSession.testedCommits.push({
                sha: beforeInfo.sha,
                shortSha: beforeInfo.shortSha,
                subject: beforeInfo.subject,
                isBad: true,
                timestamp: Date.now(),
              });
            }
            await saveBisectHistory(repoRoot, history);
          }
        }

        logger.info('Bisect complete', { culprit: culpritSha });

        return {
          success: true,
          data: {
            complete: true,
            culprit: culpritInfo,
            filesChanged,
            message: `Found the bug-introducing commit: ${culpritInfo?.shortSha} - "${culpritInfo?.subject}"`,
            output: result.stdout,
          },
        };
      }

      if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to mark commit as bad' };
      }

      // Get new current commit
      const newCommit = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const newInfo = await getCommitInfo(newCommit, cwd);
      const state = await parseBisectState(cwd);

      // Update history
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot && beforeInfo) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          currentSession.stepsTaken++;
          currentSession.testedCommits.push({
            sha: beforeInfo.sha,
            shortSha: beforeInfo.shortSha,
            subject: beforeInfo.subject,
            isBad: true,
            timestamp: Date.now(),
          });
          await saveBisectHistory(repoRoot, history);
        }
      }

      logger.debug('Marked bad', { commit: beforeCommit, next: newCommit });

      return {
        success: true,
        data: {
          markedBad: beforeInfo,
          nextCommit: newInfo,
          remainingSteps: state.stepsRemaining,
          remainingCommits: state.remainingCommits,
          message: `Marked ${beforeInfo?.shortSha} as bad. ~${state.stepsRemaining} steps remaining.`,
          nextStep: newInfo
            ? `Test commit ${newInfo.shortSha}: "${newInfo.subject}"`
            : 'Continue testing.',
        },
      };
    } catch (error) {
      logger.error('Git bisect bad error', { error: (error as Error).message });
      return { success: false, error: `Failed to mark bad: ${(error as Error).message}` };
    }
  },
};

/**
 * Skip current commit (cannot test)
 */
export const gitBisectSkipTool: AgentTool = {
  name: 'git_bisect_skip',
  description:
    'Skip the current commit if it cannot be tested (e.g., build broken, unrelated issue). ' +
    'Git will try another nearby commit. Voice: "Skip this commit", "Cannot test this one".',
  parameters: {
    type: 'object',
    properties: {
      commit: {
        type: 'string',
        description: 'Specific commit to skip (default: current HEAD)',
      },
      reason: {
        type: 'string',
        description: 'Reason for skipping (for history tracking)',
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
    const commit = params.commit as string | undefined;
    const reason = params.reason as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (!(await isBisectInProgress(cwd))) {
        return { success: false, error: 'No bisect in progress. Use git_bisect_start first.' };
      }

      // Get current commit info before skipping
      const beforeCommit = commit || (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const beforeInfo = await getCommitInfo(beforeCommit, cwd);

      // Skip commit
      const skipArgs = ['bisect', 'skip'];
      if (commit) {
        skipArgs.push(commit);
      }

      const result = await executeGitCommand(skipArgs, cwd);

      if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to skip commit' };
      }

      // Get new current commit
      const newCommit = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const newInfo = await getCommitInfo(newCommit, cwd);
      const state = await parseBisectState(cwd);

      // Update history
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot && beforeInfo) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          currentSession.testedCommits.push({
            sha: beforeInfo.sha,
            shortSha: beforeInfo.shortSha,
            subject: beforeInfo.subject,
            isSkipped: true,
            testOutput: reason,
            timestamp: Date.now(),
          });
          await saveBisectHistory(repoRoot, history);
        }
      }

      logger.debug('Skipped commit', { commit: beforeCommit, reason });

      return {
        success: true,
        data: {
          skipped: beforeInfo,
          reason,
          nextCommit: newInfo,
          remainingSteps: state.stepsRemaining,
          message: `Skipped ${beforeInfo?.shortSha}. Now testing ${newInfo?.shortSha}.`,
          warning:
            'Skipping commits may result in a range of possible culprit commits instead of a single one.',
        },
      };
    } catch (error) {
      logger.error('Git bisect skip error', { error: (error as Error).message });
      return { success: false, error: `Failed to skip: ${(error as Error).message}` };
    }
  },
};

/**
 * Run automated test on current commit
 */
export const gitBisectRunTool: AgentTool = {
  name: 'git_bisect_run',
  description:
    'Run a test command to automatically determine if the current commit is good or bad. ' +
    'Exit code 0 means good, non-zero means bad. Can also run full automated bisect. ' +
    'Voice: "Run the test", "Auto test this commit", "Run automated bisect".',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Test command to run. Exit code 0 = good, non-zero = bad. Special: 125 = skip.',
      },
      fullAuto: {
        type: 'boolean',
        description: 'Run full automated bisect (git bisect run). Default: false (single test).',
      },
      timeout: {
        type: 'number',
        description: 'Test timeout in milliseconds (default: 120000)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: ['command'],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const command = params.command as string;
    const fullAuto = params.fullAuto === true;
    const timeout = (params.timeout as number) || TEST_TIMEOUT;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (!(await isBisectInProgress(cwd))) {
        return { success: false, error: 'No bisect in progress. Use git_bisect_start first.' };
      }

      const currentCommit = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const currentInfo = await getCommitInfo(currentCommit, cwd);

      if (fullAuto) {
        // Run full automated bisect
        logger.info('Starting automated bisect', { command });

        const result = await executeGitCommand(['bisect', 'run', 'sh', '-c', command], cwd, timeout * 10);

        // Check if bisect completed
        if (result.stdout.includes('is the first bad commit')) {
          const culpritMatch = result.stdout.match(/([a-f0-9]+) is the first bad commit/);
          const culpritSha = culpritMatch ? culpritMatch[1] : '';
          const culpritInfo = await getCommitInfo(culpritSha, cwd);

          const filesResult = await executeGitCommand(
            ['diff-tree', '--no-commit-id', '--name-only', '-r', culpritSha],
            cwd
          );
          const filesChanged = filesResult.stdout.split('\n').filter((f) => f.trim());

          // Update history
          const repoRoot = await getRepoRoot(cwd);
          if (repoRoot) {
            const history = await loadBisectHistory(repoRoot);
            const currentSession = history.find((h) => h.status === 'in_progress');
            if (currentSession) {
              currentSession.endTime = Date.now();
              currentSession.culpritCommit = culpritSha;
              currentSession.status = 'completed';
              await saveBisectHistory(repoRoot, history);
            }
          }

          return {
            success: true,
            data: {
              complete: true,
              automated: true,
              culprit: culpritInfo,
              filesChanged,
              message: `Automated bisect complete. Found: ${culpritInfo?.shortSha} - "${culpritInfo?.subject}"`,
              output: result.stdout,
            },
          };
        }

        return {
          success: result.success,
          data: {
            automated: true,
            output: result.stdout,
            stderr: result.stderr,
          },
          error: result.success ? undefined : result.stderr,
        };
      }

      // Run single test on current commit
      logger.debug('Running test on commit', { commit: currentCommit, command });

      const testResult = await executeShellCommand(command, cwd, timeout);

      // Update history
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot && currentInfo) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          currentSession.testedCommits.push({
            sha: currentInfo.sha,
            shortSha: currentInfo.shortSha,
            subject: currentInfo.subject,
            isGood: testResult.exitCode === 0,
            isBad: testResult.exitCode !== 0 && testResult.exitCode !== 125,
            isSkipped: testResult.exitCode === 125,
            testOutput: testResult.stdout.slice(0, 1000),
            testExitCode: testResult.exitCode,
            timestamp: Date.now(),
          });
          await saveBisectHistory(repoRoot, history);
        }
      }

      const verdict =
        testResult.exitCode === 0
          ? 'good'
          : testResult.exitCode === 125
            ? 'skip'
            : 'bad';

      return {
        success: true,
        data: {
          commit: currentInfo,
          testPassed: testResult.exitCode === 0,
          exitCode: testResult.exitCode,
          verdict,
          stdout: testResult.stdout.slice(0, 2000),
          stderr: testResult.stderr.slice(0, 1000),
          message: `Test ${verdict === 'good' ? 'passed' : verdict === 'skip' ? 'skipped' : 'failed'} on ${currentInfo?.shortSha}`,
          nextAction:
            verdict === 'good'
              ? 'Run git_bisect_good to mark this commit as good.'
              : verdict === 'skip'
                ? 'Run git_bisect_skip to skip this commit.'
                : 'Run git_bisect_bad to mark this commit as bad.',
        },
      };
    } catch (error) {
      logger.error('Git bisect run error', { error: (error as Error).message });
      return { success: false, error: `Test failed: ${(error as Error).message}` };
    }
  },
};

/**
 * Get current bisect status and progress
 */
export const gitBisectStatusTool: AgentTool = {
  name: 'git_bisect_status',
  description:
    'Get the current status of the bisect session including progress, tested commits, and next steps. ' +
    'Voice: "Bisect status", "How many steps left", "Show bisect progress".',
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

      if (!(await isBisectInProgress(cwd))) {
        return {
          success: true,
          data: {
            inProgress: false,
            message: 'No bisect in progress.',
          },
        };
      }

      const state = await parseBisectState(cwd);
      const currentInfo = state.currentCommit
        ? await getCommitInfo(state.currentCommit, cwd)
        : null;
      const goodInfo = state.goodCommit
        ? await getCommitInfo(state.goodCommit, cwd)
        : null;
      const badInfo = state.badCommit ? await getCommitInfo(state.badCommit, cwd) : null;

      // Get history
      const repoRoot = await getRepoRoot(cwd);
      let sessionHistory: BisectCommitResult[] = [];
      if (repoRoot) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          sessionHistory = currentSession.testedCommits;
          state.startTime = currentSession.startTime;
          state.testCommand = currentSession.testCommand;
        }
      }

      return {
        success: true,
        data: {
          inProgress: true,
          goodCommit: goodInfo,
          badCommit: badInfo,
          currentCommit: currentInfo,
          remainingCommits: state.remainingCommits,
          stepsRemaining: state.stepsRemaining,
          stepsTaken: sessionHistory.length,
          startTime: state.startTime,
          testCommand: state.testCommand,
          testedCommits: sessionHistory,
          message:
            `Bisect in progress. Testing ${currentInfo?.shortSha}. ` +
            `~${state.stepsRemaining} steps remaining of ~${Math.ceil(Math.log2(state.totalCommits + 1))} total.`,
          nextStep: currentInfo
            ? `Test commit ${currentInfo.shortSha}: "${currentInfo.subject}"`
            : 'Test the current commit.',
        },
      };
    } catch (error) {
      logger.error('Git bisect status error', { error: (error as Error).message });
      return { success: false, error: `Failed to get status: ${(error as Error).message}` };
    }
  },
};

/**
 * Suggest commits to test
 */
export const gitBisectSuggestTool: AgentTool = {
  name: 'git_bisect_suggest',
  description:
    'Get suggestions for which commits to test based on current bisect state. ' +
    'Useful when you want to understand the commit landscape. ' +
    'Voice: "Suggest commits to test", "What should I test next".',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of suggestions to return (default: 5)',
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
    const count = Math.min((params.count as number) || 5, 20);

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (!(await isBisectInProgress(cwd))) {
        return {
          success: false,
          error: 'No bisect in progress. Use git_bisect_start first.',
        };
      }

      // Get visualize output to see remaining commits
      const visualizeResult = await executeGitCommand(
        ['bisect', 'visualize', '--oneline', '--no-walk=sorted'],
        cwd
      );

      if (!visualizeResult.success) {
        return { success: false, error: 'Failed to get bisect visualization' };
      }

      const lines = visualizeResult.stdout.split('\n').filter((l) => l.trim());
      const totalCommits = lines.length;

      // Parse commits and create suggestions
      const suggestions: BisectCommitSuggestion[] = [];

      // The current HEAD is always the primary suggestion (middle commit)
      const currentCommit = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const currentInfo = await getCommitInfo(currentCommit, cwd);

      if (currentInfo) {
        suggestions.push({
          sha: currentInfo.sha,
          shortSha: currentInfo.shortSha,
          subject: currentInfo.subject,
          author: currentInfo.author,
          date: currentInfo.date,
          reason: 'Current commit (optimal binary search position)',
          eliminates: Math.floor(totalCommits / 2),
        });
      }

      // Add some other commits from the range for context
      for (let i = 0; i < Math.min(count - 1, lines.length); i++) {
        const line = lines[i];
        const match = line.match(/^([a-f0-9]+)\s+(.*)$/);
        if (match && match[1] !== currentInfo?.shortSha) {
          const sha = match[1];
          const info = await getCommitInfo(sha, cwd);
          if (info) {
            const position = i / totalCommits;
            suggestions.push({
              sha: info.sha,
              shortSha: info.shortSha,
              subject: info.subject,
              author: info.author,
              date: info.date,
              reason:
                position < 0.25
                  ? 'Near the good end of the range'
                  : position > 0.75
                    ? 'Near the bad end of the range'
                    : 'In the middle range',
              eliminates: Math.floor(
                Math.min(i + 1, totalCommits - i - 1)
              ),
            });
          }
        }

        if (suggestions.length >= count) break;
      }

      return {
        success: true,
        data: {
          suggestions,
          totalRemaining: totalCommits,
          optimalSteps: Math.ceil(Math.log2(totalCommits + 1)),
          message: `${totalCommits} commits remaining. Testing the current commit will eliminate ~${Math.floor(totalCommits / 2)} commits.`,
        },
      };
    } catch (error) {
      logger.error('Git bisect suggest error', { error: (error as Error).message });
      return { success: false, error: `Failed to suggest: ${(error as Error).message}` };
    }
  },
};

/**
 * Abort the current bisect session
 */
export const gitBisectAbortTool: AgentTool = {
  name: 'git_bisect_abort',
  description:
    'Abort the current bisect session and return to the original HEAD. ' +
    'Voice: "Abort bisect", "Cancel bisect", "Stop bisecting".',
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

      if (!(await isBisectInProgress(cwd))) {
        return {
          success: true,
          data: {
            aborted: false,
            message: 'No bisect in progress.',
          },
        };
      }

      // Get state before aborting
      const state = await parseBisectState(cwd);

      // Abort bisect
      const result = await executeGitCommand(['bisect', 'reset'], cwd);

      if (!result.success) {
        return { success: false, error: result.stderr || 'Failed to abort bisect' };
      }

      // Update history
      const repoRoot = await getRepoRoot(cwd);
      if (repoRoot) {
        const history = await loadBisectHistory(repoRoot);
        const currentSession = history.find((h) => h.status === 'in_progress');
        if (currentSession) {
          currentSession.endTime = Date.now();
          currentSession.status = 'aborted';
          await saveBisectHistory(repoRoot, history);
        }
      }

      // Get new HEAD
      const newHead = (await executeGitCommand(['rev-parse', 'HEAD'], cwd)).stdout;
      const newInfo = await getCommitInfo(newHead, cwd);

      logger.info('Bisect aborted');

      return {
        success: true,
        data: {
          aborted: true,
          returnedTo: newInfo,
          stepsTaken: state.testedCommits.length,
          message: `Bisect aborted. Returned to ${newInfo?.shortSha}.`,
        },
      };
    } catch (error) {
      logger.error('Git bisect abort error', { error: (error as Error).message });
      return { success: false, error: `Failed to abort: ${(error as Error).message}` };
    }
  },
};

/**
 * Get bisect session history
 */
export const gitBisectHistoryTool: AgentTool = {
  name: 'git_bisect_history',
  description:
    'Get history of past bisect sessions including their outcomes. ' +
    'Voice: "Show bisect history", "Past bisect sessions", "Previous bug hunts".',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of sessions to show (default: 10)',
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
    const limit = Math.min((params.limit as number) || 10, 50);

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const repoRoot = await getRepoRoot(cwd);
      if (!repoRoot) {
        return { success: false, error: 'Could not determine repository root' };
      }

      const history = await loadBisectHistory(repoRoot);
      const recentHistory = history.slice(-limit).reverse();

      // Enrich with commit info
      const enrichedHistory = await Promise.all(
        recentHistory.map(async (session) => {
          const goodInfo = await getCommitInfo(session.goodCommit, cwd);
          const badInfo = await getCommitInfo(session.badCommit, cwd);
          const culpritInfo = session.culpritCommit
            ? await getCommitInfo(session.culpritCommit, cwd)
            : null;

          return {
            ...session,
            goodCommitInfo: goodInfo,
            badCommitInfo: badInfo,
            culpritInfo,
            duration: session.endTime
              ? session.endTime - session.startTime
              : Date.now() - session.startTime,
          };
        })
      );

      const stats = {
        totalSessions: history.length,
        completedSessions: history.filter((h) => h.status === 'completed').length,
        abortedSessions: history.filter((h) => h.status === 'aborted').length,
        averageSteps:
          history.filter((h) => h.status === 'completed').reduce((sum, h) => sum + h.stepsTaken, 0) /
            (history.filter((h) => h.status === 'completed').length || 1),
      };

      return {
        success: true,
        data: {
          sessions: enrichedHistory,
          stats,
          message: `Found ${history.length} bisect session(s). ${stats.completedSessions} completed, ${stats.abortedSessions} aborted.`,
        },
      };
    } catch (error) {
      logger.error('Git bisect history error', { error: (error as Error).message });
      return { success: false, error: `Failed to get history: ${(error as Error).message}` };
    }
  },
};

/**
 * Replay a bisect log
 */
export const gitBisectReplayTool: AgentTool = {
  name: 'git_bisect_replay',
  description:
    'Replay a previous bisect session from its log. Useful for re-running or sharing bisect sessions. ' +
    'Voice: "Replay bisect", "Re-run that bisect session".',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID to replay from history',
      },
      logFile: {
        type: 'string',
        description: 'Path to a bisect log file to replay',
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
    const sessionId = params.sessionId as string | undefined;
    const logFile = params.logFile as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      if (await isBisectInProgress(cwd)) {
        return {
          success: false,
          error: 'A bisect is already in progress. Abort it first with git_bisect_abort.',
        };
      }

      let logContent: string | null = null;

      if (logFile) {
        // Read from file
        try {
          logContent = await fs.readFile(logFile, 'utf-8');
        } catch {
          return { success: false, error: `Could not read log file: ${logFile}` };
        }
      } else if (sessionId) {
        // Get from history
        const repoRoot = await getRepoRoot(cwd);
        if (!repoRoot) {
          return { success: false, error: 'Could not determine repository root' };
        }

        const history = await loadBisectHistory(repoRoot);
        const session = history.find((h) => h.sessionId === sessionId);

        if (!session) {
          return { success: false, error: `Session not found: ${sessionId}` };
        }

        // Reconstruct log from session
        const logLines = ['git bisect start'];
        logLines.push(`git bisect bad ${session.badCommit}`);
        logLines.push(`git bisect good ${session.goodCommit}`);

        for (const commit of session.testedCommits) {
          if (commit.isGood) {
            logLines.push(`git bisect good ${commit.sha}`);
          } else if (commit.isBad) {
            logLines.push(`git bisect bad ${commit.sha}`);
          } else if (commit.isSkipped) {
            logLines.push(`git bisect skip ${commit.sha}`);
          }
        }

        logContent = logLines.join('\n');
      } else {
        return { success: false, error: 'Provide either sessionId or logFile to replay' };
      }

      // Write temp log file
      const tempLog = path.join(os.tmpdir(), `atlas-bisect-replay-${Date.now()}.log`);
      await fs.writeFile(tempLog, logContent);

      try {
        // Replay the log
        const result = await executeGitCommand(['bisect', 'replay', tempLog], cwd);

        if (!result.success && !result.stdout.includes('is the first bad commit')) {
          return { success: false, error: result.stderr || 'Failed to replay bisect' };
        }

        // Check if bisect completed during replay
        if (result.stdout.includes('is the first bad commit')) {
          const culpritMatch = result.stdout.match(/([a-f0-9]+) is the first bad commit/);
          const culpritSha = culpritMatch ? culpritMatch[1] : '';
          const culpritInfo = await getCommitInfo(culpritSha, cwd);

          return {
            success: true,
            data: {
              replayed: true,
              complete: true,
              culprit: culpritInfo,
              message: `Replay complete. Culprit: ${culpritInfo?.shortSha} - "${culpritInfo?.subject}"`,
            },
          };
        }

        // Get current state
        const state = await parseBisectState(cwd);
        const currentInfo = state.currentCommit
          ? await getCommitInfo(state.currentCommit, cwd)
          : null;

        return {
          success: true,
          data: {
            replayed: true,
            complete: false,
            currentCommit: currentInfo,
            stepsRemaining: state.stepsRemaining,
            message: `Replay started. Continue testing from ${currentInfo?.shortSha}.`,
          },
        };
      } finally {
        // Clean up temp file
        try {
          await fs.unlink(tempLog);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      logger.error('Git bisect replay error', { error: (error as Error).message });
      return { success: false, error: `Failed to replay: ${(error as Error).message}` };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git bisect tools
 */
export function getGitBisectTools(): AgentTool[] {
  return [
    gitBisectStartTool,
    gitBisectGoodTool,
    gitBisectBadTool,
    gitBisectSkipTool,
    gitBisectRunTool,
    gitBisectStatusTool,
    gitBisectSuggestTool,
    gitBisectAbortTool,
    gitBisectHistoryTool,
    gitBisectReplayTool,
  ];
}

export default {
  gitBisectStartTool,
  gitBisectGoodTool,
  gitBisectBadTool,
  gitBisectSkipTool,
  gitBisectRunTool,
  gitBisectStatusTool,
  gitBisectSuggestTool,
  gitBisectAbortTool,
  gitBisectHistoryTool,
  gitBisectReplayTool,
  getGitBisectTools,
};
