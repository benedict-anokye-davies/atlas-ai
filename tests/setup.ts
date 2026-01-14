/**
 * Vitest Test Setup
 */

import { afterEach } from 'vitest';

// Clean up after each test
afterEach(() => {
  // Add any global cleanup here
});

// Mock window.nova for tests (only in browser-like environment)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'nova', {
    value: {
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
    },
    writable: true,
  });
}
