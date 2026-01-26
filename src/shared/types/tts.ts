/**
 * Atlas Desktop - TTS Types
 * Text-to-Speech type definitions
 */

import { EventEmitter } from 'events';

/**
 * Voice speed/pitch customization settings
 * Allows users to adjust TTS playback characteristics
 */
export interface VoiceSettings {
  /** Playback speed multiplier (0.5 to 2.0, 1.0 = normal) */
  speed: number;
  /** Pitch adjustment in semitones (-12 to +12, 0 = normal) */
  pitch: number;
}

/**
 * Default voice settings
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1.0,
  pitch: 0,
};

/**
 * Voice settings validation constraints
 */
export const VOICE_SETTINGS_CONSTRAINTS = {
  speed: { min: 0.5, max: 2.0, step: 0.1 },
  pitch: { min: -12, max: 12, step: 1 },
} as const;

/**
 * Voice command triggers for adjusting settings
 */
export const VOICE_COMMAND_TRIGGERS = {
  speakFaster: ['speak faster', 'talk faster', 'speed up', 'faster please'],
  speakSlower: ['speak slower', 'talk slower', 'slow down', 'slower please'],
  pitchHigher: ['higher pitch', 'pitch up', 'higher voice'],
  pitchLower: ['lower pitch', 'pitch down', 'lower voice'],
  resetVoice: ['reset voice', 'normal voice', 'default voice', 'reset speech'],
} as const;

/**
 * User TTS preferences stored persistently
 */
export interface TTSUserPreferences {
  /** Voice settings (speed/pitch) */
  voiceSettings: VoiceSettings;
  /** Preferred voice ID */
  preferredVoiceId?: string;
  /** Preferred TTS provider */
  preferredProvider?: 'elevenlabs' | 'offline';
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Default user TTS preferences
 */
export const DEFAULT_TTS_USER_PREFERENCES: TTSUserPreferences = {
  voiceSettings: DEFAULT_VOICE_SETTINGS,
  updatedAt: Date.now(),
};

/**
 * TTS configuration options
 */
export interface TTSConfig {
  /** API key for the TTS service */
  apiKey: string;
  /** Voice ID to use */
  voiceId?: string;
  /** Model ID to use */
  modelId?: string;
  /** Voice stability (0-1, higher = more consistent) */
  stability?: number;
  /** Voice similarity boost (0-1, higher = more similar to original) */
  similarityBoost?: number;
  /** Voice style (0-1, for v2+ models) */
  style?: number;
  /** Use speaker boost */
  useSpeakerBoost?: boolean;
  /** Output format */
  outputFormat?: 'mp3_44100_128' | 'mp3_22050_32' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100';
  /** Request timeout in ms */
  timeout?: number;
  /** Voice settings (speed/pitch) */
  voiceSettings?: VoiceSettings;
}

/**
 * TTS audio chunk from streaming
 */
export interface TTSAudioChunk {
  /** Raw audio data */
  data: Buffer;
  /** Format of the audio */
  format: string;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** Duration estimate in ms */
  duration?: number;
}

/**
 * TTS synthesis result
 */
export interface TTSSynthesisResult {
  /** Full audio buffer */
  audio: Buffer;
  /** Audio format */
  format: string;
  /** Duration in ms */
  duration: number;
  /** Characters synthesized */
  characterCount: number;
  /** Latency to first audio */
  latency?: number;
}

/**
 * Speech item in the queue
 */
export interface SpeechQueueItem {
  /** Unique ID */
  id: string;
  /** Text to speak */
  text: string;
  /** Priority (higher = speak first) */
  priority: number;
  /** Timestamp when queued */
  queuedAt: number;
  /** Status */
  status: 'pending' | 'speaking' | 'completed' | 'cancelled';
}

/**
 * TTS provider status
 */
export enum TTSStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  SYNTHESIZING = 'synthesizing',
  PLAYING = 'playing',
  PAUSED = 'paused',
  ERROR = 'error',
}

/**
 * TTS events emitted by the provider
 */
