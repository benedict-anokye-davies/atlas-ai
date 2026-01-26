/**
 * Atlas Desktop - Analytics System
 * Privacy-first, opt-in telemetry for usage analytics
 *
 * PRIVACY PRINCIPLES:
 * 1. Opt-in only - Users must explicitly enable telemetry
 * 2. Anonymized - No personally identifiable information collected
 * 3. Transparent - Clear disclosure of what is collected
 * 4. User control - Easy to disable at any time
 * 5. Local-first - Data can be stored locally before any upload
 * 6. Minimal - Only collect what's necessary for improvement
 */

import { EventEmitter } from 'events';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';
import { app } from 'electron';
import { randomBytes, createHash } from 'crypto';
import { createModuleLogger } from '../utils/logger';
import {
  TelemetryEvent,
  TelemetryCategory,
  TelemetryValue,
  SessionAnalytics,
  AppEvent,
  VoiceEvent,
  LLMEvent,
  TTSEvent,
  STTEvent,
  UIEvent,
  AgentEvent,
  MemoryEvent,
  ErrorEvent,
  PerformanceEvent,
  FeatureEvent,
  AppEventData,
  VoiceEventData,
  LLMEventData,
  TTSEventData,
  STTEventData,
  AgentEventData,
  ErrorEventData,
  PerformanceEventData,
  FeatureEventData,
  DATA_COLLECTION_DISCLOSURE,
  validateEventData,
  sanitizeEventData,
} from './events';

const logger = createModuleLogger('Analytics');

// ============================================================================
// Types and Configuration
// ============================================================================

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  /** Whether telemetry is enabled (opt-in) */
  enabled?: boolean;
  /** Directory to store local analytics data */
  dataDir?: string;
  /** Maximum number of events to keep locally */
  maxLocalEvents?: number;
  /** Maximum age of local events in days */
  maxEventAgeDays?: number;
  /** Remote endpoint for uploading analytics (optional) */
  remoteEndpoint?: string;
  /** Upload interval in ms (if remote endpoint configured) */
  uploadIntervalMs?: number;
  /** Whether to collect performance metrics */
  collectPerformance?: boolean;
  /** Whether to collect error reports */
  collectErrors?: boolean;
  /** Whether to collect feature usage */
  collectFeatureUsage?: boolean;
  /** Custom installation ID (for continuity across sessions) */
  installationId?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<AnalyticsConfig, 'remoteEndpoint' | 'installationId'>
> = {
  enabled: false, // IMPORTANT: Opt-in by default
  dataDir: join(homedir(), '.atlas', 'analytics'),
  maxLocalEvents: 1000,
  maxEventAgeDays: 90,
  uploadIntervalMs: 60 * 60 * 1000, // 1 hour
  collectPerformance: true,
  collectErrors: true,
  collectFeatureUsage: true,
};

/**
 * Consent status
 */
export enum ConsentStatus {
  /** User has not yet been asked */
  NOT_ASKED = 'not_asked',
  /** User explicitly opted in */
  OPTED_IN = 'opted_in',
  /** User explicitly opted out */
  OPTED_OUT = 'opted_out',
}

/**
 * Analytics state persisted to disk
 */
interface AnalyticsState {
  /** User consent status */
  consent: ConsentStatus;
  /** When consent was last updated */
  consentTimestamp?: number;
  /** Anonymous installation ID */
  installationId: string;
  /** Last upload timestamp */
  lastUpload?: number;
  /** Total events sent */
  totalEventsSent: number;
  /** App version when consent was given */
  consentVersion?: string;
}

/**
 * Performance metrics aggregation
 */
interface PerformanceMetrics {
  /** Response latencies in ms */
  responseTimes: number[];
  /** LLM time to first token */
  ttftTimes: number[];
  /** Memory usage samples */
  memoryUsage: number[];
  /** CPU usage samples */
  cpuUsage: number[];
  /** Frame rates */
  frameRates: number[];
}

// ============================================================================
// Analytics Manager Class
// ============================================================================

/**
 * AnalyticsManager - Handles opt-in telemetry collection
 */
