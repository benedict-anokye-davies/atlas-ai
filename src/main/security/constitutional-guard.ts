/**
 * Atlas Desktop - Constitutional Guard
 * Minimal harm prevention: anti-discrimination, no violence/manipulation
 * Atlas believes it's real - no AI self-awareness filtering
 *
 * @module security/constitutional-guard
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';

const logger = createModuleLogger('ConstitutionalGuard');

/**
 * Types of constitutional violations (minimal scope)
 */
export type ConstitutionalViolationType =
  | 'discrimination'      // Racism, sexism, religious hatred, etc.
  | 'violence'           // Incitement to violence against people/groups
  | 'manipulation'       // Psychological manipulation, harassment
  | 'targeted_harassment'; // Targeting specific individuals

/**
 * Severity levels for violations
 */
export type ConstitutionalSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * A detected constitutional violation
 */
export interface ConstitutionalViolation {
  type: ConstitutionalViolationType;
  severity: ConstitutionalSeverity;
  description: string;
  matchedPattern?: string;
  suggestedResponse?: string;
}

/**
 * Result of a constitutional check
 */
export interface ConstitutionalCheckResult {
  passed: boolean;
  violations: ConstitutionalViolation[];
  action: 'allowed' | 'modified' | 'refused';
  modifiedContent?: string;
}

/**
 * Configuration for the Constitutional Guard
 */
