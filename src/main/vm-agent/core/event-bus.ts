/**
 * Atlas Desktop - VM Agent Event Bus
 *
 * Central event system for the VM Computer Use Agent.
 * Provides typed event emission, subscription, and event history.
 *
 * @module vm-agent/core/event-bus
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import {
  VMAgentEvent,
  VMAgentEventType,
  VMAgentEventHandler,
  EventSubscription,
} from './types';
import * as crypto from 'crypto';

const logger = createModuleLogger('VMEventBus');

// =============================================================================
// Event Bus Constants
// =============================================================================

export const EVENT_BUS_CONSTANTS = {
  /** Maximum events to keep in history */
  MAX_HISTORY_SIZE: 1000,
  /** Event TTL in milliseconds */
  EVENT_TTL_MS: 3600000, // 1 hour
  /** Maximum subscribers per event type */
  MAX_SUBSCRIBERS_PER_TYPE: 50,
  /** Event processing timeout */
  HANDLER_TIMEOUT_MS: 5000,
} as const;

// =============================================================================
// Event Bus Error Types
// =============================================================================

export type EventBusErrorCode =
  | 'SUBSCRIPTION_LIMIT_REACHED'
  | 'INVALID_EVENT_TYPE'
  | 'HANDLER_TIMEOUT'
  | 'HANDLER_ERROR'
  | 'EVENT_VALIDATION_FAILED';

export class EventBusError extends Error {
  constructor(
    message: string,
    public readonly code: EventBusErrorCode,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EventBusError';
  }
}

// =============================================================================
// Event Factory
// =============================================================================

/**
 * Creates a new VM agent event
 */
export function createEvent<T>(
  type: VMAgentEventType,
  payload: T,
  source: string,
  options: {
    correlationId?: string;
    priority?: VMAgentEvent['priority'];
  } = {},
): VMAgentEvent<T> {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
    source,
    priority: options.priority || 'normal',
    correlationId: options.correlationId,
  };
}

// =============================================================================
// Event Bus Implementation
// =============================================================================

/**
 * Central event bus for the VM agent system
 *
 * Features:
 * - Typed event emission and subscription
 * - Priority-based handler execution
 * - Event history with TTL
 * - Correlation ID tracking
 * - Handler timeout protection
 *
 * @example
 * ```typescript
 * const bus = getEventBus();
 *
 * // Subscribe to events
 * bus.subscribe('screen:captured', (event) => {
 *   console.log('Screen captured:', event.payload);
 * });
 *
 * // Emit events
 * bus.emit(createEvent('screen:captured', { screenshot: '...' }, 'screen-capturer'));
 * ```
 */
export class VMAgentEventBus extends EventEmitter {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventHistory: VMAgentEvent[] = [];
  private historyByType: Map<VMAgentEventType, VMAgentEvent[]> = new Map();
  private correlationChains: Map<string, VMAgentEvent[]> = new Map();
  private config: {
    maxHistorySize: number;
    eventTtlMs: number;
    enableLogging: boolean;
  };

