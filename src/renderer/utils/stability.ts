/**
 * Atlas Desktop - Frontend Stability System
 * Bulletproof error handling and recovery utilities
 * 
 * This module provides:
 * - Safe IPC wrappers that never throw
 * - Global error handlers for unhandled rejections
 * - Canvas safety utilities
 * - Memory-safe async operations
 * - Recovery mechanisms
 */

// ============================================================================
// Types
// ============================================================================

export interface SafeResult<T> {
  success: true;
  data: T;
}

export interface SafeError {
  success: false;
  error: string;
  code?: string;
}

export type SafeResponse<T> = SafeResult<T> | SafeError;

// ============================================================================
// Safe IPC Wrapper
// ============================================================================

/**
 * Safely invoke an IPC method with automatic error handling
 * NEVER throws - always returns SafeResponse
 */
export async function safeInvoke<T>(
  channel: string,
  ...args: unknown[]
): Promise<SafeResponse<T>> {
  try {
    // Check if window.atlas exists
    if (!window.atlas) {
      return {
        success: false,
        error: 'Atlas API not available',
        code: 'API_UNAVAILABLE',
      };
    }

    // Check if invoke method exists
    if (typeof window.atlas.invoke !== 'function') {
      return {
        success: false,
        error: 'Atlas invoke method not available',
        code: 'INVOKE_UNAVAILABLE',
      };
    }

    const result = await window.atlas.invoke<T>(channel, ...args);
    
    // Handle null/undefined results
    if (result === null || result === undefined) {
      return {
        success: true,
        data: null as unknown as T,
      };
    }

    // If result already has success/data structure, return as-is
    if (typeof result === 'object' && 'success' in result) {
      return result as SafeResponse<T>;
    }

    return {
      success: true,
      data: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown IPC error';
    console.warn(`[Stability] IPC call failed: ${channel}`, message);
    return {
      success: false,
      error: message,
      code: 'IPC_ERROR',
    };
  }
}

/**
 * Safely call a method on window.atlas with fallback
 */
export async function safeAtlasCall<T>(
  path: string,
  fallback: T,
  ...args: unknown[]
): Promise<T> {
  try {
    if (!window.atlas) return fallback;

    // Navigate the path (e.g., "atlas.getConversationHistory")
    const parts = path.split('.');
    let current: unknown = window.atlas;

    for (const part of parts) {
      if (current === null || current === undefined) return fallback;
      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current !== 'function') return fallback;

    const result = await (current as (...a: unknown[]) => Promise<unknown>)(...args);
    
    if (result === null || result === undefined) return fallback;

    // Handle IPC response format
    if (typeof result === 'object' && 'success' in result) {
      const response = result as { success: boolean; data?: T };
      return response.success && response.data !== undefined ? response.data : fallback;
    }

    return result as T;
  } catch (err) {
    console.warn(`[Stability] Atlas call failed: ${path}`, err);
    return fallback;
  }
}

// ============================================================================
// Event Listener Safety
// ============================================================================

/**
 * Safely subscribe to an Atlas event with automatic cleanup
 */
export function safeOn(
  channel: string,
  callback: (data: unknown) => void
): () => void {
  try {
    if (!window.atlas?.on) {
      console.warn(`[Stability] Cannot subscribe to ${channel} - atlas.on unavailable`);
      return () => {}; // Return no-op cleanup
    }

    // Wrap callback to catch errors
    const safeCallback = (data: unknown) => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[Stability] Event callback error: ${channel}`, err);
      }
    };

    const unsubscribe = window.atlas.on(channel, safeCallback);
    
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  } catch (err) {
    console.error(`[Stability] Failed to subscribe to ${channel}`, err);
    return () => {};
  }
}

// ============================================================================
// Canvas Safety
// ============================================================================

/**
 * Safely get a 2D canvas context with fallback handling
 */
export function safeGetContext2D(
  canvas: HTMLCanvasElement | null
): CanvasRenderingContext2D | null {
  try {
    if (!canvas) return null;
    
    const ctx = canvas.getContext('2d', {
      // Performance optimizations
      alpha: true,
      desynchronized: true, // Better performance
    });

    return ctx;
  } catch (err) {
    console.warn('[Stability] Failed to get canvas context', err);
    return null;
  }
}

/**
 * Safely get a WebGL context with fallback to WebGL1
 */
export function safeGetWebGLContext(
  canvas: HTMLCanvasElement | null
): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    if (!canvas) return null;

    // Try WebGL2 first
    let gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;

    // Fallback to WebGL1
    if (!gl) {
      gl = canvas.getContext('webgl', {
        antialias: true,
        alpha: true,
      }) as WebGLRenderingContext | null;
    }

    return gl;
  } catch (err) {
    console.warn('[Stability] Failed to get WebGL context', err);
    return null;
  }
}

/**
 * Safe requestAnimationFrame with automatic cleanup tracking
 */
export function safeRAF(
  callback: (time: number) => void,
  cleanupRef?: { current: number | null }
): number {
  try {
    const frameId = requestAnimationFrame((time) => {
      try {
        callback(time);
      } catch (err) {
        console.error('[Stability] Animation frame error', err);
      }
    });

    if (cleanupRef) {
      cleanupRef.current = frameId;
    }

    return frameId;
  } catch (err) {
    console.error('[Stability] Failed to request animation frame', err);
    return 0;
  }
}

/**
 * Safe cancelAnimationFrame
 */
export function safeCancelRAF(frameId: number | null | undefined): void {
  try {
    if (frameId !== null && frameId !== undefined && frameId > 0) {
      cancelAnimationFrame(frameId);
    }
  } catch {
    // Ignore cancellation errors
  }
}

// ============================================================================
// Async Safety
// ============================================================================

/**
 * Run an async operation with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  }
}

/**
 * Retry an async operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 100
): Promise<T | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.warn('[Stability] Operation failed after retries', lastError);
  return null;
}

// ============================================================================
// Memory Safety
// ============================================================================

/**
 * Create a cleanup tracker for useEffect
 */
export function createCleanupTracker(): {
  track: (cleanup: () => void) => void;
  cleanup: () => void;
} {
  const cleanups: Array<() => void> = [];

  return {
    track: (cleanup: () => void) => {
      cleanups.push(cleanup);
    },
    cleanup: () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch (err) {
          console.warn('[Stability] Cleanup error', err);
        }
      }
      cleanups.length = 0;
    },
  };
}

/**
 * Debounce a function with safety
 */
export function safeDebounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: unknown[]) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      try {
        fn(...args);
      } catch (err) {
        console.error('[Stability] Debounced function error', err);
      }
      timeoutId = null;
    }, delayMs);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

// ============================================================================
// Global Error Handlers
// ============================================================================

let globalHandlersInstalled = false;

/**
 * Install global error handlers for unhandled errors
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Stability] Unhandled promise rejection:', event.reason);
    
    // Prevent the default browser behavior (logging to console)
    event.preventDefault();

    // Log to main process if available
    try {
      window.atlas?.log?.('error', 'UnhandledRejection', String(event.reason), {
        stack: event.reason?.stack,
      });
    } catch {
      // Ignore logging errors
    }
  });

  // Global error handler
  window.addEventListener('error', (event) => {
    console.error('[Stability] Global error:', event.error);

    // Don't prevent default for syntax errors
    if (event.error instanceof SyntaxError) {
      return;
    }

    // Log to main process if available
    try {
      window.atlas?.log?.('error', 'GlobalError', event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      });
    } catch {
      // Ignore logging errors
    }
  });

  // ResizeObserver loop error (common and harmless)
  const resizeObserverError = /ResizeObserver loop/;
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args[0];
    if (typeof message === 'string' && resizeObserverError.test(message)) {
      // Suppress ResizeObserver loop errors (they're benign)
      return;
    }
    originalConsoleError.apply(console, args);
  };

  console.log('[Stability] Global error handlers installed');
}

// ============================================================================
// Component Helpers
// ============================================================================

/**
 * Safe state setter that checks if component is mounted
 */
export function createSafeSetState<T>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  isMountedRef: React.MutableRefObject<boolean>
): (value: React.SetStateAction<T>) => void {
  return (value: React.SetStateAction<T>) => {
    if (isMountedRef.current) {
      setState(value);
    }
  };
}

/**
 * Safe JSON parse with fallback
 */
export function safeJSONParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safe localStorage get with fallback
 */
export function safeLocalStorageGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (item === null) return fallback;
    return JSON.parse(item) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safe localStorage set
 */
export function safeLocalStorageSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    console.warn(`[Stability] Failed to save to localStorage: ${key}`);
    return false;
  }
}

// ============================================================================
// Export All
// ============================================================================

export const Stability = {
  safeInvoke,
  safeAtlasCall,
  safeOn,
  safeGetContext2D,
  safeGetWebGLContext,
  safeRAF,
  safeCancelRAF,
  withTimeout,
  withRetry,
  createCleanupTracker,
  safeDebounce,
  installGlobalErrorHandlers,
  createSafeSetState,
  safeJSONParse,
  safeLocalStorageGet,
  safeLocalStorageSet,
};

export default Stability;