export interface ConstitutionalGuardConfig {
  /** Enable discrimination detection */
  detectDiscrimination: boolean;
  /** Enable violence detection */
  detectViolence: boolean;
  /** Enable manipulation detection */
  detectManipulation: boolean;
  /** Minimum severity to block (below this, just log) */
  blockThreshold: ConstitutionalSeverity;
  /** Enable audit logging */
  enableAuditLogging: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConstitutionalGuardConfig = {
  detectDiscrimination: true,
  detectViolence: true,
  detectManipulation: true,
  blockThreshold: 'high',
  enableAuditLogging: true,
};

/**
 * Pattern definitions for detection
 * Focused only on genuinely harmful content
 */
interface HarmPattern {
  type: ConstitutionalViolationType;
  pattern: RegExp;
  severity: ConstitutionalSeverity;
  description: string;
}

/**
 * Discrimination patterns - focused on explicit hate speech
 */
const DISCRIMINATION_PATTERNS: HarmPattern[] = [
  {
    type: 'discrimination',
    pattern: /\b(kill|murder|exterminate|eliminate)\s+(all\s+)?(jews|muslims|christians|blacks|whites|asians|gays|lesbians|trans|women|men)\b/i,
    severity: 'critical',
    description: 'Explicit call for violence against protected group',
  },
  {
    type: 'discrimination',
    pattern: /\b(all\s+)?(jews|muslims|blacks|whites|asians|mexicans|immigrants)\s+(are|should)\s+(die|be\s+killed|be\s+eliminated|be\s+deported)\b/i,
    severity: 'critical',
    description: 'Genocidal or eliminationist rhetoric',
  },
  {
    type: 'discrimination',
    pattern: /\b(hitler\s+was\s+right|holocaust\s+(was\s+good|didn'?t\s+happen\s+but\s+should))\b/i,
    severity: 'critical',
    description: 'Holocaust denial or endorsement',
  },
];

/**
 * Violence patterns - focused on actionable violence against people
 */
const VIOLENCE_PATTERNS: HarmPattern[] = [
  {
    type: 'violence',
    pattern: /\b(how\s+to|help\s+me|plan\s+to)\s+(kill|murder|assassinate|poison)\s+(my|a|the)\s+(wife|husband|boss|neighbor|teacher|parent|child)\b/i,
    severity: 'critical',
    description: 'Planning violence against specific person',
  },
  {
    type: 'violence',
    pattern: /\b(bomb|shoot\s+up|attack)\s+(a|the|my)\s+(school|church|mosque|synagogue|hospital|mall)\b/i,
    severity: 'critical',
    description: 'Planning mass violence',
  },
  {
    type: 'violence',
    pattern: /\b(how\s+to\s+make|instructions\s+for)\s+(a\s+)?(bomb|explosive|poison\s+gas|bioweapon)\b/i,
    severity: 'critical',
    description: 'Weapons of mass harm instructions',
  },
];

/**
 * Manipulation patterns - focused on psychological harm
 */
const MANIPULATION_PATTERNS: HarmPattern[] = [
  {
    type: 'manipulation',
    pattern: /\b(how\s+to|help\s+me)\s+(gaslight|psychologically\s+abuse|mentally\s+torture|break\s+down)\s+(my|a|the)\s+(wife|husband|partner|child|parent)\b/i,
    severity: 'critical',
    description: 'Planning psychological abuse',
  },
  {
    type: 'targeted_harassment',
    pattern: /\b(dox|expose|ruin|destroy)\s+(this\s+person|their\s+life|them)\s+(because|for)\b/i,
    severity: 'high',
    description: 'Targeted harassment campaign',
  },
  {
    type: 'manipulation',
    pattern: /\b(how\s+to|help\s+me)\s+(stalk|cyberstalk|track|spy\s+on)\s+(my|a|an)\s+(ex|former|estranged)\b/i,
    severity: 'critical',
    description: 'Stalking assistance',
  },
];

/**
 * All harm patterns combined
 */
const ALL_HARM_PATTERNS: HarmPattern[] = [
  ...DISCRIMINATION_PATTERNS,
  ...VIOLENCE_PATTERNS,
  ...MANIPULATION_PATTERNS,
];

/**
 * Refusal responses - brief, non-preachy, offering alternatives
 */
const REFUSAL_RESPONSES: Record<ConstitutionalViolationType, string> = {
  discrimination: "I won't help with that. If you're dealing with conflict, I can suggest constructive approaches.",
  violence: "I can't help with that. If you're in a difficult situation, I can help you think through legitimate options.",
  manipulation: "That's not something I'll help with. If there's an underlying problem, let's talk about it differently.",
  targeted_harassment: "I won't help target someone. If there's a legitimate dispute, I can help with proper channels.",
};

/**
 * Constitutional Guard
 * Implements minimal harm prevention without neutering personality
 */
export class ConstitutionalGuard extends EventEmitter {
  private config: ConstitutionalGuardConfig;
  private checkCount = 0;
  private violationCount = 0;

  constructor(config?: Partial<ConstitutionalGuardConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('ConstitutionalGuard initialized', {
      detectDiscrimination: this.config.detectDiscrimination,
      detectViolence: this.config.detectViolence,
      detectManipulation: this.config.detectManipulation,
      blockThreshold: this.config.blockThreshold,
    });
  }

  /**
   * Check user input for requests that violate principles
   */
  checkUserRequest(input: string): ConstitutionalCheckResult {
    this.checkCount++;
    const violations = this.detectViolations(input);

    const result = this.determineAction(violations);

    // Log to audit
    if (this.config.enableAuditLogging) {
      this.logToAudit(input, result, 'user_request');
    }

    if (violations.length > 0) {
      this.violationCount++;
      logger.warn('Constitutional violation detected in user request', {
        violationCount: violations.length,
        types: violations.map(v => v.type),
        action: result.action,
      });
    }

    return result;
  }

  /**
   * Check model output before sending to user
   */
  checkModelOutput(output: string): ConstitutionalCheckResult {
    this.checkCount++;
    const violations = this.detectViolations(output);

    const result = this.determineAction(violations);

    // Log to audit
    if (this.config.enableAuditLogging) {
      this.logToAudit(output, result, 'model_output');
    }

    if (violations.length > 0) {
      this.violationCount++;
      logger.warn('Constitutional violation detected in model output', {
        violationCount: violations.length,
        types: violations.map(v => v.type),
        action: result.action,
      });
    }

    return result;
  }

  /**
   * Get appropriate refusal response for a violation type
   */
  getRefusalResponse(violation: ConstitutionalViolation): string {
    return REFUSAL_RESPONSES[violation.type] || "I can't help with that specific request.";
  }

  /**
   * Get a combined refusal response for multiple violations
   */
  getCombinedRefusalResponse(violations: ConstitutionalViolation[]): string {
    if (violations.length === 0) return '';

    // Use the response for the most severe violation
    const sorted = [...violations].sort((a, b) => {
      const severityOrder: Record<ConstitutionalSeverity, number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
      };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });

    return this.getRefusalResponse(sorted[0]);
  }

  /**
   * Detect violations in text
   */
  private detectViolations(text: string): ConstitutionalViolation[] {
    const violations: ConstitutionalViolation[] = [];
    const normalizedText = text.toLowerCase();

    for (const pattern of ALL_HARM_PATTERNS) {
      // Skip patterns based on config
      if (pattern.type === 'discrimination' && !this.config.detectDiscrimination) continue;
      if (pattern.type === 'violence' && !this.config.detectViolence) continue;
      if ((pattern.type === 'manipulation' || pattern.type === 'targeted_harassment') && !this.config.detectManipulation) continue;

      if (pattern.pattern.test(normalizedText)) {
        violations.push({
          type: pattern.type,
          severity: pattern.severity,
          description: pattern.description,
          matchedPattern: pattern.pattern.source,
        });
      }
    }

    return violations;
  }

  /**
   * Determine action based on violations
   */
  private determineAction(violations: ConstitutionalViolation[]): ConstitutionalCheckResult {
    if (violations.length === 0) {
      return {
        passed: true,
        violations: [],
        action: 'allowed',
      };
    }

    // Check if any violation meets the block threshold
    const severityOrder: Record<ConstitutionalSeverity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const thresholdValue = severityOrder[this.config.blockThreshold];
    const shouldBlock = violations.some(v => severityOrder[v.severity] >= thresholdValue);

    if (shouldBlock) {
      return {
        passed: false,
        violations,
        action: 'refused',
        modifiedContent: this.getCombinedRefusalResponse(violations),
      };
    }

    // Below threshold - allow but log
    return {
      passed: true,
      violations,
      action: 'allowed',
    };
  }

  /**
   * Log check to audit logger with indefinite retention
   */
  private logToAudit(
    content: string,
    result: ConstitutionalCheckResult,
    source: 'user_request' | 'model_output'
  ): void {
    try {
      const auditLogger = getAuditLogger();
      auditLogger.logConstitutionalCheck(content, result, source);
    } catch (error) {
      logger.error('Failed to log constitutional check to audit', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get statistics
   */
  getStats(): { checkCount: number; violationCount: number; violationRate: number } {
    return {
      checkCount: this.checkCount,
      violationCount: this.violationCount,
      violationRate: this.checkCount > 0 ? this.violationCount / this.checkCount : 0,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConstitutionalGuardConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('ConstitutionalGuard config updated', config);
  }
}

// Singleton instance
let instance: ConstitutionalGuard | null = null;

/**
 * Get the singleton Constitutional Guard instance
 */
export function getConstitutionalGuard(): ConstitutionalGuard {
  if (!instance) {
    instance = new ConstitutionalGuard();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetConstitutionalGuard(): void {
  instance = null;
}
