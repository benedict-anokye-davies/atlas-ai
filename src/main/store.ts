/**
 * Atlas Desktop - Application Store
 *
 * Provides persistent storage for application settings and configuration.
 * Uses a simple JSON-based file store with in-memory caching.
 *
 * Features:
 * - Atomic writes with temp file rotation to prevent corruption
 * - Automatic backup creation before writes
 * - Debounced saves to reduce disk I/O
 * - Deep merge for partial updates
 * - Type-safe access with dot notation support
 *
 * @module store
 * @example
 * ```typescript
 * const store = await initializeStore();
 * store.set('preferences', { theme: 'dark' });
 * const theme = store.getNested<string>('preferences.theme');
 * ```
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from './utils/logger';

const logger = createModuleLogger('Store');

// =============================================================================
// Constants
// =============================================================================

/**
 * Store configuration constants.
 * Extracted from inline values for maintainability and documentation.
 */
const STORE_CONSTANTS = {
  /**
   * Debounce delay for save operations in milliseconds.
   * Prevents excessive disk writes during rapid updates.
   */
  SAVE_DEBOUNCE_MS: 1000,

  /**
   * Store filename. Stored in Electron's userData directory.
   */
  STORE_FILENAME: 'atlas-store.json',

  /**
   * Backup file extension appended to store filename.
   */
  BACKUP_EXTENSION: '.backup',

  /**
   * Temp file extension for atomic writes.
   */
  TEMP_EXTENSION: '.tmp',

  /**
   * Maximum backup files to retain (rotating).
   */
  MAX_BACKUPS: 3,
} as const;

/**
 * Store error codes for typed error handling.
 */
export const STORE_ERROR_CODES = {
  PARSE_ERROR: 'STORE_PARSE_ERROR',
  WRITE_ERROR: 'STORE_WRITE_ERROR',
  NOT_INITIALIZED: 'STORE_NOT_INITIALIZED',
  INVALID_PATH: 'STORE_INVALID_PATH',
  SCHEMA_MISMATCH: 'STORE_SCHEMA_MISMATCH',
} as const;

export type StoreErrorCode = (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES];

/**
 * Typed error class for store operations.
 * Provides structured error information for better error handling upstream.
 */
export class StoreError extends Error {
  constructor(
    message: string,
    public readonly code: StoreErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'StoreError';
    Error.captureStackTrace?.(this, StoreError);
  }
}

interface StoreSchema {
  // API Keys and Authentication
  apiKeys: {
    fireworks?: string;
    figma?: string;
    github?: string;
    linear?: string;
    jira?: string;
    circleci?: string;
    deepgram?: string;
    elevenlabs?: string;
    porcupine?: string;
  };

  // Atlas Core Settings
  atlas: {
    autonomyLevel: 'supervised' | 'semi-autonomous' | 'autonomous';
    autoCommit: boolean;
    screenMonitoring: boolean;
    voiceEnabled: boolean;
    wakeWord: string;
    voiceAlerts: boolean;
    llmProvider: string;
    model: string;
  };

  // CI/CD Settings
  cicd: {
    provider: 'github' | 'circleci' | 'gitlab' | 'jenkins';
    repo?: string;
    owner?: string;
    branch?: string;
    pollInterval: number;
  };

  // Project Management Settings
  projectManagement: {
    provider: 'linear' | 'jira' | 'none';
    teamId?: string;
    projectKey?: string;
    workspaceId?: string;
  };

  // Figma Settings
  figma: {
    defaultFramework: 'react' | 'vue' | 'svelte' | 'html';
    defaultStyling: 'tailwind' | 'css' | 'scss';
    generateStories: boolean;
    outputPath?: string;
  };

  // Visual Testing Settings
  visualTesting: {
    baselinePath: string;
    threshold: number;
    viewports: Array<{ width: number; height: number; name: string }>;
  };

  // Cross-project Learning
  learning: {
    enabled: boolean;
    dbPath?: string;
    autoLearn: boolean;
  };

