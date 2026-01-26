/**
 * Atlas Desktop - Git Commit Message Generator
 *
 * Auto-generates commit messages from staged changes using LLM.
 * Analyzes diffs and produces conventional commit format messages.
 *
 * @module agent/tools/git-commit-gen
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';
import { getLLMManager } from '../../llm/manager';
import { createConversationContext } from '../../../shared/types/llm';

const logger = createModuleLogger('GitCommitGen');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_DIFF_SIZE = 32 * 1024; // 32KB max diff for LLM context
const MAX_FILES_SUMMARY = 20; // Max files to list in summary

// ============================================================================
// Types
// ============================================================================

/**
 * Conventional commit types
 */
export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

/**
 * Staged file information
 */
export interface StagedFile {
  /** File path relative to repo root */
  path: string;
  /** Status (M=modified, A=added, D=deleted, R=renamed) */
  status: string;
  /** Number of insertions */
  insertions: number;
  /** Number of deletions */
  deletions: number;
}

/**
 * Diff summary for LLM context
 */
export interface DiffSummary {
  /** Total files changed */
  filesChanged: number;
  /** Total insertions */
  totalInsertions: number;
  /** Total deletions */
  totalDeletions: number;
  /** List of staged files with stats */
  files: StagedFile[];
  /** Detected scope from file paths */
  detectedScope: string | null;
  /** Truncated diff content for LLM */
  diffContent: string;
  /** Whether diff was truncated */
  truncated: boolean;
}

/**
 * Generated commit message result
 */
export interface GeneratedCommitMessage {
  /** The full commit message */
  message: string;
  /** Commit type (feat, fix, etc.) */
  type: ConventionalCommitType;
  /** Scope extracted from changes */
  scope: string | null;
  /** Short description (first line) */
  subject: string;
  /** Extended body (optional) */
  body: string | null;
  /** Alternative suggestions */
  alternatives: string[];
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Commit execution result
 */
export interface CommitResult {
  /** Commit SHA */
  sha: string;
  /** Final commit message used */
  message: string;
  /** Files committed */
  filesCommitted: number;
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
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
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
 * Get staged files with diff stats
 */
async function getStagedFiles(cwd?: string): Promise<StagedFile[]> {
  // Get list of staged files with status
  const statusResult = await executeGitCommand(
    ['diff', '--cached', '--name-status'],
    cwd
  );

  if (!statusResult.success || !statusResult.stdout) {
    return [];
  }

  // Get diff stats per file
  const statsResult = await executeGitCommand(
    ['diff', '--cached', '--numstat'],
    cwd
  );

  // Parse status
  const statusLines = statusResult.stdout.split('\n').filter((l) => l.trim());
  const statsLines = statsResult.success
    ? statsResult.stdout.split('\n').filter((l) => l.trim())
    : [];

  // Create stats map
  const statsMap = new Map<string, { insertions: number; deletions: number }>();
  for (const line of statsLines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      statsMap.set(parts[2], { insertions, deletions });
    }
  }

