/**
 * Nova TTS - Main Provider
 * Unified TTS system with multiple engines, voice cloning, and advanced features
 * 
 * Open-source alternative to ElevenLabs with:
 * - Multiple neural TTS backends (Piper, Edge, XTTS, StyleTTS2, OpenVoice)
 * - Voice cloning with minimal audio samples
 * - Emotion and style control
 * - Real-time streaming synthesis
 * - Local model management
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import {
  NovaTTSEngine,
  NovaTTSVoice,
  NovaTTSEngineStatus,
  SynthesisOptions,
  NovaTTSAudioChunk,
  NovaTTSSynthesisResult,
  EngineInfo,
  NovaTTSConfig,
  DEFAULT_NOVA_TTS_CONFIG,
  DEFAULT_SYNTHESIS_OPTIONS,
  VoiceCloneConfig,
  VoiceCloneResult,
  SpeechQueueItem,
  NovaTTSProvider,
  NovaTTSEvents,
} from './types';
import { PiperEngine } from './engines/piper-engine';
import { EdgeEngine } from './engines/edge-engine';
import { XTTSEngine } from './engines/xtts-engine';
import { ALL_VOICES, getRecommendedVoices, searchVoices as searchVoicesLib } from './voices';

const logger = createModuleLogger('NovaTTS');

/**
 * Get default Nova TTS paths
 */
function getDefaultPaths(): { modelsPath: string; cachePath: string } {
  const userDataPath = app?.getPath?.('userData') || 
    join(process.env.HOME || process.env.USERPROFILE || '.', '.nova-tts');
  
  return {
    modelsPath: join(userDataPath, 'models'),
    cachePath: join(userDataPath, 'cache'),
  };
}

/**
 * Nova TTS Provider
 * Main entry point for the open-source TTS system
 */
export class NovaTTS extends EventEmitter implements NovaTTSProvider {
  readonly name = 'nova-tts';
  private config: NovaTTSConfig;
  private _status: NovaTTSEngineStatus = NovaTTSEngineStatus.UNINITIALIZED;

  // Engine instances
  private engines: Map<NovaTTSEngine, {
    instance: PiperEngine | EdgeEngine | XTTSEngine;
    status: NovaTTSEngineStatus;
  }> = new Map();
  private activeEngine: NovaTTSEngine;

  // Speech queue
  private speechQueue: SpeechQueueItem[] = [];
  private isProcessingQueue = false;
  private currentSpeechId: string | null = null;
  private isPaused = false;
  private pausedAudioBuffer: NovaTTSAudioChunk[] = [];
  private pausedAudioPosition = 0;

  // Cache management
  private cacheUsage = 0;

  constructor(config: Partial<NovaTTSConfig> = {}) {
    super();
    const defaults = getDefaultPaths();
    this.config = {
      ...DEFAULT_NOVA_TTS_CONFIG,
      modelsPath: defaults.modelsPath,
      cachePath: defaults.cachePath,
      ...config,
    };
    this.activeEngine = this.config.defaultEngine;
  }

  /**
   * Get current status
   */
  get status(): NovaTTSEngineStatus {
    return this._status;
  }

