/**
 * Atlas Desktop - Shared Utilities
 * Common utility functions used across the codebase
 */

/**
 * Sleep for a specified number of milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 * 
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delay alias for sleep (for semantic clarity)
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export const delay = sleep;

/**
 * Create a debounced version of a function
 * @param fn - Function to debounce
 * @param waitMs - Milliseconds to wait before calling
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, waitMs);
  };
}

/**
 * Create a throttled version of a function
 * @param fn - Function to throttle
 * @param limitMs - Minimum milliseconds between calls
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limitMs - (now - lastCall);
    
    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = undefined;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Execute a function with a timeout
 * @param fn - Async function to execute
 * @param timeoutMs - Maximum time to wait
 * @param errorMessage - Error message if timeout occurs
 * @returns Promise with the function result
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Retry a function with exponential backoff
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Promise with the function result
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        break;
      }

      await sleep(delayMs);
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Check if a value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Clamp a number between min and max values
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generate a unique ID
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Safely parse JSON with a fallback value
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format milliseconds to human readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Extract error message from unknown error type
 * Replaces the common pattern: error instanceof Error ? error.message : 'fallback'
 * @param error - Unknown error value
 * @param fallback - Optional fallback message if error cannot be converted to string
 * @returns Error message string
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback ?? String(error);
}

/**
 * Convert unknown error to Error instance
 * @param error - Unknown error value
 * @returns Error instance
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(getErrorMessage(error));
}

/**
 * Safely parse JSON with type checking
 * Returns undefined on parse failure instead of throwing
 * @param json - JSON string to parse
 * @returns Parsed value or undefined
 */
export function safeJsonParseOrUndefined<T>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Fetch with timeout using AbortController
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Fetch response
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Singleton Pattern Utility
// ============================================================================

/**
 * Create a lazy singleton factory
 * @param factory - Factory function to create the instance
 * @returns Getter function that returns the singleton
 * 
 * @example
 * const getMyService = createSingleton(() => new MyService());
 * const service = getMyService(); // Creates instance on first call
 */
export function createSingleton<T>(factory: () => T): () => T {
  let instance: T | undefined;
  return () => {
    if (instance === undefined) {
      instance = factory();
    }
    return instance;
  };
}

/**
 * Create a resettable singleton factory
 * @param factory - Factory function to create the instance
 * @returns Object with get() and reset() methods
 */
export function createResettableSingleton<T>(factory: () => T): {
  get: () => T;
  reset: () => void;
} {
  let instance: T | undefined;
  return {
    get: () => {
      if (instance === undefined) {
        instance = factory();
      }
      return instance;
    },
    reset: () => {
      instance = undefined;
    },
  };
}

// ============================================================================
// Typed EventEmitter
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';

/**
 * Type-safe EventEmitter interface
 * Provides compile-time checking for event names and handler signatures
 * 
 * @example
 * interface MyEvents {
 *   'data': (data: string) => void;
 *   'error': (error: Error) => void;
 *   'ready': () => void;
 * }
 * 
 * class MyClass extends TypedEventEmitter<MyEvents> {
 *   doSomething() {
 *     this.emit('data', 'hello'); // Type checked!
 *   }
 * }
 */
export interface TypedEventEmitter<Events extends Record<string, (...args: any[]) => void>> {
  on<E extends keyof Events & string>(event: E, listener: Events[E]): this;
  once<E extends keyof Events & string>(event: E, listener: Events[E]): this;
  off<E extends keyof Events & string>(event: E, listener: Events[E]): this;
  emit<E extends keyof Events & string>(event: E, ...args: Parameters<Events[E]>): boolean;
  removeAllListeners<E extends keyof Events & string>(event?: E): this;
  listeners<E extends keyof Events & string>(event: E): Function[];
  listenerCount<E extends keyof Events & string>(event: E): number;
}

/**
 * Create a typed EventEmitter class
 * Use this as a base class for type-safe event handling
 */
export class TypedEventEmitterClass<
  Events extends Record<string, (...args: any[]) => void>
> extends EventEmitter {
  constructor() {
    super();
    // Set reasonable max listeners to prevent memory leak warnings
    this.setMaxListeners(20);
  }

  // Override methods with proper typing - the actual implementation
  // uses the inherited EventEmitter methods which work at runtime
  override on<E extends keyof Events & string>(event: E, listener: Events[E]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override once<E extends keyof Events & string>(event: E, listener: Events[E]): this {
    return super.once(event, listener as (...args: any[]) => void);
  }

  override off<E extends keyof Events & string>(event: E, listener: Events[E]): this {
    return super.off(event, listener as (...args: any[]) => void);
  }

  override emit<E extends keyof Events & string>(event: E, ...args: Parameters<Events[E]>): boolean {
    return super.emit(event, ...args);
  }

  override removeAllListeners<E extends keyof Events & string>(event?: E): this {
    return super.removeAllListeners(event);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================================================
// Promise Concurrency Control
// ============================================================================

/**
 * Create a promise concurrency limiter
 * Prevents resource exhaustion from too many parallel operations
 * 
 * @param concurrency - Maximum number of concurrent operations
 * @returns A function that wraps promises with concurrency control
 * 
 * @example
 * const limit = pLimit(3); // Max 3 concurrent
 * const results = await Promise.all(
 *   urls.map(url => limit(() => fetch(url)))
 * );
 */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const run = queue.shift();
      run?.();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        activeCount++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          next();
        }
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

// ============================================================================
// Memory Utilities
// ============================================================================

/**
 * Get memory usage in megabytes
 * Standardizes the common pattern of converting process.memoryUsage() to MB
 * 
 * @returns Memory stats in MB
 */
export function getMemoryUsageMB(): {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  percentUsed: number;
} {
  const mem = process.memoryUsage();
  const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024);
  return {
    heapUsed: toMB(mem.heapUsed),
    heapTotal: toMB(mem.heapTotal),
    rss: toMB(mem.rss),
    external: toMB(mem.external),
    arrayBuffers: toMB(mem.arrayBuffers),
    percentUsed: Math.round((mem.heapUsed / mem.heapTotal) * 100),
  };
}

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Map values of an object while preserving keys
 * 
 * @example
 * mapValues({ a: 1, b: 2 }, v => v * 2) // { a: 2, b: 4 }
 */
export function mapValues<T, U>(
  obj: Record<string, T>,
  fn: (value: T, key: string) => U
): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = fn(value, key);
  }
  return result;
}

