/**
 * NovaVoice - Plugin Architecture
 * Extensible plugin system for custom STT, TTS, VAD, and audio processors
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { AudioChunk, AudioFormat, StreamingTranscription, TTSSynthesisResult } from './types';

// Type aliases for backward compatibility
type TranscriptionResult = StreamingTranscription;
type SynthesisResult = TTSSynthesisResult;

const logger = createModuleLogger('NovaVoice-Plugins');

// ============================================
// Plugin Types
// ============================================

export type PluginType = 'stt' | 'tts' | 'vad' | 'audio-processor' | 'post-processor' | 'middleware';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description: string;
  author: string;
  license: string;
  dependencies?: string[];
  config?: PluginConfigSchema;
}

export interface PluginConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    default?: unknown;
    required?: boolean;
    min?: number;
    max?: number;
    enum?: unknown[];
  };
}

export interface PluginContext {
  config: Record<string, unknown>;
  logger: ReturnType<typeof createModuleLogger>;
  getPlugin: (id: string) => Plugin | undefined;
  emitEvent: (event: string, data: unknown) => void;
}

// ============================================
// Plugin Base Interface
// ============================================

export interface Plugin {
  readonly metadata: PluginMetadata;
  
  initialize(context: PluginContext): Promise<void>;
  shutdown(): Promise<void>;
  
  isReady(): boolean;
  getConfig(): Record<string, unknown>;
  setConfig(config: Record<string, unknown>): void;
}

// ============================================
// STT Plugin
// ============================================

export interface STTPlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'stt' };
  
  transcribe(audio: AudioChunk): Promise<TranscriptionResult>;
  transcribeStreaming(audio: AudioChunk): AsyncGenerator<TranscriptionResult>;
  
  getSupportedLanguages(): string[];
  setLanguage(language: string): void;
}

// ============================================
// TTS Plugin
// ============================================

export interface TTSPlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'tts' };
  
  synthesize(text: string, options?: TTSSynthesisOptions): Promise<SynthesisResult>;
  synthesizeStreaming(text: string, options?: TTSSynthesisOptions): AsyncGenerator<AudioChunk>;
  
  getVoices(): TTSVoice[];
  setVoice(voiceId: string): void;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  style?: string;
}

export interface TTSSynthesisOptions {
  voice?: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  style?: string;
}

// ============================================
// VAD Plugin
// ============================================

export interface VADPlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'vad' };
  
  processFrame(audio: Float32Array): VADResult;
  reset(): void;
  
  setSensitivity(sensitivity: number): void;
  setThreshold(threshold: number): void;
}

export interface VADResult {
  isSpeech: boolean;
  probability: number;
  timestamp: number;
}

// ============================================
// Audio Processor Plugin
// ============================================

export interface AudioProcessorPlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'audio-processor' };
  
  process(audio: AudioChunk): AudioChunk | Promise<AudioChunk>;
  getLatency(): number;
}

// ============================================
// Post-Processor Plugin (for text)
// ============================================

export interface PostProcessorPlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'post-processor' };
  
  processTranscription(result: TranscriptionResult): TranscriptionResult;
  processTTSInput(text: string): string;
}

// ============================================
// Middleware Plugin
// ============================================

export interface MiddlewarePlugin extends Plugin {
  readonly metadata: PluginMetadata & { type: 'middleware' };
  
  onAudioInput?(audio: AudioChunk): AudioChunk | null;
  onVADResult?(result: VADResult): VADResult | null;
  onSTTResult?(result: TranscriptionResult): TranscriptionResult | null;
  onTTSInput?(text: string): string | null;
  onTTSOutput?(audio: AudioChunk): AudioChunk | null;
}

// ============================================
// Plugin Manager
// ============================================

export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private pluginsByType: Map<PluginType, Set<string>> = new Map();
  private activeSTT: string | null = null;
  private activeTTS: string | null = null;
  private activeVAD: string | null = null;
  private context: PluginContext;
  
  constructor() {
    super();
    
    // Initialize type maps
    const types: PluginType[] = ['stt', 'tts', 'vad', 'audio-processor', 'post-processor', 'middleware'];
    for (const type of types) {
      this.pluginsByType.set(type, new Set());
    }
    
    // Create plugin context
    this.context = {
      config: {},
      logger: createModuleLogger('Plugin'),
      getPlugin: (id) => this.plugins.get(id),
      emitEvent: (event, data) => this.emit(`plugin:${event}`, data),
    };
  }
  
  /**
   * Register a plugin
   */
  async register(plugin: Plugin): Promise<void> {
    const { id, type, name, dependencies } = plugin.metadata;
    
    // Check for duplicates
    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already registered`);
    }
    
    // Check dependencies
    if (dependencies) {
      for (const dep of dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${id} depends on ${dep}, which is not registered`);
        }
      }
    }
    
    // Initialize plugin
    const pluginContext = {
      ...this.context,
      logger: createModuleLogger(`Plugin:${name}`),
    };
    
    await plugin.initialize(pluginContext);
    
    // Register
    this.plugins.set(id, plugin);
    this.pluginsByType.get(type)?.add(id);
    
    logger.info('Plugin registered', { id, type, name });
    this.emit('plugin:registered', { id, type, name });
    
    // Auto-activate if first of type
    if (type === 'stt' && !this.activeSTT) {
      this.activeSTT = id;
    } else if (type === 'tts' && !this.activeTTS) {
      this.activeTTS = id;
    } else if (type === 'vad' && !this.activeVAD) {
      this.activeVAD = id;
    }
  }
  
  /**
   * Unregister a plugin
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    // Check if other plugins depend on this
    for (const [id, p] of this.plugins) {
      if (p.metadata.dependencies?.includes(pluginId)) {
        throw new Error(`Cannot unregister ${pluginId}: plugin ${id} depends on it`);
      }
    }
    
    // Shutdown
    await plugin.shutdown();
    
    // Unregister
    const type = plugin.metadata.type;
    this.plugins.delete(pluginId);
    this.pluginsByType.get(type)?.delete(pluginId);
    
    // Update active plugins
    if (this.activeSTT === pluginId) {
      this.activeSTT = this.getFirstPluginOfType('stt');
    } else if (this.activeTTS === pluginId) {
      this.activeTTS = this.getFirstPluginOfType('tts');
    } else if (this.activeVAD === pluginId) {
      this.activeVAD = this.getFirstPluginOfType('vad');
    }
    
    logger.info('Plugin unregistered', { id: pluginId });
    this.emit('plugin:unregistered', { id: pluginId });
  }
  
  /**
   * Get plugin by ID
   */
  get<T extends Plugin>(pluginId: string): T | undefined {
    return this.plugins.get(pluginId) as T | undefined;
  }
  
  /**
   * Get all plugins of a type
   */
  getPluginsOfType<T extends Plugin>(type: PluginType): T[] {
    const ids = this.pluginsByType.get(type) || new Set();
    return Array.from(ids).map((id) => this.plugins.get(id) as T).filter(Boolean);
  }
  
  /**
   * Set active STT plugin
   */
  setActiveSTT(pluginId: string): void {
    if (!this.pluginsByType.get('stt')?.has(pluginId)) {
      throw new Error(`${pluginId} is not a registered STT plugin`);
    }
    this.activeSTT = pluginId;
    this.emit('active-stt-changed', pluginId);
  }
  
  /**
   * Set active TTS plugin
   */
  setActiveTTS(pluginId: string): void {
    if (!this.pluginsByType.get('tts')?.has(pluginId)) {
      throw new Error(`${pluginId} is not a registered TTS plugin`);
    }
    this.activeTTS = pluginId;
    this.emit('active-tts-changed', pluginId);
  }
  
  /**
   * Set active VAD plugin
   */
  setActiveVAD(pluginId: string): void {
    if (!this.pluginsByType.get('vad')?.has(pluginId)) {
      throw new Error(`${pluginId} is not a registered VAD plugin`);
    }
    this.activeVAD = pluginId;
    this.emit('active-vad-changed', pluginId);
  }
  
  /**
   * Get active STT plugin
   */
  getActiveSTT(): STTPlugin | undefined {
    return this.activeSTT ? this.get<STTPlugin>(this.activeSTT) : undefined;
  }
  
  /**
   * Get active TTS plugin
   */
  getActiveTTS(): TTSPlugin | undefined {
    return this.activeTTS ? this.get<TTSPlugin>(this.activeTTS) : undefined;
  }
  
  /**
   * Get active VAD plugin
   */
  getActiveVAD(): VADPlugin | undefined {
    return this.activeVAD ? this.get<VADPlugin>(this.activeVAD) : undefined;
  }
  
  /**
   * Get all audio processors (in order)
   */
  getAudioProcessors(): AudioProcessorPlugin[] {
    return this.getPluginsOfType<AudioProcessorPlugin>('audio-processor');
  }
  
  /**
   * Get all post-processors (in order)
   */
  getPostProcessors(): PostProcessorPlugin[] {
    return this.getPluginsOfType<PostProcessorPlugin>('post-processor');
  }
  
  /**
   * Get all middleware
   */
  getMiddleware(): MiddlewarePlugin[] {
    return this.getPluginsOfType<MiddlewarePlugin>('middleware');
  }
  
  /**
   * Process audio through processors pipeline
   */
  async processAudio(audio: AudioChunk): Promise<AudioChunk> {
    let result = audio;
    
    // Run through audio processors
    for (const processor of this.getAudioProcessors()) {
      result = await processor.process(result);
    }
    
    return result;
  }
  
  /**
   * Process transcription through post-processors
   */
  processTranscription(result: TranscriptionResult): TranscriptionResult {
    let processed = result;
    
    for (const postProcessor of this.getPostProcessors()) {
      processed = postProcessor.processTranscription(processed);
    }
    
    return processed;
  }
  
  /**
   * Run middleware on audio input
   */
  runMiddlewareOnAudioInput(audio: AudioChunk): AudioChunk | null {
    let result: AudioChunk | null = audio;
    
    for (const middleware of this.getMiddleware()) {
      if (middleware.onAudioInput && result) {
        result = middleware.onAudioInput(result);
      }
    }
    
    return result;
  }
  
  /**
   * List all registered plugins
   */
  listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }
  
  /**
   * Shutdown all plugins
   */
  async shutdownAll(): Promise<void> {
    const errors: Error[] = [];
    
    for (const [id, plugin] of this.plugins) {
      try {
        await plugin.shutdown();
        logger.info('Plugin shutdown', { id });
      } catch (error) {
        errors.push(error as Error);
        logger.error('Plugin shutdown failed', { id, error });
      }
    }
    
    this.plugins.clear();
    for (const set of this.pluginsByType.values()) {
      set.clear();
    }
    
    if (errors.length > 0) {
      throw new Error(`${errors.length} plugins failed to shutdown`);
    }
  }
  
  private getFirstPluginOfType(type: PluginType): string | null {
    const ids = this.pluginsByType.get(type);
    return ids && ids.size > 0 ? Array.from(ids)[0] : null;
  }
}

