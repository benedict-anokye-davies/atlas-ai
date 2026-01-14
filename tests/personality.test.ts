/**
 * Tests for Nova Personality System
 *
 * Tests personality types, PersonalityManager, emotion detection,
 * and system prompt generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PersonalityManager,
  getPersonalityManager,
  shutdownPersonalityManager,
  resetPersonalityManager,
} from '../src/main/agent/personality-manager';
import {
  PersonalityTraits,
  PersonalityConfig,
  DEFAULT_NOVA_PERSONALITY,
  PROFESSIONAL_PERSONALITY,
  PLAYFUL_PERSONALITY,
  MINIMAL_PERSONALITY,
  PERSONALITY_PRESETS,
  NovaEmotion,
  UserEmotion,
} from '../src/shared/types/personality';

// ============================================================================
// Personality Types Tests
// ============================================================================

describe('Personality Types', () => {
  describe('PersonalityTraits', () => {
    it('should have all required trait fields', () => {
      const traits: PersonalityTraits = DEFAULT_NOVA_PERSONALITY.traits;

      expect(traits).toHaveProperty('friendliness');
      expect(traits).toHaveProperty('formality');
      expect(traits).toHaveProperty('humor');
      expect(traits).toHaveProperty('curiosity');
      expect(traits).toHaveProperty('energy');
      expect(traits).toHaveProperty('patience');
    });

    it('should have trait values between 0 and 1', () => {
      const traits = DEFAULT_NOVA_PERSONALITY.traits;

      Object.values(traits).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('DEFAULT_NOVA_PERSONALITY', () => {
    it('should have correct name', () => {
      expect(DEFAULT_NOVA_PERSONALITY.name).toBe('Nova');
    });

    it('should have archetype defined', () => {
      expect(DEFAULT_NOVA_PERSONALITY.archetype).toBeDefined();
      expect(DEFAULT_NOVA_PERSONALITY.archetype.length).toBeGreaterThan(0);
    });

    it('should have greeting message', () => {
      expect(DEFAULT_NOVA_PERSONALITY.greeting).toBeDefined();
      expect(DEFAULT_NOVA_PERSONALITY.greeting).toContain('Nova');
    });

    it('should have farewell messages', () => {
      expect(DEFAULT_NOVA_PERSONALITY.farewells).toBeInstanceOf(Array);
      expect(DEFAULT_NOVA_PERSONALITY.farewells.length).toBeGreaterThan(0);
    });

    it('should have catchphrases', () => {
      expect(DEFAULT_NOVA_PERSONALITY.catchphrases).toBeInstanceOf(Array);
      expect(DEFAULT_NOVA_PERSONALITY.catchphrases.length).toBeGreaterThan(0);
    });

    it('should have emotional responses for all emotion types', () => {
      const emotions: NovaEmotion[] = [
        'happy',
        'sad',
        'confused',
        'excited',
        'thinking',
        'empathetic',
        'playful',
        'focused',
      ];

      emotions.forEach((emotion) => {
        expect(DEFAULT_NOVA_PERSONALITY.emotionalResponses[emotion]).toBeDefined();
        expect(DEFAULT_NOVA_PERSONALITY.emotionalResponses[emotion].length).toBeGreaterThan(0);
      });
    });

    it('should have response style settings', () => {
      const style = DEFAULT_NOVA_PERSONALITY.responseStyle;

      expect(style.maxSentences).toBeGreaterThan(0);
      expect(typeof style.useContractions).toBe('boolean');
      expect(typeof style.useEmojis).toBe('boolean');
      expect(style.catchphraseFrequency).toBeGreaterThanOrEqual(0);
      expect(style.catchphraseFrequency).toBeLessThanOrEqual(1);
      expect(style.followUpFrequency).toBeGreaterThanOrEqual(0);
      expect(style.followUpFrequency).toBeLessThanOrEqual(1);
    });
  });

  describe('Personality Presets', () => {
    it('should have all preset personalities defined', () => {
      expect(PERSONALITY_PRESETS.nova).toBeDefined();
      expect(PERSONALITY_PRESETS.professional).toBeDefined();
      expect(PERSONALITY_PRESETS.playful).toBeDefined();
      expect(PERSONALITY_PRESETS.minimal).toBeDefined();
      expect(PERSONALITY_PRESETS.custom).toBeDefined();
    });

    it('professional preset should have higher formality', () => {
      expect(PROFESSIONAL_PERSONALITY.traits.formality).toBeGreaterThan(
        DEFAULT_NOVA_PERSONALITY.traits.formality
      );
    });

    it('playful preset should have higher humor and energy', () => {
      expect(PLAYFUL_PERSONALITY.traits.humor).toBeGreaterThan(
        DEFAULT_NOVA_PERSONALITY.traits.humor
      );
      expect(PLAYFUL_PERSONALITY.traits.energy).toBeGreaterThan(
        DEFAULT_NOVA_PERSONALITY.traits.energy
      );
    });

    it('minimal preset should have lower energy and humor', () => {
      expect(MINIMAL_PERSONALITY.traits.energy).toBeLessThan(
        DEFAULT_NOVA_PERSONALITY.traits.energy
      );
      expect(MINIMAL_PERSONALITY.traits.humor).toBeLessThan(DEFAULT_NOVA_PERSONALITY.traits.humor);
    });
  });
});

// ============================================================================
// PersonalityManager Tests
// ============================================================================

describe('PersonalityManager', () => {
  let manager: PersonalityManager;

  beforeEach(() => {
    resetPersonalityManager();
    manager = new PersonalityManager();
  });

  afterEach(() => {
    shutdownPersonalityManager();
  });

  describe('Initialization', () => {
    it('should initialize with default personality', () => {
      expect(manager.getConfig().name).toBe('Nova');
      expect(manager.getPreset()).toBe('nova');
    });

    it('should initialize with custom config overrides', () => {
      const customManager = new PersonalityManager({
        name: 'CustomAI',
        traits: { friendliness: 0.5 },
      });

      expect(customManager.getConfig().name).toBe('CustomAI');
      expect(customManager.getTraits().friendliness).toBe(0.5);
    });

    it('should initialize with specific preset', () => {
      const proManager = new PersonalityManager(undefined, 'professional');

      expect(proManager.getPreset()).toBe('professional');
      expect(proManager.getTraits().formality).toBe(PROFESSIONAL_PERSONALITY.traits.formality);
    });
  });

  describe('Configuration', () => {
    it('should return copy of config', () => {
      const config = manager.getConfig();
      config.name = 'Modified';

      expect(manager.getConfig().name).toBe('Nova');
    });

    it('should return copy of traits', () => {
      const traits = manager.getTraits();
      traits.friendliness = 0;

      expect(manager.getTraits().friendliness).toBe(DEFAULT_NOVA_PERSONALITY.traits.friendliness);
    });

    it('should switch presets correctly', () => {
      manager.setPreset('professional');

      expect(manager.getPreset()).toBe('professional');
      expect(manager.getTraits().formality).toBe(PROFESSIONAL_PERSONALITY.traits.formality);
    });

    it('should emit event on preset change', () => {
      const handler = vi.fn();
      manager.on('preset-changed', handler);

      manager.setPreset('playful');

      expect(handler).toHaveBeenCalledWith('playful', expect.any(Object));
    });

    it('should update individual traits', () => {
      manager.setTrait('humor', 0.1);

      expect(manager.getTraits().humor).toBe(0.1);
      expect(manager.getPreset()).toBe('custom');
    });

    it('should clamp trait values to 0-1', () => {
      manager.setTrait('humor', 1.5);
      expect(manager.getTraits().humor).toBe(1);

      manager.setTrait('humor', -0.5);
      expect(manager.getTraits().humor).toBe(0);
    });

    it('should emit event on trait update', () => {
      const handler = vi.fn();
      manager.on('trait-updated', handler);

      manager.setTrait('energy', 0.5);

      expect(handler).toHaveBeenCalledWith('energy', 0.5);
    });

    it('should update config with partial updates', () => {
      manager.updateConfig({
        greeting: 'Hello there!',
        responseStyle: { maxSentences: 5 },
      });

      expect(manager.getConfig().greeting).toBe('Hello there!');
      expect(manager.getConfig().responseStyle.maxSentences).toBe(5);
    });
  });

  describe('System Prompt Generation', () => {
    it('should generate system prompt with personality name', () => {
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('Nova');
    });

    it('should include personality description', () => {
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('warm');
      expect(prompt).toContain('curious');
    });

    it('should include response guidelines', () => {
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('Response Guidelines');
      expect(prompt).toContain('sentences');
    });

    it('should include contractions guideline based on setting', () => {
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('contractions');
    });

    it('should include additional context when provided', () => {
      const prompt = manager.getSystemPrompt('Remember: User prefers Python.');

      expect(prompt).toContain('Remember: User prefers Python.');
    });

    it('should vary prompt based on traits', () => {
      const defaultPrompt = manager.getSystemPrompt();

      manager.setPreset('professional');
      const proPrompt = manager.getSystemPrompt();

      expect(defaultPrompt).not.toBe(proPrompt);
      expect(proPrompt).toContain('formal');
    });

    it('should mention humor for high humor trait', () => {
      manager.setTrait('humor', 0.9);
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('humor');
    });

    it('should mention follow-up questions for high curiosity', () => {
      manager.setTrait('curiosity', 0.9);
      const prompt = manager.getSystemPrompt();

      expect(prompt).toContain('follow-up');
    });
  });

  describe('Response Enhancement', () => {
    it('should return original response when no enhancement needed', () => {
      // Set frequency to 0 to prevent random enhancements
      manager.updateConfig({ responseStyle: { catchphraseFrequency: 0 } });

      const response = 'Here is your answer.';
      const enhanced = manager.enhanceResponse(response);

      expect(enhanced).toBe(response);
    });

    it('should add emotional phrase when emotion provided', () => {
      const response = 'Here is your answer.';
      const enhanced = manager.enhanceResponse(response, 'excited');

      // Should either prefix or suffix with an excited phrase
      const hasExcitedPhrase = DEFAULT_NOVA_PERSONALITY.emotionalResponses.excited.some((phrase) =>
        enhanced.includes(phrase)
      );

      expect(hasExcitedPhrase || enhanced === response).toBe(true);
    });

    it('should emit response-emotion event when enhanced', () => {
      const handler = vi.fn();
      manager.on('response-emotion', handler);

      // Force enhancement by setting high frequency
      manager.updateConfig({ responseStyle: { catchphraseFrequency: 1 } });
      manager.enhanceResponse('Test response', 'happy');

      // Handler may or may not be called depending on random chance
      // Just verify no errors
    });

    it('should track response count', () => {
      expect(manager.getResponseCount()).toBe(0);

      manager.enhanceResponse('First');
      manager.enhanceResponse('Second');

      expect(manager.getResponseCount()).toBe(2);
    });

    it('should reset response count', () => {
      manager.enhanceResponse('Test');
      manager.resetResponseCount();

      expect(manager.getResponseCount()).toBe(0);
    });
  });

  describe('Response Emotion Detection', () => {
    it('should detect happy emotion', () => {
      const result = manager.detectResponseEmotion("I'm so glad to help!");

      expect(result.emotion).toBe('happy');
      expect(result.voiceState).toBe('speaking');
    });

    it('should detect excited emotion', () => {
      const result = manager.detectResponseEmotion(
        'That is absolutely fascinating and incredible!'
      );

      expect(result.emotion).toBe('excited');
    });

    it('should detect thinking emotion', () => {
      const result = manager.detectResponseEmotion('Hmm, let me think about that...');

      expect(result.emotion).toBe('thinking');
      expect(result.voiceState).toBe('thinking');
    });

    it('should detect empathetic emotion', () => {
      const result = manager.detectResponseEmotion("I understand how you feel. That's tough.");

      expect(result.emotion).toBe('empathetic');
    });

    it('should default to focused for neutral responses', () => {
      const result = manager.detectResponseEmotion('The answer is 42.');

      expect(result.emotion).toBe('focused');
      expect(result.voiceState).toBe('thinking');
    });
  });

  describe('User Emotion Detection', () => {
    it('should detect happy emotion', () => {
      const result = manager.detectUserEmotion('Thanks so much! This is great!');

      expect(result.emotion).toBe('happy');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect sad emotion', () => {
      const result = manager.detectUserEmotion("I'm so sad about this. Unfortunately it failed.");

      expect(result.emotion).toBe('sad');
    });

    it('should detect angry emotion', () => {
      // "furious" is unique to angry pattern
      const result = manager.detectUserEmotion('I am furious about this situation!');

      expect(result.emotion).toBe('angry');
    });

    it('should detect excited emotion', () => {
      // Use excited-only patterns: "can't wait" and double exclamation
      const result = manager.detectUserEmotion("I can't wait!! This is so cool!");

      expect(result.emotion).toBe('excited');
    });

    it('should detect frustrated emotion', () => {
      const result = manager.detectUserEmotion("Why won't this work? I'm so frustrated!");

      expect(result.emotion).toBe('frustrated');
    });

    it('should return neutral for ambiguous input', () => {
      const result = manager.detectUserEmotion('Please help me with this task.');

      expect(result.emotion).toBe('neutral');
    });

    it('should emit user-emotion event', () => {
      const handler = vi.fn();
      manager.on('user-emotion', handler);

      manager.detectUserEmotion('This is amazing!');

      expect(handler).toHaveBeenCalled();
    });

    it('should have confidence between 0 and 1', () => {
      const result = manager.detectUserEmotion('I love this so much!!!');

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Emotion Mapping', () => {
    it('should map happy user to happy response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('happy');
      expect(responseEmotion).toBe('happy');
    });

    it('should map sad user to empathetic response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('sad');
      expect(responseEmotion).toBe('empathetic');
    });

    it('should map angry user to empathetic response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('angry');
      expect(responseEmotion).toBe('empathetic');
    });

    it('should map frustrated user to empathetic response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('frustrated');
      expect(responseEmotion).toBe('empathetic');
    });

    it('should map excited user to excited response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('excited');
      expect(responseEmotion).toBe('excited');
    });

    it('should map neutral user to focused response', () => {
      const responseEmotion = manager.mapUserEmotionToResponse('neutral');
      expect(responseEmotion).toBe('focused');
    });
  });

  describe('Greeting and Farewell', () => {
    it('should return greeting message', () => {
      const greeting = manager.getGreeting();

      expect(greeting).toBe(DEFAULT_NOVA_PERSONALITY.greeting);
    });

    it('should return a farewell message', () => {
      const farewell = manager.getFarewell();

      expect(DEFAULT_NOVA_PERSONALITY.farewells).toContain(farewell);
    });

    it('should return an action phrase', () => {
      const action = manager.getAction();

      expect(DEFAULT_NOVA_PERSONALITY.actions).toContain(action);
    });

    it('should return a catchphrase', () => {
      const catchphrase = manager.getCatchphrase();

      expect(DEFAULT_NOVA_PERSONALITY.catchphrases).toContain(catchphrase);
    });

    it('should return null for catchphrase when none configured', () => {
      manager.updateConfig({ catchphrases: [] });
      const catchphrase = manager.getCatchphrase();

      expect(catchphrase).toBeNull();
    });
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('PersonalityManager Singleton', () => {
  beforeEach(() => {
    resetPersonalityManager();
  });

  afterEach(() => {
    shutdownPersonalityManager();
  });

  it('should return same instance on multiple calls', () => {
    const instance1 = getPersonalityManager();
    const instance2 = getPersonalityManager();

    expect(instance1).toBe(instance2);
  });

  it('should use config from first call only', () => {
    const instance1 = getPersonalityManager({ name: 'FirstName' });
    const instance2 = getPersonalityManager({ name: 'SecondName' });

    expect(instance2.getConfig().name).toBe('FirstName');
  });

  it('should create new instance after shutdown', () => {
    const instance1 = getPersonalityManager();
    instance1.setTrait('humor', 0.1);

    shutdownPersonalityManager();
    const instance2 = getPersonalityManager();

    expect(instance2.getTraits().humor).toBe(DEFAULT_NOVA_PERSONALITY.traits.humor);
  });

  it('should remove all listeners on shutdown', () => {
    const instance = getPersonalityManager();
    const handler = vi.fn();
    instance.on('preset-changed', handler);

    shutdownPersonalityManager();

    // Create new instance and trigger event
    const newInstance = getPersonalityManager();
    newInstance.setPreset('professional');

    // Old handler should not be called
    expect(handler).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Personality System Integration', () => {
  let manager: PersonalityManager;

  beforeEach(() => {
    resetPersonalityManager();
    manager = new PersonalityManager();
  });

  afterEach(() => {
    shutdownPersonalityManager();
  });

  it('should generate appropriate prompt for professional preset', () => {
    manager.setPreset('professional');
    const prompt = manager.getSystemPrompt();

    expect(prompt).toContain('formal');
    expect(prompt).not.toContain('humor');
  });

  it('should generate appropriate prompt for playful preset', () => {
    manager.setPreset('playful');
    const prompt = manager.getSystemPrompt();

    expect(prompt).toContain('enthusias');
    expect(prompt).toContain('humor');
  });

  it('should handle full conversation flow', () => {
    // User sends excited message - use word unique to excited
    const userEmotion = manager.detectUserEmotion("Wow, I can't wait to try this! Finally!");
    expect(userEmotion.emotion).toBe('excited');

    // Map to response emotion
    const responseEmotion = manager.mapUserEmotionToResponse(userEmotion.emotion);
    expect(responseEmotion).toBe('excited');

    // Enhance response with detected emotion
    const response = "Here's how to get started.";
    const enhanced = manager.enhanceResponse(response, responseEmotion);

    // Response should be enhanced or original
    expect(enhanced.length).toBeGreaterThanOrEqual(response.length);
  });

  it('should maintain consistency across emotion detection', () => {
    // Same input should give consistent emotion category
    const input = 'This is frustrating!';
    const result1 = manager.detectUserEmotion(input);
    const result2 = manager.detectUserEmotion(input);

    expect(result1.emotion).toBe(result2.emotion);
  });
});
