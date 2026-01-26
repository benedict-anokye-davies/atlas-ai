/**
 * Atlas Audio Pipeline Manager
 * Orchestrates the complete voice interaction flow:
 * Wake Word → VAD → STT → LLM → TTS
 *
 * Implements a state machine for managing pipeline states
 * and handles barge-in detection for interrupting TTS playback.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { WakeWordDetector, getWakeWordDetector, shutdownWakeWordDetector } from './wake-word';
import { VADManager, getVADManager, shutdownVADManager } from './vad';
import {
  AudioPreprocessor,
  AudioPreprocessorConfig,
  getAudioPreprocessor,
  shutdownAudioPreprocessor,
} from './audio-preprocessor';
import { AudioAnalyzer, getAudioAnalyzer, shutdownAudioAnalyzer } from './audio-analyzer';
import {
  VoicePipelineState,
  VoicePipelineStatus,
  WakeWordEvent,
  VADEvent,
  SpeechSegment,
  AudioDevice,
  AudioSpectrum,
  AudioAnalysisConfig,
} from '../../shared/types/voice';

const logger = createModuleLogger('AudioPipeline');

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  /** Enable wake word detection */
  enableWakeWord?: boolean;
  /** Enable VAD after wake word */
  enableVAD?: boolean;
  /** Enable barge-in (interrupt TTS with speech) */
  enableBargeIn?: boolean;
  /** Enable audio preprocessing (noise reduction, high-pass filter, noise gate) */
  enablePreprocessing?: boolean;
  /** Audio preprocessor configuration */
  preprocessor?: Partial<AudioPreprocessorConfig>;
  /** Enable audio spectrum analysis for visualization */
  enableAudioAnalysis?: boolean;
  /** Audio analyzer configuration */
  audioAnalyzer?: Partial<AudioAnalysisConfig>;
  /** Timeout for listening state (ms) */
  listeningTimeout?: number;
  /** Timeout for processing state (ms) */
  processingTimeout?: number;
  /** Audio input device index (-1 for default) */
  inputDeviceIndex?: number;
  /** Audio output device index (-1 for default) */
  outputDeviceIndex?: number;
}

/**
 * Default pipeline configuration
 */
const DEFAULT_PIPELINE_CONFIG: Required<PipelineConfig> = {
  enableWakeWord: true, // Re-enabled - provides mic capture via PvRecorder
  enableVAD: true,
  enableBargeIn: true,
  enablePreprocessing: true,
  preprocessor: {},
  enableAudioAnalysis: true, // Enable audio spectrum for orb visualization
  audioAnalyzer: {},
  listeningTimeout: 15000, // 15 seconds max listening
  processingTimeout: 30000, // 30 seconds max processing
  inputDeviceIndex: 1, // MSI GH50 Gaming Headset
  outputDeviceIndex: -1,
};

/**
 * Pipeline events
 */
export interface PipelineEvents {
  /** State changed */
  'state-change': (state: VoicePipelineState, previousState: VoicePipelineState) => void;
  /** Wake word detected */
  'wake-word': (event: WakeWordEvent) => void;
  /** Speech started */
  'speech-start': (event: VADEvent) => void;
  /** Speech ended with segment */
  'speech-segment': (segment: SpeechSegment) => void;
  /** Audio level update */
  'audio-level': (level: number) => void;
  /** Audio spectrum update for visualization (throttled to 60fps) */
  'audio-spectrum': (spectrum: AudioSpectrum) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Pipeline started */
  started: () => void;
  /** Pipeline stopped */
  stopped: () => void;
  /** Barge-in detected */
  'barge-in': () => void;
  /** Listening timeout */
  'listening-timeout': () => void;
  /** Processing timeout */
  'processing-timeout': () => void;
}

/**
 * Audio Pipeline Manager
 * Central orchestrator for the voice interaction flow
 */
