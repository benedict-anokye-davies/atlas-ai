/**
 * Nova Desktop - Git Command Validator
 * Validates git operations for safety
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { GitOperation } from '../types';

/**
 * Dangerous git operations that require confirmation
 */
export const DANGEROUS_OPERATIONS: GitOperation[] = [
  'push', // Can overwrite remote history with --force
  'reset', // Can lose work with --hard
  'rebase', // Can rewrite history
  'revert', // Modifies history
  'cherry-pick', // Can cause conflicts
  'merge', // Can cause conflicts
];

/**
 * Destructive git flags
 */
export const DESTRUCTIVE_FLAGS = [
  '--force',
  '-f',
  '--hard',
  '--delete',
  '-D',
  '--force-with-lease',
];

/**
 * Protected branches (should not be force-pushed or deleted)
 */
export const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'production', 'release'];

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
  requiresConfirmation: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  try {
    const gitDir = path.join(dir, '.git');
    const stats = await fs.stat(gitDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find the git repository root from a given path
 */
export async function findGitRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);

  while (currentPath !== path.dirname(currentPath)) {
    if (await isGitRepository(currentPath)) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }

  return null;
}

/**
 * Validate a branch name
 */
export function validateBranchName(name: string): ValidationResult {
  const warnings: string[] = [];
  let valid = true;
  let error: string | undefined;

  // Check for invalid characters
  const invalidChars = /[~^:?*[\]\\@{}\s]/;
  if (invalidChars.test(name)) {
    valid = false;
    error = 'Branch name contains invalid characters';
  }

  // Check for problematic patterns
  if (name.startsWith('-')) {
    valid = false;
    error = 'Branch name cannot start with a hyphen';
  }

  if (name.endsWith('.') || name.endsWith('/')) {
    valid = false;
    error = 'Branch name cannot end with a period or slash';
  }

  if (name.includes('..')) {
    valid = false;
    error = 'Branch name cannot contain consecutive periods';
  }

  if (name.includes('@{')) {
    valid = false;
    error = 'Branch name cannot contain @{';
  }

  // Warnings for protected branches
  if (PROTECTED_BRANCHES.includes(name.toLowerCase())) {
    warnings.push(`'${name}' is typically a protected branch`);
  }

  return {
    valid,
    error,
    warnings,
    requiresConfirmation: warnings.length > 0,
    riskLevel: warnings.length > 0 ? 'medium' : 'low',
  };
}

/**
 * Validate a commit message
 */
export function validateCommitMessage(message: string): ValidationResult {
  const warnings: string[] = [];
  let valid = true;
  let error: string | undefined;

  if (!message || message.trim().length === 0) {
    valid = false;
    error = 'Commit message cannot be empty';
  }

  // Check for conventional commit format (optional warning)
  const conventionalPattern = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:/;
  if (!conventionalPattern.test(message)) {
    warnings.push('Message does not follow conventional commit format');
  }

  // Warn about very short messages
  if (message.length < 10) {
    warnings.push('Commit message is very short');
  }

  // Warn about very long subject lines
  const firstLine = message.split('\n')[0];
  if (firstLine.length > 72) {
    warnings.push('Subject line exceeds 72 characters');
  }

  return {
    valid,
    error,
    warnings,
    requiresConfirmation: false,
    riskLevel: 'low',
  };
}

/**
 * Validate git push operation
 */
export function validatePushOperation(options: {
  force?: boolean;
  branch?: string;
  remote?: string;
}): ValidationResult {
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let requiresConfirmation = false;

  if (options.force) {
    warnings.push('Force push will overwrite remote history');
    riskLevel = 'high';
    requiresConfirmation = true;

    if (options.branch && PROTECTED_BRANCHES.includes(options.branch.toLowerCase())) {
      warnings.push(`Force pushing to protected branch '${options.branch}' is dangerous`);
    }
  }

  return {
    valid: true,
    warnings,
    requiresConfirmation,
    riskLevel,
  };
}

/**
 * Validate git reset operation
 */
