/**
 * Atlas Desktop - Voice Pipeline Integration
 * Complete voice interaction orchestrator that connects:
 * AudioPipeline (Wake Word + VAD) → STT → LLM → TTS
 *
 * Provides a unified interface for voice interactions with:
 * - Streaming transcription
 * - Streaming LLM responses
 * - Streaming TTS playback
 * - Barge-in support
 * - Conversation context management
 *
 * SECURITY: Integrates InputValidator for prompt injection defense
 */

import { EventEmitter } from 'events';
import { createModuleLogger, PerformanceTimer } from '../utils/logger';
import { AudioPipeline, getAudioPipeline, shutdownAudioPipeline, PipelineConfig } from './pipeline';
import { STTManager, STTManagerConfig, STTProviderType } from '../stt/manager';
import { LLMManager, LLMManagerConfig, LLMProviderType } from '../llm/manager';
import { TTSManager, getTTSManager } from '../tts/manager';
import { getConfig } from '../config';
import { MemoryManager, getMemoryManager } from '../memory';
import { getConversationMemory, ConversationMemory } from '../memory/conversation-memory';
import { JarvisBrain, getJarvisBrain } from '../cognitive';
import {
  VoicePipelineState,
  VoicePipelineStatus,
  WakeWordEvent,
  SpeechSegment,
  ContinuousListeningMode,
  ContinuousListeningConfig,
  ContinuousListeningState,
  VoiceCommandResult,
  DEFAULT_CONTINUOUS_LISTENING_CONFIG,
} from '../../shared/types/voice';
import { TranscriptionResult, STTStatus } from '../../shared/types/stt';
import {
  LLMResponse,
  LLMStreamChunk,
  ConversationContext,
  createConversationContext,
  ATLAS_SYSTEM_PROMPT,
  ToolCall,
  ChatMessage,
} from '../../shared/types/llm';
import { TTSAudioChunk, TTSSynthesisResult } from '../../shared/types/tts';
import { Agent, initializeAgent, ActionResult } from '../agent';
import {
  getVoiceToolDefinitions,
  parseToolCalls,
  formatToolResult,
  summarizeToolResultForVoice,
  ParsedToolCall,
  ToolExecutionResult,
} from '../agent/llm-tools';
import { getInputValidator, InputValidator } from '../security/input-validator';
import { getAuditLogger, AuditLogger } from '../security/audit-logger';
import { recordInteraction, getMetricsCollector } from '../gepa';
import { getEmotionDetector, EmotionDetector, EmotionState } from '../intelligence/emotion-detector';
import { getTradingContextForLLM } from '../trading';
import { getToolPrewarmer, type ConversationContext as PrewarmerContext } from '../ml/tool-prewarmer';
import { getBrowserVoiceIntegrator } from '../agent/browser-agent/voice-integration';
import { getPersonalityContextBuilder, PersonalityContextBuilder } from '../personality/personality-context-builder';
import { getNaturalVoiceIntegration, NaturalVoiceIntegration } from './natural-voice-integration';
import { getProsodyAnalyzer, ProsodyAnalyzer, ProsodyEmotionSignal } from './prosody';

const logger = createModuleLogger('VoicePipeline');
const perfTimer = new PerformanceTimer('VoicePipeline');

/**
 * Voice Pipeline configuration
 */
export interface VoicePipelineConfig {
  /** Audio pipeline config */
  audio?: Partial<PipelineConfig>;
  /** STT manager config */
  stt?: Partial<STTManagerConfig>;
  /** LLM manager config */
  llm?: Partial<LLMManagerConfig>;
  /** Enable streaming LLM responses to TTS */
  streamToTTS?: boolean;
  /** Minimum characters before sending to TTS (for streaming) */
  ttsBufferSize?: number;
  /** User name for conversation context */
  userName?: string;
  /** Enable conversation history */
  enableHistory?: boolean;
  /** Maximum conversation turns to keep */
  maxHistoryTurns?: number;
  /** Enable agent tools for voice commands */
  enableTools?: boolean;
  /** Maximum tool execution iterations per interaction */
  maxToolIterations?: number;
  /** Enable input validation and prompt injection defense */
  enableInputValidation?: boolean;
  /** Block input on detected threats (vs just log) */
  blockOnThreat?: boolean;
  /**
   * Enable early LLM processing with partial transcripts (experimental)
   * When enabled, starts LLM processing with interim transcripts for lower latency
   * May result in incomplete understanding if speech continues
   */
  enablePartialTranscriptProcessing?: boolean;
  /**
   * Minimum confidence for partial transcript processing
   * Only used when enablePartialTranscriptProcessing is true
   */
  partialTranscriptMinConfidence?: number;
  /**
   * Minimum word count before processing partial transcript
   * Prevents processing very short phrases that may be incomplete
   */
  partialTranscriptMinWords?: number;
  /**
   * Continuous listening mode configuration
   * Enables hands-free conversation by auto-listening after responses
   */
  continuousListening?: Partial<ContinuousListeningConfig>;
}

/**
 * Default Voice Pipeline configuration
 */
const DEFAULT_VOICE_PIPELINE_CONFIG: Required<VoicePipelineConfig> = {
  audio: {},
  stt: {},
  llm: {},
  streamToTTS: true,
  ttsBufferSize: 15, // Ultra-low latency - start TTS on short phrases
  userName: 'User',
  enableHistory: true,
  maxHistoryTurns: 10,
  enableTools: true,
  maxToolIterations: 5,
  enableInputValidation: true,
  blockOnThreat: true,
  enablePartialTranscriptProcessing: false, // Experimental - disabled by default
  partialTranscriptMinConfidence: 0.8, // High confidence required
  partialTranscriptMinWords: 5, // Minimum words before processing partial
  continuousListening: DEFAULT_CONTINUOUS_LISTENING_CONFIG,
};

/**
 * Voice Pipeline events
 */
export interface VoicePipelineEvents {
  /** Pipeline state changed */
  'state-change': (state: VoicePipelineState, previousState: VoicePipelineState) => void;
  /** Wake word detected */
  'wake-word': (event: WakeWordEvent) => void;
  /** Speech started */
  'speech-start': () => void;
  /** Speech ended */
  'speech-end': (duration: number) => void;
  /** Interim transcription */
  'transcript-interim': (text: string) => void;
  /** Final transcription */
  'transcript-final': (result: TranscriptionResult) => void;
  /** LLM response started */
  'response-start': () => void;
  /** LLM response chunk */
  'response-chunk': (chunk: LLMStreamChunk) => void;
  /** LLM response complete */
  'response-complete': (response: LLMResponse) => void;
  /** TTS audio chunk */
  'audio-chunk': (chunk: TTSAudioChunk) => void;
  /** TTS synthesis complete */
  'synthesis-complete': (result: TTSSynthesisResult) => void;
  /** Speaking started */
  'speaking-start': () => void;
  /** Speaking ended */
  'speaking-end': () => void;
  /** Barge-in detected */
  'barge-in': () => void;
  /** Audio level update */
  'audio-level': (level: number) => void;
  /** Error occurred */
  error: (error: Error, component: string) => void;
  /** Pipeline started */
  started: () => void;
  /** Pipeline stopped */
  stopped: () => void;
  /** Provider changed */
  'provider-change': (type: 'stt' | 'llm', provider: string) => void;
  /** Tool execution started */
  'tool-start': (toolName: string, params: Record<string, unknown>) => void;
  /** Tool execution completed */
  'tool-complete': (toolName: string, result: ActionResult) => void;
  /** Tool execution failed */
  'tool-error': (toolName: string, error: Error) => void;
  /** Security threat detected in input */
  'security-threat': (threats: Array<{ type: string; description: string }>) => void;
  /** Input blocked due to security threat */
  'input-blocked': (reason: string, originalInput: string) => void;
  /** User emotion detected from transcript */
  'emotion-detected': (emotion: EmotionState) => void;
  /** Streaming metrics available after interaction */
  'streaming-metrics': (metrics: StreamingMetrics) => void;
  /** Sentence chunk sent to TTS */
  'sentence-chunk': (text: string, latencyMs: number) => void;
  /** Continuous listening mode changed */
  'continuous-mode-change': (
    mode: ContinuousListeningMode,
    previousMode: ContinuousListeningMode
  ) => void;
  /** Continuous listening activated */
  'continuous-activated': (reason: 'voice_command' | 'api' | 'config') => void;
  /** Continuous listening deactivated */
  'continuous-deactivated': (reason: 'voice_command' | 'api' | 'timeout' | 'auto_disable') => void;
  /** Continuous mode timeout warning */
  'continuous-timeout-warning': (timeRemainingMs: number) => void;
  /** Continuous mode timeout occurred */
  'continuous-timeout': (consecutiveCount: number) => void;
  /** Continuous mode state update */
  'continuous-state-update': (state: ContinuousListeningState) => void;
  /** Voice command detected in transcript */
  'voice-command-detected': (result: VoiceCommandResult) => void;
}

/**
 * Interaction metrics
 */
export interface InteractionMetrics {
  /** Total interaction time (ms) */
  totalTime: number;
  /** Time from wake word to STT start */
  wakeToSttTime: number;
  /** STT processing time */
  sttTime: number;
  /** LLM response time (first token) */
  llmFirstTokenTime: number;
  /** LLM total response time */
  llmTotalTime: number;
  /** TTS first audio time */
  ttsFirstAudioTime: number;
  /** Total words transcribed */
  wordsTranscribed: number;
  /** Total response words */
  responseWords: number;
}

/**
 * Pipeline streaming metrics for latency optimization
 * Target: <500ms to first audio output after speech ends
 */
