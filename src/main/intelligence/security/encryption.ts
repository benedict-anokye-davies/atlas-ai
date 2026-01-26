/**
 * Intelligence Encryption Service
 * Secure data encryption and decryption
 */

import { createModuleLogger } from '../../utils/logger';
import {
  EncryptionConfig,
  EncryptedData,
  EncryptionKeyInfo,
  DEFAULT_ENCRYPTION_CONFIG,
  EncryptionAlgorithm,
} from './types';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('Encryption');

// ============================================================================
// ENCRYPTION SERVICE
// ============================================================================

export class EncryptionService extends EventEmitter {
  private config: EncryptionConfig;
  private masterKey: Buffer | null = null;
  private keyInfo: EncryptionKeyInfo | null = null;
  private dataKeys: Map<string, Buffer> = new Map();
  private initialized = false;

  constructor(config: Partial<EncryptionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  /**
   * Initialize with a master password
   */
  async initialize(masterPassword: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing encryption service...');

    // Derive master key from password
    const salt = crypto.randomBytes(this.config.saltLength);
    this.masterKey = await this.deriveKey(masterPassword, salt);

    this.keyInfo = {
      id: uuidv4(),
      createdAt: new Date(),
      algorithm: this.config.algorithm,
      purpose: 'master',
    };

    this.initialized = true;
    logger.info('Encryption service initialized');
  }

  /**
   * Initialize with an existing key (for app unlock)
   */
  async initializeWithKey(keyBuffer: Buffer, keyInfo: EncryptionKeyInfo): Promise<void> {
    this.masterKey = keyBuffer;
    this.keyInfo = keyInfo;
    this.initialized = true;
    logger.info('Encryption service initialized with existing key');
  }

  shutdown(): void {
    // Securely wipe keys from memory
    if (this.masterKey) {
      crypto.randomFillSync(this.masterKey);
      this.masterKey = null;
    }

    for (const key of this.dataKeys.values()) {
      crypto.randomFillSync(key);
    }
    this.dataKeys.clear();

    this.keyInfo = null;
    this.initialized = false;
    logger.info('Encryption service shut down');
  }

  // --------------------------------------------------------------------------
  // KEY DERIVATION
  // --------------------------------------------------------------------------

  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      switch (this.config.keyDerivation) {
        case 'pbkdf2':
          crypto.pbkdf2(
            password,
            salt,
            this.config.keyDerivationIterations,
            32,
            'sha256',
            (err, key) => {
              if (err) reject(err);
              else resolve(key);
            }
          );
          break;

        case 'scrypt':
          crypto.scrypt(
            password,
            salt,
            32,
            { N: 16384, r: 8, p: 1 },
            (err, key) => {
              if (err) reject(err);
              else resolve(key);
            }
          );
          break;

        default:
          // Fallback to pbkdf2
          crypto.pbkdf2(
            password,
            salt,
            this.config.keyDerivationIterations,
            32,
            'sha256',
            (err, key) => {
              if (err) reject(err);
              else resolve(key);
            }
          );
      }
    });
  }

  // --------------------------------------------------------------------------
  // ENCRYPTION
  // --------------------------------------------------------------------------

  /**
   * Encrypt data using the master key
   */
  encrypt(data: string | object): EncryptedData {
    if (!this.initialized || !this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    const plaintextBuffer = Buffer.from(plaintext, 'utf8');

    const iv = crypto.randomBytes(this.config.ivLength);
    const salt = crypto.randomBytes(this.config.saltLength);

    let ciphertext: Buffer;
    let tag: Buffer | undefined;

    switch (this.config.algorithm) {
      case 'aes-256-gcm': {
        const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
        ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
        tag = cipher.getAuthTag();
        break;
      }

      case 'aes-256-cbc': {
        const cipher = crypto.createCipheriv('aes-256-cbc', this.masterKey, iv);
        ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
        break;
      }

      default:
        throw new Error(`Unsupported algorithm: ${this.config.algorithm}`);
    }

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      tag: tag?.toString('base64'),
      algorithm: this.config.algorithm,
      version: 1,
    };
  }

  /**
   * Decrypt data using the master key
   */
  decrypt(encryptedData: EncryptedData): string {
    if (!this.initialized || !this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');

    let plaintext: Buffer;

    switch (encryptedData.algorithm) {
      case 'aes-256-gcm': {
        if (!encryptedData.tag) {
          throw new Error('Missing authentication tag for GCM mode');
        }
        const tag = Buffer.from(encryptedData.tag, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        break;
      }

      case 'aes-256-cbc': {
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.masterKey, iv);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        break;
      }

      default:
        throw new Error(`Unsupported algorithm: ${encryptedData.algorithm}`);
    }

    return plaintext.toString('utf8');
  }

  /**
   * Decrypt and parse as JSON
   */
  decryptObject<T = unknown>(encryptedData: EncryptedData): T {
    const decrypted = this.decrypt(encryptedData);
    return JSON.parse(decrypted);
  }

  // --------------------------------------------------------------------------
  // FIELD-LEVEL ENCRYPTION
  // --------------------------------------------------------------------------

  /**
   * Encrypt specific fields in an object
   */
  encryptFields<T extends object>(
    obj: T,
    fieldsToEncrypt: (keyof T)[]
  ): T & { _encrypted: string[] } {
    const result: any = { ...obj, _encrypted: [] };

    for (const field of fieldsToEncrypt) {
      if (obj[field] !== undefined && obj[field] !== null) {
        const encrypted = this.encrypt(obj[field] as any);
        result[field] = encrypted;
        result._encrypted.push(String(field));
      }
    }

    return result;
  }

  /**
   * Decrypt specific fields in an object
   */
  decryptFields<T extends object>(obj: T & { _encrypted?: string[] }): T {
    if (!obj._encrypted || obj._encrypted.length === 0) {
      return obj;
    }

    const result: any = { ...obj };
    delete result._encrypted;

    for (const field of obj._encrypted) {
      if (result[field] && typeof result[field] === 'object' && 'ciphertext' in result[field]) {
        result[field] = this.decryptObject(result[field] as EncryptedData);
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // KEY ROTATION
  // --------------------------------------------------------------------------

  /**
   * Generate a new data key
   */
  generateDataKey(purpose: string): { keyId: string; key: Buffer } {
    const keyId = uuidv4();
    const key = crypto.randomBytes(32);
    this.dataKeys.set(keyId, key);
    
    logger.info(`Generated data key: ${keyId} for ${purpose}`);
    this.emit('key-generated', { keyId, purpose });
    
    return { keyId, key };
  }

  /**
   * Rotate the master key
   */
  async rotateMasterKey(newPassword: string): Promise<{
    newKeyInfo: EncryptionKeyInfo;
    oldKeyInfo: EncryptionKeyInfo | null;
  }> {
    if (!this.initialized) {
      throw new Error('Encryption service not initialized');
    }

    const oldKeyInfo = this.keyInfo;

    // Generate new key
    const salt = crypto.randomBytes(this.config.saltLength);
    const newKey = await this.deriveKey(newPassword, salt);

    // Store old key temporarily
    const oldKey = this.masterKey;

    // Switch to new key
    this.masterKey = newKey;
    this.keyInfo = {
      id: uuidv4(),
      createdAt: new Date(),
      algorithm: this.config.algorithm,
      purpose: 'master',
    };

    // Wipe old key
    if (oldKey) {
      crypto.randomFillSync(oldKey);
    }

    logger.info('Master key rotated');
    this.emit('key-rotated', { newKeyInfo: this.keyInfo, oldKeyInfo });

    return {
      newKeyInfo: this.keyInfo,
      oldKeyInfo,
    };
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------

  /**
   * Hash data (one-way)
   */
  hash(data: string, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  /**
   * Hash with salt (for passwords)
   */
  hashWithSalt(
    data: string,
    salt?: string
  ): { hash: string; salt: string } {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .createHmac('sha256', actualSalt)
      .update(data)
      .digest('hex');
    return { hash, salt: actualSalt };
  }

  /**
   * Verify hashed data
   */
  verifyHash(data: string, hash: string, salt: string): boolean {
    const computed = crypto
      .createHmac('sha256', salt)
      .update(data)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  }

  /**
   * Generate a secure random token
   */
  generateToken(length = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Mask sensitive data
   */
  mask(data: string, visibleChars = 4, maskChar = '*'): string {
    if (data.length <= visibleChars * 2) {
      return maskChar.repeat(data.length);
    }
    const start = data.slice(0, visibleChars);
    const end = data.slice(-visibleChars);
    const maskLength = data.length - (visibleChars * 2);
    return `${start}${maskChar.repeat(maskLength)}${end}`;
  }

  /**
   * Redact sensitive data (completely remove)
   */
  redact(data: string): string {
    return '[REDACTED]';
  }

  // --------------------------------------------------------------------------
  // EXPORT / IMPORT
  // --------------------------------------------------------------------------

  /**
   * Export encryption key (encrypted with password)
   */
  async exportKey(exportPassword: string): Promise<{
    encryptedKey: EncryptedData;
    keyInfo: EncryptionKeyInfo;
  }> {
    if (!this.initialized || !this.masterKey || !this.keyInfo) {
      throw new Error('Encryption service not initialized');
    }

    // Derive export key
    const salt = crypto.randomBytes(this.config.saltLength);
    const exportKey = await this.deriveKey(exportPassword, salt);

    // Encrypt master key with export key
    const iv = crypto.randomBytes(this.config.ivLength);
    const cipher = crypto.createCipheriv('aes-256-gcm', exportKey, iv);
    const ciphertext = Buffer.concat([cipher.update(this.masterKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wipe export key
    crypto.randomFillSync(exportKey);

    logger.info('Master key exported');
    this.emit('key-exported', { keyId: this.keyInfo.id });

    return {
      encryptedKey: {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        tag: tag.toString('base64'),
        algorithm: 'aes-256-gcm',
        version: 1,
      },
      keyInfo: this.keyInfo,
    };
  }

  /**
   * Import encryption key
   */
  async importKey(
    encryptedKey: EncryptedData,
    keyInfo: EncryptionKeyInfo,
    importPassword: string
  ): Promise<void> {
    // Derive import key
    const salt = Buffer.from(encryptedKey.salt, 'base64');
    const importKey = await this.deriveKey(importPassword, salt);

    // Decrypt master key
    const iv = Buffer.from(encryptedKey.iv, 'base64');
    const ciphertext = Buffer.from(encryptedKey.ciphertext, 'base64');
    const tag = encryptedKey.tag ? Buffer.from(encryptedKey.tag, 'base64') : undefined;

    const decipher = crypto.createDecipheriv('aes-256-gcm', importKey, iv);
    if (tag) {
      decipher.setAuthTag(tag);
    }

    const masterKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Wipe import key
    crypto.randomFillSync(importKey);

    // Initialize with imported key
    await this.initializeWithKey(masterKey, keyInfo);

    logger.info('Master key imported');
    this.emit('key-imported', { keyId: keyInfo.id });
  }

  // --------------------------------------------------------------------------
  // STATUS
  // --------------------------------------------------------------------------

  getKeyInfo(): EncryptionKeyInfo | null {
    return this.keyInfo;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!instance) {
    instance = new EncryptionService();
  }
  return instance;
}
