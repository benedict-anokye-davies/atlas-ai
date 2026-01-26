/**
 * Intelligence Agents Module
 * Specialized AI agents for different intelligence domains
 */

export * from './types';
export * from './base-agent';
export * from './trading-agent';
export * from './project-agent';
export * from './financial-agent';
export * from './relationship-agent';
export * from './research-agent';

import { createModuleLogger } from '../../utils/logger';
import { TradingAgent, getTradingAgent } from './trading-agent';
import { ProjectAgent, getProjectAgent } from './project-agent';
import { FinancialAgent, getFinancialAgent } from './financial-agent';
import { RelationshipAgent, getRelationshipAgent } from './relationship-agent';
import { ResearchAgent, getResearchAgent } from './research-agent';
import { IIntelligenceAgent, AgentQuery, AgentQueryResult, AgentAlert, AgentRecommendation, AgentInsight } from './types';
import { AgentContext } from '../types';

const logger = createModuleLogger('IntelligenceAgents');

// ============================================================================
// AGENT REGISTRY
// ============================================================================

export interface AgentRegistry {
  trading: TradingAgent;
  project: ProjectAgent;
  financial: FinancialAgent;
  relationship: RelationshipAgent;
  research: ResearchAgent;
}

export type AgentId = keyof AgentRegistry;

let registry: AgentRegistry | null = null;
let initialized = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

export async function initializeAgents(): Promise<void> {
  if (initialized) {
    logger.debug('Agents already initialized');
    return;
  }

  logger.info('Initializing intelligence agents...');

  try {
    registry = {
      trading: getTradingAgent(),
      project: getProjectAgent(),
      financial: getFinancialAgent(),
      relationship: getRelationshipAgent(),
      research: getResearchAgent(),
    };

    // Initialize all agents
    await Promise.all([
      registry.trading.initialize(),
      registry.project.initialize(),
      registry.financial.initialize(),
      registry.relationship.initialize(),
      registry.research.initialize(),
    ]);

    initialized = true;
    logger.info('Intelligence agents initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize intelligence agents:', error as Record<string, unknown>);
    throw error;
  }
}

export async function shutdownAgents(): Promise<void> {
  if (!initialized || !registry) {
    return;
  }

  logger.info('Shutting down intelligence agents...');

  await Promise.all([
    registry.trading.shutdown(),
    registry.project.shutdown(),
    registry.financial.shutdown(),
    registry.relationship.shutdown(),
    registry.research.shutdown(),
  ]);

  initialized = false;
  logger.info('Intelligence agents shut down');
}

// ============================================================================
// AGENT ACCESS
// ============================================================================

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    throw new Error('Agents not initialized. Call initializeAgents() first.');
  }
  return registry;
}

export function getAgent<K extends AgentId>(agentId: K): AgentRegistry[K] {
  return getAgentRegistry()[agentId];
}

export function getAllAgents(): IIntelligenceAgent[] {
  const reg = getAgentRegistry();
  return [reg.trading, reg.project, reg.financial, reg.relationship, reg.research];
}

// ============================================================================
// UNIFIED QUERY INTERFACE
// ============================================================================

export interface UnifiedQueryResult {
  agentId: AgentId;
  result: AgentQueryResult;
}

/**
 * Route a query to the most appropriate agent
 */
export async function routeQuery(query: AgentQuery): Promise<UnifiedQueryResult> {
  const lowerQuery = query.query.toLowerCase();

  // Route based on keywords
  if (containsAny(lowerQuery, ['trade', 'trading', 'portfolio', 'position', 'pnl', 'profit', 'loss', 'stock', 'crypto'])) {
    const result = await getAgent('trading').processQuery(query);
    return { agentId: 'trading', result };
  }

  if (containsAny(lowerQuery, ['project', 'task', 'deadline', 'sprint', 'milestone', 'blocked', 'overdue'])) {
    const result = await getAgent('project').processQuery(query);
    return { agentId: 'project', result };
  }

  if (containsAny(lowerQuery, ['spend', 'budget', 'money', 'expense', 'income', 'savings', 'financial', 'bank'])) {
    const result = await getAgent('financial').processQuery(query);
    return { agentId: 'financial', result };
  }

  if (containsAny(lowerQuery, ['contact', 'person', 'relationship', 'network', 'colleague', 'friend', 'who'])) {
    const result = await getAgent('relationship').processQuery(query);
    return { agentId: 'relationship', result };
  }

  if (containsAny(lowerQuery, ['research', 'topic', 'skill', 'learn', 'knowledge', 'document', 'gap'])) {
    const result = await getAgent('research').processQuery(query);
    return { agentId: 'research', result };
  }

  // Default to project agent for general queries
  const result = await getAgent('project').processQuery(query);
  return { agentId: 'project', result };
}