export interface TTSEvents {
  /** Emitted when status changes */
  status: (status: TTSStatus) => void;
  /** Emitted for each audio chunk */
  chunk: (chunk: TTSAudioChunk) => void;
  /** Emitted when synthesis is complete */
  synthesized: (result: TTSSynthesisResult) => void;
  /** Emitted when playback starts */
  playbackStart: () => void;
  /** Emitted when playback ends */
  playbackEnd: () => void;
  /** Emitted on error */
  error: (error: Error) => void;
  /** Emitted when queue changes */
  queueUpdate: (queue: SpeechQueueItem[]) => void;
  /** Emitted when voice settings change */
  voiceSettingsChanged: (settings: VoiceSettings) => void;
  /** Emitted when previewing voice settings */
  voiceSettingsPreview: (settings: VoiceSettings, previewText: string) => void;
  /** Emitted when interrupted */
  interrupted: () => void;
}

/**
 * Base interface for TTS providers
 */
export interface TTSProvider extends EventEmitter {
  /** Provider name */
  readonly name: string;
  /** Current status */
  readonly status: TTSStatus;
  
  /** Synthesize text to speech (returns audio buffer) */
  synthesize(text: string): Promise<TTSSynthesisResult>;
  /** Synthesize text with streaming (returns async generator) */
  synthesizeStream(text: string): AsyncGenerator<TTSAudioChunk>;
  /** Speak text (synthesize and play) */
  speak(text: string, priority?: number): Promise<void>;
  /** Stop current speech and clear queue */
  stop(): void;
  /** Pause playback */
  pause(): void;
  /** Resume playback */
  resume(): void;
  /** Check if currently speaking */
  isSpeaking(): boolean;
  /** Get speech queue */
  getQueue(): SpeechQueueItem[];
  /** Clear speech queue */
  clearQueue(): void;
  /** Get provider configuration */
  getConfig(): TTSConfig;
  
  // Event emitter methods with proper typing
  on<K extends keyof TTSEvents>(event: K, listener: TTSEvents[K]): this;
  off<K extends keyof TTSEvents>(event: K, listener: TTSEvents[K]): this;
  emit<K extends keyof TTSEvents>(event: K, ...args: Parameters<TTSEvents[K]>): boolean;
}

/**
 * Available ElevenLabs voice presets
 */
export const ELEVENLABS_VOICES = {
  // Premade voices
  rachel: '21m00Tcm4TlvDq8ikWAM',
  drew: '29vD33N1CtxCmqQRPOHJ',
  clyde: '2EiwWnXFnvU5JabPnv8n',
  paul: '5Q0t7uMcjvnagumLfvZi',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  dave: 'CYw3kZ02Hs0563khs1Fj',
  fin: 'D38z5RcWu1voky8WS1ja',
  sarah: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  thomas: 'GBv7mTt0atIp3Br8iCZE',
  charlie: 'IKne3meq5aSn9XLyUdCD',
  george: 'JBFqnCBsd6RMkjVDRZzb',
  emily: 'LcfcDJNUP1GQjkzn1xUU',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  callum: 'N2lVS1w4EtoT3dr4eOWO',
  patrick: 'ODq5zmih8GrVes37Dizd',
  harry: 'SOYHLrjzK2X1ezoPC6cr',
  liam: 'TX3LPaxmHKxFdv7VOQHJ',
  dorothy: 'ThT5KcBeYPX3keUQqHPh',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  charlotte: 'XB0fDUnXU5powFXDhCwa',
  alice: 'Xb7hH8MSUJpSbSDYk0k2',
  matilda: 'XrExE9yKIg1WjnnlVkGX',
  james: 'ZQe5CZNOzWyzPSCn5a3c',
  joseph: 'Zlb1dXrM653N07WRdFW3',
  jeremy: 'bVMeCyTHy58xNoL34h3p',
  michael: 'flq6f7yk4E4fJM5XTYuZ',
  ethan: 'g5CIjZEefAph4nQFvHAz',
  chris: 'iP95p4xoKVk53GoZ742B',
  gigi: 'jBpfuIE2acCO8z3wKNLl',
  freya: 'jsCqWAovK2LkecY7zXl4',
  brian: 'nPczCjzI2devNBz1zQrb',
  grace: 'oWAxZDx7w5VEj9dCyTzz',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  lily: 'pFZP5JQG7iQjIQuC4Bku',
  serena: 'pMsXgVXv3BLzUgSXRplE',
  adam: 'pNInz6obpgDQGcFmaJgB',
  nicole: 'piTKgcLEGmPE4e6mEKli',
  bill: 'pqHfZKP75CvOlQylNhV4',
  jessie: 't0jbNlBVZ17f02VDIeMI',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  glinda: 'z9fAnlkpzviPz146aGWa',
  giovanni: 'zcAOhNBS3c14rBihAFp1',
  mimi: 'zrHiDhphv9ZnVXBqCLjz',
  
  // Good for assistant voice
  onyx: 'onwK4e9ZLuTAKqWW03F9', // Daniel - calm, professional
  atlas: 'EXAVITQu4vr4xnSDxMaL', // Sarah - friendly, warm
} as const;

