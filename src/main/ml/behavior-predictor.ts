/**
 * Atlas Desktop - Behavior Predictor
 * Predict user needs from behavioral patterns
 *
 * Features:
 * - Temporal pattern learning
 * - Activity sequence modeling
 * - Context-aware predictions
 * - Proactive suggestions
 * - Preference inference
 *
 * @module ml/behavior-predictor
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('BehaviorPredictor');

// ============================================================================
// Types
// ============================================================================

export interface UserActivity {
  id: string;
  type: string;
  action: string;
  context: Record<string, unknown>;
  timestamp: number;
  duration?: number;
}

export interface BehaviorPattern {
  id: string;
  sequence: string[]; // Activity type sequence
  frequency: number;
  averageDuration: number;
  contexts: Record<string, number>; // Context -> count
  timeOfDay: number[]; // Hour distribution
  dayOfWeek: number[]; // Day distribution
  lastSeen: number;
}

export interface BehaviorPrediction {
  type: string;
  action: string;
  probability: number;
  confidence: number;
  reasoning: string;
  suggestedContext?: Record<string, unknown>;
  timeUntil?: number; // ms
}

export interface UserPreference {
  key: string;
  value: unknown;
  confidence: number;
  inferredFrom: string[];
  lastUpdated: number;
}

export interface BehaviorPredictorConfig {
  sequenceLength: number;
  minPatternFrequency: number;
  predictionThreshold: number;
  maxPredictions: number;
  decayFactor: number;
}

export interface BehaviorPredictorEvents {
  'prediction-made': (predictions: BehaviorPrediction[]) => void;
  'pattern-discovered': (pattern: BehaviorPattern) => void;
  'preference-inferred': (preference: UserPreference) => void;
  'suggestion-ready': (suggestion: BehaviorPrediction) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Behavior Predictor
// ============================================================================

export class BehaviorPredictor extends EventEmitter {
  private config: BehaviorPredictorConfig;
  private activityHistory: UserActivity[] = [];
  private patterns: Map<string, BehaviorPattern> = new Map();
  private preferences: Map<string, UserPreference> = new Map();
  private dataPath: string;

  // Sequence modeling
  private transitionMatrix: Map<string, Map<string, number>> = new Map();
  private contextInfluence: Map<string, Map<string, number>> = new Map();

  // Stats
  private stats = {
    activitiesRecorded: 0,
    patternsDiscovered: 0,
    predictionsMade: 0,
    correctPredictions: 0,
  };

  constructor(config?: Partial<BehaviorPredictorConfig>) {
    super();
    this.config = {
      sequenceLength: 5,
      minPatternFrequency: 3,
      predictionThreshold: 0.3,
      maxPredictions: 5,
      decayFactor: 0.95,
      ...config,
    };

    this.dataPath = path.join(app.getPath('userData'), 'behavior-patterns.json');
    this.loadData();

    logger.info('BehaviorPredictor initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        // Load patterns
        for (const pattern of data.patterns || []) {
          this.patterns.set(pattern.id, pattern);
        }

        // Load preferences
        for (const pref of data.preferences || []) {
          this.preferences.set(pref.key, pref);
        }

        // Load transition matrix
        if (data.transitionMatrix) {
          for (const [from, transitions] of Object.entries(data.transitionMatrix)) {
            this.transitionMatrix.set(from, new Map(Object.entries(transitions as Record<string, number>)));
          }
        }

        // Load recent history
        this.activityHistory = (data.activityHistory || []).slice(-1000);

        logger.info('Loaded behavior data', {
          patterns: this.patterns.size,
          preferences: this.preferences.size,
          history: this.activityHistory.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to load behavior data', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        patterns: Array.from(this.patterns.values()),
        preferences: Array.from(this.preferences.values()),
        transitionMatrix: Object.fromEntries(
          Array.from(this.transitionMatrix.entries()).map(([k, v]) => [k, Object.fromEntries(v)])
        ),
        activityHistory: this.activityHistory.slice(-1000),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save behavior data', { error });
    }
  }

  // ============================================================================
  // Activity Recording
  // ============================================================================

  /**
   * Record a user activity
   */
  recordActivity(activity: Omit<UserActivity, 'id' | 'timestamp'>): void {
    const fullActivity: UserActivity = {
      ...activity,
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.activityHistory.push(fullActivity);
    this.stats.activitiesRecorded++;

    // Update transition matrix
    this.updateTransitionMatrix(fullActivity);

    // Update context influence
    this.updateContextInfluence(fullActivity);

    // Check for patterns
    this.discoverPatterns();

    // Infer preferences
    this.inferPreferences(fullActivity);

    // Save periodically
    if (this.activityHistory.length % 10 === 0) {
      this.saveData();
    }
  }

  /**
   * Update transition probabilities
   */
  private updateTransitionMatrix(activity: UserActivity): void {
    if (this.activityHistory.length < 2) return;

    const prevActivity = this.activityHistory[this.activityHistory.length - 2];
    const prevKey = `${prevActivity.type}:${prevActivity.action}`;
    const currKey = `${activity.type}:${activity.action}`;

    if (!this.transitionMatrix.has(prevKey)) {
      this.transitionMatrix.set(prevKey, new Map());
    }

    const transitions = this.transitionMatrix.get(prevKey)!;
    transitions.set(currKey, (transitions.get(currKey) || 0) + 1);
  }

  /**
   * Update context influence scores
   */
  private updateContextInfluence(activity: UserActivity): void {
    const activityKey = `${activity.type}:${activity.action}`;

    if (!this.contextInfluence.has(activityKey)) {
      this.contextInfluence.set(activityKey, new Map());
    }

    const influence = this.contextInfluence.get(activityKey)!;

    // Record context factors
    for (const [key, value] of Object.entries(activity.context)) {
      const contextKey = `${key}:${JSON.stringify(value)}`;
      influence.set(contextKey, (influence.get(contextKey) || 0) + 1);
    }

    // Time-based context
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    influence.set(`hour:${hour}`, (influence.get(`hour:${hour}`) || 0) + 1);
    influence.set(`day:${dayOfWeek}`, (influence.get(`day:${dayOfWeek}`) || 0) + 1);
  }

  // ============================================================================
  // Pattern Discovery
  // ============================================================================

  /**
   * Discover behavioral patterns from history
   */
  private discoverPatterns(): void {
    if (this.activityHistory.length < this.config.sequenceLength) return;

    // Extract recent sequence
    const recentActivities = this.activityHistory.slice(-this.config.sequenceLength);
    const sequence = recentActivities.map((a) => `${a.type}:${a.action}`);
    const patternId = sequence.join('->');

    // Check if pattern exists
    let pattern = this.patterns.get(patternId);

    if (pattern) {
      // Update existing pattern
      pattern.frequency++;
      pattern.lastSeen = Date.now();

      // Update time distributions
      const hour = new Date().getHours();
      const day = new Date().getDay();
      pattern.timeOfDay[hour] = (pattern.timeOfDay[hour] || 0) + 1;
      pattern.dayOfWeek[day] = (pattern.dayOfWeek[day] || 0) + 1;

      // Update context counts
      for (const activity of recentActivities) {
        for (const [key, value] of Object.entries(activity.context)) {
          const contextKey = `${key}:${JSON.stringify(value)}`;
          pattern.contexts[contextKey] = (pattern.contexts[contextKey] || 0) + 1;
        }
      }

      // Calculate average duration
      const totalDuration = recentActivities.reduce((sum, a) => sum + (a.duration || 0), 0);
      pattern.averageDuration =
        (pattern.averageDuration * (pattern.frequency - 1) + totalDuration) / pattern.frequency;
    } else {
      // Create new pattern
      pattern = {
        id: patternId,
        sequence,
        frequency: 1,
        averageDuration: recentActivities.reduce((sum, a) => sum + (a.duration || 0), 0),
        contexts: {},
        timeOfDay: new Array(24).fill(0),
        dayOfWeek: new Array(7).fill(0),
        lastSeen: Date.now(),
      };

      const hour = new Date().getHours();
      const day = new Date().getDay();
      pattern.timeOfDay[hour] = 1;
      pattern.dayOfWeek[day] = 1;

      for (const activity of recentActivities) {
        for (const [key, value] of Object.entries(activity.context)) {
          const contextKey = `${key}:${JSON.stringify(value)}`;
          pattern.contexts[contextKey] = 1;
        }
      }

      this.patterns.set(patternId, pattern);
      this.stats.patternsDiscovered++;

      if (pattern.frequency >= this.config.minPatternFrequency) {
        this.emit('pattern-discovered', pattern);
        logger.info('New pattern discovered', { patternId, frequency: pattern.frequency });
      }
    }
  }

  // ============================================================================
  // Prediction
  // ============================================================================

  /**
   * Predict next likely activities
   */
  predict(): BehaviorPrediction[] {
    if (this.activityHistory.length === 0) return [];

    const predictions: BehaviorPrediction[] = [];
    const currentActivity = this.activityHistory[this.activityHistory.length - 1];
    const currentKey = `${currentActivity.type}:${currentActivity.action}`;
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();

    // 1. Transition-based prediction
    const transitions = this.transitionMatrix.get(currentKey);
    if (transitions) {
      const totalTransitions = Array.from(transitions.values()).reduce((a, b) => a + b, 0);

      for (const [nextKey, count] of transitions) {
        const probability = count / totalTransitions;
        if (probability >= this.config.predictionThreshold) {
          const [type, action] = nextKey.split(':');
          predictions.push({
            type,
            action,
            probability,
            confidence: Math.min(count / 10, 1), // Higher confidence with more samples
            reasoning: `Based on ${count} previous transitions from current activity`,
          });
        }
      }
    }

    // 2. Pattern-based prediction
    for (const pattern of this.patterns.values()) {
      if (pattern.frequency < this.config.minPatternFrequency) continue;

      // Check if current sequence matches pattern prefix
      const recentSequence = this.activityHistory
        .slice(-this.config.sequenceLength + 1)
        .map((a) => `${a.type}:${a.action}`);

      const patternPrefix = pattern.sequence.slice(0, -1);
      const matchScore = this.sequenceMatchScore(recentSequence, patternPrefix);

      if (matchScore > 0.7) {
        const nextActivity = pattern.sequence[pattern.sequence.length - 1];
        const [type, action] = nextActivity.split(':');

        // Adjust probability by time factors
        const hourFactor = (pattern.timeOfDay[currentHour] || 0) / Math.max(...pattern.timeOfDay, 1);
        const dayFactor = (pattern.dayOfWeek[currentDay] || 0) / Math.max(...pattern.dayOfWeek, 1);

        const probability = matchScore * (0.5 + 0.25 * hourFactor + 0.25 * dayFactor);

        if (probability >= this.config.predictionThreshold) {
          // Check if not already predicted
          const existing = predictions.find((p) => p.type === type && p.action === action);
          if (existing) {
            existing.probability = Math.max(existing.probability, probability);
            existing.confidence = Math.max(existing.confidence, pattern.frequency / 20);
          } else {
            predictions.push({
              type,
              action,
              probability,
              confidence: Math.min(pattern.frequency / 20, 1),
              reasoning: `Pattern "${pattern.id}" seen ${pattern.frequency} times`,
              suggestedContext: this.extractTopContext(pattern),
            });
          }
        }
      }
    }

    // 3. Time-based prediction
    const timePredictions = this.predictByTime(currentHour, currentDay);
    for (const timePred of timePredictions) {
      const existing = predictions.find((p) => p.type === timePred.type && p.action === timePred.action);
      if (!existing && timePred.probability >= this.config.predictionThreshold) {
        predictions.push(timePred);
      }
    }

    // Sort and limit predictions
    predictions.sort((a, b) => b.probability - a.probability);
    const topPredictions = predictions.slice(0, this.config.maxPredictions);

    this.stats.predictionsMade += topPredictions.length;
    this.emit('prediction-made', topPredictions);

    return topPredictions;
  }

  /**
   * Calculate sequence match score
   */
  private sequenceMatchScore(seq1: string[], seq2: string[]): number {
    if (seq2.length === 0) return 1;
    if (seq1.length < seq2.length) return 0;

    let matches = 0;
    const startIdx = seq1.length - seq2.length;

    for (let i = 0; i < seq2.length; i++) {
      if (seq1[startIdx + i] === seq2[i]) {
        matches++;
      }
    }

    return matches / seq2.length;
  }

  /**
   * Extract top context from pattern
   */
  private extractTopContext(pattern: BehaviorPattern): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    const sorted = Object.entries(pattern.contexts).sort(([, a], [, b]) => b - a);

    for (const [contextKey] of sorted.slice(0, 3)) {
      const [key, valueStr] = contextKey.split(':');
      if (key && valueStr) {
        try {
          context[key] = JSON.parse(valueStr);
        } catch {
          context[key] = valueStr;
        }
      }
    }

    return context;
  }

  /**
   * Predict based on time patterns
   */
  private predictByTime(hour: number, day: number): BehaviorPrediction[] {
    const timePredictions: BehaviorPrediction[] = [];
    const activityByTime = new Map<string, number>();

    // Count activities at this time
    for (const activity of this.activityHistory) {
      const actHour = new Date(activity.timestamp).getHours();
      const actDay = new Date(activity.timestamp).getDay();

      if (Math.abs(actHour - hour) <= 1 && actDay === day) {
        const key = `${activity.type}:${activity.action}`;
        activityByTime.set(key, (activityByTime.get(key) || 0) + 1);
      }
    }

    const total = Array.from(activityByTime.values()).reduce((a, b) => a + b, 0);

    for (const [key, count] of activityByTime) {
      const probability = count / total;
      if (probability >= this.config.predictionThreshold) {
        const [type, action] = key.split(':');
        timePredictions.push({
          type,
          action,
          probability: probability * 0.8, // Slightly lower weight for time-only
          confidence: Math.min(count / 10, 1),
          reasoning: `Usually done ${count} times around this time on ${this.dayName(day)}`,
          timeUntil: 0,
        });
      }
    }

    return timePredictions;
  }

  /**
   * Get day name
   */
  private dayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day];
  }

  // ============================================================================
  // Preference Inference
  // ============================================================================

  /**
   * Infer preferences from activity
   */
  private inferPreferences(activity: UserActivity): void {
    // Infer from context patterns
    for (const [key, value] of Object.entries(activity.context)) {
      const prefKey = `${activity.type}.${key}`;

      let preference = this.preferences.get(prefKey);

      if (preference) {
        // Update confidence
        if (JSON.stringify(preference.value) === JSON.stringify(value)) {
          preference.confidence = Math.min(preference.confidence + 0.1, 1);
        } else {
          preference.confidence *= 0.9;
          if (preference.confidence < 0.5) {
            preference.value = value;
            preference.confidence = 0.5;
          }
        }
        preference.lastUpdated = Date.now();
        preference.inferredFrom.push(activity.id);
        if (preference.inferredFrom.length > 10) {
          preference.inferredFrom.shift();
        }
      } else {
        preference = {
          key: prefKey,
          value,
          confidence: 0.5,
          inferredFrom: [activity.id],
          lastUpdated: Date.now(),
        };
        this.preferences.set(prefKey, preference);
        this.emit('preference-inferred', preference);
      }
    }
  }

  /**
   * Get inferred preference
   */
  getPreference(key: string): UserPreference | undefined {
    return this.preferences.get(key);
  }

  /**
   * Get all preferences
   */
  getAllPreferences(): UserPreference[] {
    return Array.from(this.preferences.values());
  }

  // ============================================================================
  // Proactive Suggestions
  // ============================================================================

  /**
   * Generate proactive suggestions
   */
  generateSuggestions(): BehaviorPrediction[] {
    const predictions = this.predict();
    const suggestions: BehaviorPrediction[] = [];

    for (const prediction of predictions) {
      if (prediction.probability >= 0.6 && prediction.confidence >= 0.5) {
        suggestions.push({
          ...prediction,
          reasoning: `Suggestion: ${prediction.reasoning}`,
        });
      }
    }

    for (const suggestion of suggestions) {
      this.emit('suggestion-ready', suggestion);
    }

    return suggestions;
  }

  // ============================================================================
  // Feedback
  // ============================================================================

  /**
   * Record prediction feedback
   */
  recordFeedback(prediction: BehaviorPrediction, correct: boolean): void {
    if (correct) {
      this.stats.correctPredictions++;
    }

    logger.debug('Prediction feedback recorded', {
      prediction: `${prediction.type}:${prediction.action}`,
      correct,
      accuracy:
        this.stats.predictionsMade > 0
          ? this.stats.correctPredictions / this.stats.predictionsMade
          : 0,
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get all patterns
   */
  getPatterns(): BehaviorPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get patterns by frequency
   */
  getTopPatterns(limit = 10): BehaviorPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  /**
   * Get recent activity history
   */
  getRecentActivity(limit = 50): UserActivity[] {
    return this.activityHistory.slice(-limit);
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this.activityHistory = [];
    this.patterns.clear();
    this.preferences.clear();
    this.transitionMatrix.clear();
    this.contextInfluence.clear();
    this.saveData();
    logger.info('All behavior data cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    activitiesRecorded: number;
    patternsDiscovered: number;
    predictionsMade: number;
    correctPredictions: number;
    predictionAccuracy: number;
    historySize: number;
    preferenceCount: number;
  } {
    return {
      ...this.stats,
      predictionAccuracy:
        this.stats.predictionsMade > 0 ? this.stats.correctPredictions / this.stats.predictionsMade : 0,
      historySize: this.activityHistory.length,
      preferenceCount: this.preferences.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BehaviorPredictorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let behaviorPredictor: BehaviorPredictor | null = null;

export function getBehaviorPredictor(): BehaviorPredictor {
  if (!behaviorPredictor) {
    behaviorPredictor = new BehaviorPredictor();
  }
  return behaviorPredictor;
}
