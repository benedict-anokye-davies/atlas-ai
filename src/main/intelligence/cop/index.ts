/**
 * COP (Common Operating Picture) Module
 * Unified intelligence dashboard and state management
 */

export * from './types';
export * from './state-aggregator';

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { StateAggregator, getStateAggregator } from './state-aggregator';
import {
  COPState,
  COPConfig,
  DEFAULT_COP_CONFIG,
  AlertFilter,
  RecommendationFilter,
  PrioritizedAlert,
  PrioritizedRecommendation,
  COPInsight,
  ActiveContext,
  ContextType,
} from './types';

const logger = createModuleLogger('COP');

// ============================================================================
// COP MANAGER
// ============================================================================

export class COPManager extends EventEmitter {
  private aggregator: StateAggregator;
  private config: COPConfig;
  private updateInterval: NodeJS.Timeout | null = null;
  private alertCheckInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(config: Partial<COPConfig> = {}) {
    super();
    this.config = { ...DEFAULT_COP_CONFIG, ...config };
    this.aggregator = getStateAggregator();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing COP manager...');

    // Initial state aggregation
    await this.aggregator.aggregateState();

    // Set up periodic updates
    this.updateInterval = setInterval(
      () => this.periodicUpdate(),
      this.config.updateIntervalMs
    );

    // Set up alert checking
    this.alertCheckInterval = setInterval(
      () => this.checkAlerts(),
      this.config.alertCheckIntervalMs
    );

    // Forward events
    this.aggregator.on('state-updated', (state) => {
      this.emit('state-updated', state);
    });

    this.aggregator.on('alert-acknowledged', (alertId) => {
      this.emit('alert-acknowledged', alertId);
    });

    this.aggregator.on('context-started', (context) => {
      this.emit('context-started', context);
    });

    this.aggregator.on('context-ended', (context) => {
      this.emit('context-ended', context);
    });

    this.initialized = true;
    logger.info('COP manager initialized');
  }

