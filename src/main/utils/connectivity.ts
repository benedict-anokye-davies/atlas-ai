/**
 * Atlas Desktop - Connectivity Manager
 * Monitors network connectivity status for offline-first architecture
 */

import { net } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('Connectivity');

/**
 * Connectivity check configuration
 */
export interface ConnectivityConfig {
  /** Interval for periodic checks (ms) */
  checkInterval: number;
  /** Timeout for connectivity check (ms) */
  checkTimeout: number;
  /** URLs to check for connectivity (in order) */
  checkUrls: string[];
  /** Number of consecutive failures before considered offline */
  failureThreshold: number;
}

/**
 * Default connectivity configuration
 */
const DEFAULT_CONNECTIVITY_CONFIG: ConnectivityConfig = {
  checkInterval: 30000, // 30 seconds
  checkTimeout: 5000, // 5 seconds
  checkUrls: [
    'https://api.fireworks.ai', // Primary API
    'https://api.deepgram.com', // STT API
    'https://api.elevenlabs.io', // TTS API
    'https://www.google.com', // General internet check
  ],
  failureThreshold: 2,
};

/**
 * Connectivity status
 */
export interface ConnectivityStatus {
  isOnline: boolean;
  lastCheck: number;
  lastOnline: number | null;
  consecutiveFailures: number;
  latency: number | null;
}

/**
 * Service availability status
 */
export interface ServiceAvailability {
  fireworks: boolean;
  deepgram: boolean;
  elevenlabs: boolean;
  internet: boolean;
}

/**
 * ConnectivityManager - Monitors network connectivity
 *
 * Features:
 * - Periodic connectivity checks
 * - Service-specific availability tracking
 * - Event-based status updates
 * - Graceful degradation support
 */
export class ConnectivityManager extends EventEmitter {
  private config: ConnectivityConfig;
  private status: ConnectivityStatus;
  private serviceAvailability: ServiceAvailability;
  private checkIntervalId: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(config?: Partial<ConnectivityConfig>) {
    super();
    this.config = { ...DEFAULT_CONNECTIVITY_CONFIG, ...config };
    this.status = {
      isOnline: true, // Assume online until proven otherwise
      lastCheck: 0,
      lastOnline: null,
      consecutiveFailures: 0,
      latency: null,
    };
    this.serviceAvailability = {
      fireworks: true,
      deepgram: true,
      elevenlabs: true,
      internet: true,
    };

    logger.info('ConnectivityManager initialized', {
      checkInterval: this.config.checkInterval,
      failureThreshold: this.config.failureThreshold,
    });
  }

  /**
   * Start periodic connectivity monitoring
   */
  start(): void {
    if (this.checkIntervalId) {
      logger.warn('ConnectivityManager already running');
      return;
    }

    // Do initial check
    this.checkConnectivity();

    // Start periodic checks
    this.checkIntervalId = setInterval(() => {
      this.checkConnectivity();
    }, this.config.checkInterval);

    logger.info('ConnectivityManager started', {
      interval: this.config.checkInterval,
    });
  }

  /**
   * Stop connectivity monitoring
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      logger.info('ConnectivityManager stopped');
    }
  }

  /**
   * Check if app is online using Electron's net module
   */
  isOnline(): boolean {
    return this.status.isOnline;
  }

  /**
   * Get current connectivity status
   */
  getStatus(): ConnectivityStatus {
    return { ...this.status };
  }

  /**
   * Get service availability
   */
  getServiceAvailability(): ServiceAvailability {
    return { ...this.serviceAvailability };
  }

  /**
   * Check if a specific service is available
   */
  isServiceAvailable(service: keyof ServiceAvailability): boolean {
    return this.serviceAvailability[service];
  }

