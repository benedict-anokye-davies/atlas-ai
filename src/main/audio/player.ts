/**
 * Atlas Desktop - Audio Player
 * Handles audio playback of recordings with transport controls
 * Supports WAV and MP3 formats with seeking and volume control
 */

import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { AudioError } from '../utils/errors';
import {
  PlaybackStatus,
  PlayerEvents,
  RecordingMetadata,
  IAudioPlayer,
} from '../../shared/types/audio';
import { getAudioRecorder } from './recorder';

const logger = createModuleLogger('AudioPlayer');
const perfTimer = new PerformanceTimer('AudioPlayer');

/**
 * Parse WAV file header
 */
interface WavInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  dataOffset: number;
  dataLength: number;
  duration: number;
}

function parseWavHeader(buffer: Buffer): WavInfo {
  // Verify RIFF header
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV file');
  }

  // Find fmt chunk
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let dataOffset = 0;
  let dataLength = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitDepth = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
    // Align to even boundary
    if (chunkSize % 2 !== 0) offset++;
  }

  if (sampleRate === 0 || dataOffset === 0) {
    throw new Error('Invalid WAV file structure');
  }

  const bytesPerSample = bitDepth / 8;
  const bytesPerSecond = sampleRate * channels * bytesPerSample;
  const duration = (dataLength / bytesPerSecond) * 1000;

  return {
    sampleRate,
    channels,
    bitDepth,
    dataOffset,
    dataLength,
    duration,
  };
}

/**
 * Audio playback buffer for streaming to output
 */
interface PlaybackBuffer {
  data: Buffer;
  position: number;
  wavInfo?: WavInfo;
}

/**
 * Audio Player class
 * Handles playback of audio recordings with full transport controls
 */
export class AudioPlayer extends EventEmitter implements IAudioPlayer {
  private _status: PlaybackStatus = PlaybackStatus.IDLE;
  private volume: number = 1.0;

  // Current playback state
  private currentRecording: RecordingMetadata | null = null;
  private currentBuffer: PlaybackBuffer | null = null;
  private playbackPosition: number = 0; // in milliseconds
  private playbackDuration: number = 0; // in milliseconds

  // Playback timing
  private playbackStartTime: number = 0;
  private playbackStartPosition: number = 0;
  private progressInterval: NodeJS.Timeout | null = null;

