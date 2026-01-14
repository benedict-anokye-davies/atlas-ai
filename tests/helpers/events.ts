/**
 * Event Testing Helpers
 * Utilities for testing event-driven components
 */

import { vi } from 'vitest';

/**
 * Creates a spy that records all calls with timestamps
 */
export function createTimestampedSpy() {
  const calls: Array<{ args: unknown[]; timestamp: number }> = [];
  const spy = vi.fn((...args: unknown[]) => {
    calls.push({ args, timestamp: performance.now() });
  });

  return {
    spy,
    calls,
    getCallAt: (index: number) => calls[index],
    getTimeBetween: (index1: number, index2: number) => {
      if (calls[index1] && calls[index2]) {
        return calls[index2].timestamp - calls[index1].timestamp;
      }
      return -1;
    },
    clear: () => {
      calls.length = 0;
      spy.mockClear();
    },
  };
}

/**
 * Creates a mock event emitter for testing
 */
export function createMockEventEmitter() {
  const listeners = new Map<string, Set<Function>>();

  return {
    on(event: string, handler: Function) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      return this;
    },
    off(event: string, handler: Function) {
      listeners.get(event)?.delete(handler);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((handler) => handler(...args));
      return this;
    },
    once(event: string, handler: Function) {
      const wrapper = (...args: unknown[]) => {
        this.off(event, wrapper);
        handler(...args);
      };
      return this.on(event, wrapper);
    },
    removeAllListeners(event?: string) {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
      return this;
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    _listeners: listeners,
  };
}

/**
 * Records state transitions for testing state machines
 */
export function createStateRecorder<T>() {
  const transitions: Array<{ from: T | null; to: T; timestamp: number }> = [];
  let currentState: T | null = null;

  return {
    record(newState: T) {
      transitions.push({
        from: currentState,
        to: newState,
        timestamp: performance.now(),
      });
      currentState = newState;
    },
    get current() {
      return currentState;
    },
    get transitions() {
      return [...transitions];
    },
    hasTransitioned(from: T, to: T) {
      return transitions.some((t) => t.from === from && t.to === to);
    },
    getTransitionTime(from: T, to: T) {
      for (let i = 0; i < transitions.length - 1; i++) {
        if (transitions[i].to === from) {
          const next = transitions.find((t, j) => j > i && t.to === to);
          if (next) {
            return next.timestamp - transitions[i].timestamp;
          }
        }
      }
      return -1;
    },
    clear() {
      transitions.length = 0;
      currentState = null;
    },
  };
}

/**
 * Creates an event sequence validator
 */
export function createEventSequenceValidator(expectedSequence: string[]) {
  const receivedEvents: string[] = [];

  return {
    record(event: string) {
      receivedEvents.push(event);
    },
    isValid() {
      if (receivedEvents.length !== expectedSequence.length) {
        return false;
      }
      return receivedEvents.every((event, i) => event === expectedSequence[i]);
    },
    getReceived() {
      return [...receivedEvents];
    },
    getExpected() {
      return [...expectedSequence];
    },
    getMismatch() {
      for (let i = 0; i < Math.max(receivedEvents.length, expectedSequence.length); i++) {
        if (receivedEvents[i] !== expectedSequence[i]) {
          return {
            index: i,
            expected: expectedSequence[i],
            received: receivedEvents[i],
          };
        }
      }
      return null;
    },
    clear() {
      receivedEvents.length = 0;
    },
  };
}

/**
 * Asserts event order
 */
export function assertEventOrder(
  calls: Array<{ timestamp: number }>,
  expectedOrder: number[]
): void {
  for (let i = 0; i < expectedOrder.length - 1; i++) {
    const currentIndex = expectedOrder[i];
    const nextIndex = expectedOrder[i + 1];
    if (calls[currentIndex].timestamp > calls[nextIndex].timestamp) {
      throw new Error(
        `Event at index ${currentIndex} occurred after event at index ${nextIndex}`
      );
    }
  }
}
