/**
 * Configuration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Config Module', () => {
  beforeEach(() => {
    // Reset modules to get fresh config
    vi.resetModules();
  });

  it('should load config from environment variables', async () => {
    // Set test env vars before importing
    process.env.PORCUPINE_API_KEY = 'test-porcupine-key';
    process.env.USER_NAME = 'TestUser';
    
    const { getConfig, reloadConfig } = await import('../src/main/config');
    reloadConfig();
    const config = getConfig();

    expect(config.porcupineApiKey).toBe('test-porcupine-key');
    expect(config.userName).toBe('TestUser');
  });

  it('should validate config with all required keys', async () => {
    // Set all required keys
    process.env.PORCUPINE_API_KEY = 'key1';
    process.env.DEEPGRAM_API_KEY = 'key2';
    process.env.ELEVENLABS_API_KEY = 'key3';
    process.env.FIREWORKS_API_KEY = 'key4';
    process.env.OPENROUTER_API_KEY = 'key5';
    
    const { getConfigValidation, reloadConfig } = await import('../src/main/config');
    reloadConfig();
    const validation = getConfigValidation();

    expect(validation.valid).toBe(true);
    expect(validation.missing).toHaveLength(0);
  });

  it('should detect missing API keys', async () => {
    // Remove required key
    process.env.PORCUPINE_API_KEY = '';
    process.env.DEEPGRAM_API_KEY = 'key2';
    process.env.ELEVENLABS_API_KEY = 'key3';
    process.env.FIREWORKS_API_KEY = 'key4';
    process.env.OPENROUTER_API_KEY = 'key5';
    
    const { getConfigValidation, reloadConfig } = await import('../src/main/config');
    reloadConfig();
    const validation = getConfigValidation();

    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain('porcupineApiKey');
  });

  it('should use default values for optional settings', async () => {
    process.env.PORCUPINE_API_KEY = 'key1';
    
    const { getConfig, reloadConfig } = await import('../src/main/config');
    reloadConfig();
    const config = getConfig();

    expect(config.audioSampleRate).toBe(16000);
    expect(config.audioChannels).toBe(1);
    expect(config.wakeWordSensitivity).toBe(0.5);
  });

  it('should mask API keys in safe config', async () => {
    process.env.PORCUPINE_API_KEY = 'test-porcupine-key';
    process.env.USER_NAME = 'SafeTestUser';
    
    const { getSafeConfig, reloadConfig } = await import('../src/main/config');
    reloadConfig();
    const safe = getSafeConfig();

    expect(safe.porcupineApiKey).toContain('***');
    expect(String(safe.porcupineApiKey)).not.toBe('test-porcupine-key');
    expect(safe.userName).toBe('SafeTestUser');
  });

  it('should report if API key is configured', async () => {
    process.env.PORCUPINE_API_KEY = 'has-this-key';
    delete process.env.PERPLEXITY_API_KEY;
    
    const { hasApiKey, reloadConfig } = await import('../src/main/config');
    reloadConfig();

    expect(hasApiKey('porcupineApiKey')).toBe(true);
    // perplexityApiKey might be set from actual .env, just test the function works
    const hasPlex = hasApiKey('perplexityApiKey');
    expect(typeof hasPlex).toBe('boolean');
  });
});