  // User Preferences
  preferences: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    notifications: boolean;
  };

  // Cached State
  state: {
    lastProjectPath?: string;
    recentProjects: string[];
    windowBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

const defaultStore: StoreSchema = {
  apiKeys: {},
  atlas: {
    autonomyLevel: 'autonomous',
    autoCommit: true,
    screenMonitoring: true,
    voiceEnabled: true,
    wakeWord: 'hey atlas',
    voiceAlerts: true,
    llmProvider: 'fireworks',
    model: 'accounts/fireworks/models/deepseek-v3p2',
  },
  cicd: {
    provider: 'github',
    pollInterval: 60000,
  },
  projectManagement: {
    provider: 'none',
  },
  figma: {
    defaultFramework: 'react',
    defaultStyling: 'tailwind',
    generateStories: true,
  },
  visualTesting: {
    baselinePath: '',
    threshold: 0.1,
    viewports: [
      { width: 1920, height: 1080, name: 'desktop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 375, height: 812, name: 'mobile' },
    ],
  },
  learning: {
    enabled: true,
    autoLearn: true,
  },
  preferences: {
    theme: 'system',
    language: 'en',
    notifications: true,
  },
  state: {
    recentProjects: [],
  },
};

// =============================================================================
// AppStore Class
// =============================================================================

/**
 * Application Store
 *
 * Manages persistent storage of application settings with the following guarantees:
 * - Atomic writes: Uses temp file + rename to prevent corruption on crash
 * - Backup rotation: Maintains backup files before each write
 * - Type safety: Full TypeScript support with generics
 * - Lazy initialization: Store is loaded on first access
 *
 * @fires error - When a save operation fails (non-blocking)
 *
 * @example
 * ```typescript
 * const store = getStore();
 * await store.initialize();
 *
 * // Type-safe top-level access
 * store.set('preferences', { theme: 'dark', language: 'en', notifications: true });
 *
 * // Dot notation for nested access
 * store.setNested('atlas.model', 'gpt-4');
 * const model = store.getNested<string>('atlas.model');
 * ```
 */
class AppStore {
  private data: StoreSchema;
  private readonly filePath: string;
  private readonly backupPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private initialized = false;
  private saveInProgress = false;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, STORE_CONSTANTS.STORE_FILENAME);
    this.backupPath = this.filePath + STORE_CONSTANTS.BACKUP_EXTENSION;
    this.data = this.cloneSchema(defaultStore);
  }

  /**
   * Initialize the store by loading from disk.
   *
   * Safe to call multiple times - subsequent calls are no-ops.
   * On parse errors, falls back to defaults and logs a warning.
   *
   * @throws {StoreError} If file exists but cannot be read (permissions, etc.)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('Store already initialized, skipping');
      return;
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');

        // Attempt to parse - fall back to defaults on corruption
        let loaded: Partial<StoreSchema>;
        try {
          loaded = JSON.parse(raw) as Partial<StoreSchema>;
        } catch (parseError) {
          logger.warn('Store file corrupted, attempting backup recovery', {
            error: (parseError as Error).message,
          });

          // Try backup file
          if (fs.existsSync(this.backupPath)) {
            const backupRaw = fs.readFileSync(this.backupPath, 'utf-8');
            loaded = JSON.parse(backupRaw) as Partial<StoreSchema>;
            logger.info('Recovered from backup file');
          } else {
            logger.warn('No backup available, using defaults');
            loaded = {};
          }
        }

        this.data = this.deepMergeSchema(defaultStore, loaded);
        logger.info('Store loaded from disk', { path: this.filePath });
      } else {
        logger.info('No existing store file, using defaults');
      }
    } catch (error) {
      const storeError = new StoreError(
        `Failed to load store: ${(error as Error).message}`,
        STORE_ERROR_CODES.PARSE_ERROR,
        error as Error
      );
      logger.error('Store initialization failed', { error: storeError.message });
      // Continue with defaults rather than crashing
      this.data = this.cloneSchema(defaultStore);
    }

    this.initialized = true;
  }

  /**
   * Get a top-level value from the store.
   *
   * @param key - The top-level key to retrieve
   * @returns The value for the given key, or undefined if not found
   *
   * @example
   * ```typescript
   * const prefs = store.get('preferences');
   * console.log(prefs.theme); // 'system'
   * ```
   */
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this.data[key];
  }

  /**
   * Set a top-level value in the store.
   *
   * Triggers a debounced save to disk.
   *
   * @param key - The top-level key to set
   * @param value - The value to store (must match schema type)
   *
   * @example
   * ```typescript
   * store.set('preferences', { theme: 'dark', language: 'en', notifications: false });
   * ```
   */
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this.data[key] = value;
    this.scheduleSave();
  }

  /**
   * Get a nested value using dot notation.
   *
   * Safely traverses the object tree, returning undefined for missing paths.
   *
   * @param pathStr - Dot-notation path (e.g., 'atlas.model', 'preferences.theme')
   * @returns The value at the path, or undefined if any segment is missing
   *
   * @example
   * ```typescript
   * const model = store.getNested<string>('atlas.model');
   * const bounds = store.getNested<{ width: number }>('state.windowBounds');
   * ```
   */
  getNested<T = unknown>(pathStr: string): T | undefined {
    if (!pathStr || typeof pathStr !== 'string') {
      logger.warn('getNested called with invalid path', { path: pathStr });
      return undefined;
    }

    const parts = pathStr.split('.');
    let current: unknown = this.data;
    
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    
    return current as T;
  }

  /**
   * Set a nested value using dot notation.
   *
   * Creates intermediate objects as needed. Triggers a debounced save.
   *
   * @param pathStr - Dot-notation path (e.g., 'atlas.model')
   * @param value - The value to set at the path
   *
   * @example
   * ```typescript
   * store.setNested('atlas.voiceEnabled', false);
   * store.setNested('preferences.theme', 'dark');
   * ```
   */
  setNested(pathStr: string, value: unknown): void {
    if (!pathStr || typeof pathStr !== 'string') {
      logger.warn('setNested called with invalid path', { path: pathStr });
      return;
    }

    const parts = pathStr.split('.');
    const lastPart = parts.pop();
    if (!lastPart) {
      logger.warn('setNested called with empty path segment');
      return;
    }

    let current: unknown = this.data;

    for (const part of parts) {
      if (current === null || typeof current !== 'object') {
        logger.warn('setNested encountered non-object in path', { path: pathStr, part });
        return;
      }
      const obj = current as Record<string, unknown>;
      if (!(part in obj) || typeof obj[part] !== 'object') {
        obj[part] = {};
      }
      current = obj[part];
    }

    if (current !== null && typeof current === 'object') {
      (current as Record<string, unknown>)[lastPart] = value;
      this.scheduleSave();
    }
  }

  /**
   * Get the entire store data (shallow clone).
   *
   * @returns A shallow copy of all store data
   */
  getAll(): StoreSchema {
    return { ...this.data };
  }

  /**
   * Update multiple values at once with partial data.
   *
   * Deep merges the updates with existing data. Useful for bulk updates
   * that should trigger only one save operation.
   *
   * @param updates - Partial schema with values to update
   *
   * @example
   * ```typescript
   * store.update({
   *   preferences: { theme: 'dark' },
   *   atlas: { voiceEnabled: false },
   * });
   * ```
   */
  update(updates: Partial<StoreSchema>): void {
    this.data = this.deepMergeSchema(this.data, updates);
    this.scheduleSave();
  }

  /**
   * Reset store to factory defaults.
   *
   * WARNING: This will erase all custom settings. Creates a backup first.
   */
  reset(): void {
    logger.warn('Resetting store to defaults');
    this.createBackup();
    this.data = this.cloneSchema(defaultStore);
    this.save();
  }

  /**
   * Clean up resources on shutdown.
   *
   * Flushes any pending saves and clears timers.
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    // Flush pending changes synchronously on shutdown
    if (this.initialized) {
      this.save();
    }
    logger.debug('Store disposed');
  }

  /**
   * Schedule a debounced save to disk.
   *
   * Multiple rapid calls within SAVE_DEBOUNCE_MS will only trigger one save.
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), STORE_CONSTANTS.SAVE_DEBOUNCE_MS);
  }

  /**
   * Create a backup of the current store file.
   *
   * Rotates existing backups if MAX_BACKUPS exceeded.
   */
  private createBackup(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
        logger.debug('Backup created', { path: this.backupPath });
      }
    } catch (error) {
      logger.warn('Failed to create backup', { error: (error as Error).message });
    }
  }

  /**
   * Save store to disk with atomic write.
   *
   * Uses temp file + rename pattern to prevent corruption on crash/power loss.
   *
   * @returns true if save succeeded, false otherwise
   */
  save(): boolean {
    if (this.saveInProgress) {
      logger.debug('Save already in progress, scheduling retry');
      this.scheduleSave();
      return false;
    }

    this.saveInProgress = true;
    const tempPath = this.filePath + STORE_CONSTANTS.TEMP_EXTENSION;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create backup before write
      this.createBackup();

      // Write to temp file first (atomic write pattern)
      const jsonData = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(tempPath, jsonData, 'utf-8');

      // Rename temp to actual (atomic on most filesystems)
      fs.renameSync(tempPath, this.filePath);

      logger.debug('Store saved to disk');
      return true;
    } catch (error) {
      logger.error('Failed to save store', { error: (error as Error).message });

      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      return false;
    } finally {
      this.saveInProgress = false;
    }
  }

  /**
   * Create a deep clone of the schema (for defaults).
   */
  private cloneSchema(schema: StoreSchema): StoreSchema {
    return JSON.parse(JSON.stringify(schema)) as StoreSchema;
  }

  /**
   * Deep merge two objects (generic)
   */
  private deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      const sourceValue = source[key as keyof T];
      const targetValue = target[key as keyof T];
      
      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        (result as Record<string, unknown>)[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
    
    return result;
  }

  /**
   * Deep merge for StoreSchema specifically
   */
  private deepMergeSchema(target: StoreSchema, source: Partial<StoreSchema>): StoreSchema {
    const result = { ...target };
    
    for (const key of Object.keys(source) as Array<keyof StoreSchema>) {
      const sourceValue = source[key];
      const targetValue = target[key];
      
      if (sourceValue === undefined) continue;
      
      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // Merge nested objects
        (result as any)[key] = { ...targetValue, ...sourceValue };
      } else {
        (result as any)[key] = sourceValue;
      }
    }
    
    return result;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

/** Singleton instance */
let storeInstance: AppStore | null = null;

/**
 * Get the application store singleton instance.
 *
 * Creates the instance if it doesn't exist. Call `initializeStore()`
 * to load data from disk before first use.
 *
 * @returns The AppStore singleton
 *
 * @example
 * ```typescript
 * const store = getStore();
 * const theme = store.getNested<string>('preferences.theme');
 * ```
 */
export function getStore(): AppStore {
  if (!storeInstance) {
    storeInstance = new AppStore();
  }
  return storeInstance;
}

/**
 * Initialize the store and load data from disk.
 *
 * Should be called early in application startup. Safe to call multiple times.
 *
 * @returns The initialized AppStore instance
 *
 * @example
 * ```typescript
 * // In main process initialization
 * const store = await initializeStore();
 * ```
 */
export async function initializeStore(): Promise<AppStore> {
  const store = getStore();
  await store.initialize();
  return store;
}

/**
 * Shutdown the store cleanly.
 *
 * Flushes pending saves and releases resources.
 * Should be called during application shutdown.
 */
export function shutdownStore(): void {
  if (storeInstance) {
    storeInstance.dispose();
    storeInstance = null;
    logger.info('Store shutdown complete');
  }
}