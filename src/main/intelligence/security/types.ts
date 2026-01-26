/**
 * Intelligence Security Types
 * Encryption, audit logging, and access control types
 */

// ============================================================================
// ENCRYPTION TYPES
// ============================================================================

export type EncryptionAlgorithm = 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';

export interface EncryptionConfig {
  algorithm: EncryptionAlgorithm;
  keyDerivation: 'pbkdf2' | 'scrypt' | 'argon2';
  keyDerivationIterations: number;
  saltLength: number;
  ivLength: number;
  tagLength: number;  // For GCM mode
}

export interface EncryptedData {
  ciphertext: string;  // Base64 encoded
  iv: string;          // Base64 encoded
  salt: string;        // Base64 encoded
  tag?: string;        // Base64 encoded, for GCM mode
  algorithm: EncryptionAlgorithm;
  version: number;
}

export interface EncryptionKeyInfo {
  id: string;
  createdAt: Date;
  rotatedAt?: Date;
  expiresAt?: Date;
  algorithm: EncryptionAlgorithm;
  purpose: 'master' | 'data' | 'export' | 'backup';
}

export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  keyDerivation: 'pbkdf2',
  keyDerivationIterations: 100000,
  saltLength: 32,
  ivLength: 16,
  tagLength: 16,
};

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

export type AuditAction =
  // Entity operations
  | 'entity:create'
  | 'entity:read'
  | 'entity:update'
  | 'entity:delete'
  | 'entity:merge'
  // Relationship operations
  | 'relationship:create'
  | 'relationship:delete'
  // Query operations
  | 'query:execute'
  | 'query:semantic_search'
  | 'query:full_text_search'
  // Agent operations
  | 'agent:query'
  | 'agent:alert'
  | 'agent:recommendation'
  // Playbook operations
  | 'playbook:create'
  | 'playbook:update'
  | 'playbook:delete'
  | 'playbook:execute'
  | 'playbook:trigger'
  // Security operations
  | 'security:encrypt'
  | 'security:decrypt'
  | 'security:key_rotate'
  | 'security:export'
  | 'security:import'
  // Access operations
  | 'access:login'
  | 'access:logout'
  | 'access:permission_grant'
  | 'access:permission_revoke'
  // Data operations
  | 'data:backup'
  | 'data:restore'
  | 'data:sync'
  | 'data:export'
  | 'data:import';

export type AuditSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export type AuditOutcome = 'success' | 'failure' | 'partial' | 'denied';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  
  // Action info
  action: AuditAction;
  severity: AuditSeverity;
  outcome: AuditOutcome;
  
  // Context
  userId?: string;
  sessionId?: string;
  requestId?: string;
  
  // Target
  entityType?: string;
  entityId?: string;
  resourceType?: string;
  resourceId?: string;
  
  // Details
  details: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
  
  // Error info
  errorCode?: string;
  errorMessage?: string;
  
  // Metadata
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogFilter {
  startTime?: Date;
  endTime?: Date;
  actions?: AuditAction[];
  severities?: AuditSeverity[];
  outcomes?: AuditOutcome[];
  userId?: string;
  sessionId?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogStats {
  totalEntries: number;
  byAction: Record<AuditAction, number>;
  bySeverity: Record<AuditSeverity, number>;
  byOutcome: Record<AuditOutcome, number>;
  failureRate: number;
  periodStart: Date;
  periodEnd: Date;
}

// ============================================================================
// ACCESS CONTROL TYPES
// ============================================================================

export type Permission =
  // Entity permissions
  | 'entity:read'
  | 'entity:write'
  | 'entity:delete'
  | 'entity:admin'
  // Query permissions
  | 'query:basic'
  | 'query:advanced'
  | 'query:unlimited'
  // Agent permissions
  | 'agent:query'
  | 'agent:configure'
  // Playbook permissions
  | 'playbook:view'
  | 'playbook:execute'
  | 'playbook:manage'
  // Security permissions
  | 'security:view_audit'
  | 'security:manage_keys'
  | 'security:backup'
  // Admin permissions
  | 'admin:settings'
  | 'admin:users'
  | 'admin:full';

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isBuiltIn: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  roles: string[];  // Role IDs
  permissions: Permission[];  // Direct permissions
  createdAt: Date;
  lastActiveAt?: Date;
  settings: {
    notificationsEnabled: boolean;
    auditingLevel: AuditSeverity;
    dataRetentionDays: number;
  };
}

