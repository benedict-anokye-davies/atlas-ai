/**
 * Typed EventEmitter - Type-safe event emitter base class
 * Provides compile-time type checking for event names and payloads
 */

import { EventEmitter } from 'events';

/**
 * Type-safe EventEmitter that enforces event names and payload types
 *
 * Usage:
 * ```typescript
 * interface MyEvents {
 *   'data': (value: string) => void;
 *   'error': (error: Error) => void;
 *   'complete': () => void;
 * }
 *
 * class MyEmitter extends TypedEventEmitter<MyEvents> {
 *   doSomething() {
 *     this.emit('data', 'hello'); // ✓ Type-safe
 *     this.emit('data', 123);      // ✗ Type error
 *     this.emit('invalid', 'x');   // ✗ Type error
 *   }
 * }
 * ```
 */
export abstract class TypedEventEmitter<
  TEvents extends Record<string, (...args: any[]) => void>
> extends EventEmitter {
  /**
   * Emit a typed event
   */
  emit<K extends keyof TEvents>(
    event: K,
    ...args: Parameters<TEvents[K]>
  ): boolean {
    return super.emit(String(event), ...args);
  }

  /**
   * Add a typed event listener
   */
  on<K extends keyof TEvents>(event: K, listener: TEvents[K]): this {
    return super.on(String(event), listener);
  }

  /**
   * Add a one-time typed event listener
   */
  once<K extends keyof TEvents>(event: K, listener: TEvents[K]): this {
    return super.once(String(event), listener);
  }

  /**
   * Remove a typed event listener
   */
  off<K extends keyof TEvents>(event: K, listener: TEvents[K]): this {
    return super.off(String(event), listener);
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<K extends keyof TEvents>(event?: K): this {
    return super.removeAllListeners(event ? String(event) : undefined);
  }

  /**
   * Get listeners for an event
   */
  listeners<K extends keyof TEvents>(event: K): TEvents[K][] {
    return super.listeners(String(event)) as TEvents[K][];
  }

  /**
   * Get number of listeners for an event
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return super.listenerCount(String(event));
  }

  /**
   * Prepend a listener to the beginning of the listeners array
   */
  prependListener<K extends keyof TEvents>(event: K, listener: TEvents[K]): this {
    return super.prependListener(String(event), listener);
  }

  /**
   * Prepend a one-time listener
   */
  prependOnceListener<K extends keyof TEvents>(event: K, listener: TEvents[K]): this {
    return super.prependOnceListener(String(event), listener);
  }
}

/**
 * Create a managed TypedEventEmitter with automatic cleanup tracking
 *
 * Usage:
 * ```typescript
 * class MyEmitter extends ManagedTypedEventEmitter<MyEvents> {
 *   start() {
 *     const timer = setInterval(() => {
 *       this.emit('data', 'tick');
 *     }, 1000);
 *     this.trackCleanup(() => clearInterval(timer));
 *   }
 * }
 *
 * const emitter = new MyEmitter();
 * emitter.start();
 * // Later...
 * emitter.cleanup(); // Automatically clears interval and all listeners
 * ```
 */
export abstract class ManagedTypedEventEmitter<
  TEvents extends Record<string, (...args: any[]) => void>
> extends TypedEventEmitter<TEvents> {
  private cleanupCallbacks: (() => void)[] = [];
  private isCleanedUp = false;

  /**
   * Track a cleanup callback to be called when cleanup() is invoked
   */
  protected trackCleanup(callback: () => void): void {
    if (this.isCleanedUp) {
      // Already cleaned up, execute immediately
      callback();
      return;
    }
    this.cleanupCallbacks.push(callback);
  }

  /**
   * Clean up all tracked resources and remove all event listeners
   * Call this in your shutdown/destroy method
   */
  cleanup(): void {
    if (this.isCleanedUp) return;

    this.isCleanedUp = true;

    // Execute all cleanup callbacks
    for (const callback of this.cleanupCallbacks) {
      try {
        callback();
      } catch (error) {
        // Log but don't throw - continue cleaning up
        console.error('Cleanup callback error:', error);
      }
    }

    this.cleanupCallbacks = [];

    // Remove all event listeners
    this.removeAllListeners();
  }

  /**
   * Check if this emitter has been cleaned up
   */
  isDisposed(): boolean {
    return this.isCleanedUp;
  }
}

/**
 * Example usage for voice pipeline:
 *
 * ```typescript
 * interface VoicePipelineEvents {
 *   'speech-start': () => void;
 *   'speech-end': (duration: number) => void;
 *   'transcript': (text: string, confidence: number) => void;
 *   'error': (error: Error) => void;
 * }
 *
 * class VoicePipeline extends ManagedTypedEventEmitter<VoicePipelineEvents> {
 *   private timer: NodeJS.Timeout | null = null;
 *
 *   start() {
 *     this.timer = setInterval(() => {
 *       this.emit('transcript', 'hello', 0.95);
 *     }, 1000);
 *
 *     // Track for automatic cleanup
 *     this.trackCleanup(() => {
 *       if (this.timer) clearInterval(this.timer);
 *     });
 *   }
 *
 *   stop() {
 *     this.cleanup(); // Clears timer and all listeners
 *   }
 * }
 * ```
 */
