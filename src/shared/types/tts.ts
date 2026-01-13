/**
 * Nova Desktop - TTS Types
 * Text-to-Speech type definitions
 */

import { EventEmitter } from 'events';

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
  nova: 'EXAVITQu4vr4xnSDxMaL', // Sarah - friendly, warm
} as const;

/**
 * Default TTS configuration
 */
export const DEFAULT_TTS_CONFIG: Partial<TTSConfig> = {
  voiceId: ELEVENLABS_VOICES.onyx,
  modelId: 'eleven_turbo_v2_5',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  outputFormat: 'mp3_44100_128',
  timeout: 30000,
};
