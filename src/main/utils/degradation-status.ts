/**
 * Degradation Status Manager
 *
 * Tracks and reports service degradation status to inform users
 * when the app is running in degraded mode with fallback services.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('degradation-status');

/**
 * Service types that can be degraded
 */
export type DegradableService = 'stt' | 'llm' | 'tts';

/**
 * Service status info
 */
export interface ServiceStatus {
  service: DegradableService;
  primary: string;
  fallback: string;
  isDegraded: boolean;
  degradedSince: number | null;
  reason: string | null;
}

/**
 * Overall degradation status
 */
export interface DegradationStatus {
  isDegraded: boolean;
  degradedServices: ServiceStatus[];
  healthyServices: DegradableService[];
  timestamp: number;
}

/**
 * Degradation notification for UI
 */
export interface DegradationNotification {
  type: 'degraded' | 'restored' | 'warning';
  service: DegradableService;
  message: string;
  details?: string;
  timestamp: number;
}

/**
 * Degradation Status Manager Events
 */
export interface DegradationStatusEvents {
  /** Status changed */
  'status-changed': (status: DegradationStatus) => void;
  /** Service degraded */
  'service-degraded': (notification: DegradationNotification) => void;
  /** Service restored */
  'service-restored': (notification: DegradationNotification) => void;
  /** Warning */
  'warning': (notification: DegradationNotification) => void;
}

/**
 * Service configuration
 */
interface ServiceConfig {
  primary: string;
  fallback: string;
}

const SERVICE_CONFIGS: Record<DegradableService, ServiceConfig> = {
  stt: { primary: 'Deepgram', fallback: 'Vosk (Offline)' },
  llm: { primary: 'Fireworks AI (GLM-4.7 Thinking)', fallback: 'OpenRouter' },
  tts: { primary: 'ElevenLabs', fallback: 'System Voice' },
};

/**
 * Degradation Status Manager
 */
export class DegradationStatusManager extends EventEmitter {
  private services: Map<DegradableService, ServiceStatus> = new Map();
  private initialized = false;

  constructor() {
    super();
    this.initializeServices();
  }

  private initializeServices(): void {
    const serviceTypes: DegradableService[] = ['stt', 'llm', 'tts'];

    for (const service of serviceTypes) {
      const config = SERVICE_CONFIGS[service];
      this.services.set(service, {
        service,
        primary: config.primary,
        fallback: config.fallback,
        isDegraded: false,
        degradedSince: null,
        reason: null,
      });
    }

    this.initialized = true;
    logger.info('Degradation status manager initialized');
  }

  /**
   * Mark a service as degraded (using fallback)
   */
  markDegraded(service: DegradableService, reason: string): void {
    const status = this.services.get(service);
    if (!status) return;

    if (!status.isDegraded) {
      status.isDegraded = true;
      status.degradedSince = Date.now();
      status.reason = reason;

      const notification: DegradationNotification = {
        type: 'degraded',
        service,
        message: `${status.primary} unavailable`,
        details: `Using ${status.fallback} instead. Reason: ${reason}`,
        timestamp: Date.now(),
      };

      logger.warn(`Service degraded: ${service}`, { reason });
      this.emit('service-degraded', notification);
      this.emitStatusChanged();
    }
  }

  /**
   * Mark a service as restored (using primary)
   */
  markRestored(service: DegradableService): void {
    const status = this.services.get(service);
    if (!status) return;

    if (status.isDegraded) {
      const degradedDuration = status.degradedSince
        ? Date.now() - status.degradedSince
        : 0;

      status.isDegraded = false;
      status.degradedSince = null;
      status.reason = null;

      const notification: DegradationNotification = {
        type: 'restored',
        service,
        message: `${status.primary} restored`,
        details: `Was degraded for ${Math.round(degradedDuration / 1000)}s`,
        timestamp: Date.now(),
      };

      logger.info(`Service restored: ${service}`, { degradedDuration });
      this.emit('service-restored', notification);
      this.emitStatusChanged();
    }
  }

  /**
   * Send a warning about a service
   */
  warn(service: DegradableService, message: string): void {
    const notification: DegradationNotification = {
      type: 'warning',
      service,
      message,
      timestamp: Date.now(),
    };

    logger.warn(`Service warning: ${service} - ${message}`);
    this.emit('warning', notification);
  }

  /**
   * Get current degradation status
   */
  getStatus(): DegradationStatus {
    const degradedServices: ServiceStatus[] = [];
    const healthyServices: DegradableService[] = [];

    for (const [service, status] of this.services) {
      if (status.isDegraded) {
        degradedServices.push({ ...status });
      } else {
        healthyServices.push(service);
      }
    }

    return {
      isDegraded: degradedServices.length > 0,
      degradedServices,
      healthyServices,
      timestamp: Date.now(),
    };
  }

  /**
   * Get status for a specific service
   */
  getServiceStatus(service: DegradableService): ServiceStatus | undefined {
    return this.services.get(service);
  }

  /**
   * Check if any service is degraded
   */
  isAnyDegraded(): boolean {
    for (const status of this.services.values()) {
      if (status.isDegraded) return true;
    }
    return false;
  }

  /**
   * Check if a specific service is degraded
   */
  isServiceDegraded(service: DegradableService): boolean {
    return this.services.get(service)?.isDegraded ?? false;
  }

  /**
   * Get summary for UI display
   */
  getSummary(): string {
    const status = this.getStatus();

    if (!status.isDegraded) {
      return 'All services operating normally';
    }

    const degradedNames = status.degradedServices.map((s) => {
      const config = SERVICE_CONFIGS[s.service];
      return `${s.service.toUpperCase()}: using ${config.fallback}`;
    });

    return `Degraded mode: ${degradedNames.join(', ')}`;
  }

  /**
   * Get notification for renderer
   */
  getNotificationForRenderer(): {
    show: boolean;
    type: 'info' | 'warning' | 'error';
    message: string;
    services: Array<{ name: string; status: string; using: string }>;
  } {
    const status = this.getStatus();

    return {
      show: status.isDegraded,
      type: status.isDegraded ? 'warning' : 'info',
      message: status.isDegraded
        ? 'Some services are running in fallback mode'
        : 'All services normal',
      services: [...this.services.values()].map((s) => ({
        name: s.service.toUpperCase(),
        status: s.isDegraded ? 'fallback' : 'primary',
        using: s.isDegraded ? s.fallback : s.primary,
      })),
    };
  }

  private emitStatusChanged(): void {
    this.emit('status-changed', this.getStatus());
  }

  // Type-safe event emitter methods
  on<K extends keyof DegradationStatusEvents>(
    event: K,
    listener: DegradationStatusEvents[K]
  ): this {
    return super.on(event, listener);
  }

  off<K extends keyof DegradationStatusEvents>(
    event: K,
    listener: DegradationStatusEvents[K]
  ): this {
    return super.off(event, listener);
  }

  emit<K extends keyof DegradationStatusEvents>(
    event: K,
    ...args: Parameters<DegradationStatusEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let statusManager: DegradationStatusManager | null = null;

/**
 * Get the degradation status manager singleton
 */
export function getDegradationStatusManager(): DegradationStatusManager {
  if (!statusManager) {
    statusManager = new DegradationStatusManager();
  }
  return statusManager;
}

/**
 * Create a new degradation status manager (for testing)
 */
export function createDegradationStatusManager(): DegradationStatusManager {
  return new DegradationStatusManager();
}
