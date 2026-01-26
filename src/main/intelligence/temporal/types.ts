/**
 * Temporal Engine Types
 * Time-based queries, decay, timeline operations
 */

import { BaseEntity, EntityType, RelationshipType } from '../types';

// ============================================================================
// TIME RANGE TYPES
// ============================================================================

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface RelativeTimeRange {
  amount: number;
  unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
}

export type TimeRangeInput = TimeRange | RelativeTimeRange | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year';

// ============================================================================
// TEMPORAL QUERY OPTIONS
// ============================================================================

export interface TemporalQueryOptions {
  timeRange?: TimeRangeInput;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  entityTypes?: EntityType[];
  includeDecay?: boolean;
  minRelevance?: number;
}

export interface TimelineOptions {
  timeRange?: TimeRangeInput;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  entityTypes?: EntityType[];
  relationshipTypes?: RelationshipType[];
  limit?: number;
}

// ============================================================================
// DECAY CONFIGURATION
// ============================================================================

export interface DecayConfig {
  /** Half-life in days - after this time, relevance drops to 50% */
  halfLife: number;
  /** Minimum relevance score (0-1) - won't decay below this */
  minRelevance: number;
  /** Base relevance for new entities */
  baseRelevance: number;
  /** Interaction boost - how much to boost relevance on interaction */
  interactionBoost: number;
  /** Entity type specific decay rates */
  typeOverrides?: Partial<Record<EntityType, { halfLife: number; minRelevance: number }>>;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  halfLife: 30, // 30 days
  minRelevance: 0.1,
  baseRelevance: 1.0,
  interactionBoost: 0.5,
  typeOverrides: {
    task: { halfLife: 7, minRelevance: 0.05 }, // Tasks decay faster
    event: { halfLife: 14, minRelevance: 0.05 }, // Events decay faster
    trade: { halfLife: 60, minRelevance: 0.2 }, // Trades stay relevant longer
    skill: { halfLife: 365, minRelevance: 0.3 }, // Skills decay very slowly
  },
};

// ============================================================================
// TIMELINE TYPES
// ============================================================================

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  entityId: string;
  entityType: EntityType;
  entityName: string;
  eventType: 'created' | 'updated' | 'interaction' | 'relationship_added' | 'relationship_removed';
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineBucket {
  start: Date;
  end: Date;
  label: string;
  events: TimelineEvent[];
  entityCount: number;
  interactionCount: number;
}

export interface Timeline {
  buckets: TimelineBucket[];
  totalEvents: number;
  timeRange: TimeRange;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

// ============================================================================
// TEMPORAL PATTERNS
// ============================================================================

export interface TemporalPattern {
  id: string;
  type: 'daily' | 'weekly' | 'monthly' | 'seasonal';
  description: string;
  entityType?: EntityType;
  peakTimes: Array<{ hour?: number; dayOfWeek?: number; dayOfMonth?: number }>;
  confidence: number;
  sampleSize: number;
}

export interface ActivityPattern {
  entityId: string;
  entityType: EntityType;
  totalInteractions: number;
  averagePerDay: number;
  peakHour: number;
  peakDayOfWeek: number;
  firstActivity: Date;
  lastActivity: Date;
  activityTrend: 'increasing' | 'stable' | 'decreasing';
}

// ============================================================================
// TEMPORAL ANALYSIS
// ============================================================================

export interface TemporalAnalysis {
  entityId: string;
  currentRelevance: number;
  decayRate: number;
  daysSinceInteraction: number;
  interactionFrequency: number;
  predictedRelevanceIn30Days: number;
  activityPattern?: ActivityPattern;
}

// ============================================================================
// ENGINE CONFIG
// ============================================================================

export interface TemporalEngineConfig {
  decay: DecayConfig;
  maxTimelineEvents: number;
  patternDetectionMinSamples: number;
  relevanceUpdateIntervalMs: number;
}

export const DEFAULT_TEMPORAL_CONFIG: TemporalEngineConfig = {
  decay: DEFAULT_DECAY_CONFIG,
  maxTimelineEvents: 1000,
  patternDetectionMinSamples: 10,
  relevanceUpdateIntervalMs: 3600000, // 1 hour
};
