/**
 * Atlas Desktop - Communication Style Adapter
 * Adapt response style based on context and preferences
 *
 * Features:
 * - Context-aware tone adjustment
 * - Formality level adaptation
 * - Verbosity preferences
 * - Cultural communication styles
 * - Persona learning
 *
 * @module ml/communication-adapter
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CommunicationAdapter');

// ============================================================================
// Types
// ============================================================================

export type ToneType = 'professional' | 'casual' | 'friendly' | 'formal' | 'technical' | 'supportive';
export type FormalityLevel = 'very-formal' | 'formal' | 'neutral' | 'casual' | 'very-casual';
export type VerbosityLevel = 'concise' | 'balanced' | 'detailed' | 'comprehensive';

export interface CommunicationStyle {
  tone: ToneType;
  formality: FormalityLevel;
  verbosity: VerbosityLevel;
  useEmoji: boolean;
  useHumor: boolean;
  technicalDepth: number; // 0-1
  empathyLevel: number; // 0-1
  directness: number; // 0-1
}

export interface ContextSignal {
  type: 'time' | 'topic' | 'emotion' | 'urgency' | 'audience' | 'platform';
  value: string;
  confidence: number;
}

export interface StylePreference {
  context: string;
  style: Partial<CommunicationStyle>;
  weight: number;
  uses: number;
  lastUsed: number;
}

export interface AdaptedResponse {
  originalText: string;
  adaptedText: string;
  appliedStyle: CommunicationStyle;
  signals: ContextSignal[];
  confidence: number;
}

export interface CommunicationAdapterConfig {
  defaultStyle: CommunicationStyle;
  adaptationStrength: number; // 0-1, how much to adapt
  learnFromFeedback: boolean;
  contextWindowSize: number;
}

// ============================================================================
// Style Templates
// ============================================================================

const STYLE_TEMPLATES: Record<string, Partial<CommunicationStyle>> = {
  professional: {
    tone: 'professional',
    formality: 'formal',
    verbosity: 'balanced',
    useEmoji: false,
    useHumor: false,
    technicalDepth: 0.5,
    empathyLevel: 0.3,
    directness: 0.7,
  },
  casual: {
    tone: 'casual',
    formality: 'casual',
    verbosity: 'concise',
    useEmoji: true,
    useHumor: true,
    technicalDepth: 0.3,
    empathyLevel: 0.6,
    directness: 0.5,
  },
  technical: {
    tone: 'technical',
    formality: 'neutral',
    verbosity: 'detailed',
    useEmoji: false,
    useHumor: false,
    technicalDepth: 0.9,
    empathyLevel: 0.2,
    directness: 0.8,
  },
  supportive: {
    tone: 'supportive',
    formality: 'neutral',
    verbosity: 'balanced',
    useEmoji: true,
    useHumor: false,
    technicalDepth: 0.4,
    empathyLevel: 0.9,
    directness: 0.4,
  },
};

// ============================================================================
// Text Transformers
// ============================================================================

class TextTransformer {
  /**
   * Adjust formality level
   */
  adjustFormality(text: string, from: FormalityLevel, to: FormalityLevel): string {
    if (from === to) return text;

    const formalityScale = ['very-formal', 'formal', 'neutral', 'casual', 'very-casual'];
    const fromIdx = formalityScale.indexOf(from);
    const toIdx = formalityScale.indexOf(to);

    if (toIdx > fromIdx) {
      // Make more casual
      return this.makeCasual(text);
    } else {
      // Make more formal
      return this.makeFormal(text);
    }
  }

  private makeCasual(text: string): string {
    const replacements: [RegExp, string][] = [
      [/\bI would like to\b/gi, "I'd like to"],
      [/\bI am\b/gi, "I'm"],
      [/\bYou are\b/gi, "You're"],
      [/\bIt is\b/gi, "It's"],
      [/\bThat is\b/gi, "That's"],
      [/\bDo not\b/gi, "Don't"],
      [/\bCannot\b/gi, "Can't"],
      [/\bWill not\b/gi, "Won't"],
      [/\bPlease be advised that\b/gi, 'Just so you know'],
      [/\bKindly\b/gi, 'Please'],
      [/\bAssist\b/gi, 'Help'],
      [/\bPurchase\b/gi, 'Buy'],
      [/\bUtilize\b/gi, 'Use'],
      [/\bCommence\b/gi, 'Start'],
      [/\bSubsequently\b/gi, 'Then'],
      [/\bPrior to\b/gi, 'Before'],
    ];

    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }

    return result;
  }

  private makeFormal(text: string): string {
    const replacements: [RegExp, string][] = [
      [/\bI'd like to\b/gi, 'I would like to'],
      [/\bI'm\b/gi, 'I am'],
      [/\bYou're\b/gi, 'You are'],
      [/\bIt's\b/gi, 'It is'],
      [/\bThat's\b/gi, 'That is'],
      [/\bDon't\b/gi, 'Do not'],
      [/\bCan't\b/gi, 'Cannot'],
      [/\bWon't\b/gi, 'Will not'],
      [/\bJust\b/gi, ''],
      [/\bReally\b/gi, 'Particularly'],
      [/\bHelp\b/gi, 'Assist'],
      [/\bBuy\b/gi, 'Purchase'],
      [/\bUse\b/gi, 'Utilize'],
      [/\bStart\b/gi, 'Commence'],
      [/\bThen\b/gi, 'Subsequently'],
      [/\bBefore\b/gi, 'Prior to'],
    ];

    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }

    // Cleanup double spaces
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Adjust verbosity
   */
  adjustVerbosity(text: string, to: VerbosityLevel): string {
    switch (to) {
      case 'concise':
        return this.makeConcise(text);
      case 'detailed':
        return this.makeDetailed(text);
      case 'comprehensive':
        return this.makeComprehensive(text);
      default:
        return text;
    }
  }

  private makeConcise(text: string): string {
    // Remove filler phrases
    const fillers = [
      /\bBasically,?\s*/gi,
      /\bEssentially,?\s*/gi,
      /\bIn other words,?\s*/gi,
      /\bAs a matter of fact,?\s*/gi,
      /\bIt is important to note that\s*/gi,
      /\bIt should be mentioned that\s*/gi,
      /\bIn order to\b/gi,
      /\bDue to the fact that\b/gi,
      /\bAt this point in time\b/gi,
      /\bIn the event that\b/gi,
    ];

    let result = text;
    for (const filler of fillers) {
      result = result.replace(filler, '');
    }

    // Replace wordy phrases
    result = result
      .replace(/\bIn order to\b/gi, 'To')
      .replace(/\bDue to the fact that\b/gi, 'Because')
      .replace(/\bAt this point in time\b/gi, 'Now')
      .replace(/\bIn the event that\b/gi, 'If');

    return result.replace(/\s+/g, ' ').trim();
  }

  private makeDetailed(text: string): string {
    // Add explanatory phrases where appropriate
    return text;
  }

  private makeComprehensive(text: string): string {
    // Add context and explanations
    return text;
  }

  /**
   * Add or remove emoji
   */
  adjustEmoji(text: string, shouldUse: boolean): string {
    if (shouldUse) {
      return this.addContextualEmoji(text);
    } else {
      return this.removeEmoji(text);
    }
  }

  private addContextualEmoji(text: string): string {
    // Map sentiment to emoji
    const emojiMap: [RegExp, string][] = [
      [/\b(great|excellent|awesome|amazing)\b/gi, '$1 '],
      [/\b(thanks|thank you)\b/gi, '$1 '],
      [/\b(sorry|apologize)\b/gi, '$1 '],
      [/\b(done|complete|finished)\b/gi, '$1 '],
      [/\b(warning|caution)\b/gi, ' $1'],
      [/\b(error|problem|issue)\b/gi, ' $1'],
    ];

    let result = text;
    for (const [pattern, replacement] of emojiMap) {
      if (Math.random() < 0.5) {
        // Don't always add
        result = result.replace(pattern, replacement);
      }
    }

    return result;
  }

  private removeEmoji(text: string): string {
    // Remove common emoji ranges
    return text.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      ''
    );
  }

  /**
   * Adjust technical depth
   */
  adjustTechnicalDepth(text: string, depth: number): string {
    if (depth < 0.3) {
      // Simplify technical terms
      return this.simplifyTechnical(text);
    } else if (depth > 0.7) {
      // Keep technical terms, maybe add more
      return text;
    }
    return text;
  }

  private simplifyTechnical(text: string): string {
    const simplifications: [RegExp, string][] = [
      [/\bAPI\b/g, 'interface'],
      [/\balgorithm\b/gi, 'process'],
      [/\bdatabase\b/gi, 'data storage'],
      [/\bserver\b/gi, 'computer system'],
      [/\bquery\b/gi, 'request'],
      [/\bparse\b/gi, 'read'],
      [/\biterate\b/gi, 'go through'],
      [/\binstantiate\b/gi, 'create'],
      [/\brefactor\b/gi, 'restructure'],
      [/\bdeploy\b/gi, 'release'],
    ];

    let result = text;
    for (const [pattern, replacement] of simplifications) {
      result = result.replace(pattern, replacement);
    }

    return result;
  }
}

// ============================================================================
// Context Analyzer
// ============================================================================

class ContextAnalyzer {
  /**
   * Analyze context from input
   */
  analyzeContext(input: string, metadata?: Record<string, unknown>): ContextSignal[] {
    const signals: ContextSignal[] = [];

    // Time-based context
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 17) {
      signals.push({ type: 'time', value: 'business-hours', confidence: 0.9 });
    } else if (hour >= 22 || hour <= 6) {
      signals.push({ type: 'time', value: 'late-night', confidence: 0.8 });
    }

    // Topic detection
    const topicSignal = this.detectTopic(input);
    if (topicSignal) {
      signals.push(topicSignal);
    }

    // Emotion detection
    const emotionSignal = this.detectEmotion(input);
    if (emotionSignal) {
      signals.push(emotionSignal);
    }

    // Urgency detection
    const urgencySignal = this.detectUrgency(input);
    if (urgencySignal) {
      signals.push(urgencySignal);
    }

    return signals;
  }

  private detectTopic(text: string): ContextSignal | null {
    const topics: Record<string, string[]> = {
      technical: ['code', 'bug', 'error', 'function', 'api', 'database', 'server', 'debug'],
      business: ['meeting', 'schedule', 'deadline', 'project', 'client', 'budget', 'report'],
      personal: ['feel', 'think', 'want', 'need', 'help', 'worried', 'excited'],
      creative: ['idea', 'design', 'create', 'write', 'story', 'art', 'music'],
    };

    const lowerText = text.toLowerCase();
    let bestTopic = '';
    let bestScore = 0;

    for (const [topic, keywords] of Object.entries(topics)) {
      const score = keywords.filter((kw) => lowerText.includes(kw)).length / keywords.length;
      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    if (bestScore > 0.1) {
      return { type: 'topic', value: bestTopic, confidence: Math.min(bestScore * 3, 0.95) };
    }

    return null;
  }

  private detectEmotion(text: string): ContextSignal | null {
    const emotions: Record<string, string[]> = {
      frustrated: ['frustrated', 'annoyed', 'angry', 'stuck', 'why', 'cannot', "can't", 'impossible'],
      happy: ['happy', 'great', 'awesome', 'thanks', 'love', 'excellent', 'perfect'],
      confused: ['confused', 'understand', 'how', 'what', 'unclear', 'lost', '?'],
      worried: ['worried', 'concerned', 'afraid', 'nervous', 'anxious', 'unsure'],
    };

    const lowerText = text.toLowerCase();
    let bestEmotion = '';
    let bestScore = 0;

    for (const [emotion, keywords] of Object.entries(emotions)) {
      const score = keywords.filter((kw) => lowerText.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestEmotion = emotion;
      }
    }

    if (bestScore > 0) {
      return { type: 'emotion', value: bestEmotion, confidence: Math.min(bestScore * 0.3, 0.9) };
    }

    return null;
  }

  private detectUrgency(text: string): ContextSignal | null {
    const urgentKeywords = [
      'urgent',
      'asap',
      'immediately',
      'now',
      'quickly',
      'emergency',
      'critical',
      'deadline',
      '!',
      'help',
    ];

    const lowerText = text.toLowerCase();
    const urgencyScore = urgentKeywords.filter((kw) => lowerText.includes(kw)).length;

    if (urgencyScore > 0) {
      const level = urgencyScore > 2 ? 'high' : 'medium';
      return { type: 'urgency', value: level, confidence: Math.min(urgencyScore * 0.25, 0.9) };
    }

    return null;
  }

  /**
   * Determine optimal style from signals
   */
  determineStyle(signals: ContextSignal[], baseStyle: CommunicationStyle): CommunicationStyle {
    const style = { ...baseStyle };

    for (const signal of signals) {
      switch (signal.type) {
        case 'topic':
          if (signal.value === 'technical') {
            style.technicalDepth = Math.max(style.technicalDepth, 0.7);
            style.tone = 'technical';
          } else if (signal.value === 'personal') {
            style.empathyLevel = Math.max(style.empathyLevel, 0.7);
            style.tone = 'supportive';
          } else if (signal.value === 'business') {
            style.formality = 'formal';
            style.tone = 'professional';
          }
          break;

        case 'emotion':
          if (signal.value === 'frustrated') {
            style.empathyLevel = 0.9;
            style.tone = 'supportive';
            style.directness = 0.8;
          } else if (signal.value === 'confused') {
            style.verbosity = 'detailed';
            style.technicalDepth = Math.max(0, style.technicalDepth - 0.2);
          }
          break;

        case 'urgency':
          if (signal.value === 'high') {
            style.verbosity = 'concise';
            style.directness = 0.9;
          }
          break;

        case 'time':
          if (signal.value === 'late-night') {
            style.formality = 'casual';
            style.useEmoji = true;
          }
          break;
      }
    }

    return style;
  }
}

// ============================================================================
// Communication Adapter
// ============================================================================

export class CommunicationAdapter extends EventEmitter {
  private config: CommunicationAdapterConfig;
  private preferences: Map<string, StylePreference> = new Map();
  private transformer: TextTransformer;
  private analyzer: ContextAnalyzer;
  private conversationHistory: { role: string; style: CommunicationStyle }[] = [];
  private dataPath: string;

  // Stats
  private stats = {
    adaptations: 0,
    feedbackReceived: 0,
    styleChanges: 0,
    averageConfidence: 0,
  };

  constructor(config?: Partial<CommunicationAdapterConfig>) {
    super();
    this.config = {
      defaultStyle: {
        tone: 'friendly',
        formality: 'neutral',
        verbosity: 'balanced',
        useEmoji: false,
        useHumor: false,
        technicalDepth: 0.5,
        empathyLevel: 0.5,
        directness: 0.5,
      },
      adaptationStrength: 0.7,
      learnFromFeedback: true,
      contextWindowSize: 10,
      ...config,
    };

    this.transformer = new TextTransformer();
    this.analyzer = new ContextAnalyzer();
    this.dataPath = path.join(app.getPath('userData'), 'communication-adapter.json');

    this.loadData();
    logger.info('CommunicationAdapter initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        for (const pref of data.preferences || []) {
          this.preferences.set(pref.context, pref);
        }

        if (data.stats) {
          this.stats = data.stats;
        }

        logger.info('Loaded communication preferences', { count: this.preferences.size });
      }
    } catch (error) {
      logger.warn('Failed to load communication data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        preferences: Array.from(this.preferences.values()),
        stats: this.stats,
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save communication data', { error });
    }
  }

  // ============================================================================
  // Main Adaptation
  // ============================================================================

  /**
   * Adapt text to optimal communication style
   */
  adaptResponse(
    text: string,
    userInput?: string,
    overrideStyle?: Partial<CommunicationStyle>
  ): AdaptedResponse {
    // Analyze context
    const signals = userInput ? this.analyzer.analyzeContext(userInput) : [];

    // Determine base style
    let targetStyle = { ...this.config.defaultStyle };

    // Apply context-based adjustments
    targetStyle = this.analyzer.determineStyle(signals, targetStyle);

    // Apply learned preferences
    const contextKey = this.getContextKey(signals);
    const preference = this.preferences.get(contextKey);
    if (preference) {
      targetStyle = this.mergeStyles(targetStyle, preference.style, preference.weight);
    }

    // Apply overrides
    if (overrideStyle) {
      targetStyle = { ...targetStyle, ...overrideStyle };
    }

    // Apply conversation consistency
    targetStyle = this.applyConversationConsistency(targetStyle);

    // Transform text
    let adaptedText = text;

    // Apply transformations based on adaptation strength
    const strength = this.config.adaptationStrength;

    if (strength > 0.3) {
      adaptedText = this.transformer.adjustFormality(
        adaptedText,
        this.config.defaultStyle.formality,
        targetStyle.formality
      );
    }

    if (strength > 0.4) {
      adaptedText = this.transformer.adjustVerbosity(adaptedText, targetStyle.verbosity);
    }

    if (strength > 0.5) {
      adaptedText = this.transformer.adjustEmoji(adaptedText, targetStyle.useEmoji);
    }

    if (strength > 0.6) {
      adaptedText = this.transformer.adjustTechnicalDepth(adaptedText, targetStyle.technicalDepth);
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(signals, preference);

    // Update stats
    this.stats.adaptations++;
    this.stats.averageConfidence =
      (this.stats.averageConfidence * (this.stats.adaptations - 1) + confidence) / this.stats.adaptations;

    // Track conversation style
    this.conversationHistory.push({ role: 'assistant', style: targetStyle });
    if (this.conversationHistory.length > this.config.contextWindowSize) {
      this.conversationHistory.shift();
    }

    return {
      originalText: text,
      adaptedText,
      appliedStyle: targetStyle,
      signals,
      confidence,
    };
  }

  /**
   * Apply style template
   */
  applyTemplate(text: string, templateName: string): string {
    const template = STYLE_TEMPLATES[templateName];
    if (!template) {
      logger.warn('Unknown template', { templateName });
      return text;
    }

    return this.adaptResponse(text, undefined, template).adaptedText;
  }

  /**
   * Apply conversation consistency
   */
  private applyConversationConsistency(style: CommunicationStyle): CommunicationStyle {
    if (this.conversationHistory.length === 0) return style;

    // Average recent styles
    const recentStyles = this.conversationHistory.slice(-3);
    const avgFormality = Math.round(
      recentStyles
        .map((s) => ['very-formal', 'formal', 'neutral', 'casual', 'very-casual'].indexOf(s.style.formality))
        .reduce((a, b) => a + b, 0) / recentStyles.length
    );

    const formalityLevels: FormalityLevel[] = ['very-formal', 'formal', 'neutral', 'casual', 'very-casual'];

    // Bias toward consistency
    const consistencyBias = 0.3;
    const currentFormalityIdx = formalityLevels.indexOf(style.formality);
    const targetIdx = Math.round(currentFormalityIdx * (1 - consistencyBias) + avgFormality * consistencyBias);

    return {
      ...style,
      formality: formalityLevels[Math.max(0, Math.min(4, targetIdx))],
    };
  }

  // ============================================================================
  // Learning
  // ============================================================================

  /**
   * Record feedback on adaptation
   */
  recordFeedback(contextSignals: ContextSignal[], style: CommunicationStyle, positive: boolean): void {
    if (!this.config.learnFromFeedback) return;

    const contextKey = this.getContextKey(contextSignals);
    const existing = this.preferences.get(contextKey);

    const weight = positive ? 0.1 : -0.05;

    if (existing) {
      existing.weight = Math.max(0, Math.min(1, existing.weight + weight));
      existing.uses++;
      existing.lastUsed = Date.now();

      if (positive) {
        existing.style = this.mergeStyles(existing.style, style, 0.3);
      }
    } else if (positive) {
      this.preferences.set(contextKey, {
        context: contextKey,
        style,
        weight: 0.5,
        uses: 1,
        lastUsed: Date.now(),
      });
    }

    this.stats.feedbackReceived++;
    this.saveData();
  }

  /**
   * Learn from user's own messages
   */
  learnFromUserMessage(text: string): void {
    // Analyze user's communication style
    const style = this.analyzeTextStyle(text);
    const signals = this.analyzer.analyzeContext(text);
    const contextKey = this.getContextKey(signals);

    // Store as preferred style for this context
    const existing = this.preferences.get(contextKey);
    if (existing) {
      existing.style = this.mergeStyles(existing.style, style, 0.1);
      existing.uses++;
    } else {
      this.preferences.set(contextKey, {
        context: contextKey,
        style,
        weight: 0.3,
        uses: 1,
        lastUsed: Date.now(),
      });
    }

    this.saveData();
  }

  /**
   * Analyze text to infer communication style
   */
  private analyzeTextStyle(text: string): Partial<CommunicationStyle> {
    const style: Partial<CommunicationStyle> = {};

    // Check for contractions (casual indicator)
    const hasContractions = /\b(I'm|you're|it's|don't|can't|won't)\b/i.test(text);

    // Check for emoji
    const hasEmoji = /[\u{1F600}-\u{1F64F}]/u.test(text);

    // Check formality indicators
    const formalIndicators = /\b(please|kindly|therefore|however|furthermore)\b/i.test(text);
    const casualIndicators = /\b(yeah|yep|nope|gonna|wanna|kinda)\b/i.test(text);

    // Check technical language
    const technicalTerms = /\b(api|database|server|function|algorithm|parse|query)\b/i.test(text);

    // Determine style
    if (casualIndicators || hasContractions) {
      style.formality = hasEmoji ? 'very-casual' : 'casual';
    } else if (formalIndicators) {
      style.formality = 'formal';
    }

    style.useEmoji = hasEmoji;
    style.technicalDepth = technicalTerms ? 0.7 : 0.3;

    // Verbosity from average sentence length
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgLength = text.length / Math.max(sentences.length, 1);
    if (avgLength < 50) {
      style.verbosity = 'concise';
    } else if (avgLength > 150) {
      style.verbosity = 'detailed';
    }

    return style;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private getContextKey(signals: ContextSignal[]): string {
    const relevantSignals = signals.filter((s) => s.confidence > 0.5).sort((a, b) => a.type.localeCompare(b.type));

    return relevantSignals.map((s) => `${s.type}:${s.value}`).join('|') || 'default';
  }

  private mergeStyles(
    base: Partial<CommunicationStyle>,
    override: Partial<CommunicationStyle>,
    weight: number
  ): Partial<CommunicationStyle> {
    const merged = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;

      if (typeof value === 'number') {
        const baseVal = (base as Record<string, number>)[key] || 0.5;
        (merged as Record<string, number>)[key] = baseVal * (1 - weight) + value * weight;
      } else if (weight > 0.5) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }

    return merged;
  }

  private calculateConfidence(signals: ContextSignal[], preference?: StylePreference): number {
    let confidence = 0.5;

    // More signals = more confidence
    confidence += Math.min(signals.length * 0.1, 0.3);

    // Higher signal confidence = more overall confidence
    const avgSignalConfidence = signals.length > 0 ? signals.reduce((a, s) => a + s.confidence, 0) / signals.length : 0;

    confidence += avgSignalConfidence * 0.2;

    // Existing preference boosts confidence
    if (preference) {
      confidence += preference.weight * 0.2;
      confidence += Math.min(preference.uses * 0.01, 0.1);
    }

    return Math.min(confidence, 0.95);
  }

  /**
   * Set default style
   */
  setDefaultStyle(style: Partial<CommunicationStyle>): void {
    this.config.defaultStyle = { ...this.config.defaultStyle, ...style };
    this.stats.styleChanges++;
    logger.info('Default style updated', { style: this.config.defaultStyle });
  }

  /**
   * Get style preferences
   */
  getPreferences(): StylePreference[] {
    return Array.from(this.preferences.values());
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats & { preferencesLearned: number } {
    return {
      ...this.stats,
      preferencesLearned: this.preferences.size,
    };
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.preferences.clear();
    this.conversationHistory = [];
    this.saveData();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let communicationAdapter: CommunicationAdapter | null = null;

export function getCommunicationAdapter(): CommunicationAdapter {
  if (!communicationAdapter) {
    communicationAdapter = new CommunicationAdapter();
  }
  return communicationAdapter;
}
