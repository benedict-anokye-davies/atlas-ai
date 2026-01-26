/**
 * Atlas Desktop - Security Scanner
 * Automated vulnerability scanning for security hardening
 *
 * Features:
 * - XSS vulnerability detection
 * - Injection attack detection (SQL, command, LDAP)
 * - Path traversal vulnerability scanning
 * - Secret exposure detection in code/config
 * - Input sanitization validation
 * - IPC channel security analysis
 * - Comprehensive security report generation
 *
 * @module security/scanner
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';
import {
  PROMPT_INJECTION_PATTERNS,
  CRITICAL_BLOCKED_PATTERNS,
  BLOCKED_PATH_PATTERNS,
} from '../../shared/types/security';

const logger = createModuleLogger('SecurityScanner');

// =============================================================================
// Types
// =============================================================================

/**
 * Vulnerability severity levels
 */
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Vulnerability category types
 */
export type VulnerabilityCategory =
  | 'xss'
  | 'injection'
  | 'path_traversal'
  | 'secret_exposure'
  | 'insecure_config'
  | 'unsafe_input'
  | 'ipc_security'
  | 'dependency'
  | 'crypto'
  | 'authentication';

/**
 * Individual vulnerability finding
 */
export interface Vulnerability {
  /** Unique identifier for this vulnerability */
  id: string;
  /** Category of vulnerability */
  category: VulnerabilityCategory;
  /** Severity level */
  severity: VulnerabilitySeverity;
  /** Title/name of the vulnerability */
  title: string;
  /** Detailed description */
  description: string;
  /** File path where vulnerability was found */
  filePath?: string;
  /** Line number in the file */
  lineNumber?: number;
  /** Code snippet showing the vulnerability */
  codeSnippet?: string;
  /** Matched pattern that triggered detection */
  matchedPattern?: string;
  /** Remediation advice */
  remediation: string;
  /** CWE identifier if applicable */
  cweId?: string;
  /** CVSS score estimate */
  cvssEstimate?: number;
  /** Whether this was auto-fixed */
  autoFixed?: boolean;
  /** Timestamp of detection */
  detectedAt: string;
}

/**
 * Security scan result
 */
export interface SecurityScanResult {
  /** Unique scan identifier */
  scanId: string;
  /** Timestamp when scan started */
  startedAt: string;
  /** Timestamp when scan completed */
  completedAt: string;
  /** Duration in milliseconds */
  duration: number;
  /** Total files scanned */
  filesScanned: number;
  /** All vulnerabilities found */
  vulnerabilities: Vulnerability[];
  /** Summary by severity */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  /** Summary by category */
  categorySummary: Record<VulnerabilityCategory, number>;
  /** Overall security score (0-100) */
  securityScore: number;
  /** Whether the scan passed security thresholds */
  passed: boolean;
  /** Scan configuration used */
  config: SecurityScannerConfig;
}

/**
 * Security scanner configuration
 */
export interface SecurityScannerConfig {
  /** Root directory to scan */
  rootDir: string;
  /** File patterns to include */
  includePatterns: string[];
  /** File patterns to exclude */
  excludePatterns: string[];
  /** Minimum severity to report */
  minSeverity: VulnerabilitySeverity;
  /** Maximum number of vulnerabilities to report */
  maxFindings: number;
  /** Enable secret scanning */
  scanSecrets: boolean;
  /** Enable dependency scanning */
  scanDependencies: boolean;
  /** Enable IPC security scanning */
  scanIPC: boolean;
  /** Fail threshold (max allowed vulnerabilities by severity) */
  failThreshold: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  /** Custom patterns to scan for */
  customPatterns?: Array<{
    pattern: RegExp;
    category: VulnerabilityCategory;
    severity: VulnerabilitySeverity;
    title: string;
    description: string;
    remediation: string;
  }>;
}

/**
 * Default scanner configuration
 */
const DEFAULT_CONFIG: SecurityScannerConfig = {
  rootDir: process.cwd(),
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.json'],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/coverage/**',
    '**/.git/**',
  ],
  minSeverity: 'low',
  maxFindings: 1000,
  scanSecrets: true,
  scanDependencies: true,
  scanIPC: true,
  failThreshold: {
    critical: 0,
    high: 0,
    medium: 5,
    low: 20,
  },
};

// =============================================================================
// Vulnerability Patterns
// =============================================================================

/**
 * XSS vulnerability patterns
 */
