/**
 * Agent Types
 * Base types and interfaces for intelligence agents
 */

import { EntityType, RelationshipType, AgentContext, AgentResponse, AgentInsight, AgentAction } from '../types';

// ============================================================================
// AGENT CAPABILITY TYPES
// ============================================================================

export type AgentCapability =
  | 'entity_query'
  | 'relationship_query'
  | 'graph_traversal'
  | 'temporal_query'
  | 'pattern_detection'
  | 'prediction'
  | 'recommendation'
  | 'alert_generation'
  | 'action_execution';

// ============================================================================
// AGENT QUERY TYPES
// ============================================================================

export interface AgentQuery {
  /** Natural language query */
  query: string;
  /** Query intent (auto-detected or specified) */
  intent?: string;
  /** Entity types to focus on */
  entityTypes?: EntityType[];
  /** Time range for the query */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  /** Additional context */
  context?: Record<string, unknown>;
  /** Maximum results to return */
  limit?: number;
}

export interface AgentQueryResult {
  /** Direct answer to the query */
  answer: string;
  /** Confidence in the answer (0-1) */
  confidence: number;
  /** Supporting evidence */
  evidence: Array<{
    entityId: string;
    entityType: EntityType;
    relevance: number;
    snippet: string;
  }>;
  /** Related insights */
  insights: AgentInsight[];
  /** Suggested follow-up queries */
  followUpQueries: string[];
  /** Actions that can be taken */
  suggestedActions: AgentAction[];
}

// ============================================================================
// AGENT ALERT TYPES
// ============================================================================

export interface AgentAlert {
  id: string;
  agentId: string;
  type: 'info' | 'warning' | 'urgent' | 'opportunity';
  title: string;
  description: string;
  relatedEntities: string[];
  priority: number;
  actionable: boolean;
  suggestedActions: AgentAction[];
  createdAt: Date;
  expiresAt?: Date;
  dismissed: boolean;
}

// ============================================================================
// AGENT RECOMMENDATION TYPES
// ============================================================================

export interface AgentRecommendation {
  id: string;
  agentId: string;
  type: string;
  title: string;
  description: string;
  rationale: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  relatedEntities: string[];
  actions: AgentAction[];
  createdAt: Date;
}

// ============================================================================
// AGENT STATE
// ============================================================================

export interface AgentState {
  agentId: string;
  status: 'idle' | 'processing' | 'error';
  lastActiveAt: Date;
  queriesProcessed: number;
  alertsGenerated: number;
  recommendationsGenerated: number;
  errorCount: number;
  metrics: Record<string, number>;
}

// ============================================================================
// BASE AGENT INTERFACE
// ============================================================================

export interface IIntelligenceAgent {
  /** Unique agent identifier */
  id: string;
  /** Agent display name */
  name: string;
  /** Agent description */
  description: string;
  /** Agent capabilities */
  capabilities: AgentCapability[];
  /** Entity types this agent focuses on */
  focusEntities: EntityType[];

  /** Initialize the agent */
  initialize(): Promise<void>;

  /** Process a natural language query */
  processQuery(query: AgentQuery): Promise<AgentQueryResult>;

  /** Generate proactive insights */
  generateInsights(context: AgentContext): Promise<AgentInsight[]>;

  /** Generate alerts based on current state */
  generateAlerts(context: AgentContext): Promise<AgentAlert[]>;

  /** Generate recommendations */
  generateRecommendations(context: AgentContext): Promise<AgentRecommendation[]>;

  /** Execute an action */
  executeAction(action: AgentAction): Promise<AgentResponse>;

  /** Get current agent state */
  getState(): AgentState;

  /** Shutdown the agent */
  shutdown(): Promise<void>;
}

// ============================================================================
// AGENT CONFIG
// ============================================================================