// ============================================
// Plugin Base Class
// ============================================

export abstract class BasePlugin implements Plugin {
  abstract readonly metadata: PluginMetadata;
  
  protected context!: PluginContext;
  protected config: Record<string, unknown> = {};
  protected ready = false;
  
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    
    // Apply default config
    if (this.metadata.config) {
      for (const [key, schema] of Object.entries(this.metadata.config)) {
        if (schema.default !== undefined) {
          this.config[key] = schema.default;
        }
      }
    }
    
    // Override with provided config
    Object.assign(this.config, context.config);
    
    await this.onInitialize();
    this.ready = true;
  }
  
  async shutdown(): Promise<void> {
    this.ready = false;
    await this.onShutdown();
  }
  
  isReady(): boolean {
    return this.ready;
  }
  
  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }
  
  setConfig(config: Record<string, unknown>): void {
    // Validate config
    if (this.metadata.config) {
      for (const [key, value] of Object.entries(config)) {
        const schema = this.metadata.config[key];
        if (!schema) continue;
        
        // Type validation
        if (typeof value !== schema.type && !Array.isArray(value)) {
          throw new Error(`Config ${key} must be of type ${schema.type}`);
        }
        
        // Range validation
        if (typeof value === 'number') {
          if (schema.min !== undefined && value < schema.min) {
            throw new Error(`Config ${key} must be >= ${schema.min}`);
          }
          if (schema.max !== undefined && value > schema.max) {
            throw new Error(`Config ${key} must be <= ${schema.max}`);
          }
        }
        
        // Enum validation
        if (schema.enum && !schema.enum.includes(value)) {
          throw new Error(`Config ${key} must be one of: ${schema.enum.join(', ')}`);
        }
      }
    }
    
    Object.assign(this.config, config);
    this.onConfigChange();
  }
  
  protected abstract onInitialize(): Promise<void>;
  protected abstract onShutdown(): Promise<void>;
  protected onConfigChange(): void {}
}

