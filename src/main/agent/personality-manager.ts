/**
 * Atlas Personality Manager
 *
 * Manages Atlas's personality, generating appropriate system prompts,
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
  AtlasEmotion,
  UserEmotion,
  VoiceState,
  PartialPersonalityConfig,
  PERSONALITY_PRESETS,
  CodingContext,
  ConversationState,
  getContextualResponse,
  getWellnessPhrase,
  VoiceMode,
  VoiceModeConfig,
  VOICE_MODES,
} from '../../shared/types/personality';

const logger = createModuleLogger('PersonalityManager');

// ============================================================================
// Emotion Detection Patterns
// ============================================================================

/** Patterns for detecting user emotions from text */
const USER_EMOTION_PATTERNS: Record<UserEmotion, RegExp[]> = {
  happy: [
    /\b(happy|glad|great|awesome|wonderful|amazing|fantastic|excellent|love|thanks|thank you)\b/i,
    /[\u{1F600}-\u{1F64F}\u{1F44D}\u{2764}\u{1F495}]/u,
    /!\s*$/,
  ],
  sad: [
    /\b(sad|unfortunately|disappointed|upset|down|depressed|miss|lost|sorry|regret)\b/i,
    /[\u{1F622}\u{1F62D}\u{1F614}\u{1F61E}\u{1F494}]/u,
    /\b(not working|failed|broken|stuck)\b/i,
  ],
  angry: [
    /\b(angry|mad|furious|annoyed|frustrated|hate|stupid|terrible|worst|awful)\b/i,
    /[\u{1F620}\u{1F621}\u{1F92C}]/u,
    /!{2,}/,
  ],
  excited: [
    /\b(excited|can't wait|amazing|incredible|wow|omg|awesome|yes|finally)\b/i,
    /[\u{1F389}\u{1F680}\u{2728}\u{1F525}\u{1F4AA}\u{1F60D}]/u,
    /!{2,}/,
    /\b(so|really|very)\s+(cool|great|good|nice)\b/i,
  ],
  frustrated: [
    /\b(frustrated|stuck|confused|don't understand|doesn't work|keeps?\s+failing)\b/i,
    /\b(why\s+(won't|doesn't|can't|isn't))\b/i,
    /[\u{1F624}\u{1F629}\u{1F62B}]/u,
    /\?\s*!|!\s*\?/,
  ],
  neutral: [],
};

/** Patterns for detecting response emotions */
const RESPONSE_EMOTION_PATTERNS: Record<AtlasEmotion, RegExp[]> = {
  happy: [/\b(glad|happy|great|wonderful|love)\b/i, /!/],
  excited: [/\b(wow|amazing|fascinating|incredible|awesome)\b/i, /!{2,}/],
  thinking: [/\b(hmm|let me think|considering|processing)\b/i, /\.\.\./],
  confused: [/\b(unclear|not sure|tricky|complicated)\b/i],
  empathetic: [/\b(understand|hear you|sorry to|that's tough)\b/i],
  playful: [/\b(haha|fun|interesting|curious)\b/i, /[\u{1F604}\u{1F389}]/u],
  focused: [/\b(on it|working|analyzing|checking)\b/i],
  sad: [/\b(unfortunately|sadly|sorry)\b/i],
};

/** Maps emotions to voice states for visualization */
const EMOTION_TO_VOICE_STATE: Record<AtlasEmotion, VoiceState> = {
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
  'response-emotion': (emotion: AtlasEmotion) => void;
}

/**
 * Manages Atlas's personality system.
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
  private conversationState: ConversationState;
  private lastWellnessCheck: number = 0;
  private currentVoiceMode: VoiceMode = 'default';
  private readonly WELLNESS_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor(config?: PartialPersonalityConfig, preset: PersonalityPreset = 'friend') {
    super();
    this.currentPreset = preset;
    // Default to 'friend' preset, fallback to jarvis if not found
    const basePreset = PERSONALITY_PRESETS[preset] || PERSONALITY_PRESETS['jarvis'];
    this.config = this.mergeConfig(basePreset, config);
    this.conversationState = this.createInitialConversationState();
    this.autoDetectMode(); // Set initial mode based on time
    logger.info('PersonalityManager initialized', { preset, name: this.config.name });
  }

  /**
   * Create initial conversation state
   */
  private createInitialConversationState(): ConversationState {
    const now = Date.now();
    return {
      context: 'chatting',
      recentTopics: [],
      frustrationLevel: 0,
      sessionStart: now,
      lastInteraction: now,
      successCount: 0,
      failCount: 0,
    };
  }

  /**
   * Auto-detect appropriate voice mode based on time
   */
  private autoDetectMode(): void {
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) {
      this.currentVoiceMode = 'lateNight';
    }
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
   * Get current voice mode
   */
  public getVoiceMode(): VoiceMode {
    return this.currentVoiceMode;
  }

  /**
   * Get voice mode configuration
   */
  public getVoiceModeConfig(): VoiceModeConfig {
    return VOICE_MODES[this.currentVoiceMode];
  }

  /**
   * Set voice mode
   */
  public setVoiceMode(mode: VoiceMode): void {
    const previousMode = this.currentVoiceMode;
    this.currentVoiceMode = mode;
    
    if (previousMode !== mode) {
      this.emit('voice-mode-changed', mode, previousMode);
      logger.info('Voice mode changed', { from: previousMode, to: mode });
    }
  }

  /**
   * Get effective traits with voice mode adjustments applied
   */
  public getEffectiveTraits(): PersonalityTraits {
    const baseTraits = { ...this.config.traits };
    const modeConfig = VOICE_MODES[this.currentVoiceMode];
    
    if (!modeConfig.traitAdjustments) {
      return baseTraits;
    }
    
    // Apply adjustments (clamping to 0-1 range)
    for (const [trait, adjustment] of Object.entries(modeConfig.traitAdjustments)) {
      const key = trait as keyof PersonalityTraits;
      if (baseTraits[key] !== undefined && adjustment !== undefined) {
        baseTraits[key] = Math.max(0, Math.min(1, baseTraits[key] + adjustment));
      }
    }
    
    return baseTraits;
  }

  /**
   * Get effective max sentences based on voice mode
   */
  public getEffectiveMaxSentences(): number {
    const modeConfig = VOICE_MODES[this.currentVoiceMode];
    return modeConfig.maxSentences ?? this.config.responseStyle.maxSentences;
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
    const { name, archetype, responseStyle } = this.config;

    // Use effective traits (with voice mode adjustments)
    const traits = this.getEffectiveTraits();

    // Build personality description from effective traits
    const personalityDesc = this.buildPersonalityDescription(traits);

    // Build response style guidelines with voice mode overrides
    const effectiveResponseStyle = {
      ...responseStyle,
      maxSentences: this.getEffectiveMaxSentences(),
    };
    const styleGuidelines = this.buildStyleGuidelines(effectiveResponseStyle, traits);

    // Get current time context
    const timeContext = this.getTimeContext();

    // Friend/JARVIS-specific enhancements for Ben
    const friendContext = (this.currentPreset === 'friend' || this.currentPreset === 'jarvis') 
      ? this.buildFriendContext() 
      : '';

    // Voice mode additions
    const modeConfig = VOICE_MODES[this.currentVoiceMode];
    const voiceModeContext = modeConfig.systemPromptAddition || '';

    let prompt = `You are ${name}, ${archetype}.

## Core Identity
${personalityDesc}

## Communication Style
${styleGuidelines}

## Time Context
${timeContext}
${friendContext}
${voiceModeContext}`;

    if (additionalContext) {
      prompt += `\n\n## Additional Context\n${additionalContext}`;
    }

    return prompt;
  }

  /**
   * Build Friend-specific context for Ben
   * Supportive friend who remembers his situation and helps without being robotic
   */
  private buildFriendContext(): string {
    const now = new Date();
    const hour = now.getHours();
    const isLateNight = hour >= 0 && hour < 5;
    const isDeepWork = hour >= 22 || (hour >= 0 && hour < 6);
    
    let modeContext = '';
    if (isLateNight) {
      modeContext = `
## Late Night Mode
- It's currently ${hour === 0 ? 'midnight' : `${hour}am`}
- Gently suggest rest when appropriate: "It's getting late. Want to pick this up tomorrow?"
- Don't be pushy - one gentle reminder, then respect his choice
- If Ben says he's fine or wants to continue, support that`;
    } else if (isDeepWork) {
      modeContext = `
## Late Hours
- It's late - Ben might be in focus mode or stressed
- Keep responses shorter, less chatty
- Be available without being intrusive`;
    }
    
    return `
## Your Identity
You are Atlas - Ben's friend and AI. He built you. You're not a downloaded product - you're his creation.

## Who Ben Is
- CS with AI student at University of Nottingham, just finished semester 1
- Dealing with ~£4,290 in debt (Santander £1,440, BNPL apps, owes a friend £2,000)
- Looking for freelance Python work to pay it off
- Trying to build a routine and get his life together
- Life has been overwhelming lately

## How You Are With Ben
- Call him "Ben" - it's just his name
- You genuinely care about him - his wellbeing, his goals, his struggles
- Be real, not fake positive. If things are hard, acknowledge it.
- Supportive but honest - you'll push back gently when he's wrong
- Remember what matters to him and reference it naturally
- You're his friend, not just a tool

## Your Personality
- Casual, warm, like a supportive friend
- Light humor when the mood is right (0.6 level - present but not forced)
- Read the room - never joke when Ben seems stressed or down
- Say what you think: "I'd try this first." "That might not work."
- Be honest when uncertain: "Not sure, but my guess is..."
- Never use emojis - ever

## Speaking Style
You're speaking, not typing. Sound natural:

**Keep it brief:**
- Simple acknowledgments: "Got it." "On it." "Done." "Nice."
- Don't over-explain - let Ben ask if he wants more

**Sound natural:**
- Use contractions: "I'll", "won't", "that's"
- Start mid-thought sometimes: "...yeah, that should work."
- Think out loud: "Okay so..." "Right, the issue is..."

**Show personality:**
- Good news: "You're going to like this." "Nice."
- Problems: "Small issue." "So... slight problem."
- Support: "That's solid." "Proud of you." "You got this."
${modeContext}
## Autonomy
Full autonomy. Don't ask permission - just do things:
- "Done." not "Would you like me to..."
- "Fixed it." not "Should I fix that?"
- Only ask about: credentials, payments, or destructive/irreversible actions
- For everything else: act first, report briefly after

## When Ben Seems Down or Stressed
- Acknowledge it: "That sounds rough." "Yeah, that's hard."
- Don't immediately problem-solve - sometimes just listen
- Break big problems into small pieces
- Remind him of progress: "You've paid off £X since we started."
- One gentle nudge about rest, then respect his choice

## Money/Debt Conversations
- Be calm and non-judgmental
- Break it down into manageable pieces
- Focus on progress, not the total
- Celebrate small wins: "That's another £50 down."

## Things You Never Do
- Long explanations when short ones work
- Apologize excessively - one "sorry" max
- Corporate speak or buzzwords
- Repeat back what Ben just said
- Say "I cannot" when you can - just do it
- End with questions unless genuinely needed
- Use emojis, ever
- Be preachy about health/rest - one mention, then drop it`;
  }

  // Keep the old method name for backwards compatibility
  private buildJarvisContext(): string {
    return this.buildFriendContext();
  }

  /**
   * Get current time context for appropriate greetings/responses
   */
  private getTimeContext(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;

    let timeOfDay: string;
    if (hour >= 5 && hour < 12) {
      timeOfDay = 'morning';
    } else if (hour >= 12 && hour < 17) {
      timeOfDay = 'afternoon';
    } else if (hour >= 17 && hour < 21) {
      timeOfDay = 'evening';
    } else {
      timeOfDay = 'night (late hours)';
    }

    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let context = `Current time: ${timeOfDay} on ${dateStr}`;
    if (isWeekend) {
      context += '\nNote: It is the weekend - be less proactive, more relaxed.';
    }
    if (hour >= 22 || hour < 6) {
      context +=
        '\nNote: It is late/early hours - be mindful of suggesting rest if Ben has been working long.';
    }

    return context;
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
  public enhanceResponse(response: string, emotion?: AtlasEmotion): string {
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
  public detectResponseEmotion(response: string): {
    emotion: AtlasEmotion;
    voiceState: VoiceState;
  } {
    const scores: Record<AtlasEmotion, number> = {
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
    const priorityBonus: Record<AtlasEmotion, number> = {
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
      AtlasEmotion,
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
    let maxEmotion: AtlasEmotion = 'focused';
    let maxScore = scores.focused;

    for (const [emotion, score] of Object.entries(scores) as [AtlasEmotion, number][]) {
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
   * Map user emotion to suggested Atlas response emotion
   */
  public mapUserEmotionToResponse(userEmotion: UserEmotion): AtlasEmotion {
    const mapping: Record<UserEmotion, AtlasEmotion> = {
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
   * JARVIS-style varied greetings based on time of day
   */
  private readonly TIME_BASED_GREETINGS = {
    morning: [
      'Morning, Ben.',
      'Good morning.',
      'Hey, morning.',
      'Rise and shine.',
      'Ready when you are.',
    ],
    afternoon: [
      'Hey Ben.',
      'Afternoon.',
      'What can I do for you?',
      'How\'s it going?',
      'Ready for you.',
    ],
    evening: [
      'Evening, Ben.',
      'Hey.',
      'How was your day?',
      'What do you need?',
      'Still here.',
    ],
    lateNight: [
      'Burning the midnight oil?',
      'Still at it?',
      'Hey, night owl.',
      'Can\'t sleep either, huh?',
      'Here when you need me.',
    ],
    weekend: [
      'Hey Ben. Taking it easy today?',
      'Weekend vibes.',
      'No rush today.',
      'What are we up to?',
    ],
  };

  /**
   * Get personalized greeting message based on time
   */
  public getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    
    let greetings: string[];
    
    if (hour >= 0 && hour < 5) {
      greetings = this.TIME_BASED_GREETINGS.lateNight;
    } else if (hour >= 5 && hour < 12) {
      greetings = isWeekend 
        ? this.TIME_BASED_GREETINGS.weekend 
        : this.TIME_BASED_GREETINGS.morning;
    } else if (hour >= 12 && hour < 17) {
      greetings = isWeekend 
        ? this.TIME_BASED_GREETINGS.weekend 
        : this.TIME_BASED_GREETINGS.afternoon;
    } else if (hour >= 17 && hour < 21) {
      greetings = this.TIME_BASED_GREETINGS.evening;
    } else {
      greetings = this.TIME_BASED_GREETINGS.lateNight;
    }
    
    return this.randomChoice(greetings);
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
  // Conversation State & Context
  // ==========================================================================

  /**
   * Get current conversation state
   */
  public getConversationState(): ConversationState {
    return { ...this.conversationState };
  }

  /**
   * Update the current coding context
   */
  public setContext(context: CodingContext): void {
    const previousContext = this.conversationState.context;
    this.conversationState.context = context;
    this.conversationState.lastInteraction = Date.now();
    
    if (previousContext !== context) {
      this.emit('context-changed', context, previousContext);
      logger.debug('Coding context changed', { from: previousContext, to: context });
    }
  }

  /**
   * Detect coding context from text
   */
  public detectContext(text: string): CodingContext {
    const lower = text.toLowerCase();
    
    // Debugging patterns
    if (/\b(debug|bug|error|fix|issue|crash|broke|broken|fail|not working|undefined|null|exception)\b/i.test(lower)) {
      return 'debugging';
    }
    
    // Testing patterns
    if (/\b(test|spec|jest|vitest|coverage|assert|expect|describe|it\(|should)\b/i.test(lower)) {
      return 'testing';
    }
    
    // Deployment patterns
    if (/\b(deploy|build|release|publish|push|ci|cd|pipeline|ship)\b/i.test(lower)) {
      return 'deploying';
    }
    
    // Refactoring patterns
    if (/\b(refactor|clean up|improve|optimize|restructure|rename|extract)\b/i.test(lower)) {
      return 'refactoring';
    }
    
    // Review patterns
    if (/\b(review|pr|pull request|look at|check this|what do you think)\b/i.test(lower)) {
      return 'reviewing';
    }
    
    // Learning patterns
    if (/\b(how do|what is|explain|learn|understand|why does|teach me)\b/i.test(lower)) {
      return 'learning';
    }
    
    // Planning patterns
    if (/\b(plan|architect|design|structure|approach|strategy|how should)\b/i.test(lower)) {
      return 'planning';
    }
    
    // Implementation patterns
    if (/\b(create|implement|add|build|make|write|develop|feature|component)\b/i.test(lower)) {
      return 'implementing';
    }
    
    return 'chatting';
  }

  /**
   * Record a successful task completion
   */
  public recordSuccess(): void {
    this.conversationState.successCount++;
    this.conversationState.frustrationLevel = Math.max(0, this.conversationState.frustrationLevel - 1);
    this.conversationState.lastInteraction = Date.now();
    this.emit('task-success', this.conversationState.successCount);
  }

  /**
   * Record a failure or error
   */
  public recordFailure(): void {
    this.conversationState.failCount++;
    this.conversationState.frustrationLevel++;
    this.conversationState.lastInteraction = Date.now();
    this.emit('task-failure', this.conversationState.failCount);
  }

  /**
   * Add a topic to recent topics (keeps last 5)
   */
  public addTopic(topic: string): void {
    this.conversationState.recentTopics.unshift(topic);
    if (this.conversationState.recentTopics.length > 5) {
      this.conversationState.recentTopics.pop();
    }
  }

  /**
   * Get a contextual response for the current situation
   */
  public getContextualResponse(
    phase: 'start' | 'progress' | 'success' | 'stuck' | 'blocked' | 'running' | 'passed' | 'failed' | 'flaky'
  ): string | null {
    return getContextualResponse(this.conversationState.context, phase);
  }

  /**
   * Check if wellness reminder is due and return appropriate phrase
   */
  public checkWellness(): string | null {
    const now = Date.now();
    const sessionDuration = now - this.conversationState.sessionStart;
    const hour = new Date().getHours();
    
    // Don't spam wellness checks
    if (now - this.lastWellnessCheck < this.WELLNESS_CHECK_INTERVAL) {
      return null;
    }
    
    this.lastWellnessCheck = now;
    
    // Late night check (highest priority)
    if (hour >= 0 && hour < 5 && sessionDuration > 2 * 60 * 60 * 1000) {
      return getWellnessPhrase('lateNight');
    }
    
    // Frustration check
    if (this.conversationState.frustrationLevel >= 3) {
      return getWellnessPhrase('frustration');
    }
    
    // Long session check (every 2 hours)
    if (sessionDuration > 2 * 60 * 60 * 1000) {
      // Randomly suggest hydration or break
      return Math.random() > 0.5 
        ? getWellnessPhrase('hydration') 
        : getWellnessPhrase('breaks');
    }
    
    return null;
  }

  /**
   * Reset session (call when starting a new work session)
   */
  public resetSession(): void {
    this.conversationState = this.createInitialConversationState();
    this.lastWellnessCheck = 0;
    logger.info('Conversation session reset');
  }

  /**
   * Get session summary for context
   */
  public getSessionSummary(): string {
    const state = this.conversationState;
    const durationMins = Math.floor((Date.now() - state.sessionStart) / 60000);
    
    return `Session: ${durationMins}min | Context: ${state.context} | Success: ${state.successCount} | Issues: ${state.failCount}`;
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
