/**
 * Atlas Desktop - Network Optimizer
 * Comprehensive network optimization with deduplication, pooling, retry, and queueing
 */

import { EventEmitter } from 'events';
import { net } from 'electron';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { AtlasError, withRetry, RetryOptions, CircuitBreaker, sleep } from '../utils/errors';

const logger = createModuleLogger('NetworkOptimizer');
const perfTimer = new PerformanceTimer('NetworkOptimizer');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Request priority levels
 */
export enum RequestPriority {
  CRITICAL = 0, // Authentication, errors
  HIGH = 1, // User-initiated requests
  NORMAL = 2, // Standard API calls
  LOW = 3, // Background sync, prefetch
  BACKGROUND = 4, // Analytics, telemetry
}

/**
 * Network request configuration
 */
export interface NetworkRequest {
  /** Unique request identifier */
  id: string;
  /** Target URL */
  url: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: string | Buffer;
  /** Request priority */
  priority?: RequestPriority;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Service name for connection pooling */
  service?: string;
  /** Enable request deduplication */
  deduplicate?: boolean;
  /** Custom retry options */
  retryOptions?: Partial<RetryOptions>;
  /** Abort signal */
  signal?: AbortSignal;
  /** Allow caching of GET requests */
  cache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtl?: number;
}

/**
 * Network response
 */
export interface NetworkResponse<T = unknown> {
  /** Response status code */
  status: number;
  /** Response status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body */
  data: T;
  /** Request latency in milliseconds */
  latency: number;
  /** Whether response came from cache */
  cached: boolean;
  /** Request ID */
  requestId: string;
}

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  /** Maximum concurrent connections per service */
  maxConnections: number;
  /** Idle connection timeout in milliseconds */
  idleTimeout: number;
  /** Keep-alive interval in milliseconds */
  keepAliveInterval: number;
}

/**
 * Bandwidth throttle configuration
 */
export interface ThrottleConfig {
  /** Maximum requests per second */
  maxRequestsPerSecond: number;
  /** Burst allowance (additional requests allowed in burst) */
  burstSize: number;
}

/**
 * Network optimizer configuration
 */
export interface NetworkOptimizerConfig {
  /** Default request timeout in milliseconds */
  defaultTimeout: number;
  /** Connection pool settings per service */
  connectionPools: Record<string, ConnectionPoolConfig>;
  /** Default connection pool settings */
  defaultPoolConfig: ConnectionPoolConfig;
  /** Request retry options */
  retryOptions: RetryOptions;
  /** Enable request deduplication */
  enableDeduplication: boolean;
  /** Deduplication window in milliseconds */
  deduplicationWindow: number;
  /** Enable offline queue */
  enableOfflineQueue: boolean;
  /** Maximum offline queue size */
  maxOfflineQueueSize: number;
  /** Bandwidth throttle settings per service */
  throttleConfig: Record<string, ThrottleConfig>;
  /** Enable network status monitoring */
  enableMonitoring: boolean;
  /** Monitoring check interval in milliseconds */
  monitoringInterval: number;
  /** Response cache TTL in milliseconds */
  defaultCacheTtl: number;
  /** Maximum cache size */
  maxCacheSize: number;
}

/**
 * Network status information
 */
export interface NetworkStatus {
  isOnline: boolean;
  lastCheck: number;
  latency: number | null;
  queuedRequests: number;
  activeConnections: number;
  failedServices: string[];
}

/**
 * Queued request for offline mode
 */
interface QueuedRequest {
  request: NetworkRequest;
  resolve: (value: NetworkResponse) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  attempts: number;
}

/**
 * In-flight request for deduplication
 */
interface InFlightRequest {
  promise: Promise<NetworkResponse>;
  timestamp: number;
  subscribers: number;
}

/**
 * Cached response entry
 */
