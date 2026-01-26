/**
 * Atlas Emotional Intelligence Module
 *
 * Detects Ben's emotional state and adjusts Atlas's responses accordingly.
 * Tracks emotional patterns over time and provides supportive phrases.
 *
 * @module agent/emotional-intelligence
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getPersonalityManager } from './personality-manager';
import { humorManager, UserState } from './humor-library';
import {
  loadStateSync,
  saveStateSync,
  STATE_LOCATIONS,
  StateDocument,
  generateEmotionalStateContent,
} from '../memory/obsidian-state';

const logger = createModuleLogger('EmotionalIntelligence');

// ============================================================================
// Types
// ============================================================================

export type EmotionType =
  | 'happy'
  | 'frustrated'
  | 'stressed'
  | 'excited'
  | 'sad'
  | 'angry'
  | 'neutral'
  | 'tired'
  | 'focused'
  | 'confused';

export interface VoiceTone {
  pitch: 'low' | 'normal' | 'high';
  speed: 'slow' | 'normal' | 'fast';
  volume: 'quiet' | 'normal' | 'loud';
}

export interface EmotionInput {
  text?: string;
  voiceTone?: VoiceTone;
  context?: string;
  recentHistory?: string[];
}

export interface EmotionAnalysis {
  primaryEmotion: EmotionType;
  confidence: number;
  intensity: 'low' | 'medium' | 'high';
  triggers: string[];
  shouldAdjustTone: boolean;
}

export interface ResponseTone {
  formality: number; // 0-1
  humor: number; // 0-1
  empathy: number; // 0-1
  energy: number; // 0-1
  brevity: number; // 0-1, higher = more concise
}

export interface MoodDataPoint {
  emotion: EmotionType;
  timestamp: Date;
  intensity: number;
}

export interface EmotionalTrend {
  currentMood: EmotionType;
  averageMood: EmotionType;
  moodOverTime: MoodDataPoint[];
  isStressedToday: boolean;
  productivityCorrelation?: string;
}

// ============================================================================
// Emotion Detection Patterns
// ============================================================================

interface EmotionPattern {
  keywords: string[];
  punctuation?: string[];
  indicators?: string[];
  contextual?: string[];
  time?: string[];
}

const EMOTION_PATTERNS: Record<EmotionType, EmotionPattern> = {
  frustrated: {
    keywords: [
      'frustrated',
      'annoying',
      'stuck',
      "doesn't work",
      'broken',
      "why won't",
      'keeps failing',
      'not working',
      'failed again',
      'still broken',
      'hate this',
      'ugh',
      'argh',
      'come on',
      'seriously',
      'wtf',
      'ffs',
    ],
    punctuation: ['!', '?!', '!!', '!!!'],
    indicators: ['repeated attempts', 'short messages', 'caps'],
  },
  stressed: {
    keywords: [
      'deadline',
      'urgent',
      'asap',
      'hurry',
      'behind',
      'overwhelmed',
      'too much',
      'swamped',
      'crazy busy',
      'no time',
      'running out of time',
      'crunch',
      'pressure',
      'have to finish',
      'need to ship',
    ],
    contextual: ['multiple tasks', 'time pressure'],
  },
  happy: {
    keywords: [
      'awesome',
      'great',
      'perfect',
      'thanks',
      'love it',
      'works',
      'nice',
      'sweet',
      'brilliant',
      'excellent',
      'amazing',
      'wonderful',
      'fantastic',
      'finally',
      'yes',
    ],
    punctuation: ['!'],
  },
  excited: {
    keywords: [
      'excited',
      "can't wait",
      'pumped',
      'stoked',
      'thrilled',
      "let's go",
      'this is it',
      'we did it',
      'omg',
      'wow',
      'incredible',
      'mind blown',
      'game changer',
    ],
    punctuation: ['!', '!!', '!!!'],
  },
  sad: {
    keywords: [
      'sad',
      'disappointed',
      'down',
      'miss',
      'lost',
      'sorry',
      'regret',
      'sucks',
      'depressing',
      'unfortunate',
      'bummed',
      'gutted',
    ],
    contextual: ['loss', 'failure', 'rejection'],
  },
  angry: {
    keywords: [
      'angry',
      'mad',
      'furious',
      'pissed',
      'livid',
      'outraged',
      'ridiculous',
      'unacceptable',
      'stupid',
      'idiotic',
      'incompetent',
      'garbage',
      'trash',
    ],
    punctuation: ['!', '!!', '!!!', '?!'],
    indicators: ['caps', 'profanity'],
  },
  tired: {
    keywords: [
      'tired',
      'exhausted',
      'long day',
      'need sleep',
      'late',
      'drained',
      'burnt out',
      'burnout',
      'wiped',
      'beat',
      'running on fumes',
      'need coffee',
      'so sleepy',
    ],
    time: ['after 10pm', 'very early morning'],
  },
  focused: {
    keywords: [
      'focused',
      'in the zone',
      'locked in',
      'deep work',
      'concentration',
      'heads down',
      'do not disturb',
      'busy',
      'working on',
    ],
    contextual: ['single task', 'coding session'],
  },
  confused: {
    keywords: [
      'confused',
      "don't understand",
      "doesn't make sense",
      'what',
      'huh',
      'lost',
      'unclear',
      "i'm not sure",
      'help me understand',
      'explain',
      'wait what',
    ],
    punctuation: ['?', '??', '???'],
  },
  neutral: {
    keywords: [],
  },
};

// ============================================================================
// Response Tone Mappings
// ============================================================================

const RESPONSE_TONES: Record<EmotionType, ResponseTone> = {
  frustrated: {
    formality: 0.4, // More casual, less robotic
    humor: 0.1, // No jokes
    empathy: 0.9, // High empathy
    energy: 0.5, // Calm
    brevity: 0.8, // Keep it short
  },
  stressed: {
    formality: 0.5,
    humor: 0.0, // No humor when stressed
    empathy: 0.8,
    energy: 0.4, // Calming
    brevity: 0.9, // Very concise
  },
  happy: {
    formality: 0.3,
    humor: 0.6, // Humor OK
    empathy: 0.5,
    energy: 0.8, // Match energy
    brevity: 0.4,
  },
  excited: {
    formality: 0.2,
    humor: 0.7, // Humor welcome
    empathy: 0.4,
    energy: 0.9, // High energy to match
    brevity: 0.3,
  },
  sad: {
    formality: 0.4,
    humor: 0.0, // No humor
    empathy: 1.0, // Maximum empathy
    energy: 0.3, // Subdued
    brevity: 0.5,
  },
  angry: {
    formality: 0.5,
    humor: 0.0, // Absolutely no humor
    empathy: 0.8,
    energy: 0.4, // De-escalating
    brevity: 0.7,
  },
  tired: {
    formality: 0.3,
    humor: 0.2, // Light humor only
    empathy: 0.7,
    energy: 0.3, // Low energy, calming
    brevity: 0.9, // Very brief
  },
  focused: {
    formality: 0.5,
    humor: 0.2, // Minimal humor
    empathy: 0.3,
    energy: 0.5, // Neutral
    brevity: 1.0, // Maximum brevity - don't interrupt flow
  },
  confused: {
    formality: 0.4,
    humor: 0.1, // Avoid humor
    empathy: 0.6,
    energy: 0.5,
    brevity: 0.3, // Take time to explain
  },
  neutral: {
    formality: 0.5,
    humor: 0.4, // Normal humor level
    empathy: 0.5,
    energy: 0.6,
    brevity: 0.5,
  },
};

// ============================================================================
// Supportive Phrases
// ============================================================================

const SUPPORTIVE_PHRASES: Record<EmotionType, string[]> = {
  frustrated: [
    "I understand that's frustrating. Let me take another look.",
    "That is annoying. Let's figure this out together.",
    "I can see why that's frustrating. Here's what I suggest...",
    "This one's being stubborn. Let me try a different approach.",
    'Alright, fresh eyes on this. We will crack it.',
  ],
  stressed: [
    "Let's take this one step at a time.",
    "I've got this. Focus on what you need to.",
    'Deep breath. We will get through this.',
    "One thing at a time, Ben. What's the highest priority?",
    "I'll handle the details. You focus on the big picture.",
  ],
  sad: [
    "I'm here if you need to talk.",
    "That's tough. I'm sorry you're dealing with this.",
    'Take your time. No rush.',
    "It's okay to not be okay sometimes.",
    "I'm not going anywhere. Whatever you need.",
  ],
  tired: [
    "Maybe it's time to call it a night?",
    "You've been working hard. Rest is important too.",
    'I can keep working on this while you rest.',
    'Your health comes first, Ben. This can wait until tomorrow.',
    'Even machines need downtime. Humans even more so.',
  ],
  angry: [
    'I hear you. That would make anyone upset.',
    "That's legitimately frustrating. Let me help address it.",
    'Your anger is valid. Now let us channel it productively.',
    'I understand. Take a moment if you need to.',
    "Let's focus on what we can control here.",
  ],
  confused: [
    'Let me break this down more clearly.',
    'Good question. Here is how I think about it...',
    "That is a tricky concept. Let's work through it together.",
    'No worries, this stuff is complex. Let me explain.',
    "I'll walk you through it step by step.",
  ],
  happy: [
    'Great to see things going well!',
    "That's the spirit!",
    'Glad I could help.',
    'This is good progress.',
  ],
  excited: [
    "Let's make it happen!",
    'This is going to be good.',
    'I share your enthusiasm.',
    'Exciting times ahead.',
  ],
  focused: ['On it.', 'Consider it done.', 'Working on it now.'],
  neutral: ['How can I help?', 'What do you need?', 'Ready when you are.'],
};

// ============================================================================
// Emotional State Storage
// ============================================================================

interface StoredEmotionalState {
  moodHistory: Array<{
    emotion: EmotionType;
    timestamp: string;
    intensity: number;
  }>;
  lastUpdated: string;
}

const MAX_HISTORY_DAYS = 7;

// ============================================================================
// EmotionalIntelligence Class
// ============================================================================

export interface EmotionalIntelligenceEvents {
  'emotion-detected': (analysis: EmotionAnalysis) => void;
  'mood-changed': (previous: EmotionType, current: EmotionType) => void;
  'stress-alert': (isStressed: boolean) => void;
}

/**
 * Emotional Intelligence module for Atlas.
 *
 * Responsibilities:
 * - Detect emotions from text and voice tone
 * - Track emotional patterns over time
 * - Recommend response adjustments based on emotional state
 * - Provide supportive phrases for difficult emotions
 * - Gate humor appropriateness
 */
