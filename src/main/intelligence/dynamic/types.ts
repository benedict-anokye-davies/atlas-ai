/**
 * Dynamic Layer Types
 * Types for pattern learning, predictions, and behavioral models
 */

import { EntityType } from '../types';

// ============================================================================
// PATTERN TYPES
// ============================================================================

export type PatternType =
  | 'temporal'      // Time-based patterns (daily, weekly, etc.)
  | 'behavioral'    // User behavior patterns
  | 'sequential'    // Sequence patterns (A -> B -> C)
  | 'associative'   // Co-occurrence patterns
  | 'anomaly';      // Deviation from normal patterns

export interface Pattern {
  id: string;
  type: PatternType;
  name: string;
  description: string;
  confidence: number;        // 0-1
  occurrences: number;       // Number of times observed
  lastSeen: Date;
  firstSeen: Date;
  entityTypes: EntityType[];
  relatedEntityIds: string[];
  metadata: Record<string, unknown>;
}

// Temporal patterns (daily routines, weekly cycles)
export interface TemporalPattern extends Pattern {
  type: 'temporal';
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  typicalTime?: { hour: number; minute: number };
  typicalDay?: number; // 0-6 for weekly, 1-31 for monthly
  variance: number;    // How much the timing varies
}

// Behavioral patterns (user habits, preferences)
export interface BehavioralPattern extends Pattern {
  type: 'behavioral';
  behavior: string;
  context: string[];         // Context triggers
  preferredTime?: string;    // Preferred time of day
  averageDuration?: number;  // Average duration in minutes
}

// Sequential patterns (workflow, process)
export interface SequentialPattern extends Pattern {
  type: 'sequential';
  sequence: Array<{
    action: string;
    entityType?: EntityType;
    avgTimeBetween?: number; // Milliseconds to next action
  }>;
  avgCompletionTime: number; // Total sequence time in ms
}

// Associative patterns (co-occurrence)
export interface AssociativePattern extends Pattern {
  type: 'associative';
  items: Array<{
    entityId: string;
    entityType: EntityType;
    support: number; // How often this item appears
  }>;
  support: number;     // How often they appear together
  lift: number;        // Association strength
}

// Anomaly patterns (deviations)
export interface AnomalyPattern extends Pattern {
  type: 'anomaly';
  anomalyType: 'timing' | 'frequency' | 'value' | 'absence';
  expectedValue: unknown;
  observedValue: unknown;
  deviation: number;   // Standard deviations from norm
  severity: 'low' | 'medium' | 'high';
}

// ============================================================================
// PREDICTION TYPES
// ============================================================================

export type PredictionType =
  | 'next_action'     // What user will do next
  | 'entity_state'    // Future entity state
  | 'event_occurrence' // When something will happen
  | 'recommendation'; // What to suggest

export interface Prediction {
  id: string;
  type: PredictionType;
  description: string;
  confidence: number;
  predictedAt: Date;
  predictedFor?: Date;     // When the prediction is for
  expiresAt: Date;         // When prediction becomes irrelevant
  basedOnPatterns: string[]; // Pattern IDs used
  relatedEntityIds: string[];
  metadata: Record<string, unknown>;
  outcome?: {
    actual: unknown;
    correct: boolean;
    recordedAt: Date;
  };
}

export interface NextActionPrediction extends Prediction {
  type: 'next_action';
  predictedAction: string;
  suggestedEntities: Array<{
    entityId: string;
    entityType: EntityType;
    relevance: number;
  }>;
  context: string[];
}

export interface EntityStatePrediction extends Prediction {
  type: 'entity_state';
  entityId: string;
  entityType: EntityType;
  currentState: Record<string, unknown>;
  predictedState: Record<string, unknown>;
  changeFields: string[];
}

export interface EventOccurrencePrediction extends Prediction {
  type: 'event_occurrence';
  eventType: string;
  predictedTime: Date;
  timeWindow: number;  // Minutes of uncertainty
  relatedEntities: string[];
}

// ============================================================================
// BEHAVIORAL MODEL TYPES
// ============================================================================

export interface BehavioralModel {
  id: string;
  name: string;
  description: string;
  modelType: 'preference' | 'habit' | 'productivity' | 'social';
  lastUpdated: Date;
  trainingDataPoints: number;
  features: BehavioralFeature[];
  predictions: BehavioralPrediction[];
}

export interface BehavioralFeature {
  name: string;
  type: 'numeric' | 'categorical' | 'boolean' | 'temporal';
  importance: number;    // 0-1
  currentValue: unknown;
  historicalValues: Array<{
    value: unknown;
    timestamp: Date;
  }>;
}

export interface BehavioralPrediction {
  feature: string;
  predictedValue: unknown;
  confidence: number;
  validUntil: Date;
}

// ============================================================================
// LEARNING TYPES
// ============================================================================

export interface LearningEvent {
  id: string;
  timestamp: Date;
  eventType: 'entity_created' | 'entity_updated' | 'relationship_created' | 'action_taken' | 'feedback';
  entityId?: string;
  entityType?: EntityType;
  action?: string;
  context: Record<string, unknown>;
  outcome?: 'positive' | 'negative' | 'neutral';
}

export interface FeedbackEvent {
  id: string;
  timestamp: Date;
  predictionId: string;
  feedbackType: 'correct' | 'incorrect' | 'helpful' | 'not_helpful';
  details?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface DynamicLayerConfig {
  // Pattern detection
  minPatternOccurrences: number;       // Minimum times to consider a pattern
  patternConfidenceThreshold: number;  // Minimum confidence to emit pattern
  patternExpirationDays: number;       // Days before pattern expires without observation

  // Prediction
  predictionConfidenceThreshold: number;
  predictionHorizonMinutes: number;    // How far ahead to predict
  maxActivePredictions: number;

  // Learning
  learningRate: number;                // How fast to update models (0-1)
  batchSize: number;                   // Events to batch before learning
  retentionDays: number;               // How long to keep learning events

  // Anomaly detection
  anomalyThreshold: number;            // Standard deviations for anomaly
  anomalySensitivity: 'low' | 'medium' | 'high';
}

export const DEFAULT_DYNAMIC_CONFIG: DynamicLayerConfig = {
  minPatternOccurrences: 3,
  patternConfidenceThreshold: 0.6,
  patternExpirationDays: 90,

  predictionConfidenceThreshold: 0.5,
  predictionHorizonMinutes: 60,
  maxActivePredictions: 50,

  learningRate: 0.1,
  batchSize: 10,
  retentionDays: 365,

  anomalyThreshold: 2.5,
  anomalySensitivity: 'medium',
};

// ============================================================================
// STATISTICS TYPES
// ============================================================================

export interface DynamicLayerStats {
  totalPatterns: number;
  patternsByType: Record<PatternType, number>;
  totalPredictions: number;
  predictionAccuracy: number;        // Rolling accuracy
  totalLearningEvents: number;
  lastLearningEventAt?: Date;
  modelsUpdatedAt?: Date;
}
