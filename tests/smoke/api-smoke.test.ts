/**
 * API Smoke Tests
 *
 * These tests validate real API connections using minimal API calls.
 * They are budget-conscious and designed for manual or CI execution.
 *
 * To run these tests:
 * 1. Set required environment variables (API keys)
 * 2. Run: npm run test:smoke
 *
 * Environment variables required:
 * - DEEPGRAM_API_KEY: For STT smoke tests
 * - ELEVENLABS_API_KEY: For TTS smoke tests
 * - FIREWORKS_API_KEY: For LLM smoke tests
 *
 * Set SKIP_SMOKE_TESTS=true to skip all smoke tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Check if smoke tests should run
const SKIP_SMOKE_TESTS = process.env.SKIP_SMOKE_TESTS === 'true';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;

// Test timeouts (generous for network latency)
const API_TIMEOUT = 30000;

describe.skipIf(SKIP_SMOKE_TESTS)('API Smoke Tests', () => {
  describe.skipIf(!DEEPGRAM_API_KEY)('Deepgram API', () => {
    it('should connect to Deepgram API', async () => {
      // Minimal API call - just verify authentication works
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        method: 'GET',
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.projects).toBeDefined();
    }, API_TIMEOUT);

    it('should have valid API key permissions', async () => {
      const response = await fetch('https://api.deepgram.com/v1/keys', {
        method: 'GET',
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        },
      });

      // Even if keys endpoint requires admin, 401 means auth works
      // 403 means auth works but lacks permission (still valid)
      expect([200, 403].includes(response.status)).toBe(true);
    }, API_TIMEOUT);
  });

  describe.skipIf(!ELEVENLABS_API_KEY)('ElevenLabs API', () => {
    it('should connect to ElevenLabs API', async () => {
      // Use user endpoint - minimal cost, validates auth
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY!,
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.subscription).toBeDefined();
    }, API_TIMEOUT);

    it('should list available voices', async () => {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY!,
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data.voices)).toBe(true);
      expect(data.voices.length).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it('should have character quota available', async () => {
      const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        method: 'GET',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY!,
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.character_limit).toBeGreaterThan(0);
      // Warn if running low
      if (data.character_count > data.character_limit * 0.9) {
        console.warn('Warning: ElevenLabs character quota is running low');
      }
    }, API_TIMEOUT);
  });

  describe.skipIf(!FIREWORKS_API_KEY)('Fireworks API', () => {
    it('should connect to Fireworks API', async () => {
      // List models - no cost, validates auth
      const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.data).toBeDefined();
    }, API_TIMEOUT);

    it('should complete a minimal chat request', async () => {
      // Minimal tokens to verify functionality
      const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
          messages: [
            { role: 'user', content: 'Say "ok"' },
          ],
          max_tokens: 5, // Minimize cost
          temperature: 0,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.choices).toBeDefined();
      expect(data.choices.length).toBeGreaterThan(0);
      expect(data.choices[0].message.content).toBeDefined();
    }, API_TIMEOUT);
  });
});

describe.skipIf(SKIP_SMOKE_TESTS)('API Health Summary', () => {
  it('should report API configuration status', () => {
    const status = {
      deepgram: !!DEEPGRAM_API_KEY,
      elevenlabs: !!ELEVENLABS_API_KEY,
      fireworks: !!FIREWORKS_API_KEY,
    };

    console.log('\n=== API Configuration Status ===');
    console.log(`Deepgram:   ${status.deepgram ? '✓ Configured' : '✗ Not configured'}`);
    console.log(`ElevenLabs: ${status.elevenlabs ? '✓ Configured' : '✗ Not configured'}`);
    console.log(`Fireworks:  ${status.fireworks ? '✓ Configured' : '✗ Not configured'}`);
    console.log('================================\n');

    // This test always passes - it's just for reporting
    expect(true).toBe(true);
  });
});
