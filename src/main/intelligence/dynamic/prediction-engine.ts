/**
 * Prediction Engine
 * Generates predictions based on patterns and current context
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { Entity, EntityType, AgentContext } from '../types';
import { getOntologyStore } from '../ontology';
import { getTemporalEngine } from '../temporal';
import { getPatternDetector, PatternDetector } from './pattern-detector';
import {
  Prediction,
  PredictionType,
  NextActionPrediction,
  EntityStatePrediction,
  EventOccurrencePrediction,
  Pattern,
  TemporalPattern,
  SequentialPattern,
  BehavioralPattern,
  DynamicLayerConfig,
  DEFAULT_DYNAMIC_CONFIG,
  FeedbackEvent,
} from './types';

const logger = createModuleLogger('PredictionEngine');

// ============================================================================
// PREDICTION ENGINE
// ============================================================================

export class PredictionEngine extends EventEmitter {
  private config: DynamicLayerConfig;
  private predictions: Map<string, Prediction> = new Map();
  private feedbackHistory: FeedbackEvent[] = [];
  private patternDetector: PatternDetector;

  constructor(config: Partial<DynamicLayerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DYNAMIC_CONFIG, ...config };
    this.patternDetector = getPatternDetector();
  }

  // --------------------------------------------------------------------------
  // PREDICTION GENERATION
  // --------------------------------------------------------------------------

  async generatePredictions(context?: Partial<AgentContext>): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    // Clean expired predictions
    this.cleanExpiredPredictions();

    // Generate different types of predictions
    predictions.push(...await this.predictNextActions(context));
    predictions.push(...await this.predictEntityStates());
    predictions.push(...await this.predictEventOccurrences());

    // Filter by confidence
    const validPredictions = predictions.filter(
      p => p.confidence >= this.config.predictionConfidenceThreshold
    );

    // Limit active predictions
    const sortedPredictions = validPredictions.sort((a, b) => b.confidence - a.confidence);
    const topPredictions = sortedPredictions.slice(0, this.config.maxActivePredictions);

    // Store predictions
    for (const prediction of topPredictions) {
      this.predictions.set(prediction.id, prediction);
      this.emit('prediction-generated', prediction);
    }

    return topPredictions;
  }

  // --------------------------------------------------------------------------
  // NEXT ACTION PREDICTIONS
  // --------------------------------------------------------------------------

  private async predictNextActions(context?: Partial<AgentContext>): Promise<NextActionPrediction[]> {
    const predictions: NextActionPrediction[] = [];
    const patterns = this.patternDetector.getPatterns();

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // Use temporal patterns
    const temporalPatterns = patterns.filter(p => p.type === 'temporal') as TemporalPattern[];
    for (const pattern of temporalPatterns) {
      if (pattern.frequency === 'daily' && pattern.typicalTime) {
        const hourDiff = Math.abs(pattern.typicalTime.hour - currentHour);
        if (hourDiff <= 1) {
          predictions.push({
            id: this.generateId(),
            type: 'next_action',
            description: pattern.name,
            confidence: pattern.confidence * (1 - hourDiff * 0.2),
            predictedAt: now,
            predictedFor: new Date(now.getTime() + 30 * 60 * 1000), // 30 min ahead
            expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours
            basedOnPatterns: [pattern.id],
            relatedEntityIds: pattern.relatedEntityIds,
            metadata: { patternType: 'temporal' },
            predictedAction: `Activity around ${pattern.typicalTime.hour}:00`,
            suggestedEntities: [],
            context: ['time-based'],
          });
        }
      }

      if (pattern.frequency === 'weekly' && pattern.typicalDay === currentDay) {
        predictions.push({
          id: this.generateId(),
          type: 'next_action',
          description: pattern.name,
          confidence: pattern.confidence * 0.9,
          predictedAt: now,
          predictedFor: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
          basedOnPatterns: [pattern.id],
          relatedEntityIds: pattern.relatedEntityIds,
          metadata: { patternType: 'temporal-weekly' },
          predictedAction: pattern.description,
          suggestedEntities: [],
          context: ['day-of-week'],
        });
      }
    }

    // Use sequential patterns
    const sequentialPatterns = patterns.filter(p => p.type === 'sequential') as SequentialPattern[];
    const recentActions = context?.recentActions ?? [];

    for (const pattern of sequentialPatterns) {
      // Check if recent actions match start of sequence
      const seqLength = pattern.sequence.length;
      if (seqLength > 1 && recentActions.length > 0) {
        const matchLength = this.findSequenceMatch(recentActions, pattern.sequence.map(s => s.action));

        if (matchLength > 0 && matchLength < seqLength) {
          const nextAction = pattern.sequence[matchLength];
          if (nextAction) {
            predictions.push({
              id: this.generateId(),
              type: 'next_action',
              description: `Next in sequence: ${nextAction.action}`,
              confidence: pattern.confidence * (matchLength / seqLength),
              predictedAt: now,
              predictedFor: new Date(now.getTime() + (nextAction.avgTimeBetween ?? 60000)),
              expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
              basedOnPatterns: [pattern.id],
              relatedEntityIds: pattern.relatedEntityIds,
              metadata: { patternType: 'sequential', matchLength, seqLength },
              predictedAction: nextAction.action,
              suggestedEntities: [],
              context: ['workflow'],
            });
          }
        }
      }
    }

    // Use behavioral patterns
    const behavioralPatterns = patterns.filter(p => p.type === 'behavioral') as BehavioralPattern[];
    for (const pattern of behavioralPatterns) {
      const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

      if (pattern.preferredTime === timeOfDay) {
        predictions.push({
          id: this.generateId(),
          type: 'next_action',
          description: `Likely action: ${pattern.behavior}`,
          confidence: pattern.confidence * 0.8,
          predictedAt: now,
          predictedFor: now,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          basedOnPatterns: [pattern.id],
          relatedEntityIds: pattern.relatedEntityIds,
          metadata: { patternType: 'behavioral', timeOfDay },
          predictedAction: pattern.behavior,
          suggestedEntities: [],
          context: [timeOfDay, ...pattern.context],
        });
      }
    }

    return predictions;
  }

  // --------------------------------------------------------------------------
  // ENTITY STATE PREDICTIONS
  // --------------------------------------------------------------------------

  private async predictEntityStates(): Promise<EntityStatePrediction[]> {
    const predictions: EntityStatePrediction[] = [];
    const store = getOntologyStore();
    const temporal = getTemporalEngine();

    // Predict task completions
    const tasks = store.getEntitiesByType('task', 100);
    const now = new Date();

    for (const task of tasks) {
      if (task.properties?.status === 'in_progress' && task.properties?.dueDate) {
        const dueDate = new Date(task.properties.dueDate as string);
        const daysUntilDue = (dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);

        // Predict completion based on progress and time remaining
        const progress = (task.properties?.progress as number) ?? 0;
        const estimatedCompletion = progress > 80 && daysUntilDue > 1;

        if (estimatedCompletion) {
          predictions.push({
            id: this.generateId(),
            type: 'entity_state',
            description: `Task "${task.name}" likely to complete soon`,
            confidence: Math.min(0.9, progress / 100),
            predictedAt: now,
            predictedFor: dueDate,
            expiresAt: dueDate,
            basedOnPatterns: [],
            relatedEntityIds: [task.id],
            metadata: { taskName: task.name, progress },
            entityId: task.id,
            entityType: 'task',
            currentState: { status: 'in_progress', progress },
            predictedState: { status: 'completed', progress: 100 },
            changeFields: ['status', 'progress'],
          });
        }

        // Predict overdue
        if (daysUntilDue < 0 && task.properties?.status !== 'completed') {
          predictions.push({
            id: this.generateId(),
            type: 'entity_state',
            description: `Task "${task.name}" is/will be overdue`,
            confidence: 0.95,
            predictedAt: now,
            predictedFor: now,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            basedOnPatterns: [],
            relatedEntityIds: [task.id],
            metadata: { taskName: task.name, daysOverdue: Math.abs(daysUntilDue) },
            entityId: task.id,
            entityType: 'task',
            currentState: { status: task.properties?.status, dueDate: task.properties?.dueDate },
            predictedState: { status: 'overdue' },
            changeFields: ['status'],
          });
        }
      }
    }

    // Predict relationship decay
    const people = store.getEntitiesByType('person', 100);
    for (const person of people) {
      const relevance = temporal.calculateRelevance(person);
      if (relevance < 0.3) {
        const relationships = store.getRelationships(person.id);
        const lastInteraction = relationships.reduce((latest, r) => {
          const rDate = new Date(r.createdAt);
          return rDate > latest ? rDate : latest;
        }, new Date(0));

        if (lastInteraction.getTime() > 0) {
          predictions.push({
            id: this.generateId(),
            type: 'entity_state',
            description: `Relationship with ${person.name} may weaken`,
            confidence: 1 - relevance,
            predictedAt: now,
            predictedFor: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            expiresAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
            basedOnPatterns: [],
            relatedEntityIds: [person.id],
            metadata: { personName: person.name, lastInteraction, relevance },
            entityId: person.id,
            entityType: 'person',
            currentState: { relationshipStrength: relevance },
            predictedState: { relationshipStrength: relevance * 0.5 },
            changeFields: ['relationshipStrength'],
          });
        }
      }
    }

    return predictions;
  }

  // --------------------------------------------------------------------------
  // EVENT OCCURRENCE PREDICTIONS
  // --------------------------------------------------------------------------

  private async predictEventOccurrences(): Promise<EventOccurrencePrediction[]> {
    const predictions: EventOccurrencePrediction[] = [];
    const patterns = this.patternDetector.getPatterns({ type: 'temporal' }) as TemporalPattern[];
    const now = new Date();

    for (const pattern of patterns) {
      if (pattern.frequency === 'daily' && pattern.typicalTime) {
        // Predict next occurrence
        let nextOccurrence = new Date(now);
        nextOccurrence.setHours(pattern.typicalTime.hour, pattern.typicalTime.minute, 0, 0);

        // If already past today, schedule for tomorrow
        if (nextOccurrence <= now) {
          nextOccurrence = new Date(nextOccurrence.getTime() + 24 * 60 * 60 * 1000);
        }

        predictions.push({
          id: this.generateId(),
          type: 'event_occurrence',
          description: `Expected: ${pattern.name}`,
          confidence: pattern.confidence,
          predictedAt: now,
          predictedFor: nextOccurrence,
          expiresAt: new Date(nextOccurrence.getTime() + 2 * 60 * 60 * 1000),
          basedOnPatterns: [pattern.id],
          relatedEntityIds: pattern.relatedEntityIds,
          metadata: { frequency: 'daily' },
          eventType: pattern.name,
          predictedTime: nextOccurrence,
          timeWindow: pattern.variance * 60, // Convert variance hours to minutes
          relatedEntities: pattern.relatedEntityIds,
        });
      }

      if (pattern.frequency === 'weekly' && pattern.typicalDay !== undefined) {
        // Find next occurrence of this day
        const daysUntil = (pattern.typicalDay - now.getDay() + 7) % 7;
        const nextOccurrence = new Date(now);
        nextOccurrence.setDate(nextOccurrence.getDate() + (daysUntil === 0 ? 7 : daysUntil));
        nextOccurrence.setHours(pattern.typicalTime?.hour ?? 9, 0, 0, 0);

        predictions.push({
          id: this.generateId(),
          type: 'event_occurrence',
          description: `Expected: ${pattern.name}`,
          confidence: pattern.confidence * 0.9,
          predictedAt: now,
          predictedFor: nextOccurrence,
          expiresAt: new Date(nextOccurrence.getTime() + 24 * 60 * 60 * 1000),
          basedOnPatterns: [pattern.id],
          relatedEntityIds: pattern.relatedEntityIds,
          metadata: { frequency: 'weekly' },
          eventType: pattern.name,
          predictedTime: nextOccurrence,
          timeWindow: 4 * 60, // 4 hour window for weekly events
          relatedEntities: pattern.relatedEntityIds,
        });
      }
    }

    return predictions;
  }

  // --------------------------------------------------------------------------
  // FEEDBACK AND LEARNING
  // --------------------------------------------------------------------------

  recordFeedback(feedback: Omit<FeedbackEvent, 'id'>): void {
    const fullFeedback: FeedbackEvent = {
      ...feedback,
      id: this.generateId(),
    };

    this.feedbackHistory.push(fullFeedback);

    // Update prediction outcome
    const prediction = this.predictions.get(feedback.predictionId);
    if (prediction) {
      prediction.outcome = {
        actual: feedback.feedbackType,
        correct: feedback.feedbackType === 'correct',
        recordedAt: feedback.timestamp,
      };

      // Adjust pattern confidence based on feedback
      for (const patternId of prediction.basedOnPatterns) {
        const pattern = this.patternDetector.getPattern(patternId);
        if (pattern) {
          const adjustment = feedback.feedbackType === 'correct' ? 0.05 : -0.05;
          pattern.confidence = Math.max(0.1, Math.min(1, pattern.confidence + adjustment));
        }
      }

      this.emit('feedback-recorded', { prediction, feedback: fullFeedback });
    }
  }

  // --------------------------------------------------------------------------
  // PREDICTION RETRIEVAL
  // --------------------------------------------------------------------------

  getPredictions(filter?: {
    type?: PredictionType;
    minConfidence?: number;
    entityId?: string;
  }): Prediction[] {
    this.cleanExpiredPredictions();

    let predictions = [...this.predictions.values()];

    if (filter?.type) {
      predictions = predictions.filter(p => p.type === filter.type);
    }

    if (filter?.minConfidence) {
      predictions = predictions.filter(p => p.confidence >= filter.minConfidence!);
    }

    if (filter?.entityId) {
      predictions = predictions.filter(p => p.relatedEntityIds.includes(filter.entityId!));
    }

    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  getPrediction(id: string): Prediction | undefined {
    return this.predictions.get(id);
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private generateId(): string {
    return `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanExpiredPredictions(): void {
    const now = new Date();
    for (const [id, prediction] of this.predictions) {
      if (prediction.expiresAt < now) {
        this.predictions.delete(id);
      }
    }
  }

  private findSequenceMatch(recent: string[], sequence: string[]): number {
    // Find how many items from start of sequence match end of recent
    for (let matchLen = Math.min(recent.length, sequence.length - 1); matchLen > 0; matchLen--) {
      const recentEnd = recent.slice(-matchLen);
      const seqStart = sequence.slice(0, matchLen);

      let matches = true;
      for (let i = 0; i < matchLen; i++) {
        if (recentEnd[i] !== seqStart[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return matchLen;
      }
    }

    return 0;
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  getStats(): {
    totalPredictions: number;
    predictionsByType: Record<PredictionType, number>;
    accuracy: number;
    feedbackCount: number;
  } {
    const predictionsByType: Record<PredictionType, number> = {
      next_action: 0,
      entity_state: 0,
      event_occurrence: 0,
      recommendation: 0,
    };

    for (const prediction of this.predictions.values()) {
      predictionsByType[prediction.type]++;
    }

    // Calculate accuracy from feedback
    const predictionsWithOutcome = [...this.predictions.values()].filter(p => p.outcome);
    const correctPredictions = predictionsWithOutcome.filter(p => p.outcome?.correct);
    const accuracy = predictionsWithOutcome.length > 0
      ? correctPredictions.length / predictionsWithOutcome.length
      : 0;

    return {
      totalPredictions: this.predictions.size,
      predictionsByType,
      accuracy,
      feedbackCount: this.feedbackHistory.length,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: PredictionEngine | null = null;

export function getPredictionEngine(): PredictionEngine {
  if (!instance) {
    instance = new PredictionEngine();
  }
  return instance;
}