export class AnalyticsManager extends EventEmitter {
  private config: Required<Omit<AnalyticsConfig, 'remoteEndpoint' | 'installationId'>> &
    Pick<AnalyticsConfig, 'remoteEndpoint' | 'installationId'>;
  private state: AnalyticsState;
  private sessionId: string;
  private sessionStart: Date;
  private sessionAnalytics: SessionAnalytics;
  private eventBuffer: TelemetryEvent[] = [];
  private performanceMetrics: PerformanceMetrics;
  private uploadTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private initialized: boolean = false;
  private featureUsageCount: Map<string, number> = new Map();

  constructor(config: AnalyticsConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = this.generateSessionId();
    this.sessionStart = new Date();

    // Initialize state
    this.state = this.loadState();

    // Initialize session analytics
    this.sessionAnalytics = {
      sessionId: this.sessionId,
      startTime: this.sessionStart.toISOString(),
      voiceInteractions: 0,
      llmRequests: 0,
      toolUses: 0,
      errors: 0,
      featuresUsed: [],
    };

    // Initialize performance metrics
    this.performanceMetrics = {
      responseTimes: [],
      ttftTimes: [],
      memoryUsage: [],
      cpuUsage: [],
      frameRates: [],
    };

    this.ensureDataDir();
  }

  // ==========================================================================
  // Public API - Consent Management
  // ==========================================================================

  /**
   * Check if telemetry is enabled (user has opted in)
   */
  isEnabled(): boolean {
    return this.config.enabled && this.state.consent === ConsentStatus.OPTED_IN;
  }

  /**
   * Get current consent status
   */
  getConsentStatus(): ConsentStatus {
    return this.state.consent;
  }

  /**
   * Set user consent for telemetry
   * @param optIn - Whether the user opts in to telemetry
   */
  setConsent(optIn: boolean): void {
    const previousStatus = this.state.consent;
    this.state.consent = optIn ? ConsentStatus.OPTED_IN : ConsentStatus.OPTED_OUT;
    this.state.consentTimestamp = Date.now();
    this.state.consentVersion = app.getVersion();
    this.saveState();

    logger.info('Telemetry consent updated', {
      previousStatus,
      newStatus: this.state.consent,
    });

    this.emit('consent-changed', this.state.consent);

    // If opting out, clear local data
    if (!optIn) {
      this.clearAllData();
    }
  }

  /**
   * Get the data collection disclosure for display to users
   */
  getDataDisclosure(): typeof DATA_COLLECTION_DISCLOSURE {
    return DATA_COLLECTION_DISCLOSURE;
  }

  /**
   * Check if user needs to be asked for consent
   */
  needsConsentPrompt(): boolean {
    return this.state.consent === ConsentStatus.NOT_ASKED;
  }

  // ==========================================================================
  // Public API - Initialization
  // ==========================================================================

  /**
   * Initialize the analytics system
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('Analytics already initialized');
      return;
    }

    // Only start collection if opted in
    if (this.isEnabled()) {
      this.startCollection();
    }

    // Track app start
    this.trackEvent(AppEvent.STARTED, TelemetryCategory.APP, {
      version: app.getVersion(),
      platform: platform(),
      arch: arch(),
      isDev: process.env.NODE_ENV === 'development',
    });

    this.initialized = true;
    logger.info('Analytics initialized', {
      enabled: this.isEnabled(),
      consent: this.state.consent,
      sessionId: this.sessionId,
    });
  }

  /**
   * Shutdown the analytics system
   */
  async shutdown(): Promise<void> {
    // Track app quit
    if (this.isEnabled()) {
      this.trackEvent(AppEvent.QUIT, TelemetryCategory.APP, {
        sessionDuration: Date.now() - this.sessionStart.getTime(),
      });
    }

    // Finalize session analytics
    this.finalizeSession();

    // Stop timers
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // Flush remaining events
    if (this.isEnabled()) {
      await this.flushEvents();
    }

    this.saveState();
    this.initialized = false;
    logger.info('Analytics shutdown');
  }

  // ==========================================================================
  // Public API - Event Tracking
  // ==========================================================================

  /**
   * Track a telemetry event
   * Events are only recorded if the user has opted in
   */
  trackEvent(
    type: string,
    category: TelemetryCategory,
    properties?: Record<string, TelemetryValue>,
    metrics?: Record<string, number>
  ): void {
    // Respect user consent
    if (!this.isEnabled()) {
      return;
    }

    // Validate data doesn't contain PII
    if (properties && !validateEventData(properties)) {
      logger.warn('Event data failed PII validation, sanitizing', { type });
      properties = sanitizeEventData(properties);
    }

    const event: TelemetryEvent = {
      type,
      category,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      properties,
      metrics,
    };

    // Add to buffer
    this.eventBuffer.push(event);

    // Update session analytics
    this.updateSessionAnalytics(type, category);

    // Emit for real-time monitoring
    this.emit('event', event);

    // Persist if buffer is full
    if (this.eventBuffer.length >= 100) {
      this.persistEvents();
    }

    logger.debug('Event tracked', { type, category });
  }