interface CachedResponse {
  response: NetworkResponse;
  timestamp: number;
  ttl: number;
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: NetworkOptimizerConfig = {
  defaultTimeout: 30000,
  connectionPools: {
    fireworks: { maxConnections: 5, idleTimeout: 60000, keepAliveInterval: 30000 },
    deepgram: { maxConnections: 3, idleTimeout: 30000, keepAliveInterval: 15000 },
    elevenlabs: { maxConnections: 3, idleTimeout: 30000, keepAliveInterval: 15000 },
    openrouter: { maxConnections: 5, idleTimeout: 60000, keepAliveInterval: 30000 },
  },
  defaultPoolConfig: { maxConnections: 10, idleTimeout: 60000, keepAliveInterval: 30000 },
  retryOptions: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  enableDeduplication: true,
  deduplicationWindow: 5000,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 100,
  throttleConfig: {
    fireworks: { maxRequestsPerSecond: 10, burstSize: 5 },
    deepgram: { maxRequestsPerSecond: 20, burstSize: 10 },
    elevenlabs: { maxRequestsPerSecond: 10, burstSize: 5 },
    default: { maxRequestsPerSecond: 50, burstSize: 20 },
  },
  enableMonitoring: true,
  monitoringInterval: 30000,
  defaultCacheTtl: 300000, // 5 minutes
  maxCacheSize: 100,
};

// ============================================================================
// Network Optimizer Class
// ============================================================================

/**
 * NetworkOptimizer - Centralized network request management
 *
 * Features:
 * - Request deduplication: Identical concurrent requests share a single network call
 * - Connection pooling: Manages connections per service for optimal reuse
 * - Retry with exponential backoff: Automatic retry for transient failures
 * - Request prioritization: Critical requests bypass queues
 * - Bandwidth throttling: Rate limiting per service
 * - Offline queue: Queues requests when offline, replays when online
 * - Network status monitoring: Tracks connectivity and service health
 * - Response caching: Caches GET responses to reduce API calls
 */
export class NetworkOptimizer extends EventEmitter {
  private config: NetworkOptimizerConfig;
  private isOnline = true;
  private lastNetworkCheck = 0;
  private networkLatency: number | null = null;

  // Request management
  private inFlightRequests = new Map<string, InFlightRequest>();
  private offlineQueue: QueuedRequest[] = [];
  private priorityQueues: Map<RequestPriority, NetworkRequest[]> = new Map();

  // Connection management
  private activeConnections = new Map<string, number>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  // Rate limiting
  private tokenBuckets = new Map<string, TokenBucket>();

  // Caching
  private responseCache = new Map<string, CachedResponse>();

  // Monitoring
  private monitoringInterval: NodeJS.Timeout | null = null;
  private failedServices = new Set<string>();

