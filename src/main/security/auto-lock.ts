/**
 * Atlas Desktop - Auto-Lock Security Manager
 * Provides automatic locking after idle time with optional biometric/password unlock
 *
 * Features:
 * - Lock after configurable idle time
 * - Require password/biometric to unlock
 * - Lock sensitive operations only option
 * - Voice command: "Lock Atlas"
 * - Quick unlock shortcut
 * - Lock on system lock
 * - Notification before locking
 *
 * @module security/auto-lock
 */

import { EventEmitter } from 'events';
import {
  powerMonitor,
  systemPreferences,
  BrowserWindow,
  globalShortcut,
  Notification,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { randomBytes, scryptSync } from 'crypto';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';

const logger = createModuleLogger('AutoLock');

// ============================================================================
// Types
// ============================================================================

/**
 * Lock level determines what gets locked
 */
export type LockLevel = 'full' | 'sensitive_only' | 'none';

/**
 * Unlock method types
 */
export type UnlockMethod = 'password' | 'biometric' | 'pin' | 'none';

/**
 * Auto-lock configuration
 */
export interface AutoLockConfig {
  /** Whether auto-lock is enabled */
  enabled: boolean;

  /** Idle time before locking (in milliseconds) */
  idleTimeoutMs: number;

  /** Time to show warning before locking (in milliseconds) */
  warningTimeMs: number;

  /** Lock level to apply */
  lockLevel: LockLevel;

  /** Unlock method to use */
  unlockMethod: UnlockMethod;

  /** Lock when system locks/sleeps */
  lockOnSystemLock: boolean;

  /** Lock when display turns off */
  lockOnDisplayOff: boolean;

  /** Quick unlock keyboard shortcut (e.g., 'CommandOrControl+Shift+U') */
  unlockShortcut: string;

  /** Quick lock keyboard shortcut (e.g., 'CommandOrControl+Shift+L') */
  lockShortcut: string;

  /** Enable voice command "Lock Atlas" */
  enableVoiceLock: boolean;

  /** Show notification before locking */
  showLockNotification: boolean;

  /** Auto-lock after failed unlock attempts */
  maxUnlockAttempts: number;

  /** Lockout duration after max failed attempts (in milliseconds) */
  lockoutDurationMs: number;

  /** Operations that require unlock when in 'sensitive_only' mode */
  sensitiveOperations: string[];
}

/**
 * Default auto-lock configuration
 */
export const DEFAULT_AUTO_LOCK_CONFIG: AutoLockConfig = {
  enabled: true,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  warningTimeMs: 30 * 1000, // 30 seconds warning
  lockLevel: 'full',
  unlockMethod: 'password',
  lockOnSystemLock: true,
  lockOnDisplayOff: true,
  unlockShortcut: 'CommandOrControl+Shift+U',
  lockShortcut: 'CommandOrControl+Shift+L',
  enableVoiceLock: true,
  showLockNotification: true,
  maxUnlockAttempts: 5,
  lockoutDurationMs: 5 * 60 * 1000, // 5 minute lockout
  sensitiveOperations: [
    'terminal_execute',
    'file_delete',
    'file_write',
    'system_settings',
    'browser_automation',
    'git_push',
    'api_key_access',
    'memory_clear',
  ],
};

/**
 * Lock state information
 */
export interface LockState {
  /** Whether the system is locked */
  isLocked: boolean;

  /** Current lock level */
  lockLevel: LockLevel;

  /** When the lock was activated */
  lockedAt: number | null;

  /** Number of failed unlock attempts */
  failedAttempts: number;

  /** Whether currently in lockout */
  isLockedOut: boolean;

  /** When lockout ends (if in lockout) */
  lockoutEndsAt: number | null;

  /** Session ID of who locked */
  lockedBySession: string | null;

  /** Lock reason */
  lockReason: LockReason;
}

/**
 * Reason for locking
 */
export type LockReason =
  | 'idle_timeout'
  | 'manual_lock'
  | 'voice_command'
  | 'system_lock'
  | 'display_off'
  | 'failed_attempts'
  | 'app_start';

/**
 * Unlock result
 */
export interface UnlockResult {
  /** Whether unlock was successful */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Remaining attempts if failed */
  remainingAttempts?: number;

  /** Lockout time remaining if locked out */
  lockoutRemainingMs?: number;
}

/**
 * Events emitted by AutoLockManager
 */
export interface AutoLockEvents {
  /** Emitted when lock state changes */
  'lock-state-changed': (state: LockState) => void;

  /** Emitted before locking (warning) */
  'lock-warning': (remainingMs: number) => void;

  /** Emitted when system is locked */
  locked: (reason: LockReason) => void;

  /** Emitted when system is unlocked */
  unlocked: (method: UnlockMethod) => void;

  /** Emitted on failed unlock attempt */
  'unlock-failed': (attempt: number, remaining: number) => void;

  /** Emitted when lockout starts */
  'lockout-started': (durationMs: number) => void;

  /** Emitted when lockout ends */
  'lockout-ended': () => void;

  /** Emitted when sensitive operation is blocked */
  'operation-blocked': (operation: string) => void;
}

// ============================================================================
// Auto-Lock Manager
// ============================================================================

/**
 * Auto-Lock Manager
 * Manages automatic locking and unlocking of Atlas based on idle time and events
 */
export class AutoLockManager extends EventEmitter {
  private config: AutoLockConfig;
  private state: LockState;
  private configPath: string;
  private passwordHashPath: string;
  private auditLogger = getAuditLogger();

  // Timers
  private idleCheckTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private lockTimer: NodeJS.Timeout | null = null;
  private lockoutTimer: NodeJS.Timeout | null = null;

  // State tracking
  private lastActivityTime: number = Date.now();
  private warningShown: boolean = false;
  private isShuttingDown: boolean = false;
  private mainWindow: BrowserWindow | null = null;

  // Password storage (hashed, never plain text)
  private passwordHash: string | null = null;
  private passwordSalt: string | null = null;

  constructor(config?: Partial<AutoLockConfig>) {
    super();

    this.config = { ...DEFAULT_AUTO_LOCK_CONFIG, ...config };

    // Initialize lock state
    this.state = {
      isLocked: false,
      lockLevel: this.config.lockLevel,
      lockedAt: null,
      failedAttempts: 0,
      isLockedOut: false,
      lockoutEndsAt: null,
      lockedBySession: null,
      lockReason: 'app_start',
    };

    // Config file paths
    const atlasDir = path.join(homedir(), '.atlas', 'security');
    this.configPath = path.join(atlasDir, 'auto-lock.json');
    this.passwordHashPath = path.join(atlasDir, '.lock-credentials');

    logger.info('AutoLockManager initialized', {
      enabled: this.config.enabled,
      idleTimeoutMs: this.config.idleTimeoutMs,
      lockLevel: this.config.lockLevel,
      unlockMethod: this.config.unlockMethod,
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the auto-lock manager
   */
  async initialize(mainWindow?: BrowserWindow): Promise<void> {
    this.mainWindow = mainWindow ?? null;

    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });

    // Load saved configuration
    await this.loadConfig();

    // Load password hash if exists
    await this.loadPasswordHash();

    // Start if enabled
    if (this.config.enabled) {
      this.start();
    }

    logger.info('AutoLockManager initialized', { enabled: this.config.enabled });
  }

  /**
   * Start the auto-lock system
   */
  start(): void {
    if (this.isShuttingDown) return;

    logger.info('Starting auto-lock system');

    // Register keyboard shortcuts
    this.registerShortcuts();

    // Start idle monitoring
    this.startIdleMonitoring();

    // Register system event listeners
    this.registerSystemListeners();

    // Log startup
    this.auditLogger.log('system_event', 'info', 'Auto-lock system started', {
      action: 'auto_lock_start',
      allowed: true,
      source: 'auto_lock',
      context: {
        idleTimeoutMs: this.config.idleTimeoutMs,
        lockLevel: this.config.lockLevel,
      },
    });
  }

  /**
   * Stop the auto-lock system
   */
  stop(): void {
    logger.info('Stopping auto-lock system');

    this.clearTimers();
    this.unregisterShortcuts();
    this.unregisterSystemListeners();

    this.auditLogger.log('system_event', 'info', 'Auto-lock system stopped', {
      action: 'auto_lock_stop',
      allowed: true,
      source: 'auto_lock',
    });
  }

  // ============================================================================
  // Lock/Unlock Operations
  // ============================================================================

  /**
   * Lock the system
   */
  async lock(reason: LockReason = 'manual_lock', sessionId?: string): Promise<void> {
    if (this.state.isLocked && this.state.lockLevel === 'full') {
      logger.debug('System already fully locked');
      return;
    }

    logger.info('Locking system', { reason, lockLevel: this.config.lockLevel });

    // Update state
    this.state = {
      ...this.state,
      isLocked: true,
      lockLevel: this.config.lockLevel,
      lockedAt: Date.now(),
      lockedBySession: sessionId ?? null,
      lockReason: reason,
    };

    // Clear warning state
    this.warningShown = false;
    this.clearTimers();

    // Show lock notification if enabled
    if (this.config.showLockNotification) {
      this.showNotification('Atlas Locked', this.getLockReasonMessage(reason));
    }

    // Emit events
    this.emit('locked', reason);
    this.emit('lock-state-changed', this.state);

    // Notify renderer
    this.notifyRenderer('atlas:lock-state-changed', this.state);

    // Audit log
    this.auditLogger.log('authentication', 'info', `System locked: ${reason}`, {
      action: 'lock',
      allowed: true,
      source: 'auto_lock',
      sessionId,
      context: {
        reason,
        lockLevel: this.config.lockLevel,
      },
    });
  }

  /**
   * Attempt to unlock the system
   */
  async unlock(credentials: {
    password?: string;
    pin?: string;
    biometricToken?: string;
  }): Promise<UnlockResult> {
    // Check if in lockout
    if (this.state.isLockedOut) {
      const remaining = (this.state.lockoutEndsAt ?? Date.now()) - Date.now();
      if (remaining > 0) {
        return {
          success: false,
          error: 'Too many failed attempts. Please wait.',
          lockoutRemainingMs: remaining,
        };
      } else {
        // Lockout expired
        this.endLockout();
      }
    }

    // Validate credentials based on unlock method
    let valid = false;

    switch (this.config.unlockMethod) {
      case 'password':
        valid = await this.validatePassword(credentials.password ?? '');
        break;

      case 'biometric':
        valid = await this.validateBiometric();
        break;

      case 'pin':
        valid = await this.validatePin(credentials.pin ?? '');
        break;

      case 'none':
        valid = true;
        break;
    }

    if (valid) {
      // Successful unlock
      this.state = {
        ...this.state,
        isLocked: false,
        lockLevel: 'none',
        lockedAt: null,
        failedAttempts: 0,
        isLockedOut: false,
        lockoutEndsAt: null,
        lockedBySession: null,
      };

      // Reset activity time and restart monitoring
      this.lastActivityTime = Date.now();
      if (this.config.enabled) {
        this.startIdleMonitoring();
      }

      // Emit events
      this.emit('unlocked', this.config.unlockMethod);
      this.emit('lock-state-changed', this.state);

      // Notify renderer
      this.notifyRenderer('atlas:lock-state-changed', this.state);

      // Audit log
      this.auditLogger.log('authentication', 'info', 'System unlocked', {
        action: 'unlock',
        allowed: true,
        source: 'auto_lock',
        context: {
          method: this.config.unlockMethod,
        },
      });

      logger.info('System unlocked', { method: this.config.unlockMethod });

      return { success: true };
    } else {
      // Failed unlock attempt
      this.state.failedAttempts++;
      const remaining = this.config.maxUnlockAttempts - this.state.failedAttempts;

      // Emit event
      this.emit('unlock-failed', this.state.failedAttempts, remaining);

      // Audit log
      this.auditLogger.log('authentication', 'warning', 'Failed unlock attempt', {
        action: 'unlock_failed',
        allowed: false,
        source: 'auto_lock',
        context: {
          attempt: this.state.failedAttempts,
          remaining,
        },
      });

      logger.warn('Failed unlock attempt', {
        attempt: this.state.failedAttempts,
        remaining,
      });

      // Check if should start lockout
      if (this.state.failedAttempts >= this.config.maxUnlockAttempts) {
        this.startLockout();
        return {
          success: false,
          error: 'Too many failed attempts. Account locked.',
          lockoutRemainingMs: this.config.lockoutDurationMs,
        };
      }

      return {
        success: false,
        error: 'Invalid credentials',
        remainingAttempts: remaining,
      };
    }
  }

  /**
   * Check if an operation is allowed given current lock state
   */
  isOperationAllowed(operation: string): boolean {
    // Not locked - everything allowed
    if (!this.state.isLocked) {
      return true;
    }

    // Full lock - nothing allowed
    if (this.state.lockLevel === 'full') {
      logger.debug('Operation blocked by full lock', { operation });
      this.emit('operation-blocked', operation);
      return false;
    }

    // Sensitive only - check if operation is sensitive
    if (this.state.lockLevel === 'sensitive_only') {
      const isSensitive = this.config.sensitiveOperations.includes(operation);
      if (isSensitive) {
        logger.debug('Sensitive operation blocked', { operation });
        this.emit('operation-blocked', operation);
        return false;
      }
      return true;
    }

    return true;
  }

  // ============================================================================
  // Voice Command Support
  // ============================================================================

  /**
   * Handle voice command for locking
   * Call this from voice pipeline when "Lock Atlas" is detected
   */
  handleVoiceCommand(command: string, sessionId?: string): boolean {
    if (!this.config.enableVoiceLock) {
      return false;
    }

    const normalizedCommand = command.toLowerCase().trim();

    // Check for lock commands
    const lockCommands = [
      'lock atlas',
      'lock yourself',
      'lock the system',
      'go to sleep',
      'secure mode',
      'lock now',
    ];

    for (const lockCmd of lockCommands) {
      if (normalizedCommand.includes(lockCmd)) {
        this.lock('voice_command', sessionId);
        return true;
      }
    }

    return false;
  }

  // ============================================================================
  // Password Management
  // ============================================================================

  /**
   * Set the unlock password
   */
  async setPassword(password: string): Promise<boolean> {
    if (password.length < 4) {
      logger.warn('Password too short');
      return false;
    }

    // Generate salt and hash password
    this.passwordSalt = randomBytes(32).toString('hex');
    this.passwordHash = this.hashPassword(password, this.passwordSalt);

    // Save to file
    await this.savePasswordHash();

    this.auditLogger.log('authentication', 'info', 'Lock password set', {
      action: 'set_password',
      allowed: true,
      source: 'auto_lock',
    });

    logger.info('Lock password set');
    return true;
  }

  /**
   * Change the unlock password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    // Validate current password
    const isValid = await this.validatePassword(currentPassword);
    if (!isValid) {
      logger.warn('Invalid current password for password change');
      return false;
    }

    // Set new password
    return this.setPassword(newPassword);
  }

  /**
   * Check if password is configured
   */
  hasPasswordSet(): boolean {
    return this.passwordHash !== null && this.passwordSalt !== null;
  }

  /**
   * Validate password against stored hash
   */
  private async validatePassword(password: string): Promise<boolean> {
    if (!this.passwordHash || !this.passwordSalt) {
      // No password set - accept any password on first use
      logger.warn('No password set, accepting input as initial password');
      await this.setPassword(password);
      return true;
    }

    const hash = this.hashPassword(password, this.passwordSalt);
    return hash === this.passwordHash;
  }

  /**
   * Hash password with salt using scrypt
   */
  private hashPassword(password: string, salt: string): string {
    const key = scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    return key.toString('hex');
  }

  /**
   * Validate biometric authentication
   */
  private async validateBiometric(): Promise<boolean> {
    try {
      // Check if biometric is available
      if (!systemPreferences.canPromptTouchID?.()) {
        logger.warn('Biometric authentication not available');
        return false;
      }

      // Prompt for biometric
      await systemPreferences.promptTouchID('Unlock Atlas');
      return true;
    } catch (error) {
      logger.warn('Biometric authentication failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Validate PIN
   */
  private async validatePin(pin: string): Promise<boolean> {
    // PIN validation uses the same hash mechanism as password
    return this.validatePassword(pin);
  }

  // ============================================================================
  // Idle Monitoring
  // ============================================================================

  /**
   * Start idle time monitoring
   */
  private startIdleMonitoring(): void {
    this.clearTimers();

    // Check idle time every second
    this.idleCheckTimer = setInterval(() => {
      this.checkIdleTime();
    }, 1000);

    logger.debug('Idle monitoring started');
  }

  /**
   * Check current idle time and take action
   */
  private checkIdleTime(): void {
    if (this.state.isLocked || this.isShuttingDown) return;

    const idleTime = Date.now() - this.lastActivityTime;
    const timeUntilLock = this.config.idleTimeoutMs - idleTime;
    const timeUntilWarning = timeUntilLock - this.config.warningTimeMs;

    // Show warning if approaching lock time
    if (timeUntilWarning <= 0 && !this.warningShown) {
      this.showLockWarning(timeUntilLock);
    }

    // Lock if idle timeout reached
    if (timeUntilLock <= 0) {
      this.lock('idle_timeout');
    }
  }

  /**
   * Show lock warning notification
   */
  private showLockWarning(remainingMs: number): void {
    this.warningShown = true;

    // Emit warning event
    this.emit('lock-warning', remainingMs);

    // Show notification if enabled
    if (this.config.showLockNotification) {
      this.showNotification(
        'Atlas Will Lock Soon',
        `Locking in ${Math.ceil(remainingMs / 1000)} seconds due to inactivity. Move mouse or press any key to stay active.`
      );
    }

    // Notify renderer
    this.notifyRenderer('atlas:lock-warning', { remainingMs });

    logger.info('Lock warning shown', { remainingMs });
  }

  /**
   * Record user activity to reset idle timer
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
    this.warningShown = false;

    // If warning was shown, cancel pending lock
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
  }

  // ============================================================================
  // System Event Listeners
  // ============================================================================

  /**
   * Register system event listeners
   */
  private registerSystemListeners(): void {
    // Lock on system lock
    if (this.config.lockOnSystemLock) {
      powerMonitor.on('lock-screen', this.handleSystemLock);
    }

    // Lock on display off
    if (this.config.lockOnDisplayOff) {
      // Note: 'suspend' is more reliable cross-platform than display off
      powerMonitor.on('suspend', this.handleDisplayOff);
    }

    // Resume handling
    powerMonitor.on('resume', this.handleResume);
    powerMonitor.on('unlock-screen', this.handleResume);

    logger.debug('System event listeners registered');
  }

  /**
   * Unregister system event listeners
   */
  private unregisterSystemListeners(): void {
    powerMonitor.removeListener('lock-screen', this.handleSystemLock);
    powerMonitor.removeListener('suspend', this.handleDisplayOff);
    powerMonitor.removeListener('resume', this.handleResume);
    powerMonitor.removeListener('unlock-screen', this.handleResume);

    logger.debug('System event listeners unregistered');
  }

  /**
   * Handle system lock event
   */
  private handleSystemLock = (): void => {
    logger.info('System lock detected');
    this.lock('system_lock');
  };

  /**
   * Handle display off / suspend event
   */
  private handleDisplayOff = (): void => {
    logger.info('Display off / suspend detected');
    this.lock('display_off');
  };

  /**
   * Handle system resume event
   */
  private handleResume = (): void => {
    logger.info('System resume detected');
    // Don't auto-unlock - user needs to authenticate
    // Just update last activity time if not locked
    if (!this.state.isLocked) {
      this.recordActivity();
    }
  };

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  /**
   * Register keyboard shortcuts
   */
  private registerShortcuts(): void {
    try {
      // Lock shortcut
      if (this.config.lockShortcut) {
        globalShortcut.register(this.config.lockShortcut, () => {
          logger.info('Lock shortcut triggered');
          this.lock('manual_lock');
        });
      }

      // Unlock shortcut (shows unlock dialog)
      if (this.config.unlockShortcut) {
        globalShortcut.register(this.config.unlockShortcut, () => {
          if (this.state.isLocked) {
            logger.info('Unlock shortcut triggered');
            this.notifyRenderer('atlas:show-unlock-dialog', {});
          }
        });
      }

      logger.debug('Keyboard shortcuts registered', {
        lock: this.config.lockShortcut,
        unlock: this.config.unlockShortcut,
      });
    } catch (error) {
      logger.warn('Failed to register shortcuts', { error: (error as Error).message });
    }
  }

  /**
   * Unregister keyboard shortcuts
   */
  private unregisterShortcuts(): void {
    try {
      if (this.config.lockShortcut) {
        globalShortcut.unregister(this.config.lockShortcut);
      }
      if (this.config.unlockShortcut) {
        globalShortcut.unregister(this.config.unlockShortcut);
      }
      logger.debug('Keyboard shortcuts unregistered');
    } catch (error) {
      logger.warn('Failed to unregister shortcuts', { error: (error as Error).message });
    }
  }

  // ============================================================================
  // Lockout Management
  // ============================================================================

  /**
   * Start lockout after too many failed attempts
   */
  private startLockout(): void {
    this.state.isLockedOut = true;
    this.state.lockoutEndsAt = Date.now() + this.config.lockoutDurationMs;

    // Set timer to end lockout
    this.lockoutTimer = setTimeout(() => {
      this.endLockout();
    }, this.config.lockoutDurationMs);

    // Emit event
    this.emit('lockout-started', this.config.lockoutDurationMs);

    // Notify renderer
    this.notifyRenderer('atlas:lockout-started', {
      durationMs: this.config.lockoutDurationMs,
      endsAt: this.state.lockoutEndsAt,
    });

    // Audit log
    this.auditLogger.log('authentication', 'critical', 'Account lockout triggered', {
      action: 'lockout_started',
      allowed: false,
      source: 'auto_lock',
      context: {
        failedAttempts: this.state.failedAttempts,
        lockoutDurationMs: this.config.lockoutDurationMs,
      },
    });

    // Show notification
    this.showNotification(
      'Atlas Locked Out',
      `Too many failed unlock attempts. Please wait ${Math.ceil(this.config.lockoutDurationMs / 60000)} minutes.`
    );

    logger.warn('Lockout started', {
      failedAttempts: this.state.failedAttempts,
      lockoutDurationMs: this.config.lockoutDurationMs,
    });
  }

  /**
   * End lockout period
   */
  private endLockout(): void {
    if (this.lockoutTimer) {
      clearTimeout(this.lockoutTimer);
      this.lockoutTimer = null;
    }

    this.state.isLockedOut = false;
    this.state.lockoutEndsAt = null;
    this.state.failedAttempts = 0;

    // Emit event
    this.emit('lockout-ended');

    // Notify renderer
    this.notifyRenderer('atlas:lockout-ended', {});

    this.auditLogger.log('authentication', 'info', 'Account lockout ended', {
      action: 'lockout_ended',
      allowed: true,
      source: 'auto_lock',
    });

    logger.info('Lockout ended');
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<AutoLockConfig>): Promise<void> {
    const wasEnabled = this.config.enabled;

    this.config = { ...this.config, ...updates };

    // Handle enable/disable changes
    if (updates.enabled !== undefined) {
      if (updates.enabled && !wasEnabled) {
        this.start();
      } else if (!updates.enabled && wasEnabled) {
        this.stop();
      }
    }

    // Re-register shortcuts if changed
    if (updates.lockShortcut || updates.unlockShortcut) {
      this.unregisterShortcuts();
      this.registerShortcuts();
    }

    // Save configuration
    await this.saveConfig();

    logger.info('Configuration updated', { updates });

    // Notify renderer
    this.notifyRenderer('atlas:auto-lock-config-changed', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AutoLockConfig> {
    return { ...this.config };
  }

  /**
   * Get current lock state
   */
  getState(): Readonly<LockState> {
    return { ...this.state };
  }

  /**
   * Load configuration from disk
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const savedConfig = JSON.parse(data) as Partial<AutoLockConfig>;
      this.config = { ...DEFAULT_AUTO_LOCK_CONFIG, ...savedConfig };
      logger.debug('Configuration loaded from disk');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load configuration', { error: (error as Error).message });
      }
      // Use default config
    }
  }

  /**
   * Save configuration to disk
   */
  private async saveConfig(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      logger.debug('Configuration saved to disk');
    } catch (error) {
      logger.warn('Failed to save configuration', { error: (error as Error).message });
    }
  }

  /**
   * Load password hash from disk
   */
  private async loadPasswordHash(): Promise<void> {
    try {
      const data = await fs.readFile(this.passwordHashPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.passwordHash = parsed.hash;
      this.passwordSalt = parsed.salt;
      logger.debug('Password hash loaded');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to load password hash', { error: (error as Error).message });
      }
      // No password set yet
    }
  }

  /**
   * Save password hash to disk
   */
  private async savePasswordHash(): Promise<void> {
    try {
      const configDir = path.dirname(this.passwordHashPath);
      await fs.mkdir(configDir, { recursive: true });

      const data = JSON.stringify({
        hash: this.passwordHash,
        salt: this.passwordSalt,
      });

      await fs.writeFile(this.passwordHashPath, data, { mode: 0o600 });
      logger.debug('Password hash saved');
    } catch (error) {
      logger.warn('Failed to save password hash', { error: (error as Error).message });
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    if (this.lockoutTimer) {
      clearTimeout(this.lockoutTimer);
      this.lockoutTimer = null;
    }
  }

  /**
   * Get human-readable lock reason message
   */
  private getLockReasonMessage(reason: LockReason): string {
    switch (reason) {
      case 'idle_timeout':
        return 'Locked due to inactivity';
      case 'manual_lock':
        return 'Manually locked';
      case 'voice_command':
        return 'Locked by voice command';
      case 'system_lock':
        return 'Locked with system';
      case 'display_off':
        return 'Locked due to display off';
      case 'failed_attempts':
        return 'Locked due to failed unlock attempts';
      case 'app_start':
        return 'Locked on startup';
      default:
        return 'Atlas is locked';
    }
  }

  /**
   * Show system notification
   */
  private showNotification(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          silent: false,
        });
        notification.show();
      }
    } catch (error) {
      logger.warn('Failed to show notification', { error: (error as Error).message });
    }
  }

  /**
   * Send message to renderer process
   */
  private notifyRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  // ============================================================================
  // Shutdown
  // ============================================================================

  /**
   * Shutdown the auto-lock manager
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    this.stop();
    this.clearTimers();
    this.removeAllListeners();

    logger.info('AutoLockManager shutdown complete');
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

let autoLockInstance: AutoLockManager | null = null;

/**
 * Get or create the singleton AutoLockManager instance
 */
export function getAutoLockManager(config?: Partial<AutoLockConfig>): AutoLockManager {
  if (!autoLockInstance) {
    autoLockInstance = new AutoLockManager(config);
  }
  return autoLockInstance;
}

/**
 * Initialize the auto-lock manager
 */
export async function initializeAutoLock(
  mainWindow?: BrowserWindow,
  config?: Partial<AutoLockConfig>
): Promise<AutoLockManager> {
  const manager = getAutoLockManager(config);
  await manager.initialize(mainWindow);
  return manager;
}

/**
 * Shutdown the auto-lock manager
 */
export async function shutdownAutoLock(): Promise<void> {
  if (autoLockInstance) {
    await autoLockInstance.shutdown();
    autoLockInstance = null;
  }
}

export default AutoLockManager;
