/**
 * Atlas Desktop - Audio Recording/Playback Types
 * Type definitions for audio recording and playback functionality
 */

/**
 * Supported audio formats for recordings
 */
export type AudioFormat = 'wav' | 'mp3';

/**
 * Recording status states
 */
export enum RecordingStatus {
  IDLE = 'idle',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  ERROR = 'error',
}

/**
 * Playback status states
 */
export enum PlaybackStatus {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  LOADING = 'loading',
  ERROR = 'error',
}

/**
 * Metadata for a single recording
 */
export interface RecordingMetadata {
  /** Unique ID for the recording */
  id: string;
  /** Recording filename */
  filename: string;
  /** Full path to the recording file */
  filepath: string;
  /** Audio format */
  format: AudioFormat;
  /** Duration in milliseconds */
  duration: number;
  /** File size in bytes */
  size: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Creation timestamp */
  createdAt: number;
  /** Optional user-provided name */
  name?: string;
  /** Optional transcription of the recording */
  transcription?: string;
  /** Whether transcription is in progress */
  transcribing?: boolean;
}

/**
 * Recording configuration options
 */
export interface RecordingConfig {
  /** Output format */
  format: AudioFormat;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of channels (1 = mono, 2 = stereo) */
  channels: number;
  /** Bit depth for WAV (16 or 24) */
  bitDepth: 16 | 24;
  /** MP3 bitrate in kbps (for MP3 format) */
  mp3Bitrate: 128 | 192 | 256 | 320;
  /** Maximum recording duration in milliseconds (0 = unlimited) */
  maxDuration: number;
  /** Auto-stop on silence duration in milliseconds (0 = disabled) */
  silenceTimeout: number;
  /** Silence threshold (0-1) for auto-stop */
  silenceThreshold: number;
}

/**
 * Default recording configuration
 */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  format: 'wav',
  sampleRate: 44100,
  channels: 1,
  bitDepth: 16,
  mp3Bitrate: 192,
  maxDuration: 0,
  silenceTimeout: 0,
  silenceThreshold: 0.01,
};

/**
 * Recording events
 */
export interface RecorderEvents {
  /** Recording started */
  start: () => void;
  /** Recording stopped */
  stop: (recording: RecordingMetadata) => void;
  /** Recording paused */
  pause: () => void;
  /** Recording resumed */
  resume: () => void;
  /** Recording progress (duration in ms) */
  progress: (duration: number) => void;
  /** Audio level update (0-1) */
  level: (level: number) => void;
  /** Status changed */
  status: (status: RecordingStatus) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Max duration reached */
  maxDurationReached: () => void;
  /** Silence detected (auto-stop) */
  silenceDetected: () => void;
}

/**
 * Playback events
 */
export interface PlayerEvents {
  /** Playback started */
  start: (recording: RecordingMetadata) => void;
  /** Playback stopped */
  stop: () => void;
  /** Playback paused */
  pause: () => void;
  /** Playback resumed */
  resume: () => void;
  /** Playback progress (position in ms) */
  progress: (position: number, duration: number) => void;
  /** Playback finished naturally */
  finished: () => void;
  /** Status changed */
  status: (status: PlaybackStatus) => void;
  /** Error occurred */
  error: (error: Error) => void;
}

/**
 * Recording list query options
 */
export interface RecordingListOptions {
  /** Maximum number of recordings to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort by field */
  sortBy?: 'createdAt' | 'duration' | 'name' | 'size';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Filter by format */
  format?: AudioFormat;
  /** Search by name */
  search?: string;
}

/**
 * Recording manager interface
 */
export interface IRecordingManager {
  /** Start recording */
  startRecording(config?: Partial<RecordingConfig>): Promise<void>;
  /** Stop recording */
  stopRecording(): Promise<RecordingMetadata>;
  /** Pause recording */
  pauseRecording(): void;
  /** Resume recording */
  resumeRecording(): void;
  /** Get current recording status */
  getStatus(): RecordingStatus;
  /** Get current recording duration */
  getCurrentDuration(): number;
  /** Cancel current recording (discard) */
  cancelRecording(): void;
}

/**
 * Recording storage interface
 */
export interface IRecordingStorage {
  /** List all recordings */
  listRecordings(options?: RecordingListOptions): Promise<RecordingMetadata[]>;
  /** Get a specific recording by ID */
  getRecording(id: string): Promise<RecordingMetadata | null>;
  /** Get the most recent recording */
  getLastRecording(): Promise<RecordingMetadata | null>;
  /** Delete a recording */
  deleteRecording(id: string): Promise<boolean>;
  /** Rename a recording */
  renameRecording(id: string, name: string): Promise<boolean>;
  /** Get total storage used by recordings */
  getStorageUsed(): Promise<number>;
  /** Get recordings directory path */
  getRecordingsPath(): string;
}

/**
 * Audio player interface
 */
export interface IAudioPlayer {
  /** Play a recording by ID */
  play(id: string): Promise<void>;
  /** Play a recording by path */
  playFile(filepath: string): Promise<void>;
  /** Stop playback */
  stop(): void;
  /** Pause playback */
  pause(): void;
  /** Resume playback */
  resume(): void;
  /** Seek to position (ms) */
  seek(position: number): void;
  /** Get current playback status */
  getStatus(): PlaybackStatus;
  /** Get current playback position (ms) */
  getPosition(): number;
  /** Get playback duration (ms) */
  getDuration(): number;
  /** Set volume (0-1) */
  setVolume(volume: number): void;
  /** Get current volume */
  getVolume(): number;
}

/**
 * Transcription request
 */
export interface TranscriptionRequest {
  /** Recording ID to transcribe */
  recordingId: string;
  /** Language code (e.g., 'en-US') */
  language?: string;
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
  /** Recording ID */
  recordingId: string;
  /** Transcribed text */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Processing time in ms */
  processingTime: number;
}