/**
 * Default TTS configuration - warm British voice for JARVIS-like sound
 */
export const DEFAULT_TTS_CONFIG: Partial<TTSConfig> = {
  voiceId: ELEVENLABS_VOICES.paul, // Warm British voice
  modelId: 'eleven_turbo_v2_5',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  outputFormat: 'mp3_44100_128',
  timeout: 30000,
  voiceSettings: DEFAULT_VOICE_SETTINGS,
};

/**
 * Validate voice settings are within constraints
 * @param settings - Voice settings to validate
 * @returns Validated and clamped voice settings
 */
export function validateVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  const { speed: speedConstraints, pitch: pitchConstraints } = VOICE_SETTINGS_CONSTRAINTS;

  return {
    speed: Math.max(
      speedConstraints.min,
      Math.min(speedConstraints.max, settings.speed ?? DEFAULT_VOICE_SETTINGS.speed)
    ),
    pitch: Math.max(
      pitchConstraints.min,
      Math.min(pitchConstraints.max, settings.pitch ?? DEFAULT_VOICE_SETTINGS.pitch)
    ),
  };
}

/**
 * Adjust speed by a delta amount (respects constraints)
 * @param currentSpeed - Current speed value
 * @param delta - Amount to adjust (positive = faster, negative = slower)
 * @returns New speed value within constraints
 */
export function adjustSpeed(currentSpeed: number, delta: number): number {
  const { min, max, step } = VOICE_SETTINGS_CONSTRAINTS.speed;
  const newSpeed = currentSpeed + delta * step;
  return Math.max(min, Math.min(max, Math.round(newSpeed * 10) / 10));
}

/**
 * Adjust pitch by a delta amount (respects constraints)
 * @param currentPitch - Current pitch value
 * @param delta - Amount to adjust (positive = higher, negative = lower)
 * @returns New pitch value within constraints
 */
export function adjustPitch(currentPitch: number, delta: number): number {
  const { min, max, step } = VOICE_SETTINGS_CONSTRAINTS.pitch;
  const newPitch = currentPitch + delta * step;
  return Math.max(min, Math.min(max, Math.round(newPitch)));
}

/**
 * Check if text matches any voice command trigger
 * @param text - Text to check
 * @returns Command type if matched, null otherwise
 */
export function matchVoiceCommand(
  text: string
): keyof typeof VOICE_COMMAND_TRIGGERS | null {
  const normalizedText = text.toLowerCase().trim();

  for (const [command, triggers] of Object.entries(VOICE_COMMAND_TRIGGERS)) {
    if (triggers.some((trigger) => normalizedText.includes(trigger))) {
      return command as keyof typeof VOICE_COMMAND_TRIGGERS;
    }
  }

  return null;
}

/**
 * Get human-readable description of voice settings
 * @param settings - Voice settings
 * @returns Human-readable description
 */
export function describeVoiceSettings(settings: VoiceSettings): string {
  const speedDesc =
    settings.speed === 1.0
      ? 'normal speed'
      : settings.speed > 1.0
        ? `${settings.speed}x faster`
        : `${settings.speed}x slower`;

  const pitchDesc =
    settings.pitch === 0
      ? 'normal pitch'
      : settings.pitch > 0
        ? `pitch raised ${settings.pitch} semitones`
        : `pitch lowered ${Math.abs(settings.pitch)} semitones`;

  return `${speedDesc}, ${pitchDesc}`;
}