  // Audio output callback (set by voice pipeline or audio system)
  private audioOutputCallback: ((data: Buffer) => void) | null = null;
  private playbackInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    logger.info('AudioPlayer initialized');
  }

  /**
   * Get current playback status
   */
  get status(): PlaybackStatus {
    return this._status;
  }

  /**
   * Get current status (IAudioPlayer interface)
   */
  getStatus(): PlaybackStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: PlaybackStatus): void {
    if (this._status !== status) {
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Set the audio output callback for playback
   * This allows the voice pipeline to receive audio data
   */
  setAudioOutputCallback(callback: ((data: Buffer) => void) | null): void {
    this.audioOutputCallback = callback;
  }

  /**
   * Play a recording by ID
   */
  async play(id: string): Promise<void> {
    const recorder = getAudioRecorder();
    const recording = await recorder.getRecording(id);

    if (!recording) {
      throw new AudioError(`Recording not found: ${id}`);
    }

    await this.playFile(recording.filepath, recording);
  }

  /**
   * Play a recording by file path
   */
  async playFile(filepath: string, recording?: RecordingMetadata): Promise<void> {
    if (!existsSync(filepath)) {
      throw new AudioError(`File not found: ${filepath}`);
    }

    // Stop any current playback
    if (this._status !== PlaybackStatus.IDLE) {
      this.stop();
    }

    this.setStatus(PlaybackStatus.LOADING);
    perfTimer.start('loadAudio');

    try {
      // Load file
      const fileData = await readFile(filepath);
      const ext = extname(filepath).toLowerCase();

      let wavInfo: WavInfo | undefined;
      let audioData: Buffer;

      if (ext === '.wav') {
        wavInfo = parseWavHeader(fileData);
        audioData = fileData.slice(wavInfo.dataOffset, wavInfo.dataOffset + wavInfo.dataLength);
        this.playbackDuration = wavInfo.duration;
      } else if (ext === '.mp3') {
        // MP3 playback would require decoding
        // For now, we only support WAV
        throw new AudioError('MP3 playback not yet implemented - please use WAV format');
      } else {
        throw new AudioError(`Unsupported audio format: ${ext}`);
      }

      // Get or create recording metadata
      if (!recording) {
        const recorder = getAudioRecorder();
        // Search for recording by filepath
        const recordings = await recorder.listRecordings({ limit: 1000 });
        recording = recordings.find((r) => r.filepath === filepath) || {
          id: `temp_${Date.now()}`,
          filename: filepath.split(/[/\\]/).pop() || 'unknown',
          filepath,
          format: ext.slice(1) as 'wav' | 'mp3',
          duration: this.playbackDuration,
          size: fileData.length,
          sampleRate: wavInfo?.sampleRate || 44100,
          channels: wavInfo?.channels || 1,
          createdAt: Date.now(),
        };
      }

      this.currentRecording = recording;
      this.currentBuffer = {
        data: audioData,
        position: 0,
        wavInfo,
      };
      this.playbackPosition = 0;

      perfTimer.end('loadAudio');

      logger.info('Audio loaded', {
        filepath,
        duration: this.playbackDuration,
        size: audioData.length,
      });

      // Start playback
      this.startPlayback();
    } catch (error) {
      this.setStatus(PlaybackStatus.ERROR);
      const audioError = new AudioError(`Failed to load audio: ${(error as Error).message}`, {
        error: (error as Error).message,
      });
      logger.error('Failed to load audio', { error: (error as Error).message });
      this.emit('error', audioError);
      throw audioError;
    }
  }

  /**
   * Start audio playback
   */
  private startPlayback(): void {
    if (!this.currentBuffer || !this.currentRecording) {
      return;
    }

    this.playbackStartTime = Date.now();
    this.playbackStartPosition = this.playbackPosition;
    this.setStatus(PlaybackStatus.PLAYING);

    // Start progress tracking
    this.startProgressTracking();

    // Start streaming audio data
    this.startAudioStreaming();

    logger.info('Playback started', {
      id: this.currentRecording.id,
      position: this.playbackPosition,
      duration: this.playbackDuration,
    });

    this.emit('start', this.currentRecording);
  }

  /**
   * Start streaming audio data to output
   */
  private startAudioStreaming(): void {
    if (!this.currentBuffer || !this.currentBuffer.wavInfo) {
      return;
    }

    const wavInfo = this.currentBuffer.wavInfo;
    const bytesPerSample = wavInfo.bitDepth / 8;
    const bytesPerSecond = wavInfo.sampleRate * wavInfo.channels * bytesPerSample;
    const chunkDuration = 20; // 20ms chunks
    const chunkSize = Math.floor((bytesPerSecond * chunkDuration) / 1000);

    this.playbackInterval = setInterval(() => {
      if (this._status !== PlaybackStatus.PLAYING || !this.currentBuffer) {
        return;
      }

      const { data, position } = this.currentBuffer;

      if (position >= data.length) {
        // Playback finished
        this.handlePlaybackFinished();
        return;
      }

      // Get next chunk
      const endPosition = Math.min(position + chunkSize, data.length);
      const chunk = data.slice(position, endPosition);

      // Apply volume
      const adjustedChunk = this.applyVolume(chunk);

      // Send to output
      if (this.audioOutputCallback) {
        this.audioOutputCallback(adjustedChunk);
      }

      // Update position
      this.currentBuffer.position = endPosition;
    }, chunkDuration);
  }

  /**
   * Apply volume adjustment to audio chunk
   */
  private applyVolume(chunk: Buffer): Buffer {
    if (this.volume === 1.0) {
      return chunk;
    }

    const output = Buffer.alloc(chunk.length);

    for (let i = 0; i < chunk.length; i += 2) {
      let sample = chunk.readInt16LE(i);
      sample = Math.round(sample * this.volume);
      // Clamp to prevent clipping
      sample = Math.max(-32768, Math.min(32767, sample));
      output.writeInt16LE(sample, i);
    }

    return output;
  }

  /**
   * Handle playback finished
   */
  private handlePlaybackFinished(): void {
    this.stopAudioStreaming();
    this.stopProgressTracking();

    const wasPlaying = this._status === PlaybackStatus.PLAYING;
    this.setStatus(PlaybackStatus.IDLE);
    this.playbackPosition = this.playbackDuration;

    if (wasPlaying) {
      logger.info('Playback finished');
      this.emit('finished');
    }

    // Reset
    this.currentRecording = null;
    this.currentBuffer = null;
  }

  /**
   * Stop audio streaming
   */
  private stopAudioStreaming(): void {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  /**
   * Start progress tracking interval
   */
  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.progressInterval = setInterval(() => {
      if (this._status === PlaybackStatus.PLAYING) {
        this.updatePosition();
        this.emit('progress', this.playbackPosition, this.playbackDuration);
      }
    }, 100);
  }

  /**
   * Stop progress tracking interval
   */
  private stopProgressTracking(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Update playback position based on elapsed time
   */
  private updatePosition(): void {
    if (!this.currentBuffer || !this.currentBuffer.wavInfo) {
      return;
    }

    const wavInfo = this.currentBuffer.wavInfo;
    const bytesPerSample = wavInfo.bitDepth / 8;
    const bytesPerSecond = wavInfo.sampleRate * wavInfo.channels * bytesPerSample;

    // Calculate position from buffer position
    this.playbackPosition = (this.currentBuffer.position / bytesPerSecond) * 1000;
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this._status === PlaybackStatus.IDLE) {
      return;
    }

    this.stopAudioStreaming();
    this.stopProgressTracking();

    const wasPlaying =
      this._status === PlaybackStatus.PLAYING || this._status === PlaybackStatus.PAUSED;

    this.setStatus(PlaybackStatus.IDLE);
    this.playbackPosition = 0;
    this.currentRecording = null;
    this.currentBuffer = null;

    if (wasPlaying) {
      logger.info('Playback stopped');
      this.emit('stop');
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this._status !== PlaybackStatus.PLAYING) {
      return;
    }

    this.stopAudioStreaming();
    this.updatePosition();
    this.setStatus(PlaybackStatus.PAUSED);

    logger.info('Playback paused', { position: this.playbackPosition });
    this.emit('pause');
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this._status !== PlaybackStatus.PAUSED) {
      return;
    }

    this.playbackStartTime = Date.now();
    this.playbackStartPosition = this.playbackPosition;
    this.setStatus(PlaybackStatus.PLAYING);

    this.startAudioStreaming();

    logger.info('Playback resumed', { position: this.playbackPosition });
    this.emit('resume');
  }

  /**
   * Seek to position in milliseconds
   */
  seek(position: number): void {
    if (
      this._status === PlaybackStatus.IDLE ||
      !this.currentBuffer ||
      !this.currentBuffer.wavInfo
    ) {
      return;
    }

    // Clamp position
    position = Math.max(0, Math.min(position, this.playbackDuration));

    const wavInfo = this.currentBuffer.wavInfo;
    const bytesPerSample = wavInfo.bitDepth / 8;
    const bytesPerSecond = wavInfo.sampleRate * wavInfo.channels * bytesPerSample;

    // Calculate byte position (align to sample boundary)
    const bytePosition = Math.floor((position / 1000) * bytesPerSecond);
    const alignedPosition = bytePosition - (bytePosition % (wavInfo.channels * bytesPerSample));

    this.currentBuffer.position = alignedPosition;
    this.playbackPosition = position;
    this.playbackStartTime = Date.now();
    this.playbackStartPosition = position;

    logger.debug('Seeked to position', { position, bytePosition: alignedPosition });
  }

  /**
   * Get current playback position in milliseconds
   */
  getPosition(): number {
    return this.playbackPosition;
  }

  /**
   * Get playback duration in milliseconds
   */
  getDuration(): number {
    return this.playbackDuration;
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    logger.debug('Volume set', { volume: this.volume });
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Get currently playing recording
   */
  getCurrentRecording(): RecordingMetadata | null {
    return this.currentRecording;
  }

  /**
   * Play the last recording
   */
  async playLastRecording(): Promise<void> {
    const recorder = getAudioRecorder();
    const lastRecording = await recorder.getLastRecording();

    if (!lastRecording) {
      throw new AudioError('No recordings available');
    }

    await this.play(lastRecording.id);
  }

  /**
   * Toggle play/pause
   */
  togglePlayback(): void {
    if (this._status === PlaybackStatus.PLAYING) {
      this.pause();
    } else if (this._status === PlaybackStatus.PAUSED) {
      this.resume();
    }
  }

  // Type-safe event emitter methods
  on<K extends keyof PlayerEvents>(event: K, listener: PlayerEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof PlayerEvents>(event: K, listener: PlayerEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof PlayerEvents>(event: K, ...args: Parameters<PlayerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let playerInstance: AudioPlayer | null = null;

/**
 * Get the audio player singleton instance
 */
export function getAudioPlayer(): AudioPlayer {
  if (!playerInstance) {
    playerInstance = new AudioPlayer();
  }
  return playerInstance;
}

/**
 * Shutdown the audio player
 */
export function shutdownAudioPlayer(): void {
  if (playerInstance) {
    playerInstance.stop();
    playerInstance.removeAllListeners();
    playerInstance = null;
  }
}

export default AudioPlayer;
