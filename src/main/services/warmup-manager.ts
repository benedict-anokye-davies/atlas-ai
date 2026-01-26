/**
 * Atlas Desktop - Connection Warmup Manager
 *
 * Pre-establishes API connections on app startup to reduce first-request latency.
 * Implements connection pooling, keep-alive pings, and idle-time preloading.
 *
 * US-002: Connection Warmup
 * Target: Reduce first response latency by having warm connections ready
 *
 * Features:
 * - HTTP connection pooling with keep-alive
 * - Real API endpoint warmup (lightweight health checks)
 * - Idle-time resource preloading
 * - Connection status monitoring with IPC events
 */

import { EventEmitter } from 'events';
import { BrowserWindow, powerMonitor } from 'electron';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { sleep } from '../../shared/utils';
import http from 'http';
import https from 'https';

const logger = createModuleLogger('WarmupManager');
const perfTimer = new PerformanceTimer('WarmupManager');

// HTTP/HTTPS agents with connection pooling and keep-alive
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 30000,
});

/**
 * Connection status for a service
 */
export interface ConnectionStatus {
  service: string;
  connected: boolean;
  lastPing: number;
  latencyMs: number;
  errorCount: number;
  lastError?: string;
}

/**
 * Warmup manager configuration
 */
export interface WarmupManagerConfig {
  /** Enable connection warmup on startup */
  enabled: boolean;
  /** Interval for keep-alive pings (ms) */
  keepAliveIntervalMs: number;
  /** Timeout for warmup requests (ms) */
  warmupTimeoutMs: number;
  /** Max retries for failed warmup */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelayMs: number;
  /** Services to warm up */
  services: {
    llm: boolean;
    stt: boolean;
    tts: boolean;
    memory: boolean;
  };
}

/**
 * Default warmup configuration
 */
export const DEFAULT_WARMUP_CONFIG: WarmupManagerConfig = {
  enabled: true,
  keepAliveIntervalMs: 30000, // 30 seconds
  warmupTimeoutMs: 10000, // 10 seconds
  maxRetries: 3,
  retryDelayMs: 1000,
  services: {
    llm: true,
    stt: true,
    tts: true,
    memory: true,
  },
};

/**
 * Warmup manager events
 */
export interface WarmupManagerEvents {
  /** All services warmed up */
  'warmup-complete': (results: Map<string, ConnectionStatus>) => void;
  /** Single service warmed up */
  'service-ready': (service: string, status: ConnectionStatus) => void;
  /** Service warmup failed */
  'service-failed': (service: string, error: Error) => void;
  /** Keep-alive ping completed */
  'ping-complete': (service: string, latencyMs: number) => void;
  /** Connection lost */
  'connection-lost': (service: string, error: Error) => void;
}

/**
 * Connection Warmup Manager
 * Pre-establishes and maintains warm connections to all Atlas services
 */
export class WarmupManager extends EventEmitter {
  private config: WarmupManagerConfig;
  private connectionStatus: Map<string, ConnectionStatus> = new Map();
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private isWarmedUp: boolean = false;
  private warmupPromise: Promise<void> | null = null;

  constructor(config?: Partial<WarmupManagerConfig>) {
    super();
    this.config = { ...DEFAULT_WARMUP_CONFIG, ...config };

    // Initialize connection status for each service
    const services = ['llm', 'stt', 'tts', 'memory'];
    for (const service of services) {
      this.connectionStatus.set(service, {
        service,
        connected: false,
        lastPing: 0,
        latencyMs: 0,
        errorCount: 0,
      });
    }

    logger.info('WarmupManager initialized', {
      enabled: this.config.enabled,
      keepAliveInterval: this.config.keepAliveIntervalMs,
    });
  }

  /**
   * Warm up all configured services
   * Returns a promise that resolves when all services are ready
   */
  async warmup(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Warmup disabled, skipping');
      return;
    }

    if (this.warmupPromise) {
      return this.warmupPromise;
    }

    logger.info('Starting connection warmup...');
    const startTime = performance.now();

    this.warmupPromise = this.performWarmup();

