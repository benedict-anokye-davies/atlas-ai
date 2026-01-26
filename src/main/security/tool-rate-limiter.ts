/**
 * Tool Rate Limiter
 *
 * Implements per-tool rate limiting to prevent abuse and runaway loops.
 * Uses token bucket algorithm for smooth rate limiting.
 *
 * Features:
 * 1. Per-tool rate limits (e.g., 10 file writes/min)
 * 2. Global rate limit for all tool calls
 * 3. Burst allowance for legitimate use cases
 * 4. Cost-based limiting for expensive tools
 * 5. Circuit breaker for repeated failures
 *
 * Expected Impact:
 * - Prevents runaway tool loops
 * - Protects against prompt injection attacks
 * - Reduces API costs from over-calling
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ToolRateLimiter');

// =============================================================================
// Types
// =============================================================================

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

export interface ToolLimit {
  /** Tool name or pattern */
  tool: string;
  /** Max calls per minute */
  callsPerMinute: number;
  /** Burst capacity (extra calls allowed in burst) */
  burstCapacity?: number;
  /** Cost per call (for cost-based limiting) */
  costPerCall?: number;
  /** Max failures before circuit breaks */
  maxFailures?: number;
  /** Circuit break duration (ms) */
  circuitBreakMs?: number;
  /** Whether to block when limit hit vs. queue */
  blockOnLimit?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  tool: string;
  tokensRemaining: number;
  waitTime?: number; // ms to wait if not allowed
  reason?: string;
  limitType: 'tool' | 'global' | 'cost' | 'circuit';
}

export interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
  openedAt: number;
}

export interface RateLimiterConfig {
  /** Global calls per minute across all tools */
  globalCallsPerMinute: number;
  /** Global burst capacity */
  globalBurstCapacity: number;
  /** Default per-tool limit if not specified */
  defaultToolLimit: number;
  /** Default burst capacity */
  defaultBurstCapacity: number;
  /** Global cost budget per minute */
  costBudgetPerMinute: number;
  /** Default circuit breaker failure threshold */
  defaultCircuitThreshold: number;
  /** Default circuit break duration (ms) */
  defaultCircuitBreakMs: number;
  /** Per-tool overrides */
  toolLimits: ToolLimit[];
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: RateLimiterConfig = {
  globalCallsPerMinute: 100,
  globalBurstCapacity: 20,
  defaultToolLimit: 30, // 30 calls per minute per tool
  defaultBurstCapacity: 10,
  costBudgetPerMinute: 1000, // Abstract cost units
  defaultCircuitThreshold: 5, // Break after 5 consecutive failures
  defaultCircuitBreakMs: 60000, // 1 minute circuit break
  toolLimits: [
    // Dangerous tools - strict limits
    { tool: 'execute_command', callsPerMinute: 10, burstCapacity: 3, costPerCall: 50, maxFailures: 3 },
    { tool: 'write_file', callsPerMinute: 20, burstCapacity: 5, costPerCall: 20, maxFailures: 5 },
    { tool: 'delete_file', callsPerMinute: 10, burstCapacity: 2, costPerCall: 30, maxFailures: 3 },
    { tool: 'git_push', callsPerMinute: 5, burstCapacity: 2, costPerCall: 100, maxFailures: 3 },
    { tool: 'git_commit', callsPerMinute: 10, burstCapacity: 3, costPerCall: 20 },
    
    // Browser agent - moderate limits
    { tool: 'browser_execute_task', callsPerMinute: 5, burstCapacity: 2, costPerCall: 100 },
    { tool: 'browser_navigate', callsPerMinute: 30, burstCapacity: 10, costPerCall: 10 },
    { tool: 'browser_click', callsPerMinute: 60, burstCapacity: 20, costPerCall: 5 },
    { tool: 'browser_type', callsPerMinute: 60, burstCapacity: 20, costPerCall: 5 },
    
    // Read operations - lenient
    { tool: 'read_file', callsPerMinute: 60, burstCapacity: 20, costPerCall: 5 },
    { tool: 'list_directory', callsPerMinute: 60, burstCapacity: 20, costPerCall: 2 },
    { tool: 'grep_search', callsPerMinute: 30, burstCapacity: 10, costPerCall: 10 },
    { tool: 'semantic_code_search', callsPerMinute: 20, burstCapacity: 5, costPerCall: 30 },
    
    // External API calls - strict
    { tool: 'web_search', callsPerMinute: 10, burstCapacity: 5, costPerCall: 50 },
    { tool: 'trading_*', callsPerMinute: 20, burstCapacity: 5, costPerCall: 30 },
    { tool: 'banking_*', callsPerMinute: 10, burstCapacity: 3, costPerCall: 50, maxFailures: 3 },
    
    // Desktop automation - moderate
    { tool: 'mouse_*', callsPerMinute: 60, burstCapacity: 20, costPerCall: 5 },
    { tool: 'keyboard_*', callsPerMinute: 60, burstCapacity: 20, costPerCall: 5 },
    { tool: 'screenshot', callsPerMinute: 10, burstCapacity: 3, costPerCall: 20 },
  ],
};

// =============================================================================
// Rate Limiter Class
// =============================================================================

export class ToolRateLimiter extends EventEmitter {
  private config: RateLimiterConfig;
  private toolBuckets: Map<string, TokenBucket> = new Map();
  private globalBucket: TokenBucket;
  private costBucket: TokenBucket;
  private circuitStates: Map<string, CircuitState> = new Map();
  private callHistory: Array<{ tool: string; timestamp: number; allowed: boolean; cost: number }> = [];
  private readonly MAX_HISTORY = 1000;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      toolLimits: [...DEFAULT_CONFIG.toolLimits, ...(config.toolLimits || [])],
    };

