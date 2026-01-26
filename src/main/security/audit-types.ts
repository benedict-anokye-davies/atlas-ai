/**
 * Atlas Desktop - Audit Logging Types
 * Type definitions for comprehensive audit logging system
 *
 * @module security/audit-types
 */

import { SecuritySeverity, SecurityEventCategory } from '../../shared/types/security';

/**
 * Extended audit event categories for comprehensive logging
 */
export type AuditEventCategory =
  | SecurityEventCategory
  | 'api_call'
  | 'system_event'
  | 'user_action'
  | 'configuration_change'
  | 'session_event'
  | 'tool_execution'
  | 'network_request'
  | 'memory_operation';

/**
 * Audit event source identifiers
 */
export type AuditEventSource =
  | 'voice_pipeline'
  | 'llm_agent'
  | 'tool_executor'
  | 'file_system'
  | 'browser_automation'
  | 'terminal_executor'
  | 'web_search'
  | 'memory_system'
  | 'ipc_handler'
  | 'user_interface'
  | 'system'
  | 'unknown';

/**
 * Extended audit entry with additional metadata
 */
export interface AuditEntry {
  /** Unique identifier for this entry */
  id: string;
  /** ISO timestamp of when the event occurred */
  timestamp: string;
  /** Event category */
  category: AuditEventCategory;
  /** Severity level */
  severity: SecuritySeverity;
  /** Human-readable event description */
  message: string;
  /** Action that was attempted */
  action: string;
  /** Whether the action was allowed/succeeded */
  allowed: boolean;
  /** Reason for the decision or outcome */
  reason?: string;
  /** Source of the request */
  source: AuditEventSource | string;
  /** User or session identifier */
  sessionId?: string;
  /** Duration of the operation in milliseconds */
  durationMs?: number;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Cryptographic hash of the entry for tamper detection */
  hash?: string;
  /** Hash of the previous entry (chain integrity) */
  previousHash?: string;
  /** Sequence number in the audit chain */
  sequence?: number;
}

/**
 * API call audit details
 */
export interface ApiCallAuditDetails {
  /** Target service name */
  service: string;
  /** API endpoint */
  endpoint: string;
  /** HTTP method */
  method?: string;
  /** Response status code */
  statusCode?: number;
  /** Request duration in ms */
  durationMs?: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Tokens used (for LLM calls) */
  tokensUsed?: number;
}

/**
 * File operation audit details
 */
export interface FileOperationAuditDetails {
  /** File path */
  path: string;
  /** Operation type */
  operation: 'read' | 'write' | 'delete' | 'rename' | 'move' | 'copy' | 'list';
  /** File size in bytes */
  sizeBytes?: number;
  /** New path (for rename/move) */
  newPath?: string;
  /** Whether the file exists */
  exists?: boolean;
  /** Whether path is blocked */
  blocked?: boolean;
  /** Blocking reason if applicable */
  blockReason?: string;
}

/**
 * Command execution audit details
 */
export interface CommandExecutionAuditDetails {
  /** Command that was executed */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Exit code */
  exitCode?: number;
  /** Working directory */
  cwd?: string;
  /** Risk level assessment */
  riskLevel?: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  /** Whether command was sanitized */
  sanitized?: boolean;
  /** Pattern that triggered blocking (if blocked) */
  matchedPattern?: string;
  /** Execution timeout in ms */
  timeoutMs?: number;
}

/**
 * Tool execution audit details
 */
export interface ToolExecutionAuditDetails {
  /** Tool name */
  toolName: string;
  /** Tool version */
  toolVersion?: string;
  /** Input parameters (sanitized) */
  inputParams?: Record<string, unknown>;
  /** Output summary */
  outputSummary?: string;
  /** Whether tool requires confirmation */
  requiresConfirmation?: boolean;
  /** User confirmation received */
  confirmed?: boolean;
}

/**
 * Audit search filters
 */
export interface AuditSearchFilters {
  /** Filter by category */
  category?: AuditEventCategory | AuditEventCategory[];
  /** Filter by severity */
  severity?: SecuritySeverity | SecuritySeverity[];
  /** Filter by source */
  source?: AuditEventSource | string | string[];
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by time range - start */
  startTime?: Date | string;
  /** Filter by time range - end */
  endTime?: Date | string;
  /** Filter by allowed/blocked status */
  allowed?: boolean;
  /** Full-text search in message */
  messageContains?: string;
  /** Full-text search in action */
  actionContains?: string;
  /** Search in context values */
  contextContains?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Sort field */
  sortBy?: 'timestamp' | 'severity' | 'category';
}

/**
 * Audit search result
 */
export interface AuditSearchResult {
  /** Matching entries */
  entries: AuditEntry[];
  /** Total count (before pagination) */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
  /** Applied filters */
  filters: AuditSearchFilters;
}