  // ==========================================================================
  // Public API - Specific Event Helpers
  // ==========================================================================

  /**
   * Track app event
   */
  trackAppEvent(event: AppEvent, data?: AppEventData): void {
    this.trackEvent(event, TelemetryCategory.APP, data as Record<string, TelemetryValue>);
  }

  /**
   * Track voice event
   */
  trackVoiceEvent(event: VoiceEvent, data?: VoiceEventData): void {
    this.trackEvent(event, TelemetryCategory.VOICE, data as Record<string, TelemetryValue>);
    if (event === VoiceEvent.PIPELINE_COMPLETED) {
      this.sessionAnalytics.voiceInteractions++;
      if (data?.duration) {
        this.performanceMetrics.responseTimes.push(data.duration);
      }
    }
  }

  /**
   * Track LLM event
   */
  trackLLMEvent(event: LLMEvent, data?: LLMEventData): void {
    this.trackEvent(event, TelemetryCategory.LLM, data as Record<string, TelemetryValue>);
    if (event === LLMEvent.RESPONSE_RECEIVED) {
      this.sessionAnalytics.llmRequests++;
      if (data?.ttft) {
        this.performanceMetrics.ttftTimes.push(data.ttft);
      }
      if (data?.totalTime) {
        this.performanceMetrics.responseTimes.push(data.totalTime);
      }
    }
  }

  /**
   * Track TTS event
   */
  trackTTSEvent(event: TTSEvent, data?: TTSEventData): void {
    this.trackEvent(event, TelemetryCategory.TTS, data as Record<string, TelemetryValue>);
  }

  /**
   * Track STT event
   */
  trackSTTEvent(event: STTEvent, data?: STTEventData): void {
    this.trackEvent(event, TelemetryCategory.STT, data as Record<string, TelemetryValue>);
  }

  /**
   * Track UI event
   */
  trackUIEvent(event: UIEvent, data?: Record<string, TelemetryValue>): void {
    this.trackEvent(event, TelemetryCategory.UI, data);
  }

  /**
   * Track agent/tool event
   */
  trackAgentEvent(event: AgentEvent, data?: AgentEventData): void {
    this.trackEvent(event, TelemetryCategory.AGENT, data as Record<string, TelemetryValue>);
    if (event === AgentEvent.TOOL_COMPLETED) {
      this.sessionAnalytics.toolUses++;
    }
  }

  /**
   * Track memory event
   */
  trackMemoryEvent(event: MemoryEvent, data?: Record<string, TelemetryValue>): void {
    this.trackEvent(event, TelemetryCategory.MEMORY, data);
  }

  /**
   * Track error event
   */
  trackError(data: ErrorEventData): void {
    if (!this.config.collectErrors) {
      return;
    }
    this.trackEvent(
      ErrorEvent.API_ERROR,
      TelemetryCategory.ERROR,
      data as Record<string, TelemetryValue>
    );
    this.sessionAnalytics.errors++;
  }

  /**
   * Track performance metric
   */
  trackPerformance(metric: string, value: number, unit: PerformanceEventData['unit']): void {
    if (!this.config.collectPerformance) {
      return;
    }
    this.trackEvent(PerformanceEvent.RESPONSE_LATENCY, TelemetryCategory.PERFORMANCE, {
      metric,
      value,
      unit,
    });
  }

  /**
   * Track feature usage
   */
  trackFeatureUsage(featureId: string, featureCategory?: string): void {
    if (!this.config.collectFeatureUsage) {
      return;
    }

    const count = (this.featureUsageCount.get(featureId) || 0) + 1;
    this.featureUsageCount.set(featureId, count);

    if (!this.sessionAnalytics.featuresUsed.includes(featureId)) {
      this.sessionAnalytics.featuresUsed.push(featureId);
    }

    this.trackEvent(FeatureEvent.USED, TelemetryCategory.FEATURE, {
      featureId,
      featureCategory,
      usageCount: count,
    } as FeatureEventData as Record<string, TelemetryValue>);
  }

