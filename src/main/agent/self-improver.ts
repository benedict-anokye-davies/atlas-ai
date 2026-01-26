/**
 * Atlas Desktop - Self Improver
 *
 * Enables Atlas to proactively improve its own code - analyze, modify, and track
 * changes to itself. Operates autonomously with safety guardrails.
 *
 * Features:
 * - Code analysis for improvements (performance, readability, bugs, features)
 * - Safe modification with git integration (stash/commit before changes)
 * - Full change tracking with rollback capability
 * - Natural language reporting on request
 *
 * Per Ben's preferences:
 * - Proactive improvement - do it without asking
 * - Only report when explicitly asked "What did you change?"
 * - Full detailed logs available on request
 *
 * @module agent/self-improver
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, SpawnOptions } from 'child_process';
import * as os from 'os';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SelfImprover');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Types of improvements that can be identified
 */
export type ImprovementType = 'performance' | 'readability' | 'bug-fix' | 'feature' | 'refactor';

/**
 * Impact level of a change
 */
export type ImpactLevel = 'minor' | 'moderate' | 'significant';

/**
 * An opportunity for code improvement
 */
export interface ImprovementOpportunity {
  /** Unique identifier */
  id: string;
  /** Type of improvement */
  type: ImprovementType;
  /** File path relative to project root */
  file: string;
  /** Human-readable description */
  description: string;
  /** Confidence level 0-1 */
  confidence: number;
  /** Expected impact */
  impact: ImpactLevel;
  /** Suggested code change */
  suggestedChange?: string;
  /** Line number where issue was found */
  lineNumber?: number;
  /** Original code snippet */
  originalCode?: string;
}

/**
 * Result of implementing an improvement
 */
export interface ChangeResult {
  /** Whether the change was successful */
  success: boolean;
  /** The modification record if successful */
  modification?: SelfModification;
  /** Error message if failed */
  error?: string;
  /** Whether rollback is available */
  rollbackAvailable: boolean;
}

/**
 * A record of a self-modification
 */
export interface SelfModification {
  /** Unique identifier */
  id: string;
  /** When the modification was made */
  timestamp: Date;
  /** Files that were modified */
  files: string[];
  /** Human-readable description */
  description: string;
  /** Reason for the change */
  reason: string;
  /** Git diff of the change */
  diff: string;
  /** Impact level */
  impact: ImpactLevel;
  /** Git commit SHA if committed */
  gitCommit?: string;
  /** Whether the change was rolled back */
  rolledBack: boolean;
  /** Improvement type */
  type: ImprovementType;
  /** Stash reference for rollback */
  stashRef?: string;
}

/**
 * Persisted modification history
 */
interface ModificationHistory {
  modifications: SelfModification[];
  lastAnalysis: string | null;
  version: number;
}

/**
 * Analysis pattern for detecting improvements
 */
interface AnalysisPattern {
  type: ImprovementType;
  pattern: RegExp;
  description: string;
  confidence: number;
  impact: ImpactLevel;
  suggestion?: (match: RegExpMatchArray, line: string) => string;
}

// ============================================================================
// Configuration
// ============================================================================

/** Directory to store self-improvement data - in Obsidian brain */
const DATA_DIR = path.join(os.homedir(), '.atlas', 'brain', 'self');

/** File to store modification history */
const HISTORY_FILE = path.join(DATA_DIR, 'self-modifications.json');

/** Project root directory */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Directories allowed for self-modification (start conservative) */
const ALLOWED_DIRECTORIES = [
  'src/main/agent/',
  // Can expand later: 'src/main/utils/', 'src/main/voice/', etc.
];

/** Files to never modify */
const PROTECTED_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.env',
  '.env.example',
  'CLAUDE.md',
];

/** Git command timeout */
const GIT_TIMEOUT = 30000;

/** Max file size to analyze (1MB) */
const MAX_FILE_SIZE = 1024 * 1024;

// ============================================================================
// Analysis Patterns
// ============================================================================

/**
 * Patterns for detecting improvement opportunities
 */
