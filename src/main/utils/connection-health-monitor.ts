/**
 * Atlas Desktop - Connection Health Monitor
 * 
 * Continuously monitors API endpoint health with periodic heartbeats.
 * Automatically triggers provider switching before user-visible failures.
 * 
 * @module utils/connection-health-monitor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('ConnectionHealthMonitor');

// ============================================================================
// Types
// ============================================================================

export type ServiceName = 'deepgram' | 'elevenlabs' | 'fireworks' | 'openrouter' | 'ollama';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceHealth {
  service: ServiceName;
  status: HealthStatus;
  latencyMs: number | null;
  lastCheck: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface HealthMonitorConfig {
  /** Interval between health checks (ms) */
  checkInterval: number;
  /** Timeout for each health check (ms) */
  checkTimeout: number;
  /** Number of consecutive failures before marking unhealthy */
  failureThreshold: number;
  /** Latency threshold for "degraded" status (ms) */
  degradedLatencyThreshold: number;
  /** Enable automatic provider switching on failure */
  autoSwitch: boolean;
  /** Services to monitor */
  services: ServiceName[];
}

export interface HealthMonitorEvents {
  'status-change': (service: ServiceName, oldStatus: HealthStatus, newStatus: HealthStatus) => void;
  'service-unhealthy': (service: ServiceName, error: string) => void;
  'service-recovered': (service: ServiceName) => void;
  'all-healthy': () => void;
  'degraded-performance': (service: ServiceName, latencyMs: number) => void;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkInterval: 30000, // 30 seconds
  checkTimeout: 5000,   // 5 seconds
  failureThreshold: 3,
  degradedLatencyThreshold: 2000, // 2 seconds
  autoSwitch: true,
  services: ['deepgram', 'elevenlabs', 'fireworks'],
};

// ============================================================================
// Service Endpoints for Health Checks
// ============================================================================

const SERVICE_ENDPOINTS: Record<ServiceName, { url: string; method: string }> = {
  deepgram: {
    url: 'https://api.deepgram.com/v1/listen',
    method: 'OPTIONS',
  },
  elevenlabs: {
    url: 'https://api.elevenlabs.io/v1/voices',
    method: 'HEAD',
  },
  fireworks: {
    url: 'https://api.fireworks.ai/inference/v1/models',
    method: 'HEAD',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    method: 'HEAD',
  },
  ollama: {
    url: 'http://localhost:11434/api/tags',
    method: 'GET',
  },
};

// ============================================================================
// Connection Health Monitor
// ============================================================================