const XSS_PATTERNS = [
  {
    pattern: /dangerouslySetInnerHTML\s*=\s*\{/gi,
    title: 'Dangerous HTML injection',
    description: 'Using dangerouslySetInnerHTML can lead to XSS vulnerabilities if the content is not properly sanitized',
    remediation: 'Sanitize HTML content using DOMPurify or similar library before using dangerouslySetInnerHTML',
    cweId: 'CWE-79',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /innerHTML\s*=\s*[^"']/gi,
    title: 'Direct innerHTML assignment',
    description: 'Direct assignment to innerHTML can lead to XSS if user-controlled data is used',
    remediation: 'Use textContent for text or sanitize HTML content before assignment',
    cweId: 'CWE-79',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /document\.write\s*\(/gi,
    title: 'Document.write usage',
    description: 'document.write can be exploited for XSS attacks',
    remediation: 'Use DOM manipulation methods instead of document.write',
    cweId: 'CWE-79',
    severity: 'medium' as VulnerabilitySeverity,
  },
  {
    pattern: /eval\s*\([^)]*\+/gi,
    title: 'Dynamic eval with concatenation',
    description: 'Using eval with dynamic content can lead to code injection',
    remediation: 'Avoid eval entirely; use safe alternatives like JSON.parse for data',
    cweId: 'CWE-94',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /new\s+Function\s*\([^)]*\+/gi,
    title: 'Dynamic Function constructor',
    description: 'Creating functions with dynamic content can lead to code injection',
    remediation: 'Avoid using Function constructor with user input',
    cweId: 'CWE-94',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /\$\{[^}]*\}\s*`\s*\)/gi,
    title: 'Unsafe template literal in sensitive context',
    description: 'Template literals with user input in sensitive contexts may lead to injection',
    remediation: 'Validate and sanitize all user input before using in template literals',
    cweId: 'CWE-79',
    severity: 'medium' as VulnerabilitySeverity,
  },
];

/**
 * SQL injection patterns
 */
const SQL_INJECTION_PATTERNS = [
  {
    pattern: /`SELECT\s+.*\$\{/gi,
    title: 'SQL injection via template literal',
    description: 'Building SQL queries with template literals can lead to SQL injection',
    remediation: 'Use parameterized queries or prepared statements',
    cweId: 'CWE-89',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /['"]SELECT\s+.*['"].*\+/gi,
    title: 'SQL injection via string concatenation',
    description: 'Concatenating user input into SQL queries enables SQL injection',
    remediation: 'Use parameterized queries with placeholders',
    cweId: 'CWE-89',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /query\s*\(\s*['"`].*\$\{/gi,
    title: 'Dynamic SQL query construction',
    description: 'Dynamic query construction with user input can lead to SQL injection',
    remediation: 'Use ORM methods or parameterized queries',
    cweId: 'CWE-89',
    severity: 'high' as VulnerabilitySeverity,
  },
];

/**
 * Command injection patterns
 */
const COMMAND_INJECTION_PATTERNS = [
  {
    pattern: /exec\s*\(\s*['"`].*\$\{/gi,
    title: 'Command injection via exec',
    description: 'Using exec with user-controlled input can lead to command injection',
    remediation: 'Use execFile with an array of arguments instead of exec with shell',
    cweId: 'CWE-78',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /execSync\s*\(\s*['"`].*\$\{/gi,
    title: 'Synchronous command injection',
    description: 'Using execSync with user-controlled input can lead to command injection',
    remediation: 'Use execFileSync with an array of arguments',
    cweId: 'CWE-78',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /spawn\s*\(\s*['"`][^'"]+['"`]\s*,\s*\[\s*.*\$\{/gi,
    title: 'Command injection via spawn',
    description: 'Spawning processes with user-controlled arguments can be dangerous',
    remediation: 'Validate and sanitize all arguments before passing to spawn',
    cweId: 'CWE-78',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /shell:\s*true/gi,
    title: 'Shell mode enabled in spawn/exec',
    description: 'Enabling shell mode increases risk of command injection',
    remediation: 'Avoid shell: true and use execFile or spawn with array arguments',
    cweId: 'CWE-78',
    severity: 'medium' as VulnerabilitySeverity,
  },
];

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = [
  {
    pattern: /path\.join\s*\([^)]*\+[^)]*\)/gi,
    title: 'Potential path traversal via path.join',
    description: 'Using path.join with unvalidated user input may allow path traversal',
    remediation: 'Validate that the resolved path is within the expected directory',
    cweId: 'CWE-22',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /readFile(Sync)?\s*\(\s*[^'")\s]/gi,
    title: 'Dynamic file read',
    description: 'Reading files with dynamic paths may allow unauthorized file access',
    remediation: 'Validate file paths against allowed directories',
    cweId: 'CWE-22',
    severity: 'medium' as VulnerabilitySeverity,
  },
  {
    pattern: /writeFile(Sync)?\s*\(\s*[^'")\s]/gi,
    title: 'Dynamic file write',
    description: 'Writing files to dynamic paths may allow arbitrary file writes',
    remediation: 'Validate file paths against allowed directories before writing',
    cweId: 'CWE-22',
    severity: 'high' as VulnerabilitySeverity,
  },
];

/**
 * Secret exposure patterns
 */
const SECRET_PATTERNS = [
  {
    pattern: /['"][A-Za-z0-9_-]{20,}['"]/g,
    title: 'Potential hardcoded secret',
    description: 'String that looks like an API key or secret',
    remediation: 'Move secrets to environment variables or a secure vault',
    cweId: 'CWE-798',
    severity: 'high' as VulnerabilitySeverity,
    contextCheck: (content: string, match: string) => {
      // Only flag if it looks like an API key context
      const apiKeyPatterns = [
        /api[_-]?key/i,
        /secret/i,
        /password/i,
        /token/i,
        /credential/i,
        /private[_-]?key/i,
      ];
      const lineContext = content.substring(
        Math.max(0, content.indexOf(match) - 50),
        content.indexOf(match) + match.length + 50
      );
      return apiKeyPatterns.some(p => p.test(lineContext));
    },
  },
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    title: 'AWS Access Key ID exposed',
    description: 'AWS Access Key ID found in source code',
    remediation: 'Remove the key and rotate credentials immediately',
    cweId: 'CWE-798',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /sk-[A-Za-z0-9]{48}/g,
    title: 'OpenAI API key exposed',
    description: 'OpenAI API key found in source code',
    remediation: 'Remove and rotate the API key immediately',
    cweId: 'CWE-798',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /ghp_[A-Za-z0-9]{36}/g,
    title: 'GitHub Personal Access Token exposed',
    description: 'GitHub PAT found in source code',
    remediation: 'Remove and rotate the token immediately',
    cweId: 'CWE-798',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
    title: 'Private key exposed',
    description: 'Private key found in source code',
    remediation: 'Remove private key and store securely',
    cweId: 'CWE-798',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /password\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    title: 'Hardcoded password',
    description: 'Password appears to be hardcoded in source',
    remediation: 'Use environment variables or secure credential storage',
    cweId: 'CWE-798',
    severity: 'high' as VulnerabilitySeverity,
  },
];

/**
 * Insecure configuration patterns
 */
const INSECURE_CONFIG_PATTERNS = [
  {
    pattern: /nodeIntegration\s*:\s*true/gi,
    title: 'Node integration enabled',
    description: 'Enabling nodeIntegration exposes the renderer to Node.js APIs',
    remediation: 'Disable nodeIntegration and use contextBridge for IPC',
    cweId: 'CWE-829',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /contextIsolation\s*:\s*false/gi,
    title: 'Context isolation disabled',
    description: 'Disabling contextIsolation allows renderer to access preload scope',
    remediation: 'Enable contextIsolation for security',
    cweId: 'CWE-829',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /webSecurity\s*:\s*false/gi,
    title: 'Web security disabled',
    description: 'Disabling webSecurity removes same-origin policy protection',
    remediation: 'Keep webSecurity enabled',
    cweId: 'CWE-346',
    severity: 'critical' as VulnerabilitySeverity,
  },
  {
    pattern: /allowRunningInsecureContent\s*:\s*true/gi,
    title: 'Insecure content allowed',
    description: 'Allowing insecure content enables mixed content attacks',
    remediation: 'Keep allowRunningInsecureContent disabled',
    cweId: 'CWE-829',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /sandbox\s*:\s*false/gi,
    title: 'Sandbox disabled',
    description: 'Disabling sandbox reduces security isolation',
    remediation: 'Enable sandbox for renderer processes',
    cweId: 'CWE-265',
    severity: 'high' as VulnerabilitySeverity,
  },
  {
    pattern: /enableRemoteModule\s*:\s*true/gi,
    title: 'Remote module enabled',
    description: 'The remote module is deprecated and insecure',
    remediation: 'Use IPC for communication between processes',
    cweId: 'CWE-829',
    severity: 'high' as VulnerabilitySeverity,
  },
];

/**
 * IPC security patterns
 */
const IPC_SECURITY_PATTERNS = [
  {
    pattern: /ipcRenderer\.send\s*\(\s*[^'"]/gi,
    title: 'Unvalidated IPC channel',
    description: 'IPC send without channel validation',
    remediation: 'Validate IPC channels against a whitelist',
    cweId: 'CWE-20',
    severity: 'medium' as VulnerabilitySeverity,
  },
  {
    pattern: /ipcMain\.handle\s*\([^)]+\)\s*=>\s*\{[^}]*(?!validate|sanitize|check)/gi,
    title: 'IPC handler without input validation',
    description: 'IPC handler may not validate input',
    remediation: 'Validate all input in IPC handlers',
    cweId: 'CWE-20',
    severity: 'medium' as VulnerabilitySeverity,
  },
  {
    pattern: /contextBridge\.exposeInMainWorld\s*\([^,]+,\s*\{[^}]*shell/gi,
    title: 'Shell access exposed to renderer',
    description: 'Shell functionality exposed to renderer process',
    remediation: 'Remove shell access from exposed APIs',
    cweId: 'CWE-78',
    severity: 'critical' as VulnerabilitySeverity,
  },
];

/**
 * Crypto security patterns
 */
const CRYPTO_PATTERNS = [
  {
    pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/gi,
    title: 'MD5 hash usage',
    description: 'MD5 is cryptographically weak and should not be used',
    remediation: 'Use SHA-256 or stronger hash algorithms',
    cweId: 'CWE-328',
    severity: 'medium' as VulnerabilitySeverity,
  },
  {
    pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/gi,
    title: 'SHA-1 hash usage',
    description: 'SHA-1 is deprecated and should not be used for security',
    remediation: 'Use SHA-256 or stronger hash algorithms',
    cweId: 'CWE-328',
    severity: 'low' as VulnerabilitySeverity,
  },
  {
    pattern: /Math\.random\s*\(\s*\)/g,
    title: 'Insecure random number generation',
    description: 'Math.random() is not cryptographically secure',
    remediation: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive operations',
    cweId: 'CWE-330',
    severity: 'medium' as VulnerabilitySeverity,
    contextCheck: (content: string, match: string) => {
      // Only flag if used in security context
      const securityContextPatterns = [/token/i, /key/i, /secret/i, /password/i, /random.*id/i];
      const lineContext = content.substring(
        Math.max(0, content.indexOf(match) - 100),
        content.indexOf(match) + match.length + 100
      );
      return securityContextPatterns.some(p => p.test(lineContext));
    },
  },
];

// =============================================================================
// Severity Ranking
// =============================================================================

const SEVERITY_RANK: Record<VulnerabilitySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

// =============================================================================
// Security Scanner Class
// =============================================================================

/**
 * Security Scanner
 * Automated vulnerability scanning for the codebase
 */
export class SecurityScanner {
  private config: SecurityScannerConfig;
  private auditLogger: AuditLogger;
  private vulnerabilities: Vulnerability[] = [];
  private filesScanned = 0;
  private scanId = '';
  private startTime = 0;

  constructor(config?: Partial<SecurityScannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditLogger = getAuditLogger();
    logger.info('SecurityScanner initialized', {
      rootDir: this.config.rootDir,
      includePatterns: this.config.includePatterns,
    });
  }

  /**
   * Run a full security scan
   */
  async scan(): Promise<SecurityScanResult> {
    this.scanId = createHash('sha256')
      .update(`scan-${Date.now()}-${Math.random()}`)
      .digest('hex')
      .substring(0, 16);
    this.startTime = Date.now();
    this.vulnerabilities = [];
    this.filesScanned = 0;

    logger.info('Starting security scan', { scanId: this.scanId });

    try {
      // Get files to scan
      const files = await this.getFilesToScan();
      logger.info(`Found ${files.length} files to scan`);

      // Scan each file
      for (const file of files) {
        await this.scanFile(file);

        // Check if we've hit the max findings limit
        if (this.vulnerabilities.length >= this.config.maxFindings) {
          logger.warn('Max findings limit reached, stopping scan');
          break;
        }
      }

      // Run IPC security analysis if enabled
      if (this.config.scanIPC) {
        await this.scanIPCSecurity();
      }

      // Generate result
      const result = this.generateResult();

      // Log scan completion
      this.auditLogger.log('authorization', 'info', `Security scan completed: ${this.scanId}`, {
        action: 'security_scan',
        allowed: true,
        source: 'security_scanner',
        context: {
          filesScanned: this.filesScanned,
          vulnerabilities: result.summary.total,
          score: result.securityScore,
          passed: result.passed,
        },
      });

      logger.info('Security scan completed', {
        scanId: this.scanId,
        filesScanned: this.filesScanned,
        vulnerabilities: result.summary.total,
        score: result.securityScore,
        passed: result.passed,
      });

      return result;
    } catch (error) {
      logger.error('Security scan failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get list of files to scan based on config
   */
  private async getFilesToScan(): Promise<string[]> {
    const files: string[] = [];

    for (const pattern of this.config.includePatterns) {
      const matches = await glob(pattern, {
        cwd: this.config.rootDir,
        ignore: this.config.excludePatterns,
        absolute: true,
        nodir: true,
      });
      files.push(...matches);
    }

    // Deduplicate
    return Array.from(new Set(files));
  }

  /**
   * Scan a single file for vulnerabilities
   */
  private async scanFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.filesScanned++;

      const relativePath = path.relative(this.config.rootDir, filePath);

      // XSS patterns
      this.scanPatterns(content, XSS_PATTERNS, 'xss', relativePath);

      // SQL injection patterns
      this.scanPatterns(content, SQL_INJECTION_PATTERNS, 'injection', relativePath);

      // Command injection patterns
      this.scanPatterns(content, COMMAND_INJECTION_PATTERNS, 'injection', relativePath);

      // Path traversal patterns
      this.scanPatterns(content, PATH_TRAVERSAL_PATTERNS, 'path_traversal', relativePath);

      // Secret patterns (if enabled)
      if (this.config.scanSecrets) {
        this.scanSecrets(content, relativePath);
      }

      // Insecure config patterns
      this.scanPatterns(content, INSECURE_CONFIG_PATTERNS, 'insecure_config', relativePath);

      // IPC security patterns (if enabled)
      if (this.config.scanIPC) {
        this.scanPatterns(content, IPC_SECURITY_PATTERNS, 'ipc_security', relativePath);
      }

      // Crypto patterns
      this.scanPatterns(content, CRYPTO_PATTERNS, 'crypto', relativePath);

      // Custom patterns
      if (this.config.customPatterns) {
        for (const customPattern of this.config.customPatterns) {
          this.scanSinglePattern(
            content,
            customPattern.pattern,
            customPattern.category,
            relativePath,
            customPattern
          );
        }
      }
    } catch (error) {
      logger.debug(`Failed to scan file: ${filePath}`, { error: (error as Error).message });
    }
  }

  /**
   * Scan content for a set of patterns
   */
  private scanPatterns(
    content: string,
    patterns: Array<{
      pattern: RegExp;
      title: string;
      description: string;
      remediation: string;
      cweId?: string;
      severity: VulnerabilitySeverity;
      contextCheck?: (content: string, match: string) => boolean;
    }>,
    category: VulnerabilityCategory,
    filePath: string
  ): void {
    for (const patternDef of patterns) {
      this.scanSinglePattern(content, patternDef.pattern, category, filePath, patternDef);
    }
  }

  /**
   * Scan content for a single pattern
   */
  private scanSinglePattern(
    content: string,
    pattern: RegExp,
    category: VulnerabilityCategory,
    filePath: string,
    meta: {
      title: string;
      description: string;
      remediation: string;
      cweId?: string;
      severity: VulnerabilitySeverity;
      contextCheck?: (content: string, match: string) => boolean;
    }
  ): void {
    // Skip if below minimum severity
    if (SEVERITY_RANK[meta.severity] < SEVERITY_RANK[this.config.minSeverity]) {
      return;
    }

    // Create a new RegExp to avoid stateful issues
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Run context check if provided
      if (meta.contextCheck && !meta.contextCheck(content, match[0])) {
        continue;
      }

      const lineNumber = this.getLineNumber(content, match.index);
      const codeSnippet = this.getCodeSnippet(content, match.index);

      this.addVulnerability({
        category,
        severity: meta.severity,
        title: meta.title,
        description: meta.description,
        filePath,
        lineNumber,
        codeSnippet,
        matchedPattern: pattern.source,
        remediation: meta.remediation,
        cweId: meta.cweId,
      });
    }
  }

  /**
   * Scan for exposed secrets
   */
  private scanSecrets(content: string, filePath: string): void {
    for (const secretPattern of SECRET_PATTERNS) {
      this.scanSinglePattern(content, secretPattern.pattern, 'secret_exposure', filePath, secretPattern);
    }
  }

  /**
   * Scan IPC channel security
   */
  private async scanIPCSecurity(): Promise<void> {
    try {
      // Check preload script for exposed channels
      const preloadPath = path.join(this.config.rootDir, 'src', 'main', 'preload.ts');
      const handlersPath = path.join(this.config.rootDir, 'src', 'main', 'ipc', 'handlers.ts');

      // Check if preload has proper channel validation
      try {
        const preloadContent = await fs.readFile(preloadPath, 'utf-8');

        // Check for validChannels array
        if (!preloadContent.includes('validChannels')) {
          this.addVulnerability({
            category: 'ipc_security',
            severity: 'high',
            title: 'Missing IPC channel validation',
            description: 'Preload script does not appear to validate IPC channels',
            filePath: path.relative(this.config.rootDir, preloadPath),
            remediation: 'Implement channel whitelist validation in preload script',
          });
        }

        // Check for contextBridge usage
        if (!preloadContent.includes('contextBridge.exposeInMainWorld')) {
          this.addVulnerability({
            category: 'ipc_security',
            severity: 'critical',
            title: 'No contextBridge usage',
            description: 'Preload script does not use contextBridge for safe API exposure',
            filePath: path.relative(this.config.rootDir, preloadPath),
            remediation: 'Use contextBridge.exposeInMainWorld to expose APIs safely',
          });
        }
      } catch {
        // Preload file not found, which is a problem
        this.addVulnerability({
          category: 'ipc_security',
          severity: 'high',
          title: 'Missing preload script',
          description: 'No preload script found for secure IPC communication',
          remediation: 'Create a preload script to safely expose APIs to renderer',
        });
      }

      // Check handlers for input validation
      try {
        const handlersContent = await fs.readFile(handlersPath, 'utf-8');

        // Check for validation functions
        const hasValidation = handlersContent.includes('validateTextInput') ||
          handlersContent.includes('validateConfigObject') ||
          handlersContent.includes('checkRateLimit');

        if (!hasValidation) {
          this.addVulnerability({
            category: 'ipc_security',
            severity: 'high',
            title: 'Missing IPC input validation',
            description: 'IPC handlers do not appear to validate input',
            filePath: path.relative(this.config.rootDir, handlersPath),
            remediation: 'Add input validation for all IPC handlers',
          });
        }
      } catch {
        // Handlers file not found
        logger.debug('IPC handlers file not found');
      }
    } catch (error) {
      logger.error('Failed to scan IPC security', { error: (error as Error).message });
    }
  }

  /**
   * Add a vulnerability to the results
   */
  private addVulnerability(vuln: Omit<Vulnerability, 'id' | 'detectedAt'>): void {
    const id = createHash('sha256')
      .update(
        `${vuln.category}-${vuln.title}-${vuln.filePath || ''}-${vuln.lineNumber || 0}`
      )
      .digest('hex')
      .substring(0, 12);

    this.vulnerabilities.push({
      ...vuln,
      id,
      detectedAt: new Date().toISOString(),
    });
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    const lines = content.substring(0, index).split('\n');
    return lines.length;
  }

  /**
   * Get code snippet around a match
   */
  private getCodeSnippet(content: string, index: number, contextLines = 2): string {
    const lines = content.split('\n');
    const lineNumber = this.getLineNumber(content, index);
    const startLine = Math.max(0, lineNumber - contextLines - 1);
    const endLine = Math.min(lines.length, lineNumber + contextLines);

    return lines
      .slice(startLine, endLine)
      .map((line, i) => `${startLine + i + 1}: ${line}`)
      .join('\n');
  }

  /**
   * Generate scan result
   */
  private generateResult(): SecurityScanResult {
    const completedAt = new Date().toISOString();
    const duration = Date.now() - this.startTime;

    // Calculate summary by severity
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      total: this.vulnerabilities.length,
    };

    for (const vuln of this.vulnerabilities) {
      summary[vuln.severity]++;
    }

    // Calculate summary by category
    const categorySummary: Record<VulnerabilityCategory, number> = {
      xss: 0,
      injection: 0,
      path_traversal: 0,
      secret_exposure: 0,
      insecure_config: 0,
      unsafe_input: 0,
      ipc_security: 0,
      dependency: 0,
      crypto: 0,
      authentication: 0,
    };

    for (const vuln of this.vulnerabilities) {
      categorySummary[vuln.category]++;
    }

    // Calculate security score (0-100)
    const securityScore = this.calculateSecurityScore(summary);

    // Check if scan passed thresholds
    const passed =
      summary.critical <= this.config.failThreshold.critical &&
      summary.high <= this.config.failThreshold.high &&
      summary.medium <= this.config.failThreshold.medium &&
      summary.low <= this.config.failThreshold.low;

    return {
      scanId: this.scanId,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt,
      duration,
      filesScanned: this.filesScanned,
      vulnerabilities: this.vulnerabilities,
      summary,
      categorySummary,
      securityScore,
      passed,
      config: this.config,
    };
  }

  /**
   * Calculate security score based on findings
   */
  private calculateSecurityScore(summary: SecurityScanResult['summary']): number {
    // Weighted deductions
    const deductions =
      summary.critical * 25 +
      summary.high * 15 +
      summary.medium * 5 +
      summary.low * 2 +
      summary.info * 0.5;

    // Start from 100 and deduct
    const score = Math.max(0, 100 - deductions);
    return Math.round(score);
  }

  /**
   * Validate user input against known attack patterns
   */
  validateInput(input: string): {
    safe: boolean;
    threats: Array<{
      type: string;
      pattern: string;
      severity: VulnerabilitySeverity;
    }>;
  } {
    const threats: Array<{
      type: string;
      pattern: string;
      severity: VulnerabilitySeverity;
    }> = [];

    // Check prompt injection patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        threats.push({
          type: 'prompt_injection',
          pattern: pattern.source,
          severity: 'critical',
        });
      }
    }

    // Check critical blocked patterns
    for (const pattern of CRITICAL_BLOCKED_PATTERNS) {
      if (pattern.test(input)) {
        threats.push({
          type: 'command_injection',
          pattern: pattern.source,
          severity: 'critical',
        });
      }
    }

    // Check path traversal patterns
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(input)) {
        threats.push({
          type: 'path_traversal',
          pattern: pattern.source,
          severity: 'high',
        });
      }
    }

    // Check XSS patterns
    const xssPatterns = [
      /<script\b[^>]*>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe\b[^>]*>/gi,
      /<object\b[^>]*>/gi,
      /<embed\b[^>]*>/gi,
    ];

    for (const pattern of xssPatterns) {
      if (pattern.test(input)) {
        threats.push({
          type: 'xss',
          pattern: pattern.source,
          severity: 'high',
        });
      }
    }

    return {
      safe: threats.length === 0,
      threats,
    };
  }

  /**
   * Check IPC channel against whitelist
   */
  checkIPCChannel(channel: string, whitelist: string[]): {
    allowed: boolean;
    reason: string;
  } {
    // Normalize channel name
    const normalizedChannel = channel.toLowerCase().trim();

    // Check whitelist
    const isAllowed = whitelist.some(
      (allowed) => allowed.toLowerCase() === normalizedChannel
    );

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Channel "${channel}" is not in the whitelist`,
      };
    }

    // Additional security checks
    if (normalizedChannel.includes('..') || normalizedChannel.includes('/')) {
      return {
        allowed: false,
        reason: 'Channel name contains suspicious characters',
      };
    }

    return {
      allowed: true,
      reason: 'Channel is in whitelist',
    };
  }

  /**
   * Generate a security report
   */
  async generateReport(
    result: SecurityScanResult,
    format: 'json' | 'markdown' | 'html' = 'json'
  ): Promise<string> {
    switch (format) {
      case 'json':
        return JSON.stringify(result, null, 2);

      case 'markdown':
        return this.generateMarkdownReport(result);

      case 'html':
        return this.generateHTMLReport(result);

      default:
        return JSON.stringify(result, null, 2);
    }
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(result: SecurityScanResult): string {
    const lines: string[] = [];

    lines.push('# Security Scan Report');
    lines.push('');
    lines.push(`**Scan ID:** ${result.scanId}`);
    lines.push(`**Date:** ${result.startedAt}`);
    lines.push(`**Duration:** ${result.duration}ms`);
    lines.push(`**Files Scanned:** ${result.filesScanned}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Security Score:** ${result.securityScore}/100`);
    lines.push(`- **Status:** ${result.passed ? 'PASSED' : 'FAILED'}`);
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| Critical | ${result.summary.critical} |`);
    lines.push(`| High | ${result.summary.high} |`);
    lines.push(`| Medium | ${result.summary.medium} |`);
    lines.push(`| Low | ${result.summary.low} |`);
    lines.push(`| Info | ${result.summary.info} |`);
    lines.push(`| **Total** | **${result.summary.total}** |`);
    lines.push('');

    // Vulnerabilities
    if (result.vulnerabilities.length > 0) {
      lines.push('## Vulnerabilities');
      lines.push('');

      // Group by severity
      const bySeverity = {
        critical: result.vulnerabilities.filter((v) => v.severity === 'critical'),
        high: result.vulnerabilities.filter((v) => v.severity === 'high'),
        medium: result.vulnerabilities.filter((v) => v.severity === 'medium'),
        low: result.vulnerabilities.filter((v) => v.severity === 'low'),
        info: result.vulnerabilities.filter((v) => v.severity === 'info'),
      };

      for (const [severity, vulns] of Object.entries(bySeverity)) {
        if (vulns.length > 0) {
          lines.push(`### ${severity.toUpperCase()} (${vulns.length})`);
          lines.push('');

          for (const vuln of vulns) {
            lines.push(`#### ${vuln.title}`);
            lines.push('');
            lines.push(`- **Category:** ${vuln.category}`);
            if (vuln.cweId) {
              lines.push(`- **CWE:** ${vuln.cweId}`);
            }
            if (vuln.filePath) {
              lines.push(`- **File:** ${vuln.filePath}:${vuln.lineNumber || ''}`);
            }
            lines.push(`- **Description:** ${vuln.description}`);
            lines.push(`- **Remediation:** ${vuln.remediation}`);
            if (vuln.codeSnippet) {
              lines.push('');
              lines.push('```');
              lines.push(vuln.codeSnippet);
              lines.push('```');
            }
            lines.push('');
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate HTML report
   */
  private generateHTMLReport(result: SecurityScanResult): string {
    const severityColors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#17a2b8',
      info: '#6c757d',
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Security Scan Report - ${result.scanId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
    h1 { color: #333; }
    .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .score { font-size: 48px; font-weight: bold; color: ${result.securityScore >= 80 ? '#28a745' : result.securityScore >= 60 ? '#ffc107' : '#dc3545'}; }
    .status { padding: 5px 15px; border-radius: 4px; color: white; background: ${result.passed ? '#28a745' : '#dc3545'}; }
    .vuln { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .vuln.critical { border-left: 4px solid ${severityColors.critical}; }
    .vuln.high { border-left: 4px solid ${severityColors.high}; }
    .vuln.medium { border-left: 4px solid ${severityColors.medium}; }
    .vuln.low { border-left: 4px solid ${severityColors.low}; }
    .vuln.info { border-left: 4px solid ${severityColors.info}; }
    .severity-badge { padding: 2px 8px; border-radius: 4px; color: white; font-size: 12px; }
    code { background: #f4f4f4; padding: 10px; display: block; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f8f9fa; }
  </style>
</head>
<body>
  <h1>Security Scan Report</h1>

  <div class="summary">
    <p><strong>Scan ID:</strong> ${result.scanId}</p>
    <p><strong>Date:</strong> ${result.startedAt}</p>
    <p><strong>Duration:</strong> ${result.duration}ms</p>
    <p><strong>Files Scanned:</strong> ${result.filesScanned}</p>
    <p class="score">${result.securityScore}/100</p>
    <span class="status">${result.passed ? 'PASSED' : 'FAILED'}</span>
  </div>

  <h2>Summary</h2>
  <table>
    <tr><th>Severity</th><th>Count</th></tr>
    <tr><td style="color: ${severityColors.critical}">Critical</td><td>${result.summary.critical}</td></tr>
    <tr><td style="color: ${severityColors.high}">High</td><td>${result.summary.high}</td></tr>
    <tr><td style="color: ${severityColors.medium}">Medium</td><td>${result.summary.medium}</td></tr>
    <tr><td style="color: ${severityColors.low}">Low</td><td>${result.summary.low}</td></tr>
    <tr><td style="color: ${severityColors.info}">Info</td><td>${result.summary.info}</td></tr>
    <tr><th>Total</th><th>${result.summary.total}</th></tr>
  </table>

  <h2>Vulnerabilities</h2>
  ${result.vulnerabilities
    .map(
      (v) => `
    <div class="vuln ${v.severity}">
      <h3>${v.title} <span class="severity-badge" style="background: ${severityColors[v.severity]}">${v.severity.toUpperCase()}</span></h3>
      <p><strong>Category:</strong> ${v.category} ${v.cweId ? `| <strong>CWE:</strong> ${v.cweId}` : ''}</p>
      ${v.filePath ? `<p><strong>Location:</strong> ${v.filePath}:${v.lineNumber || ''}</p>` : ''}
      <p><strong>Description:</strong> ${v.description}</p>
      <p><strong>Remediation:</strong> ${v.remediation}</p>
      ${v.codeSnippet ? `<code>${v.codeSnippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>` : ''}
    </div>
  `
    )
    .join('')}
</body>
</html>
    `;
  }

  /**
   * Update scanner configuration
   */
  updateConfig(config: Partial<SecurityScannerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('SecurityScanner config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): SecurityScannerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let scannerInstance: SecurityScanner | null = null;

/**
 * Get or create the singleton SecurityScanner instance
 */
export function getSecurityScanner(config?: Partial<SecurityScannerConfig>): SecurityScanner {
  if (!scannerInstance) {
    scannerInstance = new SecurityScanner(config);
  }
  return scannerInstance;
}

/**
 * Run a quick security scan with default settings
 */
export async function runSecurityScan(
  config?: Partial<SecurityScannerConfig>
): Promise<SecurityScanResult> {
  const scanner = getSecurityScanner(config);
  return scanner.scan();
}

/**
 * Validate input for security threats
 */
export function validateSecurityInput(input: string): ReturnType<SecurityScanner['validateInput']> {
  const scanner = getSecurityScanner();
  return scanner.validateInput(input);
}

/**
 * Shutdown the security scanner
 */
export function shutdownSecurityScanner(): void {
  scannerInstance = null;
}

export default SecurityScanner;
