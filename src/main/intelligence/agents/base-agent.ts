/**
 * Base Intelligence Agent
 * Abstract base class for all intelligence agents
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction } from '../types';
import { getOntologyStore } from '../ontology/ontology-store';
import { getKnowledgeGraphEngine } from '../knowledge-graph/knowledge-graph-engine';
import { getTemporalEngine } from '../temporal/temporal-engine';
import {
  IIntelligenceAgent,
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  AgentState,
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
} from './types';

const logger = createModuleLogger('BaseAgent');

// ============================================================================
// BASE AGENT IMPLEMENTATION
// ============================================================================

export abstract class BaseIntelligenceAgent extends EventEmitter implements IIntelligenceAgent {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract capabilities: AgentCapability[];
  abstract focusEntities: EntityType[];

  protected config: AgentConfig;
  protected state: AgentState;
  protected insightInterval?: NodeJS.Timeout;
  protected alertInterval?: NodeJS.Timeout;

  constructor(config?: Partial<AgentConfig>) {
    super();
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.state = {
      agentId: '',
      status: 'idle',
      lastActiveAt: new Date(),
      queriesProcessed: 0,
      alertsGenerated: 0,
      recommendationsGenerated: 0,
      errorCount: 0,
      metrics: {},
    };
  }

  // --------------------------------------------------------------------------
  // LIFECYCLE
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.state.agentId = this.id;
    this.state.status = 'idle';
    this.state.lastActiveAt = new Date();

    // Start proactive insight generation
    if (this.config.enabled && this.config.insightIntervalMs > 0) {
      this.insightInterval = setInterval(
        () => this.runProactiveInsights(),
        this.config.insightIntervalMs
      );
    }

    // Start alert checking
    if (this.config.enabled && this.config.alertIntervalMs > 0) {
      this.alertInterval = setInterval(
        () => this.runAlertCheck(),
        this.config.alertIntervalMs
      );
    }

    logger.info(`Agent ${this.id} initialized`);
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (this.insightInterval) {
      clearInterval(this.insightInterval);
    }
    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }

    this.state.status = 'idle';
    logger.info(`Agent ${this.id} shut down`);
    this.emit('shutdown');
  }

  // --------------------------------------------------------------------------
  // QUERY PROCESSING
  // --------------------------------------------------------------------------

  async processQuery(query: AgentQuery): Promise<AgentQueryResult> {
    this.state.status = 'processing';
    this.state.lastActiveAt = new Date();

    try {
      const result = await this.handleQuery(query);
      this.state.queriesProcessed++;
      this.state.status = 'idle';
      return result;
    } catch (error) {
      this.state.errorCount++;
      this.state.status = 'error';
      logger.error(`Agent ${this.id} query error:`, error);

      return {
        answer: 'Sorry, I encountered an error processing your query.',
        confidence: 0,
        evidence: [],
        insights: [],
        followUpQueries: [],
        suggestedActions: [],
      };
    }
  }

  /**
   * Abstract method to handle queries - implemented by subclasses
   */
  protected abstract handleQuery(query: AgentQuery): Promise<AgentQueryResult>;

  // --------------------------------------------------------------------------
  // INSIGHT GENERATION
  // --------------------------------------------------------------------------

  async generateInsights(context: AgentContext): Promise<AgentInsight[]> {
    this.state.status = 'processing';

    try {
      const insights = await this.computeInsights(context);
      this.state.status = 'idle';

      for (const insight of insights) {
        this.emit('insight', insight);
      }

      return insights;
    } catch (error) {
      this.state.errorCount++;
      this.state.status = 'error';
      logger.error(`Agent ${this.id} insight generation error:`, error);
      return [];
    }
  }

  /**
   * Abstract method to compute insights - implemented by subclasses
   */
  protected abstract computeInsights(context: AgentContext): Promise<AgentInsight[]>;

  private async runProactiveInsights(): Promise<void> {
    const context = await this.buildContext();
    const insights = await this.generateInsights(context);

    if (insights.length > 0) {
      logger.debug(`Agent ${this.id} generated ${insights.length} proactive insights`);
    }
  }

  // --------------------------------------------------------------------------
  // ALERT GENERATION
  // --------------------------------------------------------------------------

  async generateAlerts(context: AgentContext): Promise<AgentAlert[]> {
    this.state.status = 'processing';

    try {
      const alerts = await this.computeAlerts(context);
      this.state.alertsGenerated += alerts.length;
      this.state.status = 'idle';

      for (const alert of alerts) {
        this.emit('alert', alert);
      }

      return alerts;
    } catch (error) {
      this.state.errorCount++;
      this.state.status = 'error';
      logger.error(`Agent ${this.id} alert generation error:`, error);
      return [];
    }
  }

  /**
   * Abstract method to compute alerts - implemented by subclasses
   */
  protected abstract computeAlerts(context: AgentContext): Promise<AgentAlert[]>;

  private async runAlertCheck(): Promise<void> {
    const context = await this.buildContext();
    const alerts = await this.generateAlerts(context);

    if (alerts.length > 0) {
      logger.debug(`Agent ${this.id} generated ${alerts.length} alerts`);
    }
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  async generateRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    this.state.status = 'processing';

    try {
      const recommendations = await this.computeRecommendations(context);
      this.state.recommendationsGenerated += recommendations.length;
      this.state.status = 'idle';

      for (const rec of recommendations) {
        this.emit('recommendation', rec);
      }

      return recommendations;
    } catch (error) {
      this.state.errorCount++;
      this.state.status = 'error';
      logger.error(`Agent ${this.id} recommendation generation error:`, error);
      return [];
    }
  }

  /**
   * Abstract method to compute recommendations - implemented by subclasses
   */
  protected abstract computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]>;

  // --------------------------------------------------------------------------
  // ACTION EXECUTION
  // --------------------------------------------------------------------------

  async executeAction(action: AgentAction): Promise<AgentResponse> {
    this.state.status = 'processing';
    this.state.lastActiveAt = new Date();

    try {
      const response = await this.handleAction(action);
      this.state.status = 'idle';
      return response;
    } catch (error) {
      this.state.errorCount++;
      this.state.status = 'error';
      logger.error(`Agent ${this.id} action execution error:`, error);

      return {
        success: false,
        message: 'Action execution failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Abstract method to handle actions - implemented by subclasses
   */
  protected abstract handleAction(action: AgentAction): Promise<AgentResponse>;

  // --------------------------------------------------------------------------
  // STATE & CONTEXT
  // --------------------------------------------------------------------------

  getState(): AgentState {
    return { ...this.state };
  }

  protected async buildContext(): Promise<AgentContext> {
    const store = getOntologyStore();

    // Get relevant entities for this agent
    let recentEntities: string[] = [];
    for (const entityType of this.focusEntities) {
      const entities = store.getEntitiesByType(entityType, 10);
      recentEntities.push(...entities.map(e => e.id));
    }

    return {
      timestamp: new Date(),
      recentEntityIds: recentEntities,
      userPreferences: {},
      environmentState: {
        timeOfDay: this.getTimeOfDay(),
        dayOfWeek: new Date().getDay(),
      },
    };
  }

  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  protected getStore() {
    return getOntologyStore();
  }

  protected getGraph() {
    return getKnowledgeGraphEngine();
  }

  protected getTemporal() {
    return getTemporalEngine();
  }

  protected generateId(): string {
    return `${this.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
