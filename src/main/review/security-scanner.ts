/**
 * Security Scanner
 * Scans code for security vulnerabilities and secrets
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import {
  SecurityScanResult,
  SecurityVulnerability,
  DetectedSecret,
  DependencyIssue,
  ComplianceResult,
  ComplianceCheck,
  SecretType,
  IssueSeverity,
  ScanOptions
} from './types';

const logger = createModuleLogger('SecurityScanner');

// Secret detection patterns
const SECRET_PATTERNS: Array<{
  type: SecretType;
  pattern: RegExp;
  confidence: number;
}> = [
  // AWS
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: 0.95
  },
  {
    type: 'aws_key',
    pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
    confidence: 0.9
  },
  // API Keys
  {
    type: 'api_key',
    pattern: /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/gi,
    confidence: 0.8
  },
  {
    type: 'api_key',
    pattern: /sk-[A-Za-z0-9]{48}/g, // OpenAI style
    confidence: 0.95
  },
  {
    type: 'api_key',
    pattern: /sk_live_[A-Za-z0-9]{24,}/g, // Stripe style
    confidence: 0.95
  },
  // Tokens
  {
    type: 'token',
    pattern: /bearer\s+[A-Za-z0-9_-]{20,}/gi,
    confidence: 0.85
  },
  {
    type: 'token',
    pattern: /ghp_[A-Za-z0-9]{36}/g, // GitHub PAT
    confidence: 0.95
  },
  {
    type: 'token',
    pattern: /gho_[A-Za-z0-9]{36}/g, // GitHub OAuth
    confidence: 0.95
  },
  // JWT
  {
    type: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    confidence: 0.9
  },
  // Passwords
  {
    type: 'password',
    pattern: /password\s*[:=]\s*["'][^"']{8,}["']/gi,
    confidence: 0.7
  },
  {
    type: 'password',
    pattern: /passwd\s*[:=]\s*["'][^"']{8,}["']/gi,
    confidence: 0.7
  },
  // Private Keys
  {
    type: 'private_key',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    confidence: 0.99
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/g,
    confidence: 0.99
  },
  // Connection Strings
  {
    type: 'connection_string',
    pattern: /mongodb(?:\+srv)?:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    confidence: 0.9
  },
  {
    type: 'connection_string',
    pattern: /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    confidence: 0.9
  },
  {
    type: 'connection_string',
    pattern: /mysql:\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi,
    confidence: 0.9
  },
  // OAuth
  {
    type: 'oauth',
    pattern: /client[_-]?secret\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/gi,
    confidence: 0.85
  }
];

// Vulnerability patterns
const VULNERABILITY_PATTERNS: Array<{
  pattern: RegExp;
  cwe: string;
  title: string;
  severity: IssueSeverity;
  remediation: string;
}> = [
  {
    pattern: /eval\s*\(\s*(?:req|request|input|user|data)\./gi,
    cwe: 'CWE-95',
    title: 'Code Injection via eval()',
    severity: 'critical',
    remediation: 'Never use eval() with user input. Use safer alternatives like JSON.parse()'
  },
  {
    pattern: /exec\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*(?:req|request|input|user|data)\.)/gi,
    cwe: 'CWE-78',
    title: 'Command Injection',
    severity: 'critical',
    remediation: 'Use parameterized commands or input validation. Never concatenate user input into commands'
  },
  {
    pattern: /innerHTML\s*=\s*(?:req|request|input|user|data)\./gi,
    cwe: 'CWE-79',
    title: 'Cross-Site Scripting (XSS)',
    severity: 'high',
    remediation: 'Use textContent instead of innerHTML, or sanitize HTML with DOMPurify'
  },
  {
    pattern: /\.query\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*(?:req|request|input|user|data)\.)/gi,
    cwe: 'CWE-89',
    title: 'SQL Injection',
    severity: 'critical',
    remediation: 'Use parameterized queries or prepared statements. Never concatenate user input into SQL'
  },
  {
    pattern: /fs\.(?:readFile|writeFile|unlink|readdir)\s*\(\s*(?:req|request|input|user|data)\./gi,
    cwe: 'CWE-22',
    title: 'Path Traversal',
    severity: 'high',
    remediation: 'Validate and sanitize file paths. Use path.resolve() and check against base directory'
  },
  {
    pattern: /redirect\s*\(\s*(?:req|request|input|user|data)\./gi,
    cwe: 'CWE-601',
    title: 'Open Redirect',
    severity: 'medium',
    remediation: 'Validate redirect URLs against a whitelist of allowed destinations'
  },
  {
    pattern: /crypto\.createCipher\(/g,
    cwe: 'CWE-327',
    title: 'Use of Weak Cryptographic Algorithm',
    severity: 'high',
    remediation: 'Use crypto.createCipheriv() with a secure algorithm like AES-256-GCM'
  },
  {
    pattern: /Math\.random\s*\(\s*\)/g,
    cwe: 'CWE-338',
    title: 'Weak Random Number Generation',
    severity: 'medium',
    remediation: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive operations'
  },
  {
    pattern: /cors\s*\(\s*\{\s*origin\s*:\s*["']\*["']/gi,
    cwe: 'CWE-942',
    title: 'Overly Permissive CORS Policy',
    severity: 'medium',
    remediation: 'Restrict CORS to specific trusted origins instead of wildcard'
  },
  {
    pattern: /rejectUnauthorized\s*:\s*false/gi,
    cwe: 'CWE-295',
    title: 'TLS Certificate Validation Disabled',
    severity: 'high',
    remediation: 'Enable certificate validation. Never disable in production'
  },
  {
    pattern: /new\s+RegExp\s*\(\s*(?:req|request|input|user|data)\./gi,
    cwe: 'CWE-1333',
    title: 'Regular Expression Denial of Service (ReDoS)',
    severity: 'medium',
    remediation: 'Validate regex patterns from user input. Use timeout mechanisms'
  },
  {
    pattern: /deserialize|unserialize|unpickle/gi,
    cwe: 'CWE-502',
    title: 'Deserialization of Untrusted Data',
    severity: 'high',
    remediation: 'Avoid deserializing untrusted data. Use safe alternatives like JSON.parse()'
  }
];

// OWASP Top 10 mapping
const OWASP_CHECKS: Array<{
  id: string;
  name: string;
  cwes: string[];
}> = [
  { id: 'A01', name: 'Broken Access Control', cwes: ['CWE-22', 'CWE-601'] },
  { id: 'A02', name: 'Cryptographic Failures', cwes: ['CWE-327', 'CWE-338'] },
  { id: 'A03', name: 'Injection', cwes: ['CWE-78', 'CWE-89', 'CWE-95'] },
  { id: 'A04', name: 'Insecure Design', cwes: [] },
  { id: 'A05', name: 'Security Misconfiguration', cwes: ['CWE-942', 'CWE-295'] },
  { id: 'A06', name: 'Vulnerable Components', cwes: [] },
  { id: 'A07', name: 'Auth Failures', cwes: [] },
  { id: 'A08', name: 'Data Integrity Failures', cwes: ['CWE-502'] },
  { id: 'A09', name: 'Logging Failures', cwes: [] },
  { id: 'A10', name: 'SSRF', cwes: [] }
];

class SecurityScanner extends EventEmitter {
  private initialized: boolean = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info('Initializing security scanner');
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Scan a file for security issues
   */
  async scanFile(
    filePath: string,
    options: ScanOptions = {}
  ): Promise<SecurityScanResult> {
    const startTime = Date.now();
    
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const vulnerabilities = options.scanVulnerabilities !== false 
        ? this.findVulnerabilities(content, lines, filePath)
        : [];

      const secrets = options.scanSecrets !== false
        ? this.findSecrets(content, lines, filePath)
        : [];

      const compliance = this.checkCompliance(vulnerabilities);

      const result: SecurityScanResult = {
        vulnerabilities,
        secrets,
        dependencies: [],
        compliance,
        scanTime: Date.now() - startTime,
        scannedFiles: 1
      };

      logger.info(`Security scan completed for ${path.basename(filePath)}`, {
        vulnerabilities: vulnerabilities.length,
        secrets: secrets.length,
        time: result.scanTime
      });

      this.emit('scan-complete', result);
      return result;
    } catch (error) {
      logger.error('Security scan failed', error);
      throw error;
    }
  }

  /**
   * Scan a directory
   */
  async scanDirectory(
    dirPath: string,
    options: ScanOptions & { recursive?: boolean; extensions?: string[] } = {}
  ): Promise<SecurityScanResult> {
    const startTime = Date.now();
    const extensions = options.extensions || ['.ts', '.js', '.tsx', '.jsx', '.json', '.env'];
    const files = this.getFilesInDirectory(dirPath, options.recursive ?? true, extensions);
    
    const allVulnerabilities: SecurityVulnerability[] = [];
    const allSecrets: DetectedSecret[] = [];
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        if (options.scanVulnerabilities !== false) {
          allVulnerabilities.push(...this.findVulnerabilities(content, lines, file));
        }

        if (options.scanSecrets !== false) {
          allSecrets.push(...this.findSecrets(content, lines, file));
        }
      } catch (error) {
        logger.warn(`Failed to scan ${file}`, error);
      }
    }

    // Scan dependencies if package.json exists
    const dependencies: DependencyIssue[] = [];
    if (options.scanDependencies !== false) {
      const packageJsonPath = path.join(dirPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        dependencies.push(...await this.scanDependencies(packageJsonPath, options));
      }
    }

    const compliance = this.checkCompliance(allVulnerabilities);

    const result: SecurityScanResult = {
      vulnerabilities: allVulnerabilities,
      secrets: allSecrets,
      dependencies,
      compliance,
      scanTime: Date.now() - startTime,
      scannedFiles: files.length
    };

    logger.info(`Directory security scan completed`, {
      files: files.length,
      vulnerabilities: allVulnerabilities.length,
      secrets: allSecrets.length,
      dependencies: dependencies.length,
      time: result.scanTime
    });

    this.emit('scan-complete', result);
    return result;
  }

  /**
   * Find security vulnerabilities
   */
  private findVulnerabilities(
    content: string,
    lines: string[],
    filePath: string
  ): SecurityVulnerability[] {
    const vulnerabilities: SecurityVulnerability[] = [];
    let vulnId = 0;

    for (const pattern of VULNERABILITY_PATTERNS) {
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        vulnerabilities.push({
          id: `vuln-${++vulnId}`,
          cwe: pattern.cwe,
          title: pattern.title,
          description: `Found potential ${pattern.title.toLowerCase()} vulnerability`,
          severity: pattern.severity,
          file: filePath,
          line: lineNumber,
          code: lines[lineNumber - 1]?.trim(),
          remediation: pattern.remediation,
          references: [
            `https://cwe.mitre.org/data/definitions/${pattern.cwe.split('-')[1]}.html`
          ]
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * Find secrets in code
   */
  private findSecrets(
    content: string,
    lines: string[],
    filePath: string
  ): DetectedSecret[] {
    const secrets: DetectedSecret[] = [];

    // Skip common false positive paths
    if (filePath.includes('node_modules') || 
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('.example')) {
      return secrets;
    }

    for (const pattern of SECRET_PATTERNS) {
      pattern.pattern.lastIndex = 0;

      let match;
      while ((match = pattern.pattern.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;
        const value = match[0];

        // Mask the secret value
        const maskedValue = this.maskSecret(value);

        secrets.push({
          type: pattern.type,
          file: filePath,
          line: lineNumber,
          maskedValue,
          confidence: pattern.confidence
        });
      }
    }

    return secrets;
  }

  /**
   * Scan dependencies for known vulnerabilities
   */
  private async scanDependencies(
    packageJsonPath: string,
    options: ScanOptions
  ): Promise<DependencyIssue[]> {
    const issues: DependencyIssue[] = [];

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      
      const deps = {
        ...packageJson.dependencies,
        ...(options.includeDevDependencies ? packageJson.devDependencies : {})
      };

      // Known vulnerable packages (simplified - real implementation would use npm audit API)
      const knownVulnerabilities: Record<string, { 
        versions: string; 
        severity: IssueSeverity; 
        description: string;
        fixed?: string;
      }> = {
        'lodash': {
          versions: '<4.17.21',
          severity: 'high',
          description: 'Prototype pollution vulnerability',
          fixed: '4.17.21'
        },
        'axios': {
          versions: '<0.21.1',
          severity: 'high',
          description: 'Server-Side Request Forgery vulnerability',
          fixed: '0.21.1'
        },
        'minimist': {
          versions: '<1.2.6',
          severity: 'critical',
          description: 'Prototype pollution vulnerability',
          fixed: '1.2.6'
        }
      };

      for (const [pkg, version] of Object.entries(deps)) {
        if (knownVulnerabilities[pkg]) {
          const vuln = knownVulnerabilities[pkg];
          // Simplified version check
          issues.push({
            package: pkg,
            currentVersion: String(version),
            vulnerableVersions: vuln.versions,
            severity: vuln.severity,
            description: vuln.description,
            fixedVersion: vuln.fixed
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to scan dependencies', error);
    }

    return issues;
  }

  /**
   * Check compliance against standards
   */
  private checkCompliance(vulnerabilities: SecurityVulnerability[]): ComplianceResult {
    const vulnCWEs = new Set(vulnerabilities.map(v => v.cwe));
    
    const owasp: ComplianceCheck[] = OWASP_CHECKS.map(check => {
      const issues = check.cwes.filter(cwe => vulnCWEs.has(cwe));
      return {
        id: check.id,
        name: check.name,
        passed: issues.length === 0,
        issues: issues.map(cwe => `Found ${cwe} vulnerability`)
      };
    });

    return {
      owasp,
      sansTop25: [],
      custom: []
    };
  }

  /**
   * Mask a secret value for display
   */
  private maskSecret(value: string): string {
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }
    return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
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
        // Also scan .env files
        if (extensions.includes(ext) || entry.name.startsWith('.env')) {
          files.push(fullPath);
        }
      } else if (entry.isDirectory() && recursive) {
        // Skip common directories
        if (!['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__'].includes(entry.name)) {
          files.push(...this.getFilesInDirectory(fullPath, recursive, extensions));
        }
      }
    }
    
    return files;
  }

  getStatus(): { initialized: boolean } {
    return { initialized: this.initialized };
  }
}

// Singleton instance
let securityScanner: SecurityScanner | null = null;

export function getSecurityScanner(): SecurityScanner {
  if (!securityScanner) {
    securityScanner = new SecurityScanner();
  }
  return securityScanner;
}

export { SecurityScanner };
