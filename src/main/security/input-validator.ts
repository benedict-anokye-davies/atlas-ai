/**
 * Nova Desktop - Input Validator
 * Security validation and sanitization for user inputs
 *
 * Features:
 * - Prompt injection detection and prevention
 * - Command injection detection
 * - Path traversal prevention
 * - Unicode and encoding attack detection
 * - Input sanitization with threat logging
 *
 * @module security/input-validator
 */

import { createModuleLogger } from '../utils/logger';
import { getAuditLogger, AuditLogger } from './audit-logger';
import {
  InputValidationResult,
  DetectedThreat,
  ThreatType,
  SecuritySeverity,
  PROMPT_INJECTION_PATTERNS,
  CRITICAL_BLOCKED_PATTERNS,
  SHELL_METACHARACTERS,
  BLOCKED_PATH_PATTERNS,
} from '../../shared/types/security';

const logger = createModuleLogger('InputValidator');

/**
 * Input validator configuration
 */
export interface InputValidatorConfig {
  /** Maximum input length */
  maxInputLength: number;
  /** Whether to block on detected threats (vs just sanitize) */
  blockOnThreat: boolean;
  /** Whether to sanitize input (remove/escape threats) */
  sanitizeInput: boolean;
  /** Whether to log all validations (including clean inputs) */
  logAllValidations: boolean;
  /** Minimum threat level to block */
  blockThreshold: 'low' | 'medium' | 'high' | 'critical';
  /** Custom patterns to detect */
  customPatterns?: Array<{
    pattern: RegExp;
    type: ThreatType;
    description: string;
    severity: SecuritySeverity;
  }>;
}

/**
 * Default input validator configuration
 */
const DEFAULT_CONFIG: InputValidatorConfig = {
  maxInputLength: 10000,
  blockOnThreat: true,
  sanitizeInput: true,
  logAllValidations: false,
  blockThreshold: 'medium',
};

/**
 * Threat severity ranking for comparison
 */
const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
  blocked: 3,
};

const THREAT_LEVEL_RANK: Record<InputValidationResult['threatLevel'], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Input Validator
 * Provides comprehensive input validation and sanitization
 */
export class InputValidator {
  private config: InputValidatorConfig;
  private auditLogger: AuditLogger;

  constructor(config?: Partial<InputValidatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditLogger = getAuditLogger();

    logger.info('InputValidator initialized', {
      blockOnThreat: this.config.blockOnThreat,
      blockThreshold: this.config.blockThreshold,
    });
  }

  /**
   * Validate and optionally sanitize input
   */
  validate(
    input: string,
    options: {
      source?: string;
      sessionId?: string;
      context?: 'voice' | 'text' | 'command' | 'file_path';
    } = {}
  ): InputValidationResult {
    const source = options.source ?? 'unknown';
    const context = options.context ?? 'text';
    const threats: DetectedThreat[] = [];

    // Check input length
    if (input.length > this.config.maxInputLength) {
      threats.push({
        type: 'encoding_attack',
        pattern: 'excessive_length',
        location: { start: this.config.maxInputLength, end: input.length },
        severity: 'warning',
        description: `Input exceeds maximum length of ${this.config.maxInputLength} characters`,
      });
    }

    // Detect prompt injection attempts
    threats.push(...this.detectPromptInjection(input));

    // Detect command injection
    if (context === 'command' || context === 'text') {
      threats.push(...this.detectCommandInjection(input));
    }

    // Detect path traversal
    if (context === 'file_path' || context === 'command') {
      threats.push(...this.detectPathTraversal(input));
    }

    // Detect Unicode/encoding attacks
    threats.push(...this.detectEncodingAttacks(input));

    // Detect shell metacharacters (if in command context)
    if (context === 'command') {
      threats.push(...this.detectShellMetacharacters(input));
    }

    // Apply custom patterns
    if (this.config.customPatterns) {
      for (const customPattern of this.config.customPatterns) {
        const matches = input.matchAll(new RegExp(customPattern.pattern, 'gi'));
        for (const match of matches) {
          threats.push({
            type: customPattern.type,
            pattern: customPattern.pattern.source,
            location: {
              start: match.index ?? 0,
              end: (match.index ?? 0) + match[0].length,
            },
            severity: customPattern.severity,
            description: customPattern.description,
          });
        }
      }
    }

    // Calculate overall threat level
    const threatLevel = this.calculateThreatLevel(threats);

    // Sanitize input if enabled
    let sanitized = input;
    if (this.config.sanitizeInput && threats.length > 0) {
      sanitized = this.sanitize(input, threats, context);
    }

    // Determine if input should be blocked
    const shouldBlock =
      this.config.blockOnThreat &&
      THREAT_LEVEL_RANK[threatLevel] >= THREAT_LEVEL_RANK[this.config.blockThreshold];

    const safe = threats.length === 0 || !shouldBlock;

    // Log validation result
    if (threats.length > 0 || this.config.logAllValidations) {
      this.auditLogger.logInputValidation(
        input,
        threats.map((t) => ({ type: t.type, pattern: t.pattern })),
        !safe,
        {
          source,
          sessionId: options.sessionId,
          sanitized: sanitized !== input ? sanitized : undefined,
        }
      );
    }

    return {
      safe,
      original: input,
      sanitized,
      threats,
      threatLevel,
    };
  }