export interface StreamingMetrics {
  /** Time from speech end to first LLM token (ms) */
  speechEndToFirstToken: number;
  /** Time from first LLM token to first TTS audio (ms) */
  firstTokenToFirstAudio: number;
  /** Time from speech end to first TTS audio (ms) - primary metric */
  timeToFirstByte: number;
  /** End-to-end latency from speech end to response complete (ms) */
  endToEndLatency: number;
  /** Number of sentence chunks streamed to TTS */
  sentenceChunks: number;
  /** Average sentence chunk latency (ms) */
  avgChunkLatency: number;
  /** Whether target latency was met (<500ms TTFB) */
  targetMet: boolean;
}

/**
 * Sentence boundary detector for streaming LLM-to-TTS
 * Detects natural sentence and clause boundaries for optimal TTS chunking
 * 
 * Enhanced with adaptive chunking:
 * - Early flush for first response (faster TTFB)
 * - Clause-based boundaries for natural speech rhythm
 * - Dynamic thresholds based on speaking state
 */
export class SentenceBoundaryDetector {
  private buffer = '';
  private isFirstChunk = true;
  private chunkCount = 0;

  // Adaptive thresholds
  private readonly firstChunkMinLength = 5; // Very short for fast first audio
  private readonly minChunkLength = 8; // Allows short phrases after first
  private readonly maxChunkLength = 150; // Force flush sooner for streaming
  private readonly clauseMinLength = 12; // Minimum for clause-based chunking

  // Sentence-ending patterns (ordered by priority)
  private readonly sentenceEndings = [
    /([.!?])\s*$/, // Standard sentence endings with optional trailing space
    /([.!?])["')\]]*\s*$/, // Sentence endings with closing quotes/brackets
    /([;:])\s*$/, // Semi-colon/colon as natural pause points
    /(,)\s+(?=[A-Z])/, // Comma followed by capital letter (likely new clause)
  ];

  // Clause boundaries for more natural speech chunking
  private readonly clauseBoundaries = [
    /,\s+(?:and|but|or|so|because|although|however|therefore|meanwhile)\s+/i,
    /,\s+(?:which|who|that|where|when)\s+/i, // Relative clauses
    /\s+-\s+/, // Dash as pause
    /\s+—\s+/, // Em-dash
  ];

  // Phrase-ending patterns for early flush on first chunk
  private readonly phraseEndings = [
    /,\s*$/, // Any comma
    /:\s*$/, // Colon
    /\s+and\s*$/i, // "and" at end
    /\s+but\s*$/i, // "but" at end
    /\s+or\s*$/i, // "or" at end
  ];

  /**
   * Add text to buffer and return any complete sentences/clauses
   * @param text - New text to add
   * @returns Array of complete chunks ready for TTS
   */
  addText(text: string): string[] {
    this.buffer += text;
    const chunks: string[] = [];

    // Adaptive minimum based on whether this is the first chunk
    const effectiveMin = this.isFirstChunk ? this.firstChunkMinLength : this.minChunkLength;

    // Keep extracting while we have enough text
    while (this.buffer.length >= effectiveMin) {
      let boundary = 0;

      // For first chunk, be more aggressive about early flush
      if (this.isFirstChunk && this.buffer.length >= this.firstChunkMinLength) {
        // Look for phrase endings first for fast TTFB
        boundary = this.findPhraseBoundary();

        // If we have a reasonable amount of text, just send it
        if (boundary === 0 && this.buffer.length >= 15) {
          boundary = this.findWordBoundary(15);
        }
      }

      // Standard boundary detection
      if (boundary === 0) {
        boundary = this.findSentenceBoundary();
      }

      // Try clause boundaries for natural rhythm
      if (boundary === 0 && this.buffer.length >= this.clauseMinLength) {
        boundary = this.findClauseBoundary();
      }

      // Force flush at word boundary if buffer is too long
      if (boundary === 0 && this.buffer.length >= this.maxChunkLength) {
        boundary = this.findWordBoundary(this.maxChunkLength);
      }

      if (boundary > 0) {
        const chunk = this.buffer.substring(0, boundary).trim();
        this.buffer = this.buffer.substring(boundary).trimStart();

        if (chunk.length > 0) {
          chunks.push(chunk);
          this.chunkCount++;
          this.isFirstChunk = false;
        }
      } else {
        // Not enough text for a complete chunk yet
        break;
      }
    }

    return chunks;
  }

  /**
   * Find phrase boundary for fast first audio
   */
  private findPhraseBoundary(): number {
    for (const pattern of this.phraseEndings) {
      const match = this.buffer.match(pattern);
      if (match && match.index !== undefined) {
        return match.index + match[0].length;
      }
    }
    return 0;
  }

  /**
   * Find sentence boundary
   */
  private findSentenceBoundary(): number {
    for (const pattern of this.sentenceEndings) {
      const match = this.buffer.match(pattern);
      if (match && match.index !== undefined) {
        return match.index + match[0].length;
      }
    }
    return 0;
  }

  /**
   * Find clause boundary for natural speech rhythm
   */
  private findClauseBoundary(): number {
    for (const pattern of this.clauseBoundaries) {
      const match = this.buffer.match(pattern);
      if (match && match.index !== undefined && match.index >= this.clauseMinLength) {
        // Include the conjunction/relative pronoun with the next clause
        return match.index + 1; // Just after the comma
      }
    }
    return 0;
  }

  /**
   * Find the nearest word boundary before maxPos
   * @param maxPos - Maximum position to look for boundary
   * @returns Position of word boundary
   */
  private findWordBoundary(maxPos: number): number {
    const searchArea = this.buffer.substring(0, maxPos);
    const lastSpace = searchArea.lastIndexOf(' ');
    return lastSpace > 0 ? lastSpace + 1 : maxPos;
  }

  /**
   * Flush any remaining text in the buffer
   * @returns Remaining text or empty string
   */
  flush(): string {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.buffer = '';
    this.isFirstChunk = true;
    this.chunkCount = 0;
  }

  /**
   * Get current buffer contents (for debugging)
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Get chunking statistics
   */
  getStats(): { chunkCount: number; isFirstChunk: boolean; bufferLength: number } {
    return {
      chunkCount: this.chunkCount,
      isFirstChunk: this.isFirstChunk,
      bufferLength: this.buffer.length,
    };
  }
}

/**
 * Voice Pipeline
 * Complete voice interaction orchestrator
 */
export class VoicePipeline extends EventEmitter {
  private config: Required<VoicePipelineConfig>;

  // Components
  private audioPipeline: AudioPipeline | null = null;
  private sttManager: STTManager | null = null;
  private llmManager: LLMManager | null = null;
  private tts: TTSManager | null = null;
  private memoryManager: MemoryManager | null = null;
  private agent: Agent | null = null;
  private inputValidator: InputValidator | null = null;
  private auditLogger: AuditLogger | null = null;
  private conversationMemory: ConversationMemory | null = null;
  private jarvisBrain: JarvisBrain | null = null;
  private emotionDetector: EmotionDetector | null = null;
  private personalityContextBuilder: PersonalityContextBuilder | null = null;
  private naturalVoice: NaturalVoiceIntegration | null = null;
  private prosodyAnalyzer: ProsodyAnalyzer | null = null;
  private currentVoiceEmotion: ProsodyEmotionSignal | null = null;

  // State
  private isRunning = false;
  private currentState: VoicePipelineState = 'idle';
  private conversationContext: ConversationContext | null = null;
  private sessionId: string = '';
  private currentUserEmotion: EmotionState | null = null;

  // Current interaction tracking
  private currentTranscript = '';
  private currentResponse = '';
  private ttsBuffer = '';
  private interactionStartTime = 0;
  private metrics: Partial<InteractionMetrics> = {};

  // Streaming optimization state
  private streamingMetrics: Partial<StreamingMetrics> = {};
  private sentenceDetector: SentenceBoundaryDetector = new SentenceBoundaryDetector();
  private speechEndTime = 0;
  private firstTokenTime = 0;
  private firstAudioTime = 0;
  private chunkLatencies: number[] = [];
  private sentenceChunkCount = 0;

  // Tool tracking for pre-warming
  private recentToolCalls: string[] = [];
  private readonly maxRecentToolCalls = 10;

  // Skip TTS for text-only interactions (when user types instead of speaks)
  private skipTTSForCurrentInteraction = false;

  // Continuous listening state
  private continuousMode: ContinuousListeningMode = 'disabled';
  private continuousConfig: ContinuousListeningConfig;
  private continuousSilenceTimer: NodeJS.Timeout | null = null;
  private continuousWarningTimer: NodeJS.Timeout | null = null;
  private continuousActivatedAt = 0;
  private continuousInteractionCount = 0;
  private consecutiveTimeouts = 0;
  private continuousSilenceStartTime = 0;