  constructor(config?: Partial<NetworkOptimizerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize priority queues
    for (const priority of Object.values(RequestPriority).filter(
      (v) => typeof v === 'number'
    ) as RequestPriority[]) {
      this.priorityQueues.set(priority, []);
    }

    // Initialize token buckets for known services
    this.initializeTokenBuckets();

    // Start network monitoring
    if (this.config.enableMonitoring) {
      this.startMonitoring();
    }

    logger.info('NetworkOptimizer initialized', {
      deduplication: this.config.enableDeduplication,
      offlineQueue: this.config.enableOfflineQueue,
      monitoring: this.config.enableMonitoring,
    });
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Execute a network request with all optimizations
   */
  async request<T = unknown>(request: NetworkRequest): Promise<NetworkResponse<T>> {
    const requestId = request.id || this.generateRequestId();
    const enhancedRequest = { ...request, id: requestId };

    perfTimer.start(`request-${requestId}`);

    try {
      // Check cache for GET requests
      if (request.method === 'GET' && request.cache !== false) {
        const cached = this.getCachedResponse<T>(request.url);
        if (cached) {
          perfTimer.end(`request-${requestId}`);
          return { ...cached, requestId, cached: true };
        }
      }

      // Check if offline and queue if enabled
      if (!this.isOnline && this.config.enableOfflineQueue) {
        return this.queueRequest<T>(enhancedRequest);
      }

      // Apply rate limiting
      await this.waitForToken(request.service || 'default');

      // Check for deduplication
      if (this.config.enableDeduplication && request.deduplicate !== false) {
        const dedupeKey = this.getDeduplicationKey(request);
        const inFlight = this.inFlightRequests.get(dedupeKey);

        if (inFlight && Date.now() - inFlight.timestamp < this.config.deduplicationWindow) {
          logger.debug('Request deduplicated', { requestId, dedupeKey: dedupeKey.slice(0, 16) });
          inFlight.subscribers++;
          return inFlight.promise as Promise<NetworkResponse<T>>;
        }
      }

      // Execute the request
      const response = await this.executeRequest<T>(enhancedRequest);

      // Cache successful GET responses
      if (request.method === 'GET' && request.cache !== false && response.status < 400) {
        this.cacheResponse(request.url, response, request.cacheTtl);
      }

      perfTimer.end(`request-${requestId}`);
      return response;
    } catch (error) {
      perfTimer.end(`request-${requestId}`);

      // Queue for retry if offline error
      if (this.isOfflineError(error as Error) && this.config.enableOfflineQueue) {
        this.setOffline();
        return this.queueRequest<T>(enhancedRequest);
      }

      throw error;
    }
  }

  /**
   * Execute a GET request
   */
  async get<T = unknown>(
    url: string,
    options?: Partial<Omit<NetworkRequest, 'url' | 'method'>>
  ): Promise<NetworkResponse<T>> {
    return this.request<T>({
      id: this.generateRequestId(),
      url,
      method: 'GET',
      ...options,
    });
  }

  /**
   * Execute a POST request
   */
  async post<T = unknown>(
    url: string,
    body?: string | Buffer | object,
    options?: Partial<Omit<NetworkRequest, 'url' | 'method' | 'body'>>
  ): Promise<NetworkResponse<T>> {
    return this.request<T>({
      id: this.generateRequestId(),
      url,
      method: 'POST',
      body: typeof body === 'object' && !(body instanceof Buffer) ? JSON.stringify(body) : body,
      ...options,
    });
  }

  /**
   * Execute a PUT request
   */
  async put<T = unknown>(
    url: string,
    body?: string | Buffer | object,
    options?: Partial<Omit<NetworkRequest, 'url' | 'method' | 'body'>>
  ): Promise<NetworkResponse<T>> {
    return this.request<T>({
      id: this.generateRequestId(),
      url,
      method: 'PUT',
      body: typeof body === 'object' && !(body instanceof Buffer) ? JSON.stringify(body) : body,
      ...options,
    });
  }

  /**
   * Execute a DELETE request
   */
  async delete<T = unknown>(
    url: string,
    options?: Partial<Omit<NetworkRequest, 'url' | 'method'>>
  ): Promise<NetworkResponse<T>> {
    return this.request<T>({
      id: this.generateRequestId(),
      url,
      method: 'DELETE',
      ...options,
    });
  }

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus {
    return {
      isOnline: this.isOnline,
      lastCheck: this.lastNetworkCheck,
      latency: this.networkLatency,
      queuedRequests: this.offlineQueue.length,
      activeConnections: this.getTotalActiveConnections(),
      failedServices: Array.from(this.failedServices),
    };
  }

  /**
   * Force a network connectivity check
   */
  async checkConnectivity(): Promise<boolean> {
    return this.performConnectivityCheck();
  }

  /**
   * Manually set online status
   */
  setOnline(): void {
    if (!this.isOnline) {
      this.isOnline = true;
      logger.info('Network status changed to online');
      this.emit('online');
      this.processOfflineQueue();
    }
  }

  /**
   * Manually set offline status
   */
  setOffline(): void {
    if (this.isOnline) {
      this.isOnline = false;
      logger.info('Network status changed to offline');
      this.emit('offline');
    }
  }

  /**
   * Get offline queue status
   */
  getQueueStatus(): { size: number; oldestRequest: number | null } {
    return {
      size: this.offlineQueue.length,
      oldestRequest: this.offlineQueue.length > 0 ? this.offlineQueue[0].queuedAt : null,
    };
  }

  /**
   * Clear the offline queue
   */
  clearQueue(): void {
    const count = this.offlineQueue.length;
    this.offlineQueue.forEach((item) => {
      item.reject(new AtlasError('Queue cleared', 'QUEUE_CLEARED', true));
    });
    this.offlineQueue = [];
    logger.info('Offline queue cleared', { count });
  }

  /**
   * Clear the response cache
   */
  clearCache(): void {
    const count = this.responseCache.size;
    this.responseCache.clear();
    logger.info('Response cache cleared', { count });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NetworkOptimizerConfig>): void {
    this.config = { ...this.config, ...config };

    // Reinitialize token buckets if throttle config changed
    if (config.throttleConfig) {
      this.initializeTokenBuckets();
    }

    // Update monitoring if interval changed
    if (config.monitoringInterval || config.enableMonitoring !== undefined) {
      this.stopMonitoring();
      if (this.config.enableMonitoring) {
        this.startMonitoring();
      }
    }

    logger.info('NetworkOptimizer configuration updated');
  }

  /**
   * Shutdown the network optimizer
   */
  shutdown(): void {
    this.stopMonitoring();
    this.clearQueue();
    this.clearCache();
    this.inFlightRequests.clear();
    this.activeConnections.clear();
    this.circuitBreakers.clear();
    this.tokenBuckets.clear();
    this.removeAllListeners();
    logger.info('NetworkOptimizer shutdown complete');
  }

  // ============================================================================
  // Private Methods - Request Execution
  // ============================================================================

  /**
   * Execute a single network request with retry and circuit breaker
   */
  private async executeRequest<T>(request: NetworkRequest): Promise<NetworkResponse<T>> {
    const service = request.service || this.extractServiceFromUrl(request.url);
    const circuitBreaker = this.getCircuitBreaker(service);

    // Track deduplication
    const dedupeKey = this.getDeduplicationKey(request);
    let inFlightEntry: InFlightRequest | undefined;

    if (this.config.enableDeduplication && request.deduplicate !== false) {
      const promise = this.performRequest<T>(request, circuitBreaker);
      inFlightEntry = {
        promise: promise as Promise<NetworkResponse>,
        timestamp: Date.now(),
        subscribers: 1,
      };
      this.inFlightRequests.set(dedupeKey, inFlightEntry);
    }

    try {
      const result = await this.performRequest<T>(request, circuitBreaker);

      // Mark service as healthy
      this.failedServices.delete(service);

      return result;
    } catch (error) {
      // Mark service as failed
      this.failedServices.add(service);
      throw error;
    } finally {
      // Clean up in-flight tracking
      if (inFlightEntry) {
        inFlightEntry.subscribers--;
        if (inFlightEntry.subscribers <= 0) {
          this.inFlightRequests.delete(dedupeKey);
        }
      }
    }
  }

  /**
   * Perform the actual HTTP request
   */
  private async performRequest<T>(
    request: NetworkRequest,
    circuitBreaker: CircuitBreaker
  ): Promise<NetworkResponse<T>> {
    const service = request.service || this.extractServiceFromUrl(request.url);
    const timeout = request.timeout || this.config.defaultTimeout;
    const retryOptions = { ...this.config.retryOptions, ...request.retryOptions };

    // Check connection pool limit
    await this.acquireConnection(service);

    try {
      return await circuitBreaker.execute(async () => {
        return withRetry(
          async () => this.makeHttpRequest<T>(request, timeout),
          {
            ...retryOptions,
            retryCondition: (error: Error) => this.isRetryableError(error),
            onRetry: (attempt, error, delayMs) => {
              logger.warn(`Request retry ${attempt}`, {
                requestId: request.id,
                error: error.message,
                delayMs,
              });
            },
          }
        );
      });
    } finally {
      this.releaseConnection(service);
    }
  }

  /**
   * Make the actual HTTP request using fetch
   */
  private async makeHttpRequest<T>(
    request: NetworkRequest,
    timeout: number
  ): Promise<NetworkResponse<T>> {
    const startTime = Date.now();
    const controller = new AbortController();

    // Handle external abort signal
    if (request.signal) {
      request.signal.addEventListener('abort', () => controller.abort());
    }

    // Set up timeout
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;

      // Parse response body
      let data: T;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        data = (await response.json()) as T;
      } else if (contentType.includes('text/')) {
        data = (await response.text()) as unknown as T;
      } else {
        const buffer = await response.arrayBuffer();
        data = Buffer.from(buffer) as unknown as T;
      }

      // Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const result: NetworkResponse<T> = {
        status: response.status,
        statusText: response.statusText,
        headers,
        data,
        latency,
        cached: false,
        requestId: request.id,
      };

