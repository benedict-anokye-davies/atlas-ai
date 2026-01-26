/**
 * Atlas Desktop - Updater Types
 * Type definitions for the auto-update system
 */

/**
 * Update status states
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/**
 * Information about an available update
 */
export interface UpdateInfo {
  /** New version number (semver) */
  version: string;
  /** Array of files to download */
  files: UpdateFile[];
  /** Path to release notes (usually markdown) */
  releaseNotes?: string | ReleaseNoteInfo[] | null;
  /** Release name */
  releaseName?: string | null;
  /** Release date (ISO string) */
  releaseDate: string;
  /** SHA512 hash for verification */
  sha512?: string;
  /** Staging percentage (0-100 for staged rollouts) */
  stagingPercentage?: number;
}

/**
 * Release note information for multi-section notes
 */
export interface ReleaseNoteInfo {
  /** Version this note applies to */
  version: string;
  /** Note content (may be markdown) */
  note: string;
}

/**
 * Update file information
 */
export interface UpdateFile {
  /** File URL */
  url: string;
  /** File size in bytes */
  size?: number;
  /** Block map size for differential updates */
  blockMapSize?: number;
  /** SHA512 hash */
  sha512?: string;
  /** Whether this is a block map file */
  isAdminRightsRequired?: boolean;
}

/**
 * Download progress information
 */
export interface UpdateProgress {
  /** Total bytes to download */
  total: number;
  /** Bytes downloaded so far */
  transferred: number;
  /** Download percentage (0-100) */
  percent: number;
  /** Bytes per second */
  bytesPerSecond: number;
  /** Estimated time remaining in seconds */
  eta?: number;
}

/**
 * Update error information
 */
export interface UpdateError {
  /** Error message */
  message: string;
  /** Error code (e.g., 'ERR_NETWORK', 'ERR_CHECKSUM') */
  code?: string;
  /** Stack trace for debugging */
  stack?: string;
  /** Whether the error is recoverable */
  recoverable: boolean;
}

/**
 * Complete update state
 */
export interface UpdateState {
  /** Current status */
  status: UpdateStatus;
  /** Available update info (if any) */
  updateInfo: UpdateInfo | null;
  /** Download progress (if downloading) */
  progress: UpdateProgress | null;
  /** Error info (if error occurred) */
  error: UpdateError | null;
  /** Last check timestamp (ISO string) */
  lastCheck: string | null;
  /** Whether update is ready to install */
  readyToInstall: boolean;
  /** Current app version */
  currentVersion: string;
}

/**
 * Updater configuration options
 */
export interface UpdaterConfig {
  /** Whether auto-update is enabled */
  enabled: boolean;
  /** Check interval in milliseconds (default: 4 hours) */
  checkInterval: number;
  /** Whether to download updates automatically */
  autoDownload: boolean;
  /** Whether to install updates on quit */
  autoInstallOnQuit: boolean;
  /** Whether to allow downgrades (mainly for testing) */
  allowDowngrade: boolean;
  /** Whether to allow prereleases */
  allowPrerelease: boolean;
  /** Update channel (stable, beta, alpha) */
  channel: 'stable' | 'beta' | 'alpha';
}

/**
 * IPC result type for updater operations
 */
export interface UpdaterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Events emitted by the updater
 */
export interface UpdaterEvents {
  'checking-for-update': void;
  'update-available': UpdateInfo;
  'update-not-available': UpdateInfo;
  'download-progress': UpdateProgress;
  'update-downloaded': UpdateInfo;
  'error': UpdateError;
  'update-cancelled': void;
}

/**
 * Rollback information for failed updates
 */
export interface RollbackInfo {
  /** Previous version that can be rolled back to */
  previousVersion: string;
  /** Path to backup files */
  backupPath: string;
  /** Timestamp of rollback creation */
  createdAt: string;
  /** Whether rollback is available */
  available: boolean;
}