    // Initialize global bucket
    this.globalBucket = this.createBucket(
      this.config.globalCallsPerMinute / 60,
      this.config.globalCallsPerMinute / 60 + this.config.globalBurstCapacity
    );

    // Initialize cost bucket
    this.costBucket = this.createBucket(
      this.config.costBudgetPerMinute / 60,
      this.config.costBudgetPerMinute / 60 + 100 // 100 unit burst
    );

    logger.info('ToolRateLimiter initialized', {
      globalLimit: this.config.globalCallsPerMinute,
      toolLimits: this.config.toolLimits.length,
    });
  }

  /**
   * Check if a tool call is allowed
   */
  checkLimit(tool: string): RateLimitResult {
    const now = Date.now();

    // 1. Check circuit breaker
    const circuitResult = this.checkCircuit(tool);
    if (!circuitResult.allowed) {
      return circuitResult;
    }

    // 2. Check global rate limit
    this.refillBucket(this.globalBucket, now);
    if (this.globalBucket.tokens < 1) {
      const result: RateLimitResult = {
        allowed: false,
        tool,
        tokensRemaining: 0,
        waitTime: this.calculateWaitTime(this.globalBucket, 1),
        reason: 'Global rate limit exceeded',
        limitType: 'global',
      };
      this.recordCall(tool, false, 0);
      this.emit('rate-limited', result);
      return result;
    }

    // 3. Check cost budget
    const toolConfig = this.getToolConfig(tool);
    const cost = toolConfig?.costPerCall || 10;
    this.refillBucket(this.costBucket, now);
    if (this.costBucket.tokens < cost) {
      const result: RateLimitResult = {
        allowed: false,
        tool,
        tokensRemaining: this.costBucket.tokens,
        waitTime: this.calculateWaitTime(this.costBucket, cost),
        reason: `Cost budget exceeded (need ${cost}, have ${this.costBucket.tokens.toFixed(0)})`,
        limitType: 'cost',
      };
      this.recordCall(tool, false, 0);
      this.emit('rate-limited', result);
      return result;
    }

    // 4. Check per-tool rate limit
    const bucket = this.getOrCreateToolBucket(tool);
    this.refillBucket(bucket, now);
    if (bucket.tokens < 1) {
      const result: RateLimitResult = {
        allowed: false,
        tool,
        tokensRemaining: bucket.tokens,
        waitTime: this.calculateWaitTime(bucket, 1),
        reason: `Tool rate limit exceeded for '${tool}'`,
        limitType: 'tool',
      };
      this.recordCall(tool, false, 0);
      this.emit('rate-limited', result);
      return result;
    }

    // 5. All checks passed - consume tokens
    this.globalBucket.tokens -= 1;
    this.costBucket.tokens -= cost;
    bucket.tokens -= 1;

    const result: RateLimitResult = {
      allowed: true,
      tool,
      tokensRemaining: bucket.tokens,
      limitType: 'tool',
    };

    this.recordCall(tool, true, cost);
    return result;
  }

  /**
   * Report a tool call failure (for circuit breaker)
   */
  reportFailure(tool: string): void {
    let state = this.circuitStates.get(tool);
    if (!state) {
      state = { failures: 0, lastFailure: 0, open: false, openedAt: 0 };
      this.circuitStates.set(tool, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    const config = this.getToolConfig(tool);
    const threshold = config?.maxFailures || this.config.defaultCircuitThreshold;

    if (state.failures >= threshold) {
      state.open = true;
      state.openedAt = Date.now();
      logger.warn('Circuit breaker opened', { tool, failures: state.failures });
      this.emit('circuit-open', { tool, failures: state.failures });
    }
  }

  /**
   * Report a tool call success (resets failure count)
   */
  reportSuccess(tool: string): void {
    const state = this.circuitStates.get(tool);
    if (state) {
      state.failures = 0;
      if (state.open) {
        state.open = false;
        logger.info('Circuit breaker closed', { tool });
        this.emit('circuit-close', { tool });
      }
    }
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuit(tool: string): RateLimitResult {
    const state = this.circuitStates.get(tool);
    if (!state || !state.open) {
      return { allowed: true, tool, tokensRemaining: -1, limitType: 'circuit' };
    }

    const config = this.getToolConfig(tool);
    const breakDuration = config?.circuitBreakMs || this.config.defaultCircuitBreakMs;
    const elapsed = Date.now() - state.openedAt;

    if (elapsed >= breakDuration) {
      // Half-open state - allow one attempt
      state.open = false;
      logger.info('Circuit breaker half-open', { tool });
      return { allowed: true, tool, tokensRemaining: -1, limitType: 'circuit' };
    }

    return {
      allowed: false,
      tool,
      tokensRemaining: 0,
      waitTime: breakDuration - elapsed,
      reason: `Circuit breaker open for '${tool}' (${state.failures} failures)`,
      limitType: 'circuit',
    };
  }

  /**
   * Get or create token bucket for a tool
   */
  private getOrCreateToolBucket(tool: string): TokenBucket {
    // Check for existing bucket
    let bucket = this.toolBuckets.get(tool);
    if (bucket) return bucket;

    // Check for pattern match
    for (const [pattern, existingBucket] of this.toolBuckets) {
      if (this.matchesPattern(tool, pattern)) {
        return existingBucket;
      }
    }

    // Create new bucket
    const config = this.getToolConfig(tool);
    const callsPerMinute = config?.callsPerMinute || this.config.defaultToolLimit;
    const burstCapacity = config?.burstCapacity || this.config.defaultBurstCapacity;

    bucket = this.createBucket(callsPerMinute / 60, callsPerMinute / 60 + burstCapacity);
    this.toolBuckets.set(tool, bucket);

    return bucket;
  }

  /**
   * Get tool configuration
   */
  private getToolConfig(tool: string): ToolLimit | undefined {
    // Exact match first
    const exact = this.config.toolLimits.find(l => l.tool === tool);
    if (exact) return exact;

    // Pattern match
    return this.config.toolLimits.find(l => this.matchesPattern(tool, l.tool));
  }

  /**
   * Check if tool matches pattern (supports * wildcard)
   */
  private matchesPattern(tool: string, pattern: string): boolean {
    if (pattern === tool) return true;
    if (!pattern.includes('*')) return false;

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(tool);
  }

  /**
   * Create a new token bucket
   */
  private createBucket(refillRate: number, capacity: number): TokenBucket {
    return {
      tokens: capacity,
      lastRefill: Date.now(),
      capacity,
      refillRate,
    };
  }

  /**
   * Refill token bucket based on elapsed time
   */
  private refillBucket(bucket: TokenBucket, now: number): void {
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * bucket.refillRate;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Calculate wait time until enough tokens available
   */
  private calculateWaitTime(bucket: TokenBucket, needed: number): number {
    if (bucket.tokens >= needed) return 0;
    const tokensNeeded = needed - bucket.tokens;
    return Math.ceil((tokensNeeded / bucket.refillRate) * 1000); // ms
  }

  /**
   * Record call in history
   */
  private recordCall(tool: string, allowed: boolean, cost: number): void {
    this.callHistory.push({
      tool,
      timestamp: Date.now(),
      allowed,
      cost,
    });

    if (this.callHistory.length > this.MAX_HISTORY) {
      this.callHistory.shift();
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalCalls: number;
    allowedCalls: number;
    blockedCalls: number;
    totalCost: number;
    callsByTool: Record<string, { total: number; blocked: number }>;
    openCircuits: string[];
  } {
    const total = this.callHistory.length;
    const allowed = this.callHistory.filter(c => c.allowed).length;
    const blocked = total - allowed;
    const totalCost = this.callHistory.filter(c => c.allowed).reduce((s, c) => s + c.cost, 0);

    const callsByTool: Record<string, { total: number; blocked: number }> = {};
    for (const call of this.callHistory) {
      if (!callsByTool[call.tool]) {
        callsByTool[call.tool] = { total: 0, blocked: 0 };
      }
      callsByTool[call.tool].total++;
      if (!call.allowed) callsByTool[call.tool].blocked++;
    }

    const openCircuits = [...this.circuitStates.entries()]
      .filter(([, state]) => state.open)
      .map(([tool]) => tool);

    return {
      totalCalls: total,
      allowedCalls: allowed,
      blockedCalls: blocked,
      totalCost,
      callsByTool,
      openCircuits,
    };
  }

  /**
   * Get current rate limit status for a tool
   */
  getToolStatus(tool: string): {
    tokensAvailable: number;
    capacity: number;
    refillRate: number;
    circuitOpen: boolean;
    failures: number;
  } {
    const bucket = this.toolBuckets.get(tool);
    const circuit = this.circuitStates.get(tool);

    if (bucket) {
      this.refillBucket(bucket, Date.now());
    }

    return {
      tokensAvailable: bucket?.tokens || 0,
      capacity: bucket?.capacity || 0,
      refillRate: bucket?.refillRate || 0,
      circuitOpen: circuit?.open || false,
      failures: circuit?.failures || 0,
    };
  }

  /**
   * Reset rate limits for a tool
   */
  resetToolLimit(tool: string): void {
    const bucket = this.toolBuckets.get(tool);
    if (bucket) {
      bucket.tokens = bucket.capacity;
      bucket.lastRefill = Date.now();
    }

    const circuit = this.circuitStates.get(tool);
    if (circuit) {
      circuit.failures = 0;
      circuit.open = false;
    }

    logger.info('Tool limit reset', { tool });
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    for (const bucket of this.toolBuckets.values()) {
      bucket.tokens = bucket.capacity;
      bucket.lastRefill = Date.now();
    }

    this.globalBucket.tokens = this.globalBucket.capacity;
    this.costBucket.tokens = this.costBucket.capacity;
    this.circuitStates.clear();

    logger.info('All rate limits reset');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      toolLimits: config.toolLimits || this.config.toolLimits,
    };

    // Recreate global bucket with new config
    this.globalBucket = this.createBucket(
      this.config.globalCallsPerMinute / 60,
      this.config.globalCallsPerMinute / 60 + this.config.globalBurstCapacity
    );

    logger.info('ToolRateLimiter config updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimiterConfig {
    return {
      ...this.config,
      toolLimits: [...this.config.toolLimits],
    };
  }

  /**
   * Add or update a tool limit
   */
  setToolLimit(limit: ToolLimit): void {
    const index = this.config.toolLimits.findIndex(l => l.tool === limit.tool);
    if (index >= 0) {
      this.config.toolLimits[index] = limit;
    } else {
      this.config.toolLimits.push(limit);
    }

    // Clear cached bucket so it gets recreated with new config
    this.toolBuckets.delete(limit.tool);

    logger.info('Tool limit set', { tool: limit.tool, callsPerMinute: limit.callsPerMinute });
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rateLimiterInstance: ToolRateLimiter | null = null;

export function getToolRateLimiter(): ToolRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new ToolRateLimiter();
  }
  return rateLimiterInstance;
}

export function createToolRateLimiter(config?: Partial<RateLimiterConfig>): ToolRateLimiter {
  rateLimiterInstance = new ToolRateLimiter(config);
  return rateLimiterInstance;
}
