/**
 * Atlas Desktop - Keychain Manager
 * Secure API key storage using OS keychain with encrypted file fallback
 *
 * Features:
 * - Cross-platform OS keychain access (Windows Credential Manager, macOS Keychain, Linux Secret Service)
 * - Fallback encrypted file storage for systems without keychain
 * - AES-256-GCM encryption for fallback storage
 * - Safe key retrieval with no plaintext logging
 *
 * @module security/keychain
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import type { KeychainConfig, KeychainResult, StoredKeyInfo } from '../../shared/types/security';

/**
 * Keytar module interface (optional native dependency)
 * Provides cross-platform OS keychain access
 */
interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

const logger = createModuleLogger('Keychain');

/**
 * Service name for keychain entries
 */
const SERVICE_NAME = 'atlas-desktop';

/**
 * Encryption algorithm for fallback storage
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Salt length for key derivation
 */
const SALT_LENGTH = 32;

/**
 * IV length for AES-GCM
 */
const IV_LENGTH = 16;

// Note: Auth tag is included in cipher output automatically

/**
 * Supported API key names
 */
export const SUPPORTED_API_KEYS = [
  'PORCUPINE_API_KEY',
  'DEEPGRAM_API_KEY',
  'CARTESIA_API_KEY',
  'ELEVENLABS_API_KEY',
  'FIREWORKS_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'SPOTIFY_CLIENT_ID',
] as const;

export type ApiKeyName = (typeof SUPPORTED_API_KEYS)[number];

/**
 * Default keychain configuration
 */
const DEFAULT_CONFIG: KeychainConfig = {
  useOsKeychain: true,
  fallbackPath: undefined, // Will be set based on app path
  encryptionKeySource: 'machine',
};

/**
 * Keychain Manager
 * Provides secure storage for API keys using OS keychain or encrypted file fallback
 */
export class KeychainManager {
  private config: KeychainConfig;
  private fallbackPath: string;
  private keytarModule: KeytarModule | null = null;
  private keytarAvailable: boolean | null = null;
  private encryptionKey: Buffer | null = null;

  constructor(config?: Partial<KeychainConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Determine fallback path
    const userDataPath = app?.getPath?.('userData') ?? process.cwd();
    this.fallbackPath = this.config.fallbackPath ?? path.join(userDataPath, 'secure', 'keys.enc');

    logger.info('KeychainManager initialized', {
      useOsKeychain: this.config.useOsKeychain,
      fallbackPath: this.maskPath(this.fallbackPath),
    });
  }

  /**
   * Mask file path for logging (show only filename)
   */
  private maskPath(filePath: string): string {
    return `.../${path.basename(filePath)}`;
  }

  /**
   * Load keytar module dynamically
   * Returns null if keytar is not available
   */
  private async loadKeytar(): Promise<KeytarModule | null> {
    if (this.keytarModule !== null) {
      return this.keytarModule;
    }

    if (this.keytarAvailable === false) {
      return null;
    }

    try {
      // Dynamically import keytar using require to avoid TypeScript compilation issues
      // Note: keytar must be installed as an optional native dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const keytar = require('keytar') as KeytarModule;
      this.keytarModule = keytar;
      this.keytarAvailable = true;
      logger.debug('keytar module loaded successfully');
      return this.keytarModule;
    } catch (error) {
      this.keytarAvailable = false;
      logger.warn('keytar not available, using fallback encrypted storage', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Get or derive the encryption key for fallback storage
   */
  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Derive a machine-specific key using multiple entropy sources
    const machineId = await this.getMachineIdentifier();
    const salt = await this.getOrCreateSalt();

    // Use scrypt for key derivation (memory-hard, resistant to ASIC attacks)
    this.encryptionKey = scryptSync(machineId, salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    });

    return this.encryptionKey;
  }

  /**
   * Get machine-specific identifier for key derivation
   */
  private async getMachineIdentifier(): Promise<string> {
    const os = await import('os');
    const crypto = await import('crypto');

    // Combine multiple machine-specific values
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.homedir(),
      process.env.USERNAME || process.env.USER || 'atlas',
    ];

    // Hash the combined components
    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  }

  /**
   * Get or create salt for key derivation
   */
  private async getOrCreateSalt(): Promise<Buffer> {
    const saltPath = path.join(path.dirname(this.fallbackPath), '.salt');

    try {
      const saltHex = await fs.readFile(saltPath, 'utf-8');
      return Buffer.from(saltHex, 'hex');
    } catch {
      // Create new salt
      const salt = randomBytes(SALT_LENGTH);
      await this.ensureDirectory(saltPath);
      await fs.writeFile(saltPath, salt.toString('hex'), { mode: 0o600 });
      return salt;
    }
  }

