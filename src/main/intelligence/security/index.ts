/**
 * Intelligence Security Module
 * Unified security layer for the intelligence system
 */

export * from './types';
export * from './encryption';
export * from './audit-logger';

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { EncryptionService, getEncryptionService } from './encryption';
import { AuditLogger, getAuditLogger } from './audit-logger';
import {
  SecurityConfig,
  DEFAULT_SECURITY_CONFIG,
  SensitiveDataRule,
  SensitiveDataType,
  DataClassification,
  Permission,
  Role,
  UserProfile,
  BUILT_IN_ROLES,
} from './types';

const logger = createModuleLogger('Security');

// ============================================================================
// SECURITY MANAGER
// ============================================================================

export class SecurityManager extends EventEmitter {
  private config: SecurityConfig;
  private encryption: EncryptionService;
  private audit: AuditLogger;
  private sensitiveRules: Map<string, SensitiveDataRule> = new Map();
  private initialized = false;

  // Access control (simplified for single-user)
  private currentUser: UserProfile | null = null;
  private roles: Map<string, Role> = new Map();

  constructor(config: Partial<SecurityConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
    this.encryption = getEncryptionService();
    this.audit = getAuditLogger();

    // Load built-in roles
    for (const role of BUILT_IN_ROLES) {
      this.roles.set(role.id, role);
    }
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(masterPassword?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing security manager...');

    // Initialize encryption if password provided
    if (masterPassword && this.config.encryptAtRest) {
      await this.encryption.initialize(masterPassword);
    }

    // Initialize audit logger
    await this.audit.initialize();

    // Load sensitive data rules
    this.loadSensitiveRules();

    // Set default user (single-user mode)
    this.currentUser = {
      id: 'default-user',
      name: 'User',
      roles: ['power_user'],
      permissions: [],
      createdAt: new Date(),
      settings: {
        notificationsEnabled: true,
        auditingLevel: this.config.auditLevel,
        dataRetentionDays: this.config.auditRetentionDays,
      },
    };

    this.audit.logSecurityEvent(
      'access:login',
      'info',
      'success',
      { userId: this.currentUser.id }
    );

    this.initialized = true;
    logger.info('Security manager initialized');
  }

  async shutdown(): Promise<void> {
    if (this.currentUser) {
      this.audit.logSecurityEvent(
        'access:logout',
        'info',
        'success',
        { userId: this.currentUser.id }
      );
    }

    await this.audit.shutdown();
    this.encryption.shutdown();

    this.initialized = false;
    logger.info('Security manager shut down');
  }

  // --------------------------------------------------------------------------
  // ENCRYPTION PROXY
  // --------------------------------------------------------------------------

  /**
   * Encrypt sensitive data
   */
  encrypt(data: string | object): ReturnType<EncryptionService['encrypt']> {
    const result = this.encryption.encrypt(data);
    this.audit.logSecurityEvent('security:encrypt', 'debug', 'success', {
      dataType: typeof data,
    });
    return result;
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData: Parameters<EncryptionService['decrypt']>[0]): string {
    const result = this.encryption.decrypt(encryptedData);
    this.audit.logSecurityEvent('security:decrypt', 'debug', 'success', {});
    return result;
  }

  /**
   * Decrypt as object
   */
  decryptObject<T>(encryptedData: Parameters<EncryptionService['decryptObject']>[0]): T {
    return this.encryption.decryptObject<T>(encryptedData);
  }

  // --------------------------------------------------------------------------
  // SENSITIVE DATA HANDLING
  // --------------------------------------------------------------------------

  private loadSensitiveRules(): void {
    // Default rules for common sensitive data types
    const defaultRules: SensitiveDataRule[] = [
      {
        id: 'email-addresses',
        name: 'Email Addresses',
        dataType: 'pii',
        patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
        fieldNames: ['email', 'emailAddress', 'mail'],
        action: 'mask',
        maskCharacter: '*',
        maskLength: 4,
      },
      {
        id: 'phone-numbers',
        name: 'Phone Numbers',
        dataType: 'pii',
        patterns: [/(\+?[0-9]{1,3}[-. ]?)?(\([0-9]{3}\)|[0-9]{3})[-. ]?[0-9]{3}[-. ]?[0-9]{4}/g],
        fieldNames: ['phone', 'phoneNumber', 'mobile', 'telephone'],
        action: 'mask',
        maskCharacter: '*',
        maskLength: 4,
      },
      {
        id: 'credit-cards',
        name: 'Credit Card Numbers',
        dataType: 'financial',
        patterns: [/\b[0-9]{4}[-. ]?[0-9]{4}[-. ]?[0-9]{4}[-. ]?[0-9]{4}\b/g],
        fieldNames: ['cardNumber', 'creditCard', 'ccNumber'],
        action: 'mask',
        maskCharacter: '*',
      },
      {
        id: 'api-keys',
        name: 'API Keys',
        dataType: 'credentials',
        patterns: [
          /sk-[a-zA-Z0-9]{24,}/g,  // OpenAI style
          /[a-zA-Z0-9]{32,}/g,     // Generic long keys
        ],
        fieldNames: ['apiKey', 'api_key', 'secretKey', 'secret_key', 'token'],
        action: 'redact',
      },
      {
        id: 'passwords',
        name: 'Passwords',
        dataType: 'credentials',
        patterns: [],
        fieldNames: ['password', 'passwd', 'pwd', 'secret'],
        action: 'redact',
      },
      {
        id: 'uk-sort-codes',
        name: 'UK Sort Codes',
        dataType: 'financial',
        patterns: [/\b[0-9]{2}[-][0-9]{2}[-][0-9]{2}\b/g],
        fieldNames: ['sortCode', 'sort_code'],
        action: 'mask',
      },
      {
        id: 'uk-account-numbers',
        name: 'UK Account Numbers',
        dataType: 'financial',
        patterns: [/\b[0-9]{8}\b/g],
        fieldNames: ['accountNumber', 'account_number'],
        action: 'mask',
        maskLength: 4,
      },
    ];

    for (const rule of defaultRules) {
      this.sensitiveRules.set(rule.id, rule);
    }

    // Add custom rules from config
    for (const rule of this.config.sensitiveDataRules) {
      this.sensitiveRules.set(rule.id, rule);
    }
  }

  /**
   * Protect sensitive data in an object
   */
  protectSensitiveData<T extends object>(obj: T): T {
    const result = { ...obj } as any;

    for (const rule of this.sensitiveRules.values()) {
      for (const fieldName of rule.fieldNames) {
        if (fieldName in result && result[fieldName]) {
          result[fieldName] = this.applySensitiveRule(
            String(result[fieldName]),
            rule
          );
        }
      }
    }

    return result;
  }

  /**
   * Detect sensitive data in text
   */
  detectSensitiveData(text: string): {
    found: boolean;
    types: SensitiveDataType[];
    matches: { ruleId: string; match: string }[];
  } {
    const matches: { ruleId: string; match: string }[] = [];
    const types = new Set<SensitiveDataType>();

    for (const rule of this.sensitiveRules.values()) {
      for (const pattern of rule.patterns) {
        const found = text.match(pattern);
        if (found) {
          types.add(rule.dataType);
          for (const match of found) {
            matches.push({ ruleId: rule.id, match });
          }
        }
      }
    }

    return {
      found: matches.length > 0,
      types: Array.from(types),
      matches,
    };
  }

  private applySensitiveRule(value: string, rule: SensitiveDataRule): string {
    switch (rule.action) {
      case 'redact':
        return this.encryption.redact(value);

      case 'mask':
        return this.encryption.mask(
          value,
          rule.maskLength ?? 4,
          rule.maskCharacter ?? '*'
        );

      case 'hash':
        return this.encryption.hash(value);

      case 'encrypt':
        if (this.encryption.isInitialized()) {
          const encrypted = this.encryption.encrypt(value);
          return `[ENCRYPTED:${encrypted.ciphertext.substring(0, 8)}...]`;
        }
        return this.encryption.redact(value);

      case 'block':
        return '[BLOCKED]';

      default:
        return value;
    }
  }

  // --------------------------------------------------------------------------
  // DATA CLASSIFICATION
  // --------------------------------------------------------------------------

  /**
   * Classify data based on content
   */
  classifyData(data: unknown): DataClassification {
    if (typeof data === 'string') {
      const detection = this.detectSensitiveData(data);
      return this.classificationFromTypes(detection.types);
    }

    if (typeof data === 'object' && data !== null) {
      const allTypes = new Set<SensitiveDataType>();
      
      for (const value of Object.values(data)) {
        if (typeof value === 'string') {
          const detection = this.detectSensitiveData(value);
          detection.types.forEach(t => allTypes.add(t));
        }
      }
      
      return this.classificationFromTypes(Array.from(allTypes));
    }

    return {
      level: 'public',
      sensitiveTypes: [],
      requiresEncryption: false,
      requiresAudit: false,
      retentionDays: 365,
    };
  }

  private classificationFromTypes(types: SensitiveDataType[]): DataClassification {
    if (types.includes('credentials') || types.includes('biometric')) {
      return {
        level: 'restricted',
        sensitiveTypes: types,
        requiresEncryption: true,
        requiresAudit: true,
        retentionDays: 30,
      };
    }

    if (types.includes('financial') || types.includes('health')) {
      return {
        level: 'confidential',
        sensitiveTypes: types,
        requiresEncryption: true,
        requiresAudit: true,
        retentionDays: 90,
      };
    }

    if (types.includes('pii') || types.includes('communication') || types.includes('location')) {
      return {
        level: 'internal',
        sensitiveTypes: types,
        requiresEncryption: this.config.encryptSensitiveFields,
        requiresAudit: true,
        retentionDays: 180,
      };
    }

    return {
      level: 'public',
      sensitiveTypes: types,
      requiresEncryption: false,
      requiresAudit: false,
      retentionDays: 365,
    };
  }

  // --------------------------------------------------------------------------
  // ACCESS CONTROL
  // --------------------------------------------------------------------------

  /**
   * Check if current user has permission
   */
  hasPermission(permission: Permission): boolean {
    if (!this.currentUser) {
      return false;
    }

    // Direct permissions
    if (this.currentUser.permissions.includes(permission)) {
      return true;
    }

    // Role-based permissions
    for (const roleId of this.currentUser.roles) {
      const role = this.roles.get(roleId);
      if (role) {
        if (role.permissions.includes('admin:full')) {
          return true;
        }
        if (role.permissions.includes(permission)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Require permission (throws if denied)
   */
  requirePermission(permission: Permission, resourceType?: string, resourceId?: string): void {
    if (!this.hasPermission(permission)) {
      this.audit.logAccessDenied(
        'access:permission_revoke',
        `Missing permission: ${permission}`,
        this.currentUser?.id,
        resourceType,
        resourceId
      );
      throw new Error(`Permission denied: ${permission}`);
    }
  }

  /**
   * Get current user
   */
  getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  // --------------------------------------------------------------------------
  // AUDIT PROXY
  // --------------------------------------------------------------------------

  /**
   * Log an entity operation
   */
  auditEntityOperation(
    action: 'entity:create' | 'entity:read' | 'entity:update' | 'entity:delete',
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>
  ): void {
    this.audit.logEntityOperation(action, entityType, entityId, details);
  }

  /**
   * Log a query
   */
  auditQuery(query: string, agentId?: string, resultCount?: number, durationMs?: number): void {
    this.audit.logQuery(query, agentId, resultCount, durationMs);
  }

  /**
   * Get audit logs
   */
  getAuditLogs(filter?: Parameters<AuditLogger['query']>[0]) {
    return this.audit.query(filter);
  }

  /**
   * Get audit statistics
   */
  getAuditStats(since?: Date) {
    return this.audit.getStats(since);
  }

  // --------------------------------------------------------------------------
  // BACKUP / EXPORT
  // --------------------------------------------------------------------------

  /**
   * Export encryption key
   */
  async exportEncryptionKey(password: string) {
    const result = await this.encryption.exportKey(password);
    this.audit.logSecurityEvent('security:export', 'warning', 'success', {
      keyId: result.keyInfo.id,
    });
    return result;
  }

  /**
   * Import encryption key
   */
  async importEncryptionKey(
    encryptedKey: Parameters<EncryptionService['importKey']>[0],
    keyInfo: Parameters<EncryptionService['importKey']>[1],
    password: string
  ): Promise<void> {
    await this.encryption.importKey(encryptedKey, keyInfo, password);
    this.audit.logSecurityEvent('security:import', 'warning', 'success', {
      keyId: keyInfo.id,
    });
  }

  /**
   * Rotate master key
   */
  async rotateKey(newPassword: string) {
    const result = await this.encryption.rotateMasterKey(newPassword);
    this.audit.logSecurityEvent('security:key_rotate', 'warning', 'success', {
      oldKeyId: result.oldKeyInfo?.id,
      newKeyId: result.newKeyInfo.id,
    });
    return result;
  }

  // --------------------------------------------------------------------------
  // STATUS
  // --------------------------------------------------------------------------

  isInitialized(): boolean {
    return this.initialized;
  }

  isEncryptionEnabled(): boolean {
    return this.encryption.isInitialized();
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: SecurityManager | null = null;

export function getSecurityManager(): SecurityManager {
  if (!instance) {
    instance = new SecurityManager();
  }
  return instance;
}

export async function initializeSecurity(masterPassword?: string): Promise<void> {
  const manager = getSecurityManager();
  await manager.initialize(masterPassword);
}
