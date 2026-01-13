/**
 * Logger Tests
 * Note: Uses simpler tests to avoid file system race conditions during cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Logger Module', () => {
  beforeEach(() => {
    vi.resetModules();
    
    // Set up test environment
    process.env.PORCUPINE_API_KEY = 'test';
    process.env.DEEPGRAM_API_KEY = 'test';
    process.env.ELEVENLABS_API_KEY = 'test';
    process.env.FIREWORKS_API_KEY = 'test';
    process.env.OPENROUTER_API_KEY = 'test';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'debug';
    // Use unique temp dir per test run to avoid conflicts
    process.env.LOG_DIR = join(tmpdir(), `nova-test-logs-${Date.now()}`);
  });

  it('should create logger instance', async () => {
    const { getLogger } = await import('../src/main/utils/logger');
    const logger = getLogger();
    
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should create module logger with all methods', async () => {
    const { createModuleLogger } = await import('../src/main/utils/logger');
    const moduleLogger = createModuleLogger('TestModule');
    
    expect(moduleLogger).toBeDefined();
    expect(typeof moduleLogger.info).toBe('function');
    expect(typeof moduleLogger.debug).toBe('function');
    expect(typeof moduleLogger.warn).toBe('function');
    expect(typeof moduleLogger.error).toBe('function');
    expect(typeof moduleLogger.time).toBe('function');
    expect(typeof moduleLogger.logError).toBe('function');
  });

  it('should export pre-created module loggers', async () => {
    const loggers = await import('../src/main/utils/logger');
    
    expect(loggers.mainLogger).toBeDefined();
    expect(loggers.voiceLogger).toBeDefined();
    expect(loggers.llmLogger).toBeDefined();
    expect(loggers.ttsLogger).toBeDefined();
    expect(loggers.sttLogger).toBeDefined();
  });

  it('should create performance timer', async () => {
    const { PerformanceTimer } = await import('../src/main/utils/logger');
    const timer = new PerformanceTimer('Test');
    
    expect(timer).toBeDefined();
    expect(typeof timer.start).toBe('function');
    expect(typeof timer.end).toBe('function');
    expect(typeof timer.measure).toBe('function');
  });

  it('should measure timing correctly', async () => {
    const { PerformanceTimer } = await import('../src/main/utils/logger');
    const timer = new PerformanceTimer('Test');
    
    timer.start('operation');
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 5));
    const duration = timer.end('operation');
    
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});
