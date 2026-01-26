/**
 * Service Health Monitor
 *
 * Tracks real-time health status of all Atlas services:
 * - STT (Deepgram, Vosk)
 * - LLM (Fireworks, OpenRouter, Ollama)
 * - TTS (ElevenLabs, Piper, System)
 * - Trading (Go Backend, WebSocket)
 * - Memory (SQLite, LanceDB)
 *
 * Provides:
 * - Real-time status updates via events
 * - Degradation detection
 * - Automatic recovery attempts
 * - Statistics and uptime tracking
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('ServiceHealth');

// =============================================================================
// Types
// =============================================================================

export type ServiceStatus = 'online' | 'degraded' | 'offline' | 'unknown';

export type ServiceName =
  | 'stt-deepgram'
  | 'stt-vosk'
  | 'llm-fireworks'
  | 'llm-openrouter'
  | 'llm-ollama'
  | 'tts-elevenlabs'
  | 'tts-piper'
  | 'tts-system'
  | 'trading-api'
  | 'trading-ws'
  | 'memory-sqlite'
  | 'memory-lancedb';

export type ServiceCategory = 'stt' | 'llm' | 'tts' | 'trading' | 'memory';

export interface ServiceState {
  name: ServiceName;
  category: ServiceCategory;
  status: ServiceStatus;
  latency: number | null; // ms
  lastCheck: number;
  lastOnline: number | null;
  consecutiveFailures: number;
  uptime: number; // percentage
  error: string | null;
  metadata?: Record<string, unknown>;
}

export interface CategoryHealth {
  category: ServiceCategory;
  status: ServiceStatus;
  primaryService: ServiceName | null;
  fallbackService: ServiceName | null;
  availableServices: ServiceName[];
}

export interface OverallHealth {
  status: ServiceStatus;
  services: ServiceState[];
  categories: CategoryHealth[];
  lastUpdate: number;
  summary: string;
}

export interface HealthConfig {
  /** Check interval in ms */
  checkInterval: number;
  /** Timeout for health checks in ms */
  checkTimeout: number;
  /** Number of failures before marking offline */
  failureThreshold: number;
  /** Enable automatic recovery attempts */
  autoRecovery: boolean;
  /** Recovery attempt interval in ms */
  recoveryInterval: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: HealthConfig = {
  checkInterval: 30000, // 30 seconds
  checkTimeout: 5000, // 5 seconds
  failureThreshold: 3,
  autoRecovery: true,
  recoveryInterval: 60000, // 1 minute
};

// Service to category mapping
const SERVICE_CATEGORIES: Record<ServiceName, ServiceCategory> = {
  'stt-deepgram': 'stt',
  'stt-vosk': 'stt',
  'llm-fireworks': 'llm',
  'llm-openrouter': 'llm',
  'llm-ollama': 'llm',
  'tts-elevenlabs': 'tts',
  'tts-piper': 'tts',
  'tts-system': 'tts',
  'trading-api': 'trading',
  'trading-ws': 'trading',
  'memory-sqlite': 'memory',
  'memory-lancedb': 'memory',
};

// Primary services per category
const PRIMARY_SERVICES: Record<ServiceCategory, ServiceName> = {
  stt: 'stt-deepgram',
  llm: 'llm-fireworks',
  tts: 'tts-piper', // Offline-first
  trading: 'trading-api',
  memory: 'memory-sqlite',
};

// Fallback order per category
const FALLBACK_ORDER: Record<ServiceCategory, ServiceName[]> = {
  stt: ['stt-deepgram', 'stt-vosk'],
  llm: ['llm-fireworks', 'llm-openrouter', 'llm-ollama'],
  tts: ['tts-piper', 'tts-system', 'tts-elevenlabs'],
  trading: ['trading-api', 'trading-ws'],
  memory: ['memory-sqlite', 'memory-lancedb'],
};

// =============================================================================
// Service Health Monitor Class
// =============================================================================

export class ServiceHealthMonitor extends EventEmitter {
  private config: HealthConfig;
  private services: Map<ServiceName, ServiceState> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private healthCheckers: Map<ServiceName, () => Promise<boolean>> = new Map();
  private uptimeHistory: Map<ServiceName, boolean[]> = new Map();
  private readonly UPTIME_HISTORY_SIZE = 100;

  constructor(config: Partial<HealthConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeServices();
    logger.info('ServiceHealthMonitor initialized');
  }

