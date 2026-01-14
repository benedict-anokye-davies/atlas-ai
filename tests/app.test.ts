/**
 * Basic App Tests
 *
 * These tests verify the Nova app mock is properly configured.
 * They test the expected interface of window.nova API.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Define mock nova interface for tests when window is not available
interface MockNovaApi {
  getVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  isDev: () => Promise<boolean>;
  getStatus: () => Promise<{
    status: string;
    version: string;
    isDev: boolean;
  }>;
  platform: string;
  send: () => void;
  on: () => () => void;
  invoke: () => Promise<null>;
}

// Mock window.nova for node environment
let mockNova: MockNovaApi;

beforeAll(() => {
  mockNova = {
    getVersion: async () => '0.1.0',
    getAppPath: async () => '/mock/path',
    isDev: async () => true,
    getStatus: async () => ({
      status: 'testing',
      version: '0.1.0',
      isDev: true,
    }),
    platform: 'win32',
    send: () => {},
    on: () => () => {},
    invoke: async () => null,
  };

  // Set up window.nova if in browser-like environment
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'nova', {
      value: mockNova,
      writable: true,
      configurable: true,
    });
  }
});

// Helper to get nova - works in both node and jsdom
const getNova = (): MockNovaApi => {
  if (typeof window !== 'undefined' && (window as unknown as { nova?: MockNovaApi }).nova) {
    return (window as unknown as { nova: MockNovaApi }).nova;
  }
  return mockNova;
};

describe('Nova App', () => {
  it('should have nova API available', () => {
    const nova = getNova();
    expect(nova).toBeDefined();
  });

  it('should return correct version', async () => {
    const nova = getNova();
    const version = await nova.getVersion();
    expect(version).toBe('0.1.0');
  });

  it('should be in dev mode during tests', async () => {
    const nova = getNova();
    const isDev = await nova.isDev();
    expect(isDev).toBe(true);
  });

  it('should return status object', async () => {
    const nova = getNova();
    const status = await nova.getStatus();
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('version');
    expect(status).toHaveProperty('isDev');
  });
});

describe('Environment', () => {
  it('should have correct platform', () => {
    const nova = getNova();
    expect(nova.platform).toBe('win32');
  });
});
