/**
 * Dynamic Layer Module
 * Pattern learning, predictions, and behavioral models
 */

export * from './types';
export * from './pattern-detector';
export * from './prediction-engine';
export * from './behavioral-modeler';

import { createModuleLogger } from '../../utils/logger';
import { PatternDetector, getPatternDetector } from './pattern-detector';
import { PredictionEngine, getPredictionEngine } from './prediction-engine';
import { BehavioralModeler, getBehavioralModeler } from './behavioral-modeler';
import { LearningEvent, DynamicLayerStats, DynamicLayerConfig, DEFAULT_DYNAMIC_CONFIG } from './types';

const logger = createModuleLogger('DynamicLayer');

// ============================================================================
// DYNAMIC LAYER MANAGER
// ============================================================================

export class DynamicLayerManager {
  private patternDetector: PatternDetector;
  private predictionEngine: PredictionEngine;
  private behavioralModeler: BehavioralModeler;
  private config: DynamicLayerConfig;
  private updateInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(config: Partial<DynamicLayerConfig> = {}) {
    this.config = { ...DEFAULT_DYNAMIC_CONFIG, ...config };
    this.patternDetector = getPatternDetector();
    this.predictionEngine = getPredictionEngine();
    this.behavioralModeler = getBehavioralModeler();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing dynamic layer...');

    // Set up periodic updates
    this.updateInterval = setInterval(
      () => this.periodicUpdate(),
      5 * 60 * 1000 // Every 5 minutes
    );

    // Initial pattern detection
    await this.patternDetector.detectPatterns();

    this.initialized = true;
    logger.info('Dynamic layer initialized');
  }

  async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.initialized = false;
    logger.info('Dynamic layer shut down');
  }

  // --------------------------------------------------------------------------
  // LEARNING
  // --------------------------------------------------------------------------

  /**
   * Record a learning event for all components
   */
  recordEvent(event: Omit<LearningEvent, 'id'>): void {
    // Feed to pattern detector
    this.patternDetector.recordEvent(event);

    // Feed to behavioral modeler
    this.behavioralModeler.recordEvent(event);

    logger.debug('Learning event recorded', { eventType: event.eventType });
  }

  /**
   * Record when an entity is created
   */
  recordEntityCreated(entityId: string, entityType: string): void {
    this.recordEvent({
      timestamp: new Date(),
      eventType: 'entity_created',
      entityId,
      entityType: entityType as any,
      context: {},
    });
  }

  /**
   * Record when an entity is updated
   */
  recordEntityUpdated(entityId: string, entityType: string, changes: Record<string, unknown>): void {
    this.recordEvent({
      timestamp: new Date(),
      eventType: 'entity_updated',
      entityId,
      entityType: entityType as any,
      context: { changes },
    });
  }

  /**
   * Record when a relationship is created
   */
  recordRelationshipCreated(sourceId: string, targetId: string, relationshipType: string): void {
    this.recordEvent({
      timestamp: new Date(),
      eventType: 'relationship_created',
      context: { sourceId, targetId, relationshipType },
    });
  }

  /**
   * Record when user takes an action
   */
  recordAction(action: string, context: Record<string, unknown> = {}, outcome?: 'positive' | 'negative' | 'neutral'): void {
    this.recordEvent({
      timestamp: new Date(),
      eventType: 'action_taken',
      action,
      context,
      outcome,
    });
  }

  // --------------------------------------------------------------------------
  // PREDICTIONS
  // --------------------------------------------------------------------------

  /**
   * Get predictions based on current context
   */
  async getPredictions(context?: { recentActions?: string[] }) {
    return this.predictionEngine.generatePredictions(context);
  }

  /**
   * Record feedback on a prediction
   */
  recordPredictionFeedback(
    predictionId: string,
    feedbackType: 'correct' | 'incorrect' | 'helpful' | 'not_helpful',
    details?: string
  ): void {
    this.predictionEngine.recordFeedback({
      timestamp: new Date(),
      predictionId,
      feedbackType,
      details,
    });
  }

  // --------------------------------------------------------------------------
  // PATTERNS
  // --------------------------------------------------------------------------

  /**
   * Get detected patterns
   */
  getPatterns(filter?: { type?: string; minConfidence?: number }) {
    return this.patternDetector.getPatterns(filter as any);
  }

  /**
   * Trigger pattern detection
   */
  async detectPatterns() {
    return this.patternDetector.detectPatterns();
  }

  // --------------------------------------------------------------------------
  // BEHAVIORAL INSIGHTS
  // --------------------------------------------------------------------------

  /**
   * Get behavioral insights
   */
  async getInsights() {
    return this.behavioralModeler.getInsights();
  }

  /**
   * Get a specific behavioral model
   */
  getModel(modelId: string) {
    return this.behavioralModeler.getModel(modelId);
  }

  /**
   * Get all behavioral models
   */
  getAllModels() {
    return this.behavioralModeler.getAllModels();
  }

  // --------------------------------------------------------------------------
  // PERIODIC UPDATE
  // --------------------------------------------------------------------------

  private async periodicUpdate(): Promise<void> {
    logger.debug('Running periodic dynamic layer update...');

    try {
      // Detect new patterns
      await this.patternDetector.detectPatterns();

      // Generate predictions
      await this.predictionEngine.generatePredictions();

      logger.debug('Periodic update complete');
    } catch (error) {
      logger.error('Error in periodic update:', error as Record<string, unknown>);
    }
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  getStats(): DynamicLayerStats {
    const patternStats = this.patternDetector.getStats();
    const predictionStats = this.predictionEngine.getStats();
    const modelerStats = this.behavioralModeler.getStats();

    return {
      totalPatterns: patternStats.totalPatterns,
      patternsByType: patternStats.patternsByType,
      totalPredictions: predictionStats.totalPredictions,
      predictionAccuracy: predictionStats.accuracy,
      totalLearningEvents: patternStats.totalEvents,
      lastLearningEventAt: undefined, // Would need to track this
      modelsUpdatedAt: modelerStats.modelsSummary[0]?.lastUpdated,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: DynamicLayerManager | null = null;

export function getDynamicLayerManager(): DynamicLayerManager {
  if (!instance) {
    instance = new DynamicLayerManager();
  }
  return instance;
}

export async function initializeDynamicLayer(): Promise<void> {
  const manager = getDynamicLayerManager();
  await manager.initialize();
}
