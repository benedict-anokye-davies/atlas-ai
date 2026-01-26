/**
 * Atlas Desktop - Adaptive Response Length
 * Learn user preferences for verbose vs concise responses
 *
 * Features:
 * - Track user feedback on response length
 * - Analyze query complexity to determine appropriate length
 * - Context-aware length adjustment
 * - User preference learning over time
 *
 * @module llm/response-adapter
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ResponseAdapter');

// ============================================================================
// Types
// ============================================================================

export type ResponseLength = 'minimal' | 'brief' | 'moderate' | 'detailed' | 'comprehensive';
export type QueryType = 'factual' | 'how-to' | 'explanation' | 'creative' | 'code' | 'conversation' | 'command';

export interface ResponseLengthConfig {
  minimal: { minTokens: number; maxTokens: number; description: string };
  brief: { minTokens: number; maxTokens: number; description: string };
  moderate: { minTokens: number; maxTokens: number; description: string };
  detailed: { minTokens: number; maxTokens: number; description: string };
  comprehensive: { minTokens: number; maxTokens: number; description: string };
}

export interface UserPreferences {
  defaultLength: ResponseLength;
  queryTypePreferences: Partial<Record<QueryType, ResponseLength>>;
  timeOfDayPreferences: {
    morning?: ResponseLength;
    afternoon?: ResponseLength;
    evening?: ResponseLength;
  };
  feedbackHistory: FeedbackEntry[];
  lastUpdated: number;
}

export interface FeedbackEntry {
  timestamp: number;
  queryType: QueryType;
  responseLength: ResponseLength;
  actualTokens: number;
  feedback: 'too_short' | 'just_right' | 'too_long';
  query: string;
}

export interface QueryAnalysis {
  type: QueryType;
  complexity: number; // 0-1
  urgency: number; // 0-1
  technicalLevel: number; // 0-1
  isFollowUp: boolean;
  suggestedLength: ResponseLength;
  confidence: number;
}

export interface ResponseAdapterEvents {
  'length-adapted': (query: string, length: ResponseLength, reason: string) => void;
  'feedback-recorded': (entry: FeedbackEntry) => void;
  'preferences-updated': (prefs: UserPreferences) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_LENGTH_CONFIG: ResponseLengthConfig = {
  minimal: { minTokens: 10, maxTokens: 50, description: 'One-liner or yes/no' },
  brief: { minTokens: 30, maxTokens: 150, description: 'A few sentences' },
  moderate: { minTokens: 100, maxTokens: 400, description: 'A paragraph or two' },
  detailed: { minTokens: 300, maxTokens: 800, description: 'Thorough explanation' },
  comprehensive: { minTokens: 600, maxTokens: 2000, description: 'Full deep-dive' },
};

const DEFAULT_PREFERENCES: UserPreferences = {
  defaultLength: 'moderate',
  queryTypePreferences: {
    factual: 'brief',
    'how-to': 'detailed',
    explanation: 'detailed',
    creative: 'moderate',
    code: 'detailed',
    conversation: 'brief',
    command: 'minimal',
  },
  timeOfDayPreferences: {},
  feedbackHistory: [],
  lastUpdated: Date.now(),
};

// Query type detection patterns
const QUERY_PATTERNS: Record<QueryType, RegExp[]> = {
  factual: [/^(what|who|when|where|which|how much|how many)\b/i, /\?$/],
  'how-to': [/^how (do|can|to|should)\b/i, /^(show|teach|explain how)\b/i, /step[s]?\b/i],
  explanation: [/^(why|explain|describe|what is|what are)\b/i, /\bmean[s]?\b/i, /\bdifference\b/i],
  creative: [/^(write|create|compose|make|generate|design)\b/i, /\b(story|poem|essay|article)\b/i],
  code: [/\b(code|function|class|bug|error|implement|script|program)\b/i, /```/],
  conversation: [/^(hi|hello|hey|thanks|bye|good)\b/i, /\b(chat|talk|discuss)\b/i],
  command: [/^(do|run|execute|start|stop|open|close|play|pause)\b/i, /\b(turn on|turn off|set|change)\b/i],
};

// ============================================================================
// Response Adapter
// ============================================================================

export class ResponseAdapter extends EventEmitter {
  private lengthConfig: ResponseLengthConfig;
  private preferences: UserPreferences;
  private storagePath: string;
  private conversationContext: string[] = [];

  constructor() {
    super();
    this.lengthConfig = { ...DEFAULT_LENGTH_CONFIG };
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.storagePath = path.join(app.getPath('userData'), 'response-preferences.json');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.loadPreferences();
      logger.info('ResponseAdapter initialized', {
        defaultLength: this.preferences.defaultLength,
        feedbackCount: this.preferences.feedbackHistory.length,
      });
    } catch (error) {
      logger.error('Failed to initialize response adapter', { error });
    }
  }

  private async loadPreferences(): Promise<void> {
    try {
      if (await fs.pathExists(this.storagePath)) {
        const data = await fs.readJson(this.storagePath);
        this.preferences = { ...DEFAULT_PREFERENCES, ...data };
      }
    } catch (error) {
      logger.warn('Failed to load preferences, using defaults', { error });
    }
  }

  private async savePreferences(): Promise<void> {
    try {
      await fs.writeJson(this.storagePath, this.preferences, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save preferences', { error });
    }
  }

  // ============================================================================
  // Query Analysis
  // ============================================================================

  /**
   * Analyze a query to determine appropriate response length
   */
  analyzeQuery(query: string): QueryAnalysis {
    const queryLower = query.toLowerCase().trim();

    // Detect query type
    const type = this.detectQueryType(queryLower);

    // Calculate complexity (based on length, punctuation, technical terms)
    const complexity = this.calculateComplexity(query);

    // Calculate urgency (based on urgency words, question marks)
    const urgency = this.calculateUrgency(queryLower);

    // Calculate technical level
    const technicalLevel = this.calculateTechnicalLevel(query);

    // Check if this is a follow-up question
    const isFollowUp = this.isFollowUpQuery(queryLower);

    // Determine suggested length
    const suggestedLength = this.determineSuggestedLength(type, complexity, urgency, technicalLevel, isFollowUp);

    const analysis: QueryAnalysis = {
      type,
      complexity,
      urgency,
      technicalLevel,
      isFollowUp,
      suggestedLength,
      confidence: this.calculateConfidence(type, complexity),
    };

    logger.debug('Query analyzed', { query: query.substring(0, 50), analysis });

    return analysis;
  }

  private detectQueryType(query: string): QueryType {
    for (const [type, patterns] of Object.entries(QUERY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          return type as QueryType;
        }
      }
    }
    return 'conversation';
  }

  private calculateComplexity(query: string): number {
    const factors = {
      length: Math.min(query.length / 200, 1) * 0.3,
      words: Math.min(query.split(/\s+/).length / 30, 1) * 0.2,
      punctuation: Math.min((query.match(/[,;:()]/g) || []).length / 5, 1) * 0.2,
      technicalTerms: this.countTechnicalTerms(query) * 0.3,
    };

    return factors.length + factors.words + factors.punctuation + factors.technicalTerms;
  }

  private countTechnicalTerms(text: string): number {
    const technicalPatterns = [
      /\b(api|sdk|cli|gui|url|http|json|xml|sql|html|css|javascript|typescript|python|react|node)\b/gi,
      /\b(function|class|method|variable|array|object|string|number|boolean)\b/gi,
      /\b(algorithm|database|server|client|frontend|backend|framework|library)\b/gi,
    ];

    let count = 0;
    for (const pattern of technicalPatterns) {
      count += (text.match(pattern) || []).length;
    }

    return Math.min(count / 5, 1);
  }

  private calculateUrgency(query: string): number {
    const urgencyPatterns = [
      { pattern: /\b(urgent|asap|immediately|now|quick|fast)\b/i, weight: 0.8 },
      { pattern: /\b(help|emergency|critical|important)\b/i, weight: 0.6 },
      { pattern: /\?{2,}/g, weight: 0.4 },
      { pattern: /\!+/g, weight: 0.3 },
    ];

    let urgency = 0;
    for (const { pattern, weight } of urgencyPatterns) {
      if (pattern.test(query)) {
        urgency += weight;
      }
    }

    return Math.min(urgency, 1);
  }

  private calculateTechnicalLevel(query: string): number {
    const technicalCount = this.countTechnicalTerms(query);
    const hasCodeBlocks = /```/.test(query);
    const hasSpecificSyntax = /[<>{}[\]()]/.test(query);

    return Math.min(technicalCount + (hasCodeBlocks ? 0.3 : 0) + (hasSpecificSyntax ? 0.2 : 0), 1);
  }

  private isFollowUpQuery(query: string): boolean {
    const followUpPatterns = [
      /^(and|also|but|what about|how about|can you also)/i,
      /^(more|another|next|then)/i,
      /\b(that|this|it|they|them)\b/i,
    ];

    // Also check conversation context
    if (this.conversationContext.length > 0) {
      for (const pattern of followUpPatterns) {
        if (pattern.test(query)) {
          return true;
        }
      }
    }

    return false;
  }

  private determineSuggestedLength(
    type: QueryType,
    complexity: number,
    urgency: number,
    technicalLevel: number,
    isFollowUp: boolean
  ): ResponseLength {
    // Get base preference for this query type
    let baseLength = this.preferences.queryTypePreferences[type] || this.preferences.defaultLength;

    // Adjust based on time of day
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12 && this.preferences.timeOfDayPreferences.morning) {
      baseLength = this.preferences.timeOfDayPreferences.morning;
    } else if (hour >= 12 && hour < 17 && this.preferences.timeOfDayPreferences.afternoon) {
      baseLength = this.preferences.timeOfDayPreferences.afternoon;
    } else if (hour >= 17 && this.preferences.timeOfDayPreferences.evening) {
      baseLength = this.preferences.timeOfDayPreferences.evening;
    }

    // Adjust based on factors
    const lengthScale = ['minimal', 'brief', 'moderate', 'detailed', 'comprehensive'];
    let index = lengthScale.indexOf(baseLength);

    // High urgency → shorter responses
    if (urgency > 0.6) {
      index = Math.max(0, index - 1);
    }

    // High complexity → longer responses
    if (complexity > 0.6) {
      index = Math.min(lengthScale.length - 1, index + 1);
    }

    // High technical level → longer responses
    if (technicalLevel > 0.5) {
      index = Math.min(lengthScale.length - 1, index + 1);
    }

    // Follow-up questions → shorter responses (context already established)
    if (isFollowUp) {
      index = Math.max(0, index - 1);
    }

    return lengthScale[index] as ResponseLength;
  }

  private calculateConfidence(type: QueryType, complexity: number): number {
    // Higher confidence when we have more feedback for this type
    const feedbackForType = this.preferences.feedbackHistory.filter((f) => f.queryType === type).length;
    const feedbackBonus = Math.min(feedbackForType / 20, 0.3);

    // Lower confidence for complex queries
    const complexityPenalty = complexity * 0.2;

    return Math.min(0.5 + feedbackBonus - complexityPenalty, 1);
  }

  // ============================================================================
  // Response Generation
  // ============================================================================

  /**
   * Get the recommended response length for a query
   */
  getRecommendedLength(query: string): { length: ResponseLength; config: ResponseLengthConfig[ResponseLength]; analysis: QueryAnalysis } {
    const analysis = this.analyzeQuery(query);

    this.emit('length-adapted', query, analysis.suggestedLength, `Query type: ${analysis.type}, complexity: ${analysis.complexity.toFixed(2)}`);

    return {
      length: analysis.suggestedLength,
      config: this.lengthConfig[analysis.suggestedLength],
      analysis,
    };
  }

  /**
   * Generate system prompt modifier for response length
   */
  getSystemPromptModifier(length: ResponseLength): string {
    const config = this.lengthConfig[length];
    const modifiers: Record<ResponseLength, string> = {
      minimal: 'Be extremely concise. Answer in one sentence or a few words. No explanations unless asked.',
      brief: 'Be concise. Use 1-3 sentences. Get straight to the point.',
      moderate: 'Provide a balanced response. Use a paragraph or two with enough detail to be helpful.',
      detailed: 'Provide a thorough response with explanations, examples, and context where helpful.',
      comprehensive: 'Provide an in-depth, comprehensive response. Include background, detailed explanations, examples, and related information.',
    };

    return `${modifiers[length]} Target response length: ${config.minTokens}-${config.maxTokens} tokens.`;
  }

  // ============================================================================
  // Feedback Learning
  // ============================================================================

  /**
   * Record user feedback on a response
   */
  async recordFeedback(
    query: string,
    responseLength: ResponseLength,
    actualTokens: number,
    feedback: 'too_short' | 'just_right' | 'too_long'
  ): Promise<void> {
    const analysis = this.analyzeQuery(query);

    const entry: FeedbackEntry = {
      timestamp: Date.now(),
      queryType: analysis.type,
      responseLength,
      actualTokens,
      feedback,
      query: query.substring(0, 100), // Truncate for storage
    };

    this.preferences.feedbackHistory.push(entry);

    // Keep only last 500 feedback entries
    if (this.preferences.feedbackHistory.length > 500) {
      this.preferences.feedbackHistory = this.preferences.feedbackHistory.slice(-500);
    }

    // Learn from feedback
    this.learnFromFeedback();

    this.preferences.lastUpdated = Date.now();
    await this.savePreferences();

    this.emit('feedback-recorded', entry);
    logger.info('Feedback recorded', { queryType: analysis.type, feedback, responseLength });
  }

  /**
   * Learn from feedback history to adjust preferences
   */
  private learnFromFeedback(): void {
    const recentFeedback = this.preferences.feedbackHistory.slice(-100);

    if (recentFeedback.length < 10) return; // Not enough data

    // Analyze feedback by query type
    const byType = new Map<QueryType, FeedbackEntry[]>();
    for (const entry of recentFeedback) {
      const existing = byType.get(entry.queryType) || [];
      existing.push(entry);
      byType.set(entry.queryType, existing);
    }

    const lengthScale = ['minimal', 'brief', 'moderate', 'detailed', 'comprehensive'];

    // Adjust preferences for each type
    for (const [type, entries] of byType) {
      if (entries.length < 5) continue;

      const tooShort = entries.filter((e) => e.feedback === 'too_short').length;
      const tooLong = entries.filter((e) => e.feedback === 'too_long').length;
      const justRight = entries.filter((e) => e.feedback === 'just_right').length;

      const currentPref = this.preferences.queryTypePreferences[type] || 'moderate';
      let currentIndex = lengthScale.indexOf(currentPref);

      // If significantly more "too short" than "too long", increase length
      if (tooShort > tooLong * 1.5 && tooShort > justRight * 0.5) {
        currentIndex = Math.min(lengthScale.length - 1, currentIndex + 1);
      }
      // If significantly more "too long" than "too short", decrease length
      else if (tooLong > tooShort * 1.5 && tooLong > justRight * 0.5) {
        currentIndex = Math.max(0, currentIndex - 1);
      }

      this.preferences.queryTypePreferences[type] = lengthScale[currentIndex] as ResponseLength;
    }

    this.emit('preferences-updated', this.preferences);
    logger.info('Preferences updated from feedback');
  }

  // ============================================================================
  // Context Management
  // ============================================================================

  /**
   * Add to conversation context for follow-up detection
   */
  addToContext(query: string): void {
    this.conversationContext.push(query);
    if (this.conversationContext.length > 5) {
      this.conversationContext.shift();
    }
  }

  /**
   * Clear conversation context
   */
  clearContext(): void {
    this.conversationContext = [];
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Update length configuration
   */
  updateLengthConfig(config: Partial<ResponseLengthConfig>): void {
    this.lengthConfig = { ...this.lengthConfig, ...config };
    logger.info('Length configuration updated');
  }

  /**
   * Set default response length
   */
  async setDefaultLength(length: ResponseLength): Promise<void> {
    this.preferences.defaultLength = length;
    await this.savePreferences();
    this.emit('preferences-updated', this.preferences);
  }

  /**
   * Set preference for a query type
   */
  async setQueryTypePreference(type: QueryType, length: ResponseLength): Promise<void> {
    this.preferences.queryTypePreferences[type] = length;
    await this.savePreferences();
    this.emit('preferences-updated', this.preferences);
  }

  /**
   * Get current preferences
   */
  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * Get feedback statistics
   */
  getFeedbackStats(): { total: number; byFeedback: Record<string, number>; byType: Record<string, number> } {
    const feedback = this.preferences.feedbackHistory;
    return {
      total: feedback.length,
      byFeedback: {
        too_short: feedback.filter((f) => f.feedback === 'too_short').length,
        just_right: feedback.filter((f) => f.feedback === 'just_right').length,
        too_long: feedback.filter((f) => f.feedback === 'too_long').length,
      },
      byType: Object.fromEntries(
        Object.keys(QUERY_PATTERNS).map((type) => [type, feedback.filter((f) => f.queryType === type).length])
      ),
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let responseAdapter: ResponseAdapter | null = null;

export function getResponseAdapter(): ResponseAdapter {
  if (!responseAdapter) {
    responseAdapter = new ResponseAdapter();
  }
  return responseAdapter;
}