  /**
   * Ensure directory exists for a file path
   */
  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private async encrypt(plaintext: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private async decrypt(encryptedData: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Read encrypted fallback storage
   */
  private async readFallbackStorage(): Promise<Record<string, string>> {
    try {
      const encryptedContent = await fs.readFile(this.fallbackPath, 'utf-8');
      const decrypted = await this.decrypt(encryptedContent);
      return JSON.parse(decrypted);
    } catch {
      return {};
    }
  }

  /**
   * Write encrypted fallback storage
   */
  private async writeFallbackStorage(data: Record<string, string>): Promise<void> {
    await this.ensureDirectory(this.fallbackPath);
    const encrypted = await this.encrypt(JSON.stringify(data));
    await fs.writeFile(this.fallbackPath, encrypted, { mode: 0o600 });
  }

  /**
   * Store a key in the keychain
   */
  async setKey(keyName: ApiKeyName, value: string): Promise<KeychainResult> {
    if (!value || value.trim() === '') {
      return {
        success: false,
        error: 'Cannot store empty key value',
      };
    }

    // Never log the actual key value
    logger.debug('Storing API key', { keyName, valueLength: value.length });

    try {
      // Try OS keychain first if enabled
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        if (keytar) {
          await keytar.setPassword(SERVICE_NAME, keyName, value);
          logger.info('API key stored in OS keychain', { keyName });
          return { success: true, storage: 'keychain' };
        }
      }

      // Fallback to encrypted file storage
      const storage = await this.readFallbackStorage();
      storage[keyName] = value;
      await this.writeFallbackStorage(storage);

      logger.info('API key stored in encrypted fallback', { keyName });
      return { success: true, storage: 'fallback' };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to store API key', { keyName, error: errorMessage });
      return {
        success: false,
        error: `Failed to store key: ${errorMessage}`,
      };
    }
  }

  /**
   * Retrieve a key from the keychain
   */
  async getKey(keyName: ApiKeyName): Promise<string | null> {
    logger.debug('Retrieving API key', { keyName });

    try {
      // Try OS keychain first if enabled
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        if (keytar) {
          const value = await keytar.getPassword(SERVICE_NAME, keyName);
          if (value) {
            logger.debug('API key retrieved from OS keychain', { keyName });
            return value;
          }
        }
      }

      // Try fallback storage
      const storage = await this.readFallbackStorage();
      const value = storage[keyName];

      if (value) {
        logger.debug('API key retrieved from encrypted fallback', { keyName });
        return value;
      }

      logger.debug('API key not found', { keyName });
      return null;
    } catch (error) {
      logger.error('Failed to retrieve API key', {
        keyName,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Delete a key from the keychain
   */
  async deleteKey(keyName: ApiKeyName): Promise<KeychainResult> {
    logger.debug('Deleting API key', { keyName });

    let keychainDeleted = false;
    let fallbackDeleted = false;

    try {
      // Try to delete from OS keychain
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        if (keytar) {
          keychainDeleted = await keytar.deletePassword(SERVICE_NAME, keyName);
        }
      }

      // Delete from fallback storage
      const storage = await this.readFallbackStorage();
      if (keyName in storage) {
        delete storage[keyName];
        await this.writeFallbackStorage(storage);
        fallbackDeleted = true;
      }

      if (keychainDeleted || fallbackDeleted) {
        logger.info('API key deleted', {
          keyName,
          fromKeychain: keychainDeleted,
          fromFallback: fallbackDeleted,
        });
        return { success: true };
      }

      return { success: true }; // Key didn't exist, but that's not an error
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to delete API key', { keyName, error: errorMessage });
      return {
        success: false,
        error: `Failed to delete key: ${errorMessage}`,
      };
    }
  }

  /**
   * List all stored keys (names only, not values)
   */
  async listKeys(): Promise<StoredKeyInfo[]> {
    logger.debug('Listing stored API keys');

    const keys: StoredKeyInfo[] = [];

    try {
      // Check OS keychain
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        if (keytar) {
          const credentials = await keytar.findCredentials(SERVICE_NAME);
          for (const cred of credentials) {
            if (SUPPORTED_API_KEYS.includes(cred.account as ApiKeyName)) {
              keys.push({
                name: cred.account as ApiKeyName,
                storage: 'keychain',
                hasValue: true,
              });
            }
          }
        }
      }

      // Check fallback storage
      const storage = await this.readFallbackStorage();
      for (const keyName of SUPPORTED_API_KEYS) {
        if (keyName in storage) {
          // Check if already found in keychain
          const existing = keys.find((k) => k.name === keyName);
          if (existing) {
            existing.storage = 'both';
          } else {
            keys.push({
              name: keyName,
              storage: 'fallback',
              hasValue: true,
            });
          }
        }
      }

      logger.debug('Listed stored API keys', { count: keys.length });
      return keys;
    } catch (error) {
      logger.error('Failed to list API keys', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Check if a specific key exists
   */
  async hasKey(keyName: ApiKeyName): Promise<boolean> {
    const value = await this.getKey(keyName);
    return value !== null && value.length > 0;
  }

  /**
   * Clear all stored keys (for app uninstall/reset)
   */
  async clearAllKeys(): Promise<KeychainResult> {
    logger.warn('Clearing all stored API keys');

    const errors: string[] = [];

    try {
      // Clear from OS keychain
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        if (keytar) {
          for (const keyName of SUPPORTED_API_KEYS) {
            try {
              await keytar.deletePassword(SERVICE_NAME, keyName);
            } catch {
              // Ignore individual delete failures
            }
          }
        }
      }

      // Clear fallback storage by overwriting with empty object
      await this.writeFallbackStorage({});

      // Delete the salt file (makes old encrypted data unrecoverable)
      const saltPath = path.join(path.dirname(this.fallbackPath), '.salt');
      try {
        await fs.unlink(saltPath);
      } catch {
        // Salt file might not exist
      }

      // Clear in-memory encryption key
      if (this.encryptionKey) {
        this.encryptionKey.fill(0);
        this.encryptionKey = null;
      }

      logger.info('All API keys cleared');
      return { success: true };
    } catch (error) {
      const errorMessage = (error as Error).message;
      errors.push(errorMessage);
      logger.error('Failed to clear all API keys', { error: errorMessage });
      return {
        success: false,
        error: `Failed to clear keys: ${errors.join(', ')}`,
      };
    }
  }

  /**
   * Check keychain health and availability
   */
  async checkHealth(): Promise<{
    keychainAvailable: boolean;
    fallbackAvailable: boolean;
    keysStored: number;
  }> {
    let keychainAvailable = false;
    let fallbackAvailable = false;

    try {
      // Check keytar availability
      if (this.config.useOsKeychain) {
        const keytar = await this.loadKeytar();
        keychainAvailable = keytar !== null;
      }

      // Check fallback storage
      try {
        await this.ensureDirectory(this.fallbackPath);
        fallbackAvailable = true;
      } catch {
        fallbackAvailable = false;
      }

      const keys = await this.listKeys();

      return {
        keychainAvailable,
        fallbackAvailable,
        keysStored: keys.length,
      };
    } catch (error) {
      logger.error('Health check failed', { error: (error as Error).message });
      return {
        keychainAvailable: false,
        fallbackAvailable: false,
        keysStored: 0,
      };
    }
  }

  /**
   * Get a masked version of a key for display purposes
   */
  async getMaskedKey(keyName: ApiKeyName): Promise<string | null> {
    const value = await this.getKey(keyName);
    if (!value) {
      return null;
    }

    // Show only last 4 characters
    if (value.length <= 4) {
      return '****';
    }

    return '***' + value.slice(-4);
  }
}

// Singleton instance
let keychainInstance: KeychainManager | null = null;

/**
 * Get or create the singleton KeychainManager instance
 */
export function getKeychainManager(config?: Partial<KeychainConfig>): KeychainManager {
  if (!keychainInstance) {
    keychainInstance = new KeychainManager(config);
  }
  return keychainInstance;
}

/**
 * Convenience function to get a key
 */
export async function getApiKey(keyName: ApiKeyName): Promise<string | null> {
  return getKeychainManager().getKey(keyName);
}

/**
 * Convenience function to set a key
 */
export async function setApiKey(keyName: ApiKeyName, value: string): Promise<KeychainResult> {
  return getKeychainManager().setKey(keyName, value);
}

/**
 * Convenience function to delete a key
 */
export async function deleteApiKey(keyName: ApiKeyName): Promise<KeychainResult> {
  return getKeychainManager().deleteKey(keyName);
}

/**
 * Convenience function to clear all keys
 */
export async function clearAllApiKeys(): Promise<KeychainResult> {
  return getKeychainManager().clearAllKeys();
}

export default KeychainManager;
