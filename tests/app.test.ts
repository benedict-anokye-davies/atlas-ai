/**
 * Basic App Tests
 */

import { describe, it, expect } from 'vitest';

describe('Nova App', () => {
  it('should have window.nova mock available', () => {
    expect(window.nova).toBeDefined();
  });

  it('should return correct version', async () => {
    const version = await window.nova?.getVersion();
    expect(version).toBe('0.1.0');
  });

  it('should be in dev mode during tests', async () => {
    const isDev = await window.nova?.isDev();
    expect(isDev).toBe(true);
  });

  it('should return status object', async () => {
    const status = await window.nova?.getStatus();
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('version');
    expect(status).toHaveProperty('isDev');
  });
});

describe('Environment', () => {
  it('should have correct platform', () => {
    expect(window.nova?.platform).toBe('win32');
  });
});
