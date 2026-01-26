/**
 * Atlas Desktop - Security Module
 * Comprehensive security hardening for voice assistant
 *
 * @module security
 */

export * from './audit-logger';
export * from './audit-types';
export * from './safe-terminal-executor';
export * from './sandbox-manager';
export * from './permission-manager';
export * from './operation-tracker';
export * from './input-validator';
export * from './keychain';
export * from './key-migration';
export * from './rate-limiter';
export * from './scanner';
export * from './anonymizer';
export * from './file-guard';
export * from './sandbox';

// Re-export types from shared security types
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
  KeychainConfig,
  KeychainResult,
  StoredKeyInfo,
  MigrationStatus,
  MigrationResult,
  // File Guard types
  FileAccessPermission,
  FileOperationType,
  DirectoryPermission,
  FileAccessResult,
  PathValidationResult,
  FileGuardConfig,
  // Sandbox types
  SandboxResourceLimits,
  SandboxExecutionContext,
  SandboxExecutionResult,
  ToolExecutionRecord,
  SandboxConfig,
} from '../../shared/types/security';

export {
  DEFAULT_SECURITY_CONFIG,
  CRITICAL_BLOCKED_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  SHELL_METACHARACTERS,
  DEFAULT_COMMAND_WHITELIST,
  BLOCKED_PATH_PATTERNS,
  // File Guard constants
  DEFAULT_FILE_GUARD_CONFIG,
  SYSTEM_BLOCKED_PATHS,
  SENSITIVE_FILE_PATTERNS,
  // Sandbox constants
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_SANDBOX_CONFIG,
} from '../../shared/types/security';

// Re-export audit types for convenience
export type {
  AuditEventCategory,
  AuditEventSource,
  AuditEntry,
  AuditSearchFilters,
  AuditSearchResult,
  AuditStatistics,
  AuditReportConfig,
  AuditReport,
  AuditLoggerConfig,
  SuspiciousPattern,
  PatternAlert,
  RetentionPolicy,
  ApiCallAuditDetails,
  FileOperationAuditDetails,
  CommandExecutionAuditDetails,
  ToolExecutionAuditDetails,
} from './audit-types';

export {
  DEFAULT_AUDIT_LOGGER_CONFIG,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_SUSPICIOUS_PATTERNS,
  SEVERITY_PRIORITY,
  compareSeverity,
  meetsSeverityThreshold,
} from './audit-types';
