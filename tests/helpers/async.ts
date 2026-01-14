/**
 * Async Test Helpers
 * Utilities for testing asynchronous code
 */

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to become true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await wait(interval);
  }

  throw new Error(`waitFor timeout after ${timeout}ms`);
}

/**
 * Wait for an event to be emitted
 */
export function waitForEvent<T>(
  emitter: { on: (event: string, handler: (data: T) => void) => void; off?: (event: string, handler: (data: T) => void) => void },
  eventName: string,
  options: { timeout?: number } = {}
): Promise<T> {
  const { timeout = 5000 } = options;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (emitter.off) {
        emitter.off(eventName, handler);
      }
      reject(new Error(`waitForEvent timeout waiting for "${eventName}" after ${timeout}ms`));
    }, timeout);

    const handler = (data: T) => {
      clearTimeout(timer);
      if (emitter.off) {
        emitter.off(eventName, handler);
      }
      resolve(data);
    };

    emitter.on(eventName, handler);
  });
}

/**
 * Collect multiple events into an array
 */
export async function collectEvents<T>(
  emitter: { on: (event: string, handler: (data: T) => void) => void; off?: (event: string, handler: (data: T) => void) => void },
  eventName: string,
  count: number,
  options: { timeout?: number } = {}
): Promise<T[]> {
  const { timeout = 5000 } = options;
  const events: T[] = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (emitter.off) {
        emitter.off(eventName, handler);
      }
      reject(new Error(`collectEvents timeout after ${timeout}ms, collected ${events.length}/${count} events`));
    }, timeout);

    const handler = (data: T) => {
      events.push(data);
      if (events.length >= count) {
        clearTimeout(timer);
        if (emitter.off) {
          emitter.off(eventName, handler);
        }
        resolve(events);
      }
    };

    emitter.on(eventName, handler);
  });
}

/**
 * Run an async function and measure its execution time
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Retry an async function until it succeeds or max retries reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 100, backoff = 2 } = options;
  let lastError: Error | undefined;
  let currentDelay = delay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        await wait(currentDelay);
        currentDelay *= backoff;
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Run multiple async operations with a concurrency limit
 */
export async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
    });

    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((e) => e === p),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}