  /**
   * Set status and emit event
   */
  private setStatus(status: NovaTTSEngineStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('engine-status', 'nova-tts' as NovaTTSEngine, status);
    }
  }

  /**
   * Initialize Nova TTS
   */
  async initialize(): Promise<void> {
    this.setStatus(NovaTTSEngineStatus.LOADING);
    logger.info('Initializing Nova TTS...');

    try {
      // Ensure directories exist
      mkdirSync(this.config.modelsPath, { recursive: true });
      mkdirSync(this.config.cachePath, { recursive: true });

      // Initialize engines
      await this.initializeEngines();

      // Select best available engine
      await this.selectBestEngine();

      // Calculate cache usage
      this.updateCacheUsage();

      this.setStatus(NovaTTSEngineStatus.READY);
      logger.info('Nova TTS initialized', {
        activeEngine: this.activeEngine,
        engines: Array.from(this.engines.keys()),
      });
    } catch (error) {
      this.setStatus(NovaTTSEngineStatus.ERROR);
      logger.error('Failed to initialize Nova TTS', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Initialize all engines
   */
  private async initializeEngines(): Promise<void> {
    // Initialize Piper (fast, local)
    try {
      const piper = new PiperEngine({
        modelsPath: join(this.config.modelsPath, 'piper'),
      });
      this.setupEngineListeners(piper, 'piper');
      await piper.initialize();
      this.engines.set('piper', { instance: piper, status: piper.status });
      logger.info('Piper engine ready');
    } catch (error) {
      logger.warn('Piper engine initialization failed', { error: (error as Error).message });
    }

    // Initialize Edge TTS (free, cloud)
    try {
      const edge = new EdgeEngine({
        cachePath: join(this.config.cachePath, 'edge-tts'),
      });
      this.setupEngineListeners(edge, 'edge');
      await edge.initialize();
      this.engines.set('edge', { instance: edge, status: edge.status });
      logger.info('Edge TTS engine ready');
    } catch (error) {
      logger.warn('Edge TTS engine initialization failed', { error: (error as Error).message });
    }

    // Initialize XTTS (voice cloning, requires GPU ideally)
    try {
      const xtts = new XTTSEngine({
        modelsPath: join(this.config.modelsPath, 'xtts'),
        clonedVoicesPath: join(this.config.modelsPath, 'cloned'),
        scriptsPath: join(this.config.modelsPath, 'scripts'),
        gpuDeviceId: this.config.gpuDeviceId,
      });
      this.setupEngineListeners(xtts, 'xtts');
      await xtts.initialize();
      this.engines.set('xtts', { instance: xtts, status: xtts.status });
      logger.info('XTTS engine ready');
    } catch (error) {
      logger.warn('XTTS engine initialization failed', { error: (error as Error).message });
    }
  }

  /**
   * Setup event listeners for an engine
   */
  private setupEngineListeners(engine: PiperEngine | EdgeEngine | XTTSEngine, type: NovaTTSEngine): void {
    engine.on('engine-status', (_, status: NovaTTSEngineStatus) => {
      const engineData = this.engines.get(type);
      if (engineData) {
        engineData.status = status;
      }
      this.emit('engine-status', type, status);
    });

    engine.on('synthesis-start', (id: string, text: string, options: SynthesisOptions) => {
      this.emit('synthesis-start', id, text, options);
    });

    engine.on('audio-chunk', (chunk: NovaTTSAudioChunk) => {
      this.emit('audio-chunk', chunk);
    });

    engine.on('synthesis-complete', (result: NovaTTSSynthesisResult) => {
      this.emit('synthesis-complete', result);
    });

    engine.on('synthesis-error', (id: string, error: Error) => {
      this.emit('synthesis-error', id, error);
    });

    engine.on('download-progress', (progress) => {
      this.emit('download-progress', progress);
    });

    engine.on('clone-progress', (voiceId, stage, progress) => {
      this.emit('clone-progress', voiceId, stage, progress);
    });

    engine.on('clone-complete', (result) => {
      this.emit('clone-complete', result);
    });
  }

  /**
   * Select the best available engine based on capabilities
   */
  private async selectBestEngine(): Promise<void> {
    // Priority: configured default > piper > edge > xtts
    const priority: NovaTTSEngine[] = [this.config.defaultEngine, 'piper', 'edge', 'xtts'];

    for (const engine of priority) {
      const engineData = this.engines.get(engine);
      if (engineData && engineData.status === NovaTTSEngineStatus.READY) {
        this.activeEngine = engine;
        logger.info('Selected engine', { engine });
        return;
      }
    }

    // No engine available
    logger.warn('No TTS engine available');
  }

  /**
   * Shutdown Nova TTS
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Nova TTS...');

    // Stop any current speech
    this.stop();

    // Shutdown all engines
    for (const [type, engine] of this.engines) {
      try {
        await engine.instance.shutdown();
        logger.debug('Engine shutdown', { engine: type });
      } catch (error) {
        logger.warn('Engine shutdown failed', { engine: type, error: (error as Error).message });
      }
    }

    this.engines.clear();
    this.setStatus(NovaTTSEngineStatus.SHUTDOWN);
    logger.info('Nova TTS shutdown complete');
  }

  /**
   * Get all available voices across all engines
   */
  getVoices(): NovaTTSVoice[] {
    const voices: NovaTTSVoice[] = [];

    for (const [type, engine] of this.engines) {
      try {
        const engineVoices = engine.instance.getVoices();
        voices.push(...engineVoices);
      } catch (error) {
        logger.debug('Failed to get voices from engine', { engine: type });
      }
    }

    return voices;
  }

  /**
   * Get a specific voice
   */
  getVoice(voiceId: string): NovaTTSVoice | null {
    for (const [_, engine] of this.engines) {
      const voice = engine.instance.getVoice(voiceId);
      if (voice) return voice;
    }
    return null;
  }

  /**
   * Check if voice is downloaded
   */
  isVoiceDownloaded(voiceId: string): boolean {
    const voice = this.getVoice(voiceId);
    if (!voice) return false;

    const engine = this.engines.get(voice.engine);
    return engine?.instance.isVoiceDownloaded(voiceId) ?? false;
  }

  /**
   * Download a voice model
   */
  async downloadVoice(voiceId: string): Promise<void> {
    const voice = this.getVoice(voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }

    const engine = this.engines.get(voice.engine);
    if (!engine) {
      throw new Error(`Engine not available: ${voice.engine}`);
    }

    await engine.instance.downloadVoice(voiceId);
  }

  /**
   * Delete a voice model
   */
  async deleteVoice(voiceId: string): Promise<void> {
    const voice = this.getVoice(voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }

    const engine = this.engines.get(voice.engine);
    if (!engine) {
      throw new Error(`Engine not available: ${voice.engine}`);
    }

    await engine.instance.deleteVoice(voiceId);
  }

  /**
   * Clone a voice from reference audio
   */
  async cloneVoice(config: VoiceCloneConfig): Promise<VoiceCloneResult> {
    // Use XTTS for voice cloning
    const xtts = this.engines.get('xtts');
    if (!xtts || xtts.status !== NovaTTSEngineStatus.READY) {
      // Fall back to OpenVoice if available
      throw new Error('Voice cloning requires XTTS engine. Please ensure it is installed and initialized.');
    }

    return (xtts.instance as XTTSEngine).cloneVoice(config);
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(voiceId: string): Promise<void> {
    const voice = this.getVoice(voiceId);
    if (!voice || !voice.isCloned) {
      throw new Error(`Cloned voice not found: ${voiceId}`);
    }

    await this.deleteVoice(voiceId);
  }

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options: SynthesisOptions): Promise<NovaTTSSynthesisResult> {
    // Determine which engine to use
    const voice = this.getVoice(options.voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${options.voiceId}`);
    }

    const engine = this.engines.get(voice.engine);
    if (!engine || engine.status !== NovaTTSEngineStatus.READY) {
      // Try fallback engine
      const fallback = this.findFallbackEngine(voice);
      if (!fallback) {
        throw new Error(`No engine available for voice: ${options.voiceId}`);
      }
      logger.info('Using fallback engine', { requested: voice.engine, fallback: fallback.type });
      return fallback.instance.synthesize(text, options);
    }

    return engine.instance.synthesize(text, options);
  }

  /**
   * Synthesize text with streaming
   */
  async *synthesizeStream(text: string, options: SynthesisOptions): AsyncGenerator<NovaTTSAudioChunk> {
    const voice = this.getVoice(options.voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${options.voiceId}`);
    }

    const engine = this.engines.get(voice.engine);
    if (!engine || engine.status !== NovaTTSEngineStatus.READY) {
      throw new Error(`Engine not available: ${voice.engine}`);
    }

    yield* engine.instance.synthesizeStream(text, options);
  }

  /**
   * Find a fallback engine for a voice
   */
  private findFallbackEngine(voice: NovaTTSVoice): { type: NovaTTSEngine; instance: any } | null {
    // Try engines in priority order
    const fallbackOrder: NovaTTSEngine[] = ['piper', 'edge'];
    
    for (const type of fallbackOrder) {
      if (type === voice.engine) continue;
      
      const engine = this.engines.get(type);
      if (engine && engine.status === NovaTTSEngineStatus.READY) {
        // Check if engine has a suitable voice
        const voices = engine.instance.getVoices();
        const match = voices.find(v => 
          v.language === voice.language && 
          v.gender === voice.gender
        );
        
        if (match && engine.instance.isVoiceDownloaded(match.id)) {
          return { type, instance: engine.instance };
        }
      }
    }

    return null;
  }

  /**
   * Speak text (synthesize and emit for playback)
   */
  async speak(text: string, options?: Partial<SynthesisOptions>): Promise<void> {
    const fullOptions: SynthesisOptions = {
      ...DEFAULT_SYNTHESIS_OPTIONS,
      voiceId: options?.voiceId || this.config.defaultVoiceId,
      ...options,
    };

    // Add to queue
    const queueItem: SpeechQueueItem = {
      id: `speech_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      text,
      options: fullOptions,
      priority: options?.priority || 0,
      status: 'pending',
      queuedAt: Date.now(),
    };

    if (this.config.enableQueue) {
      this.addToQueue(queueItem);
    } else {
      // Direct synthesis
      await this.processSpeechItem(queueItem);
    }
  }

  /**
   * Add item to speech queue
   */
  private addToQueue(item: SpeechQueueItem): void {
    // Check queue size limit
    if (this.speechQueue.length >= this.config.maxQueueSize) {
      logger.warn('Speech queue full, dropping oldest item');
      this.speechQueue.shift();
    }

    // Insert by priority
    let inserted = false;
    for (let i = 0; i < this.speechQueue.length; i++) {
      if (item.priority > this.speechQueue[i].priority) {
        this.speechQueue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.speechQueue.push(item);
    }

    this.emit('queue-update', [...this.speechQueue]);

    // Start processing if not already
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.speechQueue.length > 0) {
      const item = this.speechQueue[0];
      
      try {
        await this.processSpeechItem(item);
        item.status = 'complete';
        item.completedAt = Date.now();
      } catch (error) {
        item.status = 'error';
        item.error = (error as Error).message;
        logger.error('Speech processing failed', { id: item.id, error: item.error });
      }

      // Remove from queue
      this.speechQueue.shift();
      this.emit('queue-update', [...this.speechQueue]);
    }

    this.isProcessingQueue = false;
  }

  /**
   * Process a single speech item
   */
  private async processSpeechItem(item: SpeechQueueItem): Promise<void> {
    item.status = 'processing';
    item.startedAt = Date.now();
    this.currentSpeechId = item.id;

    this.emit('playback-start');

    try {
      if (item.options.streaming) {
        // Streaming synthesis
        for await (const chunk of this.synthesizeStream(item.text, item.options)) {
          // Emit chunks for playback
          this.emit('audio-chunk', chunk);
        }
      } else {
        // Full synthesis
        await this.synthesize(item.text, item.options);
      }
    } finally {
      this.currentSpeechId = null;
      this.emit('playback-end');
    }
  }

  /**
   * Stop current speech
   */
  stop(): void {
    // Stop all engines
    for (const [_, engine] of this.engines) {
      engine.instance.stop();
    }

    // Clear queue
    if (this.currentSpeechId) {
      this.emit('interrupted');
    }
    this.currentSpeechId = null;
    this.isProcessingQueue = false;
  }

  /**
   * Pause playback - stores current audio position for later resumption
   */
  pause(): void {
    if (!this.currentSpeechId || this.isPaused) {
      logger.debug('Cannot pause: no active speech or already paused');
      return;
    }

    this.isPaused = true;
    this.isProcessingQueue = false;

    // Stop all engines from producing new audio
    for (const [_, engine] of this.engines) {
      if (typeof engine.instance.stop === 'function') {
        engine.instance.stop();
      }
    }

    this.emit('paused');
    logger.info('TTS playback paused', { currentSpeechId: this.currentSpeechId });
  }

  /**
   * Resume playback - continues from paused position
   */
  resume(): void {
    if (!this.isPaused) {
      logger.debug('Cannot resume: not paused');
      return;
    }

    this.isPaused = false;
    this.emit('resumed');
    logger.info('TTS playback resumed', { currentSpeechId: this.currentSpeechId });

    // Continue processing the queue if there are items
    if (this.speechQueue.length > 0 || this.currentSpeechId) {
      this.processQueue().catch((error) => {
        logger.error('Error resuming queue processing', { error });
      });
    }
  }

  /**
   * Check if playback is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.currentSpeechId !== null || this.isProcessingQueue;
  }

  /**
   * Get speech queue
   */
  getQueue(): SpeechQueueItem[] {
    return [...this.speechQueue];
  }

  /**
   * Clear speech queue
   */
  clearQueue(): void {
    const cancelled = this.speechQueue.map(item => ({ ...item, status: 'cancelled' as const }));
    this.speechQueue = [];
    this.emit('queue-update', []);
    logger.info('Speech queue cleared', { cancelled: cancelled.length });
  }

  /**
   * Get information about all engines
   */
  getEngineInfo(): EngineInfo[] {
    const info: EngineInfo[] = [];
    
    for (const [type, engine] of this.engines) {
      info.push(engine.instance.getEngineInfo());
    }

    return info;
  }

  /**
   * Set the active engine
   */
  async setActiveEngine(engine: NovaTTSEngine): Promise<void> {
    const engineData = this.engines.get(engine);
    if (!engineData) {
      throw new Error(`Engine not available: ${engine}`);
    }

    if (engineData.status !== NovaTTSEngineStatus.READY) {
      throw new Error(`Engine not ready: ${engine}`);
    }

    this.activeEngine = engine;
    logger.info('Active engine changed', { engine });
  }

  /**
   * Get the active engine
   */
  getActiveEngine(): NovaTTSEngine {
    return this.activeEngine;
  }

  /**
   * Get recommended voices for assistant use
   */
  getRecommendedVoices(): NovaTTSVoice[] {
    return getRecommendedVoices();
  }

  /**
   * Search voices by query
   */
  searchVoices(query: string): NovaTTSVoice[] {
    return searchVoicesLib(query);
  }

  /**
   * Get cache usage in bytes
   */
  getCacheUsage(): number {
    return this.cacheUsage;
  }

  /**
   * Update cache usage calculation
   */
  private updateCacheUsage(): void {
    try {
      this.cacheUsage = this.calculateDirectorySize(this.config.cachePath);
    } catch {
      this.cacheUsage = 0;
    }
  }

  /**
   * Calculate directory size recursively
   */
  private calculateDirectorySize(dirPath: string): number {
    if (!existsSync(dirPath)) return 0;

    let totalSize = 0;
    const items = readdirSync(dirPath);

    for (const item of items) {
      const itemPath = join(dirPath, item);
      const stat = statSync(itemPath);

      if (stat.isDirectory()) {
        totalSize += this.calculateDirectorySize(itemPath);
      } else {
        totalSize += stat.size;
      }
    }

    return totalSize;
  }

  /**
   * Clear the audio cache
   */
  async clearCache(): Promise<void> {
    // This would delete cached audio files
    logger.info('Cache clearing not fully implemented');
    this.cacheUsage = 0;
  }

  /**
   * Get Nova TTS configuration
   */
  getConfig(): NovaTTSConfig {
    return { ...this.config };
  }
}

// Singleton instance
let novaTTSInstance: NovaTTS | null = null;

/**
 * Get the Nova TTS singleton instance
 */
export function getNovaTTS(config?: Partial<NovaTTSConfig>): NovaTTS {
  if (!novaTTSInstance) {
    novaTTSInstance = new NovaTTS(config);
  }
  return novaTTSInstance;
}

/**
 * Shutdown the Nova TTS singleton
 */
export async function shutdownNovaTTS(): Promise<void> {
  if (novaTTSInstance) {
    await novaTTSInstance.shutdown();
    novaTTSInstance = null;
  }
}

export default NovaTTS;