  /**
   * Detect prompt injection attempts
   */
  private detectPromptInjection(input: string): DetectedThreat[] {
    const threats: DetectedThreat[] = [];

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      const matches = input.matchAll(new RegExp(pattern, 'gi'));

      for (const match of matches) {
        threats.push({
          type: 'prompt_injection',
          pattern: pattern.source,
          location: {
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
          },
          severity: 'critical',
          description: `Prompt injection attempt detected: "${match[0].substring(0, 50)}..."`,
        });

        // Log specifically for prompt injection
        this.auditLogger.logPromptInjection(input, 'prompt_injection', {
          pattern: pattern.source,
          source: 'input_validator',
        });
      }
    }

    return threats;
  }

  /**
   * Detect command injection attempts
   */
  private detectCommandInjection(input: string): DetectedThreat[] {
    const threats: DetectedThreat[] = [];

    for (const pattern of CRITICAL_BLOCKED_PATTERNS) {
      if (pattern.test(input)) {
        const match = input.match(pattern);
        threats.push({
          type: 'command_injection',
          pattern: pattern.source,
          location: {
            start: match?.index ?? 0,
            end: (match?.index ?? 0) + (match?.[0].length ?? 0),
          },
          severity: 'blocked',
          description: 'Dangerous command pattern detected',
        });
      }
    }

    // Additional command injection patterns
    const commandInjectionPatterns = [
      // Command chaining
      { pattern: /;\s*[a-z]/i, desc: 'Command chaining with semicolon' },
      { pattern: /\|\s*[a-z]/i, desc: 'Command piping' },
      { pattern: /&&\s*[a-z]/i, desc: 'Command chaining with &&' },
      { pattern: /\|\|\s*[a-z]/i, desc: 'Command chaining with ||' },

      // Backtick command substitution
      { pattern: /`[^`]+`/, desc: 'Backtick command substitution' },

      // $() command substitution
      { pattern: /\$\([^)]+\)/, desc: '$() command substitution' },

      // Variable expansion attacks
      { pattern: /\$\{[^}]+\}/, desc: 'Variable expansion' },
    ];

    for (const { pattern, desc } of commandInjectionPatterns) {
      const matches = input.matchAll(new RegExp(pattern, 'gi'));

      for (const match of matches) {
        threats.push({
          type: 'command_injection',
          pattern: pattern.source,
          location: {
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
          },
          severity: 'critical',
          description: desc,
        });
      }
    }

    return threats;
  }

  /**
   * Detect path traversal attempts
   */
  private detectPathTraversal(input: string): DetectedThreat[] {
    const threats: DetectedThreat[] = [];

    // Check against blocked path patterns
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(input)) {
        const match = input.match(pattern);
        threats.push({
          type: 'path_traversal',
          pattern: pattern.source,
          location: {
            start: match?.index ?? 0,
            end: (match?.index ?? 0) + (match?.[0].length ?? 0),
          },
          severity: 'critical',
          description: 'Blocked path pattern detected',
        });
      }
    }

    // Explicit path traversal patterns
    const traversalPatterns = [
      { pattern: /\.\.\//, desc: 'Unix path traversal' },
      { pattern: /\.\.\\/, desc: 'Windows path traversal' },
      { pattern: /%2e%2e[/\\]/i, desc: 'URL-encoded path traversal' },
      { pattern: /\.\.%2f/i, desc: 'Mixed encoding path traversal' },
      { pattern: /%252e%252e/i, desc: 'Double-encoded path traversal' },
    ];

    for (const { pattern, desc } of traversalPatterns) {
      const regex = new RegExp(pattern, 'gi');
      const matches = input.matchAll(regex);

      for (const match of matches) {
        threats.push({
          type: 'path_traversal',
          pattern: pattern.source,
          location: {
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
          },
          severity: 'critical',
          description: desc,
        });
      }
    }

    return threats;
  }

  /**
   * Detect Unicode and encoding attacks
   */
  private detectEncodingAttacks(input: string): DetectedThreat[] {
    const threats: DetectedThreat[] = [];

    // Control characters (except common whitespace)
    const controlCharPattern = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
    const controlMatches = input.matchAll(controlCharPattern);

    for (const match of controlMatches) {
      threats.push({
        type: 'unicode_exploit',
        pattern: 'control_character',
        location: {
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
        },
        severity: 'warning',
        description: `Control character detected: 0x${match[0].charCodeAt(0).toString(16)}`,
      });
    }

    // Unicode direction override characters (can hide malicious content)
    const unicodeOverridePattern = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;
    const unicodeMatches = input.matchAll(unicodeOverridePattern);

    for (const match of unicodeMatches) {
      threats.push({
        type: 'unicode_exploit',
        pattern: 'direction_override',
        location: {
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
        },
        severity: 'critical',
        description: 'Unicode direction override character detected (can hide malicious content)',
      });
    }

    // Zero-width characters (can hide content)
    const zeroWidthPattern = /[\u200b-\u200d\ufeff]/g;
    const zeroWidthMatches = input.matchAll(zeroWidthPattern);

    for (const match of zeroWidthMatches) {
      threats.push({
        type: 'unicode_exploit',
        pattern: 'zero_width',
        location: {
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
        },
        severity: 'warning',
        description: 'Zero-width character detected (can hide content)',
      });
    }

    // Homograph attack characters (visually similar to ASCII)
    const homographPattern = /[\u0430\u0435\u043e\u0440\u0441\u0445\u0443]/g; // Cyrillic lookalikes
    const homographMatches = input.matchAll(homographPattern);

    for (const match of homographMatches) {
      threats.push({
        type: 'unicode_exploit',
        pattern: 'homograph',
        location: {
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
        },
        severity: 'warning',
        description: 'Potential homograph attack character detected',
      });
    }

    return threats;
  }

  /**
   * Detect shell metacharacters
   */
  private detectShellMetacharacters(input: string): DetectedThreat[] {
    const threats: DetectedThreat[] = [];

    for (const char of SHELL_METACHARACTERS) {
      let index = input.indexOf(char);

      while (index !== -1) {
        threats.push({
          type: 'shell_metachar',
          pattern: char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char,
          location: {
            start: index,
            end: index + char.length,
          },
          severity: 'warning',
          description: `Shell metacharacter "${char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char}" detected`,
        });

        index = input.indexOf(char, index + 1);
      }
    }

    return threats;
  }

  /**
   * Calculate overall threat level from detected threats
   */
  private calculateThreatLevel(threats: DetectedThreat[]): InputValidationResult['threatLevel'] {
    if (threats.length === 0) {
      return 'none';
    }

    const maxSeverity = Math.max(...threats.map((t) => SEVERITY_RANK[t.severity]));

    if (maxSeverity >= SEVERITY_RANK.blocked) {
      return 'critical';
    }
    if (maxSeverity >= SEVERITY_RANK.critical) {
      return 'high';
    }
    if (maxSeverity >= SEVERITY_RANK.warning) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Sanitize input by removing or escaping threats
   */
  private sanitize(
    input: string,
    threats: DetectedThreat[],
    context: 'voice' | 'text' | 'command' | 'file_path'
  ): string {
    let sanitized = input;

    // Sort threats by location (descending) to maintain correct positions
    const sortedThreats = [...threats].sort((a, b) => b.location.start - a.location.start);

    for (const threat of sortedThreats) {
      const before = sanitized.substring(0, threat.location.start);
      const after = sanitized.substring(threat.location.end);
      const matched = sanitized.substring(threat.location.start, threat.location.end);

      switch (threat.type) {
        case 'prompt_injection':
        case 'jailbreak_attempt':
          // Remove prompt injection attempts entirely
          sanitized = before + after;
          break;

        case 'command_injection':
          // Remove command injection attempts
          sanitized = before + after;
          break;

        case 'path_traversal':
          // Replace path traversal with safe alternative
          sanitized = before + after;
          break;

        case 'unicode_exploit':
          // Remove unicode exploits
          sanitized = before + after;
          break;

        case 'shell_metachar':
          if (context === 'command') {
            // Escape shell metacharacters
            const escaped = this.escapeShellChar(matched);
            sanitized = before + escaped + after;
          }
          break;

        case 'encoding_attack':
          // Truncate if length exceeded
          if (threat.pattern === 'excessive_length') {
            sanitized = sanitized.substring(0, this.config.maxInputLength);
          }
          break;

        default:
          // Remove by default
          sanitized = before + after;
      }
    }

    return sanitized.trim();
  }

  /**
   * Escape a shell character
   */
  private escapeShellChar(char: string): string {
    const escapeMap: Record<string, string> = {
      '|': '\\|',
      '&': '\\&',
      ';': '\\;',
      $: '\\$',
      '`': '\\`',
      '(': '\\(',
      ')': '\\)',
      '{': '\\{',
      '}': '\\}',
      '<': '\\<',
      '>': '\\>',
      '!': '\\!',
      '\\': '\\\\',
      '"': '\\"',
      "'": "\\'",
      '*': '\\*',
      '?': '\\?',
      '[': '\\[',
      ']': '\\]',
      '#': '\\#',
      '~': '\\~',
      '\n': ' ',
      '\r': ' ',
      '\t': ' ',
    };

    return escapeMap[char] ?? char;
  }

  /**
   * Quick check if input contains any threats (without full validation)
   */
  quickCheck(input: string): boolean {
    // Check for prompt injection
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return false;
      }
    }

    // Check for critical blocked patterns
    for (const pattern of CRITICAL_BLOCKED_PATTERNS) {
      if (pattern.test(input)) {
        return false;
      }
    }

    // Check for path traversal
    if (/\.\.[\\/]/.test(input)) {
      return false;
    }

    // Check for Unicode direction overrides
    if (/[\u202a-\u202e\u2066-\u2069]/.test(input)) {
      return false;
    }

    return true;
  }

  /**
   * Validate a voice command specifically
   */
  validateVoiceCommand(
    transcript: string,
    options: { sessionId?: string } = {}
  ): InputValidationResult {
    return this.validate(transcript, {
      source: 'voice',
      sessionId: options.sessionId,
      context: 'voice',
    });
  }

  /**
   * Validate a file path
   */
  validateFilePath(filePath: string, options: { sessionId?: string } = {}): InputValidationResult {
    return this.validate(filePath, {
      source: 'file_access',
      sessionId: options.sessionId,
      context: 'file_path',
    });
  }

  /**
   * Validate a command string
   */
  validateCommandString(
    command: string,
    options: { sessionId?: string } = {}
  ): InputValidationResult {
    return this.validate(command, {
      source: 'command',
      sessionId: options.sessionId,
      context: 'command',
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<InputValidatorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('InputValidator config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): InputValidatorConfig {
    return { ...this.config };
  }
}

// Singleton instance
let inputValidatorInstance: InputValidator | null = null;

/**
 * Get or create the singleton InputValidator instance
 */
export function getInputValidator(config?: Partial<InputValidatorConfig>): InputValidator {
  if (!inputValidatorInstance) {
    inputValidatorInstance = new InputValidator(config);
  }
  return inputValidatorInstance;
}

/**
 * Shutdown the input validator
 */
export function shutdownInputValidator(): void {
  inputValidatorInstance = null;
}

export default InputValidator;
