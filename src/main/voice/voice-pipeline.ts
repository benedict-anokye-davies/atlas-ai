/**
 * Nova Desktop - Voice Pipeline Integration
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
import {
  VoicePipelineState,
  VoicePipelineStatus,
  WakeWordEvent,
  SpeechSegment,
} from '../../shared/types/voice';
import { TranscriptionResult, STTStatus } from '../../shared/types/stt';
import {
  LLMResponse,
  LLMStreamChunk,
  ConversationContext,
  createConversationContext,
  NOVA_SYSTEM_PROMPT,
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
}

/**
 * Default Voice Pipeline configuration
 */
const DEFAULT_VOICE_PIPELINE_CONFIG: Required<VoicePipelineConfig> = {
  audio: {},
  stt: {},
  llm: {},
  streamToTTS: true,
  ttsBufferSize: 50, // ~1 sentence
  userName: 'User',
  enableHistory: true,
  maxHistoryTurns: 10,
  enableTools: true,
  maxToolIterations: 5,
  enableInputValidation: true,
  blockOnThreat: true,
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

  // State
  private isRunning = false;
  private currentState: VoicePipelineState = 'idle';
  private conversationContext: ConversationContext | null = null;
  private sessionId: string = '';

  // Current interaction tracking
  private currentTranscript = '';
  private currentResponse = '';
  private ttsBuffer = '';
  private interactionStartTime = 0;
  private metrics: Partial<InteractionMetrics> = {};

  constructor(config?: Partial<VoicePipelineConfig>) {
    super();
    this.config = { ...DEFAULT_VOICE_PIPELINE_CONFIG, ...config } as Required<VoicePipelineConfig>;

    // Generate a unique session ID
    this.sessionId = `voice-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    logger.info('VoicePipeline created', {
      streamToTTS: this.config.streamToTTS,
      enableHistory: this.config.enableHistory,
      enableInputValidation: this.config.enableInputValidation,
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
    };
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

      // Initialize TTS Manager (handles ElevenLabs with offline fallback)
      if (appConfig.elevenlabsApiKey) {
        this.tts = getTTSManager({
          elevenlabs: {
            apiKey: appConfig.elevenlabsApiKey,
            voiceId: appConfig.elevenlabsVoiceId,
          },
        });
        this.setupTTSHandlers();
      } else {
        logger.warn(
          'ElevenLabs API key not configured. Text-to-speech is disabled. Add ELEVENLABS_API_KEY to your environment to enable voice responses.'
        );
      }

      // Initialize conversation context
      if (this.config.enableHistory) {
        this.conversationContext = createConversationContext(
          NOVA_SYSTEM_PROMPT,
          this.config.userName
        );
      }

      // Initialize Memory Manager for persistent conversation storage
      this.memoryManager = await getMemoryManager();
      this.memoryManager.startSession({ device: 'desktop', startedAt: Date.now() });
      logger.info('Memory session started', {
        sessionId: this.memoryManager.getCurrentSessionId(),
      });

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

      logger.info('Final transcription', {
        text: result.text,
        confidence: result.confidence,
        sttTime: this.metrics.sttTime,
      });

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

      // Start STT if not already running
      if (this.sttManager && this.sttManager.status === STTStatus.IDLE) {
        await this.sttManager.start();
      }

      // Send audio to STT
      if (this.sttManager) {
        this.sttManager.sendAudio(pcm16);

        // Signal end of audio
        await this.sttManager.stop();
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

      // Tool execution loop - allows multiple rounds of tool calls
      let iterations = 0;
      let currentMessage = processedText;
      let pendingToolCalls: ToolCall[] | undefined;
      let toolMessages: ChatMessage[] = [];

      while (iterations < this.config.maxToolIterations) {
        iterations++;
        let firstChunk = true;
        let accumulatedToolCalls: ToolCall[] = [];

        // Stream LLM response
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
            this.metrics.llmFirstTokenTime = Date.now() - this.interactionStartTime;
            firstChunk = false;
          }

          // Accumulate text response
          if (chunk.delta) {
            this.currentResponse = chunk.accumulated;
            this.emit('response-chunk', chunk);

            // Stream to TTS if enabled (only for text content, not tool calls)
            if (this.config.streamToTTS && this.tts && !chunk.toolCalls?.length) {
              this.ttsBuffer += chunk.delta;

              // Send to TTS when we have enough text (sentence boundary)
              if (this.shouldFlushTTSBuffer(this.ttsBuffer)) {
                const textToSpeak = this.ttsBuffer.trim();
                this.ttsBuffer = '';

                if (textToSpeak) {
                  this.tts.speakWithAudioStream(textToSpeak);
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

      this.emit('response-complete', response);

      // Flush remaining TTS buffer
      if (this.tts && this.ttsBuffer.trim()) {
        this.tts.speakWithAudioStream(this.ttsBuffer.trim());
        this.ttsBuffer = '';
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
      return result;
    } catch (error) {
      perfTimer.end(`tool-${toolCall.name}`);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Tool execution failed', { toolName: toolCall.name, error: err.message });
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Check if TTS buffer should be flushed (sentence boundary)
   */
  private shouldFlushTTSBuffer(text: string): boolean {
    if (text.length < this.config.ttsBufferSize) {
      return false;
    }

    // Check for sentence endings
    const sentenceEndings = /[.!?]\s*$/;
    return sentenceEndings.test(text);
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

    this.setState('idle');
  }

  /**
   * Reset interaction (on error or timeout)
   */
  private resetInteraction(): void {
    logger.info('Resetting interaction');

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
  async sendText(text: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error(
        'Cannot send text: Voice pipeline is not running. Call start() before sending messages.'
      );
    }

    this.startInteraction();
    this.setState('processing');
    this.currentTranscript = text;

    this.emit('transcript-final', {
      text,
      isFinal: true,
      confidence: 1.0,
    } as TranscriptionResult);

    await this.processWithLLM(text);
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
        NOVA_SYSTEM_PROMPT,
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
