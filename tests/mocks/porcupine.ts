/**
 * Porcupine Mock Utilities
 * Mock implementations for Picovoice Porcupine for testing wake word detection
 */

import { vi } from 'vitest';

/**
 * Mock BuiltinKeyword enum
 */
export const MockBuiltinKeyword = {
  ALEXA: 0,
  AMERICANO: 1,
  BLUEBERRY: 2,
  BUMBLEBEE: 3,
  COMPUTER: 4,
  GRAPEFRUIT: 5,
  GRASSHOPPER: 6,
  HEY_GOOGLE: 7,
  HEY_SIRI: 8,
  JARVIS: 9,
  OK_GOOGLE: 10,
  PICOVOICE: 11,
  PORCUPINE: 12,
  TERMINATOR: 13,
};

/**
 * Creates a mock Porcupine instance
 */
export function createMockPorcupine() {
  return {
    frameLength: 512,
    sampleRate: 16000,
    version: '2.2.0',
    process: vi.fn().mockReturnValue(-1), // -1 means no detection
    release: vi.fn(),
  };
}

/**
 * Creates a mock PvRecorder instance
 */
export function createMockPvRecorder() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    release: vi.fn(),
    read: vi.fn().mockResolvedValue(new Int16Array(512).fill(0)),
    isRecording: vi.fn().mockReturnValue(false),
    getAudioDevices: vi.fn().mockResolvedValue([
      { index: 0, name: 'Default Microphone' },
      { index: 1, name: 'USB Microphone' },
    ]),
    selectedDevice: 0,
  };
}

/**
 * Simulates a wake word detection
 */
export function simulateWakeWordDetection(mockPorcupine: ReturnType<typeof createMockPorcupine>, keywordIndex = 0) {
  mockPorcupine.process.mockReturnValueOnce(keywordIndex);
}

/**
 * Factory function to create Porcupine SDK mock
 */
export function createPorcupineMock() {
  const mockPorcupine = createMockPorcupine();
  return {
    Porcupine: vi.fn().mockImplementation(() => mockPorcupine),
    BuiltinKeyword: MockBuiltinKeyword,
    _mockPorcupine: mockPorcupine,
  };
}

/**
 * Factory function to create PvRecorder mock
 */
export function createPvRecorderMock() {
  const mockRecorder = createMockPvRecorder();
  return {
    PvRecorder: vi.fn().mockImplementation(() => mockRecorder),
    _mockRecorder: mockRecorder,
  };
}
