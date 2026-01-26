/**
 * Timer Manager - Centralized timer lifecycle management
 * Prevents memory leaks from uncleaned setInterval/setTimeout calls
 */

import { createModuleLogger } from './logger';

const logger = createModuleLogger('TimerManager');

export class TimerManager {
  private intervals = new Set<NodeJS.Timeout>();
  private timeouts = new Set<NodeJS.Timeout>();
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Create a managed setInterval that will be automatically cleaned up
   */
  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    const timer = setInterval(callback, ms);
    this.intervals.add(timer);

    logger.debug(`[${this.name}] Interval created`, { ms, total: this.intervals.size });

    return timer;
  }

  /**
   * Create a managed setTimeout that will be automatically cleaned up
   */
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      callback();
      // Auto-remove from tracking after execution
      this.timeouts.delete(timer);
    }, ms);

    this.timeouts.add(timer);

    logger.debug(`[${this.name}] Timeout created`, { ms, total: this.timeouts.size });

    return timer;
  }

  /**
   * Manually clear a specific interval
   */
  clearInterval(timer: NodeJS.Timeout): void {
    if (this.intervals.has(timer)) {
      clearInterval(timer);
      this.intervals.delete(timer);
      logger.debug(`[${this.name}] Interval cleared`, { remaining: this.intervals.size });
    }
  }

  /**
   * Manually clear a specific timeout
   */
  clearTimeout(timer: NodeJS.Timeout): void {
    if (this.timeouts.has(timer)) {
      clearTimeout(timer);
      this.timeouts.delete(timer);
      logger.debug(`[${this.name}] Timeout cleared`, { remaining: this.timeouts.size });
    }
  }

  /**
   * Clear all managed timers - call this in shutdown/cleanup
   */
  clearAll(): void {
    // Clear all intervals
    for (const timer of this.intervals) {
      clearInterval(timer);
    }
    const intervalCount = this.intervals.size;
    this.intervals.clear();

    // Clear all timeouts
    for (const timer of this.timeouts) {
      clearTimeout(timer);
    }
    const timeoutCount = this.timeouts.size;
    this.timeouts.clear();

    if (intervalCount > 0 || timeoutCount > 0) {
      logger.info(`[${this.name}] Cleaned up all timers`, {
        intervals: intervalCount,
        timeouts: timeoutCount
      });
    }
  }

  /**
   * Get current timer counts (for debugging)
   */
  getStats(): { intervals: number; timeouts: number } {
    return {
      intervals: this.intervals.size,
      timeouts: this.timeouts.size
    };
  }
}

/**
 * Create a new timer manager for a specific module
 */
export function createTimerManager(name: string): TimerManager {
  return new TimerManager(name);
}