  constructor(
    config: Partial<{
      maxHistorySize: number;
      eventTtlMs: number;
      enableLogging: boolean;
    }> = {},
  ) {
    super();
    this.config = {
      maxHistorySize: config.maxHistorySize || EVENT_BUS_CONSTANTS.MAX_HISTORY_SIZE,
      eventTtlMs: config.eventTtlMs || EVENT_BUS_CONSTANTS.EVENT_TTL_MS,
      enableLogging: config.enableLogging ?? true,
    };

    // Set up periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Subscribe to events
   */
  subscribe<T>(
    eventTypes: VMAgentEventType | VMAgentEventType[] | '*',
    handler: VMAgentEventHandler<T>,
    options: {
      priority?: number;
      once?: boolean;
      filter?: (event: VMAgentEvent) => boolean;
    } = {},
  ): string {
    const subscriptionId = crypto.randomUUID();

    const subscription: EventSubscription = {
      id: subscriptionId,
      eventTypes,
      handler: handler as VMAgentEventHandler,
      priority: options.priority ?? 0,
      once: options.once ?? false,
      filter: options.filter,
    };

    this.subscriptions.set(subscriptionId, subscription);

    if (this.config.enableLogging) {
      logger.debug('Event subscription added', {
        subscriptionId,
        eventTypes: Array.isArray(eventTypes) ? eventTypes : [eventTypes],
      });
    }

    return subscriptionId;
  }

  /**
   * Subscribe to an event once
   */
  subscribeOnce<T>(
    eventType: VMAgentEventType,
    handler: VMAgentEventHandler<T>,
    filter?: (event: VMAgentEvent) => boolean,
  ): string {
    return this.subscribe(eventType, handler, { once: true, filter });
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    const existed = this.subscriptions.delete(subscriptionId);
    if (existed && this.config.enableLogging) {
      logger.debug('Event subscription removed', { subscriptionId });
    }
    return existed;
  }

  /**
   * Emit an event
   */
  async emit<T>(event: VMAgentEvent<T>): Promise<void> {
    // Store in history
    this.addToHistory(event);

    // Get matching subscriptions sorted by priority
    const matchingSubscriptions = this.getMatchingSubscriptions(event);

    // Track subscriptions to remove (once handlers)
    const toRemove: string[] = [];

    // Execute handlers
    for (const subscription of matchingSubscriptions) {
      try {
        // Apply filter if present
        if (subscription.filter && !subscription.filter(event)) {
          continue;
        }

        // Execute with timeout protection
        await this.executeHandler(subscription.handler, event);

        // Mark for removal if once
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
      } catch (error) {
        logger.error('Event handler error', {
          subscriptionId: subscription.id,
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Remove once handlers
    for (const id of toRemove) {
      this.subscriptions.delete(id);
    }

    // Emit to EventEmitter for backward compatibility
    super.emit(event.type, event);
    super.emit('*', event);

    if (this.config.enableLogging) {
      logger.debug('Event emitted', {
        type: event.type,
        id: event.id,
        handlers: matchingSubscriptions.length,
      });
    }
  }

  /**
   * Emit event synchronously (use sparingly)
   */
  emitSync<T>(event: VMAgentEvent<T>): void {
    this.addToHistory(event);

    const matchingSubscriptions = this.getMatchingSubscriptions(event);

    for (const subscription of matchingSubscriptions) {
      try {
        if (subscription.filter && !subscription.filter(event)) {
          continue;
        }

        // Execute synchronously
        const result = subscription.handler(event);
        
        // If it returns a promise, we can't wait for it
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error('Async handler error in sync emit', {
              subscriptionId: subscription.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        if (subscription.once) {
          this.subscriptions.delete(subscription.id);
        }
      } catch (error) {
        logger.error('Event handler error', {
          subscriptionId: subscription.id,
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    super.emit(event.type, event);
    super.emit('*', event);
  }

  /**
   * Get event history
   */
  getHistory(options: {
    eventType?: VMAgentEventType;
    correlationId?: string;
    since?: number;
    limit?: number;
  } = {}): VMAgentEvent[] {
    let events: VMAgentEvent[];

    if (options.eventType) {
      events = this.historyByType.get(options.eventType) || [];
    } else if (options.correlationId) {
      events = this.correlationChains.get(options.correlationId) || [];
    } else {
      events = this.eventHistory;
    }

    // Filter by time
    if (options.since) {
      events = events.filter((e) => e.timestamp >= options.since!);
    }

    // Apply limit
    if (options.limit) {
      events = events.slice(-options.limit);
    }

    return events;
  }

  /**
   * Get last event of a type
   */
  getLastEvent<T>(eventType: VMAgentEventType): VMAgentEvent<T> | undefined {
    const typeHistory = this.historyByType.get(eventType);
    return typeHistory?.[typeHistory.length - 1] as VMAgentEvent<T> | undefined;
  }

  /**
   * Wait for an event
   */
  waitForEvent<T>(
    eventType: VMAgentEventType,
    timeoutMs: number = 30000,
    filter?: (event: VMAgentEvent<T>) => boolean,
  ): Promise<VMAgentEvent<T>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.unsubscribe(subscriptionId);
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeoutMs);

      const subscriptionId = this.subscribe<T>(
        eventType,
        (event) => {
          clearTimeout(timeoutId);
          resolve(event);
        },
        { once: true, filter: filter as (event: VMAgentEvent) => boolean },
      );
    });
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(eventType?: VMAgentEventType): number {
    if (!eventType) {
      return this.subscriptions.size;
    }

    let count = 0;
    for (const sub of this.subscriptions.values()) {
      if (this.subscriptionMatchesType(sub, eventType)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all subscriptions
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
    logger.info('All subscriptions cleared');
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
    this.historyByType.clear();
    this.correlationChains.clear();
    logger.info('Event history cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    subscriptions: number;
    historySize: number;
    eventsByType: Record<string, number>;
    correlationChains: number;
  } {
    const eventsByType: Record<string, number> = {};
    for (const [type, events] of this.historyByType) {
      eventsByType[type] = events.length;
    }

    return {
      subscriptions: this.subscriptions.size,
      historySize: this.eventHistory.length,
      eventsByType,
      correlationChains: this.correlationChains.size,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private addToHistory<T>(event: VMAgentEvent<T>): void {
    // Add to main history
    this.eventHistory.push(event as VMAgentEvent);

    // Trim if needed
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.config.maxHistorySize);
    }

    // Add to type-specific history
    if (!this.historyByType.has(event.type)) {
      this.historyByType.set(event.type, []);
    }
    const typeHistory = this.historyByType.get(event.type)!;
    typeHistory.push(event as VMAgentEvent);

    // Trim type history
    if (typeHistory.length > 100) {
      this.historyByType.set(event.type, typeHistory.slice(-100));
    }

    // Track correlation chains
    if (event.correlationId) {
      if (!this.correlationChains.has(event.correlationId)) {
        this.correlationChains.set(event.correlationId, []);
      }
      this.correlationChains.get(event.correlationId)!.push(event as VMAgentEvent);
    }
  }

  private getMatchingSubscriptions(event: VMAgentEvent): EventSubscription[] {
    const matching: EventSubscription[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (this.subscriptionMatchesType(subscription, event.type)) {
        matching.push(subscription);
      }
    }

    // Sort by priority (higher first)
    return matching.sort((a, b) => b.priority - a.priority);
  }

  private subscriptionMatchesType(
    subscription: EventSubscription,
    eventType: VMAgentEventType,
  ): boolean {
    if (subscription.eventTypes === '*') {
      return true;
    }

    if (Array.isArray(subscription.eventTypes)) {
      return subscription.eventTypes.includes(eventType);
    }

    return subscription.eventTypes === eventType;
  }

  private async executeHandler<T>(
    handler: VMAgentEventHandler<T>,
    event: VMAgentEvent<T>,
  ): Promise<void> {
    const result = handler(event);

    if (result instanceof Promise) {
      // Wrap with timeout
      await Promise.race([
        result,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Handler timeout')),
            EVENT_BUS_CONSTANTS.HANDLER_TIMEOUT_MS,
          ),
        ),
      ]);
    }
  }

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEvents();
    }, 60000); // Every minute
  }

  private cleanupExpiredEvents(): void {
    const expiryTime = Date.now() - this.config.eventTtlMs;

    // Clean main history
    this.eventHistory = this.eventHistory.filter((e) => e.timestamp > expiryTime);

    // Clean type histories
    for (const [type, events] of this.historyByType) {
      const filtered = events.filter((e) => e.timestamp > expiryTime);
      if (filtered.length === 0) {
        this.historyByType.delete(type);
      } else {
        this.historyByType.set(type, filtered);
      }
    }

    // Clean correlation chains
    for (const [correlationId, events] of this.correlationChains) {
      const filtered = events.filter((e) => e.timestamp > expiryTime);
      if (filtered.length === 0) {
        this.correlationChains.delete(correlationId);
      } else {
        this.correlationChains.set(correlationId, filtered);
      }
    }
  }

  /**
   * Dispose of the event bus
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clearSubscriptions();
    this.clearHistory();
    this.removeAllListeners();
    logger.info('Event bus disposed');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let eventBusInstance: VMAgentEventBus | null = null;

/**
 * Get the singleton event bus instance
 */
export function getEventBus(): VMAgentEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new VMAgentEventBus();
  }
  return eventBusInstance;
}

/**
 * Reset the event bus (for testing)
 */
export function resetEventBus(): void {
  if (eventBusInstance) {
    eventBusInstance.dispose();
    eventBusInstance = null;
  }
}
