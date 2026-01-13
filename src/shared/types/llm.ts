/**
 * Nova Desktop - LLM Types
 * Language Model type definitions
 */

import { EventEmitter } from 'events';

/**
 * Chat message role
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * Chat message in conversation
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp?: number;
  tokens?: number;
}

/**
 * LLM response from a completion
 */
export interface LLMResponse {
  /** The generated text */
  content: string;
  /** Model used for generation */
  model: string;
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | null;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Response latency in ms */
  latency?: number;
  /** Raw response from provider */
  raw?: unknown;
}

/**
 * Streaming chunk from LLM
 */
export interface LLMStreamChunk {
  /** The text delta */
  delta: string;
  /** Accumulated text so far */
  accumulated: string;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** Finish reason (only on final chunk) */
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error' | null;
}

/**
 * LLM configuration options
 */
export interface LLMConfig {
  /** API key for the LLM service */
  apiKey: string;
  /** Base URL for API (for custom endpoints) */
  baseURL?: string;
  /** Model identifier */
  model?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2, higher = more creative) */
  temperature?: number;
  /** Top P sampling */
  topP?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Stop sequences */
  stop?: string[];
  /** Request timeout in ms */
  timeout?: number;
  /** Enable streaming */
  stream?: boolean;
}

/**
 * Conversation context for maintaining chat history
 */
export interface ConversationContext {
  /** Unique conversation ID */
  id: string;
  /** Conversation messages */
  messages: ChatMessage[];
  /** System prompt */
  systemPrompt: string;
  /** User name for personalization */
  userName?: string;
  /** Created timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Total tokens used in conversation */
  totalTokens: number;
}

/**
 * LLM provider status
 */
export enum LLMStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  GENERATING = 'generating',
  STREAMING = 'streaming',
  ERROR = 'error',
}

/**
 * LLM events emitted by the provider
 */
export interface LLMEvents {
  /** Emitted when status changes */
  status: (status: LLMStatus) => void;
  /** Emitted for each streaming chunk */
  chunk: (chunk: LLMStreamChunk) => void;
  /** Emitted when response is complete */
  response: (response: LLMResponse) => void;
  /** Emitted on error */
  error: (error: Error) => void;
  /** Emitted when conversation context changes */
  contextUpdate: (context: ConversationContext) => void;
}

/**
 * Base interface for LLM providers
 */
export interface LLMProvider extends EventEmitter {
  /** Provider name */
  readonly name: string;
  /** Current status */
  readonly status: LLMStatus;
  
  /** Send a message and get response */
  chat(message: string, context?: ConversationContext): Promise<LLMResponse>;
  /** Send a message with streaming response */
  chatStream(message: string, context?: ConversationContext): AsyncGenerator<LLMStreamChunk>;
  /** Cancel ongoing generation */
  cancel(): void;
  /** Get provider configuration */
  getConfig(): LLMConfig;
  /** Estimate tokens for a message */
  estimateTokens(text: string): number;
  
  // Event emitter methods with proper typing
  on<K extends keyof LLMEvents>(event: K, listener: LLMEvents[K]): this;
  off<K extends keyof LLMEvents>(event: K, listener: LLMEvents[K]): this;
  emit<K extends keyof LLMEvents>(event: K, ...args: Parameters<LLMEvents[K]>): boolean;
}

/**
 * Default LLM configuration
 */
export const DEFAULT_LLM_CONFIG: Partial<LLMConfig> = {
  maxTokens: 2048,
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  timeout: 30000,
  stream: true,
};

/**
 * Nova system prompt template
 */
export const NOVA_SYSTEM_PROMPT = `You are Nova, a helpful and friendly AI assistant. You are:
- Concise but thorough in your responses
- Proactive in offering help and suggestions
- Honest about your limitations
- Warm but professional in tone

Current time: {timestamp}
User name: {userName}

You are a voice assistant, so keep responses conversational and natural. Avoid:
- Long lists or complex formatting
- Code blocks unless specifically asked
- Excessive punctuation or special characters

When asked to do something, focus on being helpful and getting things done.`;

/**
 * Create a conversation context
 */
export function createConversationContext(
  systemPrompt: string = NOVA_SYSTEM_PROMPT,
  userName?: string
): ConversationContext {
  return {
    id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    messages: [],
    systemPrompt,
    userName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalTokens: 0,
  };
}

/**
 * Token estimation constants (rough approximation)
 * Average English word is ~4 characters, 1 token ≈ 4 characters
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for text (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
