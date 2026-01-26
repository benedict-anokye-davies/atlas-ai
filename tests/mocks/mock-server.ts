/**
 * Atlas Desktop - API Mock Server
 * Comprehensive mock server for testing without real API connections
 *
 * Features:
 * - Mock Deepgram STT API responses
 * - Mock ElevenLabs TTS API responses
 * - Mock LLM API responses (Fireworks, OpenRouter)
 * - Configurable latency simulation
 * - Error scenario simulation
 * - Record/replay mode for real responses
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Mock server configuration
 */
export interface MockServerConfig {
  /** Enable latency simulation */
  enableLatency: boolean;
  /** Base latency in milliseconds */
  baseLatencyMs: number;
  /** Latency variance (random +/- this amount) */
  latencyVarianceMs: number;
  /** Enable record mode (captures real responses) */
  recordMode: boolean;
  /** Enable replay mode (uses recorded responses) */
  replayMode: boolean;
  /** Directory for recorded responses */
  recordingsDir: string;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Error scenario configuration
 */
export interface ErrorScenario {
  /** Probability of error (0-1) */
  probability: number;
  /** HTTP status code */
  statusCode: number;
  /** Error message */
  message: string;
  /** Error type/code */
  errorCode?: string;
}

/**
 * Request handler function type
 */
type RequestHandler = (
  url: string,
  options?: RequestInit
) => Promise<Response> | Response;

/**
 * Recorded response data
 */
interface RecordedResponse {
  timestamp: number;
  url: string;
  method: string;
  requestBody?: unknown;
  statusCode: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer;
  latencyMs: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MockServerConfig = {
  enableLatency: true,
  baseLatencyMs: 100,
  latencyVarianceMs: 50,
  recordMode: false,
  replayMode: false,
  recordingsDir: './tests/mocks/recordings',
  verbose: false,
};

// ============================================================================
// Mock Server Class
// ============================================================================

/**
 * API Mock Server for Atlas Desktop testing
 *
 * Provides comprehensive mocking for all external API dependencies:
 * - Deepgram (STT)
 * - ElevenLabs (TTS)
 * - Fireworks AI (LLM)
 * - OpenRouter (LLM fallback)
 */
export class MockServer extends EventEmitter {
  private config: MockServerConfig;
  private originalFetch: typeof global.fetch | null = null;
  private handlers: Map<string, RequestHandler> = new Map();
  private errorScenarios: Map<string, ErrorScenario> = new Map();
  private requestLog: Array<{ url: string; method: string; timestamp: number }> = [];
  private recordings: Map<string, RecordedResponse[]> = new Map();
  private isActive = false;

  constructor(config: Partial<MockServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupDefaultHandlers();
  }

  /**
   * Start the mock server (intercepts fetch requests)
   */
  start(): void {
    if (this.isActive) {
      this.log('Mock server already active');
      return;
    }

    this.originalFetch = global.fetch;
    global.fetch = this.createMockFetch();
    this.isActive = true;

    if (this.config.replayMode) {
      this.loadRecordings();
    }

    this.log('Mock server started');
    this.emit('start');
  }

