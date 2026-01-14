/**
 * OpenRouter Mock Utilities
 * Mock implementations for OpenRouter API for testing LLM fallback functionality
 */

import { vi } from 'vitest';

/**
 * Creates a mock OpenRouter chat completion response
 */
export function createMockOpenRouterCompletion(content: string, model = 'anthropic/claude-3-haiku') {
  return {
    choices: [
      {
        message: { content, role: 'assistant' },
        finish_reason: 'stop',
        index: 0,
      },
    ],
    model,
    usage: {
      prompt_tokens: 50,
      completion_tokens: content.split(' ').length * 2,
      total_tokens: 50 + content.split(' ').length * 2,
    },
    id: `gen-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    object: 'chat.completion',
  };
}

/**
 * Creates a mock streaming response for OpenRouter
 */
export async function* createMockOpenRouterStream(chunks: string[]) {
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    yield {
      choices: [
        {
          delta: { content: chunks[i], role: i === 0 ? 'assistant' : undefined },
          finish_reason: isLast ? 'stop' : null,
          index: 0,
        },
      ],
      id: `gen-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: 'anthropic/claude-3-haiku',
      object: 'chat.completion.chunk',
    };
  }
}

/**
 * Creates a mock OpenRouter client
 */
export function createMockOpenRouterClient() {
  const mockCreate = vi.fn();

  return {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    _mockCreate: mockCreate,
  };
}

/**
 * Creates mock model list response
 */
export function createMockModelsResponse() {
  return {
    data: [
      {
        id: 'anthropic/claude-3-haiku',
        name: 'Claude 3 Haiku',
        pricing: { prompt: '0.00025', completion: '0.00125' },
      },
      {
        id: 'openai/gpt-4-turbo',
        name: 'GPT-4 Turbo',
        pricing: { prompt: '0.01', completion: '0.03' },
      },
      {
        id: 'google/gemini-pro',
        name: 'Gemini Pro',
        pricing: { prompt: '0.000125', completion: '0.000375' },
      },
    ],
  };
}

/**
 * Sets up mock for non-streaming response
 */
export function setupMockOpenRouterNonStreaming(
  mockClient: ReturnType<typeof createMockOpenRouterClient>,
  content: string,
  model?: string
) {
  mockClient._mockCreate.mockResolvedValue(createMockOpenRouterCompletion(content, model));
}

/**
 * Sets up mock for streaming response
 */
export function setupMockOpenRouterStreaming(
  mockClient: ReturnType<typeof createMockOpenRouterClient>,
  chunks: string[]
) {
  mockClient._mockCreate.mockResolvedValue(createMockOpenRouterStream(chunks));
}

/**
 * Sets up mock error response
 */
export function setupMockOpenRouterError(
  mockClient: ReturnType<typeof createMockOpenRouterClient>,
  errorMessage: string
) {
  mockClient._mockCreate.mockRejectedValue(new Error(errorMessage));
}