export class ConnectionHealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private healthStatus: Map<ServiceName, ServiceHealth> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config?: Partial<HealthMonitorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize health status for all services
    for (const service of this.config.services) {
      this.healthStatus.set(service, {
        service,
        status: 'unknown',
        latencyMs: null,
        lastCheck: 0,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Start the health monitor
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Health monitor already running');
      return;
    }

    logger.info('Starting connection health monitor', {
      services: this.config.services,
      interval: this.config.checkInterval,
    });

    this.isRunning = true;

    // Perform initial check
    this.performAllChecks();

    // Start periodic checks
    this.checkTimer = setInterval(() => {
      this.performAllChecks();
    }, this.config.checkInterval);
  }

  /**
   * Stop the health monitor
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping connection health monitor');

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    this.isRunning = false;
  }

  /**
   * Perform health checks on all configured services
   */
  private async performAllChecks(): Promise<void> {
    const checks = this.config.services.map((service) => this.checkService(service));
    await Promise.allSettled(checks);

    // Check if all services are healthy
    const allHealthy = Array.from(this.healthStatus.values()).every(
      (h) => h.status === 'healthy'
    );

    if (allHealthy) {
      this.emit('all-healthy');
    }
  }

  /**
   * Check health of a single service
   */
  private async checkService(service: ServiceName): Promise<void> {
    const endpoint = SERVICE_ENDPOINTS[service];
    const currentHealth = this.healthStatus.get(service)!;
    const oldStatus = currentHealth.status;

    const startTime = Date.now();
    let newStatus: HealthStatus = 'healthy';
    let latencyMs: number | null = null;
    let errorMessage: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.checkTimeout);

      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      latencyMs = Date.now() - startTime;

      // Check response status
      if (!response.ok && response.status !== 401 && response.status !== 403) {
        // 401/403 is expected without auth, but endpoint is reachable
        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`);
        }
      }

      // Check for degraded performance
      if (latencyMs > this.config.degradedLatencyThreshold) {
        newStatus = 'degraded';
        this.emit('degraded-performance', service, latencyMs);
      }

      // Reset consecutive failures on success
      currentHealth.consecutiveFailures = 0;
    } catch (error) {
      latencyMs = Date.now() - startTime;
      errorMessage = getErrorMessage(error);

      currentHealth.consecutiveFailures++;

      if (currentHealth.consecutiveFailures >= this.config.failureThreshold) {
        newStatus = 'unhealthy';
        this.emit('service-unhealthy', service, errorMessage);
        logger.error(`Service ${service} is unhealthy`, {
          consecutiveFailures: currentHealth.consecutiveFailures,
          error: errorMessage,
        });
      } else {
        newStatus = 'degraded';
        logger.warn(`Service ${service} check failed`, {
          consecutiveFailures: currentHealth.consecutiveFailures,
          error: errorMessage,
        });
      }
    }

    // Update health status
    currentHealth.status = newStatus;
    currentHealth.latencyMs = latencyMs;
    currentHealth.lastCheck = Date.now();
    currentHealth.lastError = errorMessage;

    // Emit status change event
    if (oldStatus !== newStatus) {
      this.emit('status-change', service, oldStatus, newStatus);

      // Check for recovery
      if (oldStatus === 'unhealthy' && (newStatus === 'healthy' || newStatus === 'degraded')) {
        this.emit('service-recovered', service);
        logger.info(`Service ${service} recovered`);
      }
    }
  }

  /**
   * Get health status of a specific service
   */
  getServiceHealth(service: ServiceName): ServiceHealth | undefined {
    return this.healthStatus.get(service);
  }

  /**
   * Get health status of all services
   */
  getAllHealth(): ServiceHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get overall system health
   */
  getOverallHealth(): {
    status: HealthStatus;
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
    unknownCount: number;
  } {
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let unknownCount = 0;

    for (const health of this.healthStatus.values()) {
      switch (health.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
        case 'unhealthy':
          unhealthyCount++;
          break;
        case 'unknown':
          unknownCount++;
          break;
      }
    }

    let status: HealthStatus = 'healthy';
    if (unhealthyCount > 0) {
      status = 'unhealthy';
    } else if (degradedCount > 0 || unknownCount > 0) {
      status = 'degraded';
    }

    return {
      status,
      healthyCount,
      degradedCount,
      unhealthyCount,
      unknownCount,
    };
  }

  /**
   * Force a health check on a specific service
   */
  async forceCheck(service: ServiceName): Promise<ServiceHealth> {
    await this.checkService(service);
    return this.healthStatus.get(service)!;
  }

  /**
   * Check if a service is available (healthy or degraded)
   */
  isServiceAvailable(service: ServiceName): boolean {
    const health = this.healthStatus.get(service);
    return health?.status === 'healthy' || health?.status === 'degraded';
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let healthMonitor: ConnectionHealthMonitor | null = null;

/**
 * Get the connection health monitor instance
 */
export function getConnectionHealthMonitor(
  config?: Partial<HealthMonitorConfig>
): ConnectionHealthMonitor {
  if (!healthMonitor) {
    healthMonitor = new ConnectionHealthMonitor(config);
  }
  return healthMonitor;
}

/**
 * Shutdown the connection health monitor
 */
export function shutdownConnectionHealthMonitor(): void {
  if (healthMonitor) {
    healthMonitor.stop();
    healthMonitor.removeAllListeners();
    healthMonitor = null;
  }
}

export { ConnectionHealthMonitor as default };