/**
 * Filter object entries by predicate
 * 
 * @example
 * filterObject({ a: 1, b: 2, c: 3 }, v => v > 1) // { b: 2, c: 3 }
 */
export function filterObject<T>(
  obj: Record<string, T>,
  predicate: (value: T, key: string) => boolean
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (predicate(value, key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Pick specific keys from an object
 * 
 * @example
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // { a: 1, c: 3 }
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 * 
 * @example
 * omit({ a: 1, b: 2, c: 3 }, ['b']) // { a: 1, c: 3 }
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Split array into chunks of specified size
 * 
 * @example
 * chunk([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) return [array];
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * Get unique values from an array
 * 
 * @example
 * unique([1, 2, 2, 3, 3, 3]) // [1, 2, 3]
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * Get unique values by a key function
 * 
 * @example
 * uniqueBy([{id: 1}, {id: 2}, {id: 1}], x => x.id) // [{id: 1}, {id: 2}]
 */
export function uniqueBy<T, K>(array: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  return array.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Group array items by a key function
 * 
 * @example
 * groupBy([{type: 'a', v: 1}, {type: 'b', v: 2}, {type: 'a', v: 3}], x => x.type)
 * // { a: [{type: 'a', v: 1}, {type: 'a', v: 3}], b: [{type: 'b', v: 2}] }
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of array) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

/**
 * Partition array into two groups by predicate
 * 
 * @example
 * partition([1, 2, 3, 4, 5], x => x % 2 === 0) // [[2, 4], [1, 3, 5]]
 */
export function partition<T>(
  array: T[],
  predicate: (item: T) => boolean
): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of array) {
    if (predicate(item)) {
      pass.push(item);
    } else {
      fail.push(item);
    }
  }
  return [pass, fail];
}

/**
 * Get the last element of an array
 */
export function last<T>(array: T[]): T | undefined {
  return array[array.length - 1];
}

/**
 * Get the first element of an array
 */
export function first<T>(array: T[]): T | undefined {
  return array[0];
}

// ============================================================================
// Time Formatting Utilities
// ============================================================================

/**
 * Format a timestamp as a relative time string
 * 
 * @example
 * formatRelativeTime(Date.now() - 60000) // "1 minute ago"
 * formatRelativeTime(Date.now() + 3600000) // "in 1 hour"
 */
export function formatRelativeTime(timestamp: number | Date): string {
  const now = Date.now();
  const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const diff = now - time;
  const absDiff = Math.abs(diff);
  const isFuture = diff < 0;

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let result: string;
  if (seconds < 10) {
    result = 'just now';
    return result;
  } else if (seconds < 60) {
    result = `${seconds} seconds`;
  } else if (minutes < 60) {
    result = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else if (hours < 24) {
    result = `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (days < 7) {
    result = `${days} day${days > 1 ? 's' : ''}`;
  } else if (weeks < 4) {
    result = `${weeks} week${weeks > 1 ? 's' : ''}`;
  } else if (months < 12) {
    result = `${months} month${months > 1 ? 's' : ''}`;
  } else {
    result = `${years} year${years > 1 ? 's' : ''}`;
  }

  return isFuture ? `in ${result}` : `${result} ago`;
}

/**
 * Format a timestamp as ISO date string (YYYY-MM-DD)
 */
export function formatDateISO(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toISOString().split('T')[0];
}

/**
 * Format a timestamp as time string (HH:MM:SS)
 */
export function formatTimeHMS(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return date.toTimeString().split(' ')[0];
}

/**
 * Format a timestamp as datetime string (YYYY-MM-DD HH:MM:SS)
 */
export function formatDateTime(timestamp: number | Date): string {
  return `${formatDateISO(timestamp)} ${formatTimeHMS(timestamp)}`;
}

// ============================================================================
// Async Iterator Utilities
// ============================================================================

/**
 * Convert a ReadableStream to an async iterable
 * Useful for streaming APIs
 * 
 * @example
 * for await (const chunk of asyncIterableFromStream(response.body)) {
 *   console.log(chunk);
 * }
 */
export async function* asyncIterableFromStream<T>(
  stream: ReadableStream<T>
): AsyncGenerator<T, void, undefined> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Collect all values from an async iterable into an array
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

// ============================================================================
// Resource Disposal Manager
// ============================================================================

/**
 * Interface for disposable resources
 */
export interface Disposable {
  dispose: () => void | Promise<void>;
}

/**
 * Manager for tracking and disposing resources
 * Ensures all resources are properly cleaned up during shutdown
 * 
 * @example
 * const disposals = new DisposalManager();
 * disposals.register('timer', { dispose: () => clearInterval(timer) });
 * disposals.register('connection', connection);
 * 
 * // On shutdown
 * await disposals.disposeAll();
 */
export class DisposalManager {
  private resources = new Map<string, Disposable>();
  private disposeOrder: string[] = [];

  /**
   * Register a resource for disposal
   * @param id - Unique identifier for the resource
   * @param resource - Disposable resource
   */
  register(id: string, resource: Disposable): void {
    if (this.resources.has(id)) {
      // Dispose existing resource before replacing
      const existing = this.resources.get(id);
      try {
        existing?.dispose();
      } catch {
        // Ignore disposal errors for replaced resources
      }
    }
    this.resources.set(id, resource);
    if (!this.disposeOrder.includes(id)) {
      this.disposeOrder.push(id);
    }
  }

  /**
   * Unregister a resource without disposing
   */
  unregister(id: string): boolean {
    const removed = this.resources.delete(id);
    if (removed) {
      this.disposeOrder = this.disposeOrder.filter(i => i !== id);
    }
    return removed;
  }

  /**
   * Dispose a specific resource
   */
  async dispose(id: string): Promise<boolean> {
    const resource = this.resources.get(id);
    if (!resource) return false;

    try {
      await resource.dispose();
    } catch {
      // Log but continue disposal
    }
    return this.unregister(id);
  }

  /**
   * Dispose all resources in reverse registration order
   */
  async disposeAll(): Promise<void> {
    // Dispose in reverse order (LIFO)
    const order = [...this.disposeOrder].reverse();
    for (const id of order) {
      await this.dispose(id);
    }
  }

  /**
   * Get registered resource count
   */
  get size(): number {
    return this.resources.size;
  }

  /**
   * Check if a resource is registered
   */
  has(id: string): boolean {
    return this.resources.has(id);
  }

  /**
   * Get all registered resource IDs
   */
  getIds(): string[] {
    return [...this.resources.keys()];
  }
}

// ============================================================================
// IPC Response Helpers
// ============================================================================

/**
 * Standard IPC response type
 */
export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create a successful IPC response
 */
export function ipcSuccess<T>(data: T): IPCResponse<T> {
  return { success: true, data };
}

/**
 * Create an error IPC response
 */
export function ipcError(error: unknown): IPCResponse<never> {
  return { 
    success: false, 
    error: getErrorMessage(error) 
  };
}

/**
 * Wrap an async function to return IPC responses
 * Catches errors and returns proper error responses
 * 
 * @example
 * const handler = ipcHandler(async (text: string) => {
 *   const result = await processText(text);
 *   return result;
 * });
 */
export function ipcHandler<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>
): (...args: Args) => Promise<IPCResponse<T>> {
  return async (...args: Args): Promise<IPCResponse<T>> => {
    try {
      const result = await fn(...args);
      return ipcSuccess(result);
    } catch (error) {
      return ipcError(error);
    }
  };
}

// ============================================================================
// Additional Array Utilities
// ============================================================================

/**
 * Check if array is empty
 */
export function isEmpty<T>(array: T[] | null | undefined): boolean {
  return !array || array.length === 0;
}

/**
 * Check if array is not empty (with type narrowing)
 */
export function isNotEmpty<T>(array: T[] | null | undefined): array is T[] {
  return array !== null && array !== undefined && array.length > 0;
}

/**
 * Get random element from array
 */
export function randomElement<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Shuffle array in place (Fisher-Yates algorithm)
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Sum of numeric array
 */
export function sum(array: number[]): number {
  return array.reduce((acc, val) => acc + val, 0);
}

/**
 * Average of numeric array
 */
export function average(array: number[]): number {
  if (array.length === 0) return 0;
  return sum(array) / array.length;
}

// ============================================================================
// Deep Object Utilities
// ============================================================================

/**
 * Check if value is a plain object (not array, null, etc.)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * Deep clone an object (JSON-safe values only)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge objects (target is mutated)
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  for (const source of sources) {
    if (!source) continue;
    
    for (const key of Object.keys(source)) {
      const targetValue = target[key as keyof T];
      const sourceValue = source[key as keyof T];
      
      if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
        deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else if (sourceValue !== undefined) {
        (target as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }
  return target;
}

// ============================================================================
// Assertion Utilities
// ============================================================================

/**
 * Assert a condition is true, throw error if not
 * 
 * @example
 * invariant(user.id !== null, 'User ID is required');
 */
export function invariant(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/**
 * Assert a value is never reached (useful for exhaustive switch statements)
 * 
 * @example
 * switch (status) {
 *   case 'active': return 'Active';
 *   case 'inactive': return 'Inactive';
 *   default: assertNever(status);
 * }
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}

/**
 * Mark code as unreachable (will throw if reached)
 */
export function unreachable(message = 'This code should be unreachable'): never {
  throw new Error(message);
}

// ============================================================================
// Deferred Promise
// ============================================================================

/**
 * A promise that can be resolved or rejected from outside
 * Useful for complex async control flow
 * 
 * @example
 * const deferred = new Deferred<string>();
 * setTimeout(() => deferred.resolve('done'), 1000);
 * const result = await deferred.promise;
 */
export class Deferred<T> {
  readonly promise: Promise<T>;
  private _resolve!: (value: T | PromiseLike<T>) => void;
  private _reject!: (reason?: unknown) => void;
  private _settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolve(value: T | PromiseLike<T>): void {
    if (!this._settled) {
      this._settled = true;
      this._resolve(value);
    }
  }

  reject(reason?: unknown): void {
    if (!this._settled) {
      this._settled = true;
      this._reject(reason);
    }
  }

  get isSettled(): boolean {
    return this._settled;
  }
}

// ============================================================================
// Simple LRU Map
// ============================================================================

/**
 * Simple LRU (Least Recently Used) cache map
 * No external dependencies, suitable for small caches
 * 
 * @example
 * const cache = new LRUMap<string, User>(100);
 * cache.set('user:1', user);
 * const user = cache.get('user:1');
 */
export class LRUMap<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): this {
    // Delete first to ensure it goes to end
    this.cache.delete(key);
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, value);
    return this;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}

// ============================================================================
// Memoization
// ============================================================================

/**
 * Memoize a function (cache results by arguments)
 * Uses JSON serialization for cache keys
 * 
 * @example
 * const expensiveFn = memoize((x: number, y: number) => {
 *   // complex calculation
 *   return x * y;
 * });
 */
export function memoize<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  options?: { maxSize?: number }
): (...args: Args) => R {
  const cache = new LRUMap<string, R>(options?.maxSize ?? 100);
  
  return (...args: Args): R => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

// ============================================================================
// Iterator Utilities
// ============================================================================

/**
 * Generate a range of numbers
 * 
 * @example
 * range(5) // [0, 1, 2, 3, 4]
 * range(2, 5) // [2, 3, 4]
 * range(0, 10, 2) // [0, 2, 4, 6, 8]
 */
export function range(start: number, end?: number, step = 1): number[] {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < end; i += step) {
      result.push(i);
    }
  } else if (step < 0) {
    for (let i = start; i > end; i += step) {
      result.push(i);
    }
  }
  return result;
}

/**
 * Execute a function n times
 * 
 * @example
 * times(3, i => `item-${i}`) // ['item-0', 'item-1', 'item-2']
 */
export function times<T>(n: number, fn: (index: number) => T): T[] {
  return range(n).map(fn);
}

/**
 * Enumerate array with indices (like Python's enumerate)
 * 
 * @example
 * for (const [index, item] of enumerate(['a', 'b', 'c'])) {
 *   console.log(index, item);
 * }
 */
export function* enumerate<T>(
  iterable: Iterable<T>,
  start = 0
): Generator<[number, T], void, undefined> {
  let index = start;
  for (const item of iterable) {
    yield [index++, item];
  }
}

// ============================================================================
// Result Type (Explicit Error Handling)
// ============================================================================

/**
 * Result type for explicit error handling without exceptions
 * 
 * @example
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return Result.err('Cannot divide by zero');
 *   return Result.ok(a / b);
 * }
 * 
 * const result = divide(10, 2);
 * if (result.isOk()) {
 *   console.log(result.value); // 5
 * } else {
 *   console.log(result.error); // error message
 * }
 */
export class Result<T, E> {
  private constructor(
    private readonly _ok: boolean,
    private readonly _value?: T,
    private readonly _error?: E
  ) {}

  static ok<T, E = never>(value: T): Result<T, E> {
    return new Result<T, E>(true, value);
  }

  static err<E, T = never>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error);
  }

  isOk(): this is Result<T, never> & { value: T } {
    return this._ok;
  }

  isErr(): this is Result<never, E> & { error: E } {
    return !this._ok;
  }

  get value(): T {
    if (!this._ok) {
      throw new Error('Cannot get value from error result');
    }
    return this._value as T;
  }

  get error(): E {
    if (this._ok) {
      throw new Error('Cannot get error from ok result');
    }
    return this._error as E;
  }

  /**
   * Get value or default if error
   */
  unwrapOr(defaultValue: T): T {
    return this._ok ? (this._value as T) : defaultValue;
  }

  /**
   * Map the success value
   */
  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this._ok) {
      return Result.ok(fn(this._value as T));
    }
    return Result.err(this._error as E);
  }

  /**
   * Map the error value
   */
  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    if (this._ok) {
      return Result.ok(this._value as T);
    }
    return Result.err(fn(this._error as E));
  }

  /**
   * Convert to Promise (rejects on error)
   */
  toPromise(): Promise<T> {
    if (this._ok) {
      return Promise.resolve(this._value as T);
    }
    return Promise.reject(this._error);
  }
}

/**
 * Wrap a function that might throw to return a Result
 */
export function tryCatch<T, E = Error>(fn: () => T): Result<T, E> {
  try {
    return Result.ok(fn());
  } catch (error) {
    return Result.err(error as E);
  }
}

/**
 * Wrap an async function that might throw to return a Result
 */
export async function tryCatchAsync<T, E = Error>(
  fn: () => Promise<T>
): Promise<Result<T, E>> {
  try {
    const value = await fn();
    return Result.ok(value);
  } catch (error) {
    return Result.err(error as E);
  }
}

// ============================================================================
// Array Utilities
// ============================================================================

/**
 * Remove null and undefined values from an array, with proper type narrowing.
 * 
 * @param arr - Array that may contain null/undefined values
 * @returns Array with null/undefined removed
 * 
 * @example
 * compact([1, null, 2, undefined, 3]); // [1, 2, 3]
 * compact(['a', '', null, 'b']); // ['a', '', 'b'] - keeps falsy values except null/undefined
 */
export function compact<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((item): item is T => item !== null && item !== undefined);
}

/**
 * Remove falsy values (null, undefined, false, 0, '', NaN) from an array.
 * 
 * @param arr - Array that may contain falsy values
 * @returns Array with falsy values removed
 * 
 * @example
 * compactFalsy([1, null, 0, '', false, 2]); // [1, 2]
 */
export function compactFalsy<T>(arr: T[]): NonNullable<T>[] {
  return arr.filter(Boolean) as NonNullable<T>[];
}

/**
 * Ensure a value is an array. If the value is already an array, return it.
 * If the value is null/undefined, return an empty array.
 * Otherwise, wrap the value in an array.
 * 
 * @param value - Value that may or may not be an array
 * @returns The value as an array
 * 
 * @example
 * ensureArray([1, 2, 3]); // [1, 2, 3]
 * ensureArray(null); // []
 * ensureArray(undefined); // []
 * ensureArray('hello'); // ['hello']
 * ensureArray(42); // [42]
 */
export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value as T];
}

/**
 * Get the first N items from an array.
 * 
 * @param arr - Source array
 * @param n - Number of items to take
 * @returns Array with at most n items
 * 
 * @example
 * take([1, 2, 3, 4, 5], 3); // [1, 2, 3]
 * take([1, 2], 5); // [1, 2]
 */
export function take<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}

/**
 * Get the last N items from an array.
 * 
 * @param arr - Source array
 * @param n - Number of items to take
 * @returns Array with at most n items
 * 
 * @example
 * takeLast([1, 2, 3, 4, 5], 3); // [3, 4, 5]
 * takeLast([1, 2], 5); // [1, 2]
 */
export function takeLast<T>(arr: T[], n: number): T[] {
  if (n <= 0) return [];
  return arr.slice(-n);
}

/**
 * Find the first item matching a predicate and return it along with its index.
 * Returns undefined if no match is found.
 * 
 * @param arr - Array to search
 * @param predicate - Function to test each element
 * @returns Object with item and index, or undefined
 * 
 * @example
 * findWithIndex([1, 2, 3], n => n > 1); // { item: 2, index: 1 }
 * findWithIndex([1, 2, 3], n => n > 5); // undefined
 */
export function findWithIndex<T>(
  arr: T[],
  predicate: (item: T, index: number) => boolean
): { item: T; index: number } | undefined {
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i], i)) {
      return { item: arr[i], index: i };
    }
  }
  return undefined;
}

/**
 * Zip multiple arrays together, creating tuples of corresponding elements.
 * Stops at the shortest array.
 * 
 * @param arrays - Arrays to zip together
 * @returns Array of tuples
 * 
 * @example
 * zip([1, 2, 3], ['a', 'b', 'c']); // [[1, 'a'], [2, 'b'], [3, 'c']]
 * zip([1, 2], ['a', 'b', 'c']); // [[1, 'a'], [2, 'b']]
 */
export function zip<T extends unknown[][]>(
  ...arrays: T
): { [K in keyof T]: T[K] extends (infer U)[] ? U : never }[] {
  if (arrays.length === 0) return [];
  
  const minLength = Math.min(...arrays.map((arr) => arr.length));
  const result: unknown[][] = [];
  
  for (let i = 0; i < minLength; i++) {
    result.push(arrays.map((arr) => arr[i]));
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as any;
}

/**
 * Flatten an array of arrays by one level.
 * 
 * @param arr - Array of arrays to flatten
 * @returns Flattened array
 * 
 * @example
 * flatten([[1, 2], [3, 4], [5]]); // [1, 2, 3, 4, 5]
 */
export function flatten<T>(arr: T[][]): T[] {
  return arr.flat();
}

// ============================================================================
// Additional Object Utilities
// ============================================================================

/**
 * Count items grouped by a key derived from each item.
 * 
 * @param arr - Array to count
 * @param keyFn - Function to derive the grouping key from each item
 * @returns Object with keys as group names and values as counts
 * 
 * @example
 * countBy(['apple', 'banana', 'apple', 'cherry'], x => x); // { apple: 2, banana: 1, cherry: 1 }
 * countBy([1, 2, 3, 4, 5], n => n % 2 === 0 ? 'even' : 'odd'); // { odd: 3, even: 2 }
 */
export function countBy<T, K extends string | number>(
  arr: T[],
  keyFn: (item: T) => K
): Record<K, number> {
  return arr.reduce(
    (counts, item) => {
      const key = keyFn(item);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    },
    {} as Record<K, number>
  );
}

/**
 * Create a lookup map from an array using a key function.
 * 
 * @param arr - Array to convert
 * @param keyFn - Function to derive the key from each item
 * @returns Map with keys as derived values and values as items
 * 
 * @example
 * keyBy([{id: 1, name: 'a'}, {id: 2, name: 'b'}], x => x.id);
 * // Map { 1 => {id: 1, name: 'a'}, 2 => {id: 2, name: 'b'} }
 */
export function keyBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of arr) {
    map.set(keyFn(item), item);
  }
  return map;
}

/**
 * Map over object keys while preserving values.
 * 
 * @param obj - Source object
 * @param fn - Function to transform each key
 * @returns New object with transformed keys
 * 
 * @example
 * mapKeys({ a: 1, b: 2 }, k => k.toUpperCase()); // { A: 1, B: 2 }
 */
export function mapKeys<T>(
  obj: Record<string, T>,
  fn: (key: string, value: T) => string
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[fn(key, value)] = value;
  }
  return result;
}

/**
 * Create an object from key-value pairs.
 * 
 * @param entries - Array of [key, value] pairs
 * @returns Object created from the entries
 * 
 * @example
 * fromEntries([['a', 1], ['b', 2]]); // { a: 1, b: 2 }
 */
export function fromEntries<K extends string | number | symbol, V>(
  entries: [K, V][]
): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

/**
 * Check if an object has a specific own property with type narrowing.
 * 
 * @param obj - Object to check
 * @param key - Property key to check
 * @returns True if the object has the property
 * 
 * @example
 * const obj: unknown = { name: 'test' };
 * if (hasOwn(obj, 'name')) {
 *   console.log(obj.name); // TypeScript knows 'name' exists
 * }
 */
export function hasOwn<T extends object, K extends PropertyKey>(
  obj: T,
  key: K
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Create a promise that rejects after a specified timeout.
 * Useful for racing against other promises.
 * 
 * @param ms - Milliseconds before timeout
 * @param message - Error message for timeout
 * @returns Promise that rejects after timeout
 * 
 * @example
 * await Promise.race([
 *   fetchData(),
 *   timeout(5000, 'Request timed out')
 * ]);
 */
export function timeout(ms: number, message = 'Operation timed out'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms between attempts (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between attempts (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if an error is retryable (default: always true) */
  isRetryable?: (error: unknown, attempt: number) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Retry an async operation with exponential backoff.
 * 
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Promise with the function result
 * 
 * @example
 * const result = await retry(
 *   () => fetchWithFlakiness('/api/data'),
 *   { maxAttempts: 5, initialDelayMs: 500 }
 * );
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let currentDelay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryable(error, attempt)) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, attempt, currentDelay);
      }

      await sleep(currentDelay);
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Run async functions in parallel with concurrency limit.
 * 
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum concurrent operations (default: 5)
 * @returns Promise with array of results
 * 
 * @example
 * const urls = ['url1', 'url2', 'url3', 'url4', 'url5'];
 * const results = await parallelLimit(urls, fetchUrl, 2); // Max 2 concurrent fetches
 */
export async function parallelLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Settle all promises and return both fulfilled and rejected results.
 * 
 * @param promises - Promises to settle
 * @returns Object with fulfilled values and rejected errors
 * 
 * @example
 * const { fulfilled, rejected } = await settleAll([
 *   fetchGood(),
 *   fetchBad()
 * ]);
 * console.log(fulfilled); // [goodResult]
 * console.log(rejected); // [badError]
 */
export async function settleAll<T>(
  promises: Promise<T>[]
): Promise<{ fulfilled: T[]; rejected: unknown[] }> {
  const results = await Promise.allSettled(promises);
  
  const fulfilled: T[] = [];
  const rejected: unknown[] = [];
  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilled.push(result.value);
    } else {
      rejected.push(result.reason);
    }
  }
  
  return { fulfilled, rejected };
}

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Measure execution time of a function.
 * 
 * @param fn - Function to measure
 * @returns Object with result and duration in milliseconds
 * 
 * @example
 * const { result, durationMs } = await measureTime(async () => {
 *   await doSomething();
 *   return 42;
 * });
 * console.log(`Got ${result} in ${durationMs}ms`);
 */
export async function measureTime<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Create a simple stopwatch for measuring elapsed time.
 * 
 * @returns Stopwatch object with lap and elapsed methods
 * 
 * @example
 * const stopwatch = createStopwatch();
 * await doFirstThing();
 * console.log(`First thing took ${stopwatch.lap()}ms`);
 * await doSecondThing();
 * console.log(`Second thing took ${stopwatch.lap()}ms`);
 * console.log(`Total: ${stopwatch.elapsed()}ms`);
 */
export function createStopwatch(): {
  /** Get elapsed time since start */
  elapsed: () => number;
  /** Get elapsed time since last lap (or start) */
  lap: () => number;
  /** Reset the stopwatch */
  reset: () => void;
} {
  let start = performance.now();
  let lastLap = start;

  return {
    elapsed: () => performance.now() - start,
    lap: () => {
      const now = performance.now();
      const lapTime = now - lastLap;
      lastLap = now;
      return lapTime;
    },
    reset: () => {
      start = performance.now();
      lastLap = start;
    },
  };
}

// ============================================================================
// Conditional & Matching Utilities
// ============================================================================

/**
 * Pattern matching helper for cleaner conditional logic.
 * Matches against patterns and returns the first matching result.
 * 
 * @param value - Value to match against
 * @param patterns - Array of [predicate, result] pairs
 * @param defaultValue - Value to return if no pattern matches
 * @returns Matched result or default value
 * 
 * @example
 * const status = match(code, [
 *   [c => c >= 200 && c < 300, 'success'],
 *   [c => c >= 400 && c < 500, 'client-error'],
 *   [c => c >= 500, 'server-error'],
 * ], 'unknown');
 */
export function match<T, R>(
  value: T,
  patterns: Array<[(value: T) => boolean, R]>,
  defaultValue: R
): R {
  for (const [predicate, result] of patterns) {
    if (predicate(value)) {
      return result;
    }
  }
  return defaultValue;
}

/**
 * Execute different code paths based on a discriminant property.
 * Type-safe variant of switch statements.
 * 
 * @param obj - Object with discriminant property
 * @param handlers - Object mapping discriminant values to handlers
 * @returns Result from the matching handler
 * 
 * @example
 * const result = matchOn(event, 'type', {
 *   click: (e) => handleClick(e),
 *   hover: (e) => handleHover(e),
 *   default: (e) => handleUnknown(e),
 * });
 */
export function matchOn<
  T extends Record<K, string>,
  K extends keyof T,
  R
>(
  obj: T,
  key: K,
  handlers: { [P in T[K]]?: (obj: T) => R } & { default?: (obj: T) => R }
): R | undefined {
  const discriminant = obj[key];
  const handler = handlers[discriminant as T[K]] ?? handlers.default;
  return handler?.(obj);
}

// ============================================================================
// Numeric & Statistical Utilities
// ============================================================================

/**
 * Clamp a number to a minimum of zero (non-negative).
 * Shorthand for Math.max(0, value).
 * 
 * @param value - Number to clamp
 * @returns Non-negative number
 * 
 * @example
 * clampZero(-5)  // 0
 * clampZero(5)   // 5
 */
export function clampZero(value: number): number {
  return Math.max(0, value);
}

/**
 * Clamp a number between 0 and 1 (inclusive).
 * Common for percentages, probabilities, and normalized values.
 * 
 * @param value - Number to clamp
 * @returns Number between 0 and 1
 * 
 * @example
 * clamp01(-0.5)  // 0
 * clamp01(0.5)   // 0.5
 * clamp01(1.5)   // 1
 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Clamp a number between 0 and 100 (for percentages).
 * 
 * @param value - Number to clamp
 * @returns Number between 0 and 100
 * 
 * @example
 * clamp100(-10)  // 0
 * clamp100(50)   // 50
 * clamp100(150)  // 100
 */
export function clamp100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Calculate the median of an array of numbers.
 * Returns 0 for empty arrays.
 * 
 * @param arr - Array of numbers
 * @returns Median value
 * 
 * @example
 * median([1, 2, 3, 4, 5])  // 3
 * median([1, 2, 3, 4])     // 2.5
 */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate standard deviation of an array of numbers.
 * Uses population standard deviation formula.
 * 
 * @param arr - Array of numbers
 * @returns Standard deviation
 * 
 * @example
 * standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])  // ~2
 */
export function standardDeviation(arr: number[]): number {
  if (arr.length === 0) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

/**
 * Get the minimum value from an array of numbers.
 * Returns Infinity for empty arrays.
 * 
 * @param arr - Array of numbers
 * @returns Minimum value
 * 
 * @example
 * min([3, 1, 4, 1, 5])  // 1
 */
export function min(arr: number[]): number {
  return arr.length === 0 ? Infinity : Math.min(...arr);
}

/**
 * Get the maximum value from an array of numbers.
 * Returns -Infinity for empty arrays.
 * 
 * @param arr - Array of numbers
 * @returns Maximum value
 * 
 * @example
 * max([3, 1, 4, 1, 5])  // 5
 */
export function max(arr: number[]): number {
  return arr.length === 0 ? -Infinity : Math.max(...arr);
}

/**
 * Get min and max values in a single pass.
 * More efficient than calling min() and max() separately.
 * 
 * @param arr - Array of numbers
 * @returns Object with min and max values
 * 
 * @example
 * minMax([3, 1, 4, 1, 5])  // { min: 1, max: 5 }
 */
export function minMax(arr: number[]): { min: number; max: number } {
  if (arr.length === 0) {
    return { min: Infinity, max: -Infinity };
  }
  let minVal = arr[0];
  let maxVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < minVal) minVal = arr[i];
    if (arr[i] > maxVal) maxVal = arr[i];
  }
  return { min: minVal, max: maxVal };
}

// ============================================================================
// Array Counting & Selection Utilities
// ============================================================================

/**
 * Count elements that match a predicate.
 * More efficient than .filter().length for counting.
 * 
 * @param arr - Array to count from
 * @param predicate - Function to test each element
 * @returns Count of matching elements
 * 
 * @example
 * count([1, 2, 3, 4, 5], n => n > 2)  // 3
 * count(['a', 'b', 'a'], x => x === 'a')  // 2
 */
export function count<T>(arr: readonly T[], predicate: (item: T) => boolean): number {
  let n = 0;
  for (const item of arr) {
    if (predicate(item)) n++;
  }
  return n;
}

/**
 * Get top N items from an array based on a numeric property or selector.
 * Returns items sorted in descending order.
 * 
 * @param arr - Array to select from
 * @param n - Number of items to return
 * @param selector - Function to get numeric value for comparison
 * @returns Top N items sorted by value descending
 * 
 * @example
 * topN([{name: 'a', score: 10}, {name: 'b', score: 30}, {name: 'c', score: 20}], 2, x => x.score)
 * // [{name: 'b', score: 30}, {name: 'c', score: 20}]
 */
export function topN<T>(arr: readonly T[], n: number, selector: (item: T) => number): T[] {
  return [...arr].sort((a, b) => selector(b) - selector(a)).slice(0, n);
}

/**
 * Get bottom N items from an array based on a numeric property or selector.
 * Returns items sorted in ascending order.
 * 
 * @param arr - Array to select from
 * @param n - Number of items to return
 * @param selector - Function to get numeric value for comparison
 * @returns Bottom N items sorted by value ascending
 * 
 * @example
 * bottomN([{name: 'a', score: 10}, {name: 'b', score: 30}, {name: 'c', score: 20}], 2, x => x.score)
 * // [{name: 'a', score: 10}, {name: 'c', score: 20}]
 */
export function bottomN<T>(arr: readonly T[], n: number, selector: (item: T) => number): T[] {
  return [...arr].sort((a, b) => selector(a) - selector(b)).slice(0, n);
}

/**
 * Limit an array to a maximum length, keeping the most recent items.
 * Useful for maintaining fixed-size history/log arrays.
 * 
 * @param arr - Array to limit
 * @param maxLength - Maximum length to keep
 * @returns New array with at most maxLength items (keeps last items)
 * 
 * @example
 * limitArray([1, 2, 3, 4, 5], 3)  // [3, 4, 5]
 * limitArray([1, 2], 5)          // [1, 2]
 */
export function limitArray<T>(arr: readonly T[], maxLength: number): T[] {
  if (arr.length <= maxLength) return [...arr];
  return arr.slice(-maxLength);
}

/**
 * Get the last N items from an array (alias for takeLast with slice semantics).
 * Returns a new array with the last N elements.
 * 
 * @param arr - Array to slice from
 * @param n - Number of items to take from end
 * @returns Last N items
 * 
 * @example
 * lastN([1, 2, 3, 4, 5], 3)  // [3, 4, 5]
 * lastN([1, 2], 5)           // [1, 2]
 */
export function lastN<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= arr.length) return [...arr];
  return arr.slice(-n);
}

/**
 * Sample random items from an array without replacement.
 * 
 * @param arr - Array to sample from
 * @param n - Number of items to sample
 * @returns Array of n random items
 * 
 * @example
 * sample([1, 2, 3, 4, 5], 2)  // e.g., [3, 1]
 */
export function sample<T>(arr: readonly T[], n: number): T[] {
  const result: T[] = [];
  const available = [...arr];
  const count = Math.min(n, available.length);
  
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * available.length);
    result.push(available[idx]);
    available.splice(idx, 1);
  }
  
  return result;
}

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 * 
 * @param str - String to truncate
 * @param maxLength - Maximum length including ellipsis
 * @param ellipsis - String to append when truncated (default: '...')
 * @returns Truncated string
 * 
 * @example
 * truncate('Hello World', 8)       // 'Hello...'
 * truncate('Hi', 10)               // 'Hi'
 * truncate('Hello World', 8, '…')  // 'Hello W…'
 */
export function truncate(str: string, maxLength: number, ellipsis = '...'): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Truncate a string from the start, useful for file paths.
 * 
 * @param str - String to truncate
 * @param maxLength - Maximum length including prefix
 * @param prefix - String to prepend when truncated (default: '...')
 * @returns Truncated string
 * 
 * @example
 * truncateStart('/very/long/path/to/file.ts', 20)  // '...ng/path/to/file.ts'
 */
export function truncateStart(str: string, maxLength: number, prefix = '...'): string {
  if (str.length <= maxLength) return str;
  return prefix + str.slice(-(maxLength - prefix.length));
}

/**
 * Pad a string to a minimum length.
 * 
 * @param str - String to pad
 * @param minLength - Minimum length
 * @param char - Character to pad with (default: ' ')
 * @param position - Where to pad ('start' | 'end')
 * @returns Padded string
 * 
 * @example
 * pad('42', 5, '0', 'start')  // '00042'
 * pad('hi', 5, ' ', 'end')    // 'hi   '
 */
export function pad(
  str: string,
  minLength: number,
  char = ' ',
  position: 'start' | 'end' = 'start'
): string {
  if (str.length >= minLength) return str;
  const padding = char.repeat(minLength - str.length);
  return position === 'start' ? padding + str : str + padding;
}

/**
 * Convert a string to title case.
 * 
 * @param str - String to convert
 * @returns Title cased string
 * 
 * @example
 * titleCase('hello world')  // 'Hello World'
 * titleCase('HELLO WORLD')  // 'Hello World'
 */
export function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\w/g, match => match.toUpperCase());
}

/**
 * Convert a string to camelCase.
 * 
 * @param str - String to convert (can be kebab-case, snake_case, or space separated)
 * @returns camelCased string
 * 
 * @example
 * camelCase('hello-world')  // 'helloWorld'
 * camelCase('hello_world')  // 'helloWorld'
 * camelCase('Hello World')  // 'helloWorld'
 */
export function camelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^./, c => c.toLowerCase());
}

/**
 * Convert a string to kebab-case.
 * 
 * @param str - String to convert
 * @returns kebab-cased string
 * 
 * @example
 * kebabCase('helloWorld')   // 'hello-world'
 * kebabCase('Hello World')  // 'hello-world'
 */
export function kebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Convert a string to snake_case.
 * 
 * @param str - String to convert
 * @returns snake_cased string
 * 
 * @example
 * snakeCase('helloWorld')   // 'hello_world'
 * snakeCase('Hello World')  // 'hello_world'
 */
export function snakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

// ============================================================================
// Boolean & Validation Utilities
// ============================================================================

/**
 * Check if all elements in an array pass a predicate.
 * Short-circuits on first failure.
 * 
 * @param arr - Array to check
 * @param predicate - Function to test each element
 * @returns True if all elements pass
 * 
 * @example
 * all([2, 4, 6], n => n % 2 === 0)  // true
 * all([2, 3, 4], n => n % 2 === 0)  // false
 */
export function all<T>(arr: readonly T[], predicate: (item: T) => boolean): boolean {
  for (const item of arr) {
    if (!predicate(item)) return false;
  }
  return true;
}

/**
 * Check if any element in an array passes a predicate.
 * Short-circuits on first match.
 * 
 * @param arr - Array to check
 * @param predicate - Function to test each element
 * @returns True if any element passes
 * 
 * @example
 * any([1, 2, 3], n => n > 2)  // true
 * any([1, 2, 3], n => n > 5)  // false
 */
export function any<T>(arr: readonly T[], predicate: (item: T) => boolean): boolean {
  for (const item of arr) {
    if (predicate(item)) return true;
  }
  return false;
}

/**
 * Check if none of the elements pass a predicate.
 * 
 * @param arr - Array to check
 * @param predicate - Function to test each element
 * @returns True if no elements pass
 * 
 * @example
 * none([1, 2, 3], n => n > 5)  // true
 * none([1, 2, 3], n => n > 2)  // false
 */
export function none<T>(arr: readonly T[], predicate: (item: T) => boolean): boolean {
  return !any(arr, predicate);
}

// ============================================================================
// Date & Time Utilities
// ============================================================================

/**
 * Get timestamp in milliseconds.
 * Shorter than Date.now() and avoids new Date().getTime().
 * 
 * @returns Current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Format a date as ISO string (YYYY-MM-DD).
 * 
 * @param date - Date to format (defaults to now)
 * @returns ISO date string
 * 
 * @example
 * isoDate(new Date('2024-03-15'))  // '2024-03-15'
 */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format a date as ISO datetime string.
 * 
 * @param date - Date to format (defaults to now)
 * @returns ISO datetime string
 * 
 * @example
 * isoDateTime(new Date())  // '2024-03-15T10:30:00.000Z'
 */
export function isoDateTime(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Get a date relative to now.
 * 
 * @param offset - Offset in milliseconds (positive for future, negative for past)
 * @returns New Date
 * 
 * @example
 * relativeDate(-24 * 60 * 60 * 1000)  // Yesterday
 * relativeDate(7 * 24 * 60 * 60 * 1000)  // 1 week from now
 */
export function relativeDate(offset: number): Date {
  return new Date(Date.now() + offset);
}

/**
 * Check if a date is today.
 * 
 * @param date - Date to check
 * @returns True if the date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Get milliseconds for common time intervals.
 */
export const MS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// ============================================================================
// Safe Operation Utilities
// ============================================================================

/**
 * Safely access a deeply nested property.
 * Returns undefined if any part of the path doesn't exist.
 * 
 * @param obj - Object to access
 * @param path - Dot-separated path string
 * @param defaultValue - Value to return if path doesn't exist
 * @returns Value at path or default value
 * 
 * @example
 * const obj = { a: { b: { c: 42 } } };
 * safeGet(obj, 'a.b.c')           // 42
 * safeGet(obj, 'a.b.d', 0)        // 0
 * safeGet(obj, 'x.y.z', 'nope')   // 'nope'
 */
export function safeGet<T = unknown>(
  obj: Record<string, unknown>,
  path: string,
  defaultValue?: T
): T | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return (current as T) ?? defaultValue;
}