/**
 * Query all agents and combine results
 */
export async function queryAllAgents(query: AgentQuery): Promise<Map<AgentId, AgentQueryResult>> {
  const agents = getAllAgents();
  const results = new Map<AgentId, AgentQueryResult>();

  await Promise.all(
    agents.map(async (agent) => {
      try {
        const result = await agent.processQuery(query);
        results.set(agent.id as AgentId, result);
      } catch (error) {
        logger.error(`Error querying agent ${agent.id}:`, error as Record<string, unknown>);
      }
    })
  );

  return results;
}

// ============================================================================
// UNIFIED ALERTS AND RECOMMENDATIONS
// ============================================================================

/**
 * Get all alerts from all agents
 */
export async function getAllAlerts(): Promise<AgentAlert[]> {
  const agents = getAllAgents();
  const allAlerts: AgentAlert[] = [];

  for (const agent of agents) {
    const alerts = agent.getAlerts();
    allAlerts.push(...alerts);
  }

  // Sort by priority descending
  return allAlerts.sort((a, b) => b.priority - a.priority);
}

/**
 * Get all recommendations from all agents
 */
export async function getAllRecommendations(): Promise<AgentRecommendation[]> {
  const agents = getAllAgents();
  const allRecs: AgentRecommendation[] = [];

  for (const agent of agents) {
    const recs = agent.getRecommendations();
    allRecs.push(...recs);
  }

  // Sort by impact and confidence
  return allRecs.sort((a, b) => {
    const impactOrder = { high: 3, medium: 2, low: 1 };
    const aScore = impactOrder[a.impact] * a.confidence;
    const bScore = impactOrder[b.impact] * b.confidence;
    return bScore - aScore;
  });
}

/**
 * Get all insights from all agents
 */
export async function getAllInsights(): Promise<AgentInsight[]> {
  const agents = getAllAgents();
  const allInsights: AgentInsight[] = [];

  for (const agent of agents) {
    const insights = agent.getInsights();
    allInsights.push(...insights);
  }

  // Sort by confidence descending
  return allInsights.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// AGENT STATUS
// ============================================================================

export interface AgentStatus {
  id: AgentId;
  name: string;
  initialized: boolean;
  alertCount: number;
  recommendationCount: number;
  insightCount: number;
}

export function getAgentStatuses(): AgentStatus[] {
  if (!registry) {
    return [];
  }

  return [
    {
      id: 'trading',
      name: registry.trading.name,
      initialized: true,
      alertCount: registry.trading.getAlerts().length,
      recommendationCount: registry.trading.getRecommendations().length,
      insightCount: registry.trading.getInsights().length,
    },
    {
      id: 'project',
      name: registry.project.name,
      initialized: true,
      alertCount: registry.project.getAlerts().length,
      recommendationCount: registry.project.getRecommendations().length,
      insightCount: registry.project.getInsights().length,
    },
    {
      id: 'financial',
      name: registry.financial.name,
      initialized: true,
      alertCount: registry.financial.getAlerts().length,
      recommendationCount: registry.financial.getRecommendations().length,
      insightCount: registry.financial.getInsights().length,
    },
    {
      id: 'relationship',
      name: registry.relationship.name,
      initialized: true,
      alertCount: registry.relationship.getAlerts().length,
      recommendationCount: registry.relationship.getRecommendations().length,
      insightCount: registry.relationship.getInsights().length,
    },
    {
      id: 'research',
      name: registry.research.name,
      initialized: true,
      alertCount: registry.research.getAlerts().length,
      recommendationCount: registry.research.getRecommendations().length,
      insightCount: registry.research.getInsights().length,
    },
  ];
}

// ============================================================================
// HELPERS
// ============================================================================

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some(kw => text.includes(kw));
}