export class EmotionalIntelligence extends EventEmitter {
  private moodHistory: MoodDataPoint[] = [];
  private currentEmotion: EmotionType = 'neutral';
  private manualEmotionOverride: EmotionType | null = null;
  private consecutiveNegativeCount = 0;

  constructor() {
    super();
    this.loadState();
    logger.info('EmotionalIntelligence initialized');
  }

  // ==========================================================================
  // Core Detection Methods
  // ==========================================================================

  /**
   * Detect emotion from input (text and/or voice)
   */
  detectEmotion(input: EmotionInput): EmotionAnalysis {
    // If manual override is set, use that
    if (this.manualEmotionOverride) {
      const analysis: EmotionAnalysis = {
        primaryEmotion: this.manualEmotionOverride,
        confidence: 1.0,
        intensity: 'medium',
        triggers: ['manual override'],
        shouldAdjustTone: true,
      };
      return analysis;
    }

    const scores: Record<EmotionType, number> = {
      happy: 0,
      frustrated: 0,
      stressed: 0,
      excited: 0,
      sad: 0,
      angry: 0,
      neutral: 0.2, // Base score for neutral
      tired: 0,
      focused: 0,
      confused: 0,
    };

    const triggers: string[] = [];

    // Analyze text if provided
    if (input.text) {
      const textResult = this.analyzeText(input.text);
      for (const [emotion, score] of Object.entries(textResult.scores)) {
        scores[emotion as EmotionType] += score;
      }
      triggers.push(...textResult.triggers);
    }

    // Analyze voice tone if provided
    if (input.voiceTone) {
      const voiceResult = this.analyzeVoiceTone(input.voiceTone);
      for (const [emotion, score] of Object.entries(voiceResult.scores)) {
        scores[emotion as EmotionType] += score;
      }
      if (voiceResult.trigger) {
        triggers.push(voiceResult.trigger);
      }
    }

    // Consider recent history for context
    if (input.recentHistory && input.recentHistory.length > 0) {
      const historyResult = this.analyzeHistory(input.recentHistory);
      for (const [emotion, score] of Object.entries(historyResult.scores)) {
        scores[emotion as EmotionType] += score * 0.3; // Weight history less
      }
    }

    // Consider time of day
    const timeEmotion = this.analyzeTimeOfDay();
    if (timeEmotion) {
      scores[timeEmotion] += 0.15;
      triggers.push('time of day');
    }

    // Find the highest scoring emotion
    let primaryEmotion: EmotionType = 'neutral';
    let maxScore = scores.neutral;

    for (const [emotion, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        primaryEmotion = emotion as EmotionType;
      }
    }

    // Calculate confidence (normalized score)
    const confidence = Math.min(1, maxScore / 1.5);

    // Determine intensity based on score and indicators
    let intensity: 'low' | 'medium' | 'high' = 'medium';
    if (maxScore < 0.4) {
      intensity = 'low';
    } else if (maxScore > 0.8) {
      intensity = 'high';
    }

    // Determine if tone adjustment is needed
    const shouldAdjustTone =
      primaryEmotion !== 'neutral' &&
      primaryEmotion !== 'happy' &&
      primaryEmotion !== 'focused' &&
      confidence > 0.5;

    const analysis: EmotionAnalysis = {
      primaryEmotion,
      confidence,
      intensity,
      triggers,
      shouldAdjustTone,
    };

    // Update state
    this.updateEmotionalState(analysis);
    this.emit('emotion-detected', analysis);

    logger.debug('Emotion detected', {
      emotion: primaryEmotion,
      confidence: confidence.toFixed(2),
      intensity,
    });

    return analysis;
  }