  // ==========================================================================
  // Public API - Analytics Retrieval
  // ==========================================================================

  /**
   * Get current session analytics
   */
  getSessionAnalytics(): SessionAnalytics {
    return {
      ...this.sessionAnalytics,
      duration: Date.now() - this.sessionStart.getTime(),
      avgResponseLatency: this.calculateAverageLatency(),
    };
  }

  /**
   * Get aggregated performance metrics
   */
  getPerformanceMetrics(): {
    avgResponseTime: number;
    avgTTFT: number;
    avgMemoryUsage: number;
    p50ResponseTime: number;
    p90ResponseTime: number;
    p99ResponseTime: number;
  } {
    return {
      avgResponseTime: this.calculateAverage(this.performanceMetrics.responseTimes),
      avgTTFT: this.calculateAverage(this.performanceMetrics.ttftTimes),
      avgMemoryUsage: this.calculateAverage(this.performanceMetrics.memoryUsage),
      p50ResponseTime: this.calculatePercentile(this.performanceMetrics.responseTimes, 50),
      p90ResponseTime: this.calculatePercentile(this.performanceMetrics.responseTimes, 90),
      p99ResponseTime: this.calculatePercentile(this.performanceMetrics.responseTimes, 99),
    };
  }

  /**
   * Get local event count
   */
  getLocalEventCount(): number {
    try {
      const files = readdirSync(this.config.dataDir);
      return files.filter((f) => f.startsWith('events-') && f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get installation ID (anonymous)
   */
  getInstallationId(): string {
    return this.state.installationId;
  }

  // ==========================================================================
  // Public API - Data Management
  // ==========================================================================

  /**
   * Clear all local analytics data
   * Called when user opts out
   */
  clearAllData(): void {
    try {
      // Clear event buffer
      this.eventBuffer = [];

      // Clear persisted events
      const files = readdirSync(this.config.dataDir);
      for (const file of files) {
        if (file.startsWith('events-') && file.endsWith('.json')) {
          unlinkSync(join(this.config.dataDir, file));
        }
      }

      // Reset session analytics
      this.sessionAnalytics = {
        sessionId: this.sessionId,
        startTime: this.sessionStart.toISOString(),
        voiceInteractions: 0,
        llmRequests: 0,
        toolUses: 0,
        errors: 0,
        featuresUsed: [],
      };

      // Reset performance metrics
      this.performanceMetrics = {
        responseTimes: [],
        ttftTimes: [],
        memoryUsage: [],
        cpuUsage: [],
        frameRates: [],
      };

      this.featureUsageCount.clear();

      logger.info('All analytics data cleared');
      this.emit('data-cleared');
    } catch (error) {
      logger.error('Failed to clear analytics data', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Export local analytics data (for user inspection)
   */
  exportData(): {
    events: TelemetryEvent[];
    session: SessionAnalytics;
    performance: ReturnType<typeof this.getPerformanceMetrics>;
  } {
    const allEvents: TelemetryEvent[] = [...this.eventBuffer];

    // Load persisted events
    try {
      const files = readdirSync(this.config.dataDir);
      for (const file of files) {
        if (file.startsWith('events-') && file.endsWith('.json')) {
          const data = readFileSync(join(this.config.dataDir, file), 'utf-8');
          allEvents.push(...JSON.parse(data));
        }
      }
    } catch {
      // Ignore read errors
    }

    return {
      events: allEvents,
      session: this.getSessionAnalytics(),
      performance: this.getPerformanceMetrics(),
    };
  }

  // ==========================================================================
  // Private Methods - Collection
  // ==========================================================================

  /**
   * Start data collection timers
   */
  private startCollection(): void {
    // Start upload timer if remote endpoint configured
    if (this.config.remoteEndpoint) {
      this.uploadTimer = setInterval(() => {
        this.uploadEvents().catch((err) => {
          logger.error('Failed to upload events', { error: err.message });
        });
      }, this.config.uploadIntervalMs);
    }

    // Start metrics collection timer
    if (this.config.collectPerformance) {
      this.metricsTimer = setInterval(() => {
        this.collectSystemMetrics();
      }, 30000); // Every 30 seconds
    }
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): void {
    if (!this.isEnabled() || !this.config.collectPerformance) {
      return;
    }

    const memUsage = process.memoryUsage();
    this.performanceMetrics.memoryUsage.push(memUsage.heapUsed);

    // Keep only last 100 samples
    if (this.performanceMetrics.memoryUsage.length > 100) {
      this.performanceMetrics.memoryUsage = this.performanceMetrics.memoryUsage.slice(-100);
    }

    // Track periodic performance event
    this.trackEvent(PerformanceEvent.MEMORY_USAGE, TelemetryCategory.PERFORMANCE, {
      value: memUsage.heapUsed,
      unit: 'bytes',
    });
  }

  /**
   * Update session analytics based on event type
   */
  private updateSessionAnalytics(_type: string, _category: TelemetryCategory): void {
    // Analytics are updated in the specific track methods
    // This is a hook for any additional cross-cutting analytics
  }

  // ==========================================================================
  // Private Methods - Persistence
  // ==========================================================================

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!existsSync(this.config.dataDir)) {
      mkdirSync(this.config.dataDir, { recursive: true });
    }
  }

  /**
   * Load analytics state from disk
   */
  private loadState(): AnalyticsState {
    const statePath = join(this.config.dataDir, 'analytics-state.json');

    try {
      if (existsSync(statePath)) {
        const data = readFileSync(statePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.warn('Failed to load analytics state', {
        error: (error as Error).message,
      });
    }

    // Create new state with anonymous installation ID
    return {
      consent: ConsentStatus.NOT_ASKED,
      installationId: this.config.installationId || this.generateInstallationId(),
      totalEventsSent: 0,
    };
  }

  /**
   * Save analytics state to disk
   */
  private saveState(): void {
    const statePath = join(this.config.dataDir, 'analytics-state.json');

    try {
      writeFileSync(statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('Failed to save analytics state', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Persist events to disk
   */
  private persistEvents(): void {
    if (this.eventBuffer.length === 0) {
      return;
    }

    try {
      const filename = `events-${Date.now()}.json`;
      const filepath = join(this.config.dataDir, filename);
      writeFileSync(filepath, JSON.stringify(this.eventBuffer, null, 2));
      this.eventBuffer = [];

      // Clean up old events
      this.cleanupOldEvents();

      logger.debug('Events persisted', { filename });
    } catch (error) {
      logger.error('Failed to persist events', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Flush all events to disk
   */
  private async flushEvents(): Promise<void> {
    if (this.eventBuffer.length > 0) {
      this.persistEvents();
    }

    // Attempt upload if configured
    if (this.config.remoteEndpoint) {
      await this.uploadEvents();
    }
  }

  /**
   * Clean up old event files
   */
  private cleanupOldEvents(): void {
    try {
      const files = readdirSync(this.config.dataDir);
      const eventFiles = files
        .filter((f) => f.startsWith('events-') && f.endsWith('.json'))
        .map((f) => ({
          name: f,
          path: join(this.config.dataDir, f),
          mtime: statSync(join(this.config.dataDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      const maxAge = this.config.maxEventAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      let deleted = 0;
      for (let i = 0; i < eventFiles.length; i++) {
        const file = eventFiles[i];
        // Delete if too old or over limit
        if (i >= this.config.maxLocalEvents || now - file.mtime > maxAge) {
          unlinkSync(file.path);
          deleted++;
        }
      }

      if (deleted > 0) {
        logger.debug('Cleaned up old event files', { deleted });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // ==========================================================================
  // Private Methods - Upload
  // ==========================================================================

  /**
   * Upload events to remote endpoint
   */
  private async uploadEvents(): Promise<void> {
    if (!this.config.remoteEndpoint || !this.isEnabled()) {
      return;
    }

    // Collect all persisted events
    const events: TelemetryEvent[] = [];

    try {
      const files = readdirSync(this.config.dataDir);
      for (const file of files) {
        if (file.startsWith('events-') && file.endsWith('.json')) {
          const data = readFileSync(join(this.config.dataDir, file), 'utf-8');
          events.push(...JSON.parse(data));
        }
      }
    } catch {
      return;
    }

    if (events.length === 0) {
      return;
    }

    try {
      const response = await fetch(this.config.remoteEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Installation-Id': this.state.installationId,
        },
        body: JSON.stringify({
          installationId: this.state.installationId,
          events,
          session: this.getSessionAnalytics(),
        }),
      });

      if (response.ok) {
        // Clear uploaded events
        const files = readdirSync(this.config.dataDir);
        for (const file of files) {
          if (file.startsWith('events-') && file.endsWith('.json')) {
            unlinkSync(join(this.config.dataDir, file));
          }
        }

        this.state.lastUpload = Date.now();
        this.state.totalEventsSent += events.length;
        this.saveState();

        logger.info('Events uploaded', { count: events.length });
      } else {
        logger.warn('Failed to upload events', { status: response.status });
      }
    } catch (error) {
      logger.error('Error uploading events', {
        error: (error as Error).message,
      });
    }
  }

  // ==========================================================================
  // Private Methods - Session Management
  // ==========================================================================

  /**
   * Finalize session analytics
   */
  private finalizeSession(): void {
    this.sessionAnalytics.endTime = new Date().toISOString();
    this.sessionAnalytics.duration = Date.now() - this.sessionStart.getTime();
    this.sessionAnalytics.avgResponseLatency = this.calculateAverageLatency();

    // Persist session summary
    if (this.isEnabled()) {
      try {
        const filename = `session-${this.sessionId}.json`;
        const filepath = join(this.config.dataDir, filename);
        writeFileSync(filepath, JSON.stringify(this.sessionAnalytics, null, 2));
      } catch {
        // Ignore save errors
      }
    }
  }

  // ==========================================================================
  // Private Methods - Utilities
  // ==========================================================================

  /**
   * Generate anonymous session ID
   */
  private generateSessionId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Generate anonymous installation ID
   * This is a stable identifier that persists across sessions
   * but cannot be linked to any personal information
   */
  private generateInstallationId(): string {
    // Create a hash based on random data
    // This ensures the ID is anonymous but stable
    const randomData = randomBytes(32);
    return createHash('sha256').update(randomData).digest('hex').substring(0, 32);
  }

  /**
   * Calculate average latency
   */
  private calculateAverageLatency(): number {
    return this.calculateAverage(this.performanceMetrics.responseTimes);
  }

  /**
   * Calculate average of array
   */
  private calculateAverage(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate percentile of array
   */
  private calculatePercentile(arr: number[], percentile: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let analyticsInstance: AnalyticsManager | null = null;

/**
 * Get or create the analytics manager instance
 */
export function getAnalytics(config?: AnalyticsConfig): AnalyticsManager {
  if (!analyticsInstance) {
    analyticsInstance = new AnalyticsManager(config);
  }
  return analyticsInstance;
}

/**
 * Initialize and get the analytics manager
 */
export function initializeAnalytics(config?: AnalyticsConfig): AnalyticsManager {
  const analytics = getAnalytics(config);
  analytics.initialize();
  return analytics;
}

/**
 * Shutdown the analytics manager
 */
export async function shutdownAnalytics(): Promise<void> {
  if (analyticsInstance) {
    await analyticsInstance.shutdown();
    analyticsInstance = null;
  }
}

/**
 * Track an event (convenience function)
 * Only records if user has opted in
 */
export function trackEvent(
  type: string,
  category: TelemetryCategory,
  properties?: Record<string, TelemetryValue>,
  metrics?: Record<string, number>
): void {
  if (analyticsInstance) {
    analyticsInstance.trackEvent(type, category, properties, metrics);
  }
}

/**
 * Track feature usage (convenience function)
 */
export function trackFeature(featureId: string, featureCategory?: string): void {
  if (analyticsInstance) {
    analyticsInstance.trackFeatureUsage(featureId, featureCategory);
  }
}

/**
 * Check if analytics is enabled
 */
export function isAnalyticsEnabled(): boolean {
  return analyticsInstance?.isEnabled() ?? false;
}

/**
 * Set analytics consent
 */
export function setAnalyticsConsent(optIn: boolean): void {
  if (analyticsInstance) {
    analyticsInstance.setConsent(optIn);
  }
}

// Re-export types and events for convenience
export {
  TelemetryCategory,
  TelemetryEvent,
  TelemetryValue,
  SessionAnalytics,
  AppEvent,
  VoiceEvent,
  LLMEvent,
  TTSEvent,
  STTEvent,
  UIEvent,
  AgentEvent,
  MemoryEvent,
  ErrorEvent,
  PerformanceEvent,
  FeatureEvent,
  DATA_COLLECTION_DISCLOSURE,
} from './events';