const ANALYSIS_PATTERNS: AnalysisPattern[] = [
  // Performance patterns
  {
    type: 'performance',
    pattern: /for\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\w+)\.length/g,
    description: 'Array length accessed in loop condition (cache length)',
    confidence: 0.7,
    impact: 'minor',
    suggestion: (_match, line) => line.replace(/(\w+)\.length/, 'len /* cache $1.length */'),
  },
  {
    type: 'performance',
    pattern: /\.forEach\s*\(\s*(?:async\s*)?\(/g,
    description: 'forEach with async callback (use for...of for sequential)',
    confidence: 0.6,
    impact: 'moderate',
  },
  {
    type: 'performance',
    pattern: /JSON\.parse\(JSON\.stringify\(/g,
    description: 'Deep clone via JSON (use structuredClone or lodash)',
    confidence: 0.8,
    impact: 'minor',
  },
  {
    type: 'performance',
    pattern: /new RegExp\([^)]+\)/g,
    description: 'RegExp created in function body (move to constant)',
    confidence: 0.5,
    impact: 'minor',
  },

  // Readability patterns
  {
    type: 'readability',
    pattern:
      /function\s+\w+\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]+>)?)?\s*\{(?:[^{}]|\{[^{}]*\}){500,}/g,
    description: 'Function is very long (>500 chars), consider splitting',
    confidence: 0.6,
    impact: 'moderate',
  },
  {
    type: 'readability',
    pattern: /\/\/\s*TODO[:\s]/gi,
    description: 'TODO comment found',
    confidence: 0.9,
    impact: 'minor',
  },
  {
    type: 'readability',
    pattern: /\/\/\s*FIXME[:\s]/gi,
    description: 'FIXME comment found',
    confidence: 0.95,
    impact: 'moderate',
  },
  {
    type: 'readability',
    pattern: /\b(var)\s+\w+/g,
    description: 'Using var instead of let/const',
    confidence: 0.9,
    impact: 'minor',
  },
  {
    type: 'readability',
    pattern: /console\.(log|debug|info|warn|error)\(/g,
    description: 'Console statement (use logger instead)',
    confidence: 0.7,
    impact: 'minor',
  },

  // Bug potential patterns
  {
    type: 'bug-fix',
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
    description: 'Empty catch block (error swallowed)',
    confidence: 0.85,
    impact: 'moderate',
  },
  {
    type: 'bug-fix',
    pattern: /==(?!=)/g,
    description: 'Using == instead of === (type coercion)',
    confidence: 0.8,
    impact: 'minor',
  },
  {
    type: 'bug-fix',
    pattern: /!=(?!=)/g,
    description: 'Using != instead of !== (type coercion)',
    confidence: 0.8,
    impact: 'minor',
  },
  {
    type: 'bug-fix',
    pattern: /\.\s*then\s*\([^)]*\)\s*(?!\.catch)/g,
    description: 'Promise without catch handler',
    confidence: 0.5,
    impact: 'moderate',
  },
  {
    type: 'bug-fix',
    pattern: /(?<![\w.])null(?!able)/g,
    description: 'Null literal (consider undefined or optional chaining)',
    confidence: 0.3,
    impact: 'minor',
  },

  // Refactor patterns
  {
    type: 'refactor',
    pattern:
      /if\s*\([^)]+\)\s*\{\s*return\s+true\s*;?\s*\}\s*(?:else\s*)?\s*(?:\{?\s*)?return\s+false/gi,
    description: 'Redundant boolean return (return condition directly)',
    confidence: 0.9,
    impact: 'minor',
  },
  {
    type: 'refactor',
    pattern: /!\s*!\s*\w+/g,
    description: 'Double negation (use Boolean() for clarity)',
    confidence: 0.6,
    impact: 'minor',
  },
  {
    type: 'refactor',
    pattern: /\[\s*\]\.concat\(/g,
    description: 'Array concat from empty array (use spread operator)',
    confidence: 0.8,
    impact: 'minor',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a git command
 */
async function executeGitCommand(
  args: string[],
  cwd?: string
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  const workingDir = cwd || PROJECT_ROOT;

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
    }, GIT_TIMEOUT);

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
 * Generate a unique ID
 */
function generateId(): string {
  return `mod_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if a file path is within allowed directories
 */
function isAllowedPath(filePath: string): boolean {
  const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  // Check against protected files
  for (const protected_ of PROTECTED_FILES) {
    if (relativePath.endsWith(protected_)) {
      return false;
    }
  }

  // Check against allowed directories
  for (const allowed of ALLOWED_DIRECTORIES) {
    if (relativePath.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Ensure data directory exists
 */
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory may already exist
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Run TypeScript compiler to check for errors
 */
async function runTypeCheck(): Promise<{ success: boolean; errors: string[] }> {
  // Use npm to run typecheck
  const npmResult = await new Promise<{ success: boolean; stdout: string; stderr: string }>(
    (resolve) => {
      const spawnOptions: SpawnOptions = {
        cwd: PROJECT_ROOT,
        shell: true,
        windowsHide: true,
      };

      const proc = spawn('npm', ['run', 'typecheck'], spawnOptions);
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ success: false, stdout, stderr: 'Typecheck timed out' });
      }, 60000);

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
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ success: false, stdout: '', stderr: error.message });
      });
    }
  );

  const errors: string[] = [];
  if (!npmResult.success) {
    // Parse TypeScript errors from output
    const errorLines = (npmResult.stdout + npmResult.stderr)
      .split('\n')
      .filter((line) => line.includes('error TS'));
    errors.push(...errorLines);
  }

  return { success: npmResult.success, errors };
}

// ============================================================================
// SelfImprover Class
// ============================================================================

/**
 * Self-improving agent that can analyze and modify its own code
 */
class SelfImproverManager {
  private history: ModificationHistory;
  private isInitialized = false;
  private isVoiceInteractionActive = false;
  private lastAnalysisResults: ImprovementOpportunity[] = [];

  constructor() {
    this.history = {
      modifications: [],
      lastAnalysis: null,
      version: 1,
    };
  }

  /**
   * Initialize the self-improver
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await ensureDataDir();
    await this.loadHistory();
    this.isInitialized = true;

    logger.info('SelfImprover initialized', {
      historySize: this.history.modifications.length,
    });
  }

  /**
   * Load modification history from disk
   */
  private async loadHistory(): Promise<void> {
    try {
      const data = await fs.readFile(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data) as ModificationHistory;

      // Convert date strings back to Date objects
      this.history = {
        ...parsed,
        modifications: parsed.modifications.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load history, starting fresh', {
          error: (error as Error).message,
        });
      }
      // Start with empty history
    }
  }

  /**
   * Save modification history to disk
   */
  private async saveHistory(): Promise<void> {
    await ensureDataDir();
    await fs.writeFile(HISTORY_FILE, JSON.stringify(this.history, null, 2), 'utf-8');
  }

  /**
   * Add a modification to history
   */
  private async addModification(modification: SelfModification): Promise<void> {
    this.history.modifications.push(modification);

    // Keep history manageable (last 100 modifications)
    if (this.history.modifications.length > 100) {
      this.history.modifications = this.history.modifications.slice(-100);
    }

    await this.saveHistory();
  }

  /**
   * Set voice interaction state
   */
  setVoiceInteractionActive(active: boolean): void {
    this.isVoiceInteractionActive = active;
    logger.debug('Voice interaction state changed', { active });
  }

  /**
   * Check if self-improvement is safe right now
   */
  canSafelyModify(): boolean {
    // Don't modify during voice interaction
    if (this.isVoiceInteractionActive) {
      logger.debug('Cannot modify: voice interaction active');
      return false;
    }

    // Check git status - ensure we're in a clean state or can stash
    // This is checked during actual modification

    return true;
  }

  /**
   * Analyze own code for improvements (synchronous wrapper)
   * Note: For proper async operation, use analyzeForImprovementsAsync()
   */
  analyzeForImprovements(): ImprovementOpportunity[] {
    // Return cached results; caller should use async method for fresh analysis
    return this.lastAnalysisResults;
  }

  /**
   * Get pending/last analysis results
   */
  getPendingAnalysis(): ImprovementOpportunity[] {
    return this.lastAnalysisResults;
  }

  /**
   * Async version of analysis
   */
  async analyzeForImprovementsAsync(): Promise<ImprovementOpportunity[]> {
    await this.initialize();

    const opportunities: ImprovementOpportunity[] = [];

    // Scan allowed directories
    for (const allowedDir of ALLOWED_DIRECTORIES) {
      const fullDir = path.join(PROJECT_ROOT, allowedDir);

      try {
        await this.analyzeDirectory(fullDir, opportunities);
      } catch (error) {
        logger.warn('Failed to analyze directory', {
          dir: allowedDir,
          error: (error as Error).message,
        });
      }
    }

    // Sort by confidence * impact weight
    const impactWeight: Record<ImpactLevel, number> = {
      minor: 1,
      moderate: 2,
      significant: 3,
    };

    opportunities.sort((a, b) => {
      const scoreA = a.confidence * impactWeight[a.impact];
      const scoreB = b.confidence * impactWeight[b.impact];
      return scoreB - scoreA;
    });

    // Cache results for synchronous access
    this.lastAnalysisResults = opportunities;

    this.history.lastAnalysis = new Date().toISOString();
    await this.saveHistory();

    logger.info('Analysis complete', { opportunitiesFound: opportunities.length });

    return opportunities;
  }

  /**
   * Analyze a directory recursively
   */
  private async analyzeDirectory(
    dirPath: string,
    opportunities: ImprovementOpportunity[]
  ): Promise<void> {
    let entries: string[];

    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return; // Directory doesn't exist or not accessible
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules, dist, etc.
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry)) {
          await this.analyzeDirectory(fullPath, opportunities);
        }
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        await this.analyzeFile(fullPath, opportunities);
      }
    }
  }

  /**
   * Analyze a single file for improvements
   */
  private async analyzeFile(
    filePath: string,
    opportunities: ImprovementOpportunity[]
  ): Promise<void> {
    const stat = await fs.stat(filePath);

    // Skip large files
    if (stat.size > MAX_FILE_SIZE) {
      return;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

    for (const pattern of ANALYSIS_PATTERNS) {
      // Reset regex state
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const line = lines[lineNumber - 1] || '';

        const opportunity: ImprovementOpportunity = {
          id: generateId(),
          type: pattern.type,
          file: relativePath,
          description: pattern.description,
          confidence: pattern.confidence,
          impact: pattern.impact,
          lineNumber,
          originalCode: line.trim(),
        };

        // Generate suggestion if pattern provides one
        if (pattern.suggestion) {
          try {
            opportunity.suggestedChange = pattern.suggestion(match, line);
          } catch {
            // Suggestion generation failed, skip
          }
        }

        opportunities.push(opportunity);
      }
    }
  }

  /**
   * Implement an improvement autonomously
   */
  async implementImprovement(opportunity: ImprovementOpportunity): Promise<ChangeResult> {
    await this.initialize();

    // Safety checks
    if (!this.canSafelyModify()) {
      return {
        success: false,
        error: 'Cannot modify: system is busy (voice interaction active)',
        rollbackAvailable: false,
      };
    }

    const fullPath = path.join(PROJECT_ROOT, opportunity.file);

    if (!isAllowedPath(fullPath)) {
      return {
        success: false,
        error: `File ${opportunity.file} is not in allowed modification paths`,
        rollbackAvailable: false,
      };
    }

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      return {
        success: false,
        error: `File not found: ${opportunity.file}`,
        rollbackAvailable: false,
      };
    }

    // Create rollback point (stash current changes)
    const stashResult = await this.createRollbackPoint();
    if (!stashResult.success) {
      logger.warn('Could not create stash, proceeding anyway', {
        reason: stashResult.message,
      });
    }

    try {
      // Read current file content
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Apply change based on opportunity
      let newContent: string;
      let changeDescription: string;

      if (opportunity.suggestedChange && opportunity.lineNumber) {
        // Apply line-specific change
        const lineIndex = opportunity.lineNumber - 1;
        if (lineIndex >= 0 && lineIndex < lines.length) {
          lines[lineIndex] = opportunity.suggestedChange;
          newContent = lines.join('\n');
          changeDescription = `Applied suggested change at line ${opportunity.lineNumber}`;
        } else {
          return {
            success: false,
            error: 'Line number out of range',
            rollbackAvailable: stashResult.success,
          };
        }
      } else {
        // For opportunities without specific suggestions, we log but don't auto-fix
        return {
          success: false,
          error: 'No automated fix available for this improvement. Manual review needed.',
          rollbackAvailable: false,
        };
      }

      // Write the change
      await fs.writeFile(fullPath, newContent, 'utf-8');

      // Run type check to verify change doesn't break anything
      const typeCheckResult = await runTypeCheck();

      if (!typeCheckResult.success) {
        // Rollback the change
        await fs.writeFile(fullPath, content, 'utf-8');
        logger.warn('Change failed type check, rolled back', {
          file: opportunity.file,
          errors: typeCheckResult.errors.slice(0, 3),
        });

        return {
          success: false,
          error: `Change failed type check: ${typeCheckResult.errors[0] || 'Unknown error'}`,
          rollbackAvailable: stashResult.success,
        };
      }

      // Get diff
      const diffResult = await executeGitCommand(['diff', opportunity.file]);
      const diff = diffResult.stdout;

      // Create commit
      const commitMessage = `self-improve(${opportunity.type}): ${opportunity.description}`;
      await executeGitCommand(['add', fullPath]);
      const commitResult = await executeGitCommand(['commit', '-m', commitMessage]);

      const modification: SelfModification = {
        id: generateId(),
        timestamp: new Date(),
        files: [opportunity.file],
        description: changeDescription,
        reason: opportunity.description,
        diff,
        impact: opportunity.impact,
        gitCommit: commitResult.success
          ? commitResult.stdout.match(/\[.+ ([a-f0-9]+)\]/)?.[1]
          : undefined,
        rolledBack: false,
        type: opportunity.type,
        stashRef: stashResult.stashRef,
      };

      await this.addModification(modification);

      logger.info('Improvement implemented', {
        id: modification.id,
        file: opportunity.file,
        type: opportunity.type,
        commit: modification.gitCommit,
      });

      return {
        success: true,
        modification,
        rollbackAvailable: true,
      };
    } catch (error) {
      logger.error('Failed to implement improvement', {
        opportunity: opportunity.id,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: (error as Error).message,
        rollbackAvailable: stashResult.success,
      };
    }
  }

  /**
   * Create a rollback point using git stash
   */
  private async createRollbackPoint(): Promise<{
    success: boolean;
    message?: string;
    stashRef?: string;
  }> {
    // Check if there are changes to stash
    const statusResult = await executeGitCommand(['status', '--porcelain']);

    if (!statusResult.stdout.trim()) {
      // No changes to stash, that's fine
      return { success: true, message: 'Working directory clean, no stash needed' };
    }

    // Create stash with descriptive message
    const stashMessage = `self-improver-backup-${Date.now()}`;
    const stashResult = await executeGitCommand(['stash', 'push', '-m', stashMessage]);

    if (stashResult.success) {
      // Get stash ref
      const listResult = await executeGitCommand(['stash', 'list', '-1']);
      const stashRef = listResult.stdout.match(/stash@\{0\}/)?.[0];

      return {
        success: true,
        message: 'Changes stashed',
        stashRef,
      };
    }

    return {
      success: false,
      message: stashResult.stderr || 'Failed to create stash',
    };
  }

  /**
   * Rollback a specific modification
   */
  async rollback(modificationId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    await this.initialize();

    const modification = this.history.modifications.find((m) => m.id === modificationId);

    if (!modification) {
      return { success: false, error: 'Modification not found' };
    }

    if (modification.rolledBack) {
      return { success: false, error: 'Modification already rolled back' };
    }

    if (!modification.gitCommit) {
      return { success: false, error: 'No git commit to rollback' };
    }

    try {
      // Revert the commit
      const revertResult = await executeGitCommand([
        'revert',
        '--no-commit',
        modification.gitCommit,
      ]);

      if (!revertResult.success) {
        return {
          success: false,
          error: `Git revert failed: ${revertResult.stderr}`,
        };
      }

      // Commit the revert
      const commitResult = await executeGitCommand([
        'commit',
        '-m',
        `Revert: ${modification.description}`,
      ]);

      if (commitResult.success) {
        modification.rolledBack = true;
        await this.saveHistory();

        logger.info('Modification rolled back', {
          id: modificationId,
          originalCommit: modification.gitCommit,
        });

        return { success: true };
      } else {
        // Reset if commit failed
        await executeGitCommand(['reset', '--hard', 'HEAD']);
        return {
          success: false,
          error: `Commit failed: ${commitResult.stderr}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get all modification history
   */
  getChangeHistory(): SelfModification[] {
    return [...this.history.modifications];
  }

  /**
   * Get modifications from a time range
   */
  getChangesSince(since: Date): SelfModification[] {
    return this.history.modifications.filter((m) => m.timestamp >= since);
  }

  /**
   * Report recent changes in natural language
   */
  reportRecentChanges(): string {
    const recentChanges = this.getChangesSince(
      new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    );

    if (recentChanges.length === 0) {
      return "I haven't made any changes to my code in the last 24 hours.";
    }

    const lines: string[] = [];
    lines.push(
      `I've made ${recentChanges.length} change${recentChanges.length === 1 ? '' : 's'} in the last 24 hours:\n`
    );

    for (const change of recentChanges) {
      const time = change.timestamp.toLocaleTimeString();
      const status = change.rolledBack ? ' (rolled back)' : '';
      lines.push(`- [${time}] ${change.type}: ${change.description}${status}`);
      lines.push(`  Files: ${change.files.join(', ')}`);
      lines.push(`  Reason: ${change.reason}`);
      if (change.gitCommit) {
        lines.push(`  Commit: ${change.gitCommit}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate a detailed report of all modifications
   */
  getDetailedReport(): string {
    const lines: string[] = [];
    lines.push('=== Self-Improvement History ===\n');
    lines.push(`Total modifications: ${this.history.modifications.length}`);
    lines.push(`Last analysis: ${this.history.lastAnalysis || 'Never'}\n`);

    // Group by type
    const byType: Record<string, SelfModification[]> = {};
    for (const mod of this.history.modifications) {
      if (!byType[mod.type]) {
        byType[mod.type] = [];
      }
      byType[mod.type].push(mod);
    }

    for (const [type, mods] of Object.entries(byType)) {
      lines.push(`\n### ${type.toUpperCase()} (${mods.length})`);
      for (const mod of mods.slice(-5)) {
        // Show last 5 of each type
        const date = mod.timestamp.toLocaleDateString();
        const status = mod.rolledBack ? ' [ROLLED BACK]' : '';
        lines.push(`  ${date}: ${mod.description}${status}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get statistics about self-improvements
   */
  getStats(): {
    totalModifications: number;
    successfulModifications: number;
    rolledBackCount: number;
    byType: Record<string, number>;
    byImpact: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byImpact: Record<string, number> = {};
    let rolledBackCount = 0;

    for (const mod of this.history.modifications) {
      byType[mod.type] = (byType[mod.type] || 0) + 1;
      byImpact[mod.impact] = (byImpact[mod.impact] || 0) + 1;
      if (mod.rolledBack) {
        rolledBackCount++;
      }
    }

    return {
      totalModifications: this.history.modifications.length,
      successfulModifications: this.history.modifications.length - rolledBackCount,
      rolledBackCount,
      byType,
      byImpact,
    };
  }

  /**
   * Clear old modification history
   */
  async clearOldHistory(beforeDate: Date): Promise<number> {
    const originalCount = this.history.modifications.length;
    this.history.modifications = this.history.modifications.filter(
      (m) => m.timestamp >= beforeDate
    );
    const removedCount = originalCount - this.history.modifications.length;

    if (removedCount > 0) {
      await this.saveHistory();
      logger.info('Cleared old history', { removedCount });
    }

    return removedCount;
  }

  /**
   * Add a custom allowed directory for modification
   */
  addAllowedDirectory(dir: string): void {
    if (!ALLOWED_DIRECTORIES.includes(dir)) {
      ALLOWED_DIRECTORIES.push(dir);
      logger.info('Added allowed directory', { dir });
    }
  }

  /**
   * Remove a directory from allowed list
   */
  removeAllowedDirectory(dir: string): boolean {
    const index = ALLOWED_DIRECTORIES.indexOf(dir);
    if (index > -1) {
      ALLOWED_DIRECTORIES.splice(index, 1);
      logger.info('Removed allowed directory', { dir });
      return true;
    }
    return false;
  }

  /**
   * Get list of allowed directories
   */
  getAllowedDirectories(): string[] {
    return [...ALLOWED_DIRECTORIES];
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance */
let instance: SelfImproverManager | null = null;

/**
 * Get the SelfImprover singleton instance
 */
export function getSelfImprover(): SelfImproverManager {
  if (!instance) {
    instance = new SelfImproverManager();
  }
  return instance;
}

/**
 * Initialize the self-improver
 */
export async function initializeSelfImprover(): Promise<SelfImproverManager> {
  const improver = getSelfImprover();
  await improver.initialize();
  return improver;
}

/**
 * Shutdown the self-improver
 */
export function shutdownSelfImprover(): void {
  if (instance) {
    logger.info('SelfImprover shutdown');
    instance = null;
  }
}

// Export the manager class for testing
export { SelfImproverManager };

export default {
  getSelfImprover,
  initializeSelfImprover,
  shutdownSelfImprover,
};