  /**
   * Analyze text for emotional signals
   */
  private analyzeText(text: string): {
    scores: Partial<Record<EmotionType, number>>;
    triggers: string[];
  } {
    const scores: Partial<Record<EmotionType, number>> = {};
    const triggers: string[] = [];
    const lowerText = text.toLowerCase();

    // Check keywords for each emotion
    for (const [emotion, pattern] of Object.entries(EMOTION_PATTERNS)) {
      let score = 0;

      // Check keywords
      for (const keyword of pattern.keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          score += 0.3;
          triggers.push(keyword);
        }
      }

      // Check punctuation patterns
      if (pattern.punctuation) {
        for (const punct of pattern.punctuation) {
          if (text.includes(punct)) {
            score += 0.15;
          }
        }
      }

      // Check for ALL CAPS (indicates strong emotion)
      if (pattern.indicators?.includes('caps')) {
        const capsWords = text.match(/\b[A-Z]{2,}\b/g);
        if (capsWords && capsWords.length >= 2) {
          score += 0.2;
          triggers.push('caps emphasis');
        }
      }

      // Check for repeated characters (e.g., "sooo", "whyyy")
      if (text.match(/(.)\1{2,}/)) {
        if (emotion === 'frustrated' || emotion === 'excited' || emotion === 'angry') {
          score += 0.1;
        }
      }

      if (score > 0) {
        scores[emotion as EmotionType] = score;
      }
    }