    try {
      await this.warmupPromise;
      const duration = performance.now() - startTime;
      logger.info('Connection warmup complete', { durationMs: duration.toFixed(2) });
    } finally {
      this.warmupPromise = null;
    }
  }

  /**
   * Perform the actual warmup sequence
   */
  private async performWarmup(): Promise<void> {
    perfTimer.start('performWarmup');
    const warmupTasks: Promise<void>[] = [];

    if (this.config.services.llm) {
      warmupTasks.push(this.warmupLLM());
    }
    if (this.config.services.stt) {
      warmupTasks.push(this.warmupSTT());
    }
    if (this.config.services.tts) {
      warmupTasks.push(this.warmupTTS());
    }
    if (this.config.services.memory) {
      warmupTasks.push(this.warmupMemory());
    }

    // Run all warmups in parallel
    await Promise.allSettled(warmupTasks);

    this.isWarmedUp = true;
    perfTimer.end('performWarmup');

    this.emit('warmup-complete', this.connectionStatus);

    // Send final status to renderer
    this.sendStatusToRenderer();

    // Start keep-alive pings
    this.startKeepAlive();

    // Start idle-time preloading
    this.startIdlePreloading();

    logger.info('Warmup complete', {
      avgLatencyMs: this.getAverageLatency().toFixed(2),
      servicesReady: Array.from(this.connectionStatus.entries())
        .filter(([, s]) => s.connected)
        .map(([name]) => name),
    });
  }

  /**
   * Warm up LLM service (Fireworks AI)
   * Makes a real HTTP request to establish TCP connection and warm up TLS
   */
  private async warmupLLM(): Promise<void> {
    const service = 'llm';
    const status = this.connectionStatus.get(service)!;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        // Import LLM manager lazily to avoid circular dependencies
        const { getLLMManager } = await import('../llm/manager');
        const llmManager = getLLMManager();

        // Check provider is available
        const providerType = llmManager.getActiveProviderType();
        if (!providerType) {
          throw new Error('No LLM provider available');
        }

        // Create initial context to warm up tokenizer/etc
        llmManager.createContext();

        // Make a real HTTP request to Fireworks API to warm up connection
        // Use models list endpoint as it's lightweight
        const config = llmManager.getConfig();
        if (config.apiKey) {
          const httpLatency = await this.warmupHTTPConnection(
            'https://api.fireworks.ai/inference/v1/models',
            config.apiKey,
            'Bearer'
          );
          logger.debug('Fireworks HTTP warmup', { httpLatencyMs: httpLatency.toFixed(2) });
        }

        const latency = performance.now() - startTime;

        status.connected = true;
        status.lastPing = Date.now();
        status.latencyMs = latency;
        status.errorCount = 0;
        status.lastError = undefined;

        logger.info('LLM warmup complete', { provider: providerType, latencyMs: latency.toFixed(2) });
        this.emit('service-ready', service, status);
        this.sendStatusToRenderer();
        return;
      } catch (error) {
        status.errorCount++;
        status.lastError = (error as Error).message;
        logger.warn('LLM warmup attempt failed', { attempt: attempt + 1, error: status.lastError });

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    this.emit('service-failed', service, new Error(status.lastError || 'LLM warmup failed'));
    this.sendStatusToRenderer();
  }

  /**
   * Warm up STT service (Deepgram)
   * Makes a real HTTP request to establish connection and validate API key
   */
  private async warmupSTT(): Promise<void> {
    const service = 'stt';
    const status = this.connectionStatus.get(service)!;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        // Import STT manager lazily
        const { getSTTManager } = await import('../stt/manager');
        const sttManager = getSTTManager();

        // Check if STT is available
        const providerType = sttManager.getActiveProviderType();
        if (!providerType) {
          throw new Error('No STT provider available');
        }

        // If using Deepgram, make a real HTTP request to warm up connection
        if (providerType === 'deepgram') {
          const config = sttManager.getConfig();
          if (config.apiKey) {
            // Use projects endpoint as lightweight warmup
            const httpLatency = await this.warmupHTTPConnection(
              'https://api.deepgram.com/v1/projects',
              config.apiKey,
              'Token'
            );
            logger.debug('Deepgram HTTP warmup', { httpLatencyMs: httpLatency.toFixed(2) });
          }
        }

        const latency = performance.now() - startTime;

        status.connected = true;
        status.lastPing = Date.now();
        status.latencyMs = latency;
        status.errorCount = 0;
        status.lastError = undefined;

        logger.info('STT warmup complete', { provider: providerType, latencyMs: latency.toFixed(2) });
        this.emit('service-ready', service, status);
        this.sendStatusToRenderer();
        return;
      } catch (error) {
        status.errorCount++;
        status.lastError = (error as Error).message;
        logger.warn('STT warmup attempt failed', { attempt: attempt + 1, error: status.lastError });

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    this.emit('service-failed', service, new Error(status.lastError || 'STT warmup failed'));
    this.sendStatusToRenderer();
  }

  /**
   * Warm up TTS service (Cartesia)
   * Makes a real HTTP request to establish connection
   */
  private async warmupTTS(): Promise<void> {
    const service = 'tts';
    const status = this.connectionStatus.get(service)!;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        // Import TTS manager lazily with proper config
        const { getTTSManager } = await import('../tts/manager');
        const { getConfig } = await import('../config');
        const appConfig = getConfig();

        // Pass Cartesia config so singleton is created correctly
        // Cartesia is the only online provider (~90ms latency)
        const ttsManager = getTTSManager({
          cartesia: appConfig.cartesiaApiKey
            ? {
                apiKey: appConfig.cartesiaApiKey,
                voiceId: appConfig.cartesiaVoiceId,
              }
            : undefined,
          preferredProvider: 'cartesia',
          autoFallback: true,
        });

        // Check if TTS is available
        const providerType = ttsManager.getActiveProviderType();
        if (!providerType) {
          throw new Error('No TTS provider available');
        }

        // If using Cartesia, make a real HTTP request to warm up connection
        if (providerType === 'cartesia') {
          // Cartesia uses WebSocket, but we can ping their API status endpoint to warm up
          const httpLatency = await this.warmupCartesiaConnection(appConfig.cartesiaApiKey || '');
          logger.debug('Cartesia HTTP warmup', { httpLatencyMs: httpLatency.toFixed(2) });
        }

        const latency = performance.now() - startTime;

        status.connected = true;
        status.lastPing = Date.now();
        status.latencyMs = latency;
        status.errorCount = 0;
        status.lastError = undefined;

        logger.info('TTS warmup complete', { provider: providerType, latencyMs: latency.toFixed(2) });
        this.emit('service-ready', service, status);
        this.sendStatusToRenderer();
        return;
      } catch (error) {
        status.errorCount++;
        status.lastError = (error as Error).message;
        logger.warn('TTS warmup attempt failed', { attempt: attempt + 1, error: status.lastError });

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    this.emit('service-failed', service, new Error(status.lastError || 'TTS warmup failed'));
    this.sendStatusToRenderer();
  }

  /**
   * Warm up Memory service (LanceDB connection)
   */
  private async warmupMemory(): Promise<void> {
    const service = 'memory';
    const status = this.connectionStatus.get(service)!;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const startTime = performance.now();

        // Import memory manager lazily
        const { getMemoryManager } = await import('../memory');
        const memoryManager = await getMemoryManager();

        // Check if memory is initialized
        if (!memoryManager) {
          throw new Error('Memory manager not available');
        }

        const latency = performance.now() - startTime;

        status.connected = true;
        status.lastPing = Date.now();
        status.latencyMs = latency;
        status.errorCount = 0;
        status.lastError = undefined;

        logger.info('Memory warmup complete', { latencyMs: latency.toFixed(2) });
        this.emit('service-ready', service, status);
        return;
      } catch (error) {
        status.errorCount++;
        status.lastError = (error as Error).message;
        logger.warn('Memory warmup attempt failed', { attempt: attempt + 1, error: status.lastError });

        if (attempt < this.config.maxRetries - 1) {
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    this.emit('service-failed', service, new Error(status.lastError || 'Memory warmup failed'));
  }

  /**
   * Start keep-alive ping interval
   */
  private startKeepAlive(): void {
    if (this.keepAliveInterval) {
      return;
    }

    this.keepAliveInterval = setInterval(() => {
      this.pingAllServices();
    }, this.config.keepAliveIntervalMs);

    logger.debug('Keep-alive pings started', { intervalMs: this.config.keepAliveIntervalMs });
  }

  /**
   * Stop keep-alive pings
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      logger.debug('Keep-alive pings stopped');
    }
  }

  /**
   * Ping all services to keep connections alive
   */
  private async pingAllServices(): Promise<void> {
    const pingTasks: Promise<void>[] = [];

    for (const [service, status] of this.connectionStatus) {
      if (status.connected) {
        pingTasks.push(this.pingService(service));
      }
    }

    await Promise.allSettled(pingTasks);
  }

  /**
   * Ping a single service
   */
  private async pingService(service: string): Promise<void> {
    const status = this.connectionStatus.get(service);
    if (!status) return;

    try {
      const startTime = performance.now();

      // Service-specific ping logic
      switch (service) {
        case 'llm':
          await this.pingLLM();
          break;
        case 'stt':
          await this.pingSTT();
          break;
        case 'tts':
          await this.pingTTS();
          break;
        case 'memory':
          await this.pingMemory();
          break;
      }

      const latency = performance.now() - startTime;
      status.lastPing = Date.now();
      status.latencyMs = latency;
      status.errorCount = 0;

      this.emit('ping-complete', service, latency);
    } catch (error) {
      status.errorCount++;
      status.lastError = (error as Error).message;

      // Mark as disconnected after multiple failures
      if (status.errorCount >= 3) {
        status.connected = false;
        this.emit('connection-lost', service, error as Error);
        logger.warn('Service connection lost', { service, error: status.lastError });
      }
    }
  }

  /**
   * Ping LLM service
   */
  private async pingLLM(): Promise<void> {
    const { getLLMManager } = await import('../llm/manager');
    const llmManager = getLLMManager();

    // Just verify provider is still available
    const providerType = llmManager.getActiveProviderType();
    if (!providerType) {
      throw new Error('LLM provider unavailable');
    }
  }

  /**
   * Ping STT service
   */
  private async pingSTT(): Promise<void> {
    const { getSTTManager } = await import('../stt/manager');
    const sttManager = getSTTManager();

    const providerType = sttManager.getActiveProviderType();
    if (!providerType) {
      throw new Error('STT provider unavailable');
    }
  }

  /**
   * Ping TTS service
   */
  private async pingTTS(): Promise<void> {
    const { getTTSManager } = await import('../tts/manager');
    const ttsManager = getTTSManager();

    const providerType = ttsManager.getActiveProviderType();
    if (!providerType) {
      throw new Error('TTS provider unavailable');
    }
  }

  /**
   * Ping Memory service
   */
  private async pingMemory(): Promise<void> {
    const { getMemoryManager } = await import('../memory');
    const memoryManager = await getMemoryManager();

    if (!memoryManager) {
      throw new Error('Memory manager unavailable');
    }
  }

  /**
   * Get connection status for all services
   */
  getStatus(): Map<string, ConnectionStatus> {
    return new Map(this.connectionStatus);
  }

  /**
   * Get connection status for a specific service
   */
  getServiceStatus(service: string): ConnectionStatus | undefined {
    return this.connectionStatus.get(service);
  }

  /**
   * Check if all services are warmed up
   */
  isReady(): boolean {
    return this.isWarmedUp;
  }

  /**
   * Check if a specific service is connected
   */
  isServiceConnected(service: string): boolean {
    return this.connectionStatus.get(service)?.connected ?? false;
  }

  /**
   * Get overall health status
   */
  getHealthStatus(): { healthy: boolean; services: Record<string, boolean> } {
    const services: Record<string, boolean> = {};
    let allHealthy = true;

    for (const [service, status] of this.connectionStatus) {
      services[service] = status.connected;
      if (!status.connected) {
        allHealthy = false;
      }
    }

    return { healthy: allHealthy, services };
  }

  /**
   * Force reconnect a service
   */
  async reconnect(service: string): Promise<void> {
    logger.info('Forcing reconnect', { service });

    switch (service) {
      case 'llm':
        await this.warmupLLM();
        break;
      case 'stt':
        await this.warmupSTT();
        break;
      case 'tts':
        await this.warmupTTS();
        break;
      case 'memory':
        await this.warmupMemory();
        break;
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return sleep(ms);
  }

  /**
   * Make a real HTTP request to warm up connection pooling
   * Uses keep-alive agent for connection reuse
   */
  private async warmupHTTPConnection(
    url: string,
    apiKey: string,
    authType: 'Bearer' | 'Token' | 'xi-api-key' = 'Bearer'
  ): Promise<number> {
    const startTime = performance.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Connection': 'keep-alive',
    };

    // Set auth header based on type
    if (authType === 'Bearer') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (authType === 'Token') {
      headers['Authorization'] = `Token ${apiKey}`;
    } else if (authType === 'xi-api-key') {
      headers['xi-api-key'] = apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.warmupTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        // @ts-expect-error - Node.js fetch supports agent option
        agent: httpsAgent,
      });

      clearTimeout(timeout);

      if (!response.ok && response.status !== 401 && response.status !== 403) {
        // Allow auth errors since we're just warming up the connection
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return performance.now() - startTime;
    } catch (error) {
      clearTimeout(timeout);
      if ((error as Error).name === 'AbortError') {
        throw new Error('Connection warmup timed out');
      }
      throw error;
    }
  }

  /**
   * Warm up Cartesia API connection with proper headers
   * Cartesia requires Authorization: Bearer and Cartesia-Version headers
   */
  private async warmupCartesiaConnection(apiKey: string): Promise<number> {
    const startTime = performance.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Connection': 'keep-alive',
      'Authorization': `Bearer ${apiKey}`,
      'Cartesia-Version': '2024-06-10', // Required version header
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.warmupTimeoutMs);

    try {
      // Use the API status endpoint for warmup
      const response = await fetch('https://api.cartesia.ai/', {
        method: 'GET',
        headers,
        signal: controller.signal,
        // @ts-expect-error - Node.js fetch supports agent option
        agent: httpsAgent,
      });

      clearTimeout(timeout);

      // For warmup we just care that we got a response (connection is warm)
      // Don't fail on 4xx as we're just warming the TCP connection
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return performance.now() - startTime;
    } catch (error) {
      clearTimeout(timeout);
      if ((error as Error).name === 'AbortError') {
        throw new Error('Cartesia connection warmup timed out');
      }
      throw error;
    }
  }

  /**
   * Send warmup status to renderer via IPC
   */
  private sendStatusToRenderer(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('atlas:warmup-status', this.getHealthStatus());
    }
  }

  /**
   * Start idle-time preloading
   * Pre-loads resources when system is idle
   */
  startIdlePreloading(): void {
    // Listen for system idle events
    powerMonitor.on('unlock-screen', () => {
      logger.debug('Screen unlocked, refreshing connections');
      this.pingAllServices();
    });

    powerMonitor.on('resume', () => {
      logger.debug('System resumed, refreshing connections');
      // Wait a bit for network to stabilize
      setTimeout(() => {
        this.pingAllServices();
      }, 2000);
    });

    // Check if we should preload when system becomes idle
    this.scheduleIdlePreload();
  }

  /**
   * Schedule preloading during idle time
   */
  private scheduleIdlePreload(): void {
    // Use idle time to preload resources
    const checkIdleAndPreload = () => {
      const idleTime = powerMonitor.getSystemIdleTime();
      // If system has been idle for more than 30 seconds, preload
      if (idleTime > 30) {
        this.preloadResources().catch((error) => {
          logger.debug('Idle preload failed', { error: error.message });
        });
      }
    };

    // Check every minute for idle time
    setInterval(checkIdleAndPreload, 60000);
  }

  /**
   * Preload resources during idle time
   * This helps reduce latency for first interaction
   */
  private async preloadResources(): Promise<void> {
    perfTimer.start('idlePreload');
    logger.debug('Preloading resources during idle time');

    try {
      // Preload LLM tokenizer and context
      const { getLLMManager } = await import('../llm/manager');
      const llmManager = getLLMManager();
      if (llmManager.getActiveProviderType()) {
        llmManager.createContext();
      }

      // Ping services to keep connections warm
      await this.pingAllServices();

      perfTimer.end('idlePreload');
      logger.debug('Idle preload complete');
    } catch (error) {
      perfTimer.end('idlePreload');
      logger.debug('Idle preload failed', { error: (error as Error).message });
    }
  }

  /**
   * Get average latency across services
   */
  getAverageLatency(): number {
    let totalLatency = 0;
    let count = 0;

    for (const status of this.connectionStatus.values()) {
      if (status.connected && status.latencyMs > 0) {
        totalLatency += status.latencyMs;
        count++;
      }
    }

    return count > 0 ? totalLatency / count : 0;
  }

  /**
   * Get the HTTP/HTTPS agents for reuse
   */
  getAgents(): { http: typeof httpAgent; https: typeof httpsAgent } {
    return { http: httpAgent, https: httpsAgent };
  }

  /**
   * Shutdown the warmup manager
   */
  shutdown(): void {
    this.stopKeepAlive();
    this.connectionStatus.clear();
    this.isWarmedUp = false;

    // Destroy connection pools
    httpAgent.destroy();
    httpsAgent.destroy();

    logger.info('WarmupManager shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof WarmupManagerEvents>(event: K, listener: WarmupManagerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof WarmupManagerEvents>(event: K, listener: WarmupManagerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof WarmupManagerEvents>(
    event: K,
    ...args: Parameters<WarmupManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let warmupManager: WarmupManager | null = null;

/**
 * Get or create the warmup manager instance
 */
export function getWarmupManager(config?: Partial<WarmupManagerConfig>): WarmupManager {
  if (!warmupManager) {
    warmupManager = new WarmupManager(config);
  }
  return warmupManager;
}

/**
 * Shutdown the warmup manager
 */
export function shutdownWarmupManager(): void {
  if (warmupManager) {
    warmupManager.shutdown();
    warmupManager = null;
  }
}

export default WarmupManager;
