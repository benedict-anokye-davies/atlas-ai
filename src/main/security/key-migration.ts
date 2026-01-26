/**
 * Atlas Desktop - API Key Migration
 * Migrates plaintext API keys from environment/.env to secure keychain storage
 *
 * Features:
 * - One-time migration on first run
 * - Backup of original .env file
 * - Migration status tracking
 * - Rollback capability
 *
 * @module security/key-migration
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getKeychainManager, type ApiKeyName } from './keychain';
import type { MigrationResult, MigrationStatus } from '../../shared/types/security';

const logger = createModuleLogger('KeyMigration');

/**
 * Mapping from env variable names to internal key names
 */
const ENV_TO_KEY_MAP: Record<string, ApiKeyName> = {
  PORCUPINE_API_KEY: 'PORCUPINE_API_KEY',
  DEEPGRAM_API_KEY: 'DEEPGRAM_API_KEY',
  ELEVENLABS_API_KEY: 'ELEVENLABS_API_KEY',
  FIREWORKS_API_KEY: 'FIREWORKS_API_KEY',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  PERPLEXITY_API_KEY: 'PERPLEXITY_API_KEY',
};

/**
 * Migration status file name
 */
const MIGRATION_STATUS_FILE = '.key-migration-status.json';

/**
 * Key Migration Manager
 * Handles one-time migration of API keys from plaintext to secure storage
 */
export class KeyMigrationManager {
  private statusFilePath: string;
  private envFilePath: string;
  private status: MigrationStatus | null = null;

  constructor() {
    // Determine paths
    const userDataPath = app?.getPath?.('userData') ?? process.cwd();
    this.statusFilePath = path.join(userDataPath, 'secure', MIGRATION_STATUS_FILE);
    this.envFilePath = path.join(process.cwd(), '.env');

    logger.info('KeyMigrationManager initialized', {
      statusPath: this.maskPath(this.statusFilePath),
    });
  }

  /**
   * Mask file path for logging
   */
  private maskPath(filePath: string): string {
    return `.../${path.basename(filePath)}`;
  }

  /**
   * Load migration status from file
   */
  private async loadStatus(): Promise<MigrationStatus> {
    if (this.status) {
      return this.status;
    }

    try {
      const content = await fs.readFile(this.statusFilePath, 'utf-8');
      this.status = JSON.parse(content);
      return this.status!;
    } catch {
      // No status file exists yet
      this.status = {
        migrated: false,
        migrationDate: null,
        migratedKeys: [],
        version: 1,
      };
      return this.status;
    }
  }

  /**
   * Save migration status to file
   */
  private async saveStatus(status: MigrationStatus): Promise<void> {
    this.status = status;

    // Ensure directory exists
    const dir = path.dirname(this.statusFilePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(this.statusFilePath, JSON.stringify(status, null, 2), { mode: 0o600 });
    logger.debug('Migration status saved');
  }

  /**
   * Check if migration has already been performed
   */
  async isMigrated(): Promise<boolean> {
    const status = await this.loadStatus();
    return status.migrated;
  }

  /**
   * Get current migration status
   */
  async getStatus(): Promise<MigrationStatus> {
    return this.loadStatus();
  }

  /**
   * Parse .env file and extract key-value pairs
   */
  private async parseEnvFile(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    if (!existsSync(this.envFilePath)) {
      logger.debug('.env file not found');
      return result;
    }

    try {
      const content = await fs.readFile(this.envFilePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Skip comments and empty lines
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        // Parse KEY=VALUE
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
          continue;
        }

        const key = trimmed.substring(0, equalIndex).trim();
        let value = trimmed.substring(equalIndex + 1).trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        result[key] = value;
      }

      logger.debug('Parsed .env file', { keyCount: Object.keys(result).length });
      return result;
    } catch (error) {
      logger.error('Failed to parse .env file', { error: (error as Error).message });
      return result;
    }
  }

  /**
   * Get API keys from environment variables (process.env)
   */
  private getEnvKeys(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const envKey of Object.keys(ENV_TO_KEY_MAP)) {
      const value = process.env[envKey];
      if (value && value.trim() !== '') {
        result[envKey] = value;
      }
    }