    // Check message length - very short messages during problems often indicate frustration
    if (text.length < 20 && triggers.length === 0) {
      const hasQuestionOrProblem =
        text.includes('?') ||
        lowerText.includes('not') ||
        lowerText.includes("doesn't") ||
        lowerText.includes("won't");
      if (hasQuestionOrProblem) {
        scores.frustrated = (scores.frustrated || 0) + 0.15;
      }
    }

    return { scores, triggers };
  }

  /**
   * Analyze voice tone for emotional signals
   */
  private analyzeVoiceTone(tone: VoiceTone): {
    scores: Partial<Record<EmotionType, number>>;
    trigger: string | null;
  } {
    const scores: Partial<Record<EmotionType, number>> = {};
    let trigger: string | null = null;

    // Fast + loud often indicates frustration or excitement
    if (tone.speed === 'fast' && tone.volume === 'loud') {
      scores.frustrated = 0.3;
      scores.excited = 0.25;
      trigger = 'fast loud speech';
    }

    // Slow + quiet often indicates sadness or tiredness
    if (tone.speed === 'slow' && tone.volume === 'quiet') {
      scores.sad = 0.25;
      scores.tired = 0.3;
      trigger = 'slow quiet speech';
    }

    // High pitch + fast often indicates stress or excitement
    if (tone.pitch === 'high' && tone.speed === 'fast') {
      scores.stressed = 0.25;
      scores.excited = 0.2;
      trigger = 'high fast speech';
    }

    // Low pitch + slow often indicates tiredness or sadness
    if (tone.pitch === 'low' && tone.speed === 'slow') {
      scores.tired = 0.3;
      scores.sad = 0.2;
      trigger = 'low slow speech';
    }

    return { scores, trigger };
  }

  /**
   * Analyze recent conversation history for emotional context
   */
  private analyzeHistory(history: string[]): { scores: Partial<Record<EmotionType, number>> } {
    const scores: Partial<Record<EmotionType, number>> = {};

    // Look for patterns in recent messages
    let negativeCount = 0;
    let positiveCount = 0;

    for (const message of history.slice(-5)) {
      const lowerMsg = message.toLowerCase();

      // Count negative indicators
      if (
        lowerMsg.includes('not working') ||
        lowerMsg.includes('error') ||
        lowerMsg.includes('failed') ||
        lowerMsg.includes('broken')
      ) {
        negativeCount++;
      }

      // Count positive indicators
      if (
        lowerMsg.includes('thanks') ||
        lowerMsg.includes('great') ||
        lowerMsg.includes('works') ||
        lowerMsg.includes('perfect')
      ) {
        positiveCount++;
      }
    }

    // Multiple failures often lead to frustration
    if (negativeCount >= 2) {
      scores.frustrated = 0.3;
    }

    // Multiple successes indicate happiness
    if (positiveCount >= 2) {
      scores.happy = 0.3;
    }

    return { scores };
  }

  /**
   * Analyze time of day for emotional context
   */
  private analyzeTimeOfDay(): EmotionType | null {
    const hour = new Date().getHours();

    // Late night (10pm - 4am) - likely tired
    if (hour >= 22 || hour < 4) {
      return 'tired';
    }

    // Early morning (4am - 6am) - also likely tired
    if (hour >= 4 && hour < 6) {
      return 'tired';
    }

    return null;
  }

  // ==========================================================================
  // Response Adjustment Methods
  // ==========================================================================

  /**
   * Get recommended response tone based on emotion analysis
   */
  getRecommendedTone(analysis: EmotionAnalysis): ResponseTone {
    const baseTone = RESPONSE_TONES[analysis.primaryEmotion];

    // Adjust based on intensity
    const tone = { ...baseTone };

    if (analysis.intensity === 'high') {
      // Increase empathy, decrease humor for high intensity emotions
      tone.empathy = Math.min(1, tone.empathy + 0.1);
      tone.humor = Math.max(0, tone.humor - 0.2);
    } else if (analysis.intensity === 'low') {
      // For low intensity, be more moderate
      tone.empathy = Math.max(0.3, tone.empathy - 0.1);
      tone.humor = Math.min(0.5, tone.humor + 0.1);
    }

    logger.debug('Recommended tone', { emotion: analysis.primaryEmotion, tone });
    return tone;
  }

  /**
   * Adjust a response based on emotional analysis
   */
  adjustResponse(response: string, analysis: EmotionAnalysis): string {
    // Don't adjust if no adjustment needed
    if (!analysis.shouldAdjustTone) {
      return response;
    }

    // Get recommended tone for context (used in logging and future enhancements)
    const tone = this.getRecommendedTone(analysis);
    let adjustedResponse = response;

    logger.debug('Adjusting response', {
      emotion: analysis.primaryEmotion,
      brevity: tone.brevity,
      empathy: tone.empathy,
    });

    // Add supportive prefix for difficult emotions
    if (
      ['frustrated', 'stressed', 'sad', 'angry', 'confused'].includes(analysis.primaryEmotion) &&
      analysis.confidence > 0.6
    ) {
      const supportivePhrase = this.getSupportivePhrase(analysis.primaryEmotion);
      if (
        supportivePhrase &&
        !response.toLowerCase().includes(supportivePhrase.toLowerCase().slice(0, 20))
      ) {
        adjustedResponse = `${supportivePhrase}\n\n${response}`;
      }
    }

    // If high brevity is needed, we could truncate but that's usually
    // better handled by the LLM with context about the user's state

    // For tired users late at night, add a gentle reminder
    if (analysis.primaryEmotion === 'tired' && analysis.confidence > 0.7) {
      const hour = new Date().getHours();
      if (hour >= 23 || hour < 5) {
        // Don't add reminder every time - check if response already mentions rest
        if (!response.toLowerCase().includes('rest') && !response.toLowerCase().includes('sleep')) {
          // Only sometimes add the reminder
          if (Math.random() < 0.3) {
            adjustedResponse +=
              "\n\n(By the way, it's getting late - don't forget to take care of yourself.)";
          }
        }
      }
    }

    return adjustedResponse;
  }

  // ==========================================================================
  // Trend Tracking Methods
  // ==========================================================================

  /**
   * Get emotional trend analysis
   */
  getEmotionalTrend(): EmotionalTrend {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Filter to recent mood data
    const recentMoods = this.moodHistory.filter((m) => new Date(m.timestamp) > oneDayAgo);

    // Calculate average mood
    const moodCounts: Record<EmotionType, number> = {
      happy: 0,
      frustrated: 0,
      stressed: 0,
      excited: 0,
      sad: 0,
      angry: 0,
      neutral: 0,
      tired: 0,
      focused: 0,
      confused: 0,
    };

    for (const mood of recentMoods) {
      moodCounts[mood.emotion]++;
    }

    let averageMood: EmotionType = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of Object.entries(moodCounts)) {
      if (count > maxCount) {
        maxCount = count;
        averageMood = emotion as EmotionType;
      }
    }

    // Check if stressed today
    const stressfulEmotions: EmotionType[] = ['stressed', 'frustrated', 'angry'];
    const stressCount = recentMoods.filter((m) => stressfulEmotions.includes(m.emotion)).length;
    const isStressedToday =
      stressCount >= 3 || (recentMoods.length > 0 && stressCount / recentMoods.length > 0.4);

    // Productivity correlation (simplified)
    let productivityCorrelation: string | undefined;
    if (moodCounts.focused > moodCounts.frustrated + moodCounts.stressed) {
      productivityCorrelation = 'Good focus periods detected';
    } else if (moodCounts.frustrated > 3) {
      productivityCorrelation = 'High frustration may be impacting flow';
    }

    const trend: EmotionalTrend = {
      currentMood: this.currentEmotion,
      averageMood,
      moodOverTime: recentMoods,
      isStressedToday,
      productivityCorrelation,
    };

    if (isStressedToday) {
      this.emit('stress-alert', true);
    }

    return trend;
  }

  /**
   * Update emotional state with new analysis
   */
  private updateEmotionalState(analysis: EmotionAnalysis): void {
    const previousEmotion = this.currentEmotion;
    this.currentEmotion = analysis.primaryEmotion;

    // Add to history
    const dataPoint: MoodDataPoint = {
      emotion: analysis.primaryEmotion,
      timestamp: new Date(),
      intensity: analysis.intensity === 'low' ? 0.3 : analysis.intensity === 'medium' ? 0.6 : 0.9,
    };
    this.moodHistory.push(dataPoint);

    // Track consecutive negative emotions
    const negativeEmotions: EmotionType[] = ['frustrated', 'stressed', 'sad', 'angry'];
    if (negativeEmotions.includes(analysis.primaryEmotion)) {
      this.consecutiveNegativeCount++;
    } else {
      this.consecutiveNegativeCount = 0;
    }

    // Emit mood change if changed
    if (previousEmotion !== this.currentEmotion) {
      this.emit('mood-changed', previousEmotion, this.currentEmotion);
    }

    // Clean up old history
    this.pruneHistory();

    // Save state
    this.saveState();
  }

  /**
   * Remove history entries older than MAX_HISTORY_DAYS
   */
  private pruneHistory(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_HISTORY_DAYS);

    this.moodHistory = this.moodHistory.filter((m) => new Date(m.timestamp) > cutoff);
  }

  // ==========================================================================
  // Humor Gating Methods
  // ==========================================================================

  /**
   * Check if humor is appropriate given current emotional state
   */
  isHumorAppropriate(): boolean {
    // Never use humor if consecutive negative emotions
    if (this.consecutiveNegativeCount >= 2) {
      return false;
    }

    // Use humor library's mood check
    const userState: UserState = {
      mood: this.mapToHumorMood(this.currentEmotion),
    };

    return humorManager.isHumorAppropriate(userState);
  }

  /**
   * Map our emotion types to humor library's mood types
   */
  private mapToHumorMood(emotion: EmotionType): UserState['mood'] {
    const mapping: Record<EmotionType, UserState['mood']> = {
      happy: 'happy',
      excited: 'happy',
      frustrated: 'frustrated',
      stressed: 'stressed',
      sad: 'neutral', // Humor library doesn't have sad, treat as neutral (will still be blocked)
      angry: 'frustrated',
      neutral: 'neutral',
      tired: 'neutral',
      focused: 'neutral',
      confused: 'neutral',
    };
    return mapping[emotion];
  }

  // ==========================================================================
  // Supportive Phrase Methods
  // ==========================================================================

  /**
   * Get a supportive phrase for a given emotion
   */
  getSupportivePhrase(emotion: EmotionType): string {
    const phrases = SUPPORTIVE_PHRASES[emotion];
    if (!phrases || phrases.length === 0) {
      return '';
    }

    // Pick a random phrase
    const index = Math.floor(Math.random() * phrases.length);
    return phrases[index];
  }

  // ==========================================================================
  // Manual Override Methods
  // ==========================================================================

  /**
   * Manually set emotional context (for explicit user statements)
   */
  setEmotionalContext(emotion: EmotionType): void {
    this.manualEmotionOverride = emotion;
    this.currentEmotion = emotion;
    logger.info('Manual emotional context set', { emotion });
  }

  /**
   * Clear manual emotional context override
   */
  clearEmotionalContext(): void {
    this.manualEmotionOverride = null;
    logger.info('Manual emotional context cleared');
  }

  /**
   * Get current emotional state
   */
  getCurrentEmotion(): EmotionType {
    return this.currentEmotion;
  }

  // ==========================================================================
  // Personality Integration
  // ==========================================================================

  /**
   * Sync with personality manager's emotion detection
   */
  syncWithPersonalityManager(): void {
    const pm = getPersonalityManager();

    // Listen to personality manager's user emotion events
    pm.on('user-emotion', (emotion, confidence) => {
      // Map personality manager emotions to our emotions
      const emotionMap: Record<string, EmotionType> = {
        happy: 'happy',
        sad: 'sad',
        angry: 'angry',
        excited: 'excited',
        frustrated: 'frustrated',
        neutral: 'neutral',
      };

      const mappedEmotion = emotionMap[emotion] || 'neutral';

      // Only use if high confidence and we don't have a manual override
      if (confidence > 0.6 && !this.manualEmotionOverride) {
        this.currentEmotion = mappedEmotion;
      }
    });

    logger.debug('Synced with PersonalityManager');
  }

  // ==========================================================================
  // State Persistence
  // ==========================================================================

  /**
   * Load emotional state from Obsidian vault
   */
  private loadState(): void {
    try {
      const doc = loadStateSync<StoredEmotionalState>(STATE_LOCATIONS.emotionalState);

      if (doc && doc.frontmatter.moodHistory) {
        // Convert timestamps back to Date objects
        this.moodHistory = doc.frontmatter.moodHistory.map((m) => ({
          emotion: m.emotion,
          timestamp: new Date(m.timestamp),
          intensity: m.intensity,
        }));

        // Prune old entries
        this.pruneHistory();

        logger.debug('Loaded emotional state from Obsidian', {
          entries: this.moodHistory.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load emotional state', {
        error: (error as Error).message,
      });
      this.moodHistory = [];
    }
  }

  /**
   * Save emotional state to Obsidian vault
   */
  private saveState(): void {
    try {
      const moodHistoryData = this.moodHistory.map((m) => ({
        emotion: m.emotion,
        timestamp: m.timestamp.toISOString(),
        intensity: m.intensity,
      }));

      const frontmatter: StoredEmotionalState = {
        moodHistory: moodHistoryData,
        lastUpdated: new Date().toISOString(),
      };

      // Generate human-readable content
      const content = generateEmotionalStateContent({
        currentMood: this.currentEmotion,
        moodHistory: moodHistoryData,
        isStressedToday: this.consecutiveNegativeCount >= 2,
      });

      const doc: StateDocument<StoredEmotionalState> = {
        frontmatter,
        content,
      };

      saveStateSync(STATE_LOCATIONS.emotionalState, doc);
    } catch (error) {
      logger.warn('Failed to save emotional state', {
        error: (error as Error).message,
      });
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    this.saveState();
    this.removeAllListeners();
    logger.info('EmotionalIntelligence shutdown complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let emotionalIntelligenceInstance: EmotionalIntelligence | null = null;

/**
 * Get or create the EmotionalIntelligence singleton instance.
 */
export function getEmotionalIntelligence(): EmotionalIntelligence {
  if (!emotionalIntelligenceInstance) {
    emotionalIntelligenceInstance = new EmotionalIntelligence();
    emotionalIntelligenceInstance.syncWithPersonalityManager();
    logger.info('EmotionalIntelligence singleton created');
  }
  return emotionalIntelligenceInstance;
}

/**
 * Shutdown and cleanup EmotionalIntelligence singleton.
 */
export function shutdownEmotionalIntelligence(): void {
  if (emotionalIntelligenceInstance) {
    emotionalIntelligenceInstance.shutdown();
    emotionalIntelligenceInstance = null;
    logger.info('EmotionalIntelligence shutdown');
  }
}

/**
 * Reset EmotionalIntelligence singleton (for testing).
 */
export function resetEmotionalIntelligence(): void {
  emotionalIntelligenceInstance = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Detect emotion from text input
 */
export function detectEmotionFromText(text: string): EmotionAnalysis {
  return getEmotionalIntelligence().detectEmotion({ text });
}

/**
 * Check if humor is currently appropriate
 */
export function isHumorCurrentlyAppropriate(): boolean {
  return getEmotionalIntelligence().isHumorAppropriate();
}

/**
 * Get a supportive phrase for an emotion
 */
export function getSupportivePhraseFor(emotion: EmotionType): string {
  return getEmotionalIntelligence().getSupportivePhrase(emotion);
}

/**
 * Get current emotional trend
 */
export function getCurrentEmotionalTrend(): EmotionalTrend {
  return getEmotionalIntelligence().getEmotionalTrend();
}
