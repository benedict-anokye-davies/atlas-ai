/**
 * Code Reviewer
 * AI-powered code review system
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import {
  CodeReviewResult,
  CodeIssue,
  CodeSuggestion,
  CodeMetrics,
  IssueType,
  IssueSeverity,
  SuggestionType,
  ReviewOptions
} from './types';

const logger = createModuleLogger('CodeReviewer');

// Common code patterns that indicate issues
const CODE_PATTERNS: Array<{
  pattern: RegExp;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
}> = [
  {
    pattern: /console\.(log|debug|info|warn|error)\(/g,
    type: 'maintainability',
    severity: 'low',
    title: 'Console statement found',
    description: 'Console statements should be removed or replaced with proper logging'
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/gi,
    type: 'maintainability',
    severity: 'info',
    title: 'TODO comment found',
    description: 'Consider addressing or tracking this TODO item'
  },
  {
    pattern: /any(?:\s*[;,\)\]\}]|\s+[a-zA-Z])/g,
    type: 'maintainability',
    severity: 'medium',
    title: 'TypeScript any type used',
    description: 'Avoid using any type - use specific types or unknown'
  },
  {
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
    type: 'bug',
    severity: 'high',
    title: 'Empty catch block',
    description: 'Empty catch blocks silently swallow errors'
  },
  {
    pattern: /eval\s*\(/g,
    type: 'security',
    severity: 'critical',
    title: 'eval() usage detected',
    description: 'eval() is dangerous and can lead to code injection'
  },
  {
    pattern: /innerHTML\s*=/g,
    type: 'security',
    severity: 'high',
    title: 'innerHTML assignment',
    description: 'innerHTML can lead to XSS vulnerabilities - use textContent or sanitize'
  },
  {
    pattern: /document\.write\s*\(/g,
    type: 'security',
    severity: 'high',
    title: 'document.write usage',
    description: 'document.write can cause security issues and performance problems'
  },
  {
    pattern: /new\s+Function\s*\(/g,
    type: 'security',
    severity: 'high',
    title: 'Function constructor usage',
    description: 'Function constructor is similar to eval and poses security risks'
  },
  {
    pattern: /setTimeout|setInterval\s*\(\s*["'`]/g,
    type: 'security',
    severity: 'medium',
    title: 'String argument in timer',
    description: 'Passing strings to setTimeout/setInterval is like eval'
  },
  {
    pattern: /if\s*\([^)]+\)\s*\{[^}]*\}\s*else\s*\{[^}]*\}\s*else/g,
    type: 'complexity',
    severity: 'medium',
    title: 'Nested else-if chain',
    description: 'Consider using switch statement or early returns'
  },
  {
    pattern: /function\s+\w+\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/g,
    type: 'maintainability',
    severity: 'medium',
    title: 'Function with many parameters',
    description: 'Functions with 5+ parameters are hard to maintain - consider using an options object'
  },
  {
    pattern: /\.then\s*\([^)]+\)\s*\.then\s*\([^)]+\)\s*\.then/g,
    type: 'maintainability',
    severity: 'low',
    title: 'Promise chain depth',
    description: 'Consider using async/await for better readability'
  },
  {
    pattern: /password\s*[:=]\s*["'`][^"'`]+["'`]/gi,
    type: 'security',
    severity: 'critical',
    title: 'Hardcoded password',
    description: 'Passwords should never be hardcoded - use environment variables'
  },
  {
    pattern: /api[_-]?key\s*[:=]\s*["'`][^"'`]+["'`]/gi,
    type: 'security',
    severity: 'critical',
    title: 'Hardcoded API key',
    description: 'API keys should never be hardcoded - use environment variables'
  }
];

// Suggestion patterns
const SUGGESTION_PATTERNS: Array<{
  pattern: RegExp;
  type: SuggestionType;
  title: string;
  description: string;
  rationale: string;
}> = [
  {
    pattern: /var\s+\w+\s*=/g,
    type: 'modernize',
    title: 'Use const/let instead of var',
    description: 'Replace var with const or let for better scoping',
    rationale: 'const and let have block scope and prevent hoisting issues'
  },
  {
    pattern: /function\s*\([^)]*\)\s*\{[^}]*return\s+[^;]+;\s*\}/g,
    type: 'simplify',
    title: 'Consider arrow function',
    description: 'Simple functions can be written as arrow functions',
    rationale: 'Arrow functions are more concise for simple operations'
  },
  {
    pattern: /\.forEach\s*\(\s*function/g,
    type: 'modernize',
    title: 'Use arrow function in forEach',
    description: 'Replace function with arrow function in callbacks',
    rationale: 'Arrow functions are more concise and share this context'
  },
  {
    pattern: /Object\.assign\s*\(\s*\{\s*\}/g,
    type: 'modernize',
    title: 'Use spread operator',
    description: 'Replace Object.assign({}, ...) with spread {...}',
    rationale: 'Spread operator is more readable and performant'
  },
  {
    pattern: /\.concat\s*\(/g,
    type: 'modernize',
    title: 'Use spread for array concatenation',
    description: 'Replace .concat() with spread [...arr1, ...arr2]',
    rationale: 'Spread operator is more readable for array operations'
  },
  {
    pattern: /if\s*\([^)]+\)\s*return\s+true;\s*else\s*return\s+false;/g,
    type: 'simplify',
    title: 'Simplify boolean return',
    description: 'Return the condition directly instead of if-else',
    rationale: 'Directly returning the boolean expression is cleaner'
  },
  {
    pattern: /===\s*null\s*\|\|\s*===\s*undefined|===\s*undefined\s*\|\|\s*===\s*null/g,
    type: 'simplify',
    title: 'Use nullish check',
    description: 'Use == null to check both null and undefined',
    rationale: '== null checks both null and undefined in one operation'
  }
];

class CodeReviewer extends EventEmitter {
  private initialized: boolean = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info('Initializing code reviewer');
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Review a single file
   */
  async reviewFile(
    filePath: string,
    options: ReviewOptions = {}
  ): Promise<CodeReviewResult> {
    const startTime = Date.now();
    
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Find issues
      const issues = this.findIssues(content, lines, filePath, options);

      // Generate suggestions
      const suggestions = this.generateSuggestions(content, lines, filePath, options);

      // Calculate metrics
      const metrics = this.calculateMetrics(content, lines);

      // Calculate overall score
      const overallScore = this.calculateScore(issues, metrics);

      const result: CodeReviewResult = {
        file: filePath,
        issues,
        suggestions,
        metrics,
        overallScore,
        reviewedAt: new Date()
      };

      logger.info(`Review completed for ${path.basename(filePath)}`, {
        issues: issues.length,
        suggestions: suggestions.length,
        score: overallScore,
        time: Date.now() - startTime
      });

      this.emit('review-complete', result);
      return result;
    } catch (error) {
      logger.error('Review failed', error);
      throw error;
    }
  }

  /**
   * Review a git diff
   */
  async reviewDiff(
    diff: string,
    options: ReviewOptions = {}
  ): Promise<CodeReviewResult[]> {
    const results: CodeReviewResult[] = [];
    
    // Parse diff to extract changed files and their content
    const fileChanges = this.parseDiff(diff);
    
    for (const [file, content] of fileChanges) {
      const lines = content.split('\n');
      const issues = this.findIssues(content, lines, file, options);
      const suggestions = this.generateSuggestions(content, lines, file, options);
      const metrics = this.calculateMetrics(content, lines);
      
      results.push({
        file,
        issues,
        suggestions,
        metrics,
        overallScore: this.calculateScore(issues, metrics),
        reviewedAt: new Date()
      });
    }
    
    return results;
  }

  /**
   * Review multiple files in a directory
   */
  async reviewDirectory(
    dirPath: string,
    options: ReviewOptions & { recursive?: boolean; extensions?: string[] } = {}
  ): Promise<CodeReviewResult[]> {
    const extensions = options.extensions || ['.ts', '.js', '.tsx', '.jsx'];
    const files = this.getFilesInDirectory(dirPath, options.recursive ?? true, extensions);
    
    const results: CodeReviewResult[] = [];
    
    for (const file of files) {
      // Skip if matches ignore patterns
      if (this.shouldIgnore(file, options.ignorePatterns || [])) {
        continue;
      }
      
      try {
        const result = await this.reviewFile(file, options);
        results.push(result);
      } catch (error) {
        logger.warn(`Failed to review ${file}`, error);
      }
    }
    
    return results;
  }

  /**
   * Find issues in code
   */
  private findIssues(
    content: string,
    lines: string[],
    filePath: string,
    options: ReviewOptions
  ): CodeIssue[] {
    const issues: CodeIssue[] = [];
    let issueId = 0;

    for (const pattern of CODE_PATTERNS) {
      // Skip if severity below threshold
      if (options.severityThreshold && 
          this.severityToNumber(pattern.severity) < this.severityToNumber(options.severityThreshold)) {
        continue;
      }

      // Reset regex lastIndex
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        
        issues.push({
          id: `issue-${++issueId}`,
          type: pattern.type,
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          file: filePath,
          line: lineNumber,
          code: lines[lineNumber - 1]?.trim()
        });

        // Limit issues if specified
        if (options.maxIssues && issues.length >= options.maxIssues) {
          return issues;
        }
      }
    }

    // Sort by severity
    issues.sort((a, b) => this.severityToNumber(b.severity) - this.severityToNumber(a.severity));

    return issues;
  }

  /**
   * Generate code suggestions
   */
  private generateSuggestions(
    content: string,
    lines: string[],
    filePath: string,
    _options: ReviewOptions
  ): CodeSuggestion[] {
    const suggestions: CodeSuggestion[] = [];
    let suggestionId = 0;

    for (const pattern of SUGGESTION_PATTERNS) {
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        
        suggestions.push({
          id: `suggestion-${++suggestionId}`,
          type: pattern.type,
          title: pattern.title,
          description: pattern.description,
          file: filePath,
          line: lineNumber,
          currentCode: lines[lineNumber - 1]?.trim(),
          rationale: pattern.rationale,
          impact: 'medium'
        });
      }
    }

    return suggestions;
  }

  /**
   * Calculate code metrics
   */
  private calculateMetrics(content: string, lines: string[]): CodeMetrics {
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    
    // Calculate cyclomatic complexity (simplified)
    const complexityKeywords = /\b(if|else|for|while|do|switch|case|catch|&&|\|\||\?)/g;
    const complexityMatches = content.match(complexityKeywords) || [];
    const cyclomaticComplexity = complexityMatches.length + 1;
    
    // Calculate cognitive complexity (simplified)
    const nestingMatches = content.match(/\{[^}]*\{/g) || [];
    const cognitiveComplexity = cyclomaticComplexity + nestingMatches.length;
    
    // Count duplicate lines (simplified)
    const lineSet = new Set(nonEmptyLines.map(l => l.trim()));
    const duplicateLines = nonEmptyLines.length - lineSet.size;
    
    // Documentation coverage
    const commentLines = lines.filter(l => 
      l.trim().startsWith('//') || 
      l.trim().startsWith('/*') || 
      l.trim().startsWith('*')
    ).length;
    const documentationCoverage = Math.round((commentLines / nonEmptyLines.length) * 100);
    
    // Count dependencies
    const importMatches = content.match(/^import\s+/gm) || [];
    const requireMatches = content.match(/require\s*\(/g) || [];
    const dependencies = importMatches.length + requireMatches.length;
    
    // Calculate maintainability index (simplified)
    const maintainabilityIndex = Math.max(0, Math.min(100, 
      171 - 5.2 * Math.log(cyclomaticComplexity) - 0.23 * lines.length
    ));
    
    return {
      linesOfCode: nonEmptyLines.length,
      cyclomaticComplexity,
      cognitiveComplexity,
      maintainabilityIndex: Math.round(maintainabilityIndex),
      duplicateLines,
      documentationCoverage,
      dependencies
    };
  }

  /**
   * Calculate overall score
   */
  private calculateScore(issues: CodeIssue[], metrics: CodeMetrics): number {
    let score = 100;
    
    // Deduct for issues
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical': score -= 15; break;
        case 'high': score -= 10; break;
        case 'medium': score -= 5; break;
        case 'low': score -= 2; break;
        case 'info': score -= 1; break;
      }
    }
    
    // Deduct for complexity
    if (metrics.cyclomaticComplexity > 20) score -= 10;
    else if (metrics.cyclomaticComplexity > 10) score -= 5;
    
    // Deduct for low documentation
    if (metrics.documentationCoverage < 10) score -= 5;
    
    // Deduct for duplicates
    if (metrics.duplicateLines > 20) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Parse git diff
   */
  private parseDiff(diff: string): Map<string, string> {
    const files = new Map<string, string>();
    
    const diffParts = diff.split(/^diff --git/m);
    
    for (const part of diffParts) {
      if (!part.trim()) continue;
      
      const fileMatch = part.match(/a\/(.+?)\s+b\/(.+)/);
      if (fileMatch) {
        const fileName = fileMatch[2];
        
        // Extract added/modified lines
        const addedLines: string[] = [];
        const lines = part.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            addedLines.push(line.slice(1));
          }
        }
        
        files.set(fileName, addedLines.join('\n'));
      }
    }
    
    return files;
  }

  /**
   * Get files in directory
   */
  private getFilesInDirectory(
    dirPath: string,
    recursive: boolean,
    extensions: string[]
  ): string[] {
    const files: string[] = [];
    
    if (!fs.existsSync(dirPath)) return files;
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      } else if (entry.isDirectory() && recursive) {
        // Skip common non-code directories
        if (!['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) {
          files.push(...this.getFilesInDirectory(fullPath, recursive, extensions));
        }
      }
    }
    
    return files;
  }

  /**
   * Check if file should be ignored
   */
  private shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
    for (const pattern of ignorePatterns) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(filePath)) return true;
    }
    return false;
  }

  /**
   * Convert severity to number for sorting
   */
  private severityToNumber(severity: IssueSeverity): number {
    switch (severity) {
      case 'critical': return 5;
      case 'high': return 4;
      case 'medium': return 3;
      case 'low': return 2;
      case 'info': return 1;
      default: return 0;
    }
  }

  getStatus(): { initialized: boolean } {
    return { initialized: this.initialized };
  }
}

// Singleton instance
let codeReviewer: CodeReviewer | null = null;

export function getCodeReviewer(): CodeReviewer {
  if (!codeReviewer) {
    codeReviewer = new CodeReviewer();
  }
  return codeReviewer;
}

export { CodeReviewer };