// ============================================
// Example Plugin: OpenAI Whisper STT
// ============================================

export class OpenAIWhisperPlugin extends BasePlugin implements STTPlugin {
  readonly metadata: PluginMetadata & { type: 'stt' } = {
    id: 'openai-whisper',
    name: 'OpenAI Whisper',
    version: '1.0.0',
    type: 'stt',
    description: 'OpenAI Whisper API for speech-to-text',
    author: 'Nova',
    license: 'MIT',
    config: {
      apiKey: { type: 'string', description: 'OpenAI API key', required: true },
      model: { type: 'string', description: 'Whisper model', default: 'whisper-1' },
      language: { type: 'string', description: 'Language code', default: 'en' },
    },
  };
  
  private language = 'en';
  
  protected async onInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }
  
  protected async onShutdown(): Promise<void> {}
  
  async transcribe(audio: AudioChunk): Promise<TranscriptionResult> {
    // Would call OpenAI Whisper API here
    throw new Error('Not implemented - requires OpenAI API key');
  }
  
  async *transcribeStreaming(audio: AudioChunk): AsyncGenerator<TranscriptionResult> {
    // Whisper API doesn't support true streaming
    yield await this.transcribe(audio);
  }
  
  getSupportedLanguages(): string[] {
    return ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
  }
  
  setLanguage(language: string): void {
    this.language = language;
  }
}