export function validateResetOperation(options: {
  mode: 'soft' | 'mixed' | 'hard';
  to?: string;
}): ValidationResult {
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let requiresConfirmation = false;

  if (options.mode === 'hard') {
    warnings.push('Hard reset will discard all uncommitted changes');
    riskLevel = 'high';
    requiresConfirmation = true;
  }

  if (options.to && (options.to.includes('HEAD~') || options.to.includes('HEAD^'))) {
    warnings.push('Resetting to previous commits may lose recent work');
    if (riskLevel !== 'high') riskLevel = 'medium';
    requiresConfirmation = true;
  }

  return {
    valid: true,
    warnings,
    requiresConfirmation,
    riskLevel,
  };
}

/**
 * Validate git merge operation
 */
export function validateMergeOperation(options: { branch: string; abort?: boolean }): ValidationResult {
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  if (PROTECTED_BRANCHES.includes(options.branch.toLowerCase())) {
    warnings.push(`Merging from protected branch '${options.branch}'`);
    riskLevel = 'medium';
  }

  return {
    valid: true,
    warnings,
    requiresConfirmation: warnings.length > 0,
    riskLevel,
  };
}

/**
 * Validate git rebase operation
 */
export function validateRebaseOperation(options: {
  onto: string;
  interactive?: boolean;
  abort?: boolean;
  continue?: boolean;
}): ValidationResult {
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  let requiresConfirmation = true;

  warnings.push('Rebase rewrites commit history');

  if (options.interactive) {
    warnings.push('Interactive rebase requires manual intervention');
    riskLevel = 'high';
  }

  if (options.abort || options.continue) {
    // These are recovery operations, lower risk
    riskLevel = 'low';
    requiresConfirmation = false;
    warnings.length = 0;
  }

  return {
    valid: true,
    warnings,
    requiresConfirmation,
    riskLevel,
  };
}

/**
 * Validate a file path for git operations
 */
export function validateFilePath(filePath: string): ValidationResult {
  const warnings: string[] = [];
  const valid = true;
  let error: string | undefined;

  // Check for path traversal
  if (filePath.includes('..')) {
    warnings.push('Path contains parent directory reference');
  }

  // Check for absolute paths (might indicate unintended scope)
  if (path.isAbsolute(filePath)) {
    warnings.push('Using absolute path - ensure this is intentional');
  }

  // Check for sensitive files
  const sensitivePatterns = ['.env', '.pem', '.key', 'id_rsa', 'credentials'];
  for (const pattern of sensitivePatterns) {
    if (filePath.toLowerCase().includes(pattern)) {
      warnings.push(`Path may contain sensitive file: ${pattern}`);
    }
  }

  return {
    valid,
    error,
    warnings,
    requiresConfirmation: warnings.length > 0,
    riskLevel: warnings.length > 0 ? 'medium' : 'low',
  };
}

/**
 * Validate URL for git remote operations
 */
export function validateRemoteUrl(url: string): ValidationResult {
  const warnings: string[] = [];
  let valid = true;
  let error: string | undefined;

  // Basic URL validation
  if (!url || url.trim().length === 0) {
    valid = false;
    error = 'Remote URL cannot be empty';
  }

  // Check for common patterns
  const validPatterns = [
    /^https?:\/\//,
    /^git@[\w.-]+:/,
    /^ssh:\/\//,
    /^git:\/\//,
  ];

  if (valid && !validPatterns.some((p) => p.test(url))) {
    warnings.push('URL does not match common git remote patterns');
  }

  return {
    valid,
    error,
    warnings,
    requiresConfirmation: false,
    riskLevel: 'low',
  };
}

export default {
  isGitRepository,
  findGitRoot,
  validateBranchName,
  validateCommitMessage,
  validatePushOperation,
  validateResetOperation,
  validateMergeOperation,
  validateRebaseOperation,
  validateFilePath,
  validateRemoteUrl,
  DANGEROUS_OPERATIONS,
  DESTRUCTIVE_FLAGS,
  PROTECTED_BRANCHES,
};
