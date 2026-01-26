/**
 * Pattern Detector
 * Detects patterns from entity and relationship data
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { Entity, EntityType } from '../types';
import { getOntologyStore } from '../ontology';
import {
  Pattern,
  PatternType,
  TemporalPattern,
  BehavioralPattern,
  SequentialPattern,
  AssociativePattern,
  AnomalyPattern,
  LearningEvent,
  DynamicLayerConfig,
  DEFAULT_DYNAMIC_CONFIG,
} from './types';

const logger = createModuleLogger('PatternDetector');

// ============================================================================
// PATTERN DETECTOR
// ============================================================================

export class PatternDetector extends EventEmitter {
  private config: DynamicLayerConfig;
  private patterns: Map<string, Pattern> = new Map();
  private learningEvents: LearningEvent[] = [];
  private sequenceBuffer: Map<string, Array<{ action: string; timestamp: Date; entityType?: EntityType }>> = new Map();

  constructor(config: Partial<DynamicLayerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DYNAMIC_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // LEARNING EVENT RECORDING
  // --------------------------------------------------------------------------

  recordEvent(event: Omit<LearningEvent, 'id'>): void {
    const fullEvent: LearningEvent = {
      ...event,
      id: this.generateId(),
    };

    this.learningEvents.push(fullEvent);

    // Trim old events
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    this.learningEvents = this.learningEvents.filter(e => e.timestamp.getTime() > cutoff);

    // Update sequence buffer for sequential pattern detection
    if (event.action) {
      const sessionKey = this.getSessionKey(event.timestamp);
      if (!this.sequenceBuffer.has(sessionKey)) {
        this.sequenceBuffer.set(sessionKey, []);
      }
      this.sequenceBuffer.get(sessionKey)!.push({
        action: event.action,
        timestamp: event.timestamp,
        entityType: event.entityType,
      });
    }

    // Batch learning
    if (this.learningEvents.length % this.config.batchSize === 0) {
      this.detectPatterns();
    }
  }

  // --------------------------------------------------------------------------
  // PATTERN DETECTION
  // --------------------------------------------------------------------------

  async detectPatterns(): Promise<Pattern[]> {
    logger.debug('Running pattern detection...');

    const newPatterns: Pattern[] = [];

    // Detect each pattern type
    newPatterns.push(...this.detectTemporalPatterns());
    newPatterns.push(...this.detectBehavioralPatterns());
    newPatterns.push(...this.detectSequentialPatterns());
    newPatterns.push(...this.detectAssociativePatterns());
    newPatterns.push(...this.detectAnomalies());

    // Filter by confidence threshold
    const validPatterns = newPatterns.filter(
      p => p.confidence >= this.config.patternConfidenceThreshold &&
           p.occurrences >= this.config.minPatternOccurrences
    );

    // Update pattern store
    for (const pattern of validPatterns) {
      const existing = this.patterns.get(pattern.id);
      if (existing) {
        // Update existing pattern
        existing.occurrences = pattern.occurrences;
        existing.confidence = pattern.confidence;
        existing.lastSeen = pattern.lastSeen;
        existing.metadata = { ...existing.metadata, ...pattern.metadata };
      } else {
        // New pattern
        this.patterns.set(pattern.id, pattern);
        this.emit('pattern-discovered', pattern);
        logger.info(`New pattern discovered: ${pattern.name}`, { type: pattern.type });
      }
    }

    return validPatterns;
  }

  // --------------------------------------------------------------------------
  // TEMPORAL PATTERN DETECTION
  // --------------------------------------------------------------------------

  private detectTemporalPatterns(): TemporalPattern[] {
    const patterns: TemporalPattern[] = [];

    // Group events by hour of day
    const hourlyActivity = new Map<number, number>();
    for (const event of this.learningEvents) {
      const hour = event.timestamp.getHours();
      hourlyActivity.set(hour, (hourlyActivity.get(hour) ?? 0) + 1);
    }

    // Find peak activity hours
    const sortedHours = [...hourlyActivity.entries()].sort((a, b) => b[1] - a[1]);
    const peakHours = sortedHours.slice(0, 3);

    for (const [hour, count] of peakHours) {
      if (count >= this.config.minPatternOccurrences) {
        patterns.push({
          id: `temporal-hourly-${hour}`,
          type: 'temporal',
          name: `Peak Activity at ${hour}:00`,
          description: `You're most active around ${hour}:00`,
          confidence: Math.min(1, count / (this.learningEvents.length / 24) / 2),
          occurrences: count,
          lastSeen: new Date(),
          firstSeen: this.getFirstEventForHour(hour)?.timestamp ?? new Date(),
          entityTypes: [],
          relatedEntityIds: [],
          metadata: { hour, count },
          frequency: 'daily',
          typicalTime: { hour, minute: 0 },
          variance: 1,
        });
      }
    }

    // Group events by day of week
    const dailyActivity = new Map<number, number>();
    for (const event of this.learningEvents) {
      const day = event.timestamp.getDay();
      dailyActivity.set(day, (dailyActivity.get(day) ?? 0) + 1);
    }

    // Find peak days
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const sortedDays = [...dailyActivity.entries()].sort((a, b) => b[1] - a[1]);

    for (const [day, count] of sortedDays.slice(0, 2)) {
      if (count >= this.config.minPatternOccurrences) {
        patterns.push({
          id: `temporal-weekly-${day}`,
          type: 'temporal',
          name: `High Activity on ${dayNames[day]}`,
          description: `${dayNames[day]}s are typically busy days`,
          confidence: Math.min(1, count / (this.learningEvents.length / 7) / 2),
          occurrences: count,
          lastSeen: new Date(),
          firstSeen: this.getFirstEventForDay(day)?.timestamp ?? new Date(),
          entityTypes: [],
          relatedEntityIds: [],
          metadata: { day, dayName: dayNames[day], count },
          frequency: 'weekly',
          typicalDay: day,
          variance: 0.5,
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------------------------------
  // BEHAVIORAL PATTERN DETECTION
  // --------------------------------------------------------------------------

  private detectBehavioralPatterns(): BehavioralPattern[] {
    const patterns: BehavioralPattern[] = [];

    // Group events by action type
    const actionCounts = new Map<string, { count: number; contexts: string[]; times: Date[] }>();

    for (const event of this.learningEvents) {
      if (!event.action) continue;

      const existing = actionCounts.get(event.action);
      if (existing) {
        existing.count++;
        existing.times.push(event.timestamp);
        if (event.context) {
          const contextStr = JSON.stringify(event.context);
          if (!existing.contexts.includes(contextStr)) {
            existing.contexts.push(contextStr);
          }
        }
      } else {
        actionCounts.set(event.action, {
          count: 1,
          contexts: event.context ? [JSON.stringify(event.context)] : [],
          times: [event.timestamp],
        });
      }
    }

    // Create patterns for frequent actions
    for (const [action, data] of actionCounts) {
      if (data.count >= this.config.minPatternOccurrences) {
        // Calculate preferred time
        const avgHour = data.times.reduce((sum, t) => sum + t.getHours(), 0) / data.times.length;
        const preferredTime = avgHour < 12 ? 'morning' : avgHour < 17 ? 'afternoon' : 'evening';

        patterns.push({
          id: `behavioral-${action}`,
          type: 'behavioral',
          name: `Frequent: ${action}`,
          description: `You frequently perform "${action}"`,
          confidence: Math.min(1, data.count / this.learningEvents.length * 5),
          occurrences: data.count,
          lastSeen: data.times[data.times.length - 1] ?? new Date(),
          firstSeen: data.times[0] ?? new Date(),
          entityTypes: [],
          relatedEntityIds: [],
          metadata: { action, contexts: data.contexts.slice(0, 5) },
          behavior: action,
          context: data.contexts.slice(0, 5).map(c => {
            try { return JSON.parse(c); } catch { return c; }
          }),
          preferredTime,
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------------------------------
  // SEQUENTIAL PATTERN DETECTION
  // --------------------------------------------------------------------------

  private detectSequentialPatterns(): SequentialPattern[] {
    const patterns: SequentialPattern[] = [];

    // Find frequent sequences
    const sequenceCounts = new Map<string, { count: number; times: number[]; sequence: string[] }>();

    for (const [_, actions] of this.sequenceBuffer) {
      // Look for sequences of 2-4 actions
      for (let len = 2; len <= Math.min(4, actions.length); len++) {
        for (let i = 0; i <= actions.length - len; i++) {
          const seq = actions.slice(i, i + len);
          const seqKey = seq.map(a => a.action).join(' -> ');

          // Calculate time between actions
          const times: number[] = [];
          for (let j = 1; j < seq.length; j++) {
            times.push(seq[j]!.timestamp.getTime() - seq[j - 1]!.timestamp.getTime());
          }

          const existing = sequenceCounts.get(seqKey);
          if (existing) {
            existing.count++;
            existing.times.push(...times);
          } else {
            sequenceCounts.set(seqKey, {
              count: 1,
              times,
              sequence: seq.map(a => a.action),
            });
          }
        }
      }
    }

    // Create patterns for frequent sequences
    for (const [seqKey, data] of sequenceCounts) {
      if (data.count >= this.config.minPatternOccurrences) {
        const avgTimes = data.times.length > 0
          ? data.times.reduce((a, b) => a + b, 0) / data.times.length
          : 1000;

        patterns.push({
          id: `sequential-${seqKey.replace(/\s+->\s+/g, '-')}`,
          type: 'sequential',
          name: `Workflow: ${data.sequence.join(' → ')}`,
          description: `You often do these actions in sequence`,
          confidence: Math.min(1, data.count / 5),
          occurrences: data.count,
          lastSeen: new Date(),
          firstSeen: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          entityTypes: [],
          relatedEntityIds: [],
          metadata: { sequence: data.sequence },
          sequence: data.sequence.map((action, i) => ({
            action,
            avgTimeBetween: i < data.sequence.length - 1 ? avgTimes : undefined,
          })),
          avgCompletionTime: avgTimes * (data.sequence.length - 1),
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------------------------------
  // ASSOCIATIVE PATTERN DETECTION
  // --------------------------------------------------------------------------

  private detectAssociativePatterns(): AssociativePattern[] {
    const patterns: AssociativePattern[] = [];

    // Group events by entity co-occurrence
    const entityPairs = new Map<string, { count: number; entities: Set<string>; types: Map<string, EntityType> }>();

    // Group events by session
    const sessionEvents = new Map<string, LearningEvent[]>();
    for (const event of this.learningEvents) {
      const sessionKey = this.getSessionKey(event.timestamp);
      if (!sessionEvents.has(sessionKey)) {
        sessionEvents.set(sessionKey, []);
      }
      sessionEvents.get(sessionKey)!.push(event);
    }

    // Find co-occurring entities within sessions
    for (const [_, events] of sessionEvents) {
      const sessionEntities = events
        .filter(e => e.entityId && e.entityType)
        .map(e => ({ id: e.entityId!, type: e.entityType! }));

      // Create pairs
      for (let i = 0; i < sessionEntities.length; i++) {
        for (let j = i + 1; j < sessionEntities.length; j++) {
          const e1 = sessionEntities[i]!;
          const e2 = sessionEntities[j]!;
          const pairKey = [e1.id, e2.id].sort().join('::');

          const existing = entityPairs.get(pairKey);
          if (existing) {
            existing.count++;
            existing.entities.add(e1.id);
            existing.entities.add(e2.id);
          } else {
            const entities = new Set([e1.id, e2.id]);
            const types = new Map<string, EntityType>();
            types.set(e1.id, e1.type);
            types.set(e2.id, e2.type);
            entityPairs.set(pairKey, { count: 1, entities, types });
          }
        }
      }
    }

    // Create patterns for frequent co-occurrences
    const totalSessions = sessionEvents.size;
    for (const [_, data] of entityPairs) {
      if (data.count >= this.config.minPatternOccurrences) {
        const support = data.count / totalSessions;
        const entities = [...data.entities];

        const store = getOntologyStore();
        const entityNames = entities.map(id => {
          const entity = store.getEntity(id);
          return entity?.name ?? id;
        });

        patterns.push({
          id: `associative-${entities.join('-')}`,
          type: 'associative',
          name: `Associated: ${entityNames.join(' & ')}`,
          description: `These are often used together`,
          confidence: Math.min(1, support * 3),
          occurrences: data.count,
          lastSeen: new Date(),
          firstSeen: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          entityTypes: [...data.types.values()],
          relatedEntityIds: entities,
          metadata: { entityNames },
          items: entities.map(id => ({
            entityId: id,
            entityType: data.types.get(id)!,
            support: data.count / totalSessions,
          })),
          support,
          lift: support / (1 / entities.length), // Simplified lift calculation
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------------------------------
  // ANOMALY DETECTION
  // --------------------------------------------------------------------------

  private detectAnomalies(): AnomalyPattern[] {
    const patterns: AnomalyPattern[] = [];

    // Detect timing anomalies
    const recentEvents = this.learningEvents.slice(-100);
    const olderEvents = this.learningEvents.slice(0, -100);

    if (recentEvents.length < 10 || olderEvents.length < 50) {
      return patterns; // Not enough data
    }

    // Calculate baseline hourly distribution
    const baselineHours = new Map<number, number>();
    for (const event of olderEvents) {
      const hour = event.timestamp.getHours();
      baselineHours.set(hour, (baselineHours.get(hour) ?? 0) + 1);
    }

    // Calculate recent hourly distribution
    const recentHours = new Map<number, number>();
    for (const event of recentEvents) {
      const hour = event.timestamp.getHours();
      recentHours.set(hour, (recentHours.get(hour) ?? 0) + 1);
    }

    // Normalize
    const baselineTotal = [...baselineHours.values()].reduce((a, b) => a + b, 0);
    const recentTotal = [...recentHours.values()].reduce((a, b) => a + b, 0);

    // Find significant deviations
    for (let hour = 0; hour < 24; hour++) {
      const baselineRate = (baselineHours.get(hour) ?? 0) / baselineTotal;
      const recentRate = (recentHours.get(hour) ?? 0) / recentTotal;

      if (baselineRate > 0.01) { // Only consider hours with baseline activity
        const deviation = Math.abs(recentRate - baselineRate) / Math.max(baselineRate, 0.01);

        if (deviation > this.config.anomalyThreshold) {
          const direction = recentRate > baselineRate ? 'increased' : 'decreased';
          patterns.push({
            id: `anomaly-timing-${hour}`,
            type: 'anomaly',
            name: `Activity Change at ${hour}:00`,
            description: `Activity at ${hour}:00 has ${direction} significantly`,
            confidence: Math.min(1, deviation / (this.config.anomalyThreshold * 2)),
            occurrences: 1,
            lastSeen: new Date(),
            firstSeen: new Date(),
            entityTypes: [],
            relatedEntityIds: [],
            metadata: { hour, baselineRate, recentRate, direction },
            anomalyType: 'timing',
            expectedValue: baselineRate,
            observedValue: recentRate,
            deviation,
            severity: deviation > this.config.anomalyThreshold * 2 ? 'high' :
                      deviation > this.config.anomalyThreshold * 1.5 ? 'medium' : 'low',
          });
        }
      }
    }

    // Detect frequency anomalies (sudden drop or spike in activity)
    const weeklyEvents = new Map<number, number>();
    for (const event of this.learningEvents) {
      const weekNum = this.getWeekNumber(event.timestamp);
      weeklyEvents.set(weekNum, (weeklyEvents.get(weekNum) ?? 0) + 1);
    }

    const weeklyTotals = [...weeklyEvents.values()];
    if (weeklyTotals.length >= 4) {
      const avgWeekly = weeklyTotals.slice(0, -1).reduce((a, b) => a + b, 0) / (weeklyTotals.length - 1);
      const stdDev = Math.sqrt(
        weeklyTotals.slice(0, -1).reduce((sum, val) => sum + Math.pow(val - avgWeekly, 2), 0) / (weeklyTotals.length - 1)
      );

      const currentWeek = weeklyTotals[weeklyTotals.length - 1]!;
      const zScore = stdDev > 0 ? (currentWeek - avgWeekly) / stdDev : 0;

      if (Math.abs(zScore) > this.config.anomalyThreshold) {
        const direction = zScore > 0 ? 'spike' : 'drop';
        patterns.push({
          id: 'anomaly-frequency-weekly',
          type: 'anomaly',
          name: `Activity ${direction.charAt(0).toUpperCase() + direction.slice(1)}`,
          description: `This week's activity is ${Math.abs(zScore).toFixed(1)} standard deviations ${direction === 'spike' ? 'above' : 'below'} normal`,
          confidence: Math.min(1, Math.abs(zScore) / (this.config.anomalyThreshold * 2)),
          occurrences: 1,
          lastSeen: new Date(),
          firstSeen: new Date(),
          entityTypes: [],
          relatedEntityIds: [],
          metadata: { avgWeekly, currentWeek, zScore },
          anomalyType: 'frequency',
          expectedValue: avgWeekly,
          observedValue: currentWeek,
          deviation: Math.abs(zScore),
          severity: Math.abs(zScore) > this.config.anomalyThreshold * 2 ? 'high' :
                    Math.abs(zScore) > this.config.anomalyThreshold * 1.5 ? 'medium' : 'low',
        });
      }
    }

    return patterns;
  }

  // --------------------------------------------------------------------------
  // PATTERN RETRIEVAL
  // --------------------------------------------------------------------------

  getPatterns(filter?: { type?: PatternType; minConfidence?: number }): Pattern[] {
    let patterns = [...this.patterns.values()];

    if (filter?.type) {
      patterns = patterns.filter(p => p.type === filter.type);
    }

    if (filter?.minConfidence) {
      patterns = patterns.filter(p => p.confidence >= filter.minConfidence!);
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  getPattern(id: string): Pattern | undefined {
    return this.patterns.get(id);
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getSessionKey(timestamp: Date): string {
    // Group into 30-minute sessions
    const sessionStart = new Date(timestamp);
    sessionStart.setMinutes(Math.floor(sessionStart.getMinutes() / 30) * 30, 0, 0);
    return sessionStart.toISOString();
  }

  private getFirstEventForHour(hour: number): LearningEvent | undefined {
    return this.learningEvents.find(e => e.timestamp.getHours() === hour);
  }

  private getFirstEventForDay(day: number): LearningEvent | undefined {
    return this.learningEvents.find(e => e.timestamp.getDay() === day);
  }

  private getWeekNumber(date: Date): number {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    return Math.ceil((days + startOfYear.getDay() + 1) / 7);
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  getStats(): { totalPatterns: number; patternsByType: Record<PatternType, number>; totalEvents: number } {
    const patternsByType: Record<PatternType, number> = {
      temporal: 0,
      behavioral: 0,
      sequential: 0,
      associative: 0,
      anomaly: 0,
    };

    for (const pattern of this.patterns.values()) {
      patternsByType[pattern.type]++;
    }

    return {
      totalPatterns: this.patterns.size,
      patternsByType,
      totalEvents: this.learningEvents.length,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: PatternDetector | null = null;

export function getPatternDetector(): PatternDetector {
  if (!instance) {
    instance = new PatternDetector();
  }
  return instance;
}
