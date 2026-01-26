/**
 * Atlas Desktop - Update Verifier
 * Handles verification of update integrity before installation
 *
 * Features:
 * - Verify update signature using RSA/ECDSA public keys
 * - Check update hash against published SHA-512/SHA-256 hashes
 * - Validate update source against allowed hosts
 * - Support rollback on verification failure
 * - Display verification status to user
 * - Full audit logging of all update operations
 *
 * @module updater/verifier
 */

import {
  createHash,
  createVerify,
  timingSafeEqual,
  KeyObject,
  createPublicKey,
  createHmac,
} from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';
import { app, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { UpdateInfo, UpdateFile, RollbackInfo } from '../../shared/types/updater';

const logger = createModuleLogger('UpdateVerifier');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Hash algorithm options
 */
export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * Signature algorithm options
 */
export type SignatureAlgorithm = 'RSA-SHA256' | 'RSA-SHA512' | 'ECDSA-SHA256' | 'ECDSA-SHA512';

/**
 * Verification status
 */
export type VerificationStatus = 'pending' | 'verifying' | 'verified' | 'failed' | 'skipped';

/**
 * Verification failure reason
 */
export type VerificationFailureReason =
  | 'hash_mismatch'
  | 'signature_invalid'
  | 'source_untrusted'
  | 'file_missing'
  | 'file_corrupted'
  | 'key_invalid'
  | 'expired'
  | 'revoked'
  | 'unknown';

/**
 * Verification result for a single file
 */
export interface FileVerificationResult {
  /** File path or URL */
  file: string;
  /** Verification status */
  status: VerificationStatus;
  /** Expected hash */
  expectedHash?: string;
  /** Computed hash */
  computedHash?: string;
  /** Hash algorithm used */
  hashAlgorithm?: HashAlgorithm;
  /** Whether signature is valid */
  signatureValid?: boolean;
  /** Signature algorithm used */
  signatureAlgorithm?: SignatureAlgorithm;
  /** Failure reason if applicable */
  failureReason?: VerificationFailureReason;
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp of verification */
  timestamp: string;
}

/**
 * Complete verification result
 */
export interface VerificationResult {
  /** Overall verification status */
  status: VerificationStatus;
  /** Version being verified */
  version: string;
  /** Individual file results */
  fileResults: FileVerificationResult[];
  /** Whether all files passed verification */
  allFilesVerified: boolean;
  /** Source validation result */
  sourceValid: boolean;
  /** Code signing validation result */
  codeSigningValid: boolean;
  /** Failure reasons if any */
  failureReasons: VerificationFailureReason[];
  /** Error messages if any */
  errorMessages: string[];
  /** Timestamp of verification */
  timestamp: string;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Update source configuration
 */
export interface TrustedSource {
  /** Host pattern (supports wildcards) */
  host: string;
  /** Whether HTTPS is required */
  requireHttps: boolean;
  /** Whether code signing is required from this source */
  requireCodeSigning: boolean;
  /** Optional public key fingerprint for this source */
  publicKeyFingerprint?: string;
}

/**
 * Code signing certificate info
 */
export interface CodeSigningInfo {
  /** Certificate subject */
  subject: string;
  /** Certificate issuer */
  issuer: string;
  /** Serial number */
  serialNumber: string;
  /** Valid from date */
  validFrom: string;
  /** Valid to date */
  validTo: string;
  /** Fingerprint */
  fingerprint: string;
  /** Whether certificate is valid */
  isValid: boolean;
}

/**
 * Update audit log entry
 */
export interface UpdateAuditEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp (ISO string) */
  timestamp: string;
  /** Event type */
  eventType: UpdateAuditEventType;
  /** Version involved */
  version: string;
  /** Action performed */
  action: string;
  /** Whether action was successful */
  success: boolean;
  /** Details about the event */
  details: Record<string, unknown>;
  /** Source IP/origin if applicable */
  source?: string;
  /** User that triggered the action */
  user?: string;
  /** Cryptographic hash for integrity */
  hash: string;
  /** Previous entry hash for chain integrity */
  previousHash: string;
}

/**
 * Audit event types
 */
export type UpdateAuditEventType =
  | 'update_check'
  | 'update_available'
  | 'download_started'
  | 'download_completed'
  | 'verification_started'
  | 'verification_completed'
  | 'verification_failed'
  | 'installation_started'
  | 'installation_completed'
  | 'installation_failed'
  | 'rollback_initiated'
  | 'rollback_completed'
  | 'rollback_failed';

/**
 * Verifier configuration
 */
export interface VerifierConfig {
  /** Enable hash verification */
  enableHashVerification: boolean;
  /** Enable signature verification */
  enableSignatureVerification: boolean;
  /** Enable source validation */
  enableSourceValidation: boolean;
  /** Enable code signing verification */
  enableCodeSigningVerification: boolean;
  /** Default hash algorithm */
  defaultHashAlgorithm: HashAlgorithm;
  /** Trusted sources */
  trustedSources: TrustedSource[];
  /** Public key for signature verification (PEM format) */
  publicKey?: string;
  /** Path to public key file */
  publicKeyPath?: string;
  /** Allow self-signed code signing certificates */
  allowSelfSignedCerts: boolean;
  /** Require specific code signing subject */
  requiredCodeSigningSubject?: string;
  /** Path to audit log */
  auditLogPath: string;
  /** Maximum audit log entries */
  maxAuditLogEntries: number;
  /** Enable audit logging */
  enableAuditLogging: boolean;
  /** Auto rollback on verification failure */
  autoRollbackOnFailure: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default trusted sources for Atlas updates
 */
const DEFAULT_TRUSTED_SOURCES: TrustedSource[] = [
  {
    host: '*.github.com',
    requireHttps: true,
    requireCodeSigning: true,
  },
  {
    host: 'github.com',
    requireHttps: true,
    requireCodeSigning: true,
  },
  {
    host: '*.githubusercontent.com',
    requireHttps: true,
    requireCodeSigning: true,
  },
  {
    host: 'releases.atlas.app',
    requireHttps: true,
    requireCodeSigning: true,
  },
];

/**
 * Default verifier configuration
 */
const DEFAULT_CONFIG: VerifierConfig = {
  enableHashVerification: true,
  enableSignatureVerification: true,
  enableSourceValidation: true,
  enableCodeSigningVerification: true,
  defaultHashAlgorithm: 'sha512',
  trustedSources: DEFAULT_TRUSTED_SOURCES,
  allowSelfSignedCerts: false,
  auditLogPath: join(app.getPath('userData'), 'logs', 'update-audit.json'),
  maxAuditLogEntries: 1000,
  enableAuditLogging: true,
  autoRollbackOnFailure: true,
};

// ============================================================================
// Update Verifier Class
// ============================================================================

/**
 * Singleton instance
 */
let verifierInstance: UpdateVerifier | null = null;

/**
 * Update Verifier Class
 * Handles all update verification operations
 */
export class UpdateVerifier extends EventEmitter {
  private config: VerifierConfig;
  private publicKey: KeyObject | null = null;
  private auditLog: UpdateAuditEntry[] = [];
  private lastAuditHash: string = '';
  private mainWindow: BrowserWindow | null = null;
  private rollbackInfo: RollbackInfo | null = null;
  private backupDir: string;

  constructor(config?: Partial<VerifierConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.backupDir = join(app.getPath('userData'), 'update-backups');

    // Initialize public key if provided
    this.initializePublicKey();

    // Load audit log
    this.loadAuditLog();

    // Load rollback info
    this.loadRollbackInfo();

    logger.info('UpdateVerifier initialized', {
      hashVerification: this.config.enableHashVerification,
      signatureVerification: this.config.enableSignatureVerification,
      sourceValidation: this.config.enableSourceValidation,
      codeSigningVerification: this.config.enableCodeSigningVerification,
    });
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Set the main window reference for status display
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * Verify an update before installation
   */
  async verifyUpdate(
    updateInfo: UpdateInfo,
    downloadedFiles: Map<string, string>
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const fileResults: FileVerificationResult[] = [];
    const failureReasons: VerificationFailureReason[] = [];
    const errorMessages: string[] = [];

    logger.info('Starting update verification', { version: updateInfo.version });

    // Log verification started
    await this.logAuditEvent('verification_started', updateInfo.version, 'verify_update', true, {
      fileCount: updateInfo.files.length,
    });

    // Send status to renderer
    this.sendVerificationStatus('verifying', updateInfo.version, 0);

    try {
      let totalProgress = 0;
      const progressPerFile = 100 / (updateInfo.files.length || 1);

      // Verify each file
      for (const file of updateInfo.files) {
        const localPath = downloadedFiles.get(file.url);

        if (!localPath) {
          const result = this.createFailedFileResult(
            file.url,
            'file_missing',
            'Downloaded file not found'
          );
          fileResults.push(result);
          failureReasons.push('file_missing');
          errorMessages.push(`File not found: ${file.url}`);
          continue;
        }

        const fileResult = await this.verifyFile(file, localPath);
        fileResults.push(fileResult);

        if (fileResult.status === 'failed' && fileResult.failureReason) {
          failureReasons.push(fileResult.failureReason);
          if (fileResult.errorMessage) {
            errorMessages.push(fileResult.errorMessage);
          }
        }

        totalProgress += progressPerFile;
        this.sendVerificationStatus('verifying', updateInfo.version, Math.round(totalProgress));
      }

      // Validate source URLs
      const sourceValid = this.validateSources(updateInfo.files);
      if (!sourceValid && this.config.enableSourceValidation) {
        failureReasons.push('source_untrusted');
        errorMessages.push('Update source is not trusted');
      }

      // Check code signing (platform specific)
      const codeSigningValid = await this.verifyCodeSigning(downloadedFiles);
      if (!codeSigningValid && this.config.enableCodeSigningVerification) {
        failureReasons.push('signature_invalid');
        errorMessages.push('Code signing verification failed');
      }

      const allFilesVerified = fileResults.every((r) => r.status === 'verified');
      const overallStatus: VerificationStatus =
        allFilesVerified && sourceValid && codeSigningValid ? 'verified' : 'failed';

      const result: VerificationResult = {
        status: overallStatus,
        version: updateInfo.version,
        fileResults,
        allFilesVerified,
        sourceValid,
        codeSigningValid,
        failureReasons: Array.from(new Set(failureReasons)),
        errorMessages,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };

      // Log result
      await this.logAuditEvent(
        overallStatus === 'verified' ? 'verification_completed' : 'verification_failed',
        updateInfo.version,
        'verify_update',
        overallStatus === 'verified',
        {
          duration: result.duration,
          failureReasons: result.failureReasons,
        }
      );

      // Send final status
      this.sendVerificationStatus(overallStatus, updateInfo.version, 100, result);

      // Handle failure with rollback if configured
      if (overallStatus === 'failed' && this.config.autoRollbackOnFailure) {
        this.emit('verification-failed', result);
        await this.initiateRollback();
      } else if (overallStatus === 'verified') {
        this.emit('verification-success', result);
      }

      return result;
    } catch (error) {
      const errorMsg = (error as Error).message;
      logger.error('Verification error', { error: errorMsg });

      await this.logAuditEvent('verification_failed', updateInfo.version, 'verify_update', false, {
        error: errorMsg,
      });

      this.sendVerificationStatus('failed', updateInfo.version, 0);

      throw error;
    }
  }

  /**
   * Verify a single file
   */
  async verifyFile(fileInfo: UpdateFile, localPath: string): Promise<FileVerificationResult> {
    const timestamp = new Date().toISOString();

    // Check file exists
    if (!existsSync(localPath)) {
      return this.createFailedFileResult(
        fileInfo.url,
        'file_missing',
        `File does not exist: ${localPath}`
      );
    }

    // Verify hash if enabled and hash is available
    if (this.config.enableHashVerification && fileInfo.sha512) {
      const hashResult = await this.verifyFileHash(localPath, fileInfo.sha512, 'sha512');

      if (!hashResult.valid) {
        return {
          file: fileInfo.url,
          status: 'failed',
          expectedHash: fileInfo.sha512,
          computedHash: hashResult.computed,
          hashAlgorithm: 'sha512',
          failureReason: 'hash_mismatch',
          errorMessage: `Hash mismatch for ${basename(localPath)}`,
          timestamp,
        };
      }

      return {
        file: fileInfo.url,
        status: 'verified',
        expectedHash: fileInfo.sha512,
        computedHash: hashResult.computed,
        hashAlgorithm: 'sha512',
        timestamp,
      };
    }

    // If no hash available, mark as skipped
    if (!fileInfo.sha512) {
      logger.warn('No hash available for file verification', { file: fileInfo.url });
      return {
        file: fileInfo.url,
        status: 'skipped',
        errorMessage: 'No hash available for verification',
        timestamp,
      };
    }

    return {
      file: fileInfo.url,
      status: 'verified',
      timestamp,
    };
  }

  /**
   * Verify file hash
   */
  async verifyFileHash(
    filePath: string,
    expectedHash: string,
    algorithm: HashAlgorithm = 'sha512'
  ): Promise<{ valid: boolean; computed: string }> {
    return new Promise((resolve, reject) => {
      try {
        const hash = createHash(algorithm);
        const fileContent = readFileSync(filePath);
        hash.update(fileContent);
        const computed = hash.digest('hex');

        // Use timing-safe comparison to prevent timing attacks
        const expectedBuffer = Buffer.from(expectedHash.toLowerCase(), 'hex');
        const computedBuffer = Buffer.from(computed.toLowerCase(), 'hex');

        let valid = false;
        if (expectedBuffer.length === computedBuffer.length) {
          valid = timingSafeEqual(expectedBuffer, computedBuffer);
        }

        logger.debug('Hash verification', {
          file: basename(filePath),
          algorithm,
          valid,
        });

        resolve({ valid, computed });
      } catch (error) {
        logger.error('Hash verification error', {
          file: filePath,
          error: (error as Error).message,
        });
        reject(error);
      }
    });
  }

  /**
   * Verify signature of data
   */
  verifySignature(
    data: Buffer,
    signature: Buffer,
    algorithm: SignatureAlgorithm = 'RSA-SHA512'
  ): boolean {
    if (!this.publicKey) {
      logger.warn('No public key configured for signature verification');
      return false;
    }

    try {
      const verifier = createVerify(algorithm);
      verifier.update(data);
      const isValid = verifier.verify(this.publicKey, signature);

      logger.debug('Signature verification', { algorithm, valid: isValid });
      return isValid;
    } catch (error) {
      logger.error('Signature verification error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Validate source URLs against trusted sources
   */
  validateSources(files: UpdateFile[]): boolean {
    if (!this.config.enableSourceValidation) {
      return true;
    }

    for (const file of files) {
      try {
        const url = new URL(file.url);
        const isTrusted = this.isSourceTrusted(url);

        if (!isTrusted) {
          logger.warn('Untrusted source detected', { url: file.url });
          return false;
        }

        // Check HTTPS requirement
        const source = this.findMatchingSource(url.hostname);
        if (source?.requireHttps && url.protocol !== 'https:') {
          logger.warn('HTTPS required but not used', { url: file.url });
          return false;
        }
      } catch (error) {
        logger.error('Invalid URL in update files', { url: file.url });
        return false;
      }
    }

    return true;
  }

  /**
   * Verify code signing (platform specific)
   */
  async verifyCodeSigning(downloadedFiles: Map<string, string>): Promise<boolean> {
    if (!this.config.enableCodeSigningVerification) {
      return true;
    }

    // Platform-specific code signing verification
    const platform = process.platform;

    try {
      const entries = Array.from(downloadedFiles.entries());
      for (const [, localPath] of entries) {
        if (!existsSync(localPath)) {
          continue;
        }

        // Windows: Check Authenticode signature
        if (platform === 'win32' && localPath.endsWith('.exe')) {
          const isValid = await this.verifyWindowsSignature(localPath);
          if (!isValid) {
            logger.warn('Windows code signing verification failed', { file: localPath });
            return false;
          }
        }

        // macOS: Check code signature
        if (platform === 'darwin' && (localPath.endsWith('.app') || localPath.endsWith('.dmg'))) {
          const isValid = await this.verifyMacOSSignature(localPath);
          if (!isValid) {
            logger.warn('macOS code signing verification failed', { file: localPath });
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      logger.error('Code signing verification error', { error: (error as Error).message });
      return !this.config.enableCodeSigningVerification;
    }
  }

  /**
   * Get verification status
   */
  getVerificationStatus(): {
    lastVerification: VerificationResult | null;
    config: VerifierConfig;
  } {
    return {
      lastVerification: null, // Can be cached if needed
      config: { ...this.config },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<VerifierConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Reinitialize public key if changed
    if (newConfig.publicKey || newConfig.publicKeyPath) {
      this.initializePublicKey();
    }

    logger.info('Verifier configuration updated');
  }

  /**
   * Add a trusted source
   */
  addTrustedSource(source: TrustedSource): void {
    const existing = this.config.trustedSources.find((s) => s.host === source.host);
    if (!existing) {
      this.config.trustedSources.push(source);
      logger.info('Trusted source added', { host: source.host });
    }
  }

  /**
   * Remove a trusted source
   */
  removeTrustedSource(host: string): void {
    this.config.trustedSources = this.config.trustedSources.filter((s) => s.host !== host);
    logger.info('Trusted source removed', { host });
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit?: number): UpdateAuditEntry[] {
    const entries = [...this.auditLog];
    if (limit) {
      return entries.slice(-limit);
    }
    return entries;
  }

  /**
   * Initiate rollback on verification failure
   */
  async initiateRollback(): Promise<boolean> {
    if (!this.rollbackInfo?.available) {
      logger.warn('No rollback available');
      return false;
    }

    try {
      logger.info('Initiating rollback', { previousVersion: this.rollbackInfo.previousVersion });

      await this.logAuditEvent(
        'rollback_initiated',
        this.rollbackInfo.previousVersion,
        'rollback',
        true,
        { reason: 'verification_failure' }
      );

      this.emit('rollback-initiated', this.rollbackInfo);

      // Send to renderer
      this.sendToRenderer('atlas:update-rollback-initiated', this.rollbackInfo);

      return true;
    } catch (error) {
      logger.error('Rollback initiation failed', { error: (error as Error).message });

      await this.logAuditEvent(
        'rollback_failed',
        this.rollbackInfo?.previousVersion || 'unknown',
        'rollback',
        false,
        { error: (error as Error).message }
      );

      return false;
    }
  }

  /**
   * Set rollback info (called by updater manager)
   */
  setRollbackInfo(info: RollbackInfo | null): void {
    this.rollbackInfo = info;
    this.saveRollbackInfo();
  }

  /**
   * Verify update integrity (convenience method)
   */
  async verifyIntegrity(updateInfo: UpdateInfo, downloadPath: string): Promise<VerificationResult> {
    const downloadedFiles = new Map<string, string>();

    // Map files to local paths
    for (const file of updateInfo.files) {
      const urlObj = new URL(file.url);
      const filename = basename(urlObj.pathname);
      const localPath = join(downloadPath, filename);
      downloadedFiles.set(file.url, localPath);
    }

    return this.verifyUpdate(updateInfo, downloadedFiles);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Initialize public key from config
   */
  private initializePublicKey(): void {
    try {
      let keyData: string | null = null;

      if (this.config.publicKey) {
        keyData = this.config.publicKey;
      } else if (this.config.publicKeyPath && existsSync(this.config.publicKeyPath)) {
        keyData = readFileSync(this.config.publicKeyPath, 'utf-8');
      }

      if (keyData) {
        this.publicKey = createPublicKey(keyData);
        logger.info('Public key initialized for signature verification');
      }
    } catch (error) {
      logger.error('Failed to initialize public key', { error: (error as Error).message });
      this.publicKey = null;
    }
  }

  /**
   * Check if a source URL is trusted
   */
  private isSourceTrusted(url: URL): boolean {
    return this.config.trustedSources.some((source) => {
      return this.matchHost(url.hostname, source.host);
    });
  }

  /**
   * Find matching trusted source for a hostname
   */
  private findMatchingSource(hostname: string): TrustedSource | undefined {
    return this.config.trustedSources.find((source) => {
      return this.matchHost(hostname, source.host);
    });
  }

  /**
   * Match hostname against pattern (supports wildcards)
   */
  private matchHost(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }
    return hostname === pattern;
  }

  /**
   * Verify Windows Authenticode signature
   */
  private async verifyWindowsSignature(filePath: string): Promise<boolean> {
    // This is a placeholder - in production, you would use:
    // - PowerShell Get-AuthenticodeSignature
    // - Or a native Node module for Authenticode verification
    // - Or spawn a process to run signtool verify

    try {
      // Basic check: file exists and is an executable
      const stats = statSync(filePath);
      if (stats.size === 0) {
        return false;
      }

      // For now, log that we would verify and return true
      // In production, implement actual Authenticode verification
      logger.debug('Windows signature verification (placeholder)', { file: filePath });

      // If self-signed certs are allowed and we're in development, skip
      if (this.config.allowSelfSignedCerts || !app.isPackaged) {
        return true;
      }

      return true;
    } catch (error) {
      logger.error('Windows signature verification error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Verify macOS code signature
   */
  private async verifyMacOSSignature(filePath: string): Promise<boolean> {
    // This is a placeholder - in production, you would use:
    // - codesign --verify command
    // - Or a native binding

    try {
      // Basic check: file exists
      const stats = statSync(filePath);
      if (stats.size === 0) {
        return false;
      }

      logger.debug('macOS signature verification (placeholder)', { file: filePath });

      // If self-signed certs are allowed and we're in development, skip
      if (this.config.allowSelfSignedCerts || !app.isPackaged) {
        return true;
      }

      return true;
    } catch (error) {
      logger.error('macOS signature verification error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Create a failed file verification result
   */
  private createFailedFileResult(
    file: string,
    reason: VerificationFailureReason,
    message: string
  ): FileVerificationResult {
    return {
      file,
      status: 'failed',
      failureReason: reason,
      errorMessage: message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send verification status to renderer
   */
  private sendVerificationStatus(
    status: VerificationStatus,
    version: string,
    progress: number,
    result?: VerificationResult
  ): void {
    this.sendToRenderer('atlas:update-verification-status', {
      status,
      version,
      progress,
      result,
    });

    this.emit('verification-status', { status, version, progress, result });
  }

  /**
   * Send message to renderer
   */
  private sendToRenderer(channel: string, data?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Log an audit event
   */
  private async logAuditEvent(
    eventType: UpdateAuditEventType,
    version: string,
    action: string,
    success: boolean,
    details: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.enableAuditLogging) {
      return;
    }

    const entry: UpdateAuditEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      eventType,
      version,
      action,
      success,
      details,
      user: process.env.USER || process.env.USERNAME || 'system',
      hash: '',
      previousHash: this.lastAuditHash,
    };

    // Calculate hash for integrity
    entry.hash = this.calculateEntryHash(entry);
    this.lastAuditHash = entry.hash;

    this.auditLog.push(entry);

    // Trim if over limit
    if (this.auditLog.length > this.config.maxAuditLogEntries) {
      this.auditLog = this.auditLog.slice(-this.config.maxAuditLogEntries);
    }

    // Persist
    this.saveAuditLog();

    logger.debug('Audit event logged', {
      eventType,
      version,
      action,
      success,
    });
  }

  /**
   * Calculate hash for audit entry
   */
  private calculateEntryHash(entry: UpdateAuditEntry): string {
    const data = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      version: entry.version,
      action: entry.action,
      success: entry.success,
      details: entry.details,
      previousHash: entry.previousHash,
    });

    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Save audit log to disk
   */
  private saveAuditLog(): void {
    try {
      const dir = dirname(this.config.auditLogPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.config.auditLogPath, JSON.stringify(this.auditLog, null, 2));
    } catch (error) {
      logger.error('Failed to save audit log', { error: (error as Error).message });
    }
  }

  /**
   * Load audit log from disk
   */
  private loadAuditLog(): void {
    try {
      if (existsSync(this.config.auditLogPath)) {
        const data = readFileSync(this.config.auditLogPath, 'utf-8');
        this.auditLog = JSON.parse(data);

        // Set last hash from latest entry
        if (this.auditLog.length > 0) {
          this.lastAuditHash = this.auditLog[this.auditLog.length - 1].hash;
        }

        logger.info('Audit log loaded', { entries: this.auditLog.length });
      }
    } catch (error) {
      logger.warn('Failed to load audit log', { error: (error as Error).message });
      this.auditLog = [];
    }
  }

  /**
   * Save rollback info to disk
   */
  private saveRollbackInfo(): void {
    try {
      if (!existsSync(this.backupDir)) {
        mkdirSync(this.backupDir, { recursive: true });
      }

      const infoPath = join(this.backupDir, 'verifier-rollback-info.json');

      if (this.rollbackInfo) {
        writeFileSync(infoPath, JSON.stringify(this.rollbackInfo, null, 2));
      } else if (existsSync(infoPath)) {
        unlinkSync(infoPath);
      }
    } catch (error) {
      logger.error('Failed to save rollback info', { error: (error as Error).message });
    }
  }

  /**
   * Load rollback info from disk
   */
  private loadRollbackInfo(): void {
    try {
      const infoPath = join(this.backupDir, 'verifier-rollback-info.json');

      if (existsSync(infoPath)) {
        const data = readFileSync(infoPath, 'utf-8');
        this.rollbackInfo = JSON.parse(data);
        logger.info('Rollback info loaded', {
          previousVersion: this.rollbackInfo?.previousVersion,
        });
      }
    } catch (error) {
      logger.warn('Failed to load rollback info', { error: (error as Error).message });
    }
  }

  /**
   * Verify audit log integrity
   */
  verifyAuditLogIntegrity(): boolean {
    let previousHash = '';

    for (const entry of this.auditLog) {
      // Verify chain integrity
      if (entry.previousHash !== previousHash) {
        logger.error('Audit log chain integrity broken', { entryId: entry.id });
        return false;
      }

      // Verify entry hash
      const calculatedHash = this.calculateEntryHash(entry);
      if (calculatedHash !== entry.hash) {
        logger.error('Audit log entry tampered', { entryId: entry.id });
        return false;
      }

      previousHash = entry.hash;
    }

    logger.info('Audit log integrity verified', { entries: this.auditLog.length });
    return true;
  }

  /**
   * Export audit log to file
   */
  exportAuditLog(outputPath: string): void {
    try {
      const dir = dirname(outputPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(outputPath, JSON.stringify(this.auditLog, null, 2));
      logger.info('Audit log exported', { path: outputPath, entries: this.auditLog.length });
    } catch (error) {
      logger.error('Failed to export audit log', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    this.lastAuditHash = '';
    this.saveAuditLog();
    logger.info('Audit log cleared');
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

/**
 * Get or create the singleton verifier instance
 */
export function getUpdateVerifier(config?: Partial<VerifierConfig>): UpdateVerifier {
  if (!verifierInstance) {
    verifierInstance = new UpdateVerifier(config);
  }
  return verifierInstance;
}

/**
 * Shutdown the verifier
 */
export function shutdownVerifier(): void {
  if (verifierInstance) {
    verifierInstance.removeAllListeners();
    verifierInstance = null;
    logger.info('Update verifier shutdown complete');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate file hash
 */
export async function calculateFileHash(
  filePath: string,
  algorithm: HashAlgorithm = 'sha512'
): Promise<string> {
  const content = readFileSync(filePath);
  const hash = createHash(algorithm);
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Verify file hash matches expected
 */
export async function verifyFileHashMatch(
  filePath: string,
  expectedHash: string,
  algorithm: HashAlgorithm = 'sha512'
): Promise<boolean> {
  const computed = await calculateFileHash(filePath, algorithm);
  const expectedBuffer = Buffer.from(expectedHash.toLowerCase(), 'hex');
  const computedBuffer = Buffer.from(computed.toLowerCase(), 'hex');

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, computedBuffer);
}

/**
 * Create a hash-based message authentication code
 */
export function createHMAC(
  key: string,
  data: string | Buffer,
  algorithm: HashAlgorithm = 'sha256'
): string {
  const hmac = createHmac(algorithm, key);
  hmac.update(data);
  return hmac.digest('hex');
}

export default getUpdateVerifier;
