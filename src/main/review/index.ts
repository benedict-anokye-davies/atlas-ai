/**
 * Code Review System
 * Entry point for code review and security scanning
 */

export * from './types';
export { getCodeReviewer, CodeReviewer } from './code-reviewer';
export { getSecurityScanner, SecurityScanner } from './security-scanner';

import { getCodeReviewer } from './code-reviewer';
import { getSecurityScanner } from './security-scanner';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Review');

/**
 * Initialize the code review system
 */
export async function initializeReviewSystem(): Promise<void> {
  logger.info('Initializing code review system');
  
  const reviewer = getCodeReviewer();
  const scanner = getSecurityScanner();
  
  await Promise.all([
    reviewer.initialize(),
    scanner.initialize()
  ]);
  
  logger.info('Code review system initialized');
}

/**
 * Perform full review (code + security)
 */
export async function performFullReview(
  target: string,
  options: {
    recursive?: boolean;
    extensions?: string[];
    includeTests?: boolean;
    maxIssues?: number;
  } = {}
) {
  const reviewer = getCodeReviewer();
  const scanner = getSecurityScanner();
  
  const [codeReview, securityScan] = await Promise.all([
    reviewer.reviewDirectory(target, options),
    scanner.scanDirectory(target, options)
  ]);
  
  return {
    codeReview,
    securityScan,
    summary: {
      filesReviewed: codeReview.length,
      totalIssues: codeReview.reduce((sum, r) => sum + r.issues.length, 0),
      totalSuggestions: codeReview.reduce((sum, r) => sum + r.suggestions.length, 0),
      vulnerabilities: securityScan.vulnerabilities.length,
      secrets: securityScan.secrets.length,
      averageScore: codeReview.length > 0 
        ? Math.round(codeReview.reduce((sum, r) => sum + r.overallScore, 0) / codeReview.length)
        : 100
    }
  };
}
