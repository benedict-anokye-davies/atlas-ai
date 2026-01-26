/**
 * Temporal Engine
 * Time-based queries, relevance decay, timeline generation
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getOntologyStore } from '../ontology/ontology-store';
import { BaseEntity, EntityType, RelationshipType } from '../types';
import {
  TimeRange,
  RelativeTimeRange,
  TimeRangeInput,
  TemporalQueryOptions,
  TimelineOptions,
  DecayConfig,
  DEFAULT_DECAY_CONFIG,
  Timeline,
  TimelineBucket,
  TimelineEvent,
  TemporalPattern,
  ActivityPattern,
  TemporalAnalysis,
  TemporalEngineConfig,
  DEFAULT_TEMPORAL_CONFIG,
} from './types';

const logger = createModuleLogger('TemporalEngine');

// ============================================================================
// TEMPORAL ENGINE
// ============================================================================

export class TemporalEngine extends EventEmitter {
  private config: TemporalEngineConfig;
  private relevanceCache: Map<string, { relevance: number; calculatedAt: number }> = new Map();
  private interactionTracker: Map<string, Date[]> = new Map();

  constructor(config?: Partial<TemporalEngineConfig>) {
    super();
    this.config = { ...DEFAULT_TEMPORAL_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // TIME RANGE RESOLUTION
  // --------------------------------------------------------------------------

  /**
   * Resolve various time range inputs to absolute TimeRange
   */
  resolveTimeRange(input: TimeRangeInput): TimeRange {
    const now = new Date();

    if (typeof input === 'string') {
      switch (input) {
        case 'today':
          return {
            start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            end: now,
          };
        case 'yesterday':
          const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
          return {
            start: yesterday,
            end: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          };
        case 'this_week':
          const dayOfWeek = now.getDay();
          const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          return { start: weekStart, end: now };
        case 'last_week':
          const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
          const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
          return { start: lastWeekStart, end: thisWeekStart };
        case 'this_month':
          return {
            start: new Date(now.getFullYear(), now.getMonth(), 1),
            end: now,
          };
        case 'last_month':
          const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          return { start: lastMonthStart, end: thisMonthStart };
        case 'this_year':
          return {
            start: new Date(now.getFullYear(), 0, 1),
            end: now,
          };
      }
    }

    if ('start' in input && 'end' in input) {
      return input as TimeRange;
    }

    // Relative time range
    const relative = input as RelativeTimeRange;
    const ms = this.unitToMs(relative.unit) * relative.amount;
    return {
      start: new Date(now.getTime() - ms),
      end: now,
    };
  }

  private unitToMs(unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'): number {
    switch (unit) {
      case 'minutes': return 60 * 1000;
      case 'hours': return 60 * 60 * 1000;
      case 'days': return 24 * 60 * 60 * 1000;
      case 'weeks': return 7 * 24 * 60 * 60 * 1000;
      case 'months': return 30 * 24 * 60 * 60 * 1000;
      case 'years': return 365 * 24 * 60 * 60 * 1000;
    }
  }

  // --------------------------------------------------------------------------
  // TEMPORAL QUERIES
  // --------------------------------------------------------------------------

  /**
   * Get entities within a time range
   */
  async getEntitiesInTimeRange(options: TemporalQueryOptions): Promise<BaseEntity[]> {
    const store = getOntologyStore();
    const timeRange = options.timeRange ? this.resolveTimeRange(options.timeRange) : undefined;

    // Get all entities (filtered by type if specified)
    let entities: BaseEntity[];
    if (options.entityTypes && options.entityTypes.length > 0) {
      entities = [];
      for (const type of options.entityTypes) {
        entities.push(...store.getEntitiesByType(type, options.limit ?? 1000));
      }
    } else {
      entities = store.getAllEntities(options.limit ?? 1000);
    }

    // Filter by time range
    if (timeRange) {
      entities = entities.filter(e => {
        const updated = new Date(e.updatedAt);
        return updated >= timeRange.start && updated <= timeRange.end;
      });
    }

    // Apply decay-based filtering
    if (options.includeDecay && options.minRelevance !== undefined) {
      const relevantEntities: BaseEntity[] = [];
      for (const entity of entities) {
        const relevance = this.calculateRelevance(entity);
        if (relevance >= options.minRelevance) {
          relevantEntities.push(entity);
        }
      }
      entities = relevantEntities;
    }

    // Sort by update time
    entities.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime();
      const timeB = new Date(b.updatedAt).getTime();
      return options.sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });

    // Apply offset and limit
    const offset = options.offset ?? 0;
    const limit = options.limit ?? entities.length;
    return entities.slice(offset, offset + limit);
  }

  /**
   * Get recently modified entities
   */
  async getRecentlyModified(
    days: number = 7,
    entityTypes?: EntityType[],
    limit: number = 100
  ): Promise<BaseEntity[]> {
    return this.getEntitiesInTimeRange({
      timeRange: { amount: days, unit: 'days' },
      entityTypes,
      limit,
      sortOrder: 'desc',
    });
  }

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(days: number = 7, limit: number = 50): Promise<BaseEntity[]> {
    const store = getOntologyStore();
    const events = store.getEntitiesByType('event', 1000);
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Filter to upcoming events
    const upcoming = events.filter(e => {
      const startTime = e.properties?.startTime;
      if (!startTime) return false;
      const eventDate = new Date(startTime as string);
      return eventDate >= now && eventDate <= future;
    });

    // Sort by start time
    upcoming.sort((a, b) => {
      const timeA = new Date(a.properties?.startTime as string).getTime();
      const timeB = new Date(b.properties?.startTime as string).getTime();
      return timeA - timeB;
    });

    return upcoming.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // RELEVANCE DECAY
  // --------------------------------------------------------------------------

  /**
   * Calculate current relevance of an entity based on decay
   */
  calculateRelevance(entity: BaseEntity): number {
    // Check cache
    const cached = this.relevanceCache.get(entity.id);
    if (cached && Date.now() - cached.calculatedAt < this.config.relevanceUpdateIntervalMs) {
      return cached.relevance;
    }

    const decayConfig = this.getDecayConfig(entity.type);
    const now = Date.now();
    const lastUpdate = new Date(entity.updatedAt).getTime();
    const daysSinceUpdate = (now - lastUpdate) / (24 * 60 * 60 * 1000);

    // Exponential decay formula: R(t) = R0 * e^(-λt)
    // Where λ = ln(2) / halfLife
    const decayConstant = Math.LN2 / decayConfig.halfLife;
    let relevance = decayConfig.baseRelevance * Math.exp(-decayConstant * daysSinceUpdate);

    // Apply interaction boost
    const interactions = this.interactionTracker.get(entity.id) ?? [];
    const recentInteractions = interactions.filter(
      d => now - d.getTime() < 7 * 24 * 60 * 60 * 1000 // Last 7 days
    ).length;
    relevance += recentInteractions * decayConfig.interactionBoost;

    // Clamp to min and max
    relevance = Math.max(decayConfig.minRelevance, Math.min(1.0, relevance));

    // Cache result
    this.relevanceCache.set(entity.id, { relevance, calculatedAt: now });

    return relevance;
  }

  private getDecayConfig(entityType: EntityType): DecayConfig {
    const override = this.config.decay.typeOverrides?.[entityType];
    if (override) {
      return {
        ...this.config.decay,
        ...override,
      };
    }
    return this.config.decay;
  }

  /**
   * Record an interaction with an entity (boosts relevance)
   */
  recordInteraction(entityId: string): void {
    const interactions = this.interactionTracker.get(entityId) ?? [];
    interactions.push(new Date());

    // Keep only last 100 interactions
    if (interactions.length > 100) {
      interactions.shift();
    }

    this.interactionTracker.set(entityId, interactions);

    // Invalidate cache
    this.relevanceCache.delete(entityId);

    this.emit('interaction-recorded', entityId);
  }

  /**
   * Get entities sorted by current relevance
   */
  async getMostRelevant(
    entityTypes?: EntityType[],
    limit: number = 50
  ): Promise<Array<BaseEntity & { relevance: number }>> {
    const store = getOntologyStore();

    let entities: BaseEntity[];
    if (entityTypes && entityTypes.length > 0) {
      entities = [];
      for (const type of entityTypes) {
        entities.push(...store.getEntitiesByType(type, 1000));
      }
    } else {
      entities = store.getAllEntities(1000);
    }

    // Calculate relevance for each
    const withRelevance = entities.map(e => ({
      ...e,
      relevance: this.calculateRelevance(e),
    }));

    // Sort by relevance
    withRelevance.sort((a, b) => b.relevance - a.relevance);

    return withRelevance.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // TIMELINE GENERATION
  // --------------------------------------------------------------------------

  /**
   * Generate a timeline of events and activities
   */
  async generateTimeline(options: TimelineOptions): Promise<Timeline> {
    const timeRange = options.timeRange
      ? this.resolveTimeRange(options.timeRange)
      : this.resolveTimeRange('this_month');
    const granularity = options.granularity ?? 'day';

    // Generate buckets
    const buckets = this.createBuckets(timeRange, granularity);

    // Collect events
    const store = getOntologyStore();
    const allEvents: TimelineEvent[] = [];

    // Get entities in time range
    const entities = await this.getEntitiesInTimeRange({
      timeRange,
      entityTypes: options.entityTypes,
      limit: this.config.maxTimelineEvents,
    });

    // Create events from entity updates
    for (const entity of entities) {
      const created = new Date(entity.createdAt);
      const updated = new Date(entity.updatedAt);

      // Creation event
      if (created >= timeRange.start && created <= timeRange.end) {
        allEvents.push({
          id: `${entity.id}_created`,
          timestamp: created,
          entityId: entity.id,
          entityType: entity.type,
          entityName: entity.name,
          eventType: 'created',
          description: `${entity.type} "${entity.name}" created`,
        });
      }

      // Update event (if different from creation)
      if (
        updated.getTime() !== created.getTime() &&
        updated >= timeRange.start &&
        updated <= timeRange.end
      ) {
        allEvents.push({
          id: `${entity.id}_updated`,
          timestamp: updated,
          entityId: entity.id,
          entityType: entity.type,
          entityName: entity.name,
          eventType: 'updated',
          description: `${entity.type} "${entity.name}" updated`,
        });
      }

      // Interaction events
      const interactions = this.interactionTracker.get(entity.id) ?? [];
      for (const interaction of interactions) {
        if (interaction >= timeRange.start && interaction <= timeRange.end) {
          allEvents.push({
            id: `${entity.id}_interaction_${interaction.getTime()}`,
            timestamp: interaction,
            entityId: entity.id,
            entityType: entity.type,
            entityName: entity.name,
            eventType: 'interaction',
            description: `Interacted with ${entity.type} "${entity.name}"`,
          });
        }
      }
    }

    // Sort events by timestamp
    allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Assign events to buckets
    for (const event of allEvents) {
      const bucket = this.findBucket(event.timestamp, buckets);
      if (bucket) {
        bucket.events.push(event);
        if (event.eventType === 'interaction') {
          bucket.interactionCount++;
        }
      }
    }

    // Calculate entity counts per bucket
    for (const bucket of buckets) {
      const uniqueEntities = new Set(bucket.events.map(e => e.entityId));
      bucket.entityCount = uniqueEntities.size;
    }

    return {
      buckets,
      totalEvents: allEvents.length,
      timeRange,
      granularity,
    };
  }

  private createBuckets(
    timeRange: TimeRange,
    granularity: 'hour' | 'day' | 'week' | 'month'
  ): TimelineBucket[] {
    const buckets: TimelineBucket[] = [];
    let current = new Date(timeRange.start);

    while (current < timeRange.end) {
      const bucketEnd = this.getNextBoundary(current, granularity);
      const end = bucketEnd < timeRange.end ? bucketEnd : timeRange.end;

      buckets.push({
        start: new Date(current),
        end,
        label: this.formatBucketLabel(current, granularity),
        events: [],
        entityCount: 0,
        interactionCount: 0,
      });

      current = bucketEnd;
    }

    return buckets;
  }

  private getNextBoundary(date: Date, granularity: 'hour' | 'day' | 'week' | 'month'): Date {
    switch (granularity) {
      case 'hour':
        return new Date(date.getTime() + 60 * 60 * 1000);
      case 'day':
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      case 'week':
        const daysToAdd = 7 - date.getDay();
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysToAdd);
      case 'month':
        return new Date(date.getFullYear(), date.getMonth() + 1, 1);
    }
  }

  private formatBucketLabel(date: Date, granularity: 'hour' | 'day' | 'week' | 'month'): string {
    switch (granularity) {
      case 'hour':
        return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit' });
      case 'day':
        return date.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
      case 'week':
        const weekEnd = new Date(date.getTime() + 6 * 24 * 60 * 60 * 1000);
        return `${date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`;
      case 'month':
        return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
  }

  private findBucket(timestamp: Date, buckets: TimelineBucket[]): TimelineBucket | undefined {
    return buckets.find(b => timestamp >= b.start && timestamp < b.end);
  }

  // --------------------------------------------------------------------------
  // PATTERN DETECTION
  // --------------------------------------------------------------------------

  /**
   * Detect temporal patterns in entity activity
   */
  async detectPatterns(entityType?: EntityType): Promise<TemporalPattern[]> {
    const patterns: TemporalPattern[] = [];
    const store = getOntologyStore();

    const entities = entityType
      ? store.getEntitiesByType(entityType, 1000)
      : store.getAllEntities(1000);

    // Collect all timestamps
    const hourCounts = new Array(24).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);
    let totalSamples = 0;

    for (const entity of entities) {
      // Entity updates
      const updated = new Date(entity.updatedAt);
      hourCounts[updated.getHours()]++;
      dayOfWeekCounts[updated.getDay()]++;
      totalSamples++;

      // Interactions
      const interactions = this.interactionTracker.get(entity.id) ?? [];
      for (const interaction of interactions) {
        hourCounts[interaction.getHours()]++;
        dayOfWeekCounts[interaction.getDay()]++;
        totalSamples++;
      }
    }

    if (totalSamples < this.config.patternDetectionMinSamples) {
      return patterns;
    }

    // Find peak hours
    const avgHourly = totalSamples / 24;
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count > avgHourly * 1.5)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    if (peakHours.length > 0) {
      patterns.push({
        id: 'daily_peak_hours',
        type: 'daily',
        description: `Peak activity hours: ${peakHours.map(h => `${h.hour}:00`).join(', ')}`,
        entityType,
        peakTimes: peakHours.map(h => ({ hour: h.hour })),
        confidence: Math.min(1, totalSamples / 100),
        sampleSize: totalSamples,
      });
    }

    // Find peak days
    const avgDaily = totalSamples / 7;
    const peakDays = dayOfWeekCounts
      .map((count, day) => ({ dayOfWeek: day, count }))
      .filter(d => d.count > avgDaily * 1.3)
      .sort((a, b) => b.count - a.count);

    if (peakDays.length > 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      patterns.push({
        id: 'weekly_peak_days',
        type: 'weekly',
        description: `Peak activity days: ${peakDays.map(d => dayNames[d.dayOfWeek]).join(', ')}`,
        entityType,
        peakTimes: peakDays.map(d => ({ dayOfWeek: d.dayOfWeek })),
        confidence: Math.min(1, totalSamples / 100),
        sampleSize: totalSamples,
      });
    }

    return patterns;
  }

  /**
   * Get activity pattern for a specific entity
   */
  async getActivityPattern(entityId: string): Promise<ActivityPattern | null> {
    const store = getOntologyStore();
    const entity = store.getEntity(entityId);
    if (!entity) return null;

    const interactions = this.interactionTracker.get(entityId) ?? [];
    const timestamps = [
      new Date(entity.createdAt),
      new Date(entity.updatedAt),
      ...interactions,
    ];

    if (timestamps.length < 2) return null;

    // Sort timestamps
    timestamps.sort((a, b) => a.getTime() - b.getTime());

    const firstActivity = timestamps[0];
    const lastActivity = timestamps[timestamps.length - 1];
    const daySpan = (lastActivity.getTime() - firstActivity.getTime()) / (24 * 60 * 60 * 1000) || 1;

    // Hour distribution
    const hourCounts = new Array(24).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);

    for (const ts of timestamps) {
      hourCounts[ts.getHours()]++;
      dayOfWeekCounts[ts.getDay()]++;
    }

    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    const peakDayOfWeek = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));

    // Activity trend
    const midPoint = new Date((firstActivity.getTime() + lastActivity.getTime()) / 2);
    const firstHalf = timestamps.filter(t => t < midPoint).length;
    const secondHalf = timestamps.filter(t => t >= midPoint).length;

    let activityTrend: 'increasing' | 'stable' | 'decreasing';
    if (secondHalf > firstHalf * 1.2) {
      activityTrend = 'increasing';
    } else if (firstHalf > secondHalf * 1.2) {
      activityTrend = 'decreasing';
    } else {
      activityTrend = 'stable';
    }

    return {
      entityId,
      entityType: entity.type,
      totalInteractions: timestamps.length,
      averagePerDay: timestamps.length / daySpan,
      peakHour,
      peakDayOfWeek,
      firstActivity,
      lastActivity,
      activityTrend,
    };
  }

  // --------------------------------------------------------------------------
  // TEMPORAL ANALYSIS
  // --------------------------------------------------------------------------

  /**
   * Get comprehensive temporal analysis for an entity
   */
  async analyzeEntity(entityId: string): Promise<TemporalAnalysis | null> {
    const store = getOntologyStore();
    const entity = store.getEntity(entityId);
    if (!entity) return null;

    const relevance = this.calculateRelevance(entity);
    const decayConfig = this.getDecayConfig(entity.type);
    const decayRate = Math.LN2 / decayConfig.halfLife;

    const now = Date.now();
    const lastUpdate = new Date(entity.updatedAt).getTime();
    const daysSinceInteraction = (now - lastUpdate) / (24 * 60 * 60 * 1000);

    const interactions = this.interactionTracker.get(entityId) ?? [];
    const interactionFrequency = interactions.length > 0
      ? interactions.length / ((now - new Date(entity.createdAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    // Predict relevance in 30 days
    const futureRelevance = Math.max(
      decayConfig.minRelevance,
      relevance * Math.exp(-decayRate * 30)
    );

    const activityPattern = await this.getActivityPattern(entityId);

    return {
      entityId,
      currentRelevance: relevance,
      decayRate,
      daysSinceInteraction,
      interactionFrequency,
      predictedRelevanceIn30Days: futureRelevance,
      activityPattern: activityPattern ?? undefined,
    };
  }

  // --------------------------------------------------------------------------
  // CACHE MANAGEMENT
  // --------------------------------------------------------------------------

  clearCache(): void {
    this.relevanceCache.clear();
    logger.debug('Temporal engine cache cleared');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: TemporalEngine | null = null;

export function getTemporalEngine(): TemporalEngine {
  if (!instance) {
    instance = new TemporalEngine();
  }
  return instance;
}
