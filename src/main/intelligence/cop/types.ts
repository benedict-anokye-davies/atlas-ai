/**
 * COP (Common Operating Picture) Types
 * Types for state aggregation, alerts, and unified dashboard
 */

import { EntityType, Entity, AgentInsight, AgentAction } from '../types';
import { AgentAlert, AgentRecommendation, AgentId } from '../agents/types';
import { Pattern, Prediction } from '../dynamic/types';

// ============================================================================
// COP STATE TYPES
// ============================================================================

export interface COPState {
  timestamp: Date;
  lastUpdated: Date;

  // Aggregated metrics
  summary: COPSummary;

  // Entity highlights
  entities: EntityHighlights;

  // Alerts and notifications
  alerts: PrioritizedAlert[];

  // Recommendations
  recommendations: PrioritizedRecommendation[];

  // Insights
  insights: COPInsight[];

  // Agent statuses
  agentStatuses: AgentStatus[];

  // Active contexts
  contexts: ActiveContext[];

  // Health indicators
  health: SystemHealth;
}

export interface COPSummary {
  // Task/Project status
  tasksOverdue: number;
  tasksDueToday: number;
  projectsAtRisk: number;
  completionRate: number;

  // Financial status
  recentSpending: number;
  budgetStatus: 'healthy' | 'warning' | 'critical';
  savingsProgress: number;

  // Trading status
  portfolioValue: number;
  dailyPnL: number;
  openPositions: number;
  winRate: number;

  // Relationships
  dormantConnections: number;
  recentInteractions: number;
  upcomingBirthdays: number;

  // Research
  activeTopics: number;
  knowledgeGaps: number;
  recentLearning: number;
}

export interface EntityHighlights {
  // Most relevant entities right now
  topRelevant: Array<{
    entity: Entity;
    relevance: number;
    reason: string;
  }>;

  // Entities needing attention
  needsAttention: Array<{
    entity: Entity;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  }>;

  // Recently modified
  recentlyModified: Array<{
    entity: Entity;
    modifiedAt: Date;
    changeType: string;
  }>;
}

// ============================================================================
// ALERT TYPES
// ============================================================================

export interface PrioritizedAlert extends AgentAlert {
  overallPriority: number;      // 0-100 computed priority
  category: AlertCategory;
  relatedAlerts: string[];      // IDs of related alerts
  acknowledged: boolean;
  acknowledgedAt?: Date;
  snoozedUntil?: Date;
}

export type AlertCategory =
  | 'urgent'          // Requires immediate action
  | 'important'       // Significant but not time-critical
  | 'informational'   // FYI notifications
  | 'proactive';      // Suggestions for improvement

export interface AlertFilter {
  categories?: AlertCategory[];
  agentIds?: AgentId[];
  minPriority?: number;
  includeAcknowledged?: boolean;
  includeSnoozed?: boolean;
}

// ============================================================================
// RECOMMENDATION TYPES
// ============================================================================

export interface PrioritizedRecommendation extends AgentRecommendation {
  overallScore: number;         // 0-100 computed score
  category: RecommendationCategory;
  relatedRecommendations: string[];
  dismissed: boolean;
  dismissedAt?: Date;
  acted: boolean;
  actedAt?: Date;
}

export type RecommendationCategory =
  | 'quick_win'       // Low effort, high impact
  | 'strategic'       // High effort, high impact
  | 'maintenance'     // Regular upkeep
  | 'learning'        // Skill/knowledge improvement
  | 'relationship';   // Social/network improvement

export interface RecommendationFilter {
  categories?: RecommendationCategory[];
  agentIds?: AgentId[];
  minScore?: number;
  maxEffort?: 'low' | 'medium' | 'high';
  includeDismissed?: boolean;
}

// ============================================================================
// INSIGHT TYPES
// ============================================================================

export interface COPInsight {
  id: string;
  source: 'agent' | 'pattern' | 'prediction' | 'analysis';
  sourceId: string;            // Agent ID, pattern ID, etc.
  type: 'positive' | 'negative' | 'neutral' | 'warning' | 'suggestion';
  title: string;
  description: string;
  confidence: number;
  timestamp: Date;
  relatedEntityIds: string[];
  actionable: boolean;
  actions?: AgentAction[];
}

// ============================================================================
// AGENT STATUS TYPES
// ============================================================================

export interface AgentStatus {
  agentId: AgentId;
  name: string;
  status: 'active' | 'idle' | 'error';
  lastActivity: Date;
  alertCount: number;
  recommendationCount: number;
  insightCount: number;
  healthScore: number;         // 0-100
}

// ============================================================================
// CONTEXT TYPES
// ============================================================================

export interface ActiveContext {
  id: string;
  type: ContextType;
  name: string;
  description: string;
  startedAt: Date;
  relatedEntityIds: string[];
  priority: number;
  metadata: Record<string, unknown>;
}

export type ContextType =
  | 'work_session'    // Active work session
  | 'meeting'         // In a meeting
  | 'focus_time'      // Deep work mode
  | 'research'        // Research mode
  | 'planning'        // Planning session
  | 'review';         // Review/retrospective

// ============================================================================
// HEALTH TYPES
// ============================================================================

export interface SystemHealth {
  overall: HealthLevel;
  components: ComponentHealth[];
  lastCheck: Date;
}

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  component: string;
  status: HealthLevel;
  latency?: number;
  errorRate?: number;
  message?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface COPConfig {
  // Update intervals
  updateIntervalMs: number;
  alertCheckIntervalMs: number;

  // Alert settings
  maxActiveAlerts: number;
  alertRetentionDays: number;
  defaultSnoozeMinutes: number;

  // Recommendation settings
  maxActiveRecommendations: number;
  recommendationRefreshHours: number;

  // Priority calculation weights
  priorityWeights: {
    urgency: number;
    impact: number;
    confidence: number;
    recency: number;
  };

  // Notification settings
  notificationThreshold: number;    // Min priority to notify
  quietHoursStart?: number;         // Hour (0-23)
  quietHoursEnd?: number;
}

export const DEFAULT_COP_CONFIG: COPConfig = {
  updateIntervalMs: 60000,          // 1 minute
  alertCheckIntervalMs: 30000,      // 30 seconds

  maxActiveAlerts: 100,
  alertRetentionDays: 30,
  defaultSnoozeMinutes: 60,

  maxActiveRecommendations: 50,
  recommendationRefreshHours: 6,

  priorityWeights: {
    urgency: 0.35,
    impact: 0.30,
    confidence: 0.20,
    recency: 0.15,
  },

  notificationThreshold: 70,
  quietHoursStart: 22,
  quietHoursEnd: 7,
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type COPEventType =
  | 'state_updated'
  | 'alert_created'
  | 'alert_acknowledged'
  | 'alert_snoozed'
  | 'recommendation_created'
  | 'recommendation_acted'
  | 'recommendation_dismissed'
  | 'insight_generated'
  | 'context_started'
  | 'context_ended';

export interface COPEvent {
  type: COPEventType;
  timestamp: Date;
  data: unknown;
}