/**
 * Audit statistics
 */
export interface AuditStatistics {
  /** Total number of entries */
  totalEntries: number;
  /** Entries by category */
  byCategory: Record<AuditEventCategory, number>;
  /** Entries by severity */
  bySeverity: Record<SecuritySeverity, number>;
  /** Entries by source */
  bySource: Record<string, number>;
  /** Blocked/allowed ratio */
  blockedCount: number;
  /** Allowed count */
  allowedCount: number;
  /** Time range of the logs */
  timeRange: {
    earliest: string;
    latest: string;
  };
  /** Average events per hour */
  eventsPerHour: number;
}

/**
 * Audit report format options
 */
export type AuditReportFormat = 'json' | 'csv' | 'html' | 'text';

/**
 * Audit report configuration
 */
export interface AuditReportConfig {
  /** Report format */
  format: AuditReportFormat;
  /** Report title */
  title?: string;
  /** Include statistics */
  includeStatistics?: boolean;
  /** Include integrity verification result */
  includeIntegrityCheck?: boolean;
  /** Time range for the report */
  timeRange?: {
    start: Date | string;
    end: Date | string;
  };
  /** Filter criteria */
  filters?: AuditSearchFilters;
  /** Maximum entries to include */
  maxEntries?: number;
  /** Group results by field */
  groupBy?: 'category' | 'severity' | 'source' | 'date';
  /** Include sensitive context data */
  includeSensitiveData?: boolean;
}

/**
 * Generated audit report
 */
export interface AuditReport {
  /** Report ID */
  id: string;
  /** Generation timestamp */
  generatedAt: string;
  /** Report title */
  title: string;
  /** Report configuration */
  config: AuditReportConfig;
  /** Report content (format-specific) */
  content: string;
  /** Report statistics if included */
  statistics?: AuditStatistics;
  /** Integrity verification if included */
  integrityResult?: {
    valid: boolean;
    entries: number;
    errors: string[];
  };
  /** File path if saved to disk */
  filePath?: string;
}

/**
 * Suspicious pattern definition
 */
export interface SuspiciousPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Description of what this pattern detects */
  description: string;
  /** Severity when triggered */
  severity: SecuritySeverity;
  /** Detection logic type */
  type: 'threshold' | 'sequence' | 'anomaly' | 'custom';
  /** Whether this pattern is enabled */
  enabled: boolean;
  /** Threshold configuration (for threshold type) */
  threshold?: {
    /** Number of events to trigger */
    count: number;
    /** Time window in seconds */
    windowSeconds: number;
    /** Category filter */
    category?: AuditEventCategory;
    /** Severity filter */
    severity?: SecuritySeverity;
    /** Allowed filter */
    allowed?: boolean;
  };
  /** Sequence configuration (for sequence type) */
  sequence?: {
    /** Categories in order */
    categories: AuditEventCategory[];
    /** Maximum time between events */
    maxGapSeconds: number;
  };
  /** Custom predicate function (stringified for storage) */
  customPredicate?: string;
  /** Actions to take when pattern is detected */
  actions: PatternAlertAction[];
  /** Cooldown period in seconds before re-alerting */
  cooldownSeconds: number;
}

/**
 * Alert action configuration
 */
export interface PatternAlertAction {
  /** Action type */
  type: 'log' | 'notify' | 'block_session' | 'webhook' | 'email';
  /** Action configuration */
  config?: Record<string, unknown>;
}

/**
 * Pattern alert event
 */
export interface PatternAlert {
  /** Alert ID */
  id: string;
  /** Timestamp of the alert */
  timestamp: string;
  /** Pattern that triggered the alert */
  patternId: string;
  /** Pattern name */
  patternName: string;
  /** Alert severity */
  severity: SecuritySeverity;
  /** Alert message */
  message: string;
  /** Triggering events */
  triggeringEvents: AuditEntry[];
  /** Session ID if applicable */
  sessionId?: string;
  /** Actions taken */
  actionsTaken: string[];
  /** Whether alert was acknowledged */
  acknowledged: boolean;
  /** Acknowledgment details */
  acknowledgment?: {
    timestamp: string;
    user?: string;
    note?: string;
  };
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  /** Maximum age of logs in days */
  maxAgeDays: number;
  /** Maximum total size in bytes */
  maxTotalSizeBytes: number;
  /** Maximum number of log files */
  maxFiles: number;
  /** Archive old logs before deletion */
  archiveBeforeDelete: boolean;
  /** Archive compression format */
  archiveFormat?: 'gzip' | 'zip';
  /** Severity-specific retention (override default) */
  severityRetention?: Partial<Record<SecuritySeverity, number>>;
  /** Run cleanup on schedule (cron expression) */
  cleanupSchedule?: string;
}

/**
 * Audit logger configuration (extended)
 */