// ============================================
// Example Plugin: ElevenLabs TTS
// ============================================

export class ElevenLabsTTSPlugin extends BasePlugin implements TTSPlugin {
  readonly metadata: PluginMetadata & { type: 'tts' } = {
    id: 'elevenlabs-tts',
    name: 'ElevenLabs TTS',
    version: '1.0.0',
    type: 'tts',
    description: 'ElevenLabs API for text-to-speech',
    author: 'Nova',
    license: 'MIT',
    config: {
      apiKey: { type: 'string', description: 'ElevenLabs API key', required: true },
      voiceId: { type: 'string', description: 'Default voice ID', default: 'EXAVITQu4vr4xnSDxMaL' },
      stability: { type: 'number', description: 'Voice stability', default: 0.5, min: 0, max: 1 },
      similarity: { type: 'number', description: 'Similarity boost', default: 0.75, min: 0, max: 1 },
    },
  };
  
  private currentVoice = 'EXAVITQu4vr4xnSDxMaL';
  
  protected async onInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error('ElevenLabs API key is required');
    }
  }
  
  protected async onShutdown(): Promise<void> {}
  
  async synthesize(text: string, options?: TTSSynthesisOptions): Promise<SynthesisResult> {
    // Would call ElevenLabs API here
    throw new Error('Not implemented - requires ElevenLabs API key');
  }
  
  // eslint-disable-next-line require-yield
  async *synthesizeStreaming(text: string, options?: TTSSynthesisOptions): AsyncGenerator<AudioChunk> {
    // Would stream from ElevenLabs API
    throw new Error('Not implemented - requires ElevenLabs API key');
  }
  
  getVoices(): TTSVoice[] {
    // Would fetch from ElevenLabs API
    return [
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', language: 'en', gender: 'female' },
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', language: 'en', gender: 'female' },
      { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', language: 'en', gender: 'female' },
    ];
  }
  
  setVoice(voiceId: string): void {
    this.currentVoice = voiceId;
  }
}

// ============================================
// Exports
// ============================================

export const pluginManager = new PluginManager();