  constructor(config?: Partial<VoicePipelineConfig>) {
    super();
    this.setMaxListeners(20); // Prevent memory leak warnings
    this.config = { ...DEFAULT_VOICE_PIPELINE_CONFIG, ...config } as Required<VoicePipelineConfig>;

    // Merge continuous listening config with defaults
    this.continuousConfig = {
      ...DEFAULT_CONTINUOUS_LISTENING_CONFIG,
      ...(config?.continuousListening || {}),
    };

    // Generate a unique session ID
    this.sessionId = `voice-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    logger.info('VoicePipeline created', {
      streamToTTS: this.config.streamToTTS,
      enableHistory: this.config.enableHistory,
      enableInputValidation: this.config.enableInputValidation,
      continuousListening: this.continuousConfig.enabled,
      sessionId: this.sessionId,
    });
  }

  /**
   * Gets the current state of the voice pipeline.
   *
   * @returns The current pipeline state: 'idle', 'listening', 'processing', or 'speaking'
   *
   * @example
   * ```typescript
   * const pipeline = getVoicePipeline();
   * if (pipeline.state === 'idle') {
   *   console.log('Ready for voice input');
   * }
   * ```
   */
  get state(): VoicePipelineState {
    return this.currentState;
  }

  /**
   * Gets the complete status of the voice pipeline including provider information.
   *
   * @returns An object containing the pipeline state, active providers, and current transcription/response
   *
   * @example
   * ```typescript
   * const status = pipeline.getStatus();
   * console.log(`State: ${status.state}`);
   * console.log(`STT Provider: ${status.sttProvider}`);
   * console.log(`Current transcript: ${status.currentTranscript}`);
   * ```
   */
  getStatus(): VoicePipelineStatus & {
    sttProvider: STTProviderType | null;
    llmProvider: LLMProviderType | null;
    isTTSSpeaking: boolean;
    currentTranscript: string;
    currentResponse: string;
    currentEmotion: EmotionState | null;
  } {
    return {
      state: this.currentState,
      isListening: this.currentState === 'listening',
      isSpeaking: this.currentState === 'speaking',
      audioLevel: 0, // Updated via events
      sttProvider: this.sttManager?.getActiveProviderType() ?? null,
      llmProvider: this.llmManager?.getActiveProviderType() ?? null,
      isTTSSpeaking: this.tts?.isSpeaking() ?? false,
      currentTranscript: this.currentTranscript,
      currentResponse: this.currentResponse,
      currentEmotion: this.currentUserEmotion,
    };
  }

  /**
   * Gets the current detected user emotion.
   * @returns The current emotion state or null if no emotion has been detected
   */
  getCurrentEmotion(): EmotionState | null {
    return this.currentUserEmotion;
  }

  /**
   * Checks if the pipeline is currently running.
   *
   * @returns True if the pipeline has been started and is active
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Set state and emit event
   */
  private setState(newState: VoicePipelineState): void {
    if (this.currentState === newState) return;

    const previousState = this.currentState;
    this.currentState = newState;

    logger.info('Voice pipeline state changed', { from: previousState, to: newState });
    this.emit('state-change', newState, previousState);
  }

  /**
   * Initializes and starts all voice pipeline components.
   *
   * This method initializes the audio pipeline (wake word + VAD), STT manager,
   * LLM manager, TTS engine, memory manager, and agent tools. It connects all
   * components together and begins listening for wake words.
   *
   * @throws Error if any critical component fails to initialize
   *
   * @example
   * ```typescript
   * const pipeline = getVoicePipeline();
   * await pipeline.start();
   * console.log('Voice pipeline ready');
   * ```
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Voice pipeline already running');
      return;
    }

    try {
      logger.info('Starting voice pipeline...');
      perfTimer.start('startup');

      const appConfig = getConfig();

      // Initialize Audio Pipeline (Wake Word + VAD)
      this.audioPipeline = getAudioPipeline();
      this.audioPipeline.updateConfig(this.config.audio);
      this.setupAudioPipelineHandlers();

      // Initialize STT Manager
      this.sttManager = new STTManager({
        ...this.config.stt,
        deepgram: {
          apiKey: appConfig.deepgramApiKey,
          ...this.config.stt?.deepgram,
        },
      });
      this.setupSTTHandlers();

      // Initialize LLM Manager
      this.llmManager = new LLMManager({
        ...this.config.llm,
        fireworks: {
          apiKey: appConfig.fireworksApiKey,
          ...this.config.llm?.fireworks,
        },
        openrouter: {
          apiKey: appConfig.openrouterApiKey,
          ...this.config.llm?.openrouter,
        },
      });
      this.setupLLMHandlers();

      // Initialize TTS Manager - Using Cartesia (fastest ~90ms) with ElevenLabs and offline fallback
      this.tts = getTTSManager({
        cartesia: {
          apiKey: appConfig.cartesiaApiKey,
          voiceId: appConfig.cartesiaVoiceId,
        },
        elevenlabs: {
          apiKey: appConfig.elevenlabsApiKey,
        },
        preferredProvider: appConfig.cartesiaApiKey ? 'cartesia' : 'elevenlabs',
        preferOffline: false, // Use online providers when available
        autoFallback: true,   // Fall back to offline if all providers fail
      });
      this.setupTTSHandlers();

      logger.info('TTS initialized', {
        provider: this.tts.getCurrentProvider(),
        hasCartesiaKey: !!appConfig.cartesiaApiKey,
        hasElevenLabsKey: !!appConfig.elevenlabsApiKey,
      });

      // Initialize conversation context
      if (this.config.enableHistory) {
        this.conversationContext = createConversationContext(
          ATLAS_SYSTEM_PROMPT,
          this.config.userName
        );
      }

      // Initialize Memory Manager for persistent conversation storage
      this.memoryManager = await getMemoryManager();
      this.memoryManager.startSession({ device: 'desktop', startedAt: Date.now() });
      logger.info('Memory session started', {
        sessionId: this.memoryManager.getCurrentSessionId(),
      });

      // Initialize Conversation Memory for Obsidian vault storage
      this.conversationMemory = await getConversationMemory();
      logger.info('Conversation memory initialized for vault storage');

      // Initialize JARVIS Brain for cognitive learning and associations
      try {
        this.jarvisBrain = getJarvisBrain({ userFirstName: this.config.userName || 'Ben' });
        await this.jarvisBrain.initialize();
        logger.info('JARVIS Brain initialized', {
          stats: await this.jarvisBrain.getStats(),
        });
      } catch (brainError) {
        logger.warn('JARVIS Brain initialization failed, continuing without cognitive features', {
          error: (brainError as Error).message,
        });
        this.jarvisBrain = null;
      }

      // Initialize Agent for tool execution (if enabled)
      if (this.config.enableTools) {
        this.agent = await initializeAgent();
        logger.info('Agent initialized', { toolCount: this.agent.getTools().length });
      }

      // Initialize security components
      if (this.config.enableInputValidation) {
        this.inputValidator = getInputValidator({
          blockOnThreat: this.config.blockOnThreat,
          sanitizeInput: true,
          logAllValidations: false,
        });
        this.auditLogger = getAuditLogger();
        logger.info('Security components initialized', {
          inputValidation: true,
          blockOnThreat: this.config.blockOnThreat,
        });
      }

      // Initialize emotion detector for empathetic responses
      this.emotionDetector = getEmotionDetector();
      logger.info('Emotion detector initialized');

      // Initialize personality context builder for unified context aggregation
      this.personalityContextBuilder = getPersonalityContextBuilder();
      logger.info('Personality context builder initialized');

      // Initialize prosody analyzer for voice-based emotion detection
      this.prosodyAnalyzer = getProsodyAnalyzer();
      this.prosodyAnalyzer.on('emotion', (signal: ProsodyEmotionSignal) => {
        this.currentVoiceEmotion = signal;
        logger.debug('Voice prosody emotion detected', {
          type: signal.type,
          confidence: signal.confidence.toFixed(2),
          intensity: signal.intensity,
        });
      });
      this.prosodyAnalyzer.on('baseline-established', () => {
        logger.info('Prosody baseline established - voice emotion detection now calibrated');
      });
      logger.info('Prosody analyzer initialized', {
        baselineEstablished: this.prosodyAnalyzer.isBaselineEstablished(),
        baselineProgress: this.prosodyAnalyzer.getBaselineProgress().toFixed(0) + '%',
      });

      // Initialize natural voice integration for human-like speech
      this.naturalVoice = getNaturalVoiceIntegration(this.tts);
      logger.info('Natural voice integration initialized');

      // Connect audio pipeline to STT
      this.audioPipeline.setOnSpeechSegment((segment) => this.handleSpeechSegment(segment));
      this.audioPipeline.setOnBargeIn(() => this.handleBargeIn());

      // Start audio pipeline
      await this.audioPipeline.start();

      this.isRunning = true;
      this.setState('idle');

      const startupTime = perfTimer.end('startup');
      logger.info('Voice pipeline started', { startupTime });
      this.emit('started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start voice pipeline', { error: err.message });
      this.emit('error', err, 'startup');
      throw err;
    }
  }

  /**
   * Stops the voice pipeline and cleans up all resources.
   *
   * This method saves memory, stops TTS playback, cancels any pending LLM requests,
   * disconnects STT, and shuts down the audio pipeline. Safe to call multiple times.
   *
   * @example
   * ```typescript
   * await pipeline.stop();
   * console.log('Voice pipeline stopped');
   * ```
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping voice pipeline...');

    // Store conversation to Obsidian vault before shutdown
    if (this.conversationMemory) {
      try {
        const notePath = await this.conversationMemory.storeToVault();
        if (notePath) {
          logger.info('Conversation stored to Obsidian vault on stop', { notePath });
        }
      } catch (error) {
        logger.error('Failed to store conversation to vault on stop', {
          error: (error as Error).message,
        });
      }
    }

    // Shutdown JARVIS Brain gracefully
    if (this.jarvisBrain) {
      try {
        await this.jarvisBrain.shutdown();
        logger.info('JARVIS Brain shut down');
      } catch (error) {
        logger.error('Failed to shutdown JARVIS Brain', { error: (error as Error).message });
      }
      this.jarvisBrain = null;
    }

    // Save memory before shutdown
    if (this.memoryManager) {
      try {
        await this.memoryManager.save();
        logger.info('Memory saved on pipeline stop');
      } catch (error) {
        logger.error('Failed to save memory on stop', { error: (error as Error).message });
      }
    }

    // Stop TTS
    if (this.tts) {
      this.tts.stop();
      this.tts.removeAllListeners();
      this.tts = null;
    }

    // Stop LLM
    if (this.llmManager) {
      this.llmManager.cancel();
      this.llmManager.removeAllListeners();
      this.llmManager = null;
    }

    // Stop STT
    if (this.sttManager) {
      await this.sttManager.stop();
      this.sttManager.removeAllListeners();
      this.sttManager = null;
    }

    // Stop audio pipeline
    if (this.audioPipeline) {
      this.audioPipeline.removeAllListeners();
    }
    await shutdownAudioPipeline();
    this.audioPipeline = null;

    this.isRunning = false;
    this.setState('idle');

    logger.info('Voice pipeline stopped');
    this.emit('stopped');
  }

  /**
   * Send text directly to the LLM with full tool support.
   * This allows text chat to use the same tool loop as voice.
   * 
   * @param text - The text message to process
   * @param options - Options for processing
   * @param options.skipTTS - If true, skip text-to-speech output
   * @returns Promise that resolves when processing is complete
   * 
   * @example
   * ```typescript
   * await pipeline.sendText('Read the package.json file', { skipTTS: true });
   * ```
   */
  async sendText(text: string, options?: { skipTTS?: boolean }): Promise<void> {
    if (!text.trim()) {
      logger.warn('sendText called with empty text');
      return;
    }

    // Ensure pipeline components are initialized
    if (!this.llmManager) {
      logger.error('Cannot send text: LLM manager not initialized. Call start() first.');
      throw new Error('Voice pipeline not started. Call start() first.');
    }

    logger.info('[sendText] Processing text with tools', {
      textLength: text.length,
      skipTTS: options?.skipTTS
    });

    // Store original TTS config if we need to skip it
    const originalTts = this.tts;
    if (options?.skipTTS) {
      // Temporarily disable TTS for this request
      this.tts = null;
    }

    try {
      // Set the transcript and process through full LLM pipeline with tools
      this.currentTranscript = text;
      this.startInteraction();

      // Process through the tool-enabled LLM pipeline
      await this.processWithLLM(text);
    } finally {
      // Restore TTS
      if (options?.skipTTS) {
        this.tts = originalTts;
      }
    }
  }

  /**
   * Set up audio pipeline event handlers
   */
  private setupAudioPipelineHandlers(): void {
    if (!this.audioPipeline) return;

    this.audioPipeline.on('state-change', (state, _prev) => {
      // Sync state (but we manage our own state machine)
      if (state === 'listening') {
        this.startInteraction();
      }
    });

    this.audioPipeline.on('wake-word', (event) => {
      logger.info('Wake word detected', { keyword: event.keyword });
      this.emit('wake-word', event);
    });

    this.audioPipeline.on('speech-start', () => {
      this.emit('speech-start');

      // Pre-warm LLM connection when speech starts
      // This establishes TCP/TLS connection speculatively, saving 100-300ms
      // when the actual LLM request is made after transcription completes
      if (this.llmManager) {
        this.llmManager.preWarmConnection().catch((err) => {
          logger.debug('LLM pre-warm failed (non-critical)', { error: err.message });
        });
      }
    });

    this.audioPipeline.on('audio-level', (level) => {
      this.emit('audio-level', level);
    });

    this.audioPipeline.on('error', (error) => {
      logger.error('Audio pipeline error', { error: error.message });
      this.emit('error', error, 'audio');
    });

    this.audioPipeline.on('listening-timeout', () => {
      logger.warn('Listening timeout - resetting');
      this.resetInteraction();
    });
  }

  /**
   * Set up STT event handlers
   */
  private setupSTTHandlers(): void {
    if (!this.sttManager) return;

    this.sttManager.on('interim', (result: TranscriptionResult) => {
      this.currentTranscript = result.text;
      this.emit('transcript-interim', result.text);
    });

    this.sttManager.on('final', (result: TranscriptionResult) => {
      this.currentTranscript = result.text;
      this.metrics.sttTime = Date.now() - this.interactionStartTime;
      this.metrics.wordsTranscribed = result.text.split(/\s+/).length;

      // Record speech end time for streaming metrics
      this.speechEndTime = Date.now();

      logger.info('Final transcription', {
        text: result.text,
        confidence: result.confidence,
        sttTime: this.metrics.sttTime,
      });

      // Detect user emotion from transcript for empathetic responses
      if (this.emotionDetector && result.text.trim()) {
        this.currentUserEmotion = this.emotionDetector.detectEmotion(result.text);
        logger.info('User emotion detected', {
          emotion: this.currentUserEmotion.primary.type,
          intensity: this.currentUserEmotion.primary.intensity,
          confidence: this.currentUserEmotion.primary.confidence,
        });
        this.emit('emotion-detected', this.currentUserEmotion);
      }

      // Speak a quick acknowledgment backchannel while processing
      if (this.naturalVoice && this.tts && result.text.trim()) {
        const context = {
          emotion: this.currentUserEmotion || undefined,
          formality: 'casual' as const,
          timeOfDay: this.getTimeOfDay(),
        };

        // Only backchannel for longer requests that will take time to process
        if (result.text.split(/\s+/).length > 5) {
          this.naturalVoice.speakBackchannel('thinking', context).catch((err) => {
            logger.debug('Backchannel skipped', { error: (err as Error).message });
          });
        }
      }

      // Save user message to memory
      if (this.memoryManager && result.text.trim()) {
        this.memoryManager.addMessage({ role: 'user', content: result.text });
        logger.debug('User message saved to memory');
      }

      this.emit('transcript-final', result);
      this.emit('speech-end', result.duration || 0);

      // Send to LLM
      this.processWithLLM(result.text);
    });

    this.sttManager.on('error', (error: Error) => {
      logger.error('STT error', { error: error.message });
      this.emit('error', error, 'stt');
    });

    this.sttManager.on('provider-switch', (from, to, reason) => {
      logger.info('STT provider switched', { from, to, reason });
      this.emit('provider-change', 'stt', to);
    });
  }

  /**
   * Set up LLM event handlers
   */
  private setupLLMHandlers(): void {
    if (!this.llmManager) return;

    this.llmManager.on('provider-switch', (from, to, reason) => {
      logger.info('LLM provider switched', { from, to, reason });
      this.emit('provider-change', 'llm', to);
    });

    this.llmManager.on('error', (error: Error) => {
      logger.error('LLM error', { error: error.message });
      this.emit('error', error, 'llm');
    });
  }

  /**
   * Set up TTS event handlers
   */
  private setupTTSHandlers(): void {
    if (!this.tts) return;

    this.tts.on('chunk', (chunk: TTSAudioChunk) => {
      logger.debug('[VoicePipeline] Received TTS chunk', {
        dataLength: chunk.data?.length ?? 0,
        format: chunk.format,
        isFinal: chunk.isFinal,
      });
      if (!this.metrics.ttsFirstAudioTime && chunk.data.length > 0) {
        this.metrics.ttsFirstAudioTime = Date.now() - this.interactionStartTime;
      }
      this.emit('audio-chunk', chunk);
    });

    this.tts.on('playbackStart', () => {
      this.setState('speaking');
      this.audioPipeline?.startSpeaking();
      this.emit('speaking-start');
    });

    this.tts.on('playbackEnd', () => {
      this.finishSpeaking();
    });

    this.tts.on('synthesized', (result: TTSSynthesisResult) => {
      this.emit('synthesis-complete', result);
    });

    this.tts.on('interrupted', () => {
      logger.info('TTS interrupted');
    });

    this.tts.on('error', (error: Error) => {
      logger.error('TTS error', { error: error.message });
      this.emit('error', error, 'tts');
    });
  }

  /**
   * Connect trading system proactive messages to voice output.
   * Call this after the trading system is initialized.
   */
  connectTradingProactive(): void {
    try {
      // Import dynamically to avoid circular dependencies
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTradingSystem } = require('../trading');
      const tradingSystem = getTradingSystem();

      if (!tradingSystem.isReady()) {
        logger.debug('Trading system not ready, skipping proactive connection');
        return;
      }

      // Listen for proactive messages from trading system
      tradingSystem.on('proactive-message', async (message: { message: string; shouldSpeak: boolean; priority: string }) => {
        if (message.shouldSpeak) {
          const isHighPriority = ['urgent', 'high'].includes(message.priority);
          logger.info('Speaking trading proactive message', {
            priority: message.priority,
            messagePreview: message.message.substring(0, 50),
          });
          await this.speakProactive(message.message, {
            priority: isHighPriority ? 'high' : 'normal',
            interruptCurrent: message.priority === 'urgent',
          });
        }
      });

      logger.info('Connected trading proactive handler to voice pipeline');
    } catch (error) {
      // Trading system may not be available - that's fine
      logger.debug('Could not connect trading proactive handler', { error });
    }
  }

  /**
   * Handle speech segment from audio pipeline
   */
  private async handleSpeechSegment(segment: SpeechSegment): Promise<void> {
    logger.info('Processing speech segment', {
      duration: segment.duration,
      samples: segment.audio.length,
    });

    this.setState('processing');
    perfTimer.start('stt');

    try {
      // Convert Float32Array to Int16Array for STT
      const pcm16 = float32ToInt16(segment.audio);

      // Analyze prosody for voice-based emotion detection
      if (this.prosodyAnalyzer && pcm16.length > 0) {
        const voiceEmotion = this.prosodyAnalyzer.analyze(Buffer.from(pcm16.buffer));
        if (voiceEmotion) {
          this.currentVoiceEmotion = voiceEmotion;
          logger.debug('Voice prosody analyzed', {
            emotion: voiceEmotion.type,
            confidence: voiceEmotion.confidence.toFixed(2),
            intensity: voiceEmotion.intensity,
            baselineProgress: this.prosodyAnalyzer.getBaselineProgress().toFixed(0) + '%',
          });
        }
      }

      // Start STT if not already running
      if (this.sttManager && this.sttManager.status === STTStatus.IDLE) {
        await this.sttManager.start();
      }

      // Send audio to STT
      if (this.sttManager) {
        this.sttManager.sendAudio(pcm16);

        // DON'T call stop() immediately - wait for the transcript to arrive
        // through the 'final' event handler, which will then call processWithLLM.
        // The STT connection will be closed after processing completes in resetInteraction().
        // Set a timeout to handle cases where no transcript is received
        setTimeout(() => {
          if (this.state === 'processing' && this.sttManager) {
            logger.warn('STT transcript timeout - no response received');
            this.sttManager.stop().catch(() => { });
            this.resetInteraction();
          }
        }, 10000); // 10 second timeout for transcript
      }
    } catch (error) {
      perfTimer.end('stt');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Speech segment processing failed', { error: err.message });
      this.emit('error', err, 'stt');
      this.resetInteraction();
    }
  }

  /**
   * Process transcribed text with LLM
   */
  private async processWithLLM(text: string): Promise<void> {
    if (!text.trim()) {
      logger.warn(
        'Received empty transcription. No speech was detected or the audio was too quiet. Returning to idle state.'
      );
      this.resetInteraction();
      return;
    }

    if (!this.llmManager) {
      logger.error(
        'Cannot process speech: LLM manager is not initialized. Check your API keys configuration.'
      );
      this.resetInteraction();
      return;
    }

    // SECURITY: Validate input for prompt injection and other threats
    let processedText = text;
    if (this.config.enableInputValidation && this.inputValidator) {
      const validation = this.inputValidator.validateVoiceCommand(text, {
        sessionId: this.sessionId,
      });

      if (validation.threats.length > 0) {
        logger.warn('Security threats detected in voice input', {
          threatCount: validation.threats.length,
          threatLevel: validation.threatLevel,
          threats: validation.threats.map((t) => ({ type: t.type, description: t.description })),
        });

        // Emit security threat event
        this.emit(
          'security-threat',
          validation.threats.map((t) => ({ type: t.type, description: t.description }))
        );

        // Block if not safe and blocking is enabled
        if (!validation.safe && this.config.blockOnThreat) {
          logger.error('Voice input blocked due to security threat', {
            threatLevel: validation.threatLevel,
          });

          this.emit('input-blocked', `Security threat detected: ${validation.threatLevel}`, text);

          // Respond to user about the blocked input
          if (this.tts) {
            this.tts.speakWithAudioStream(
              "I'm sorry, but I detected a potential security issue with that request. Please try rephrasing your question."
            );
          }

          this.resetInteraction();
          return;
        }

        // Use sanitized input if threats were detected but not blocked
        processedText = validation.sanitized;
        logger.info('Using sanitized input after threat detection', {
          original: text.substring(0, 100),
          sanitized: processedText.substring(0, 100),
        });
      }
    }

    logger.info('Processing with LLM', { text: processedText });
    perfTimer.start('llm');
    this.emit('response-start');

    try {
      this.currentResponse = '';
      this.ttsBuffer = '';

      // Prepare context with memory history
      let contextToUse = this.conversationContext ?? undefined;

      // Build combined emotion context from text and voice prosody
      if (contextToUse && (this.currentUserEmotion || this.currentVoiceEmotion)) {
        let emotionContext = '\n\n[EMOTIONAL CONTEXT]';

        // Add text-based emotion detection
        if (this.emotionDetector && this.currentUserEmotion) {
          const emotionModifier = this.emotionDetector.getSystemPromptModifier();
          emotionContext += `\nText analysis: The user appears to be feeling ${this.currentUserEmotion.primary.type} (${this.currentUserEmotion.primary.intensity} intensity, ${Math.round(this.currentUserEmotion.primary.confidence * 100)}% confidence).\n${emotionModifier}`;
        }

        // Add voice prosody emotion detection
        if (this.prosodyAnalyzer && this.currentVoiceEmotion && this.currentVoiceEmotion.confidence > 0.5) {
          const prosodyModifier = this.prosodyAnalyzer.getSystemPromptModifier();
          emotionContext += `\nVoice prosody: ${this.currentVoiceEmotion.type} detected in speech patterns (${(this.currentVoiceEmotion.confidence * 100).toFixed(0)}% confidence, ${this.currentVoiceEmotion.intensity} intensity).`;
          emotionContext += `\nVoice indicators: ${this.currentVoiceEmotion.indicators.slice(0, 3).join(', ')}.`;
          if (prosodyModifier) {
            emotionContext += `\n${prosodyModifier}`;
          }
          emotionContext += `\nSuggested tone: ${this.currentVoiceEmotion.suggestedTone}.`;
        }

        // Combined guidance if both sources detected emotion
        if (this.currentUserEmotion && this.currentVoiceEmotion && this.currentVoiceEmotion.confidence > 0.5) {
          const textEmotion = this.currentUserEmotion.primary.type;
          const voiceEmotion = this.currentVoiceEmotion.type;
          if (textEmotion === voiceEmotion) {
            emotionContext += `\n[HIGH CONFIDENCE] Both text and voice indicate ${textEmotion}. Respond accordingly.`;
          } else if (textEmotion !== 'neutral' && voiceEmotion !== 'neutral') {
            emotionContext += `\n[MIXED SIGNALS] Text suggests ${textEmotion} but voice suggests ${voiceEmotion}. Trust voice prosody more for emotional state.`;
          }
        }

        contextToUse = {
          ...contextToUse,
          systemPrompt: contextToUse.systemPrompt + emotionContext,
        };
        logger.debug('Combined emotion context added to system prompt', {
          textEmotion: this.currentUserEmotion?.primary.type,
          voiceEmotion: this.currentVoiceEmotion?.type,
          voiceConfidence: this.currentVoiceEmotion?.confidence,
        });
      }

      // Inject trading context so Atlas knows its current trading state
      if (contextToUse) {
        try {
          const tradingContext = await getTradingContextForLLM();
          if (tradingContext) {
            contextToUse = {
              ...contextToUse,
              systemPrompt: contextToUse.systemPrompt + tradingContext,
            };
            logger.debug('Trading context added to system prompt');
          }
        } catch (error) {
          // Non-fatal - trading system may not be initialized
          logger.debug('Failed to get trading context', { error });
        }
      }

      // Inject browser context if browser agent is active
      if (contextToUse) {
        try {
          const browserIntegrator = getBrowserVoiceIntegrator();
          if (browserIntegrator.isActive()) {
            const browserContext = browserIntegrator.getBrowserContextForLLM();
            if (browserContext) {
              contextToUse = {
                ...contextToUse,
                systemPrompt: contextToUse.systemPrompt + browserContext,
              };
              logger.debug('Browser context added to system prompt');
            }
          }
        } catch (error) {
          // Non-fatal - browser system may not be initialized
          logger.debug('Failed to get browser context', { error });
        }
      }

      // Inject personality context for personalized responses based on user profile,
      // knowledge store, personas, emotions, trading, and business context
      if (contextToUse && this.personalityContextBuilder) {
        try {
          const personalityResult = await this.personalityContextBuilder.buildContext(
            processedText,
            this.currentUserEmotion ?? undefined
          );
          if (personalityResult.contextString) {
            contextToUse = {
              ...contextToUse,
              systemPrompt: contextToUse.systemPrompt + personalityResult.contextString,
            };
            logger.debug('Personality context added to system prompt', {
              sections: personalityResult.metadata.sectionsIncluded,
              estimatedTokens: personalityResult.metadata.estimatedTokens,
            });
          }
        } catch (error) {
          // Non-fatal - personality context is optional enhancement
          logger.debug('Failed to build personality context', { error });
        }
      }

      // Load recent messages from memory and inject into context
      if (this.memoryManager && this.config.enableHistory) {
        const recentMessages = this.memoryManager.getRecentMessages(this.config.maxHistoryTurns);
        if (recentMessages.length > 0 && contextToUse) {
          // Merge memory messages into context (excluding the current message we just saved)
          // Take all messages except the last user message (we're about to process it)
          const historyMessages = recentMessages.slice(0, -1);
          if (historyMessages.length > 0) {
            contextToUse = {
              ...contextToUse,
              messages: [...historyMessages, ...contextToUse.messages],
            };
            logger.debug('Loaded conversation history from memory', {
              historyCount: historyMessages.length,
            });
          }
        }
      }

      // Get tools if enabled
      const tools = this.config.enableTools && this.agent ? getVoiceToolDefinitions() : undefined;
      const chatOptions = tools ? { tools, tool_choice: 'auto' as const } : undefined;

      // Pre-warm likely tools based on conversation context (async, non-blocking)
      if (this.config.enableTools && contextToUse) {
        try {
          const prewarmer = getToolPrewarmer();
          const prewarmerContext: PrewarmerContext = {
            recentMessages: contextToUse.messages.slice(-5).map(m => ({
              role: m.role as 'user' | 'assistant',
              content: typeof m.content === 'string' ? m.content : '',
              timestamp: Date.now(),
            })),
            lastToolCalls: this.recentToolCalls || [],
            currentState: this.detectUserState(processedText),
          };
          // Fire and forget - don't await to avoid adding latency
          prewarmer.processContext(prewarmerContext).catch(err => {
            logger.debug('Tool pre-warming failed (non-fatal)', { error: err });
          });
        } catch (error) {
          // Tool prewarmer not available, continue without it
          logger.debug('Tool prewarmer not available');
        }
      }

      // Tool execution loop - allows multiple rounds of tool calls
      let iterations = 0;
      let currentMessage = processedText;
      let pendingToolCalls: ToolCall[] | undefined;
      let toolMessages: ChatMessage[] = [];

      while (iterations < this.config.maxToolIterations) {
        iterations++;
        let firstChunk = true;
        let accumulatedToolCalls: ToolCall[] = [];

        // Stream LLM response with optimized sentence-by-sentence TTS
        for await (const chunk of this.llmManager.chatStream(
          currentMessage,
          contextToUse,
          chatOptions
        )) {
          if (this.currentState !== 'processing') {
            // Interrupted (barge-in)
            this.llmManager.cancel();
            break;
          }

          if (firstChunk) {
            // Track first token time for streaming metrics
            this.firstTokenTime = Date.now();
            this.metrics.llmFirstTokenTime = this.firstTokenTime - this.interactionStartTime;

            // Track speech-end to first-token latency
            if (this.speechEndTime > 0) {
              this.streamingMetrics.speechEndToFirstToken =
                this.firstTokenTime - this.speechEndTime;
            }

            firstChunk = false;
            logger.debug('First LLM token received', {
              llmFirstTokenTime: this.metrics.llmFirstTokenTime,
              speechEndToFirstToken: this.streamingMetrics.speechEndToFirstToken,
            });
          }

          // Accumulate text response
          if (chunk.delta) {
            this.currentResponse = chunk.accumulated;
            this.emit('response-chunk', chunk);

            // Stream to TTS if enabled (only for text content, not tool calls)
            // Skip TTS if this is a text-only interaction and skipTTS is set
            if (this.config.streamToTTS && this.tts && !chunk.toolCalls?.length && !this.skipTTSForCurrentInteraction) {
              // Use sentence boundary detector for optimal TTS chunking
              const sentences = this.sentenceDetector.addText(chunk.delta);

              // Stream each complete sentence to TTS immediately
              for (const sentence of sentences) {
                if (sentence.trim()) {
                  const chunkStartTime = Date.now();

                  // Track first audio time
                  if (this.firstAudioTime === 0) {
                    this.firstAudioTime = chunkStartTime;

                    // Calculate time-to-first-byte (primary latency metric)
                    if (this.speechEndTime > 0) {
                      this.streamingMetrics.timeToFirstByte =
                        this.firstAudioTime - this.speechEndTime;
                      this.streamingMetrics.firstTokenToFirstAudio =
                        this.firstTokenTime > 0 ? this.firstAudioTime - this.firstTokenTime : 0;

                      logger.info('Time to first audio', {
                        timeToFirstByte: this.streamingMetrics.timeToFirstByte,
                        firstTokenToFirstAudio: this.streamingMetrics.firstTokenToFirstAudio,
                        targetMet: this.streamingMetrics.timeToFirstByte < 500,
                      });
                    }
                  }

                  // Apply natural voice settings based on emotion and content
                  // Combine text and voice prosody emotion for TTS adaptation
                  let processedSentence = sentence;
                  if (this.naturalVoice) {
                    // Use prosody emotion if high confidence, otherwise fall back to text emotion
                    const emotionForTTS = this.currentVoiceEmotion && this.currentVoiceEmotion.confidence > 0.6
                      ? this.createEmotionStateFromProsody(this.currentVoiceEmotion)
                      : this.currentUserEmotion;

                    const prepared = this.naturalVoice.prepareSpeech(
                      sentence,
                      emotionForTTS || undefined
                    );
                    processedSentence = prepared.text;
                    // Voice settings are auto-applied to TTS manager by prepareSpeech()
                  }

                  // Send sentence to TTS with minimal latency
                  this.sentenceChunkCount++;
                  this.emit('sentence-chunk', processedSentence, Date.now() - chunkStartTime);

                  // Use streaming sentence method for lowest latency
                  this.tts
                    .streamSentenceChunk(processedSentence)
                    .then((latency) => {
                      this.chunkLatencies.push(latency);
                    })
                    .catch((err) => {
                      logger.warn('Sentence chunk TTS error', { error: (err as Error).message });
                    });
                }
              }
            }
          }

          // Track tool calls being accumulated
          if (chunk.toolCalls?.length) {
            accumulatedToolCalls = chunk.toolCalls;
          }

          if (chunk.isFinal) {
            // Check if we have tool calls to execute
            if (chunk.finishReason === 'tool_calls' && accumulatedToolCalls.length > 0) {
              pendingToolCalls = accumulatedToolCalls;
            }
            break;
          }
        }

        // If no tool calls or interrupted, exit the loop
        if (!pendingToolCalls?.length || this.currentState !== 'processing') {
          break;
        }

        // Execute tool calls
        logger.info('Executing tool calls', {
          count: pendingToolCalls.length,
          iteration: iterations,
        });

        const parsedCalls = parseToolCalls(pendingToolCalls);
        const toolResults: ToolExecutionResult[] = [];

        for (const toolCall of parsedCalls) {
          if (this.currentState !== 'processing') {
            // Interrupted during tool execution
            break;
          }

          this.emit('tool-start', toolCall.name, toolCall.arguments);

          try {
            const result = await this.executeToolCall(toolCall);
            toolResults.push(formatToolResult(toolCall.id, result));

            // Track tool call for pre-warming predictions
            this.trackToolCall(toolCall.name);

            this.emit('tool-complete', toolCall.name, result);

            // Speak a brief summary of the tool result if TTS is enabled
            if (this.tts && result.success) {
              const summary = summarizeToolResultForVoice(toolCall.name, result);
              // Don't speak intermediate summaries, wait for final LLM response
              logger.debug('Tool result summary', { toolName: toolCall.name, summary });
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('tool-error', toolCall.name, err);
            toolResults.push(formatToolResult(toolCall.id, { success: false, error: err.message }));
          }
        }

        // If interrupted during tool execution, exit
        if (this.currentState !== 'processing') {
          break;
        }

        // Add assistant message with tool calls to context
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: this.currentResponse || '',
          tool_calls: pendingToolCalls,
        };
        toolMessages.push(assistantMessage);

        // Add tool results to context
        for (const result of toolResults) {
          const toolMessage: ChatMessage = {
            role: 'tool',
            content: result.content,
            tool_call_id: result.tool_call_id,
          };
          toolMessages.push(toolMessage);
        }

        // Update context with tool messages for next iteration
        if (contextToUse) {
          contextToUse = {
            ...contextToUse,
            messages: [...contextToUse.messages, ...toolMessages],
          };
        }

        // Reset for next iteration - LLM will see tool results and generate response
        pendingToolCalls = undefined;
        currentMessage = ''; // Empty message - LLM continues from tool results
        this.currentResponse = ''; // Reset response for next LLM turn
        toolMessages = []; // Clear for next iteration
      }

      this.metrics.llmTotalTime = Date.now() - this.interactionStartTime;
      this.metrics.responseWords = this.currentResponse.split(/\s+/).length;

      const llmTime = perfTimer.end('llm');
      logger.info('LLM response complete', {
        responseLength: this.currentResponse.length,
        llmTime,
        toolIterations: iterations,
      });

      // Create response object
      const response: LLMResponse = {
        content: this.currentResponse,
        model: 'stream',
        finishReason: 'stop',
        latency: llmTime,
      };

      // Save assistant response to memory
      if (this.memoryManager && this.currentResponse.trim()) {
        this.memoryManager.addMessage({ role: 'assistant', content: this.currentResponse });
        logger.debug('Assistant response saved to memory');
      }

      // Add turn to conversation memory for Obsidian vault storage
      if (this.conversationMemory && this.currentTranscript.trim() && this.currentResponse.trim()) {
        this.conversationMemory.addTurn(this.currentTranscript, this.currentResponse);
        logger.debug('Turn added to conversation memory');
      }

      // Include skipTTS flag so renderer knows not to use fallback TTS for text chat
      this.emit('response-complete', {
        ...response,
        skipTTS: this.skipTTSForCurrentInteraction,
      });

      // Flush remaining text from sentence detector
      if (this.tts) {
        const remainingText = this.sentenceDetector.flush();
        if (remainingText.trim()) {
          this.sentenceChunkCount++;
          this.tts
            .streamSentenceChunk(remainingText)
            .then((latency) => {
              this.chunkLatencies.push(latency);
            })
            .catch((err) => {
              logger.warn('Final sentence chunk TTS error', { error: (err as Error).message });
            });
        }
      }

      // Compute and emit final streaming metrics
      const responseEndTime = Date.now();
      if (this.speechEndTime > 0) {
        this.streamingMetrics.endToEndLatency = responseEndTime - this.speechEndTime;
        this.streamingMetrics.sentenceChunks = this.sentenceChunkCount;
        this.streamingMetrics.avgChunkLatency =
          this.chunkLatencies.length > 0
            ? this.chunkLatencies.reduce((a, b) => a + b, 0) / this.chunkLatencies.length
            : 0;
        this.streamingMetrics.targetMet = (this.streamingMetrics.timeToFirstByte ?? Infinity) < 500;

        logger.info('Streaming metrics', {
          timeToFirstByte: this.streamingMetrics.timeToFirstByte,
          speechEndToFirstToken: this.streamingMetrics.speechEndToFirstToken,
          firstTokenToFirstAudio: this.streamingMetrics.firstTokenToFirstAudio,
          endToEndLatency: this.streamingMetrics.endToEndLatency,
          sentenceChunks: this.streamingMetrics.sentenceChunks,
          avgChunkLatency: Math.round(this.streamingMetrics.avgChunkLatency ?? 0),
          targetMet: this.streamingMetrics.targetMet,
        });

        // Emit streaming metrics event
        this.emit('streaming-metrics', this.streamingMetrics as StreamingMetrics);
      }

      // If TTS is disabled, go straight to idle
      if (!this.tts) {
        this.finishInteraction();
      }
    } catch (error) {
      perfTimer.end('llm');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('LLM processing failed', { error: err.message });
      this.emit('error', err, 'llm');
      this.resetInteraction();
    }
  }

  /**
   * Execute a single tool call via the Agent
   */
  private async executeToolCall(toolCall: ParsedToolCall): Promise<ActionResult> {
    if (!this.agent) {
      return {
        success: false,
        error: 'Agent tools are not available. The agent system failed to initialize.',
      };
    }

    logger.info('Executing tool', { toolName: toolCall.name, args: toolCall.arguments });
    perfTimer.start(`tool-${toolCall.name}`);

    try {
      const result = await this.agent.executeTool(toolCall.name, toolCall.arguments);
      const duration = perfTimer.end(`tool-${toolCall.name}`);
      logger.info('Tool execution complete', {
        toolName: toolCall.name,
        success: result.success,
        duration,
      });

      // Record tool execution in GEPA metrics
      try {
        getMetricsCollector().recordToolExecution(toolCall.name, duration, result.success);
      } catch (e) {
        logger.warn('Failed to record GEPA tool metrics', { error: (e as Error).message });
      }

      return result;
    } catch (error) {
      const duration = perfTimer.end(`tool-${toolCall.name}`);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Tool execution failed', { toolName: toolCall.name, error: err.message });

      // Record failed tool execution in GEPA metrics
      try {
        getMetricsCollector().recordToolExecution(toolCall.name, duration, false);
      } catch (e) {
        logger.warn('Failed to record GEPA tool metrics', { error: (e as Error).message });
      }

      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Handle barge-in (user interrupts TTS)
   */
  private handleBargeIn(): void {
    logger.info('Barge-in detected');

    // Stop TTS
    if (this.tts) {
      this.tts.stop();
    }

    // Cancel LLM if still generating
    if (this.llmManager && this.currentState === 'processing') {
      this.llmManager.cancel();
    }

    this.emit('barge-in');

    // Return to listening state
    this.setState('listening');
    this.startInteraction();
  }

  /**
   * Start a new interaction
   */
  private startInteraction(): void {
    this.interactionStartTime = Date.now();
    this.currentTranscript = '';
    this.currentResponse = '';
    this.ttsBuffer = '';
    this.metrics = {};

    // Reset skip TTS flag for new interaction (voice input will re-enable TTS)
    // Text input via sendText() will set this to true explicitly
    this.skipTTSForCurrentInteraction = false;

    // Reset streaming optimization state
    this.streamingMetrics = {};
    this.sentenceDetector.reset();
    this.speechEndTime = 0;
    this.firstTokenTime = 0;
    this.firstAudioTime = 0;
    this.chunkLatencies = [];
    this.sentenceChunkCount = 0;

    this.setState('listening');
    this.metrics.wakeToSttTime = 0;
  }

  /**
   * Finish speaking and complete interaction
   */
  private finishSpeaking(): void {
    this.audioPipeline?.finishSpeaking();
    this.emit('speaking-end');
    this.finishInteraction();
  }

  /**
   * Complete the interaction
   */
  private finishInteraction(): void {
    this.metrics.totalTime = Date.now() - this.interactionStartTime;

    logger.info('Interaction complete', { metrics: this.metrics });

    // Record interaction in GEPA for self-improvement tracking
    this.recordGEPAInteraction(true);

    // Clear dynamic voice settings after interaction
    if (this.naturalVoice) {
      this.naturalVoice.clearVoiceSettings();
    }

    // Silent learning: Let JARVIS Brain learn from this conversation
    if (this.jarvisBrain && this.currentTranscript.trim() && this.currentResponse.trim()) {
      this.jarvisBrain.learnFromConversation(this.currentTranscript, this.currentResponse)
        .then(() => {
          logger.debug('JARVIS Brain learned from conversation');
        })
        .catch((err) => {
          logger.warn('JARVIS Brain learning failed', { error: (err as Error).message });
        });
    }

    this.setState('idle');
  }

  /**
   * Detect user state/intent from message text for tool pre-warming
   */
  private detectUserState(text: string): string | undefined {
    const lower = text.toLowerCase();

    // Check for debugging indicators
    if (lower.includes('error') || lower.includes('bug') || lower.includes('debug') ||
      lower.includes('not working') || lower.includes('broken')) {
      return 'debugging';
    }

    // Check for coding indicators
    if (lower.includes('code') || lower.includes('function') || lower.includes('class') ||
      lower.includes('implement') || lower.includes('refactor')) {
      return 'coding';
    }

    // Check for research indicators
    if (lower.includes('research') || lower.includes('find out') || lower.includes('look up') ||
      lower.includes('search for') || lower.includes('what is')) {
      return 'researching';
    }

    // Check for trading indicators
    if (lower.includes('trade') || lower.includes('position') || lower.includes('profit') ||
      lower.includes('portfolio') || lower.includes('market')) {
      return 'trading';
    }

    // Check for git workflow indicators
    if (lower.includes('commit') || lower.includes('push') || lower.includes('pull') ||
      lower.includes('branch') || lower.includes('merge')) {
      return 'git_workflow';
    }

    // Check for testing indicators
    if (lower.includes('test') || lower.includes('run tests') || lower.includes('coverage')) {
      return 'testing';
    }

    return undefined;
  }

  /**
   * Track a tool call for pre-warming predictions
   */
  private trackToolCall(toolName: string): void {
    this.recentToolCalls.push(toolName);
    if (this.recentToolCalls.length > this.maxRecentToolCalls) {
      this.recentToolCalls.shift();
    }

    // Also record in the prewarmer for learning
    try {
      const prewarmer = getToolPrewarmer();
      prewarmer.recordToolCall(toolName, {
        lastToolCalls: this.recentToolCalls,
      });
    } catch (_error) {
      // Prewarmer not available
    }
  }

  /**
   * Record interaction metrics in GEPA for self-improvement analysis
   */
  private recordGEPAInteraction(success: boolean): void {
    try {
      // Only record if we have meaningful data
      if (!this.currentTranscript.trim() && !this.currentResponse.trim()) {
        return;
      }

      // Record the interaction for evaluation
      recordInteraction({
        userInput: this.currentTranscript,
        assistantResponse: this.currentResponse,
        latencyMs: this.metrics.totalTime,
        success,
      });

      // Record component latencies in metrics collector
      const metricsCollector = getMetricsCollector();

      if (this.metrics.sttTime) {
        metricsCollector.recordLatency('stt', this.metrics.sttTime);
      }

      if (this.metrics.llmFirstTokenTime) {
        metricsCollector.recordLatency('llm', this.metrics.llmFirstTokenTime);
      }

      if (this.metrics.llmTotalTime) {
        metricsCollector.recordLatency('llm_total', this.metrics.llmTotalTime);
      }

      if (this.metrics.ttsFirstAudioTime) {
        metricsCollector.recordLatency('tts', this.metrics.ttsFirstAudioTime);
      }

      if (this.metrics.totalTime) {
        metricsCollector.recordLatency('voice_pipeline', this.metrics.totalTime);
      }

      // Record streaming metrics if available
      if (this.streamingMetrics.timeToFirstByte) {
        metricsCollector.record('latency', this.streamingMetrics.timeToFirstByte, {
          component: 'time_to_first_byte',
        });
      }

      logger.debug('GEPA interaction recorded', {
        transcriptLength: this.currentTranscript.length,
        responseLength: this.currentResponse.length,
        totalLatency: this.metrics.totalTime,
      });
    } catch (error) {
      logger.warn('Failed to record GEPA interaction', { error: (error as Error).message });
    }
  }

  /**
   * Convert prosody emotion signal to EmotionState for TTS
   */
  private createEmotionStateFromProsody(prosody: ProsodyEmotionSignal): EmotionState {
    // Map prosody emotion type to text-based emotion type
    const typeMap: Record<string, string> = {
      neutral: 'neutral',
      happy: 'happy',
      sad: 'sad',
      angry: 'angry',
      frustrated: 'frustrated',
      excited: 'excited',
      anxious: 'anxious',
      confused: 'confused',
      tired: 'tired',
      bored: 'neutral',
    };

    return {
      primary: {
        type: (typeMap[prosody.type] || 'neutral') as EmotionState['primary']['type'],
        intensity: prosody.intensity,
        confidence: prosody.confidence,
        source: 'voice',
        indicators: prosody.indicators,
      },
      secondary: prosody.secondaryType ? {
        type: (typeMap[prosody.secondaryType] || 'neutral') as EmotionState['primary']['type'],
        intensity: 'subtle',
        confidence: prosody.secondaryConfidence || 0.5,
        source: 'voice',
        indicators: [],
      } : undefined,
      timestamp: prosody.timestamp,
    };
  }

  /**
   * Reset interaction (on error or timeout)
   */
  private resetInteraction(): void {
    logger.info('Resetting interaction');

    // Record failed/abandoned interaction in GEPA
    this.recordGEPAInteraction(false);

    if (this.tts) {
      this.tts.stop();
    }

    if (this.llmManager) {
      this.llmManager.cancel();
    }

    this.audioPipeline?.cancel();
    this.setState('idle');
  }

  /**
   * Get current time of day for context-aware responses
   */
  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Manually triggers wake word detection (push-to-talk functionality).
   *
   * Use this method to start listening without waiting for the wake word.
   * The pipeline must be running before calling this method.
   *
   * @example
   * ```typescript
   * // User presses a button to start speaking
   * pipeline.triggerWake();
   * ```
   */
  triggerWake(): void {
    if (!this.isRunning) {
      logger.warn(
        'Cannot trigger wake word detection: Voice pipeline is not running. Call start() first.'
      );
      return;
    }

    this.audioPipeline?.triggerWake();
  }

  /**
   * Sends text directly to the LLM, bypassing speech-to-text.
   *
   * Use this method to process text input without voice. The text will be
   * processed by the LLM and the response will be spoken via TTS if enabled.
   *
   * @param text - The text message to send to the LLM
   * @throws Error if the pipeline is not running
   *
   * @example
   * ```typescript
   * // Process a typed message
   * await pipeline.sendText('What is the weather like today?');
   * ```
   */
  async sendText(text: string, options?: { skipTTS?: boolean }): Promise<void> {
    // Store whether to skip TTS for this interaction (text chat mode)
    this.skipTTSForCurrentInteraction = options?.skipTTS ?? true; // Default to skip TTS for text input

    // Allow text chat even if voice pipeline failed to fully start
    // We only need LLM to be initialized, not the audio components
    if (!this.llmManager) {
      // Try to initialize LLM if not already done
      try {
        logger.info('Initializing LLM for text-only mode...');
        this.llmManager = getLLMManager();
        await this.llmManager.initialize();

        // Also initialize TTS if not done (for optional voice output)
        if (!this.tts) {
          const { getTTSManager } = await import('../tts/manager');
          this.tts = getTTSManager();
        }

        // Initialize emotion detector for empathetic responses
        if (!this.emotionDetector) {
          this.emotionDetector = getEmotionDetector();
        }

        logger.info('Text-only mode initialized successfully');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to initialize text-only mode', { error: err.message });
        throw new Error('Cannot send text: Failed to initialize LLM. ' + err.message);
      }
    }

    this.startInteraction();
    this.setState('processing');
    this.currentTranscript = text;

    // Detect user emotion from text input for empathetic responses
    if (this.emotionDetector && text.trim()) {
      this.currentUserEmotion = this.emotionDetector.detectEmotion(text);
      logger.info('User emotion detected from text', {
        emotion: this.currentUserEmotion.primary.type,
        intensity: this.currentUserEmotion.primary.intensity,
        confidence: this.currentUserEmotion.primary.confidence,
      });
      this.emit('emotion-detected', this.currentUserEmotion);
    }

    this.emit('transcript-final', {
      text,
      isFinal: true,
      confidence: 1.0,
    } as TranscriptionResult);

    await this.processWithLLM(text);
  }

  /**
   * Speak a proactive message without user prompt (e.g., trading alerts).
   * This bypasses LLM processing and goes directly to TTS.
   *
   * @param message - The message to speak
   * @param options - Optional configuration
   * @returns Promise that resolves when speech starts
   *
   * @example
   * ```typescript
   * await pipeline.speakProactive("I just closed my ETH position with a 5% gain");
   * ```
   */
  async speakProactive(
    message: string,
    options?: { priority?: 'low' | 'normal' | 'high'; interruptCurrent?: boolean }
  ): Promise<void> {
    if (!this.tts) {
      logger.warn('Cannot speak proactive message: TTS not initialized');
      return;
    }

    const { interruptCurrent = false } = options ?? {};

    // If currently speaking and shouldn't interrupt, queue it or skip
    if (this.tts.isSpeaking() && !interruptCurrent) {
      logger.debug('TTS busy, queueing proactive message', { message: message.substring(0, 50) });
      // Queue via TTS manager's internal queue
      await this.tts.speak(message);
      return;
    }

    // Interrupt current speech if requested
    if (interruptCurrent && this.tts.isSpeaking()) {
      this.tts.stop();
    }

    logger.info('Speaking proactive message', { message: message.substring(0, 80) });
    this.setState('speaking');
    this.emit('proactive-speech', { message });

    try {
      await this.tts.speak(message);
    } catch (error) {
      logger.error('Failed to speak proactive message', { error });
    } finally {
      // Return to listening if pipeline is running
      if (this.isRunning) {
        this.setState('listening');
      }
    }
  }

  /**
   * Gets the current conversation context.
   *
   * @returns The conversation context containing message history and system prompt, or null if history is disabled
   */
  getConversationContext(): ConversationContext | null {
    return this.conversationContext;
  }

  /**
   * Clears all conversation history from both in-memory context and persistent storage.
   *
   * This resets the conversation to a fresh state while keeping the pipeline running.
   *
   * @example
   * ```typescript
   * // Start a new conversation
   * await pipeline.clearHistory();
   * ```
   */
  async clearHistory(): Promise<void> {
    if (this.conversationContext) {
      this.conversationContext = createConversationContext(
        ATLAS_SYSTEM_PROMPT,
        this.config.userName
      );
    }

    // Also clear persistent memory and start fresh session
    if (this.memoryManager) {
      await this.memoryManager.clear();
      this.memoryManager.startSession({ device: 'desktop', startedAt: Date.now() });
    }

    logger.info('Conversation history cleared (memory and context)');
  }

  /**
   * Gets the memory manager instance for accessing persistent conversation storage.
   *
   * @returns The MemoryManager instance, or null if not initialized
   */
  getMemoryManager(): MemoryManager | null {
    return this.memoryManager;
  }

  /**
   * Gets performance metrics from the last interaction.
   *
   * @returns Timing metrics including STT time, LLM response time, and TTS latency
   *
   * @example
   * ```typescript
   * const metrics = pipeline.getMetrics();
   * console.log(`Total time: ${metrics.totalTime}ms`);
   * console.log(`LLM first token: ${metrics.llmFirstTokenTime}ms`);
   * ```
   */
  getMetrics(): Partial<InteractionMetrics> {
    return { ...this.metrics };
  }

  /**
   * Gets streaming latency metrics from the last interaction.
   *
   * @returns Streaming-specific metrics including time-to-first-byte and end-to-end latency
   *
   * @example
   * ```typescript
   * const streaming = pipeline.getStreamingMetrics();
   * console.log(`Time to first audio: ${streaming.timeToFirstByte}ms`);
   * console.log(`Target met (<500ms): ${streaming.targetMet}`);
   * ```
   */
  getStreamingMetrics(): Partial<StreamingMetrics> {
    return { ...this.streamingMetrics };
  }

  /**
   * Updates the pipeline configuration at runtime.
   *
   * @param config - Partial configuration to merge with existing settings
   *
   * @example
   * ```typescript
   * pipeline.updateConfig({
   *   ttsBufferSize: 100,
   *   maxHistoryTurns: 20
   * });
   * ```
   */
  updateConfig(config: Partial<VoicePipelineConfig>): void {
    this.config = { ...this.config, ...config } as Required<VoicePipelineConfig>;

    if (this.audioPipeline && config.audio) {
      this.audioPipeline.updateConfig(config.audio);
    }

    logger.info('Voice pipeline config updated');
  }

  /**
   * Gets a copy of the current pipeline configuration.
   *
   * @returns The current configuration object
   */
  getConfig(): VoicePipelineConfig {
    return { ...this.config };
  }

  // Type-safe event emitter methods
  on<K extends keyof VoicePipelineEvents>(event: K, listener: VoicePipelineEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof VoicePipelineEvents>(event: K, listener: VoicePipelineEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof VoicePipelineEvents>(
    event: K,
    ...args: Parameters<VoicePipelineEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Convert Float32Array audio to Int16Array (PCM16)
 * VAD outputs Float32 (-1 to 1), STT expects Int16 (-32768 to 32767)
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    // Clamp to -1 to 1 range
    const s = Math.max(-1, Math.min(1, float32[i]));
    // Convert to Int16
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Convert Int16Array audio to Float32Array
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/**
 * Convert Buffer to Int16Array
 */
export function bufferToInt16(buffer: Buffer): Int16Array {
  return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
}

/**
 * Convert Int16Array to Buffer
 */
export function int16ToBuffer(int16: Int16Array): Buffer {
  return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
}

// Singleton instance
let voicePipeline: VoicePipeline | null = null;

/**
 * Gets or creates the singleton VoicePipeline instance.
 *
 * Use this function to access the voice pipeline throughout the application.
 * The instance is created lazily on first call.
 *
 * @param config - Optional configuration for the pipeline (only used on first call)
 * @returns The VoicePipeline singleton instance
 *
 * @example
 * ```typescript
 * const pipeline = getVoicePipeline();
 * await pipeline.start();
 * ```
 */
export function getVoicePipeline(config?: Partial<VoicePipelineConfig>): VoicePipeline {
  if (!voicePipeline) {
    voicePipeline = new VoicePipeline(config);
  }
  return voicePipeline;
}

/**
 * Shuts down the voice pipeline and releases all resources.
 *
 * Call this when the application is closing to ensure clean shutdown.
 *
 * @example
 * ```typescript
 * // In app cleanup
 * await shutdownVoicePipeline();
 * ```
 */
export async function shutdownVoicePipeline(): Promise<void> {
  if (voicePipeline) {
    await voicePipeline.stop();
    voicePipeline = null;
  }
}

export default VoicePipeline;
