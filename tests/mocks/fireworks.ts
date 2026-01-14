/**
 * Fireworks AI Mock Utilities
 * Mock implementations for Fireworks AI (OpenAI-compatible) for testing LLM functionality
 */

import { vi } from 'vitest';

/**
 * Creates a mock chat completion response
 */
export function createMockChatCompletion(content: string, finishReason = 'stop') {
  return {
    choices: [
      {
        message: { content, role: 'assistant' },
        finish_reason: finishReason,
        index: 0,
      },
    ],
    model: 'accounts/fireworks/models/deepseek-r1',
    usage: {
      prompt_tokens: 50,
      completion_tokens: content.split(' ').length * 2,
      total_tokens: 50 + content.split(' ').length * 2,
    },
    id: `chatcmpl-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    object: 'chat.completion',
  };
}

/**
 * Creates a mock streaming response generator
 */
export async function* createMockStreamingResponse(chunks: string[]) {
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
      id: `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: 'accounts/fireworks/models/deepseek-r1',
      object: 'chat.completion.chunk',
    };
  }
}

/**
 * Creates a mock OpenAI client for Fireworks
 */
export function createMockFireworksClient() {
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
 * Sets up mock client for non-streaming response
 */
export function setupMockNonStreamingResponse(
  mockClient: ReturnType<typeof createMockFireworksClient>,
  content: string
) {
  mockClient._mockCreate.mockResolvedValue(createMockChatCompletion(content));
}

/**
 * Sets up mock client for streaming response
 */
export function setupMockStreamingResponse(
  mockClient: ReturnType<typeof createMockFireworksClient>,
  chunks: string[]
) {
  mockClient._mockCreate.mockResolvedValue(createMockStreamingResponse(chunks));
}

/**
 * Sets up mock client to return an error
 */
export function setupMockError(
  mockClient: ReturnType<typeof createMockFireworksClient>,
  errorMessage: string
) {
  mockClient._mockCreate.mockRejectedValue(new Error(errorMessage));
}

/**
 * Factory function to create OpenAI SDK mock
 */
export function createOpenAIMock() {
  const mockClient = createMockFireworksClient();
  return {
    default: vi.fn(() => mockClient),
    _mockClient: mockClient,
  };
}
