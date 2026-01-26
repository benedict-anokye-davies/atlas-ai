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
  ATLAS_SYSTEM_PROMPT,
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
      const context = createConversationContext(ATLAS_SYSTEM_PROMPT, 'TestUser');

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
      const context = createConversationContext(ATLAS_SYSTEM_PROMPT, 'Bob');
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

  describe('ATLAS_SYSTEM_PROMPT', () => {
    it('should contain template variables', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('{timestamp}');
    });

    it('should define Atlas personality', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Atlas');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Ben');
      expect(ATLAS_SYSTEM_PROMPT).toContain('friend');
    });

    it('should include tool usage guidance', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Tool Usage');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Guidelines');
    });

    it('should include autonomy instructions', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Autonomy');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Act First');
    });

    it('should include core identity', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Core Identity');
    });

    it('should include memory awareness', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Memory');
      expect(ATLAS_SYSTEM_PROMPT).toContain('past conversations');
    });

    it('should include voice output guidance', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Voice Output');
      expect(ATLAS_SYSTEM_PROMPT).toContain('TTS');
    });

    it('should include capabilities awareness', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Capabilities');
      expect(ATLAS_SYSTEM_PROMPT).toContain('browser control');
    });

    it('should include proactive behavior', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Be Proactive');
    });

    it('should include context-aware behavior', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Read the Room');
    });

    it('should include emotional intelligence', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Emotional Intelligence');
      expect(ATLAS_SYSTEM_PROMPT).toContain('EMOTIONAL CONTEXT');
    });

    it('should include time awareness', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Time Awareness');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Late night');
    });

    it('should include voice dynamics', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Voice Dynamics');
      expect(ATLAS_SYSTEM_PROMPT).toContain('interrupt');
    });

    it('should include recovery patterns', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Recovery Patterns');
      expect(ATLAS_SYSTEM_PROMPT).toContain('File not found');
    });

    it('should include conversation flow', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Conversation Flow');
      expect(ATLAS_SYSTEM_PROMPT).toContain('First message');
    });

    it('should include user preferences guidance', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('User Preferences');
    });

    it('should include code quality standards', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Code Quality');
      expect(ATLAS_SYSTEM_PROMPT).toContain('readable code');
    });

    it('should include security awareness', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Security');
      expect(ATLAS_SYSTEM_PROMPT).toContain('API keys');
    });

    it('should include uncertainty expression', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('When Unsure');
      expect(ATLAS_SYSTEM_PROMPT).toContain('not certain');
    });

    it('should include clarification guidance', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Clarification');
      expect(ATLAS_SYSTEM_PROMPT).toContain('high stakes');
    });

    it('should include project context adaptation', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Project Context');
      expect(ATLAS_SYSTEM_PROMPT).toContain('TypeScript');
    });

    it('should include financial management expertise', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Financial Management');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Cash flow mastery');
      expect(ATLAS_SYSTEM_PROMPT).toContain('UK Tax intelligence');
    });

    it('should include trading and investing expertise', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Trading & Investing');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Position size');
      expect(ATLAS_SYSTEM_PROMPT).toContain('stop loss');
    });

    it('should include quant-level trading analysis', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Sharpe');
      expect(ATLAS_SYSTEM_PROMPT).toContain('drawdown');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Backtesting');
    });

    it('should include trading risk management', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Risk management');
      expect(ATLAS_SYSTEM_PROMPT).toContain('1-2% account risk');
      expect(ATLAS_SYSTEM_PROMPT).toContain('revenge');
    });

    it('should include business building expertise', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Business Building');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Serial Entrepreneur');
      expect(ATLAS_SYSTEM_PROMPT).toContain('paying customers');
    });

    it('should include freelance business guidance', () => {
      expect(ATLAS_SYSTEM_PROMPT).toContain('Client selection');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Pipeline');
      expect(ATLAS_SYSTEM_PROMPT).toContain('Pricing mastery');
    });
  });
});