  async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }

    this.initialized = false;
    logger.info('COP manager shut down');
  }

  // --------------------------------------------------------------------------
  // STATE ACCESS
  // --------------------------------------------------------------------------

  /**
   * Get current COP state
   */
  async getState(): Promise<COPState> {
    const state = this.aggregator.getState();
    if (state) {
      return state;
    }
    return this.aggregator.aggregateState();
  }

  /**
   * Force refresh state
   */
  async refreshState(): Promise<COPState> {
    return this.aggregator.aggregateState();
  }

  /**
   * Get summary only
   */
  getSummary() {
    return this.aggregator.getSummary();
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  /**
   * Get filtered alerts
   */
  async getAlerts(filter?: AlertFilter): Promise<PrioritizedAlert[]> {
    const state = await this.getState();
    let alerts = state.alerts;

    if (filter?.categories) {
      alerts = alerts.filter(a => filter.categories!.includes(a.category));
    }

    if (filter?.agentIds) {
      alerts = alerts.filter(a => filter.agentIds!.includes(a.agentId as any));
    }

    if (filter?.minPriority) {
      alerts = alerts.filter(a => a.overallPriority >= filter.minPriority!);
    }

    if (!filter?.includeAcknowledged) {
      alerts = alerts.filter(a => !a.acknowledged);
    }

    if (!filter?.includeSnoozed) {
      const now = new Date();
      alerts = alerts.filter(a => !a.snoozedUntil || a.snoozedUntil <= now);
    }

    return alerts;
  }

  /**
   * Get urgent alerts only
   */
  async getUrgentAlerts(): Promise<PrioritizedAlert[]> {
    return this.getAlerts({ categories: ['urgent'], minPriority: 70 });
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): void {
    this.aggregator.acknowledgeAlert(alertId);
  }

  /**
   * Snooze an alert
   */
  snoozeAlert(alertId: string, minutes?: number): void {
    this.aggregator.snoozeAlert(alertId, minutes);
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  /**
   * Get filtered recommendations
   */
  async getRecommendations(filter?: RecommendationFilter): Promise<PrioritizedRecommendation[]> {
    const state = await this.getState();
    let recs = state.recommendations;

    if (filter?.categories) {
      recs = recs.filter(r => filter.categories!.includes(r.category));
    }

    if (filter?.agentIds) {
      recs = recs.filter(r => filter.agentIds!.includes(r.agentId as any));
    }

    if (filter?.minScore) {
      recs = recs.filter(r => r.overallScore >= filter.minScore!);
    }

    if (filter?.maxEffort) {
      const effortOrder = { low: 1, medium: 2, high: 3 };
      const maxEffort = effortOrder[filter.maxEffort];
      recs = recs.filter(r => effortOrder[r.effort] <= maxEffort);
    }

    if (!filter?.includeDismissed) {
      recs = recs.filter(r => !r.dismissed);
    }

    return recs;
  }

  /**
   * Get quick wins only
   */
  async getQuickWins(): Promise<PrioritizedRecommendation[]> {
    return this.getRecommendations({ categories: ['quick_win'], maxEffort: 'low' });
  }

  /**
   * Dismiss a recommendation
   */
  dismissRecommendation(recId: string): void {
    this.aggregator.dismissRecommendation(recId);
  }

  /**
   * Mark recommendation as acted upon
   */
  markRecommendationActed(recId: string): void {
    this.aggregator.markRecommendationActed(recId);
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  /**
   * Get all insights
   */
  async getInsights(): Promise<COPInsight[]> {
    const state = await this.getState();
    return state.insights;
  }

  /**
   * Get actionable insights
   */
  async getActionableInsights(): Promise<COPInsight[]> {
    const insights = await this.getInsights();
    return insights.filter(i => i.actionable);
  }

  // --------------------------------------------------------------------------
  // CONTEXT MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Start a new context
   */
  startContext(
    type: ContextType,
    name: string,
    options?: {
      description?: string;
      relatedEntityIds?: string[];
      priority?: number;
      metadata?: Record<string, unknown>;
    }
  ): string {
    return this.aggregator.startContext({
      type,
      name,
      description: options?.description ?? '',
      relatedEntityIds: options?.relatedEntityIds ?? [],
      priority: options?.priority ?? 5,
      metadata: options?.metadata ?? {},
    });
  }

  /**
   * End a context
   */
  endContext(contextId: string): void {
    this.aggregator.endContext(contextId);
  }

  /**
   * Get active contexts
   */
  getActiveContexts(): ActiveContext[] {
    return this.aggregator.getActiveContexts();
  }

  /**
   * Check if in specific context type
   */
  isInContext(type: ContextType): boolean {
    return this.getActiveContexts().some(c => c.type === type);
  }

  // --------------------------------------------------------------------------
  // NOTIFICATIONS
  // --------------------------------------------------------------------------

  /**
   * Check if notifications should be sent (respects quiet hours)
   */
  shouldNotify(): boolean {
    if (!this.config.quietHoursStart || !this.config.quietHoursEnd) {
      return true;
    }

    const hour = new Date().getHours();
    const inQuietHours =
      this.config.quietHoursStart < this.config.quietHoursEnd
        ? hour >= this.config.quietHoursStart && hour < this.config.quietHoursEnd
        : hour >= this.config.quietHoursStart || hour < this.config.quietHoursEnd;

    return !inQuietHours;
  }

  /**
   * Get alerts that should trigger notifications
   */
  async getNotificationAlerts(): Promise<PrioritizedAlert[]> {
    if (!this.shouldNotify()) {
      return [];
    }

    return this.getAlerts({
      minPriority: this.config.notificationThreshold,
      includeAcknowledged: false,
      includeSnoozed: false,
    });
  }

  // --------------------------------------------------------------------------
  // PERIODIC TASKS
  // --------------------------------------------------------------------------

  private async periodicUpdate(): Promise<void> {
    try {
      await this.aggregator.aggregateState();
      logger.debug('COP state updated');
    } catch (error) {
      logger.error('Error in periodic update:', error as Record<string, unknown>);
    }
  }

  private async checkAlerts(): Promise<void> {
    try {
      const alerts = await this.getNotificationAlerts();
      if (alerts.length > 0) {
        this.emit('alerts-pending', alerts);
      }
    } catch (error) {
      logger.error('Error checking alerts:', error as Record<string, unknown>);
    }
  }

  // --------------------------------------------------------------------------
  // EVENT EMITTER
  // --------------------------------------------------------------------------

  private listeners: Map<string, Set<Function>> = new Map();

  on(event: string, listener: Function): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Function): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  private emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(listener => {
      try {
        listener(...args);
      } catch (e) {
        logger.error('Error in event listener:', e as Record<string, unknown>);
      }
    });
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: COPManager | null = null;

export function getCOPManager(): COPManager {
  if (!instance) {
    instance = new COPManager();
  }
  return instance;
}

export async function initializeCOP(): Promise<void> {
  const manager = getCOPManager();
  await manager.initialize();
}
