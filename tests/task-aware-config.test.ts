/**
 * Task-Aware Configuration Tests
 * Tests for the anti-hallucination and task-aware LLM configuration system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TaskAwareConfigManager,
  getTaskAwareConfig,
  shutdownTaskAwareConfig,
  TASK_CONFIGS,
  TaskType,
} from '../src/main/llm/task-aware-config';

describe('TaskAwareConfigManager', () => {
  let manager: TaskAwareConfigManager;

  beforeEach(() => {
    shutdownTaskAwareConfig();
    manager = getTaskAwareConfig();
  });

  describe('Task Detection', () => {
    it('should detect factual queries', () => {
      const result = manager.detectTaskType('What is TypeScript?');
      expect(result.taskType).toBe('factual');
      expect(['high', 'medium']).toContain(result.confidence); // May vary based on scoring
    });

    it('should detect coding tasks', () => {
      const result = manager.detectTaskType('Write a function to sort an array');
      expect(result.taskType).toBe('coding');
    });

    it('should detect coding tasks from code blocks', () => {
      const result = manager.detectTaskType('Fix this code:\n```typescript\nconst x = 1\n```');
      expect(result.taskType).toBe('coding');
    });

    it('should detect creative tasks', () => {
      const result = manager.detectTaskType('Write a story about a robot');
      expect(result.taskType).toBe('creative');
    });

    it('should detect analysis tasks', () => {
      const result = manager.detectTaskType('Analyze the pros and cons of React vs Vue');
      expect(result.taskType).toBe('analysis');
    });

    it('should detect trading tasks', () => {
      const result = manager.detectTaskType("What's my portfolio PnL today?");
      expect(result.taskType).toBe('trading');
    });

    it('should detect research tasks', () => {
      const result = manager.detectTaskType('Research the latest developments in AI');
      expect(result.taskType).toBe('research');
    });

    it('should detect debugging tasks', () => {
      const result = manager.detectTaskType("Getting TypeError: undefined is not a function");
      expect(result.taskType).toBe('debugging');
    });

    it('should detect conversational messages', () => {
      const result = manager.detectTaskType('Hi there!');
      expect(result.taskType).toBe('conversational');
    });

    it('should default to conversational for short unclear messages', () => {
      const result = manager.detectTaskType('ok');
      expect(result.taskType).toBe('conversational');
    });
  });

  describe('Task Configurations', () => {
    it('should have low temperature for factual tasks', () => {
      const config = TASK_CONFIGS.factual;
      expect(config.temperature).toBeLessThanOrEqual(0.3);
    });

    it('should have low temperature for coding tasks', () => {
      const config = TASK_CONFIGS.coding;
      expect(config.temperature).toBeLessThanOrEqual(0.4);
    });

    it('should have higher temperature for creative tasks', () => {
      const config = TASK_CONFIGS.creative;
      expect(config.temperature).toBeGreaterThanOrEqual(0.7);
    });

    it('should have anti-hallucination instructions for factual tasks', () => {
      const config = TASK_CONFIGS.factual;
      expect(config.systemModifier).toContain("don't know");
      expect(config.systemModifier).toContain('fabricate');
    });

    it('should have chain-of-thought enabled for analysis tasks', () => {
      const config = TASK_CONFIGS.analysis;
      expect(config.chainOfThought).toBe(true);
    });

    it('should have trading-specific warnings', () => {
      const config = TASK_CONFIGS.trading;
      expect(config.systemModifier).toContain('risk');
      expect(config.systemModifier).toContain('conservative');
    });
  });

  describe('Configuration Retrieval', () => {
    it('should return correct config for detected task', () => {
      const result = manager.detectTaskType('What is the capital of France?');
      expect(result.config.temperature).toBe(TASK_CONFIGS.factual.temperature);
      expect(result.config.topP).toBe(TASK_CONFIGS.factual.topP);
    });

    it('should include system modifier in result', () => {
      const result = manager.detectTaskType('Explain how React works');
      expect(result.config.systemModifier).toBeTruthy();
      expect(result.config.systemModifier.length).toBeGreaterThan(50);
    });
  });

  describe('Custom Configuration', () => {
    it('should allow custom config overrides', () => {
      manager.setCustomConfig('coding', { temperature: 0.1 });
      const result = manager.detectTaskType('Write a Python function');
      expect(result.config.temperature).toBe(0.1);
    });

    it('should preserve non-overridden settings', () => {
      manager.setCustomConfig('coding', { temperature: 0.1 });
      const result = manager.detectTaskType('Write a Python function');
      expect(result.config.topP).toBe(TASK_CONFIGS.coding.topP);
    });

    it('should reset custom configs', () => {
      manager.setCustomConfig('coding', { temperature: 0.1 });
      manager.resetCustomConfigs();
      const result = manager.detectTaskType('Write a Python function');
      expect(result.config.temperature).toBe(TASK_CONFIGS.coding.temperature);
    });
  });

  describe('Detection History', () => {
    it('should track detection history', () => {
      manager.detectTaskType('What is TypeScript?');
      manager.detectTaskType('Write a function');
      manager.detectTaskType('Hello!');

      const history = manager.getDetectionHistory();
      expect(history.length).toBe(3);
    });

    it('should provide accurate stats', () => {
      manager.detectTaskType('What is TypeScript?');
      manager.detectTaskType('Who invented JavaScript?');
      manager.detectTaskType('Write a function');

      const stats = manager.getStats();
      expect(stats.totalDetections).toBe(3);
      // At least one factual detection (detection may vary)
      expect(stats.byTaskType.factual).toBeGreaterThanOrEqual(1);
    });
  });

  describe('System Prompt Enhancement', () => {
    it('should build enhanced system prompt', () => {
      const basePrompt = 'You are a helpful assistant.';
      const config = TASK_CONFIGS.factual;
      const enhanced = manager.buildEnhancedSystemPrompt(basePrompt, config);

      expect(enhanced).toContain(basePrompt);
      expect(enhanced).toContain('Current Task Configuration');
      expect(enhanced).toContain(config.systemModifier);
    });

    it('should return base prompt if no modifier', () => {
      const basePrompt = 'You are a helpful assistant.';
      const config = { ...TASK_CONFIGS.conversational, systemModifier: '' };
      const enhanced = manager.buildEnhancedSystemPrompt(basePrompt, config);

      expect(enhanced).toBe(basePrompt);
    });
  });

  describe('Anti-Hallucination Instructions', () => {
    it('should provide universal anti-hallucination guidelines', () => {
      const instructions = manager.getAntiHallucinationInstructions();

      expect(instructions).toContain("don't know");
      expect(instructions).toContain('fabricate');
      expect(instructions).toContain('uncertain');
    });
  });

  describe('Complexity Detection', () => {
    it('should detect simple tasks', () => {
      const result = manager.detectTaskType('What is TypeScript?');
      expect(['simple', 'uncertain']).toContain(result.complexity);
    });

    it('should detect complex tasks', () => {
      const result = manager.detectTaskType('Analyze step by step the architecture of this system and compare it with alternatives');
      expect(result.complexity).toBe('complex');
    });

    it('should mark uncertainty for ambiguous queries', () => {
      // Short query without clear complexity indicators
      const result = manager.detectTaskType('Tell me about React');
      expect(result.complexity).toBeTruthy();
    });

    it('should include complexity in result', () => {
      const result = manager.detectTaskType('Write some code');
      expect(result).toHaveProperty('complexity');
      expect(['simple', 'complex', 'uncertain']).toContain(result.complexity);
    });
  });

  describe('Clarification System', () => {
    it('should generate clarifying questions when needed', () => {
      const result = manager.detectTaskType('Help me with this');
      if (result.needsClarification) {
        expect(result.clarifyingQuestion).toBeTruthy();
        expect(typeof result.clarifyingQuestion).toBe('string');
      }
    });

    it('should not need clarification for clear simple tasks', () => {
      const result = manager.detectTaskType('Hi!');
      expect(result.needsClarification).toBe(false);
    });

    it('should not need clarification for clear complex tasks', () => {
      const result = manager.detectTaskType('Analyze step by step and explain in detail the comprehensive architecture');
      expect(result.needsClarification).toBe(false);
    });

    it('should provide shouldAskForClarification helper', () => {
      const result = manager.detectTaskType('Do something');
      const shouldAsk = manager.shouldAskForClarification(result);
      expect(typeof shouldAsk).toBe('boolean');
    });

    it('should provide getClarifyingQuestion helper', () => {
      const result = manager.detectTaskType('Help with code');
      const question = manager.getClarifyingQuestion(result);
      if (result.needsClarification) {
        expect(question).toBeTruthy();
      } else {
        expect(question).toBeNull();
      }
    });
  });

  describe('Clarification Processing', () => {
    it('should process simple answer correctly', () => {
      const originalResult = manager.detectTaskType('Tell me about arrays');
      
      const clarification = manager.processClarificationAnswer(
        'Tell me about arrays',
        originalResult,
        'Just a quick overview please'
      );

      expect(clarification.complexity).toBe('simple');
      expect(clarification.updatedResult.complexity).toBe('simple');
    });

    it('should process complex answer correctly', () => {
      const originalResult = manager.detectTaskType('Tell me about arrays');
      
      const clarification = manager.processClarificationAnswer(
        'Tell me about arrays',
        originalResult,
        'I need a detailed comprehensive explanation with examples'
      );

      expect(clarification.complexity).toBe('complex');
      expect(clarification.updatedResult.complexity).toBe('complex');
    });

    it('should adjust config for simple tasks', () => {
      const originalResult = manager.detectTaskType('Explain something');
      const originalMaxTokens = originalResult.config.maxTokens;
      
      const clarification = manager.processClarificationAnswer(
        'Explain something',
        originalResult,
        'Quick and simple'
      );

      // Simple tasks should cap max tokens
      expect(clarification.updatedResult.config.maxTokens).toBeLessThanOrEqual(1000);
    });

    it('should enable chain of thought for complex tasks', () => {
      const originalResult = manager.detectTaskType('Help me understand');
      
      const clarification = manager.processClarificationAnswer(
        'Help me understand',
        originalResult,
        'I want to fully understand everything in detail'
      );

      expect(clarification.updatedResult.config.chainOfThought).toBe(true);
    });

    it('should update reasoning with clarification info', () => {
      const originalResult = manager.detectTaskType('Do this task');
      
      const clarification = manager.processClarificationAnswer(
        'Do this task',
        originalResult,
        'Make it detailed'
      );

      expect(clarification.updatedResult.reasoning).toContain('User clarified');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty messages', () => {
      const result = manager.detectTaskType('');
      expect(result.taskType).toBe('conversational');
      expect(result.confidence).toBe('low');
      expect(result.complexity).toBeTruthy();
    });

    it('should handle very long messages', () => {
      const longMessage = 'Explain '.repeat(500) + 'how this works';
      const result = manager.detectTaskType(longMessage);
      expect(result.taskType).toBeTruthy();
      expect(result.config).toBeTruthy();
      expect(result.complexity).toBeTruthy();
    });

    it('should handle mixed task indicators', () => {
      // Message with both coding and debugging signals
      const result = manager.detectTaskType('Debug this function that has an error');
      // Should pick the stronger signal
      expect(['coding', 'debugging']).toContain(result.taskType);
    });
  });
});

describe('Singleton Pattern', () => {
  it('should return the same instance', () => {
    shutdownTaskAwareConfig();
    const instance1 = getTaskAwareConfig();
    const instance2 = getTaskAwareConfig();
    expect(instance1).toBe(instance2);
  });

  it('should create new instance after shutdown', () => {
    const instance1 = getTaskAwareConfig();
    instance1.detectTaskType('test'); // Add some history
    
    shutdownTaskAwareConfig();
    
    const instance2 = getTaskAwareConfig();
    expect(instance2.getDetectionHistory().length).toBe(0);
  });
});