  /**
   * Perform connectivity check
   */
  async checkConnectivity(): Promise<boolean> {
    if (this.isChecking) {
      return this.status.isOnline;
    }

    this.isChecking = true;
    const startTime = Date.now();

    try {
      // First use Electron's built-in check
      const electronOnline = net.isOnline();

      if (!electronOnline) {
        this.handleOffline('Electron net.isOnline() returned false');
        return false;
      }

      // Check each service URL
      const results = await Promise.allSettled(
        this.config.checkUrls.map((url) => this.checkUrl(url))
      );

      // Update service availability
      this.serviceAvailability = {
        fireworks: results[0]?.status === 'fulfilled' && results[0].value,
        deepgram: results[1]?.status === 'fulfilled' && results[1].value,
        elevenlabs: results[2]?.status === 'fulfilled' && results[2].value,
        internet: results[3]?.status === 'fulfilled' && results[3].value,
      };

      // Consider online if at least one service is reachable
      const isOnline = Object.values(this.serviceAvailability).some((v) => v);
      const latency = Date.now() - startTime;

      if (isOnline) {
        this.handleOnline(latency);
      } else {
        this.handleOffline('All service checks failed');
      }

      return isOnline;
    } catch (error) {
      logger.error('Connectivity check failed', { error });
      this.handleOffline('Check threw exception');
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check a single URL for connectivity
   */
  private async checkUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, this.config.checkTimeout);

      try {
        const request = net.request({
          method: 'HEAD',
          url,
        });

        request.on('response', (response) => {
          clearTimeout(timeout);
          // Accept any response as "reachable" (even 401/403)
          resolve(response.statusCode !== undefined);
        });

        request.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        request.end();
      } catch {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  /**
   * Handle transition to online state
   */
  private handleOnline(latency: number): void {
    const wasOffline = !this.status.isOnline;

    this.status = {
      isOnline: true,
      lastCheck: Date.now(),
      lastOnline: Date.now(),
      consecutiveFailures: 0,
      latency,
    };

    if (wasOffline) {
      logger.info('Connectivity restored', { latency });
      this.emit('online', this.status);
      this.emit('status-change', true, this.status);
    }

    this.emit('check-complete', this.status);
  }

  /**
   * Handle potential offline state
   */
  private handleOffline(reason: string): void {
    this.status.consecutiveFailures++;
    this.status.lastCheck = Date.now();
    this.status.latency = null;

    // Only consider truly offline after threshold failures
    if (this.status.consecutiveFailures >= this.config.failureThreshold) {
      const wasOnline = this.status.isOnline;
      this.status.isOnline = false;

      if (wasOnline) {
        logger.warn('Connectivity lost', {
          reason,
          consecutiveFailures: this.status.consecutiveFailures,
        });
        this.emit('offline', this.status);
        this.emit('status-change', false, this.status);
      }
    } else {
      logger.debug('Connectivity check failed (not yet offline)', {
        reason,
        consecutiveFailures: this.status.consecutiveFailures,
        threshold: this.config.failureThreshold,
      });
    }

    this.emit('check-complete', this.status);
  }

  /**
   * Force a connectivity check now
   */
  async forceCheck(): Promise<boolean> {
    return this.checkConnectivity();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConnectivityConfig>): void {
    const wasRunning = this.checkIntervalId !== null;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };
    logger.info('Connectivity configuration updated', config);

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Add listener for online event
   */
  onOnline(callback: (status: ConnectivityStatus) => void): () => void {
    this.on('online', callback);
    return () => this.off('online', callback);
  }

  /**
   * Add listener for offline event
   */
  onOffline(callback: (status: ConnectivityStatus) => void): () => void {
    this.on('offline', callback);
    return () => this.off('offline', callback);
  }

  /**
   * Add listener for any status change
   */
  onStatusChange(callback: (online: boolean, status: ConnectivityStatus) => void): () => void {
    this.on('status-change', callback);
    return () => this.off('status-change', callback);
  }
}

// Singleton instance
let connectivityManager: ConnectivityManager | null = null;

/**
 * Get the singleton ConnectivityManager instance
 */
export function getConnectivityManager(config?: Partial<ConnectivityConfig>): ConnectivityManager {
  if (!connectivityManager) {
    connectivityManager = new ConnectivityManager(config);
  }
  return connectivityManager;
}

/**
 * Shutdown the connectivity manager
 */
export function shutdownConnectivityManager(): void {
  if (connectivityManager) {
    connectivityManager.stop();
    connectivityManager.removeAllListeners();
    connectivityManager = null;
    logger.info('ConnectivityManager shutdown complete');
  }
}
