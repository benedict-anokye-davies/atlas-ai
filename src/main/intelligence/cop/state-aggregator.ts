/**
 * State Aggregator
 * Aggregates state from all intelligence sources into unified COP view
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { Entity, EntityType } from '../types';
import { getOntologyStore } from '../ontology';
import { getTemporalEngine } from '../temporal';
import { getKnowledgeGraphEngine } from '../knowledge-graph';
import { getAllAgents, getAgent, getAllAlerts, getAllRecommendations, getAllInsights } from '../agents';
import { getDynamicLayerManager } from '../dynamic';
import {
  COPState,
  COPSummary,
  EntityHighlights,
  PrioritizedAlert,
  PrioritizedRecommendation,
  COPInsight,
  AgentStatus,
  ActiveContext,
  SystemHealth,
  AlertCategory,
  RecommendationCategory,
  COPConfig,
  DEFAULT_COP_CONFIG,
} from './types';

const logger = createModuleLogger('StateAggregator');

// ============================================================================
// STATE AGGREGATOR
// ============================================================================

export class StateAggregator extends EventEmitter {
  private config: COPConfig;
  private state: COPState | null = null;
  private activeContexts: Map<string, ActiveContext> = new Map();
  private acknowledgedAlerts: Set<string> = new Set();
  private snoozedAlerts: Map<string, Date> = new Map();
  private dismissedRecommendations: Set<string> = new Set();
  private actedRecommendations: Set<string> = new Set();

  constructor(config: Partial<COPConfig> = {}) {
    super();
    this.config = { ...DEFAULT_COP_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // STATE AGGREGATION
  // --------------------------------------------------------------------------

  async aggregateState(): Promise<COPState> {
    logger.debug('Aggregating COP state...');

    const now = new Date();

    const [summary, entities, alerts, recommendations, insights, agentStatuses, health] = await Promise.all([
      this.aggregateSummary(),
      this.aggregateEntityHighlights(),
      this.aggregateAlerts(),
      this.aggregateRecommendations(),
      this.aggregateInsights(),
      this.aggregateAgentStatuses(),
      this.checkSystemHealth(),
    ]);

    const contexts = [...this.activeContexts.values()];

    this.state = {
      timestamp: now,
      lastUpdated: now,
      summary,
      entities,
      alerts,
      recommendations,
      insights,
      agentStatuses,
      contexts,
      health,
    };

    this.emit('state-updated', this.state);
    return this.state;
  }

  // --------------------------------------------------------------------------
  // SUMMARY AGGREGATION
  // --------------------------------------------------------------------------

  private async aggregateSummary(): Promise<COPSummary> {
    const store = getOntologyStore();
    const now = new Date();

    // Task/Project metrics
    const tasks = store.getEntitiesByType('task', 500);
    const projects = store.getEntitiesByType('project', 100);

    const overdueTasks = tasks.filter(t => {
      if (t.properties?.status === 'completed') return false;
      if (!t.properties?.dueDate) return false;
      return new Date(t.properties.dueDate as string) < now;
    });

    const dueTodayTasks = tasks.filter(t => {
      if (t.properties?.status === 'completed') return false;
      if (!t.properties?.dueDate) return false;
      const due = new Date(t.properties.dueDate as string);
      return due.toDateString() === now.toDateString();
    });

    const completedTasks = tasks.filter(t => t.properties?.status === 'completed');
    const completionRate = tasks.length > 0 ? completedTasks.length / tasks.length : 0;

    const atRiskProjects = projects.filter(p =>
      p.properties?.status === 'at_risk' || p.properties?.health === 'poor'
    );

    // Financial metrics (from financial agent)
    let recentSpending = 0;
    let budgetStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    let savingsProgress = 0;

    try {
      const financialAgent = getAgent('financial');
      const summary = await (financialAgent as any).getFinancialSummary?.();
      if (summary) {
        recentSpending = summary.totalExpenses ?? 0;
        savingsProgress = summary.savingsRate ?? 0;
        const budgetUtilization = summary.budgetUtilization ?? 0;
        budgetStatus = budgetUtilization > 100 ? 'critical' :
                       budgetUtilization > 80 ? 'warning' : 'healthy';
      }
    } catch (e) {
      // Financial data not available
    }

    // Trading metrics (from trading agent)
    let portfolioValue = 0;
    let dailyPnL = 0;
    let openPositions = 0;
    let winRate = 0;

    try {
      const tradingAgent = getAgent('trading');
      const portfolio = await (tradingAgent as any).getPortfolioSummary?.();
      if (portfolio) {
        portfolioValue = portfolio.totalValue ?? 0;
        dailyPnL = portfolio.dailyPnL ?? 0;
        openPositions = portfolio.openPositions ?? 0;
        winRate = portfolio.winRate ?? 0;
      }
    } catch (e) {
      // Trading data not available
    }

    // Relationship metrics
    const people = store.getEntitiesByType('person', 500);
    const temporal = getTemporalEngine();

    let dormantConnections = 0;
    let recentInteractions = 0;
    let upcomingBirthdays = 0;

    for (const person of people) {
      const relevance = temporal.calculateRelevance(person);
      if (relevance < 0.3) dormantConnections++;
      if (relevance > 0.7) recentInteractions++;

      // Check for birthdays
      if (person.properties?.birthday) {
        const birthday = new Date(person.properties.birthday as string);
        const thisYear = new Date(now.getFullYear(), birthday.getMonth(), birthday.getDate());
        const daysUntil = Math.ceil((thisYear.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        if (daysUntil >= 0 && daysUntil <= 7) upcomingBirthdays++;
      }
    }

    // Research metrics
    const skills = store.getEntitiesByType('skill', 200);
    const documents = store.getEntitiesByType('document', 500);

    let activeTopics = 0;
    let knowledgeGaps = 0;
    let recentLearning = 0;

    for (const skill of skills) {
      const relevance = temporal.calculateRelevance(skill);
      if (relevance > 0.5) activeTopics++;
      if ((skill.properties?.proficiency as number ?? 50) < 50) knowledgeGaps++;
    }

    for (const doc of documents) {
      const age = (now.getTime() - new Date(doc.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      if (age < 7) recentLearning++;
    }

    return {
      tasksOverdue: overdueTasks.length,
      tasksDueToday: dueTodayTasks.length,
      projectsAtRisk: atRiskProjects.length,
      completionRate,
      recentSpending,
      budgetStatus,
      savingsProgress,
      portfolioValue,
      dailyPnL,
      openPositions,
      winRate,
      dormantConnections,
      recentInteractions,
      upcomingBirthdays,
      activeTopics,
      knowledgeGaps,
      recentLearning,
    };
  }

  // --------------------------------------------------------------------------
  // ENTITY HIGHLIGHTS
  // --------------------------------------------------------------------------

  private async aggregateEntityHighlights(): Promise<EntityHighlights> {
    const store = getOntologyStore();
    const temporal = getTemporalEngine();
    const now = new Date();

    // Get all entities and calculate relevance
    const allEntities: Entity[] = [];
    const entityTypes: EntityType[] = ['person', 'project', 'task', 'event', 'organization', 'document', 'trade', 'skill'];

    for (const type of entityTypes) {
      const entities = store.getEntitiesByType(type, 100);
      allEntities.push(...entities);
    }

    // Top relevant
    const withRelevance = allEntities.map(e => ({
      entity: e,
      relevance: temporal.calculateRelevance(e),
    }));

    const topRelevant = withRelevance
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10)
      .map(item => ({
        entity: item.entity,
        relevance: item.relevance,
        reason: this.getRelevanceReason(item.entity, item.relevance),
      }));

    // Needs attention
    const needsAttention: EntityHighlights['needsAttention'] = [];

    // Overdue tasks
    for (const entity of allEntities.filter(e => e.type === 'task')) {
      if (entity.properties?.status !== 'completed' && entity.properties?.dueDate) {
        const due = new Date(entity.properties.dueDate as string);
        if (due < now) {
          const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
          needsAttention.push({
            entity,
            urgency: daysOverdue > 7 ? 'critical' : daysOverdue > 3 ? 'high' : 'medium',
            reason: `Overdue by ${daysOverdue} days`,
          });
        }
      }
    }

    // At-risk projects
    for (const entity of allEntities.filter(e => e.type === 'project')) {
      if (entity.properties?.health === 'poor' || entity.properties?.status === 'at_risk') {
        needsAttention.push({
          entity,
          urgency: 'high',
          reason: 'Project health is poor',
        });
      }
    }

    // Dormant important relationships
    for (const entity of allEntities.filter(e => e.type === 'person')) {
      const relevance = temporal.calculateRelevance(entity);
      const relationships = store.getRelationships(entity.id);
      const isImportant = relationships.length > 5;

      if (isImportant && relevance < 0.2) {
        needsAttention.push({
          entity,
          urgency: 'low',
          reason: 'Important connection becoming dormant',
        });
      }
    }

    // Sort by urgency
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    needsAttention.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    // Recently modified
    const recentlyModified = allEntities
      .filter(e => {
        const age = (now.getTime() - new Date(e.updatedAt).getTime()) / (60 * 60 * 1000);
        return age < 24; // Last 24 hours
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10)
      .map(e => ({
        entity: e,
        modifiedAt: new Date(e.updatedAt),
        changeType: 'updated',
      }));

    return {
      topRelevant,
      needsAttention: needsAttention.slice(0, 20),
      recentlyModified,
    };
  }

  private getRelevanceReason(entity: Entity, relevance: number): string {
    if (relevance > 0.9) return 'Very recent activity';
    if (relevance > 0.7) return 'Recent activity';
    if (relevance > 0.5) return 'Moderately recent';
    return 'Background relevance';
  }

  // --------------------------------------------------------------------------
  // ALERTS AGGREGATION
  // --------------------------------------------------------------------------

  private async aggregateAlerts(): Promise<PrioritizedAlert[]> {
    const allAlerts = await getAllAlerts();
    const now = new Date();

    const prioritizedAlerts: PrioritizedAlert[] = allAlerts.map(alert => {
      const isAcknowledged = this.acknowledgedAlerts.has(alert.id);
      const snoozedUntil = this.snoozedAlerts.get(alert.id);
      const isSnoozed = snoozedUntil && snoozedUntil > now;

      // Calculate overall priority
      const urgencyScore = alert.priority / 10;
      const confidenceScore = 0.8; // Alerts don't have confidence, assume 0.8
      const recencyScore = 1; // All current alerts are recent

      const overallPriority = Math.round(
        (this.config.priorityWeights.urgency * urgencyScore +
         this.config.priorityWeights.confidence * confidenceScore +
         this.config.priorityWeights.recency * recencyScore) * 100
      );

      // Determine category
      let category: AlertCategory = 'informational';
      if (alert.priority >= 8) category = 'urgent';
      else if (alert.priority >= 5) category = 'important';
      else if (alert.actionable) category = 'proactive';

      return {
        ...alert,
        overallPriority,
        category,
        relatedAlerts: [],
        acknowledged: isAcknowledged,
        acknowledgedAt: isAcknowledged ? now : undefined,
        snoozedUntil: isSnoozed ? snoozedUntil : undefined,
      };
    });

    // Filter out snoozed alerts
    const activeAlerts = prioritizedAlerts.filter(a => {
      if (a.snoozedUntil && a.snoozedUntil > now) return false;
      return true;
    });

    // Sort by priority
    activeAlerts.sort((a, b) => b.overallPriority - a.overallPriority);

    return activeAlerts.slice(0, this.config.maxActiveAlerts);
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS AGGREGATION
  // --------------------------------------------------------------------------

  private async aggregateRecommendations(): Promise<PrioritizedRecommendation[]> {
    const allRecs = await getAllRecommendations();
    const now = new Date();

    const prioritizedRecs: PrioritizedRecommendation[] = allRecs.map(rec => {
      const isDismissed = this.dismissedRecommendations.has(rec.id);
      const isActed = this.actedRecommendations.has(rec.id);

      // Calculate overall score
      const impactScore = { high: 1, medium: 0.6, low: 0.3 }[rec.impact];
      const effortInverse = { high: 0.3, medium: 0.6, low: 1 }[rec.effort];
      const ageInHours = (now.getTime() - rec.createdAt.getTime()) / (60 * 60 * 1000);
      const recencyScore = Math.max(0, 1 - ageInHours / (this.config.recommendationRefreshHours * 2));

      const overallScore = Math.round(
        (impactScore * 0.4 +
         effortInverse * 0.3 +
         rec.confidence * 0.2 +
         recencyScore * 0.1) * 100
      );

      // Determine category
      let category: RecommendationCategory = 'maintenance';
      if (rec.impact === 'high' && rec.effort === 'low') category = 'quick_win';
      else if (rec.impact === 'high') category = 'strategic';
      else if (rec.type === 'learning') category = 'learning';
      else if (rec.type === 'relationship_maintenance' || rec.type === 'network_growth') category = 'relationship';

      return {
        ...rec,
        overallScore,
        category,
        relatedRecommendations: [],
        dismissed: isDismissed,
        dismissedAt: isDismissed ? now : undefined,
        acted: isActed,
        actedAt: isActed ? now : undefined,
      };
    });

    // Filter out dismissed
    const activeRecs = prioritizedRecs.filter(r => !r.dismissed);

    // Sort by score
    activeRecs.sort((a, b) => b.overallScore - a.overallScore);

    return activeRecs.slice(0, this.config.maxActiveRecommendations);
  }

  // --------------------------------------------------------------------------
  // INSIGHTS AGGREGATION
  // --------------------------------------------------------------------------

  private async aggregateInsights(): Promise<COPInsight[]> {
    const insights: COPInsight[] = [];

    // Gather from agents
    const agentInsights = await getAllInsights();
    for (const insight of agentInsights) {
      insights.push({
        id: insight.id,
        source: 'agent',
        sourceId: 'agent',
        type: insight.type,
        title: insight.title,
        description: insight.description,
        confidence: insight.confidence,
        timestamp: new Date(),
        relatedEntityIds: insight.relatedEntityIds,
        actionable: insight.actionable,
        actions: insight.suggestedAction ? [insight.suggestedAction] : undefined,
      });
    }

    // Gather from patterns
    const dynamicManager = getDynamicLayerManager();
    const patterns = dynamicManager.getPatterns({ minConfidence: 0.7 });
    for (const pattern of patterns.slice(0, 10)) {
      insights.push({
        id: `pattern-${pattern.id}`,
        source: 'pattern',
        sourceId: pattern.id,
        type: pattern.type === 'anomaly' ? 'warning' : 'neutral',
        title: pattern.name,
        description: pattern.description,
        confidence: pattern.confidence,
        timestamp: pattern.lastSeen,
        relatedEntityIds: pattern.relatedEntityIds,
        actionable: false,
      });
    }

    // Gather from predictions
    const predictions = await dynamicManager.getPredictions();
    for (const prediction of predictions.slice(0, 5)) {
      insights.push({
        id: `prediction-${prediction.id}`,
        source: 'prediction',
        sourceId: prediction.id,
        type: 'suggestion',
        title: `Predicted: ${prediction.description}`,
        description: prediction.description,
        confidence: prediction.confidence,
        timestamp: prediction.predictedAt,
        relatedEntityIds: prediction.relatedEntityIds,
        actionable: false,
      });
    }

    // Sort by confidence
    insights.sort((a, b) => b.confidence - a.confidence);

    return insights.slice(0, 30);
  }

  // --------------------------------------------------------------------------
  // AGENT STATUS
  // --------------------------------------------------------------------------

  private async aggregateAgentStatuses(): Promise<AgentStatus[]> {
    const agents = getAllAgents();

    return agents.map(agent => ({
      agentId: agent.id as any,
      name: agent.name,
      status: 'active' as const,
      lastActivity: new Date(),
      alertCount: agent.getAlerts().length,
      recommendationCount: agent.getRecommendations().length,
      insightCount: agent.getInsights().length,
      healthScore: 100, // Assume healthy
    }));
  }

  // --------------------------------------------------------------------------
  // SYSTEM HEALTH
  // --------------------------------------------------------------------------

  private async checkSystemHealth(): Promise<SystemHealth> {
    const components: SystemHealth['components'] = [];

    // Check ontology store
    try {
      const store = getOntologyStore();
      const testEntity = store.getEntitiesByType('person', 1);
      components.push({
        component: 'ontology_store',
        status: 'healthy',
        latency: 5,
      });
    } catch (e) {
      components.push({
        component: 'ontology_store',
        status: 'unhealthy',
        message: (e as Error).message,
      });
    }

    // Check temporal engine
    try {
      const temporal = getTemporalEngine();
      components.push({
        component: 'temporal_engine',
        status: 'healthy',
      });
    } catch (e) {
      components.push({
        component: 'temporal_engine',
        status: 'unhealthy',
        message: (e as Error).message,
      });
    }

    // Check knowledge graph
    try {
      const graph = getKnowledgeGraphEngine();
      components.push({
        component: 'knowledge_graph',
        status: 'healthy',
      });
    } catch (e) {
      components.push({
        component: 'knowledge_graph',
        status: 'unhealthy',
        message: (e as Error).message,
      });
    }

    // Check dynamic layer
    try {
      const dynamic = getDynamicLayerManager();
      components.push({
        component: 'dynamic_layer',
        status: 'healthy',
      });
    } catch (e) {
      components.push({
        component: 'dynamic_layer',
        status: 'unhealthy',
        message: (e as Error).message,
      });
    }

    // Calculate overall health
    const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;

    let overall: SystemHealth['overall'] = 'healthy';
    if (unhealthyCount > 0) overall = 'unhealthy';
    else if (degradedCount > 0) overall = 'degraded';

    return {
      overall,
      components,
      lastCheck: new Date(),
    };
  }

  // --------------------------------------------------------------------------
  // CONTEXT MANAGEMENT
  // --------------------------------------------------------------------------

  startContext(context: Omit<ActiveContext, 'id' | 'startedAt'>): string {
    const id = this.generateId();
    const activeContext: ActiveContext = {
      ...context,
      id,
      startedAt: new Date(),
    };

    this.activeContexts.set(id, activeContext);
    this.emit('context-started', activeContext);

    return id;
  }

  endContext(contextId: string): void {
    const context = this.activeContexts.get(contextId);
    if (context) {
      this.activeContexts.delete(contextId);
      this.emit('context-ended', context);
    }
  }

  getActiveContexts(): ActiveContext[] {
    return [...this.activeContexts.values()];
  }

  // --------------------------------------------------------------------------
  // ALERT MANAGEMENT
  // --------------------------------------------------------------------------

  acknowledgeAlert(alertId: string): void {
    this.acknowledgedAlerts.add(alertId);
    this.emit('alert-acknowledged', alertId);
  }

  snoozeAlert(alertId: string, minutes?: number): void {
    const snoozeMinutes = minutes ?? this.config.defaultSnoozeMinutes;
    const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60 * 1000);
    this.snoozedAlerts.set(alertId, snoozedUntil);
    this.emit('alert-snoozed', { alertId, snoozedUntil });
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATION MANAGEMENT
  // --------------------------------------------------------------------------

  dismissRecommendation(recId: string): void {
    this.dismissedRecommendations.add(recId);
    this.emit('recommendation-dismissed', recId);
  }

  markRecommendationActed(recId: string): void {
    this.actedRecommendations.add(recId);
    this.emit('recommendation-acted', recId);
  }

  // --------------------------------------------------------------------------
  // STATE ACCESS
  // --------------------------------------------------------------------------

  getState(): COPState | null {
    return this.state;
  }

  getSummary(): COPSummary | null {
    return this.state?.summary ?? null;
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private generateId(): string {
    return `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: StateAggregator | null = null;

export function getStateAggregator(): StateAggregator {
  if (!instance) {
    instance = new StateAggregator();
  }
  return instance;
}