  /**
   * Initialize all service states
   */
  private initializeServices(): void {
    for (const [name, category] of Object.entries(SERVICE_CATEGORIES) as [
      ServiceName,
      ServiceCategory,
    ][]) {
      this.services.set(name, {
        name,
        category,
        status: 'unknown',
        latency: null,
        lastCheck: 0,
        lastOnline: null,
        consecutiveFailures: 0,
        uptime: 100,
        error: null,
      });
      this.uptimeHistory.set(name, []);
    }
  }

  /**
   * Register a health check function for a service
   */
  registerHealthCheck(service: ServiceName, checker: () => Promise<boolean>): void {
    this.healthCheckers.set(service, checker);
    logger.debug('Registered health check', { service });
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.checkInterval) return;

    logger.info('Starting service health monitoring');

    // Initial check
    this.checkAllServices();

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAllServices();
    }, this.config.checkInterval);

    // Recovery attempts
    if (this.config.autoRecovery) {
      this.recoveryInterval = setInterval(() => {
        this.attemptRecovery();
      }, this.config.recoveryInterval);
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    logger.info('Service health monitoring stopped');
  }

  /**
   * Check all services
   */
  async checkAllServices(): Promise<void> {
    const checks = Array.from(this.healthCheckers.entries()).map(([service, checker]) =>
      this.checkService(service, checker)
    );
    await Promise.allSettled(checks);
    this.emit('health-update', this.getOverallHealth());
  }

  /**
   * Check a single service
   */
  private async checkService(
    service: ServiceName,
    checker: () => Promise<boolean>
  ): Promise<void> {
    const state = this.services.get(service);
    if (!state) return;

    const startTime = Date.now();
    const previousStatus = state.status;

    try {
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.config.checkTimeout);
      });

      const isHealthy = await Promise.race([checker(), timeoutPromise]);
      const latency = Date.now() - startTime;

      if (isHealthy) {
        state.status = latency > 2000 ? 'degraded' : 'online';
        state.latency = latency;
        state.lastOnline = Date.now();
        state.consecutiveFailures = 0;
        state.error = null;
      } else {
        this.handleFailure(state, 'Health check returned false');
      }
    } catch (error) {
      this.handleFailure(state, error instanceof Error ? error.message : String(error));
    }

    state.lastCheck = Date.now();
    this.updateUptime(service, state.status === 'online' || state.status === 'degraded');

    // Emit status change event
    if (previousStatus !== state.status) {
      logger.info('Service status changed', {
        service,
        from: previousStatus,
        to: state.status,
      });
      this.emit('status-change', service, state.status, previousStatus);
    }
  }

  /**
   * Handle a service failure
   */
  private handleFailure(state: ServiceState, error: string): void {
    state.consecutiveFailures++;
    state.error = error;
    state.latency = null;

    if (state.consecutiveFailures >= this.config.failureThreshold) {
      state.status = 'offline';
    } else {
      state.status = 'degraded';
    }
  }

  /**
   * Update uptime tracking
   */
  private updateUptime(service: ServiceName, isOnline: boolean): void {
    const history = this.uptimeHistory.get(service);
    if (!history) return;

    history.push(isOnline);
    if (history.length > this.UPTIME_HISTORY_SIZE) {
      history.shift();
    }

    const state = this.services.get(service);
    if (state && history.length > 0) {
      const onlineCount = history.filter((h) => h).length;
      state.uptime = Math.round((onlineCount / history.length) * 100);
    }
  }

  /**
   * Attempt recovery for offline services
   */
  private async attemptRecovery(): Promise<void> {
    for (const [service, state] of this.services.entries()) {
      if (state.status === 'offline') {
        const checker = this.healthCheckers.get(service);
        if (checker) {
          logger.debug('Attempting recovery', { service });
          await this.checkService(service, checker);
        }
      }
    }
  }

  /**
   * Get status of a specific service
   */
  getServiceStatus(service: ServiceName): ServiceState | null {
    return this.services.get(service) ?? null;
  }

  /**
   * Get health of a category (aggregated from services)
   */
  getCategoryHealth(category: ServiceCategory): CategoryHealth {
    const servicesInCategory = Array.from(this.services.values()).filter(
      (s) => s.category === category
    );

    const onlineServices = servicesInCategory.filter(
      (s) => s.status === 'online' || s.status === 'degraded'
    );

    // Determine overall category status
    let status: ServiceStatus = 'offline';
    if (onlineServices.length === servicesInCategory.length) {
      status = servicesInCategory.some((s) => s.status === 'degraded') ? 'degraded' : 'online';
    } else if (onlineServices.length > 0) {
      status = 'degraded';
    }

    // Find primary and fallback
    const fallbackOrder = FALLBACK_ORDER[category];
    let primaryService: ServiceName | null = null;
    let fallbackService: ServiceName | null = null;

    for (const service of fallbackOrder) {
      const state = this.services.get(service);
      if (state && (state.status === 'online' || state.status === 'degraded')) {
        if (!primaryService) {
          primaryService = service;
        } else if (!fallbackService) {
          fallbackService = service;
          break;
        }
      }
    }

    return {
      category,
      status,
      primaryService,
      fallbackService,
      availableServices: onlineServices.map((s) => s.name),
    };
  }

  /**
   * Get overall system health
   */
  getOverallHealth(): OverallHealth {
    const services = Array.from(this.services.values());
    const categories: CategoryHealth[] = (['stt', 'llm', 'tts', 'trading', 'memory'] as ServiceCategory[]).map(
      (c) => this.getCategoryHealth(c)
    );

    // Determine overall status
    const categoryStatuses = categories.map((c) => c.status);
    let status: ServiceStatus = 'online';

    if (categoryStatuses.every((s) => s === 'offline')) {
      status = 'offline';
    } else if (categoryStatuses.some((s) => s === 'offline')) {
      status = 'degraded';
    } else if (categoryStatuses.some((s) => s === 'degraded')) {
      status = 'degraded';
    }

    // Generate summary
    const offlineCategories = categories.filter((c) => c.status === 'offline').map((c) => c.category);
    const degradedCategories = categories.filter((c) => c.status === 'degraded').map((c) => c.category);

    let summary = 'All systems operational';
    if (offlineCategories.length > 0) {
      summary = `Offline: ${offlineCategories.join(', ')}`;
      if (degradedCategories.length > 0) {
        summary += `. Degraded: ${degradedCategories.join(', ')}`;
      }
    } else if (degradedCategories.length > 0) {
      summary = `Degraded: ${degradedCategories.join(', ')}`;
    }

    return {
      status,
      services,
      categories,
      lastUpdate: Date.now(),
      summary,
    };
  }

  /**
   * Manually set service status (for external updates)
   */
  setServiceStatus(
    service: ServiceName,
    status: ServiceStatus,
    error?: string,
    latency?: number
  ): void {
    const state = this.services.get(service);
    if (!state) return;

    const previousStatus = state.status;
    state.status = status;
    state.lastCheck = Date.now();

    if (status === 'online' || status === 'degraded') {
      state.lastOnline = Date.now();
      state.consecutiveFailures = 0;
      state.error = null;
    } else {
      state.error = error ?? null;
    }

    if (latency !== undefined) {
      state.latency = latency;
    }

    if (previousStatus !== status) {
      this.emit('status-change', service, status, previousStatus);
    }

    this.updateUptime(service, status === 'online' || status === 'degraded');
  }

  /**
   * Get recommended service for a category (best available)
   */
  getRecommendedService(category: ServiceCategory): ServiceName | null {
    const health = this.getCategoryHealth(category);
    return health.primaryService;
  }

  /**
   * Check if a specific service is usable
   */
  isServiceUsable(service: ServiceName): boolean {
    const state = this.services.get(service);
    return state?.status === 'online' || state?.status === 'degraded';
  }

  /**
   * Get services statistics
   */
  getStatistics(): {
    totalServices: number;
    onlineServices: number;
    degradedServices: number;
    offlineServices: number;
    averageUptime: number;
  } {
    const services = Array.from(this.services.values());
    const online = services.filter((s) => s.status === 'online').length;
    const degraded = services.filter((s) => s.status === 'degraded').length;
    const offline = services.filter((s) => s.status === 'offline').length;
    const avgUptime = services.reduce((sum, s) => sum + s.uptime, 0) / services.length;

    return {
      totalServices: services.length,
      onlineServices: online,
      degradedServices: degraded,
      offlineServices: offline,
      averageUptime: Math.round(avgUptime),
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let healthMonitorInstance: ServiceHealthMonitor | null = null;

export function getServiceHealthMonitor(): ServiceHealthMonitor {
  if (!healthMonitorInstance) {
    healthMonitorInstance = new ServiceHealthMonitor();
  }
  return healthMonitorInstance;
}

export function createServiceHealthMonitor(config?: Partial<HealthConfig>): ServiceHealthMonitor {
  healthMonitorInstance = new ServiceHealthMonitor(config);
  return healthMonitorInstance;
}

export function shutdownServiceHealthMonitor(): void {
  if (healthMonitorInstance) {
    healthMonitorInstance.stop();
    healthMonitorInstance = null;
  }
}
