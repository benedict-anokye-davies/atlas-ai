/**
 * Connection Warmup
 *
 * Pre-establishes connections to external services on app startup
 * to minimize first-request latency. Implements connection pooling
 * patterns for optimal performance.
 */

import { createModuleLogger } from './logger';
import { getProfiler, PERFORMANCE_TARGETS } from './performance-profiler';
import { getErrorMessage } from '../../shared/utils';

const logger = createModuleLogger('connection-warmup');

/**
 * Service endpoint configuration
 */
interface ServiceEndpoint {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  timeout: number;
}

/**
 * Warmup result
 */
interface WarmupResult {
  service: string;
  success: boolean;
  latency: number;
  error?: string;
}

/**
 * Get service endpoints for warmup
 */
function getServiceEndpoints(): ServiceEndpoint[] {
  const endpoints: ServiceEndpoint[] = [];

  // Deepgram - verify connectivity
  if (process.env.DEEPGRAM_API_KEY) {
    endpoints.push({
      name: 'deepgram',
      url: 'https://api.deepgram.com/v1/projects',
      method: 'GET',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      },
      timeout: 5000,
    });
  }

  // ElevenLabs - verify connectivity
  if (process.env.ELEVENLABS_API_KEY) {
    endpoints.push({
      name: 'elevenlabs',
      url: 'https://api.elevenlabs.io/v1/user',
      method: 'GET',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      timeout: 5000,
    });
  }

  // Cartesia - verify connectivity (fastest TTS ~90ms)
  if (process.env.CARTESIA_API_KEY) {
    endpoints.push({
      name: 'cartesia',
      url: 'https://api.cartesia.ai/voices',
      method: 'GET',
      headers: {
        'X-API-Key': process.env.CARTESIA_API_KEY,
        'Cartesia-Version': '2024-06-10',
      },
      timeout: 5000,
    });
  }

  // Fireworks - verify connectivity
  if (process.env.FIREWORKS_API_KEY) {
    endpoints.push({
      name: 'fireworks',
      url: 'https://api.fireworks.ai/inference/v1/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
      },
      timeout: 5000,
    });
  }

  // OpenRouter - verify connectivity (fallback LLM)
  if (process.env.OPENROUTER_API_KEY) {
    endpoints.push({
      name: 'openrouter',
      url: 'https://openrouter.ai/api/v1/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      timeout: 5000,
    });
  }

  return endpoints;
}

/**
 * Warm up a single service endpoint
 */
async function warmupEndpoint(endpoint: ServiceEndpoint): Promise<WarmupResult> {
  const profiler = getProfiler();
  const measureId = profiler.startMeasure('total', `warmup-${endpoint.name}`);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);

    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: endpoint.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    profiler.endMeasure(measureId, {
      service: endpoint.name,
      status: response.status,
    });

    if (response.ok || response.status === 403) {
      // 403 is acceptable - means auth works but endpoint may need different permissions
      logger.info(`${endpoint.name} warmed up successfully in ${latency}ms`);
      return { service: endpoint.name, success: true, latency };
    } else {
      logger.warn(`${endpoint.name} warmup returned status ${response.status}`);
      return {
        service: endpoint.name,
        success: false,
        latency,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = getErrorMessage(error, 'Unknown error');

    profiler.endMeasure(measureId, {
      service: endpoint.name,
      error: true,
    });

    logger.error(`${endpoint.name} warmup failed: ${errorMessage}`);
    return { service: endpoint.name, success: false, latency, error: errorMessage };
  }
}

/**
 * Warm up all configured service connections
 */
export async function warmupConnections(): Promise<WarmupResult[]> {
  const profiler = getProfiler();
  const measureId = profiler.startMeasure('total', 'warmup-all');
  const startTime = Date.now();

  logger.info('Starting connection warmup...');

  const endpoints = getServiceEndpoints();

  if (endpoints.length === 0) {
    logger.warn('No service endpoints configured for warmup');
    profiler.endMeasure(measureId, { endpoints: 0 });
    return [];
  }

  // Warm up all endpoints in parallel
  const results = await Promise.all(endpoints.map(warmupEndpoint));

  const totalTime = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;

  profiler.endMeasure(measureId, {
    total: endpoints.length,
    success: successCount,
    failed: endpoints.length - successCount,
  });

  logger.info(
    `Connection warmup complete: ${successCount}/${endpoints.length} services in ${totalTime}ms`
  );

  // Log summary
  results.forEach((result) => {
    if (!result.success) {
      logger.warn(`  ${result.service}: FAILED - ${result.error}`);
    } else {
      logger.debug(`  ${result.service}: OK (${result.latency}ms)`);
    }
  });

  return results;
}

/**
 * Check if warmup meets startup target
 */
export function checkStartupTarget(warmupTime: number): boolean {
  const meetsWarmTarget = warmupTime <= PERFORMANCE_TARGETS.STARTUP_WARM;
  const meetsColdTarget = warmupTime <= PERFORMANCE_TARGETS.STARTUP_COLD;

  if (meetsWarmTarget) {
    logger.info(`Startup time (${warmupTime}ms) meets warm target (${PERFORMANCE_TARGETS.STARTUP_WARM}ms)`);
  } else if (meetsColdTarget) {
    logger.info(`Startup time (${warmupTime}ms) meets cold target (${PERFORMANCE_TARGETS.STARTUP_COLD}ms)`);
  } else {
    logger.warn(`Startup time (${warmupTime}ms) exceeds cold target (${PERFORMANCE_TARGETS.STARTUP_COLD}ms)`);
  }

  return meetsColdTarget;
}

/**
 * HTTP Agent pool for keep-alive connections
 * This helps maintain persistent connections for lower latency
 */
export class ConnectionPool {
  private static instance: ConnectionPool;
  private initialized = false;
  private warmupResults: WarmupResult[] = [];

  static getInstance(): ConnectionPool {
    if (!ConnectionPool.instance) {
      ConnectionPool.instance = new ConnectionPool();
    }
    return ConnectionPool.instance;
  }

  /**
   * Initialize the connection pool with warmup
   */
  async initialize(): Promise<WarmupResult[]> {
    if (this.initialized) {
      logger.debug('Connection pool already initialized');
      return this.warmupResults;
    }

    const startTime = Date.now();
    this.warmupResults = await warmupConnections();
    const warmupTime = Date.now() - startTime;

    checkStartupTarget(warmupTime);
    this.initialized = true;

    return this.warmupResults;
  }

  /**
   * Get warmup results
   */
  getWarmupResults(): WarmupResult[] {
    return [...this.warmupResults];
  }

  /**
   * Check if a specific service is healthy
   */
  isServiceHealthy(serviceName: string): boolean {
    const result = this.warmupResults.find((r) => r.service === serviceName);
    return result?.success ?? false;
  }

  /**
   * Get all healthy services
   */
  getHealthyServices(): string[] {
    return this.warmupResults.filter((r) => r.success).map((r) => r.service);
  }
}

/**
 * Get the connection pool singleton
 */
export function getConnectionPool(): ConnectionPool {
  return ConnectionPool.getInstance();
}
