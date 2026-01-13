/**
 * Nova Desktop - LLM Tests
 * Tests for Fireworks AI LLM module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI client
const mockChatCompletions = {
  create: vi.fn(),
};

const mockOpenAIClient = {
  chat: {
    completions: mockChatCompletions,
  },
};

vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAIClient),
}));

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock electron
vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
}));

import { FireworksLLM, createFireworksLLM } from '../src/main/llm/fireworks';
import {
  LLMStatus,
  DEFAULT_LLM_CONFIG,
  NOVA_SYSTEM_PROMPT,
  createConversationContext,
  estimateTokenCount,
} from '../src/shared/types/llm';

describe('FireworksLLM', () => {
  let llm: FireworksLLM;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new FireworksLLM({ apiKey: 'test-api-key' });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new FireworksLLM({ apiKey: 'test-key' });
      expect(instance.name).toBe('fireworks');
      expect(instance.status).toBe(LLMStatus.IDLE);
    });

    it('should throw without API key', () => {
      expect(() => new FireworksLLM({})).toThrow('Fireworks API key is required');
    });

    it('should merge custom config with defaults', () => {
      const instance = new FireworksLLM({
        apiKey: 'test-key',
        model: 'accounts/fireworks/models/llama-v3-70b',
        temperature: 0.5,
      });

      const config = instance.getConfig();
      expect(config.model).toBe('accounts/fireworks/models/llama-v3-70b');
      expect(config.temperature).toBe(0.5);
      expect(config.maxTokens).toBe(2048); // Default
    });

    it('should use Fireworks base URL by default', () => {
      const config = llm.getConfig();
      expect(config.baseURL).toBe('https://api.fireworks.ai/inference/v1');
    });
  });

  describe('chat()', () => {
    it('should send message and return response', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [
          {
            message: { content: 'Hello! How can I help you?' },
            finish_reason: 'stop',
          },
        ],
        model: 'deepseek-r1',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
        },
      });

      const response = await llm.chat('Hello');

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.totalTokens).toBe(60);
    });

    it('should transition through status states', async () => {
      const statusChanges: LLMStatus[] = [];
      llm.on('status', (status) => statusChanges.push(status));

      mockChatCompletions.create.mockResolvedValue({
        choices: [
          { message: { content: 'Hi' }, finish_reason: 'stop' },
        ],
        model: 'test',
      });

      await llm.chat('Hello');

      expect(statusChanges).toContain(LLMStatus.CONNECTING);
      expect(statusChanges).toContain(LLMStatus.GENERATING);
      expect(statusChanges).toContain(LLMStatus.IDLE);
    });

    it('should emit response event', async () => {
      const responseSpy = vi.fn();
      llm.on('response', responseSpy);

      mockChatCompletions.create.mockResolvedValue({
        choices: [
          { message: { content: 'Response' }, finish_reason: 'stop' },
        ],
        model: 'test',
      });

      await llm.chat('Hello');

      expect(responseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Response',
        })
      );
    });

    it('should update context with messages', async () => {
      const context = createConversationContext(NOVA_SYSTEM_PROMPT, 'TestUser');

      mockChatCompletions.create.mockResolvedValue({
        choices: [
          { message: { content: 'Hi TestUser!' }, finish_reason: 'stop' },
        ],
        model: 'test',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await llm.chat('Hello', context);

      expect(context.messages.length).toBe(2);
      expect(context.messages[0].role).toBe('user');
      expect(context.messages[0].content).toBe('Hello');
      expect(context.messages[1].role).toBe('assistant');
      expect(context.messages[1].content).toBe('Hi TestUser!');
    });

    it('should handle errors', async () => {
      const errorSpy = vi.fn();
      llm.on('error', errorSpy);

      mockChatCompletions.create.mockRejectedValue(new Error('API Error'));

      await expect(llm.chat('Hello')).rejects.toThrow('Fireworks chat failed');
      expect(errorSpy).toHaveBeenCalled();
      expect(llm.status).toBe(LLMStatus.ERROR);
    });
  });

  describe('chatStream()', () => {
    it('should stream response chunks', async () => {
      // Create an async generator for streaming
      async function* mockStream() {
        yield { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: ' World' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] };
      }

      mockChatCompletions.create.mockResolvedValue(mockStream());

      const chunks: string[] = [];
      for await (const chunk of llm.chatStream('Hi')) {
        chunks.push(chunk.delta);
        if (chunk.isFinal) break;
      }

      expect(chunks).toEqual(['Hello', ' World', '!']);
    });

    it('should accumulate text in chunks', async () => {
      async function* mockStream() {
        yield { choices: [{ delta: { content: 'A' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'B' }, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'C' }, finish_reason: 'stop' }] };
      }

      mockChatCompletions.create.mockResolvedValue(mockStream());

      let lastAccumulated = '';
      for await (const chunk of llm.chatStream('Test')) {
        lastAccumulated = chunk.accumulated;
        if (chunk.isFinal) break;
      }

      expect(lastAccumulated).toBe('ABC');
    });

    it('should emit chunk events', async () => {
      const chunkSpy = vi.fn();
      llm.on('chunk', chunkSpy);

      async function* mockStream() {
        yield { choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] };
      }

      mockChatCompletions.create.mockResolvedValue(mockStream());

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of llm.chatStream('Test')) {
        // Consume stream
      }

      expect(chunkSpy).toHaveBeenCalled();
    });
  });

  describe('cancel()', () => {
    it('should set status to IDLE when called', () => {
      // Verify cancel sets status correctly
      llm.cancel();
      expect(llm.status).toBe(LLMStatus.IDLE);
    });
  });

  describe('Configuration', () => {
    it('should return config copy from getConfig()', () => {
      const config = llm.getConfig();
      expect(config.apiKey).toBe('test-api-key');

      // Modifying returned config shouldn't affect internal config
      config.apiKey = 'modified';
      expect(llm.getConfig().apiKey).toBe('test-api-key');
    });

    it('should update config with updateConfig()', () => {
      llm.updateConfig({ temperature: 0.9 });
      expect(llm.getConfig().temperature).toBe(0.9);
    });
  });

  describe('Context Management', () => {
    it('should create new conversation context', () => {
      const context = llm.createContext('Alice');

      expect(context.id).toMatch(/^conv_/);
      expect(context.userName).toBe('Alice');
      expect(context.messages).toEqual([]);
    });

    it('should clear conversation context', () => {
      llm.createContext();
      expect(llm.getCurrentContext()).not.toBeNull();

      llm.clearContext();
      expect(llm.getCurrentContext()).toBeNull();
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens for text', () => {
      const tokens = llm.estimateTokens('Hello, how are you today?');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });
  });
});

describe('createFireworksLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create instance with API key', () => {
    const instance = createFireworksLLM('test-api-key');
    expect(instance).toBeInstanceOf(FireworksLLM);
    expect(instance.getConfig().apiKey).toBe('test-api-key');
  });

  it('should accept additional config', () => {
    const instance = createFireworksLLM('test-api-key', { temperature: 0.3 });
    expect(instance.getConfig().temperature).toBe(0.3);
  });
});

describe('LLM Types and Utilities', () => {
  describe('createConversationContext', () => {
    it('should create context with defaults', () => {
      const context = createConversationContext();

      expect(context.id).toMatch(/^conv_/);
      expect(context.messages).toEqual([]);
      expect(context.totalTokens).toBe(0);
    });

    it('should include user name if provided', () => {
      const context = createConversationContext(NOVA_SYSTEM_PROMPT, 'Bob');
      expect(context.userName).toBe('Bob');
    });
  });

  describe('estimateTokenCount', () => {
    it('should estimate tokens based on character count', () => {
      expect(estimateTokenCount('')).toBe(0);
      expect(estimateTokenCount('test')).toBe(1);
      expect(estimateTokenCount('hello world')).toBe(3); // 11 chars / 4 ≈ 3
    });
  });

  describe('DEFAULT_LLM_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_LLM_CONFIG.maxTokens).toBe(2048);
      expect(DEFAULT_LLM_CONFIG.temperature).toBe(0.7);
      expect(DEFAULT_LLM_CONFIG.stream).toBe(true);
    });
  });

  describe('NOVA_SYSTEM_PROMPT', () => {
    it('should contain template variables', () => {
      expect(NOVA_SYSTEM_PROMPT).toContain('{timestamp}');
      expect(NOVA_SYSTEM_PROMPT).toContain('{userName}');
    });

    it('should define Nova personality', () => {
      expect(NOVA_SYSTEM_PROMPT).toContain('Nova');
      expect(NOVA_SYSTEM_PROMPT).toContain('helpful');
      expect(NOVA_SYSTEM_PROMPT).toContain('friendly');
    });
  });
});