export const BUILT_IN_ROLES: Role[] = [
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to entities and basic queries',
    permissions: ['entity:read', 'query:basic', 'agent:query', 'playbook:view'],
    isBuiltIn: true,
  },
  {
    id: 'user',
    name: 'User',
    description: 'Standard user with read/write access',
    permissions: [
      'entity:read', 'entity:write',
      'query:basic', 'query:advanced',
      'agent:query', 'agent:configure',
      'playbook:view', 'playbook:execute',
    ],
    isBuiltIn: true,
  },
  {
    id: 'power_user',
    name: 'Power User',
    description: 'Advanced user with full entity and playbook access',
    permissions: [
      'entity:read', 'entity:write', 'entity:delete',
      'query:basic', 'query:advanced', 'query:unlimited',
      'agent:query', 'agent:configure',
      'playbook:view', 'playbook:execute', 'playbook:manage',
      'security:view_audit',
    ],
    isBuiltIn: true,
  },
  {
    id: 'admin',
    name: 'Administrator',
    description: 'Full system access',
    permissions: ['admin:full'],
    isBuiltIn: true,
  },
];

// ============================================================================
// DATA PROTECTION TYPES
// ============================================================================

export type SensitiveDataType =
  | 'pii'              // Personally Identifiable Information
  | 'financial'        // Financial data
  | 'health'           // Health information
  | 'credentials'      // Passwords, API keys
  | 'communication'    // Private messages
  | 'location'         // Location data
  | 'biometric';       // Biometric data

export interface SensitiveDataRule {
  id: string;
  name: string;
  dataType: SensitiveDataType;
  
  // Detection
  patterns: RegExp[];
  fieldNames: string[];
  entityTypes?: string[];
  
  // Protection
  action: 'encrypt' | 'mask' | 'redact' | 'hash' | 'block';
  maskCharacter?: string;
  maskLength?: number;
  
  // Retention
  retentionDays?: number;
  autoDelete?: boolean;
}

export interface DataClassification {
  level: 'public' | 'internal' | 'confidential' | 'restricted';
  sensitiveTypes: SensitiveDataType[];
  requiresEncryption: boolean;
  requiresAudit: boolean;
  retentionDays: number;
}

// ============================================================================
// SECURITY CONFIG
// ============================================================================

export interface SecurityConfig {
  // Encryption
  encryption: EncryptionConfig;
  encryptAtRest: boolean;
  encryptSensitiveFields: boolean;
  
  // Audit
  auditEnabled: boolean;
  auditLevel: AuditSeverity;
  auditRetentionDays: number;
  auditWriteToFile: boolean;
  auditFilePath?: string;
  
  // Access control
  requireAuthentication: boolean;
  sessionTimeoutMinutes: number;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  
  // Data protection
  sensitiveDataRules: SensitiveDataRule[];
  autoClassifyData: boolean;
  
  // Backup
  autoBackupEnabled: boolean;
  backupIntervalHours: number;
  backupRetentionDays: number;
  encryptBackups: boolean;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  encryption: DEFAULT_ENCRYPTION_CONFIG,
  encryptAtRest: true,
  encryptSensitiveFields: true,
  
  auditEnabled: true,
  auditLevel: 'info',
  auditRetentionDays: 90,
  auditWriteToFile: true,
  
  requireAuthentication: false,  // Single-user app
  sessionTimeoutMinutes: 60,
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 30,
  
  sensitiveDataRules: [],
  autoClassifyData: true,
  
  autoBackupEnabled: true,
  backupIntervalHours: 24,
  backupRetentionDays: 30,
  encryptBackups: true,
};
