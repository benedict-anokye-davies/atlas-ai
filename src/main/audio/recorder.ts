/**
 * Atlas Desktop - Audio Recorder
 * Handles audio recording with support for WAV and MP3 formats
 * Records audio clips via voice command with configurable settings
 */

import { EventEmitter } from 'events';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, WriteStream } from 'fs';
import { readFile, writeFile, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { AudioError } from '../utils/errors';
import {
  RecordingStatus,
  RecordingMetadata,
  RecordingConfig,
  RecorderEvents,
  DEFAULT_RECORDING_CONFIG,
  AudioFormat,
  RecordingListOptions,
  IRecordingManager,
  IRecordingStorage,
} from '../../shared/types/audio';

const logger = createModuleLogger('AudioRecorder');
const perfTimer = new PerformanceTimer('AudioRecorder');

/**
 * Generate a unique recording ID
 */
function generateRecordingId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a recording filename
 */
function generateFilename(id: string, format: AudioFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `atlas_recording_${timestamp}_${id.slice(-6)}.${format}`;
}

/**
 * WAV file header writer
 */
class WavHeader {
  /**
   * Write WAV header to buffer
   * @param dataLength - Length of audio data in bytes
   * @param sampleRate - Sample rate in Hz
   * @param channels - Number of channels
   * @param bitDepth - Bits per sample (16 or 24)
   */
  static create(
    dataLength: number,
    sampleRate: number,
    channels: number,
    bitDepth: 16 | 24
  ): Buffer {
    const bytesPerSample = bitDepth / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }

  /**
   * Update WAV header with final data length
   */
  static updateLength(header: Buffer, dataLength: number): void {
    header.writeUInt32LE(36 + dataLength, 4);
    header.writeUInt32LE(dataLength, 40);
  }
}

/**
 * Simple MP3 encoder using LAME-style encoding
 * Note: This is a placeholder - in production, use a proper MP3 encoder like lame or ffmpeg
 * TODO: Implement when MP3 recording is needed
 */
// class Mp3Encoder {
//   private readonly sampleRate: number;
//   private readonly channels: number;
//   private readonly bitrate: number;
//
//   constructor(sampleRate: number, channels: number, bitrate: number) {
//     this.sampleRate = sampleRate;
//     this.channels = channels;
//     this.bitrate = bitrate;
//   }
//
//   /**
//    * Encode PCM data to MP3
//    * Note: This returns WAV data as a fallback since proper MP3 encoding
//    * requires native bindings or external tools. In production, integrate
//    * with lame, ffmpeg, or a proper MP3 encoding library.
//    */
//   encode(pcmData: Buffer): Buffer {
//     // For now, return PCM data - MP3 encoding requires native modules
//     // In production, use: fluent-ffmpeg, node-lame, or similar
//     logger.warn('MP3 encoding not implemented - returning raw PCM data');
//     return pcmData;
//   }
// }

/**
 * Audio Recorder class
 * Manages audio recording with configurable format and settings
 */
export class AudioRecorder extends EventEmitter implements IRecordingManager, IRecordingStorage {
  private _status: RecordingStatus = RecordingStatus.IDLE;
  private config: RecordingConfig;
  private recordingsDir: string;
  private metadataFile: string;

  // Current recording state
  private currentId: string | null = null;
  private currentFilepath: string | null = null;
  private currentFormat: AudioFormat = 'wav';
  private currentStream: WriteStream | null = null;
  private audioChunks: Buffer[] = [];
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private dataLength: number = 0;

  // Progress and level tracking
  private progressInterval: NodeJS.Timeout | null = null;
  private silenceStartTime: number = 0;
  private lastLevel: number = 0;

  // Metadata storage
  private recordings: Map<string, RecordingMetadata> = new Map();

  constructor(config: Partial<RecordingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RECORDING_CONFIG, ...config };

    // Set up recordings directory
    this.recordingsDir = join(homedir(), '.atlas', 'recordings');
    this.metadataFile = join(this.recordingsDir, 'metadata.json');

    // Ensure recordings directory exists
    if (!existsSync(this.recordingsDir)) {
      mkdirSync(this.recordingsDir, { recursive: true });
    }

    // Load existing metadata
    this.loadMetadata().catch((err) => {
      logger.warn('Failed to load recording metadata', { error: err.message });
    });

    logger.info('AudioRecorder initialized', {
      recordingsDir: this.recordingsDir,
      defaultFormat: this.config.format,
    });
  }

  /**
   * Get current recording status
   */
  get status(): RecordingStatus {
    return this._status;
  }

  /**
   * Get current status (IRecordingManager interface)
   */
  getStatus(): RecordingStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: RecordingStatus): void {
    if (this._status !== status) {
      const previousStatus = this._status;
      this._status = status;
      logger.debug('Status changed', { from: previousStatus, to: status });
      this.emit('status', status);
    }
  }

  /**
   * Load recording metadata from disk
   */
  private async loadMetadata(): Promise<void> {
    try {
      if (existsSync(this.metadataFile)) {
        const data = await readFile(this.metadataFile, 'utf-8');
        const parsed = JSON.parse(data) as RecordingMetadata[];
        this.recordings.clear();
        for (const recording of parsed) {
          // Verify file still exists
          if (existsSync(recording.filepath)) {
            this.recordings.set(recording.id, recording);
          }
        }
        logger.info('Loaded recording metadata', { count: this.recordings.size });
      }
    } catch (error) {
      logger.error('Failed to load metadata', { error: (error as Error).message });
    }
  }

  /**
   * Save recording metadata to disk
   */
  private async saveMetadata(): Promise<void> {
    try {
      const data = Array.from(this.recordings.values());
      await writeFile(this.metadataFile, JSON.stringify(data, null, 2));
      logger.debug('Saved recording metadata', { count: this.recordings.size });
    } catch (error) {
      logger.error('Failed to save metadata', { error: (error as Error).message });
    }
  }

  /**
   * Start recording audio
   */
  async startRecording(config?: Partial<RecordingConfig>): Promise<void> {
    if (this._status === RecordingStatus.RECORDING) {
      logger.warn('Already recording');
      return;
    }

    // Merge config
    const recordConfig = { ...this.config, ...config };
    this.currentFormat = recordConfig.format;

    // Generate IDs and paths
    this.currentId = generateRecordingId();
    const filename = generateFilename(this.currentId, this.currentFormat);
    this.currentFilepath = join(this.recordingsDir, filename);

    // Reset state
    this.audioChunks = [];
    this.dataLength = 0;
    this.pausedDuration = 0;
    this.silenceStartTime = 0;

    try {
      // Create write stream
      this.currentStream = createWriteStream(this.currentFilepath);

      // For WAV, write placeholder header (will update at end)
      if (this.currentFormat === 'wav') {
        const header = WavHeader.create(
          0,
          recordConfig.sampleRate,
          recordConfig.channels,
          recordConfig.bitDepth
        );
        this.currentStream.write(header);
      }

      this.startTime = Date.now();
      this.setStatus(RecordingStatus.RECORDING);

      // Start progress tracking
      this.startProgressTracking();

      logger.info('Recording started', {
        id: this.currentId,
        format: this.currentFormat,
        filepath: this.currentFilepath,
      });

      this.emit('start');
    } catch (error) {
      this.setStatus(RecordingStatus.ERROR);
      const audioError = new AudioError(`Failed to start recording: ${(error as Error).message}`, {
        error: (error as Error).message,
      });
      logger.error('Failed to start recording', { error: (error as Error).message });
      this.emit('error', audioError);
      throw audioError;
    }
  }

  /**
   * Add audio data to the current recording
   * @param audioData - PCM audio data (Int16Array or Buffer)
   */
  addAudioData(audioData: Buffer | Int16Array): void {
    if (this._status !== RecordingStatus.RECORDING) {
      return;
    }

    // Convert Int16Array to Buffer if needed
    const buffer = audioData instanceof Buffer ? audioData : Buffer.from(audioData.buffer);

    // Calculate audio level for silence detection
    const level = this.calculateLevel(buffer);
    this.lastLevel = level;
    this.emit('level', level);

    // Check for silence (auto-stop)
    if (this.config.silenceTimeout > 0) {
      if (level < this.config.silenceThreshold) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = Date.now();
        } else if (Date.now() - this.silenceStartTime > this.config.silenceTimeout) {
          logger.info('Silence detected, auto-stopping');
          this.emit('silenceDetected');
          this.stopRecording().catch((err) => {
            logger.error('Failed to auto-stop recording', { error: err.message });
          });
          return;
        }
      } else {
        this.silenceStartTime = 0;
      }
    }

    // Write to stream
    if (this.currentStream && !this.currentStream.destroyed) {
      this.currentStream.write(buffer);
      this.dataLength += buffer.length;
      this.audioChunks.push(buffer);
    }

    // Check max duration
    if (this.config.maxDuration > 0) {
      const duration = this.getCurrentDuration();
      if (duration >= this.config.maxDuration) {
        logger.info('Max duration reached');
        this.emit('maxDurationReached');
        this.stopRecording().catch((err) => {
          logger.error('Failed to stop recording at max duration', { error: err.message });
        });
      }
    }
  }

  /**
   * Calculate RMS audio level from buffer
   */
  private calculateLevel(buffer: Buffer): number {
    let sum = 0;
    const samples = buffer.length / 2; // 16-bit samples

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768.0;
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples);
  }

  /**
   * Start progress tracking interval
   */
  private startProgressTracking(): void {
    this.stopProgressTracking();
    this.progressInterval = setInterval(() => {
      if (this._status === RecordingStatus.RECORDING) {
        const duration = this.getCurrentDuration();
        this.emit('progress', duration);
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
   * Get current recording duration in milliseconds
   */
  getCurrentDuration(): number {
    if (this.startTime === 0) return 0;

    if (this._status === RecordingStatus.PAUSED) {
      return this.pauseStartTime - this.startTime - this.pausedDuration;
    }

    return Date.now() - this.startTime - this.pausedDuration;
  }

  /**
   * Pause recording
   */
  pauseRecording(): void {
    if (this._status !== RecordingStatus.RECORDING) {
      logger.warn('Cannot pause - not recording');
      return;
    }

    this.pauseStartTime = Date.now();
    this.setStatus(RecordingStatus.PAUSED);
    this.stopProgressTracking();

    logger.info('Recording paused', { duration: this.getCurrentDuration() });
    this.emit('pause');
  }

  /**
   * Resume recording
   */
  resumeRecording(): void {
    if (this._status !== RecordingStatus.PAUSED) {
      logger.warn('Cannot resume - not paused');
      return;
    }

    this.pausedDuration += Date.now() - this.pauseStartTime;
    this.setStatus(RecordingStatus.RECORDING);
    this.startProgressTracking();

    logger.info('Recording resumed');
    this.emit('resume');
  }

  /**
   * Stop recording and save file
   */
  async stopRecording(): Promise<RecordingMetadata> {
    if (this._status !== RecordingStatus.RECORDING && this._status !== RecordingStatus.PAUSED) {
      throw new AudioError('No active recording to stop');
    }

    this.setStatus(RecordingStatus.STOPPING);
    this.stopProgressTracking();
    perfTimer.start('stopRecording');

    const duration = this.getCurrentDuration();

    try {
      // Close the stream
      await this.finalizeStream();

      // Get file stats
      const stats = await stat(this.currentFilepath!);

      // Create metadata
      const metadata: RecordingMetadata = {
        id: this.currentId!,
        filename: basename(this.currentFilepath!),
        filepath: this.currentFilepath!,
        format: this.currentFormat,
        duration,
        size: stats.size,
        sampleRate: this.config.sampleRate,
        channels: this.config.channels,
        createdAt: Date.now(),
      };

      // Save to storage
      this.recordings.set(metadata.id, metadata);
      await this.saveMetadata();

      // Reset state
      this.resetState();

      perfTimer.end('stopRecording');
      logger.info('Recording stopped', {
        id: metadata.id,
        duration,
        size: stats.size,
      });

      this.emit('stop', metadata);
      return metadata;
    } catch (error) {
      this.setStatus(RecordingStatus.ERROR);
      const audioError = new AudioError(`Failed to stop recording: ${(error as Error).message}`, {
        error: (error as Error).message,
      });
      logger.error('Failed to stop recording', { error: (error as Error).message });
      this.emit('error', audioError);
      throw audioError;
    }
  }

  /**
   * Finalize the write stream and update headers
   */
  private async finalizeStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.currentStream) {
        resolve();
        return;
      }

      // For WAV files, update header with final length
      if (this.currentFormat === 'wav' && this.currentFilepath) {
        // Close stream first
        this.currentStream.end(async () => {
          try {
            // Read file, update header, write back
            const fileData = await readFile(this.currentFilepath!);
            const header = fileData.slice(0, 44);
            WavHeader.updateLength(header, this.dataLength);

            // Write updated file
            const updatedFile = Buffer.concat([header, fileData.slice(44)]);
            await writeFile(this.currentFilepath!, updatedFile);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      } else {
        this.currentStream.end(resolve);
      }
    });
  }

  /**
   * Cancel current recording (discard without saving)
   */
  cancelRecording(): void {
    if (this._status !== RecordingStatus.RECORDING && this._status !== RecordingStatus.PAUSED) {
      logger.warn('No active recording to cancel');
      return;
    }

    this.stopProgressTracking();

    // Close and delete file
    if (this.currentStream) {
      this.currentStream.destroy();
    }

    if (this.currentFilepath && existsSync(this.currentFilepath)) {
      try {
        unlinkSync(this.currentFilepath);
      } catch (error) {
        logger.warn('Failed to delete cancelled recording', { error: (error as Error).message });
      }
    }

    this.resetState();
    logger.info('Recording cancelled');
  }

  /**
   * Reset internal state
   */
  private resetState(): void {
    this.currentId = null;
    this.currentFilepath = null;
    this.currentStream = null;
    this.audioChunks = [];
    this.dataLength = 0;
    this.startTime = 0;
    this.pausedDuration = 0;
    this.pauseStartTime = 0;
    this.silenceStartTime = 0;
    this.setStatus(RecordingStatus.IDLE);
  }

  // =========================================================================
  // IRecordingStorage Implementation
  // =========================================================================

  /**
   * List all recordings
   */
  async listRecordings(options: RecordingListOptions = {}): Promise<RecordingMetadata[]> {
    const {
      limit = 100,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      format,
      search,
    } = options;

    let recordings = Array.from(this.recordings.values());

    // Filter by format
    if (format) {
      recordings = recordings.filter((r) => r.format === format);
    }

    // Search by name
    if (search) {
      const searchLower = search.toLowerCase();
      recordings = recordings.filter(
        (r) =>
          r.name?.toLowerCase().includes(searchLower) ||
          r.filename.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    recordings.sort((a, b) => {
      const aValue = a[sortBy] ?? 0;
      const bValue = b[sortBy] ?? 0;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      return sortOrder === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    // Paginate
    return recordings.slice(offset, offset + limit);
  }

  /**
   * Get a specific recording by ID
   */
  async getRecording(id: string): Promise<RecordingMetadata | null> {
    return this.recordings.get(id) ?? null;
  }

  /**
   * Get the most recent recording
   */
  async getLastRecording(): Promise<RecordingMetadata | null> {
    const recordings = await this.listRecordings({
      limit: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    return recordings[0] ?? null;
  }

  /**
   * Delete a recording
   */
  async deleteRecording(id: string): Promise<boolean> {
    const recording = this.recordings.get(id);
    if (!recording) {
      return false;
    }

    try {
      // Delete file
      if (existsSync(recording.filepath)) {
        await unlink(recording.filepath);
      }

      // Remove from metadata
      this.recordings.delete(id);
      await this.saveMetadata();

      logger.info('Recording deleted', { id });
      return true;
    } catch (error) {
      logger.error('Failed to delete recording', { id, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Rename a recording
   */
  async renameRecording(id: string, name: string): Promise<boolean> {
    const recording = this.recordings.get(id);
    if (!recording) {
      return false;
    }

    recording.name = name;
    await this.saveMetadata();

    logger.info('Recording renamed', { id, name });
    return true;
  }

  /**
   * Get total storage used by recordings
   */
  async getStorageUsed(): Promise<number> {
    let total = 0;
    for (const recording of this.recordings.values()) {
      total += recording.size;
    }
    return total;
  }

  /**
   * Get recordings directory path
   */
  getRecordingsPath(): string {
    return this.recordingsDir;
  }

  /**
   * Get recording count
   */
  getRecordingCount(): number {
    return this.recordings.size;
  }

  /**
   * Update transcription for a recording
   */
  async setTranscription(id: string, transcription: string): Promise<boolean> {
    const recording = this.recordings.get(id);
    if (!recording) {
      return false;
    }

    recording.transcription = transcription;
    recording.transcribing = false;
    await this.saveMetadata();

    logger.info('Transcription saved', { id });
    return true;
  }

  /**
   * Set transcribing status for a recording
   */
  async setTranscribing(id: string, transcribing: boolean): Promise<void> {
    const recording = this.recordings.get(id);
    if (recording) {
      recording.transcribing = transcribing;
      await this.saveMetadata();
    }
  }

  /**
   * Get recording audio data as Buffer
   */
  async getAudioData(id: string): Promise<Buffer | null> {
    const recording = this.recordings.get(id);
    if (!recording || !existsSync(recording.filepath)) {
      return null;
    }

    return readFile(recording.filepath);
  }

  // Type-safe event emitter methods
  on<K extends keyof RecorderEvents>(event: K, listener: RecorderEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof RecorderEvents>(event: K, listener: RecorderEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof RecorderEvents>(event: K, ...args: Parameters<RecorderEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let recorderInstance: AudioRecorder | null = null;

/**
 * Get the audio recorder singleton instance
 */
export function getAudioRecorder(): AudioRecorder {
  if (!recorderInstance) {
    recorderInstance = new AudioRecorder();
  }
  return recorderInstance;
}

/**
 * Shutdown the audio recorder
 */
export function shutdownAudioRecorder(): void {
  if (recorderInstance) {
    if (
      recorderInstance.status === RecordingStatus.RECORDING ||
      recorderInstance.status === RecordingStatus.PAUSED
    ) {
      recorderInstance.cancelRecording();
    }
    recorderInstance.removeAllListeners();
    recorderInstance = null;
  }
}

export default AudioRecorder;