export interface AgentConfig {
  /** Enable/disable the agent */
  enabled: boolean;
  /** Proactive insight generation interval (ms) */
  insightIntervalMs: number;
  /** Alert check interval (ms) */
  alertIntervalMs: number;
  /** Maximum concurrent queries */
  maxConcurrentQueries: number;
  /** Query timeout (ms) */
  queryTimeoutMs: number;
  /** Agent-specific settings */
  settings: Record<string, unknown>;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  enabled: true,
  insightIntervalMs: 300000, // 5 minutes
  alertIntervalMs: 60000, // 1 minute
  maxConcurrentQueries: 5,
  queryTimeoutMs: 30000, // 30 seconds
  settings: {},
};

// ============================================================================
// TRADING AGENT TYPES
// ============================================================================

export interface TradingInsight {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  timeframe: 'short' | 'medium' | 'long';
  signals: string[];
  risks: string[];
}

export interface PortfolioSummary {
  totalValue: number;
  currency: string;
  dailyPnL: number;
  dailyPnLPercent: number;
  positions: Array<{
    symbol: string;
    size: number;
    value: number;
    pnl: number;
    pnlPercent: number;
  }>;
  riskMetrics: {
    portfolioHeat: number;
    maxDrawdown: number;
    sharpeRatio: number;
  };
}

// ============================================================================
// PROJECT AGENT TYPES
// ============================================================================

export interface ProjectHealth {
  projectId: string;
  projectName: string;
  healthScore: number;
  status: 'on_track' | 'at_risk' | 'blocked' | 'completed';
  metrics: {
    tasksTotal: number;
    tasksCompleted: number;
    tasksPending: number;
    tasksOverdue: number;
    progressPercent: number;
    daysRemaining?: number;
  };
  risks: string[];
  blockers: string[];
  recommendations: string[];
}

export interface TaskPrioritization {
  tasks: Array<{
    taskId: string;
    taskName: string;
    priorityScore: number;
    factors: string[];
    suggestedDueDate?: Date;
  }>;
  rationale: string;
}

// ============================================================================
// FINANCIAL AGENT TYPES
// ============================================================================

export interface FinancialSummary {
  period: { start: Date; end: Date };
  income: number;
  expenses: number;
  netSavings: number;
  savingsRate: number;
  expenseBreakdown: Array<{
    category: string;
    amount: number;
    percent: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  insights: string[];
  warnings: string[];
}

export interface BudgetStatus {
  budgets: Array<{
    category: string;
    budgeted: number;
    spent: number;
    remaining: number;
    percentUsed: number;
    daysRemaining: number;
    projectedOverspend: number;
  }>;
  overallStatus: 'under_budget' | 'on_track' | 'over_budget';
}

// ============================================================================
// RELATIONSHIP AGENT TYPES
// ============================================================================

export interface RelationshipStrength {
  personId: string;
  personName: string;
  strength: number;
  interactions: number;
  lastInteraction?: Date;
  connectionTypes: string[];
  sharedEntities: Array<{
    entityId: string;
    entityType: EntityType;
    entityName: string;
  }>;
}

export interface NetworkAnalysis {
  totalConnections: number;
  strongConnections: number;
  weakConnections: number;
  dormantConnections: number;
  keyConnectors: Array<{
    personId: string;
    personName: string;
    centrality: number;
  }>;
  communities: Array<{
    name: string;
    members: string[];
    strength: number;
  }>;
}

// ============================================================================
// RESEARCH AGENT TYPES
// ============================================================================

export interface ResearchTopic {
  id: string;
  topic: string;
  sources: Array<{
    type: 'web' | 'document' | 'note' | 'conversation';
    title: string;
    url?: string;
    relevance: number;
  }>;
  summary: string;
  keyFindings: string[];
  relatedTopics: string[];
  lastUpdated: Date;
}

export interface KnowledgeGap {
  topic: string;
  description: string;
  importance: 'low' | 'medium' | 'high';
  suggestedSources: string[];
  relatedEntities: string[];
}
