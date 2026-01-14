/**
 * Deepgram Mock Utilities
 * Mock implementations for Deepgram SDK for testing STT functionality
 */

import { vi } from 'vitest';

/**
 * Creates a mock Deepgram live client
 */
export function createMockDeepgramLiveClient() {
  return {
    on: vi.fn().mockReturnThis(),
    send: vi.fn(),
    keepAlive: vi.fn(),
    requestClose: vi.fn(),
    getReadyState: vi.fn().mockReturnValue(1), // WebSocket.OPEN
  };
}

/**
 * Creates a mock Deepgram client
 */
export function createMockDeepgramClient() {
  const liveClient = createMockDeepgramLiveClient();
  return {
    listen: {
      live: vi.fn(() => liveClient),
    },
    _liveClient: liveClient,
  };
}

/**
 * Mock LiveTranscriptionEvents enum
 */
export const MockLiveTranscriptionEvents = {
  Open: 'open',
  Transcript: 'Results',
  Metadata: 'Metadata',
  SpeechStarted: 'SpeechStarted',
  UtteranceEnd: 'UtteranceEnd',
  Error: 'error',
  Close: 'close',
};

/**
 * Creates a mock transcription result
 */
export function createMockTranscript(text: string, isFinal = true) {
  return {
    channel: {
      alternatives: [
        {
          transcript: text,
          confidence: 0.95,
          words: text.split(' ').map((word, i) => ({
            word,
            start: i * 0.5,
            end: (i + 1) * 0.5,
            confidence: 0.95,
          })),
        },
      ],
    },
    is_final: isFinal,
    speech_final: isFinal,
  };
}

/**
 * Factory function to create Deepgram SDK mock
 */
export function createDeepgramMock() {
  const mockClient = createMockDeepgramClient();
  return {
    createClient: vi.fn(() => mockClient),
    LiveTranscriptionEvents: MockLiveTranscriptionEvents,
    _mockClient: mockClient,
  };
}