  // Parse and combine
  const files: StagedFile[] = [];
  for (const line of statusLines) {
    const [status, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t'); // Handle paths with tabs
    const stats = statsMap.get(filePath) || { insertions: 0, deletions: 0 };

    files.push({
      path: filePath,
      status: status.charAt(0), // First char is the main status
      insertions: stats.insertions,
      deletions: stats.deletions,
    });
  }

  return files;
}

/**
 * Get staged diff content (truncated if too large)
 */
async function getStagedDiff(cwd?: string): Promise<{ content: string; truncated: boolean }> {
  const result = await executeGitCommand(['diff', '--cached'], cwd);

  if (!result.success) {
    return { content: '', truncated: false };
  }

  if (result.stdout.length > MAX_DIFF_SIZE) {
    return {
      content: result.stdout.slice(0, MAX_DIFF_SIZE) + '\n... [diff truncated]',
      truncated: true,
    };
  }

  return { content: result.stdout, truncated: false };
}

/**
 * Detect scope from file paths
 * Analyzes common directories to suggest a scope
 */
function detectScope(files: StagedFile[]): string | null {
  if (files.length === 0) return null;

  // Define scope mappings based on directory patterns
  const scopePatterns: Array<{ pattern: RegExp; scope: string }> = [
    { pattern: /^src\/main\/voice\//, scope: 'voice' },
    { pattern: /^src\/main\/stt\//, scope: 'stt' },
    { pattern: /^src\/main\/tts\//, scope: 'tts' },
    { pattern: /^src\/main\/llm\//, scope: 'llm' },
    { pattern: /^src\/main\/agent\//, scope: 'agent' },
    { pattern: /^src\/main\/memory\//, scope: 'memory' },
    { pattern: /^src\/main\/security\//, scope: 'security' },
    { pattern: /^src\/main\/config\//, scope: 'config' },
    { pattern: /^src\/main\/tray\//, scope: 'tray' },
    { pattern: /^src\/main\/ipc\//, scope: 'ipc' },
    { pattern: /^src\/main\/utils\//, scope: 'utils' },
    { pattern: /^src\/renderer\/components\/orb\//, scope: 'orb' },
    { pattern: /^src\/renderer\/components\//, scope: 'ui' },
    { pattern: /^src\/renderer\/hooks\//, scope: 'hooks' },
    { pattern: /^src\/renderer\/stores\//, scope: 'store' },
    { pattern: /^src\/renderer\//, scope: 'renderer' },
    { pattern: /^src\/shared\/types\//, scope: 'types' },
    { pattern: /^src\/main\//, scope: 'main' },
    { pattern: /^tests\//, scope: 'test' },
    { pattern: /^docs\//, scope: 'docs' },
    { pattern: /^\.github\//, scope: 'ci' },
    { pattern: /package\.json$/, scope: 'deps' },
    { pattern: /tsconfig.*\.json$/, scope: 'build' },
    { pattern: /\.eslint/, scope: 'lint' },
    { pattern: /\.prettier/, scope: 'lint' },
  ];

  // Count scope occurrences
  const scopeCounts = new Map<string, number>();

  for (const file of files) {
    for (const { pattern, scope } of scopePatterns) {
      if (pattern.test(file.path)) {
        scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
        break;
      }
    }
  }

  // Return the most common scope if it covers majority of files
  if (scopeCounts.size === 0) return null;

  const sortedScopes = Array.from(scopeCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const topScope = sortedScopes[0];
  const totalFiles = files.length;

  // Only return scope if it covers at least 50% of files
  if (topScope[1] >= totalFiles * 0.5) {
    return topScope[0];
  }

  // If multiple scopes and none dominant, return null
  return null;
}

/**
 * Detect commit type from changes
 */
function detectCommitType(files: StagedFile[], diffContent: string): ConventionalCommitType {
  // Check for test files
  const hasTestFiles = files.some(
    (f) => f.path.includes('test') || f.path.includes('spec')
  );
  if (hasTestFiles && files.every((f) => f.path.includes('test') || f.path.includes('spec'))) {
    return 'test';
  }

  // Check for documentation
  const hasDocFiles = files.some(
    (f) => f.path.endsWith('.md') || f.path.startsWith('docs/')
  );
  if (hasDocFiles && files.every((f) => f.path.endsWith('.md') || f.path.startsWith('docs/'))) {
    return 'docs';
  }

  // Check for build/config changes
  const hasBuildFiles = files.some(
    (f) =>
      f.path.includes('package.json') ||
      f.path.includes('tsconfig') ||
      f.path.includes('webpack') ||
      f.path.includes('vite') ||
      f.path.includes('rollup')
  );
  if (hasBuildFiles && files.length <= 2) {
    return 'build';
  }

  // Check for CI changes
  const hasCIFiles = files.some(
    (f) => f.path.includes('.github/') || f.path.includes('.gitlab-ci')
  );
  if (hasCIFiles) {
    return 'ci';
  }

  // Check for style changes (formatting only)
  const stylePatterns = /^\s*(import|export|const|let|var|function|class)\s/gm;
  const hasCodeChanges = stylePatterns.test(diffContent);
  if (!hasCodeChanges && diffContent.length < 500) {
    return 'style';
  }

  // Check diff content for bug fix indicators
  const fixIndicators = [
    /fix(es|ed)?(\s|:)/i,
    /bug/i,
    /issue/i,
    /error/i,
    /crash/i,
    /null\s*(pointer|reference)/i,
    /undefined/i,
  ];
  for (const pattern of fixIndicators) {
    if (pattern.test(diffContent)) {
      return 'fix';
    }
  }

  // Check for refactoring indicators
  const refactorIndicators = [
    /refactor/i,
    /rename/i,
    /move/i,
    /extract/i,
    /cleanup/i,
  ];
  for (const pattern of refactorIndicators) {
    if (pattern.test(diffContent)) {
      return 'refactor';
    }
  }

  // Check for performance indicators
  const perfIndicators = [
    /perf(ormance)?/i,
    /optimi[sz]/i,
    /cache/i,
    /memoiz/i,
    /lazy/i,
  ];
  for (const pattern of perfIndicators) {
    if (pattern.test(diffContent)) {
      return 'perf';
    }
  }

  // Default to feat for new functionality
  const hasNewFiles = files.some((f) => f.status === 'A');
  if (hasNewFiles) {
    return 'feat';
  }

  // Default to chore for miscellaneous changes
  return 'chore';
}

/**
 * Build diff summary for LLM
 */
async function buildDiffSummary(cwd?: string): Promise<DiffSummary> {
  const files = await getStagedFiles(cwd);
  const { content, truncated } = await getStagedDiff(cwd);

  // Calculate totals
  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Detect scope
  const detectedScope = detectScope(files);

  // Limit files in summary
  const summaryFiles = files.slice(0, MAX_FILES_SUMMARY);

  return {
    filesChanged: files.length,
    totalInsertions,
    totalDeletions,
    files: summaryFiles,
    detectedScope,
    diffContent: content,
    truncated: truncated || files.length > MAX_FILES_SUMMARY,
  };
}

/**
 * Build the LLM prompt for commit message generation
 */
function buildCommitPrompt(summary: DiffSummary): string {
  // Build file list
  const fileList = summary.files
    .map((f) => {
      const stats = `+${f.insertions}/-${f.deletions}`;
      const statusMap: Record<string, string> = {
        M: 'modified',
        A: 'added',
        D: 'deleted',
        R: 'renamed',
        C: 'copied',
      };
      const status = statusMap[f.status] || f.status;
      return `  - ${f.path} (${status}, ${stats})`;
    })
    .join('\n');

  const scopeHint = summary.detectedScope
    ? `Detected scope: ${summary.detectedScope}`
    : 'No clear scope detected - consider using a general scope or omit it.';

  return `Analyze the following git staged changes and generate a commit message.

## Changes Summary
- Files changed: ${summary.filesChanged}
- Total insertions: ${summary.totalInsertions}
- Total deletions: ${summary.totalDeletions}
${summary.truncated ? '- Note: Changes were truncated for brevity' : ''}

## Files Changed
${fileList}

## Scope Detection
${scopeHint}

## Diff Content
\`\`\`diff
${summary.diffContent}
\`\`\`

## Instructions
Generate a commit message following the Conventional Commits format:
- Format: type(scope): description
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Keep the subject line under 72 characters
- Use imperative mood (e.g., "add" not "added" or "adds")
- Don't end with a period
- Include a body if the changes are complex (separate with blank line)

Respond with ONLY the commit message, nothing else. No quotes, no explanations.
If a body is needed, include it after a blank line.`;
}

/**
 * Parse LLM response into structured commit message
 */
function parseCommitMessage(
  response: string,
  summary: DiffSummary
): GeneratedCommitMessage {
  // Clean up response
  const cleanResponse = response.trim();
  const lines = cleanResponse.split('\n');

  // Parse subject line
  const subject = lines[0].trim();

  // Parse type and scope from subject
  const conventionalMatch = subject.match(
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(([^)]+)\))?:\s*(.+)$/i
  );

  let type: ConventionalCommitType = 'chore';
  let scope: string | null = null;
  let description = subject;

  if (conventionalMatch) {
    type = conventionalMatch[1].toLowerCase() as ConventionalCommitType;
    scope = conventionalMatch[2] || null;
    description = conventionalMatch[3];
  } else {
    // Fallback: detect type from diff
    type = detectCommitType(summary.files, summary.diffContent);
    scope = summary.detectedScope;
  }

  // Extract body (lines after first blank line)
  let body: string | null = null;
  const blankLineIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '');
  if (blankLineIndex > 0 && blankLineIndex < lines.length - 1) {
    body = lines.slice(blankLineIndex + 1).join('\n').trim();
  }

  // Build the full message
  const fullSubject = scope
    ? `${type}(${scope}): ${description}`
    : `${type}: ${description}`;
  const message = body ? `${fullSubject}\n\n${body}` : fullSubject;

  // Calculate confidence based on format match
  const confidence = conventionalMatch ? 0.9 : 0.7;

  return {
    message,
    type,
    scope,
    subject: fullSubject,
    body,
    alternatives: [], // Could generate alternatives in future
    confidence,
  };
}

// ============================================================================
// Main Tool: Generate Commit Message
// ============================================================================

/**
 * Generate a commit message from staged changes
 */
export const generateCommitMessageTool: AgentTool = {
  name: 'git_generate_commit_message',
  description:
    'Analyze staged git changes and generate a conventional commit message using AI. ' +
    'Returns a suggested commit message with type, scope, and description.',
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
      // Check if it's a git repository
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Get staged files
      const files = await getStagedFiles(cwd);
      if (files.length === 0) {
        return {
          success: false,
          error: 'No staged changes to commit. Use git add to stage files first.',
        };
      }

      // Build diff summary
      const summary = await buildDiffSummary(cwd);

      logger.info('Generating commit message', {
        filesChanged: summary.filesChanged,
        detectedScope: summary.detectedScope,
      });

      // Get LLM manager
      const llmManager = getLLMManager();

      // Create a focused context for commit generation
      const systemPrompt = `You are a git commit message generator. Your only job is to analyze code changes and produce clean, conventional commit messages. You respond with ONLY the commit message - no explanations, no quotes, no markdown formatting. Keep messages concise and follow the conventional commits specification exactly.`;

      const context = createConversationContext(systemPrompt);

      // Generate prompt and get LLM response
      const prompt = buildCommitPrompt(summary);
      const response = await llmManager.chat(prompt, context);

      if (!response.content) {
        // Fallback to auto-detected message
        const type = detectCommitType(summary.files, summary.diffContent);
        const scope = summary.detectedScope;
        const fallbackMessage = scope
          ? `${type}(${scope}): update ${files.length} file(s)`
          : `${type}: update ${files.length} file(s)`;

        return {
          success: true,
          data: {
            message: fallbackMessage,
            type,
            scope,
            subject: fallbackMessage,
            body: null,
            alternatives: [],
            confidence: 0.5,
            summary: {
              filesChanged: summary.filesChanged,
              insertions: summary.totalInsertions,
              deletions: summary.totalDeletions,
            },
          } as GeneratedCommitMessage & { summary: Record<string, number> },
          metadata: {
            usedFallback: true,
          },
        };
      }

      // Parse the response
      const commitMessage = parseCommitMessage(response.content, summary);

      logger.info('Commit message generated', {
        type: commitMessage.type,
        scope: commitMessage.scope,
        confidence: commitMessage.confidence,
      });

      return {
        success: true,
        data: {
          ...commitMessage,
          summary: {
            filesChanged: summary.filesChanged,
            insertions: summary.totalInsertions,
            deletions: summary.totalDeletions,
          },
        },
      };
    } catch (error) {
      logger.error('Commit message generation error', {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: `Failed to generate commit message: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool: Commit with Suggested Message
// ============================================================================

/**
 * Generate commit message and optionally commit with it
 */
export const commitWithSuggestedMessageTool: AgentTool = {
  name: 'git_commit_suggested',
  description:
    'Generate a commit message from staged changes and optionally commit immediately. ' +
    'Voice command: "Commit with suggested message". ' +
    'Set confirm: false to commit directly, or confirm: true (default) to preview first.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
      confirm: {
        type: 'boolean',
        description: 'If true (default), only generates message. If false, commits immediately.',
      },
      modifiedMessage: {
        type: 'string',
        description: 'Optional modified message to use instead of generated one',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const confirm = params.confirm !== false; // Default to true (preview mode)
    const modifiedMessage = params.modifiedMessage as string | undefined;

    try {
      // Check if it's a git repository
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // If we have a modified message and confirm is false, commit directly
      if (modifiedMessage && !confirm) {
        const commitResult = await executeGitCommand(
          ['commit', '-m', modifiedMessage],
          cwd
        );

        if (!commitResult.success) {
          return {
            success: false,
            error: commitResult.stderr || 'Failed to create commit',
          };
        }

        // Get commit info
        const logResult = await executeGitCommand(
          ['log', '-1', '--pretty=format:%h'],
          cwd
        );

        const result: CommitResult = {
          sha: logResult.stdout,
          message: modifiedMessage,
          filesCommitted: (await getStagedFiles(cwd)).length,
        };

        logger.info('Commit created with modified message', { sha: result.sha });

        return {
          success: true,
          data: {
            committed: true,
            ...result,
          },
        };
      }

      // Generate the commit message
      const generateResult = await generateCommitMessageTool.execute({ path: cwd });

      if (!generateResult.success) {
        return generateResult;
      }

      const generated = generateResult.data as GeneratedCommitMessage & {
        summary: Record<string, number>;
      };

      // If confirm mode, return the suggestion for user review
      if (confirm) {
        return {
          success: true,
          data: {
            committed: false,
            needsConfirmation: true,
            suggestedMessage: generated.message,
            type: generated.type,
            scope: generated.scope,
            subject: generated.subject,
            body: generated.body,
            confidence: generated.confidence,
            summary: generated.summary,
            instructions:
              'Review the suggested message above. ' +
              'To commit, call this tool again with confirm: false, ' +
              'or provide modifiedMessage to use a different message.',
          },
        };
      }

      // Commit with generated message
      const commitResult = await executeGitCommand(
        ['commit', '-m', generated.message],
        cwd
      );

      if (!commitResult.success) {
        return {
          success: false,
          error: commitResult.stderr || 'Failed to create commit',
        };
      }

      // Get commit info
      const logResult = await executeGitCommand(
        ['log', '-1', '--pretty=format:%h'],
        cwd
      );

      const result: CommitResult = {
        sha: logResult.stdout,
        message: generated.message,
        filesCommitted: generated.summary.filesChanged,
      };

      logger.info('Commit created with generated message', { sha: result.sha });

      return {
        success: true,
        data: {
          committed: true,
          ...result,
          type: generated.type,
          scope: generated.scope,
        },
      };
    } catch (error) {
      logger.error('Commit with suggested message error', {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: `Failed to commit: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool: Analyze Staged Changes
// ============================================================================

/**
 * Analyze staged changes without generating a message
 */
export const analyzeStagedChangesTool: AgentTool = {
  name: 'git_analyze_staged',
  description:
    'Analyze staged git changes and return a summary with detected type and scope. ' +
    'Useful for understanding what will be committed.',
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
      // Check if it's a git repository
      if (!(await isGitRepository(cwd))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Get staged files
      const files = await getStagedFiles(cwd);
      if (files.length === 0) {
        return {
          success: true,
          data: {
            hasChanges: false,
            message: 'No staged changes',
          },
        };
      }

      // Build summary
      const summary = await buildDiffSummary(cwd);
      const detectedType = detectCommitType(summary.files, summary.diffContent);

      return {
        success: true,
        data: {
          hasChanges: true,
          filesChanged: summary.filesChanged,
          totalInsertions: summary.totalInsertions,
          totalDeletions: summary.totalDeletions,
          detectedType,
          detectedScope: summary.detectedScope,
          files: summary.files.map((f) => ({
            path: f.path,
            status: f.status,
            changes: `+${f.insertions}/-${f.deletions}`,
          })),
          truncated: summary.truncated,
        },
      };
    } catch (error) {
      logger.error('Analyze staged changes error', {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: `Failed to analyze changes: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git commit generation tools
 */
export function getGitCommitGenTools(): AgentTool[] {
  return [
    generateCommitMessageTool,
    commitWithSuggestedMessageTool,
    analyzeStagedChangesTool,
  ];
}

export default {
  generateCommitMessageTool,
  commitWithSuggestedMessageTool,
  analyzeStagedChangesTool,
  getGitCommitGenTools,
};