    return result;
  }

  /**
   * Create a backup of the .env file
   */
  private async backupEnvFile(): Promise<string | null> {
    if (!existsSync(this.envFilePath)) {
      return null;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.envFilePath}.backup-${timestamp}`;
      await fs.copyFile(this.envFilePath, backupPath);
      logger.info('Created .env backup', { backupPath: this.maskPath(backupPath) });
      return backupPath;
    } catch (error) {
      logger.error('Failed to backup .env file', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Remove API keys from .env file (optional, for security)
   */
  private async redactEnvFile(): Promise<boolean> {
    if (!existsSync(this.envFilePath)) {
      return true;
    }

    try {
      const content = await fs.readFile(this.envFilePath, 'utf-8');
      const lines = content.split('\n');
      const newLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // Check if this line contains an API key we're migrating
        let isApiKey = false;
        for (const envKey of Object.keys(ENV_TO_KEY_MAP)) {
          if (trimmed.startsWith(`${envKey}=`)) {
            // Comment out the key
            newLines.push(`# ${envKey}= (migrated to secure storage)`);
            isApiKey = true;
            break;
          }
        }

        if (!isApiKey) {
          newLines.push(line);
        }
      }

      await fs.writeFile(this.envFilePath, newLines.join('\n'));
      logger.info('Redacted API keys from .env file');
      return true;
    } catch (error) {
      logger.error('Failed to redact .env file', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Perform the migration
   */
  async migrate(options?: {
    redactEnvFile?: boolean;
    forceRemigrate?: boolean;
  }): Promise<MigrationResult> {
    const { redactEnvFile = false, forceRemigrate = false } = options ?? {};

    logger.info('Starting API key migration', { redactEnvFile, forceRemigrate });

    // Check if already migrated
    const status = await this.loadStatus();
    if (status.migrated && !forceRemigrate) {
      logger.info('Migration already completed');
      return {
        success: true,
        migratedKeys: status.migratedKeys,
        skippedKeys: [],
        errors: [],
        alreadyMigrated: true,
      };
    }

    const result: MigrationResult = {
      success: true,
      migratedKeys: [],
      skippedKeys: [],
      errors: [],
      alreadyMigrated: false,
    };

    try {
      // Collect keys from both .env file and process.env
      const envFileKeys = await this.parseEnvFile();
      const processEnvKeys = this.getEnvKeys();

      // Merge keys (process.env takes precedence)
      const allKeys = { ...envFileKeys, ...processEnvKeys };

      // Create backup if we're going to redact
      if (redactEnvFile && existsSync(this.envFilePath)) {
        result.backupPath = await this.backupEnvFile() ?? undefined;
      }

      // Migrate each key
      const keychain = getKeychainManager();

      for (const envKey of Object.keys(ENV_TO_KEY_MAP)) {
        const keyName = ENV_TO_KEY_MAP[envKey];
        const value = allKeys[envKey];

        if (!value || value.trim() === '') {
          result.skippedKeys.push(keyName);
          continue;
        }

        // Check if key already exists in keychain (unless force remigrating)
        if (!forceRemigrate && await keychain.hasKey(keyName)) {
          logger.debug('Key already in keychain, skipping', { keyName });
          result.skippedKeys.push(keyName);
          continue;
        }

        // Store in keychain
        const storeResult = await keychain.setKey(keyName, value);

        if (storeResult.success) {
          result.migratedKeys.push(keyName);
          logger.info('Migrated key to secure storage', {
            keyName,
            storage: storeResult.storage,
          });
        } else {
          result.errors.push(`Failed to migrate ${keyName}: ${storeResult.error}`);
          result.success = false;
        }
      }

      // Redact .env file if requested and migration was successful
      if (redactEnvFile && result.success && result.migratedKeys.length > 0) {
        await this.redactEnvFile();
      }

      // Save migration status
      await this.saveStatus({
        migrated: true,
        migrationDate: new Date().toISOString(),
        migratedKeys: result.migratedKeys,
        version: 1,
      });

      logger.info('Migration completed', {
        migrated: result.migratedKeys.length,
        skipped: result.skippedKeys.length,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;
      result.success = false;
      result.errors.push(`Migration failed: ${errorMessage}`);
      logger.error('Migration failed', { error: errorMessage });
      return result;
    }
  }

  /**
   * Rollback migration by restoring .env file from backup
   */
  async rollback(backupPath: string): Promise<boolean> {
    logger.warn('Rolling back migration', { backupPath });

    try {
      if (!existsSync(backupPath)) {
        logger.error('Backup file not found');
        return false;
      }

      // Restore .env file
      await fs.copyFile(backupPath, this.envFilePath);

      // Clear migrated keys from keychain
      const keychain = getKeychainManager();
      await keychain.clearAllKeys();

      // Reset migration status
      await this.saveStatus({
        migrated: false,
        migrationDate: null,
        migratedKeys: [],
        version: 1,
      });

      logger.info('Migration rolled back successfully');
      return true;
    } catch (error) {
      logger.error('Rollback failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Check if migration is needed (keys exist in env but not in keychain)
   */
  async needsMigration(): Promise<boolean> {
    // Check migration status first
    const status = await this.loadStatus();
    if (status.migrated) {
      return false;
    }

    // Check if any API keys exist in environment
    const envKeys = this.getEnvKeys();
    const envFileKeys = await this.parseEnvFile();
    const allKeys = { ...envFileKeys, ...envKeys };

    // Check if any of these are not yet in keychain
    const keychain = getKeychainManager();
    for (const envKey of Object.keys(ENV_TO_KEY_MAP)) {
      const value = allKeys[envKey];
      if (value && value.trim() !== '') {
        const keyName = ENV_TO_KEY_MAP[envKey];
        if (!(await keychain.hasKey(keyName))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Auto-migrate if needed (called on app startup)
   */
  async autoMigrate(): Promise<MigrationResult | null> {
    if (!(await this.needsMigration())) {
      logger.debug('No migration needed');
      return null;
    }

    logger.info('Auto-migration triggered');
    return this.migrate();
  }
}

// Singleton instance
let migrationManagerInstance: KeyMigrationManager | null = null;

/**
 * Get or create the singleton KeyMigrationManager instance
 */
export function getMigrationManager(): KeyMigrationManager {
  if (!migrationManagerInstance) {
    migrationManagerInstance = new KeyMigrationManager();
  }
  return migrationManagerInstance;
}

/**
 * Convenience function to perform auto-migration
 */
export async function autoMigrateKeys(): Promise<MigrationResult | null> {
  return getMigrationManager().autoMigrate();
}

/**
 * Convenience function to check migration status
 */
export async function getMigrationStatus(): Promise<MigrationStatus> {
  return getMigrationManager().getStatus();
}

/**
 * Convenience function to force migration
 */
export async function forceMigrateKeys(redactEnv?: boolean): Promise<MigrationResult> {
  return getMigrationManager().migrate({
    forceRemigrate: true,
    redactEnvFile: redactEnv,
  });
}

export default KeyMigrationManager;
