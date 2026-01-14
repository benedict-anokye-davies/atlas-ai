/**
 * ElevenLabs Mock Utilities
 * Mock implementations for ElevenLabs API for testing TTS functionality
 */

import { vi } from 'vitest';

/**
 * Creates a mock audio buffer
 */
export function createMockAudioBuffer(size = 1024): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // Add MP3 header bytes
  view[0] = 0x49; // I
  view[1] = 0x44; // D
  view[2] = 0x33; // 3
  view[3] = 0x04; // Version
  return buffer;
}

/**
 * Creates a mock ReadableStream with audio chunks
 */
export function createMockAudioStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Creates a mock fetch response for ElevenLabs API
 */
export function createMockElevenLabsResponse(options: {
  ok?: boolean;
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?: ArrayBuffer;
  json?: Record<string, unknown>;
}): Response {
  const { ok = true, status = 200, body = null, arrayBuffer, json } = options;

  return {
    ok,
    status,
    body,
    arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer || createMockAudioBuffer()),
    text: vi.fn().mockResolvedValue(''),
    json: vi.fn().mockResolvedValue(json || {}),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: 'https://api.elevenlabs.io/v1/text-to-speech/mock-voice-id',
    clone: vi.fn(),
    bodyUsed: false,
    formData: vi.fn(),
    blob: vi.fn(),
  } as unknown as Response;
}

/**
 * Creates mock voice list response
 */
export function createMockVoicesResponse() {
  return createMockElevenLabsResponse({
    ok: true,
    json: {
      voices: [
        { voice_id: 'voice1', name: 'Rachel', category: 'premade' },
        { voice_id: 'voice2', name: 'Adam', category: 'premade' },
        { voice_id: 'voice3', name: 'Custom Voice', category: 'cloned' },
      ],
    },
  });
}

/**
 * Creates mock subscription info response
 */
export function createMockSubscriptionResponse(characterCount = 5000, characterLimit = 10000) {
  return createMockElevenLabsResponse({
    ok: true,
    json: {
      character_count: characterCount,
      character_limit: characterLimit,
      tier: 'starter',
    },
  });
}

/**
 * Creates a mock fetch function for ElevenLabs API
 */
export function createElevenLabsFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/voices')) {
      return Promise.resolve(createMockVoicesResponse());
    }
    if (url.includes('/subscription')) {
      return Promise.resolve(createMockSubscriptionResponse());
    }
    // Default: synthesis response
    return Promise.resolve(
      createMockElevenLabsResponse({
        ok: true,
        arrayBuffer: createMockAudioBuffer(2048),
      })
    );
  });
}
