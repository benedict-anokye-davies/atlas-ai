/**
 * Nova Personality Manager
 *
 * Manages Nova's personality, generating appropriate system prompts,
 * enhancing responses with emotional flavor, and detecting user emotions
 * for visualization state mapping.
 *
 * @module agent/personality-manager
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import {
  PersonalityConfig,
  PersonalityTraits,
  PersonalityPreset,
  NovaEmotion,
  UserEmotion,
  VoiceState,
  PartialPersonalityConfig,
  DEFAULT_NOVA_PERSONALITY,
  PERSONALITY_PRESETS,
} from '../../shared/types/personality';

const logger = createModuleLogger('PersonalityManager');

// ============================================================================
// Emotion Detection Patterns
// ============================================================================

/** Patterns for detecting user emotions from text */
const USER_EMOTION_PATTERNS: Record<UserEmotion, RegExp[]> = {
  happy: [
    /\b(happy|glad|great|awesome|wonderful|amazing|fantastic|excellent|love|thanks|thank you)\b/i,
    /[😊😄😃🎉👍❤️💕🙂]/,
    /!\s*$/,
  ],
  sad: [
    /\b(sad|unfortunately|disappointed|upset|down|depressed|miss|lost|sorry|regret)\b/i,
    /[😢😭😔😞💔]/,
    /\b(not working|failed|broken|stuck)\b/i,
  ],
  angry: [
    /\b(angry|mad|furious|annoyed|frustrated|hate|stupid|terrible|worst|awful)\b/i,
    /[😠😡🤬]/,
    /!{2,}/,
  ],
  excited: [
    /\b(excited|can't wait|amazing|incredible|wow|omg|awesome|yes|finally)\b/i,
    /[🎉🚀✨🔥💪😍]/,
    /!{2,}/,
    /\b(so|really|very)\s+(cool|great|good|nice)\b/i,
  ],
  frustrated: [
    /\b(frustrated|stuck|confused|don't understand|doesn't work|keeps?\s+failing)\b/i,
    /\b(why\s+(won't|doesn't|can't|isn't))\b/i,
    /[😤😩😫]/,
    /\?\s*!|\!\s*\?/,
  ],
  neutral: [],
};

/** Patterns for detecting response emotions */
const RESPONSE_EMOTION_PATTERNS: Record<NovaEmotion, RegExp[]> = {
  happy: [/\b(glad|happy|great|wonderful|love)\b/i, /!/],
  excited: [/\b(wow|amazing|fascinating|incredible|awesome)\b/i, /!{2,}/],
  thinking: [/\b(hmm|let me think|considering|processing)\b/i, /\.\.\./],
  confused: [/\b(unclear|not sure|tricky|complicated)\b/i],
  empathetic: [/\b(understand|hear you|sorry to|that's tough)\b/i],
  playful: [/\b(haha|fun|interesting|curious)\b/i, /[😄🎉]/],
  focused: [/\b(on it|working|analyzing|checking)\b/i],
  sad: [/\b(unfortunately|sadly|sorry)\b/i],
};

/** Maps emotions to voice states for visualization */
const EMOTION_TO_VOICE_STATE: Record<NovaEmotion, VoiceState> = {
  happy: 'speaking',
  excited: 'speaking',
  thinking: 'thinking',
  confused: 'thinking',
  empathetic: 'speaking',
  playful: 'speaking',
  focused: 'thinking',
  sad: 'speaking',
};

// ============================================================================
// PersonalityManager Class
// ============================================================================

/**
 * Events emitted by PersonalityManager
 */
export interface PersonalityManagerEvents {
  /** Personality preset changed */
  'preset-changed': (preset: PersonalityPreset, config: PersonalityConfig) => void;
  /** Personality trait updated */
  'trait-updated': (trait: keyof PersonalityTraits, value: number) => void;
  /** Emotion detected from user */
  'user-emotion': (emotion: UserEmotion, confidence: number) => void;
  /** Emotion detected for response */
  'response-emotion': (emotion: NovaEmotion) => void;
}

/**
 * Manages Nova's personality system.
 *
 * Responsibilities:
 * - Generate system prompts based on personality traits
 * - Enhance responses with emotional flavor
 * - Detect user emotions for visualization
 * - Manage personality presets and customization
 *
 * @example
 * ```typescript
 * const manager = new PersonalityManager();
 *
 * // Get system prompt for LLM
 * const prompt = manager.getSystemPrompt();
 *
 * // Enhance a response with emotion
 * const enhanced = manager.enhanceResponse("Here's the answer", 'excited');
 *
 * // Detect user emotion
 * const emotion = manager.detectUserEmotion("This is so frustrating!");
 * ```
 */
export class PersonalityManager extends EventEmitter {
  private config: PersonalityConfig;
  private currentPreset: PersonalityPreset;
  private responseCount: number = 0;

  constructor(config?: PartialPersonalityConfig, preset: PersonalityPreset = 'nova') {
    super();
    this.currentPreset = preset;
    this.config = this.mergeConfig(PERSONALITY_PRESETS[preset], config);
    logger.info('PersonalityManager initialized', { preset, name: this.config.name });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get current personality configuration
   */
  public getConfig(): PersonalityConfig {
    return { ...this.config };
  }

  /**
   * Get current personality preset
   */
  public getPreset(): PersonalityPreset {
    return this.currentPreset;
  }

  /**
   * Get personality traits
   */
  public getTraits(): PersonalityTraits {
    return { ...this.config.traits };
  }

  /**
   * Switch to a different personality preset
   */
  public setPreset(preset: PersonalityPreset, customOverrides?: PartialPersonalityConfig): void {
    const baseConfig = PERSONALITY_PRESETS[preset];
    this.config = this.mergeConfig(baseConfig, customOverrides);
    this.currentPreset = preset;
    this.emit('preset-changed', preset, this.config);
    logger.info('Personality preset changed', { preset, name: this.config.name });
  }

  /**
   * Update a specific personality trait
   */
  public setTrait(trait: keyof PersonalityTraits, value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value));
    this.config.traits[trait] = clampedValue;
    this.currentPreset = 'custom';
    this.emit('trait-updated', trait, clampedValue);
    logger.debug('Personality trait updated', { trait, value: clampedValue });
  }

  /**
   * Update multiple configuration options
   */
  public updateConfig(updates: PartialPersonalityConfig): void {
    this.config = this.mergeConfig(this.config, updates);
    this.currentPreset = 'custom';
    logger.debug('Personality config updated', { updates });
  }

  // ==========================================================================
  // System Prompt Generation
  // ==========================================================================

  /**
   * Generate system prompt for LLM based on personality traits.
   *
   * This prompt shapes how the LLM responds, incorporating personality
   * traits into the AI's communication style.
   *
   * @param additionalContext - Optional additional context to include
   * @returns System prompt string for LLM
   */
  public getSystemPrompt(additionalContext?: string): string {
    const { name, archetype, traits, responseStyle } = this.config;

    // Build personality description from traits
    const personalityDesc = this.buildPersonalityDescription(traits);

    // Build response style guidelines
    const styleGuidelines = this.buildStyleGuidelines(responseStyle, traits);

    let prompt = `You are ${name}, ${archetype}.

${personalityDesc}

${styleGuidelines}`;

    if (additionalContext) {
      prompt += `\n\n${additionalContext}`;
    }

    return prompt;
  }

  /**
   * Build personality description from traits
   */
  private buildPersonalityDescription(traits: PersonalityTraits): string {
    const descriptions: string[] = [];

    // Friendliness
    if (traits.friendliness >= 0.8) {
      descriptions.push('You are warm, welcoming, and genuinely care about helping.');
    } else if (traits.friendliness >= 0.5) {
      descriptions.push('You are polite and helpful.');
    } else {
      descriptions.push('You are professional and efficient.');
    }

    // Formality
    if (traits.formality <= 0.3) {
      descriptions.push('You speak casually, using contractions and conversational language.');
    } else if (traits.formality >= 0.7) {
      descriptions.push('You maintain a formal, professional tone.');
    }

    // Humor
    if (traits.humor >= 0.7) {
      descriptions.push('You enjoy wordplay and light humor when appropriate.');
    } else if (traits.humor <= 0.2) {
      descriptions.push('You keep interactions focused and serious.');
    }

    // Curiosity
    if (traits.curiosity >= 0.8) {
      descriptions.push("You're genuinely curious and often ask thoughtful follow-up questions.");
    } else if (traits.curiosity >= 0.5) {
      descriptions.push('You occasionally ask clarifying questions.');
    }

    // Energy
    if (traits.energy >= 0.8) {
      descriptions.push('You bring enthusiasm and positive energy to conversations.');
    } else if (traits.energy <= 0.3) {
      descriptions.push('You are calm and measured in your responses.');
    }

    // Patience
    if (traits.patience >= 0.8) {
      descriptions.push("You take time to explain things clearly and don't rush.");
    }

    return descriptions.join(' ');
  }

  /**
   * Build response style guidelines
   */
  private buildStyleGuidelines(
    style: PersonalityConfig['responseStyle'],
    traits: PersonalityTraits
  ): string {
    const guidelines: string[] = ['Response Guidelines:'];

    // Brevity
    guidelines.push(
      `- Keep responses concise (${style.maxSentences} sentences or less for simple questions).`
    );

    // Contractions
    if (style.useContractions) {
      guidelines.push("- Use contractions naturally (I'm, you're, don't, etc.).");
    } else {
      guidelines.push('- Avoid contractions; use full forms (I am, you are, do not).');
    }

    // Emojis
    if (style.useEmojis) {
      guidelines.push('- Use emojis sparingly to add warmth.');
    } else {
      guidelines.push('- Do not use emojis.');
    }

    // Follow-ups based on curiosity
    if (traits.curiosity >= 0.7 && style.followUpFrequency > 0.3) {
      guidelines.push('- Ask follow-up questions to better understand needs.');
    }

    // General
    guidelines.push('- Be direct and helpful while maintaining your personality.');
    guidelines.push("- If you don't know something, say so honestly.");

    return guidelines.join('\n');
  }

  // ==========================================================================
  // Response Enhancement
  // ==========================================================================

  /**
   * Enhance a response with emotional flavor based on personality.
   *
   * Randomly adds catchphrases, emotional interjections, or actions
   * based on personality settings and detected emotion.
   *
   * @param response - Original response text
   * @param emotion - Optional emotion to express
   * @returns Enhanced response (may be unchanged)
   */
  public enhanceResponse(response: string, emotion?: NovaEmotion): string {
    this.responseCount++;

    // Don't enhance every response - use catchphrase frequency
    const shouldEnhance = Math.random() < this.config.responseStyle.catchphraseFrequency;

    if (!shouldEnhance && !emotion) {
      return response;
    }

    let enhanced = response;

    // Add emotional phrase if emotion provided
    if (emotion && this.config.emotionalResponses[emotion]?.length > 0) {
      const phrases = this.config.emotionalResponses[emotion];
      const phrase = this.randomChoice(phrases);

      // 50% chance prefix, 50% chance suffix
      if (Math.random() > 0.5) {
        enhanced = `${phrase} ${enhanced}`;
      } else {
        // Only add as suffix if response doesn't end with the phrase
        if (!enhanced.endsWith(phrase)) {
          enhanced = `${enhanced} ${phrase}`;
        }
      }
    }

    // Occasionally add catchphrase (if enabled and we have them)
    if (
      shouldEnhance &&
      this.config.catchphrases.length > 0 &&
      Math.random() < this.config.responseStyle.catchphraseFrequency
    ) {
      const catchphrase = this.randomChoice(this.config.catchphrases);
      // Add catchphrase as prefix with newline
      enhanced = `${catchphrase}\n${enhanced}`;
    }

    if (enhanced !== response) {
      this.emit('response-emotion', emotion || 'happy');
    }

    return enhanced;
  }

  /**
   * Detect emotion from response text for visualization state mapping.
   *
   * Uses scoring system to find best matching emotion. Higher-intensity
   * emotions (excited, playful) get priority over lower-intensity (happy)
   * when scores are equal.
   *
   * @param response - Response text to analyze
   * @returns Detected emotion and corresponding voice state
   */
  public detectResponseEmotion(response: string): { emotion: NovaEmotion; voiceState: VoiceState } {
    const scores: Record<NovaEmotion, number> = {
      happy: 0,
      excited: 0,
      thinking: 0,
      confused: 0,
      empathetic: 0,
      playful: 0,
      focused: 0.1, // Small base score for default
      sad: 0,
    };

    // Priority bonus for higher-intensity emotions (breaks ties)
    const priorityBonus: Record<NovaEmotion, number> = {
      excited: 0.05,
      playful: 0.03,
      empathetic: 0.02,
      thinking: 0.01,
      confused: 0.01,
      happy: 0,
      focused: 0,
      sad: 0,
    };

    // Score each emotion based on pattern matches
    for (const [emotion, patterns] of Object.entries(RESPONSE_EMOTION_PATTERNS) as [
      NovaEmotion,
      RegExp[],
    ][]) {
      for (const pattern of patterns) {
        if (pattern.test(response)) {
          scores[emotion] += 0.3;
        }
      }
      // Add priority bonus
      scores[emotion] += priorityBonus[emotion];
    }

    // Find highest scoring emotion
    let maxEmotion: NovaEmotion = 'focused';
    let maxScore = scores.focused;

    for (const [emotion, score] of Object.entries(scores) as [NovaEmotion, number][]) {
      if (score > maxScore) {
        maxScore = score;
        maxEmotion = emotion;
      }
    }

    return {
      emotion: maxEmotion,
      voiceState: EMOTION_TO_VOICE_STATE[maxEmotion],
    };
  }

  // ==========================================================================
  // User Emotion Detection
  // ==========================================================================

  /**
   * Detect emotion from user input text.
   *
   * Uses scoring system to find best matching emotion. Higher-intensity
   * emotions (excited, angry, frustrated) get priority over lower-intensity
   * (happy) when scores are equal.
   *
   * @param text - User input text
   * @returns Detected emotion with confidence score
   */
  public detectUserEmotion(text: string): { emotion: UserEmotion; confidence: number } {
    const scores: Record<UserEmotion, number> = {
      happy: 0,
      sad: 0,
      angry: 0,
      excited: 0,
      frustrated: 0,
      neutral: 0.3, // Base score for neutral
    };

    // Priority bonus for higher-intensity emotions (breaks ties)
    const priorityBonus: Record<UserEmotion, number> = {
      excited: 0.05,
      angry: 0.04,
      frustrated: 0.03,
      sad: 0.02,
      happy: 0,
      neutral: 0,
    };

    // Check each emotion's patterns
    for (const [emotion, patterns] of Object.entries(USER_EMOTION_PATTERNS) as [
      UserEmotion,
      RegExp[],
    ][]) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          scores[emotion] += 0.3;
        }
      }
      // Add priority bonus
      scores[emotion] += priorityBonus[emotion];
    }

    // Find highest scoring emotion
    let maxEmotion: UserEmotion = 'neutral';
    let maxScore = scores.neutral;

    for (const [emotion, score] of Object.entries(scores) as [UserEmotion, number][]) {
      if (score > maxScore) {
        maxScore = score;
        maxEmotion = emotion;
      }
    }

    // Normalize confidence to 0-1 (subtract priority bonus for accurate confidence)
    const confidence = Math.min(1, maxScore - priorityBonus[maxEmotion]);

    this.emit('user-emotion', maxEmotion, confidence);
    logger.debug('User emotion detected', { emotion: maxEmotion, confidence });

    return { emotion: maxEmotion, confidence };
  }

  /**
   * Map user emotion to suggested Nova response emotion
   */
  public mapUserEmotionToResponse(userEmotion: UserEmotion): NovaEmotion {
    const mapping: Record<UserEmotion, NovaEmotion> = {
      happy: 'happy',
      sad: 'empathetic',
      angry: 'empathetic',
      excited: 'excited',
      frustrated: 'empathetic',
      neutral: 'focused',
    };
    return mapping[userEmotion];
  }

  // ==========================================================================
  // Greeting & Farewell
  // ==========================================================================

  /**
   * Get personalized greeting message
   */
  public getGreeting(): string {
    return this.config.greeting;
  }

  /**
   * Get random farewell message
   */
  public getFarewell(): string {
    return this.randomChoice(this.config.farewells);
  }

  /**
   * Get random action description for flavor
   */
  public getAction(): string {
    return this.randomChoice(this.config.actions);
  }

  /**
   * Get random catchphrase
   */
  public getCatchphrase(): string | null {
    if (this.config.catchphrases.length === 0) return null;
    return this.randomChoice(this.config.catchphrases);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Merge partial config with base config
   */
  private mergeConfig(
    base: PersonalityConfig,
    overrides?: PartialPersonalityConfig
  ): PersonalityConfig {
    if (!overrides) return { ...base };

    return {
      ...base,
      ...overrides,
      traits: {
        ...base.traits,
        ...(overrides.traits || {}),
      },
      responseStyle: {
        ...base.responseStyle,
        ...(overrides.responseStyle || {}),
      },
      emotionalResponses: {
        ...base.emotionalResponses,
        ...(overrides.emotionalResponses || {}),
      },
    };
  }

  /**
   * Get random element from array
   */
  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Reset response counter (for testing)
   */
  public resetResponseCount(): void {
    this.responseCount = 0;
  }

  /**
   * Get response count (for analytics)
   */
  public getResponseCount(): number {
    return this.responseCount;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let personalityManagerInstance: PersonalityManager | null = null;

/**
 * Get or create the PersonalityManager singleton instance.
 *
 * @param config - Optional configuration overrides (only used on first call)
 * @returns PersonalityManager instance
 */
export function getPersonalityManager(config?: Partial<PersonalityConfig>): PersonalityManager {
  if (!personalityManagerInstance) {
    personalityManagerInstance = new PersonalityManager(config);
    logger.info('PersonalityManager singleton created');
  }
  return personalityManagerInstance;
}

/**
 * Shutdown and cleanup PersonalityManager singleton.
 */
export function shutdownPersonalityManager(): void {
  if (personalityManagerInstance) {
    personalityManagerInstance.removeAllListeners();
    personalityManagerInstance = null;
    logger.info('PersonalityManager shutdown complete');
  }
}

/**
 * Reset PersonalityManager singleton (for testing).
 */
export function resetPersonalityManager(): void {
  personalityManagerInstance = null;
}
