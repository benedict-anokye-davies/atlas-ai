/**
 * Nova Desktop - Security Module
 * Comprehensive security hardening for voice assistant
 *
 * @module security
 */

export * from './audit-logger';
export * from './safe-terminal-executor';
export * from './input-validator';

// Re-export types
export type {
  SecurityAuditEntry,
  SecurityEventCategory,
  SecuritySeverity,
  CommandValidationResult,
  InputValidationResult,
  DetectedThreat,
  ThreatType,
  RateLimitConfig,
  RateLimitStatus,
  WhitelistEntry,
  SecurityConfig,
} from '../../shared/types/security';

export {
  DEFAULT_SECURITY_CONFIG,
  CRITICAL_BLOCKED_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  SHELL_METACHARACTERS,
  DEFAULT_COMMAND_WHITELIST,
  BLOCKED_PATH_PATTERNS,
} from '../../shared/types/security';