export class AudioPipeline extends EventEmitter {
  private state: VoicePipelineState = 'idle';
  private config: Required<PipelineConfig>;
  private wakeWordDetector: WakeWordDetector | null = null;
  private vadManager: VADManager | null = null;
  private audioPreprocessor: AudioPreprocessor | null = null;
  private audioAnalyzer: AudioAnalyzer | null = null;

  // State tracking
  private isRunning: boolean = false;
  private currentAudioLevel: number = 0;
  private currentSpectrum: AudioSpectrum | null = null;
  private lastWakeWordEvent: WakeWordEvent | undefined;
  private lastError: string | undefined;

  // Timeouts
  private listeningTimeoutId: NodeJS.Timeout | null = null;
  private processingTimeoutId: NodeJS.Timeout | null = null;

  // External handlers (set by main process for STT/LLM/TTS integration)
  private onSpeechSegmentHandler: ((segment: SpeechSegment) => void) | null = null;
  private onBargeInHandler: (() => void) | null = null;

  constructor(config?: Partial<PipelineConfig>) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };

    logger.info('AudioPipeline initialized', {
      enableWakeWord: this.config.enableWakeWord,
      enableVAD: this.config.enableVAD,
      enableBargeIn: this.config.enableBargeIn,
      enablePreprocessing: this.config.enablePreprocessing,
      enableAudioAnalysis: this.config.enableAudioAnalysis,
    });
  }

  /**
   * Get available audio input devices
   */
  static getInputDevices(): AudioDevice[] {
    return WakeWordDetector.getAudioDevices();
  }

  /**
   * Get current pipeline state
   */
  getState(): VoicePipelineState {
    return this.state;
  }

  /**
   * Get full pipeline status
   */
  getStatus(): VoicePipelineStatus & { spectrum?: AudioSpectrum } {
    return {
      state: this.state,
      isListening: this.state === 'listening',
      isSpeaking: this.state === 'speaking',
      audioLevel: this.currentAudioLevel,
      lastWakeWord: this.lastWakeWordEvent,
      error: this.lastError,
      spectrum: this.currentSpectrum ?? undefined,
    };
  }

  /**
   * Get current audio spectrum data
   */
  getAudioSpectrum(): AudioSpectrum | null {
    return this.currentSpectrum;
  }

  /**
   * Check if pipeline is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Transition to a new state
   */
  private setState(newState: VoicePipelineState): void {
    if (this.state === newState) return;

    const previousState = this.state;
    this.state = newState;

    logger.info('Pipeline state changed', { from: previousState, to: newState });
    this.emit('state-change', newState, previousState);

    // Clear any pending timeouts on state change
    this.clearTimeouts();

    // Handle state-specific logic
    switch (newState) {
      case 'idle':
        this.handleIdleState();
        break;
      case 'listening':
        this.handleListeningState();
        break;
      case 'processing':
        this.handleProcessingState();
        break;
      case 'speaking':
        this.handleSpeakingState();
        break;
      case 'error':
        // Error state is handled by the error event
        break;
    }
  }

  /**
   * Handle entering idle state
   */
  private handleIdleState(): void {
    // Resume wake word detection
    if (this.wakeWordDetector && this.config.enableWakeWord) {
      this.wakeWordDetector.resume();
    }

    // Pause VAD in idle
    if (this.vadManager && this.config.enableVAD) {
      this.vadManager.reset();
    }
  }

  /**
   * Handle entering listening state
   */
  private handleListeningState(): void {
    // Pause wake word while listening
    if (this.wakeWordDetector) {
      this.wakeWordDetector.pause();
    }

    // Start listening timeout
    this.listeningTimeoutId = setTimeout(() => {
      if (this.state === 'listening') {
        logger.warn('Listening timeout reached');
        this.emit('listening-timeout');
        this.setState('idle');
      }
    }, this.config.listeningTimeout);
  }

  /**
   * Handle entering processing state
   */
  private handleProcessingState(): void {
    // Pause all audio input during processing
    if (this.wakeWordDetector) {
      this.wakeWordDetector.pause();
    }

    // Start processing timeout
    this.processingTimeoutId = setTimeout(() => {
      if (this.state === 'processing') {
        logger.warn('Processing timeout reached');
        this.emit('processing-timeout');
        this.setState('idle');
      }
    }, this.config.processingTimeout);
  }

  /**
   * Handle entering speaking state
   */
  private handleSpeakingState(): void {
    // Enable barge-in detection if configured
    if (this.config.enableBargeIn && this.vadManager) {
      // Resume VAD to detect interruption
      this.vadManager.reset();
    }
  }

  /**
   * Clear all pending timeouts
   */
  private clearTimeouts(): void {
    if (this.listeningTimeoutId) {
      clearTimeout(this.listeningTimeoutId);
      this.listeningTimeoutId = null;
    }
    if (this.processingTimeoutId) {
      clearTimeout(this.processingTimeoutId);
      this.processingTimeoutId = null;
    }
  }

  /**
   * Start the audio pipeline
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Pipeline already running');
      return;
    }

    try {
      logger.info('Starting audio pipeline...');
      const startTime = Date.now();

      // Initialize audio preprocessor FIRST (synchronous, other components may depend on it)
      if (this.config.enablePreprocessing) {
        this.audioPreprocessor = getAudioPreprocessor();
        if (this.config.preprocessor) {
          this.audioPreprocessor.updateConfig(this.config.preprocessor);
        }
        logger.info('Audio preprocessor initialized', {
          noiseReduction: this.audioPreprocessor.getConfig().enableNoiseReduction,
          noiseGate: this.audioPreprocessor.getConfig().enableNoiseGate,
          highPass: this.audioPreprocessor.getConfig().enableHighPass,
        });
      }

      // Parallel initialization of independent components
      const initPromises: Promise<void>[] = [];
      const initLabels: string[] = [];

      // Wake word detector (async)
      if (this.config.enableWakeWord) {
        initLabels.push('wake-word');
        initPromises.push((async () => {
          const wakeStart = Date.now();
          this.wakeWordDetector = getWakeWordDetector();
          this.wakeWordDetector.setAudioDevice(this.config.inputDeviceIndex);
          this.setupWakeWordHandlers();
          await this.wakeWordDetector.start();
          logger.debug(`Wake word detector initialized in ${Date.now() - wakeStart}ms`);
        })());
      }

      // VAD (async)
      if (this.config.enableVAD) {
        initLabels.push('vad');
        initPromises.push((async () => {
          const vadStart = Date.now();
          this.vadManager = getVADManager();
          this.setupVADHandlers();
          await this.vadManager.start();
          logger.debug(`VAD manager initialized in ${Date.now() - vadStart}ms`);
        })());
      }

      // Audio analyzer (synchronous start, but we can still parallelize the setup)
      if (this.config.enableAudioAnalysis) {
        initLabels.push('audio-analyzer');
        initPromises.push((async () => {
          const analyzerStart = Date.now();
          this.audioAnalyzer = getAudioAnalyzer();
          if (this.config.audioAnalyzer) {
            this.audioAnalyzer.updateConfig(this.config.audioAnalyzer);
          }
          this.setupAudioAnalyzerHandlers();
          this.audioAnalyzer.start();
          logger.debug(`Audio analyzer initialized in ${Date.now() - analyzerStart}ms`, {
            fftSize: this.audioAnalyzer.getConfig().fftSize,
            targetFps: this.audioAnalyzer.getConfig().targetFps,
          });
        })());
      }

      // Wait for all parallel initializations
      if (initPromises.length > 0) {
        logger.debug(`Waiting for parallel initialization of: ${initLabels.join(', ')}`);
        await Promise.all(initPromises);
      }

      this.isRunning = true;
      this.setState('idle');

      const totalTime = Date.now() - startTime;
      logger.info(`Audio pipeline started in ${totalTime}ms`);
      this.emit('started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastError = err.message;
      this.setState('error');
      logger.error('Failed to start pipeline', { error: err.message });
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop the audio pipeline
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping audio pipeline...');

    this.clearTimeouts();

    // Stop audio analyzer
    if (this.audioAnalyzer) {
      shutdownAudioAnalyzer();
      this.audioAnalyzer = null;
    }

    // Stop audio preprocessor
    if (this.audioPreprocessor) {
      shutdownAudioPreprocessor();
      this.audioPreprocessor = null;
    }

    // Stop wake word detector
    if (this.wakeWordDetector) {
      await shutdownWakeWordDetector();
      this.wakeWordDetector = null;
    }

    // Stop VAD
    if (this.vadManager) {
      await shutdownVADManager();
      this.vadManager = null;
    }

    this.isRunning = false;
    this.state = 'idle';

    logger.info('Audio pipeline stopped');
    this.emit('stopped');
  }

  /**
   * Set up wake word event handlers
   */
  private setupWakeWordHandlers(): void {
    if (!this.wakeWordDetector) return;

    this.wakeWordDetector.on('wake', (event: WakeWordEvent) => {
      logger.info('Wake word detected', { keyword: event.keyword });
      this.lastWakeWordEvent = event;
      this.emit('wake-word', event);

      // Transition to listening state
      this.setState('listening');
    });

    this.wakeWordDetector.on('audio-level', (level: number) => {
      this.currentAudioLevel = level;
      this.emit('audio-level', level);
    });

    // Feed raw audio frames to the analyzer for spectrum visualization
    // AND to VAD for noise profiling and speech detection
    this.wakeWordDetector.on('audio-frame', (frame: Int16Array) => {
      this.feedAudioToAnalyzer(frame);
      
      // Always feed audio to VAD for noise profiling (idle) and speech detection (listening/speaking)
      // In idle state, VAD uses this for noise profiling but we ignore speech events
      if (this.vadManager) {
        // Convert Int16Array to Float32Array (normalize to -1.0 to 1.0 range)
        const floatFrame = new Float32Array(frame.length);
        for (let i = 0; i < frame.length; i++) {
          floatFrame[i] = frame[i] / 32768.0;
        }
        
        // Apply preprocessing if enabled
        let processedAudio = floatFrame;
        if (this.audioPreprocessor && this.config.enablePreprocessing) {
          processedAudio = this.audioPreprocessor.process(floatFrame);
        }
        
        // Feed to VAD
        this.vadManager.processAudio(processedAudio).catch((err) => {
          logger.error('Error feeding audio to VAD', { error: err.message });
        });
      }
    });

    this.wakeWordDetector.on('error', (error: Error) => {
      logger.error('Wake word error', { error: error.message });
      this.emit('error', error);
    });
  }

  /**
   * Set up VAD event handlers
   */
  private setupVADHandlers(): void {
    if (!this.vadManager) return;

    // Barge-in confidence tracking
    let bargeInSpeechStartTime = 0;
    let bargeInConfidenceCount = 0;
    const BARGE_IN_MIN_DURATION_MS = 400; // Require 400ms sustained speech
    const BARGE_IN_MIN_CONFIDENCE_EVENTS = 3; // Require 3 VAD confirmations
    let bargeInCheckTimer: ReturnType<typeof setTimeout> | null = null;

    this.vadManager.on('speech-start', (event: VADEvent) => {
      // Check if we should handle this as barge-in
      if (this.state === 'speaking' && this.config.enableBargeIn) {
        // Start tracking barge-in confidence
        bargeInSpeechStartTime = Date.now();
        bargeInConfidenceCount = 1;
        
        // Set a timer to confirm barge-in after minimum duration
        if (bargeInCheckTimer) {
          clearTimeout(bargeInCheckTimer);
        }
        
        bargeInCheckTimer = setTimeout(() => {
          // Only trigger barge-in if still speaking AND we've had sustained speech
          if (this.state === 'speaking' && 
              bargeInConfidenceCount >= BARGE_IN_MIN_CONFIDENCE_EVENTS) {
            logger.info('Barge-in confirmed', {
              duration: Date.now() - bargeInSpeechStartTime,
              confidenceEvents: bargeInConfidenceCount,
            });
            this.emit('barge-in');
            if (this.onBargeInHandler) {
              this.onBargeInHandler();
            }
            this.setState('listening');
          }
          bargeInCheckTimer = null;
        }, BARGE_IN_MIN_DURATION_MS);
        
        logger.debug('Potential barge-in detected, waiting for confirmation');
        return;
      }

      // Normal speech start
      if (this.state === 'listening') {
        logger.debug('Speech started');
        this.emit('speech-start', event);
      }
    });

    // Track VAD probability events for barge-in confidence
    this.vadManager.on('vad-probability', (probability: number) => {
      // If we're tracking potential barge-in and VAD shows high confidence
      if (this.state === 'speaking' && 
          this.config.enableBargeIn && 
          bargeInSpeechStartTime > 0 &&
          probability > 0.7) {
        bargeInConfidenceCount++;
      }
    });

    // Reset barge-in tracking on speech-end
    this.vadManager.on('speech-end', () => {
      if (bargeInCheckTimer) {
        clearTimeout(bargeInCheckTimer);
        bargeInCheckTimer = null;
      }
      bargeInSpeechStartTime = 0;
      bargeInConfidenceCount = 0;
    });

    this.vadManager.on('speech-segment', (segment: SpeechSegment) => {
      if (this.state === 'listening') {
        logger.info('Speech segment complete', {
          duration: segment.duration,
          samples: segment.audio.length,
        });
        this.emit('speech-segment', segment);

        // Notify external handler
        if (this.onSpeechSegmentHandler) {
          this.onSpeechSegmentHandler(segment);
        }

        // Transition to processing
        this.setState('processing');
      }
    });

    this.vadManager.on('speech-end', (event: VADEvent) => {
      logger.debug('Speech ended', { duration: event.duration });
    });

    this.vadManager.on('error', (error: Error) => {
      logger.error('VAD error', { error: error.message });
      this.emit('error', error);
    });
  }

  /**
   * Set up audio analyzer event handlers for orb visualization
   */
  private setupAudioAnalyzerHandlers(): void {
    if (!this.audioAnalyzer) return;

    this.audioAnalyzer.on('spectrum', (spectrum: AudioSpectrum) => {
      this.currentSpectrum = spectrum;
      this.emit('audio-spectrum', spectrum);
    });

    this.audioAnalyzer.on('error', (error: Error) => {
      logger.error('Audio analyzer error', { error: error.message });
      // Don't emit error for analyzer - it's non-critical for core functionality
    });
  }

  /**
   * Feed audio frame to the audio analyzer
   * Called from wake word detector's audio-level handler
   */
  private feedAudioToAnalyzer(frame: Int16Array): void {
    if (this.audioAnalyzer && this.config.enableAudioAnalysis) {
      this.audioAnalyzer.processFrame(frame);
    }
  }

  /**
   * Process audio frame through preprocessor and VAD
   * Called externally when audio is captured
   */
  async processAudioFrame(audio: Float32Array): Promise<void> {
    if (!this.isRunning || !this.vadManager) {
      return;
    }

    // Only process VAD in listening or speaking (for barge-in) states
    if (this.state === 'listening' || (this.state === 'speaking' && this.config.enableBargeIn)) {
      // Apply audio preprocessing if enabled (noise reduction, high-pass, noise gate)
      let processedAudio = audio;
      if (this.audioPreprocessor && this.config.enablePreprocessing) {
        processedAudio = this.audioPreprocessor.process(audio);
      }

      await this.vadManager.processAudio(processedAudio);
    }
  }

  /**
   * Get the audio preprocessor instance (for external configuration or statistics)
   */
  getAudioPreprocessor(): AudioPreprocessor | null {
    return this.audioPreprocessor;
  }

  /**
   * Set handler for speech segment completion
   * Used by main process to send audio to STT
   */
  setOnSpeechSegment(handler: (segment: SpeechSegment) => void): void {
    this.onSpeechSegmentHandler = handler;
  }

  /**
   * Set handler for barge-in detection
   * Used by main process to stop TTS playback
   */
  setOnBargeIn(handler: () => void): void {
    this.onBargeInHandler = handler;
  }

  /**
   * Manually trigger wake (for push-to-talk or UI button)
   */
  triggerWake(): void {
    if (!this.isRunning || this.state !== 'idle') {
      logger.warn('Cannot trigger wake - pipeline not in idle state');
      return;
    }

    const event: WakeWordEvent = {
      timestamp: Date.now(),
      keyword: 'manual',
      confidence: 1.0,
    };

    logger.info('Manual wake triggered');
    this.lastWakeWordEvent = event;
    this.emit('wake-word', event);
    this.setState('listening');
  }

  /**
   * Signal that processing is complete, start speaking
   */
  startSpeaking(): void {
    if (this.state !== 'processing' && this.state !== 'listening') {
      logger.warn('Cannot start speaking from current state', { state: this.state });
      return;
    }

    // Suppress wake word detection while Atlas is speaking
    // This prevents false triggers from Atlas's own voice
    if (this.wakeWordDetector) {
      this.wakeWordDetector.setAtlasSpeaking(true);
    }

    this.setState('speaking');
  }

  /**
   * Signal that speaking is complete, return to idle
   */
  finishSpeaking(): void {
    if (this.state !== 'speaking') {
      return;
    }

    // Re-enable wake word detection now that Atlas is done speaking
    if (this.wakeWordDetector) {
      this.wakeWordDetector.setAtlasSpeaking(false);
    }

    this.setState('idle');
  }

  /**
   * Cancel current interaction and return to idle
   */
  cancel(): void {
    logger.info('Cancelling current interaction');
    this.clearTimeouts();

    // Ensure wake word detection is re-enabled when cancelling
    if (this.wakeWordDetector && this.state === 'speaking') {
      this.wakeWordDetector.setAtlasSpeaking(false);
    }

    this.setState('idle');
  }

  /**
   * Pause the pipeline (keeps resources but stops processing)
   */
  pause(): void {
    if (!this.isRunning) return;

    logger.info('Pausing pipeline');

    if (this.wakeWordDetector) {
      this.wakeWordDetector.pause();
    }

    if (this.vadManager) {
      this.vadManager.reset();
    }
  }

  /**
   * Resume the pipeline
   */
  resume(): void {
    if (!this.isRunning) return;

    logger.info('Resuming pipeline');

    if (this.wakeWordDetector && this.state === 'idle') {
      this.wakeWordDetector.resume();
    }
  }

  /**
   * Set audio input device
   */
  setInputDevice(deviceIndex: number): void {
    this.config.inputDeviceIndex = deviceIndex;
    if (this.wakeWordDetector) {
      this.wakeWordDetector.setAudioDevice(deviceIndex);
    }
    logger.info('Input device set', { deviceIndex });
  }

  /**
   * Set audio output device
   */
  setOutputDevice(deviceIndex: number): void {
    this.config.outputDeviceIndex = deviceIndex;
    // Output device is used by TTS, which is external to this class
    logger.info('Output device set', { deviceIndex });
  }

  /**
   * Update pipeline configuration
   */
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Pipeline config updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  // Type-safe event emitter methods
  on<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof PipelineEvents>(event: K, listener: PipelineEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof PipelineEvents>(event: K, ...args: Parameters<PipelineEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Singleton instance
let audioPipeline: AudioPipeline | null = null;

/**
 * Get or create the audio pipeline instance
 */
export function getAudioPipeline(): AudioPipeline {
  if (!audioPipeline) {
    audioPipeline = new AudioPipeline();
  }
  return audioPipeline;
}

/**
 * Shutdown the audio pipeline
 */
export async function shutdownAudioPipeline(): Promise<void> {
  if (audioPipeline) {
    await audioPipeline.stop();
    audioPipeline = null;
  }
}

export default AudioPipeline;
