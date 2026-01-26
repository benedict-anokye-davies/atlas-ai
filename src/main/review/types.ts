/**
 * Code Review Types
 * Types for AI-powered code review and security scanning
 */

export interface CodeReviewResult {
  file: string;
  issues: CodeIssue[];
  suggestions: CodeSuggestion[];
  metrics: CodeMetrics;
  overallScore: number;
  reviewedAt: Date;
}

export interface CodeIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  column?: number;
  code?: string;
  suggestedFix?: string;
  rule?: string;
  cwe?: string; // Common Weakness Enumeration ID
}

export type IssueType =
  | 'bug'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'complexity'
  | 'duplication'
  | 'documentation'
  | 'testing'
  | 'deprecated';

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CodeSuggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  file: string;
  line?: number;
  currentCode?: string;
  suggestedCode?: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

export type SuggestionType =
  | 'refactor'
  | 'simplify'
  | 'modernize'
  | 'optimize'
  | 'document'
  | 'test'
  | 'naming'
  | 'pattern';

export interface CodeMetrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maintainabilityIndex: number;
  duplicateLines: number;
  testCoverage?: number;
  documentationCoverage: number;
  dependencies: number;
}

export interface SecurityScanResult {
  vulnerabilities: SecurityVulnerability[];
  secrets: DetectedSecret[];
  dependencies: DependencyIssue[];
  compliance: ComplianceResult;
  scanTime: number;
  scannedFiles: number;
}

export interface SecurityVulnerability {
  id: string;
  cwe: string;
  cve?: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  file: string;
  line: number;
  code?: string;
  remediation: string;
  references: string[];
}

export interface DetectedSecret {
  type: SecretType;
  file: string;
  line: number;
  maskedValue: string;
  confidence: number;
}

export type SecretType =
  | 'api_key'
  | 'aws_key'
  | 'password'
  | 'token'
  | 'private_key'
  | 'certificate'
  | 'connection_string'
  | 'oauth'
  | 'jwt';

export interface DependencyIssue {
  package: string;
  currentVersion: string;
  vulnerableVersions: string;
  severity: IssueSeverity;
  cve?: string;
  fixedVersion?: string;
  description: string;
}

export interface ComplianceResult {
  owasp: ComplianceCheck[];
  sansTop25: ComplianceCheck[];
  custom: ComplianceCheck[];
}

export interface ComplianceCheck {
  id: string;
  name: string;
  passed: boolean;
  issues: string[];
}

export interface ReviewOptions {
  includeTests?: boolean;
  includeDocs?: boolean;
  maxIssues?: number;
  severityThreshold?: IssueSeverity;
  rules?: string[];
  ignorePatterns?: string[];
}

export interface ScanOptions {
  scanSecrets?: boolean;
  scanDependencies?: boolean;
  scanVulnerabilities?: boolean;
  includeDevDependencies?: boolean;
  maxDepth?: number;
}