  /**
   * Stop the mock server (restores original fetch)
   */
  stop(): void {
    if (!this.isActive) {
      this.log('Mock server not active');
      return;
    }

    if (this.originalFetch) {
      global.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    this.isActive = false;

    if (this.config.recordMode) {
      this.saveRecordings();
    }

    this.log('Mock server stopped');
    this.emit('stop');
  }

  /**
   * Create the mock fetch function
   */
  private createMockFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const startTime = Date.now();

      // Log request
      this.requestLog.push({ url, method, timestamp: startTime });
      this.log(`Request: ${method} ${url}`);

      // Check for replay mode
      if (this.config.replayMode) {
        const recorded = this.findRecordedResponse(url, method);
        if (recorded) {
          await this.simulateLatency(recorded.latencyMs);
          return this.createResponseFromRecording(recorded);
        }
      }

      // Check for error scenario
      const errorResponse = this.checkErrorScenario(url);
      if (errorResponse) {
        return errorResponse;
      }

      // Find matching handler
      const handler = this.findHandler(url);
      if (handler) {
        await this.simulateLatency();
        const response = await handler(url, init);

        // Record if in record mode
        if (this.config.recordMode) {
          await this.recordResponse(url, method, init?.body, response.clone(), Date.now() - startTime);
        }

        return response;
      }

      // No handler found - return 404
      this.log(`No handler for: ${method} ${url}`);
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  /**
   * Set up default API handlers
   */
  private setupDefaultHandlers(): void {
    // Deepgram handlers
    this.registerHandler('api.deepgram.com', this.handleDeepgramRequest.bind(this));

    // ElevenLabs handlers
    this.registerHandler('api.elevenlabs.io', this.handleElevenLabsRequest.bind(this));

    // Fireworks AI handlers
    this.registerHandler('api.fireworks.ai', this.handleFireworksRequest.bind(this));

    // OpenRouter handlers
    this.registerHandler('openrouter.ai', this.handleOpenRouterRequest.bind(this));
  }

  /**
   * Register a custom request handler for a URL pattern
   */
  registerHandler(pattern: string, handler: RequestHandler): void {
    this.handlers.set(pattern, handler);
    this.log(`Registered handler for: ${pattern}`);
  }

  /**
   * Find a handler for the given URL
   */
  private findHandler(url: string): RequestHandler | undefined {
    for (const [pattern, handler] of this.handlers) {
      if (url.includes(pattern)) {
        return handler;
      }
    }
    return undefined;
  }

  /**
   * Set an error scenario for a URL pattern
   */
  setErrorScenario(pattern: string, scenario: ErrorScenario): void {
    this.errorScenarios.set(pattern, scenario);
    this.log(`Set error scenario for: ${pattern}`);
  }

  /**
   * Clear error scenario for a URL pattern
   */
  clearErrorScenario(pattern: string): void {
    this.errorScenarios.delete(pattern);
  }

  /**
   * Clear all error scenarios
   */
  clearAllErrorScenarios(): void {
    this.errorScenarios.clear();
  }

  /**
   * Check if an error scenario should be triggered
   */
  private checkErrorScenario(url: string): Response | null {
    for (const [pattern, scenario] of this.errorScenarios) {
      if (url.includes(pattern) && Math.random() < scenario.probability) {
        this.log(`Triggering error scenario for: ${url}`);
        return new Response(
          JSON.stringify({
            error: scenario.message,
            code: scenario.errorCode,
          }),
          {
            status: scenario.statusCode,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }
    return null;
  }

  /**
   * Simulate network latency
   */
  private async simulateLatency(forcedLatency?: number): Promise<void> {
    if (!this.config.enableLatency && forcedLatency === undefined) {
      return;
    }

    const latency = forcedLatency ?? this.calculateLatency();
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  /**
   * Calculate random latency within configured bounds
   */
  private calculateLatency(): number {
    const variance = (Math.random() * 2 - 1) * this.config.latencyVarianceMs;
    return Math.max(0, this.config.baseLatencyMs + variance);
  }

  /**
   * Update latency configuration
   */
  setLatency(baseMs: number, varianceMs = 0): void {
    this.config.baseLatencyMs = baseMs;
    this.config.latencyVarianceMs = varianceMs;
  }

  /**
   * Enable or disable latency simulation
   */
  setLatencyEnabled(enabled: boolean): void {
    this.config.enableLatency = enabled;
  }

  // ============================================================================
  // Deepgram API Handler
  // ============================================================================

  /**
   * Handle Deepgram API requests
   */
  private async handleDeepgramRequest(url: string, options?: RequestInit): Promise<Response> {
    // GET /v1/listen endpoint info
    if (url.includes('/v1/listen') && (!options?.method || options.method === 'GET')) {
      return this.createDeepgramInfoResponse();
    }

    // POST /v1/listen - transcription
    if (url.includes('/v1/listen') && options?.method === 'POST') {
      return this.createDeepgramTranscriptionResponse(options.body);
    }

    // Default response
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create Deepgram API info response
   */
  private createDeepgramInfoResponse(): Response {
    return new Response(
      JSON.stringify({
        version: '1.0.0',
        models: ['nova-2', 'nova-3', 'enhanced', 'base'],
        features: ['punctuation', 'diarization', 'smart_format'],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Create Deepgram transcription response
   */
  private createDeepgramTranscriptionResponse(body?: BodyInit | null): Response {
    // Simulate transcription based on audio length
    const transcript = 'Hello, this is a test transcription from the mock server.';

    return new Response(
      JSON.stringify({
        metadata: {
          request_id: `req_${Date.now()}`,
          created: new Date().toISOString(),
          duration: 2.5,
          channels: 1,
        },
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript,
                  confidence: 0.95,
                  words: transcript.split(' ').map((word, i) => ({
                    word,
                    start: i * 0.3,
                    end: (i + 1) * 0.3 - 0.05,
                    confidence: 0.9 + Math.random() * 0.1,
                    punctuated_word: word,
                  })),
                },
              ],
            },
          ],
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ============================================================================
  // ElevenLabs API Handler
  // ============================================================================

  /**
   * Handle ElevenLabs API requests
   */
  private async handleElevenLabsRequest(url: string, options?: RequestInit): Promise<Response> {
    // GET /v1/voices - list voices
    if (url.includes('/v1/voices') && (!options?.method || options.method === 'GET')) {
      return this.createElevenLabsVoicesResponse();
    }

    // GET /v1/user/subscription - subscription info
    if (url.includes('/v1/user/subscription')) {
      return this.createElevenLabsSubscriptionResponse();
    }

    // POST /v1/text-to-speech - TTS synthesis
    if (url.includes('/v1/text-to-speech')) {
      const isStreaming = url.includes('/stream');
      return this.createElevenLabsTTSResponse(options?.body, isStreaming);
    }

    // Default response
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create ElevenLabs voices list response
   */
  private createElevenLabsVoicesResponse(): Response {
    return new Response(
      JSON.stringify({
        voices: [
          {
            voice_id: 'mock-voice-1',
            name: 'Atlas Default',
            category: 'premade',
            labels: { accent: 'american', age: 'young', gender: 'female' },
            preview_url: 'https://example.com/preview1.mp3',
          },
          {
            voice_id: 'mock-voice-2',
            name: 'Professional',
            category: 'premade',
            labels: { accent: 'british', age: 'middle-aged', gender: 'male' },
            preview_url: 'https://example.com/preview2.mp3',
          },
          {
            voice_id: 'mock-voice-custom',
            name: 'Custom Clone',
            category: 'cloned',
            labels: {},
            preview_url: 'https://example.com/preview3.mp3',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Create ElevenLabs subscription response
   */
  private createElevenLabsSubscriptionResponse(): Response {
    return new Response(
      JSON.stringify({
        tier: 'starter',
        character_count: 5000,
        character_limit: 10000,
        can_extend_character_limit: true,
        allowed_to_extend_character_limit: true,
        next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 * 30,
        voice_limit: 10,
        professional_voice_limit: 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Create ElevenLabs TTS response (audio data)
   */
  private createElevenLabsTTSResponse(body?: BodyInit | null, streaming = false): Response {
    // Parse request body to get text length
    let textLength = 100;
    if (body) {
      try {
        const parsed = JSON.parse(body.toString());
        textLength = parsed.text?.length || 100;
      } catch {
        // Use default
      }
    }

    // Generate mock audio data (MP3-like header + random data)
    const audioSize = Math.max(1024, textLength * 50); // ~50 bytes per character
    const audioData = this.generateMockAudioData(audioSize);

    if (streaming) {
      // Return streaming response
      const stream = this.createAudioStream(audioData, 256); // 256 byte chunks
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // Return full audio buffer
    return new Response(audioData, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioSize.toString(),
      },
    });
  }

  /**
   * Generate mock MP3-like audio data
   */
  private generateMockAudioData(size: number): ArrayBuffer {
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);

    // ID3v2 header
    view[0] = 0x49; // 'I'
    view[1] = 0x44; // 'D'
    view[2] = 0x33; // '3'
    view[3] = 0x04; // Version 4
    view[4] = 0x00; // Revision
    view[5] = 0x00; // Flags

    // Fill with pseudo-random audio-like data
    for (let i = 6; i < size; i++) {
      view[i] = Math.floor(Math.random() * 256);
    }

    return buffer;
  }

  /**
   * Create a ReadableStream from audio data
   */
  private createAudioStream(data: ArrayBuffer, chunkSize: number): ReadableStream<Uint8Array> {
    const uint8Data = new Uint8Array(data);
    let offset = 0;

    return new ReadableStream({
      pull: (controller) => {
        if (offset >= uint8Data.length) {
          controller.close();
          return;
        }

        const end = Math.min(offset + chunkSize, uint8Data.length);
        const chunk = uint8Data.slice(offset, end);
        controller.enqueue(chunk);
        offset = end;
      },
    });
  }

  // ============================================================================
  // Fireworks AI API Handler
  // ============================================================================

  /**
   * Handle Fireworks AI API requests
   */
  private async handleFireworksRequest(url: string, options?: RequestInit): Promise<Response> {
    // POST /inference/v1/chat/completions
    if (url.includes('/chat/completions') && options?.method === 'POST') {
      return this.createLLMChatResponse(options.body, 'fireworks');
    }

    // GET /inference/v1/models
    if (url.includes('/models')) {
      return this.createFireworksModelsResponse();
    }

    // Default response
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create Fireworks models list response
   */
  private createFireworksModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'accounts/fireworks/models/deepseek-r1',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'fireworks',
          },
          {
            id: 'accounts/fireworks/models/llama-v3p1-405b-instruct',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'fireworks',
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ============================================================================
  // OpenRouter API Handler
  // ============================================================================

  /**
   * Handle OpenRouter API requests
   */
  private async handleOpenRouterRequest(url: string, options?: RequestInit): Promise<Response> {
    // POST /api/v1/chat/completions
    if (url.includes('/chat/completions') && options?.method === 'POST') {
      return this.createLLMChatResponse(options.body, 'openrouter');
    }

    // GET /api/v1/models
    if (url.includes('/models')) {
      return this.createOpenRouterModelsResponse();
    }

    // Default response
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create OpenRouter models list response
   */
  private createOpenRouterModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'anthropic/claude-3-haiku',
            name: 'Claude 3 Haiku',
            pricing: { prompt: '0.00025', completion: '0.00125' },
            context_length: 200000,
          },
          {
            id: 'openai/gpt-4-turbo',
            name: 'GPT-4 Turbo',
            pricing: { prompt: '0.01', completion: '0.03' },
            context_length: 128000,
          },
          {
            id: 'google/gemini-pro',
            name: 'Gemini Pro',
            pricing: { prompt: '0.000125', completion: '0.000375' },
            context_length: 32000,
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ============================================================================
  // LLM Chat Response (Shared)
  // ============================================================================

  /**
   * Create LLM chat completion response
   */
  private createLLMChatResponse(
    body?: BodyInit | null,
    provider: 'fireworks' | 'openrouter' = 'fireworks'
  ): Response {
    let stream = false;
    let messages: Array<{ role: string; content: string }> = [];
    let requestedModel = provider === 'fireworks'
      ? 'accounts/fireworks/models/deepseek-r1'
      : 'anthropic/claude-3-haiku';

    // Parse request body
    if (body) {
      try {
        const parsed = JSON.parse(body.toString());
        stream = parsed.stream || false;
        messages = parsed.messages || [];
        requestedModel = parsed.model || requestedModel;
      } catch {
        // Use defaults
      }
    }

    // Generate mock response based on input
    const lastMessage = messages[messages.length - 1]?.content || 'Hello';
    const responseContent = this.generateMockLLMResponse(lastMessage);

    const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      // Return streaming response (SSE)
      const chunks = this.splitIntoChunks(responseContent, 10); // ~10 chars per chunk
      const sseStream = this.createSSEStream(chunks, completionId, created, requestedModel);
      return new Response(sseStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Return full completion response
    return new Response(
      JSON.stringify({
        id: completionId,
        object: 'chat.completion',
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseContent,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: this.estimateTokens(messages.map((m) => m.content).join(' ')),
          completion_tokens: this.estimateTokens(responseContent),
          total_tokens: this.estimateTokens(
            messages.map((m) => m.content).join(' ') + responseContent
          ),
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * Generate mock LLM response based on input
   */
  private generateMockLLMResponse(input: string): string {
    const lowerInput = input.toLowerCase();

    // Weather-related
    if (lowerInput.includes('weather')) {
      return "I'm a mock server, so I can't check the real weather. However, I can tell you that it's always sunny in mock land! For actual weather information, you'd need to enable real API calls.";
    }

    // Time-related
    if (lowerInput.includes('time') || lowerInput.includes('date')) {
      return `The current mock time is ${new Date().toLocaleString()}. This is generated by the mock server for testing purposes.`;
    }

    // Greeting
    if (lowerInput.includes('hello') || lowerInput.includes('hi')) {
      return "Hello! I'm Atlas, your AI assistant (running in mock mode). How can I help you today?";
    }

    // Help
    if (lowerInput.includes('help')) {
      return "I'm here to help! As a mock server response, I can simulate various AI assistant capabilities. In production, I would be able to: search the web, manage files, take screenshots, run terminal commands, and much more.";
    }

    // Default response
    return `Thank you for your message: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}". This is a mock response from the Atlas test server. In production, I would provide a more contextual and helpful response.`;
  }

  /**
   * Split text into chunks for streaming
   */
  private splitIntoChunks(text: string, avgChunkSize: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      // Vary chunk size for realism
      const size = Math.max(1, Math.floor(avgChunkSize + (Math.random() - 0.5) * avgChunkSize));
      chunks.push(remaining.substring(0, size));
      remaining = remaining.substring(size);
    }

    return chunks;
  }

  /**
   * Create SSE stream for LLM streaming response
   */
  private createSSEStream(
    chunks: string[],
    completionId: string,
    created: number,
    model: string
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream({
      pull: async (controller) => {
        if (index >= chunks.length) {
          // Send final chunk
          const finalData = JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        const chunk = chunks[index];
        const data = JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk,
                role: index === 0 ? 'assistant' : undefined,
              },
              finish_reason: null,
            },
          ],
        });

        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        index++;

        // Add small delay between chunks for realism
        if (this.config.enableLatency) {
          await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
        }
      },
    });
  }

  /**
   * Estimate token count (simple approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  // ============================================================================
  // Recording & Replay
  // ============================================================================

  /**
   * Record a response for later replay
   */
  private async recordResponse(
    url: string,
    method: string,
    requestBody: BodyInit | null | undefined,
    response: Response,
    latencyMs: number
  ): Promise<void> {
    const key = this.getRecordingKey(url, method);

    let body: string | ArrayBuffer;
    const contentType = response.headers.get('Content-Type') || '';

    if (contentType.includes('application/json') || contentType.includes('text')) {
      body = await response.text();
    } else {
      body = await response.arrayBuffer();
    }

    const recorded: RecordedResponse = {
      timestamp: Date.now(),
      url,
      method,
      requestBody: requestBody ? this.parseRequestBody(requestBody) : undefined,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      latencyMs,
    };

    if (!this.recordings.has(key)) {
      this.recordings.set(key, []);
    }
    this.recordings.get(key)!.push(recorded);

    this.log(`Recorded response for: ${method} ${url}`);
  }

  /**
   * Parse request body for recording
   */
  private parseRequestBody(body: BodyInit): unknown {
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }
    return '[binary data]';
  }

  /**
   * Find a recorded response for replay
   */
  private findRecordedResponse(url: string, method: string): RecordedResponse | null {
    const key = this.getRecordingKey(url, method);
    const responses = this.recordings.get(key);

    if (!responses || responses.length === 0) {
      return null;
    }

    // Return the most recent recording
    return responses[responses.length - 1];
  }

  /**
   * Create a Response from recorded data
   */
  private createResponseFromRecording(recorded: RecordedResponse): Response {
    const body = typeof recorded.body === 'string'
      ? recorded.body
      : new Uint8Array(recorded.body as ArrayBuffer);

    return new Response(body, {
      status: recorded.statusCode,
      headers: recorded.headers,
    });
  }

  /**
   * Generate a recording key from URL and method
   */
  private getRecordingKey(url: string, method: string): string {
    // Normalize URL by removing query params for key generation
    const urlObj = new URL(url);
    const normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    return `${method}:${normalizedUrl}`;
  }

  /**
   * Save recordings to disk
   */
  private saveRecordings(): void {
    const dir = this.config.recordingsDir;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      for (const [key, responses] of this.recordings) {
        const filename = this.sanitizeFilename(key) + '.json';
        const filepath = path.join(dir, filename);

        // Convert ArrayBuffer to base64 for JSON storage
        const serializable = responses.map((r) => ({
          ...r,
          body: typeof r.body === 'string' ? r.body : Buffer.from(r.body).toString('base64'),
          bodyIsBase64: typeof r.body !== 'string',
        }));

        fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
        this.log(`Saved recording: ${filepath}`);
      }
    } catch (error) {
      this.log(`Failed to save recordings: ${(error as Error).message}`);
    }
  }

  /**
   * Load recordings from disk
   */
  private loadRecordings(): void {
    const dir = this.config.recordingsDir;

    try {
      if (!fs.existsSync(dir)) {
        this.log('No recordings directory found');
        return;
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        const filepath = path.join(dir, file);
        const content = fs.readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content) as Array<RecordedResponse & { bodyIsBase64?: boolean }>;

        // Convert base64 back to ArrayBuffer
        const responses = data.map((r) => ({
          ...r,
          body: r.bodyIsBase64
            ? Buffer.from(r.body as string, 'base64').buffer
            : r.body,
        }));

        const key = file.replace('.json', '').replace(/_/g, '/').replace(/-/g, ':');
        this.recordings.set(key, responses as RecordedResponse[]);
        this.log(`Loaded recording: ${file}`);
      }
    } catch (error) {
      this.log(`Failed to load recordings: ${(error as Error).message}`);
    }
  }

  /**
   * Sanitize a string for use as filename
   */
  private sanitizeFilename(str: string): string {
    return str.replace(/[/:]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get request log
   */
  getRequestLog(): Array<{ url: string; method: string; timestamp: number }> {
    return [...this.requestLog];
  }

  /**
   * Clear request log
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Get current configuration
   */
  getConfig(): MockServerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MockServerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if mock server is active
   */
  isServerActive(): boolean {
    return this.isActive;
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[MockServer] ${message}`);
    }
    this.emit('log', message);
  }
}

// ============================================================================
// Factory Functions & Utilities
// ============================================================================

/**
 * Create a mock server instance with default configuration
 */
export function createMockServer(config?: Partial<MockServerConfig>): MockServer {
  return new MockServer(config);
}

/**
 * Create a mock server configured for fast testing (no latency)
 */
export function createFastMockServer(config?: Partial<MockServerConfig>): MockServer {
  return new MockServer({
    enableLatency: false,
    ...config,
  });
}

/**
 * Create a mock server configured for recording real API responses
 */
export function createRecordingMockServer(
  recordingsDir?: string,
  config?: Partial<MockServerConfig>
): MockServer {
  return new MockServer({
    recordMode: true,
    recordingsDir: recordingsDir || './tests/mocks/recordings',
    enableLatency: false,
    ...config,
  });
}

/**
 * Create a mock server configured for replaying recorded responses
 */
export function createReplayMockServer(
  recordingsDir?: string,
  config?: Partial<MockServerConfig>
): MockServer {
  return new MockServer({
    replayMode: true,
    recordingsDir: recordingsDir || './tests/mocks/recordings',
    ...config,
  });
}

// ============================================================================
// Pre-configured Error Scenarios
// ============================================================================

/**
 * Common error scenarios for testing
 */
export const ErrorScenarios = {
  /** Rate limit exceeded */
  RATE_LIMIT: {
    probability: 1,
    statusCode: 429,
    message: 'Rate limit exceeded. Please retry after 60 seconds.',
    errorCode: 'rate_limit_exceeded',
  },

  /** Authentication failed */
  AUTH_FAILED: {
    probability: 1,
    statusCode: 401,
    message: 'Invalid API key provided.',
    errorCode: 'invalid_api_key',
  },

  /** Service unavailable */
  SERVICE_UNAVAILABLE: {
    probability: 1,
    statusCode: 503,
    message: 'Service temporarily unavailable.',
    errorCode: 'service_unavailable',
  },

  /** Internal server error */
  INTERNAL_ERROR: {
    probability: 1,
    statusCode: 500,
    message: 'Internal server error.',
    errorCode: 'internal_error',
  },

  /** Bad request */
  BAD_REQUEST: {
    probability: 1,
    statusCode: 400,
    message: 'Bad request. Check your input parameters.',
    errorCode: 'bad_request',
  },

  /** Timeout */
  TIMEOUT: {
    probability: 1,
    statusCode: 504,
    message: 'Gateway timeout. The server took too long to respond.',
    errorCode: 'timeout',
  },

  /** Intermittent error (50% probability) */
  INTERMITTENT: {
    probability: 0.5,
    statusCode: 500,
    message: 'Intermittent error occurred.',
    errorCode: 'intermittent_error',
  },

  /** Quota exceeded */
  QUOTA_EXCEEDED: {
    probability: 1,
    statusCode: 402,
    message: 'API quota exceeded. Please upgrade your plan.',
    errorCode: 'quota_exceeded',
  },
} as const;

// ============================================================================
// Vitest Integration
// ============================================================================

/**
 * Create mock server hooks for Vitest
 * Usage: const { beforeAll, afterAll } = createMockServerHooks();
 */
export function createMockServerHooks(config?: Partial<MockServerConfig>) {
  const server = new MockServer(config);

  return {
    server,
    beforeAll: () => server.start(),
    afterAll: () => server.stop(),
    beforeEach: () => server.clearRequestLog(),
    afterEach: () => server.clearAllErrorScenarios(),
  };
}

/**
 * Helper to set up mock server in a Vitest describe block
 */
export function setupMockServer(config?: Partial<MockServerConfig>): MockServer {
  const server = new MockServer(config);

  // These will be called by Vitest
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    // Start server if not active
    if (!server.isServerActive()) {
      server.start();
    }
    return global.fetch(input, init);
  });

  return server;
}

export default MockServer;
