/**
 * Atlas Desktop - Emotion-Aware Responses
 * Detect user sentiment from voice and text for empathetic responses
 *
 * Features:
 * - Text-based sentiment analysis
 * - Voice tone indicators (volume, pace)
 * - Emotion classification
 * - Response tone adjustment
 * - Emotional state tracking over time
 *
 * @module intelligence/emotion-detector
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('EmotionDetector');

// ============================================================================
// Types
// ============================================================================

export type EmotionType =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'frustrated'
  | 'excited'
  | 'anxious'
  | 'confused'
  | 'grateful'
  | 'disappointed';

export type EmotionIntensity = 'subtle' | 'moderate' | 'strong';

export interface EmotionSignal {
  type: EmotionType;
  intensity: EmotionIntensity;
  confidence: number; // 0-1
  source: 'text' | 'voice' | 'combined';
  indicators: string[];
}

export interface VoiceIndicators {
  volume: number; // 0-1, relative to baseline
  pace: number; // words per minute estimate
  pitch: number; // 0-1, relative to baseline
  pauses: number; // count of significant pauses
  energy: number; // 0-1, overall energy level
}

export interface EmotionState {
  primary: EmotionSignal;
  secondary?: EmotionSignal;
  timestamp: number;
  context?: string;
}

export interface ResponseTone {
  style: 'empathetic' | 'encouraging' | 'calm' | 'professional' | 'enthusiastic' | 'patient';
  adjustments: string[];
  promptModifier: string;
}

export interface EmotionHistory {
  states: EmotionState[];
  trend: 'improving' | 'stable' | 'declining';
  dominantEmotion: EmotionType;
}

export interface EmotionDetectorEvents {
  'emotion-detected': (state: EmotionState) => void;
  'emotion-change': (previous: EmotionState, current: EmotionState) => void;
  'tone-adjusted': (tone: ResponseTone) => void;
  'trend-changed': (trend: EmotionHistory['trend']) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Emotion Patterns
// ============================================================================

interface EmotionPattern {
  keywords: string[];
  phrases: string[];
  punctuation?: RegExp[];
  weight: number;
}

const EMOTION_PATTERNS: Record<EmotionType, EmotionPattern> = {
  neutral: {
    keywords: ['okay', 'sure', 'alright', 'fine', 'good'],
    phrases: ['no problem', 'sounds good', 'that works'],
    weight: 0.1,
  },
  happy: {
    keywords: ['great', 'awesome', 'wonderful', 'fantastic', 'excellent', 'love', 'amazing', 'perfect', 'yay', 'wow'],
    phrases: ["that's great", 'so happy', 'thank you so much', 'this is amazing', 'i love it'],
    punctuation: [/!{2,}/g, /:D/gi, /:heart:/gi],
    weight: 0.3,
  },
  sad: {
    keywords: ['sad', 'disappointed', 'unfortunate', 'sorry', 'miss', 'wish', 'regret', 'lost'],
    phrases: ['too bad', "that's sad", 'i wish', "i'm sorry", 'it hurts', 'feeling down'],
    punctuation: [/:\(/g, /;-?\(/g],
    weight: 0.4,
  },
  angry: {
    keywords: ['angry', 'furious', 'annoyed', 'hate', 'stupid', 'ridiculous', 'unacceptable', 'terrible', 'worst'],
    phrases: ['this is ridiculous', 'so annoying', 'i hate', 'makes me angry', 'fed up'],
    punctuation: [/!{3,}/g, /\?{3,}/g],
    weight: 0.5,
  },
  frustrated: {
    keywords: ['frustrated', 'stuck', 'why', 'again', 'still', 'ugh', 'argh', 'sigh', 'broken'],
    phrases: ["doesn't work", 'not working', 'keeps happening', 'tried everything', 'nothing works', "can't figure out"],
    punctuation: [/\.{3,}/g],
    weight: 0.4,
  },
  excited: {
    keywords: ['excited', 'cant wait', 'thrilled', 'eager', 'pumped', 'stoked', 'hyped'],
    phrases: ['so excited', 'cant wait', "i'm pumped", 'this is exciting', 'looking forward'],
    punctuation: [/!{2,}/g],
    weight: 0.3,
  },
  anxious: {
    keywords: ['worried', 'nervous', 'anxious', 'scared', 'afraid', 'concerned', 'unsure', 'risky'],
    phrases: ['not sure if', 'what if', 'worried about', 'hope it', "don't want to"],
    weight: 0.4,
  },
  confused: {
    keywords: ['confused', 'understand', 'unclear', 'lost', 'huh', 'what', 'how'],
    phrases: ["don't understand", "i'm confused", 'what do you mean', 'not clear', "doesn't make sense", 'wait what'],
    punctuation: [/\?{2,}/g],
    weight: 0.3,
  },
  grateful: {
    keywords: ['thanks', 'thank', 'grateful', 'appreciate', 'helpful', 'amazing'],
    phrases: ['thank you', 'so helpful', 'really appreciate', 'thanks so much', 'you saved'],
    weight: 0.3,
  },
  disappointed: {
    keywords: ['disappointed', 'expected', 'hoped', 'thought', 'letdown', 'bummer'],
    phrases: ['was hoping', 'expected better', 'thought it would', "that's disappointing", 'let me down'],
    weight: 0.4,
  },
};

// Voice indicator thresholds
const VOICE_THRESHOLDS = {
  highVolume: 0.7,
  lowVolume: 0.3,
  fastPace: 180, // wpm
  slowPace: 100,
  highEnergy: 0.7,
  lowEnergy: 0.3,
};

// ============================================================================
// Emotion Detector
// ============================================================================

export class EmotionDetector extends EventEmitter {
  private history: EmotionState[] = [];
  private baselineVoice: VoiceIndicators | null = null;
  private storagePath: string;
  private lastState: EmotionState | null = null;

  constructor() {
    super();
    this.storagePath = path.join(app.getPath('userData'), 'emotion-history.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadHistory();
    logger.info('EmotionDetector initialized', { historySize: this.history.length });
  }

  private async loadHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        if (data.history) {
          // Keep last 7 days of history
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
          this.history = data.history.filter((s: EmotionState) => s.timestamp > cutoff);
        }
        if (data.baselineVoice) {
          this.baselineVoice = data.baselineVoice;
        }
      }
    } catch (error) {
      logger.warn('Failed to load emotion history', { error });
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await fs.writeJson(
        this.storagePath,
        {
          history: this.history.slice(-500), // Keep last 500 entries
          baselineVoice: this.baselineVoice,
          savedAt: Date.now(),
        },
        { spaces: 2 }
      );
    } catch (error) {
      logger.error('Failed to save emotion history', { error });
    }
  }

  // ============================================================================
  // Text Analysis
  // ============================================================================

  /**
   * Analyze text for emotional content
   */
  analyzeText(text: string): EmotionSignal[] {
    const textLower = text.toLowerCase();
    const signals: EmotionSignal[] = [];

    for (const [emotion, pattern] of Object.entries(EMOTION_PATTERNS)) {
      const indicators: string[] = [];
      let score = 0;

      // Check keywords
      for (const keyword of pattern.keywords) {
        if (textLower.includes(keyword)) {
          indicators.push(`keyword:${keyword}`);
          score += pattern.weight;
        }
      }

      // Check phrases
      for (const phrase of pattern.phrases) {
        if (textLower.includes(phrase)) {
          indicators.push(`phrase:${phrase}`);
          score += pattern.weight * 1.5; // Phrases are more indicative
        }
      }

      // Check punctuation patterns
      if (pattern.punctuation) {
        for (const punct of pattern.punctuation) {
          const matches = text.match(punct);
          if (matches) {
            indicators.push(`punctuation:${matches[0]}`);
            score += pattern.weight * 0.5;
          }
        }
      }

      if (score > 0.1) {
        const intensity = this.scoreToIntensity(score);
        signals.push({
          type: emotion as EmotionType,
          intensity,
          confidence: Math.min(score / 2, 1),
          source: 'text',
          indicators,
        });
      }
    }

    // Sort by confidence
    signals.sort((a, b) => b.confidence - a.confidence);

    return signals;
  }

  private scoreToIntensity(score: number): EmotionIntensity {
    if (score >= 1.0) return 'strong';
    if (score >= 0.5) return 'moderate';
    return 'subtle';
  }

  // ============================================================================
  // Voice Analysis
  // ============================================================================

  /**
   * Set voice baseline for comparison
   */
  setVoiceBaseline(indicators: VoiceIndicators): void {
    this.baselineVoice = indicators;
    this.saveHistory();
    logger.info('Voice baseline set', { indicators });
  }

  /**
   * Analyze voice indicators for emotional signals
   */
  analyzeVoice(indicators: VoiceIndicators): EmotionSignal[] {
    const signals: EmotionSignal[] = [];
    const voiceIndicators: string[] = [];

    // Compare to baseline if available
    const baseline = this.baselineVoice || {
      volume: 0.5,
      pace: 150,
      pitch: 0.5,
      pauses: 0,
      energy: 0.5,
    };

    // High volume + fast pace = excited or angry
    if (indicators.volume > VOICE_THRESHOLDS.highVolume && indicators.pace > VOICE_THRESHOLDS.fastPace) {
      voiceIndicators.push('high-volume', 'fast-pace');
      signals.push({
        type: indicators.energy > VOICE_THRESHOLDS.highEnergy ? 'excited' : 'angry',
        intensity: 'moderate',
        confidence: 0.6,
        source: 'voice',
        indicators: voiceIndicators,
      });
    }

    // Low volume + slow pace = sad or anxious
    if (indicators.volume < VOICE_THRESHOLDS.lowVolume && indicators.pace < VOICE_THRESHOLDS.slowPace) {
      voiceIndicators.push('low-volume', 'slow-pace');
      signals.push({
        type: indicators.pauses > 2 ? 'sad' : 'anxious',
        intensity: 'moderate',
        confidence: 0.5,
        source: 'voice',
        indicators: voiceIndicators,
      });
    }

    // Fast pace + many pauses = frustrated
    if (indicators.pace > VOICE_THRESHOLDS.fastPace && indicators.pauses > 3) {
      voiceIndicators.push('fast-pace', 'many-pauses');
      signals.push({
        type: 'frustrated',
        intensity: 'moderate',
        confidence: 0.5,
        source: 'voice',
        indicators: voiceIndicators,
      });
    }

    // Low energy = potentially sad or tired
    if (indicators.energy < VOICE_THRESHOLDS.lowEnergy) {
      voiceIndicators.push('low-energy');
      signals.push({
        type: 'sad',
        intensity: 'subtle',
        confidence: 0.4,
        source: 'voice',
        indicators: voiceIndicators,
      });
    }

    // High energy + high volume = happy or excited
    if (indicators.energy > VOICE_THRESHOLDS.highEnergy && indicators.volume > VOICE_THRESHOLDS.highVolume) {
      voiceIndicators.push('high-energy', 'high-volume');
      signals.push({
        type: 'happy',
        intensity: 'moderate',
        confidence: 0.55,
        source: 'voice',
        indicators: voiceIndicators,
      });
    }

    return signals;
  }

  // ============================================================================
  // Combined Analysis
  // ============================================================================

  /**
   * Detect emotion from text and optionally voice
   */
  detectEmotion(text: string, voiceIndicators?: VoiceIndicators): EmotionState {
    const textSignals = this.analyzeText(text);
    const voiceSignals = voiceIndicators ? this.analyzeVoice(voiceIndicators) : [];

    // Combine signals
    const allSignals = [...textSignals, ...voiceSignals];

    // If no signals, return neutral
    if (allSignals.length === 0) {
      const state: EmotionState = {
        primary: {
          type: 'neutral',
          intensity: 'subtle',
          confidence: 0.9,
          source: 'text',
          indicators: [],
        },
        timestamp: Date.now(),
        context: text.substring(0, 100),
      };

      this.recordState(state);
      return state;
    }

    // Find primary emotion (highest confidence)
    const primary = allSignals[0];

    // Find secondary if exists and different
    const secondary = allSignals.find((s) => s.type !== primary.type && s.confidence > 0.3);

    // Create combined signal if we have both text and voice
    if (textSignals.length > 0 && voiceSignals.length > 0) {
      const textPrimary = textSignals[0];
      const voicePrimary = voiceSignals[0];

      // If they agree, boost confidence
      if (textPrimary.type === voicePrimary.type) {
        primary.confidence = Math.min(primary.confidence + 0.2, 1);
        primary.source = 'combined';
        primary.indicators = [...new Set([...textPrimary.indicators, ...voicePrimary.indicators])];
      }
    }

    const state: EmotionState = {
      primary,
      secondary,
      timestamp: Date.now(),
      context: text.substring(0, 100),
    };

    this.recordState(state);
    return state;
  }

  private recordState(state: EmotionState): void {
    const previousState = this.lastState;
    this.lastState = state;
    this.history.push(state);

    // Keep history manageable
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }

    this.emit('emotion-detected', state);

    // Check for emotion change
    if (previousState && previousState.primary.type !== state.primary.type) {
      this.emit('emotion-change', previousState, state);
      logger.info('Emotion changed', {
        from: previousState.primary.type,
        to: state.primary.type,
      });
    }

    // Periodically save
    if (this.history.length % 10 === 0) {
      this.saveHistory();
    }
  }

  // ============================================================================
  // Response Tone
  // ============================================================================

  /**
   * Get recommended response tone based on current emotion
   */
  getResponseTone(state?: EmotionState): ResponseTone {
    const emotion = state?.primary || this.lastState?.primary;

    if (!emotion || emotion.type === 'neutral') {
      return {
        style: 'professional',
        adjustments: [],
        promptModifier: 'Respond in a helpful, professional manner.',
      };
    }

    const tones: Record<EmotionType, ResponseTone> = {
      neutral: {
        style: 'professional',
        adjustments: [],
        promptModifier: 'Respond in a helpful, professional manner.',
      },
      happy: {
        style: 'enthusiastic',
        adjustments: ['match positive energy', 'celebrate successes'],
        promptModifier:
          "Match the user's positive energy. Be enthusiastic and encouraging. Celebrate their success or excitement.",
      },
      sad: {
        style: 'empathetic',
        adjustments: ['acknowledge feelings', 'offer support', 'be gentle'],
        promptModifier:
          'Be empathetic and supportive. Acknowledge their feelings without being dismissive. Offer help gently and show you care.',
      },
      angry: {
        style: 'calm',
        adjustments: ['stay calm', 'validate concerns', 'focus on solutions'],
        promptModifier:
          "Stay calm and professional. Don't be defensive. Validate their concerns and focus on finding solutions. Be concise and action-oriented.",
      },
      frustrated: {
        style: 'patient',
        adjustments: ['acknowledge difficulty', 'provide clear steps', 'offer alternatives'],
        promptModifier:
          'Be patient and understanding. Acknowledge the difficulty they are experiencing. Provide clear, step-by-step guidance and alternative solutions if available.',
      },
      excited: {
        style: 'enthusiastic',
        adjustments: ['share excitement', 'be encouraging', 'maintain momentum'],
        promptModifier:
          "Share in their excitement! Be encouraging and help maintain their momentum. Show genuine interest in what they're working on.",
      },
      anxious: {
        style: 'calm',
        adjustments: ['be reassuring', 'provide clarity', 'reduce uncertainty'],
        promptModifier:
          'Be calm and reassuring. Provide clear information to reduce uncertainty. Break down complex topics into manageable pieces. Offer reassurance where appropriate.',
      },
      confused: {
        style: 'patient',
        adjustments: ['simplify explanations', 'use examples', 'check understanding'],
        promptModifier:
          'Be patient and helpful. Simplify your explanations and use concrete examples. Ask clarifying questions if needed. Avoid jargon unless necessary.',
      },
      grateful: {
        style: 'professional',
        adjustments: ['acknowledge gratitude gracefully', 'offer continued help'],
        promptModifier:
          "Acknowledge their thanks gracefully. Let them know you're happy to help. Offer continued assistance if they need anything else.",
      },
      disappointed: {
        style: 'empathetic',
        adjustments: ['acknowledge disappointment', 'find silver linings', 'suggest next steps'],
        promptModifier:
          "Acknowledge their disappointment without dismissing it. Look for any positives or lessons learned. Suggest constructive next steps if appropriate.",
      },
    };

    const tone = tones[emotion.type] || tones.neutral;
    this.emit('tone-adjusted', tone);

    return tone;
  }

  /**
   * Get system prompt modifier for current emotional context
   */
  getSystemPromptModifier(): string {
    const tone = this.getResponseTone();
    return tone.promptModifier;
  }

  // ============================================================================
  // History Analysis
  // ============================================================================

  /**
   * Get emotion history summary
   */
  getEmotionHistory(): EmotionHistory {
    const recentStates = this.history.slice(-50);

    if (recentStates.length === 0) {
      return {
        states: [],
        trend: 'stable',
        dominantEmotion: 'neutral',
      };
    }

    // Find dominant emotion
    const emotionCounts = new Map<EmotionType, number>();
    for (const state of recentStates) {
      emotionCounts.set(state.primary.type, (emotionCounts.get(state.primary.type) || 0) + 1);
    }

    let dominantEmotion: EmotionType = 'neutral';
    let maxCount = 0;
    for (const [emotion, count] of emotionCounts) {
      if (count > maxCount) {
        dominantEmotion = emotion;
        maxCount = count;
      }
    }

    // Determine trend
    const trend = this.calculateTrend(recentStates);

    return {
      states: recentStates,
      trend,
      dominantEmotion,
    };
  }

  private calculateTrend(states: EmotionState[]): EmotionHistory['trend'] {
    if (states.length < 5) return 'stable';

    const positiveEmotions: EmotionType[] = ['happy', 'excited', 'grateful'];
    const negativeEmotions: EmotionType[] = ['sad', 'angry', 'frustrated', 'anxious', 'disappointed'];

    const firstHalf = states.slice(0, Math.floor(states.length / 2));
    const secondHalf = states.slice(Math.floor(states.length / 2));

    const firstPositive = firstHalf.filter((s) => positiveEmotions.includes(s.primary.type)).length;
    const secondPositive = secondHalf.filter((s) => positiveEmotions.includes(s.primary.type)).length;

    const firstNegative = firstHalf.filter((s) => negativeEmotions.includes(s.primary.type)).length;
    const secondNegative = secondHalf.filter((s) => negativeEmotions.includes(s.primary.type)).length;

    const positiveChange = secondPositive - firstPositive;
    const negativeChange = secondNegative - firstNegative;

    if (positiveChange > 2 || negativeChange < -2) return 'improving';
    if (negativeChange > 2 || positiveChange < -2) return 'declining';
    return 'stable';
  }

  /**
   * Get the last detected emotion
   */
  getLastEmotion(): EmotionState | null {
    return this.lastState;
  }

  /**
   * Clear emotion history
   */
  clearHistory(): void {
    this.history = [];
    this.lastState = null;
    this.saveHistory();
    logger.info('Emotion history cleared');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let emotionDetector: EmotionDetector | null = null;

export function getEmotionDetector(): EmotionDetector {
  if (!emotionDetector) {
    emotionDetector = new EmotionDetector();
  }
  return emotionDetector;
}
