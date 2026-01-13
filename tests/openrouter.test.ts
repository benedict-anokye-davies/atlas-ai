/**
 * Nova Desktop - OpenRouter LLM Tests
 * Tests for OpenRouter LLM provider and LLM Manager with fallback
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

import {
  OpenRouterLLM,
  createOpenRouterLLM,
  OPENROUTER_MODELS,
  DEFAULT_OPENROUTER_MODEL,
  OpenRouterModel,
} from '../src/main/llm/openrouter';
import {
  LLMManager,
  getLLMManager,
  shutdownLLMManager,
  LLMProviderType,
} from '../src/main/llm/manager';
import {
  LLMStatus,
  createConversationContext,
  NOVA_SYSTEM_PROMPT,
  estimateTokenCount,
} from '../src/shared/types/llm';

// ============================================
// OpenRouterLLM Tests
// ============================================

describe('OpenRouterLLM', () => {
  let llm: OpenRouterLLM;

  beforeEach(() => {
    vi.clearAllMocks();
    llm = new OpenRouterLLM({ apiKey: 'test-openrouter-key' });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Constructor', () => {
    it('should create instance with default config', () => {
      const instance = new OpenRouterLLM({ apiKey: 'test-key' });
      expect(instance.name).toBe('openrouter');
      expect(instance.status).toBe(LLMStatus.IDLE);
    });

    it('should throw without API key', () => {
      expect(() => new OpenRouterLLM({})).toThrow('OpenRouter API key is required');
    });

    it('should merge custom config with defaults', () => {
      const instance = new OpenRouterLLM({
        apiKey: 'test-key',
        model: 'openai/gpt-4o',
        temperature: 0.5,
      });

      const config = instance.getConfig();
      expect(config.model).toBe('openai/gpt-4o');
      expect(config.temperature).toBe(0.5);
      expect(config.maxTokens).toBe(2048); // Default
    });

    it('should use OpenRouter base URL by default', () => {
      const config = llm.getConfig();
      expect(config.baseURL).toBe('https://openrouter.ai/api/v1');
    });

    it('should use default model (Claude 3.5 Sonnet)', () => {
      const config = llm.getConfig();
      expect(config.model).toBe(DEFAULT_OPENROUTER_MODEL);
      expect(config.model).toBe('anthropic/claude-3.5-sonnet');
    });
  });

  describe('chat()', () => {
    it('should send message and return response', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [
          {
            message: { content: 'Hello from OpenRouter!' },
            finish_reason: 'stop',
          },
        ],
        model: 'anthropic/claude-3.5-sonnet',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
        },
      });

      const response = await llm.chat('Hello');

      expect(response.content).toBe('Hello from OpenRouter!');
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

      await expect(llm.chat('Hello')).rejects.toThrow('OpenRouter chat failed');
      expect(errorSpy).toHaveBeenCalled();
      expect(llm.status).toBe(LLMStatus.ERROR);
    });
  });

  describe('chatStream()', () => {
    it('should stream response chunks', async () => {
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
      llm.cancel();
      expect(llm.status).toBe(LLMStatus.IDLE);
    });
  });

  describe('Configuration', () => {
    it('should return config copy from getConfig()', () => {
      const config = llm.getConfig();
      expect(config.apiKey).toBe('test-openrouter-key');

      // Modifying returned config shouldn't affect internal config
      config.apiKey = 'modified';
      expect(llm.getConfig().apiKey).toBe('test-openrouter-key');
    });

    it('should update config with updateConfig()', () => {
      llm.updateConfig({ temperature: 0.9 });
      expect(llm.getConfig().temperature).toBe(0.9);
    });

    it('should allow changing models', () => {
      llm.updateConfig({ model: 'openai/gpt-4o-mini' });
      expect(llm.getConfig().model).toBe('openai/gpt-4o-mini');
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

  describe('Cost Tracking', () => {
    it('should track costs after request', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      await llm.chat('Hello');

      const costs = llm.getCosts();
      expect(costs.requests).toBe(1);
      expect(costs.promptTokens).toBe(100);
      expect(costs.completionTokens).toBe(50);
      expect(costs.totalCost).toBeGreaterThan(0);
    });

    it('should accumulate costs across requests', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await llm.chat('Hello');
      await llm.chat('Hi again');

      const costs = llm.getCosts();
      expect(costs.requests).toBe(2);
      expect(costs.promptTokens).toBe(200);
      expect(costs.completionTokens).toBe(100);
    });

    it('should track costs by model', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await llm.chat('Hello');

      const costs = llm.getCosts();
      expect(costs.byModel['anthropic/claude-3.5-sonnet']).toBeDefined();
      expect(costs.byModel['anthropic/claude-3.5-sonnet'].requests).toBe(1);
    });

    it('should reset costs', async () => {
      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await llm.chat('Hello');
      expect(llm.getCosts().requests).toBe(1);

      llm.resetCosts();

      const costs = llm.getCosts();
      expect(costs.requests).toBe(0);
      expect(costs.totalCost).toBe(0);
      expect(costs.promptTokens).toBe(0);
    });
  });

  describe('Static Methods', () => {
    it('should return available models', () => {
      const models = OpenRouterLLM.getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models[0]).toHaveProperty('pricing');
    });

    it('should get model info by ID', () => {
      const model = OpenRouterLLM.getModelInfo('anthropic/claude-3.5-sonnet');
      expect(model).toBeDefined();
      expect(model?.name).toBe('Claude 3.5 Sonnet');
    });

    it('should return undefined for unknown model', () => {
      const model = OpenRouterLLM.getModelInfo('unknown/model');
      expect(model).toBeUndefined();
    });
  });
});

describe('createOpenRouterLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create instance with API key', () => {
    const instance = createOpenRouterLLM('test-api-key');
    expect(instance).toBeInstanceOf(OpenRouterLLM);
    expect(instance.getConfig().apiKey).toBe('test-api-key');
  });

  it('should accept additional config', () => {
    const instance = createOpenRouterLLM('test-api-key', { temperature: 0.3 });
    expect(instance.getConfig().temperature).toBe(0.3);
  });
});

describe('OPENROUTER_MODELS', () => {
  it('should include Claude models', () => {
    expect(OPENROUTER_MODELS['anthropic/claude-3.5-sonnet']).toBeDefined();
    expect(OPENROUTER_MODELS['anthropic/claude-3-opus']).toBeDefined();
    expect(OPENROUTER_MODELS['anthropic/claude-3-haiku']).toBeDefined();
  });

  it('should include OpenAI models', () => {
    expect(OPENROUTER_MODELS['openai/gpt-4-turbo']).toBeDefined();
    expect(OPENROUTER_MODELS['openai/gpt-4o']).toBeDefined();
    expect(OPENROUTER_MODELS['openai/gpt-4o-mini']).toBeDefined();
  });

  it('should include open source models', () => {
    expect(OPENROUTER_MODELS['meta-llama/llama-3.1-70b-instruct']).toBeDefined();
    expect(OPENROUTER_MODELS['mistralai/mistral-large']).toBeDefined();
    expect(OPENROUTER_MODELS['deepseek/deepseek-chat']).toBeDefined();
  });

  it('should have pricing info for all models', () => {
    Object.values(OPENROUTER_MODELS).forEach((model: OpenRouterModel) => {
      expect(model.pricing).toBeDefined();
      expect(model.pricing.prompt).toBeGreaterThanOrEqual(0);
      expect(model.pricing.completion).toBeGreaterThanOrEqual(0);
    });
  });

  it('should have context length for all models', () => {
    Object.values(OPENROUTER_MODELS).forEach((model: OpenRouterModel) => {
      expect(model.contextLength).toBeGreaterThan(0);
    });
  });
});

// ============================================
// LLMManager Tests
// ============================================

describe('LLMManager', () => {
  let manager: LLMManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    shutdownLLMManager();
  });

  afterEach(() => {
    vi.clearAllTimers();
    shutdownLLMManager();
  });

  describe('Constructor', () => {
    it('should create instance with no providers if no API keys', () => {
      manager = new LLMManager({});
      expect(manager.name).toBe('llm-manager');
      expect(manager.getActiveProviderType()).toBeNull();
    });

    it('should initialize with Fireworks as primary', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
      });
      expect(manager.getActiveProviderType()).toBe('fireworks');
    });

    it('should prefer OpenRouter when configured', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
        preferOpenRouter: true,
      });
      expect(manager.getActiveProviderType()).toBe('openrouter');
    });

    it('should fallback to OpenRouter if only OpenRouter available', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });
      expect(manager.getActiveProviderType()).toBe('openrouter');
    });
  });

  describe('chat()', () => {
    it('should route to active provider', async () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'test',
      });

      const response = await manager.chat('Hello');
      expect(response.content).toBe('Response');
    });

    it('should throw if no provider available', async () => {
      manager = new LLMManager({});
      await expect(manager.chat('Hello')).rejects.toThrow('No LLM provider available');
    });

    it('should use shared context across requests', async () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
        sharedContext: true,
      });

      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'test',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      // Create shared context
      manager.createContext('TestUser');

      await manager.chat('Hello');
      await manager.chat('Hi again');

      const context = manager.getCurrentContext();
      expect(context?.messages.length).toBe(4); // 2 user + 2 assistant messages
    });
  });

  describe('chatStream()', () => {
    it('should stream from active provider', async () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      async function* mockStream() {
        yield { choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] };
      }

      mockChatCompletions.create.mockResolvedValue(mockStream());

      const chunks: string[] = [];
      for await (const chunk of manager.chatStream('Test')) {
        chunks.push(chunk.delta);
        if (chunk.isFinal) break;
      }

      expect(chunks).toContain('Hi');
    });
  });

  describe('Provider Switching', () => {
    it('should allow manual switching between providers', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
      });

      expect(manager.getActiveProviderType()).toBe('fireworks');

      manager.switchToProvider('openrouter');
      expect(manager.getActiveProviderType()).toBe('openrouter');

      manager.switchToProvider('fireworks');
      expect(manager.getActiveProviderType()).toBe('fireworks');
    });

    it('should throw when switching to unavailable provider', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      expect(() => manager.switchToProvider('fireworks')).toThrow('Provider fireworks not available');
    });

    it('should emit provider-switch event', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
      });

      const switchSpy = vi.fn();
      manager.on('provider-switch', switchSpy);

      manager.switchToProvider('openrouter');

      expect(switchSpy).toHaveBeenCalledWith('fireworks', 'openrouter', 'Manual switch');
    });
  });

  describe('Fallback Detection', () => {
    it('should report when using fallback', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
        preferOpenRouter: false,
      });

      expect(manager.isUsingFallback()).toBe(false);

      manager.switchToProvider('openrouter');
      expect(manager.isUsingFallback()).toBe(true);
    });

    it('should not report fallback when OpenRouter is preferred', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
        openrouter: { apiKey: 'openrouter-key' },
        preferOpenRouter: true,
      });

      expect(manager.isUsingFallback()).toBe(false);
    });
  });

  describe('Context Management', () => {
    it('should create shared context', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
        sharedContext: true,
      });

      const context = manager.createContext('Alice');
      expect(context.userName).toBe('Alice');
      expect(manager.getCurrentContext()).toBe(context);
    });

    it('should clear context from all providers', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
        sharedContext: true,
      });

      manager.createContext();
      expect(manager.getCurrentContext()).not.toBeNull();

      manager.clearContext();
      expect(manager.getCurrentContext()).toBeNull();
    });
  });

  describe('Cost Tracking', () => {
    it('should get costs from OpenRouter provider', async () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await manager.chat('Hello');

      const costs = manager.getCosts();
      expect(costs).not.toBeNull();
      expect(costs?.requests).toBe(1);
    });

    it('should return null costs if no OpenRouter provider', () => {
      manager = new LLMManager({
        fireworks: { apiKey: 'fireworks-key' },
      });

      expect(manager.getCosts()).toBeNull();
    });

    it('should reset costs', async () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      mockChatCompletions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        model: 'anthropic/claude-3.5-sonnet',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

      await manager.chat('Hello');
      expect(manager.getCosts()?.requests).toBe(1);

      manager.resetCosts();
      expect(manager.getCosts()?.requests).toBe(0);
    });
  });

  describe('cancel()', () => {
    it('should cancel active provider', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      // Should not throw
      manager.cancel();
    });
  });

  describe('Utility Methods', () => {
    it('should estimate tokens', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      const tokens = manager.estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens even without provider', () => {
      manager = new LLMManager({});

      const tokens = manager.estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should get config from active provider', () => {
      manager = new LLMManager({
        openrouter: { apiKey: 'openrouter-key' },
      });

      const config = manager.getConfig();
      expect(config.apiKey).toBe('openrouter-key');
    });
  });
});

describe('getLLMManager / shutdownLLMManager', () => {
  beforeEach(() => {
    shutdownLLMManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    shutdownLLMManager();
  });

  it('should return singleton instance', () => {
    const manager1 = getLLMManager({
      openrouter: { apiKey: 'openrouter-key' },
    });
    const manager2 = getLLMManager();

    expect(manager1).toBe(manager2);
  });

  it('should shutdown and allow new instance', () => {
    const manager1 = getLLMManager({
      openrouter: { apiKey: 'openrouter-key' },
    });

    shutdownLLMManager();

    const manager2 = getLLMManager({
      openrouter: { apiKey: 'different-key' },
    });

    expect(manager1).not.toBe(manager2);
  });
});