      // Log request completion
      logger.debug('Request completed', {
        requestId: request.id,
        status: response.status,
        latency,
      });

      // Throw for error status codes
      if (!response.ok) {
        throw new NetworkError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          result
        );
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new NetworkError('Request timeout', 0, undefined, true);
      }

      throw error;
    }
  }

  // ============================================================================
  // Private Methods - Offline Queue
  // ============================================================================

  /**
   * Queue a request for later execution
   */
  private queueRequest<T>(request: NetworkRequest): Promise<NetworkResponse<T>> {
    return new Promise((resolve, reject) => {
      if (this.offlineQueue.length >= this.config.maxOfflineQueueSize) {
        // Remove lowest priority oldest request
        const removed = this.offlineQueue.shift();
        if (removed) {
          removed.reject(new AtlasError('Queue full, request dropped', 'QUEUE_OVERFLOW', true));
        }
      }

      const queuedRequest: QueuedRequest = {
        request,
        resolve: resolve as (value: NetworkResponse) => void,
        reject,
        queuedAt: Date.now(),
        attempts: 0,
      };

      // Insert based on priority
      const priority = request.priority ?? RequestPriority.NORMAL;
      const insertIndex = this.offlineQueue.findIndex(
        (q) => (q.request.priority ?? RequestPriority.NORMAL) > priority
      );

      if (insertIndex === -1) {
        this.offlineQueue.push(queuedRequest);
      } else {
        this.offlineQueue.splice(insertIndex, 0, queuedRequest);
      }

      logger.info('Request queued for offline retry', {
        requestId: request.id,
        queueSize: this.offlineQueue.length,
      });

      this.emit('request-queued', request.id);
    });
  }

  /**
   * Process the offline queue when back online
   */
  private async processOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) {
      return;
    }

    logger.info('Processing offline queue', { count: this.offlineQueue.length });

    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const item of queue) {
      if (!this.isOnline) {
        // Back offline, re-queue remaining
        this.offlineQueue.push(item);
        continue;
      }

      try {
        item.attempts++;
        const response = await this.executeRequest(item.request);
        item.resolve(response);
        this.emit('request-dequeued', item.request.id, true);
      } catch (error) {
        if (item.attempts < 3) {
          // Re-queue for retry
          this.offlineQueue.push(item);
        } else {
          item.reject(error as Error);
          this.emit('request-dequeued', item.request.id, false);
        }
      }

      // Small delay between requests to avoid overwhelming
      await sleep(100);
    }
  }

  // ============================================================================
  // Private Methods - Rate Limiting
  // ============================================================================

  /**
   * Initialize token buckets for rate limiting
   */
  private initializeTokenBuckets(): void {
    this.tokenBuckets.clear();

    for (const [service, config] of Object.entries(this.config.throttleConfig)) {
      this.tokenBuckets.set(service, {
        tokens: config.maxRequestsPerSecond + config.burstSize,
        lastRefill: Date.now(),
        maxTokens: config.maxRequestsPerSecond + config.burstSize,
        refillRate: config.maxRequestsPerSecond,
      });
    }
  }

  /**
   * Wait for a token to become available (rate limiting)
   */
  private async waitForToken(service: string): Promise<void> {
    const bucket = this.tokenBuckets.get(service) || this.tokenBuckets.get('default');

    if (!bucket) {
      return; // No rate limiting for this service
    }

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens--;
      return;
    }

    // Wait for a token
    const waitTime = ((1 - bucket.tokens) / bucket.refillRate) * 1000;
    logger.debug('Rate limited, waiting', { service, waitTime });
    await sleep(waitTime);
    bucket.tokens = 0;
  }

  // ============================================================================
  // Private Methods - Connection Pooling
  // ============================================================================

  /**
   * Acquire a connection from the pool
   */
  private async acquireConnection(service: string): Promise<void> {
    const poolConfig = this.config.connectionPools[service] || this.config.defaultPoolConfig;
    const current = this.activeConnections.get(service) || 0;

    if (current >= poolConfig.maxConnections) {
      // Wait for a connection to become available
      logger.debug('Waiting for connection', { service, current, max: poolConfig.maxConnections });

      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const now = this.activeConnections.get(service) || 0;
          if (now < poolConfig.maxConnections) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }

    this.activeConnections.set(service, (this.activeConnections.get(service) || 0) + 1);
  }

  /**
   * Release a connection back to the pool
   */
  private releaseConnection(service: string): void {
    const current = this.activeConnections.get(service) || 0;
    this.activeConnections.set(service, Math.max(0, current - 1));
  }

  /**
   * Get total active connections across all services
   */
  private getTotalActiveConnections(): number {
    let total = 0;
    for (const count of this.activeConnections.values()) {
      total += count;
    }
    return total;
  }

  // ============================================================================
  // Private Methods - Circuit Breaker
  // ============================================================================

  /**
   * Get or create a circuit breaker for a service
   */
  private getCircuitBreaker(service: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(service);

    if (!breaker) {
      breaker = new CircuitBreaker(service, {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
        onStateChange: (from, to) => {
          logger.info(`Circuit breaker state change for ${service}`, { from, to });
          this.emit('circuit-state-change', service, from, to);
        },
      });
      this.circuitBreakers.set(service, breaker);
    }

    return breaker;
  }

  // ============================================================================
  // Private Methods - Caching
  // ============================================================================

  /**
   * Get a cached response if available
   */
  private getCachedResponse<T>(url: string): NetworkResponse<T> | null {
    const cached = this.responseCache.get(url);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.responseCache.delete(url);
      return null;
    }

    logger.debug('Cache hit', { url: url.slice(0, 50) });
    return cached.response as NetworkResponse<T>;
  }

  /**
   * Cache a response
   */
  private cacheResponse<T>(url: string, response: NetworkResponse<T>, ttl?: number): void {
    // Evict if cache is full
    if (this.responseCache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const oldestKey = this.responseCache.keys().next().value;
      if (oldestKey) {
        this.responseCache.delete(oldestKey);
      }
    }

    this.responseCache.set(url, {
      response: response as NetworkResponse,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultCacheTtl,
    });
  }

  // ============================================================================
  // Private Methods - Network Monitoring
  // ============================================================================

  /**
   * Start network monitoring
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }

    // Initial check
    this.performConnectivityCheck();

    this.monitoringInterval = setInterval(() => {
      this.performConnectivityCheck();
    }, this.config.monitoringInterval);

    logger.info('Network monitoring started', { interval: this.config.monitoringInterval });
  }

  /**
   * Stop network monitoring
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Network monitoring stopped');
    }
  }

  /**
   * Perform a connectivity check
   */
  private async performConnectivityCheck(): Promise<boolean> {
    const startTime = Date.now();

    try {
      const wasOnline = this.isOnline;
      this.isOnline = net.isOnline();

      if (this.isOnline) {
        // Measure latency with a simple request
        try {
          const response = await fetch('https://www.google.com/generate_204', {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
          });

          this.networkLatency = Date.now() - startTime;

          if (!response.ok && response.status !== 204) {
            this.isOnline = false;
          }
        } catch {
          // HEAD request failed, but we might still be online
          this.networkLatency = null;
        }
      } else {
        this.networkLatency = null;
      }

      this.lastNetworkCheck = Date.now();

      // Handle state changes
      if (!wasOnline && this.isOnline) {
        logger.info('Network came online', { latency: this.networkLatency });
        this.emit('online');
        this.processOfflineQueue();
      } else if (wasOnline && !this.isOnline) {
        logger.warn('Network went offline');
        this.emit('offline');
      }

      return this.isOnline;
    } catch (error) {
      logger.error('Connectivity check failed', { error: (error as Error).message });
      return this.isOnline;
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get deduplication key for a request
   */
  private getDeduplicationKey(request: NetworkRequest): string {
    const parts = [request.method, request.url];

    if (request.body) {
      parts.push(typeof request.body === 'string' ? request.body : request.body.toString('base64'));
    }

    return parts.join('|');
  }

  /**
   * Extract service name from URL
   */
  private extractServiceFromUrl(url: string): string {
    try {
      const hostname = new URL(url).hostname;

      // Map hostnames to service names
      if (hostname.includes('fireworks.ai')) return 'fireworks';
      if (hostname.includes('deepgram.com')) return 'deepgram';
      if (hostname.includes('elevenlabs.io')) return 'elevenlabs';
      if (hostname.includes('openrouter.ai')) return 'openrouter';

      return hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if an error indicates network is offline
   */
  private isOfflineError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('offline') ||
      message.includes('enotfound') ||
      message.includes('econnrefused') ||
      message.includes('fetch failed')
    );
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('econnrefused') ||
      message.includes('timeout')
    ) {
      return true;
    }

    // HTTP 5xx errors
    if (error instanceof NetworkError) {
      return error.status >= 500 || error.status === 429;
    }

    return false;
  }
}

// ============================================================================
// Custom Error Class
// ============================================================================

/**
 * Network-specific error with status code and response
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: NetworkResponse,
    public isTimeout = false
  ) {
    super(message);
    this.name = 'NetworkError';
    Error.captureStackTrace(this, NetworkError);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let networkOptimizer: NetworkOptimizer | null = null;

/**
 * Get the singleton NetworkOptimizer instance
 */
export function getNetworkOptimizer(config?: Partial<NetworkOptimizerConfig>): NetworkOptimizer {
  if (!networkOptimizer) {
    networkOptimizer = new NetworkOptimizer(config);
  }
  return networkOptimizer;
}

/**
 * Shutdown the network optimizer
 */
export function shutdownNetworkOptimizer(): void {
  if (networkOptimizer) {
    networkOptimizer.shutdown();
    networkOptimizer = null;
    logger.info('NetworkOptimizer shutdown complete');
  }
}

export default NetworkOptimizer;