export interface AuditLoggerConfig {
  /** Base directory for audit logs */
  baseDir: string;
  /** Maximum log file size in bytes before rotation */
  maxFileSize: number;
  /** Buffer size before flushing to disk */
  bufferSize: number;
  /** Flush interval in milliseconds */
  flushInterval: number;
  /** Whether to output to console */
  consoleOutput: boolean;
  /** Retention policy */
  retention: RetentionPolicy;
  /** Suspicious patterns for alerting */
  suspiciousPatterns: SuspiciousPattern[];
  /** Enable hash chain verification */
  enableHashChain: boolean;
  /** Hash algorithm to use */
  hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  /** Minimum severity to log */
  minSeverity: SecuritySeverity;
  /** Enable real-time pattern detection */
  enableRealTimeDetection: boolean;
}

/**
 * Default suspicious patterns
 */
export const DEFAULT_SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    id: 'rapid-blocked-commands',
    name: 'Rapid Blocked Commands',
    description: 'Multiple command execution attempts blocked in short time',
    severity: 'warning',
    type: 'threshold',
    enabled: true,
    threshold: {
      count: 5,
      windowSeconds: 60,
      category: 'command_execution',
      allowed: false,
    },
    actions: [{ type: 'log' }, { type: 'notify' }],
    cooldownSeconds: 300,
  },
  {
    id: 'prompt-injection-burst',
    name: 'Prompt Injection Burst',
    description: 'Multiple prompt injection attempts detected',
    severity: 'critical',
    type: 'threshold',
    enabled: true,
    threshold: {
      count: 3,
      windowSeconds: 120,
      category: 'prompt_injection',
    },
    actions: [{ type: 'log' }, { type: 'notify' }, { type: 'block_session' }],
    cooldownSeconds: 600,
  },
  {
    id: 'sensitive-file-access-pattern',
    name: 'Sensitive File Access Pattern',
    description: 'Multiple attempts to access blocked file paths',
    severity: 'warning',
    type: 'threshold',
    enabled: true,
    threshold: {
      count: 5,
      windowSeconds: 300,
      category: 'file_access',
      allowed: false,
    },
    actions: [{ type: 'log' }, { type: 'notify' }],
    cooldownSeconds: 300,
  },
  {
    id: 'rate-limit-exhaustion',
    name: 'Rate Limit Exhaustion',
    description: 'Repeated rate limit violations',
    severity: 'warning',
    type: 'threshold',
    enabled: true,
    threshold: {
      count: 10,
      windowSeconds: 60,
      category: 'rate_limit',
      allowed: false,
    },
    actions: [{ type: 'log' }],
    cooldownSeconds: 120,
  },
  {
    id: 'critical-event-any',
    name: 'Any Critical Event',
    description: 'Any event with critical severity',
    severity: 'critical',
    type: 'threshold',
    enabled: true,
    threshold: {
      count: 1,
      windowSeconds: 1,
      severity: 'critical',
    },
    actions: [{ type: 'log' }, { type: 'notify' }],
    cooldownSeconds: 60,
  },
];

/**
 * Default retention policy
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxAgeDays: 90,
  maxTotalSizeBytes: 500 * 1024 * 1024, // 500MB
  maxFiles: 100,
  archiveBeforeDelete: true,
  archiveFormat: 'gzip',
  severityRetention: {
    critical: 365, // Keep critical events for 1 year
    blocked: 180, // Keep blocked events for 6 months
    warning: 90,
    info: 30,
  },
};

/**
 * Default audit logger configuration
 */
export const DEFAULT_AUDIT_LOGGER_CONFIG: Partial<AuditLoggerConfig> = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  bufferSize: 100,
  flushInterval: 5000,
  consoleOutput: process.env.NODE_ENV === 'development',
  retention: DEFAULT_RETENTION_POLICY,
  suspiciousPatterns: DEFAULT_SUSPICIOUS_PATTERNS,
  enableHashChain: true,
  hashAlgorithm: 'sha256',
  minSeverity: 'info',
  enableRealTimeDetection: true,
};

/**
 * Severity level priority (for filtering)
 */
export const SEVERITY_PRIORITY: Record<SecuritySeverity, number> = {
  info: 0,
  warning: 1,
  blocked: 2,
  critical: 3,
};

/**
 * Helper to compare severity levels
 */
export function compareSeverity(a: SecuritySeverity, b: SecuritySeverity): number {
  return SEVERITY_PRIORITY[a] - SEVERITY_PRIORITY[b];
}

/**
 * Helper to check if severity meets minimum
 */
export function meetsSeverityThreshold(
  severity: SecuritySeverity,
  minimum: SecuritySeverity
): boolean {
  return SEVERITY_PRIORITY[severity] >= SEVERITY_PRIORITY[minimum];
}
