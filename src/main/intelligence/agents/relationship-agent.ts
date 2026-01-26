/**
 * Relationship Intelligence Agent
 * Analyzes relationships, network, and provides relationship insights
 */

import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction, PersonEntity } from '../types';
import { BaseIntelligenceAgent } from './base-agent';
import {
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  RelationshipStrength,
  NetworkAnalysis,
} from './types';

const logger = createModuleLogger('RelationshipAgent');

// ============================================================================
// RELATIONSHIP AGENT
// ============================================================================

export class RelationshipAgent extends BaseIntelligenceAgent {
  id = 'relationship';
  name = 'Relationship Intelligence';
  description = 'Analyzes relationships, social network, and provides relationship insights';
  capabilities: AgentCapability[] = [
    'entity_query',
    'relationship_query',
    'graph_traversal',
    'pattern_detection',
    'recommendation',
    'alert_generation',
  ];
  focusEntities: EntityType[] = ['person', 'organization'];

  // --------------------------------------------------------------------------
  // QUERY HANDLING
  // --------------------------------------------------------------------------

  protected async handleQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const lowerQuery = query.query.toLowerCase();

    if (lowerQuery.includes('network') || lowerQuery.includes('connections')) {
      return this.handleNetworkQuery(query);
    }

    if (lowerQuery.includes('who') && (lowerQuery.includes('know') || lowerQuery.includes('connect'))) {
      return this.handleConnectionQuery(query);
    }

    if (lowerQuery.includes('haven\'t') || lowerQuery.includes('not contacted') || lowerQuery.includes('dormant')) {
      return this.handleDormantQuery(query);
    }

    if (lowerQuery.includes('introduce') || lowerQuery.includes('mutual')) {
      return this.handleMutualConnectionQuery(query);
    }

    if (lowerQuery.includes('colleague') || lowerQuery.includes('coworker') || lowerQuery.includes('work with')) {
      return this.handleColleagueQuery(query);
    }

    return this.handleGeneralQuery(query);
  }

  private async handleNetworkQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const analysis = await this.analyzeNetwork();

    return {
      answer: `Your network has ${analysis.totalConnections} connections. ` +
        `${analysis.strongConnections} strong, ${analysis.weakConnections} weak, ${analysis.dormantConnections} dormant. ` +
        `Key connectors: ${analysis.keyConnectors.slice(0, 3).map(c => c.personName).join(', ')}`,
      confidence: 0.85,
      evidence: analysis.keyConnectors.slice(0, 5).map(c => ({
        entityId: c.personId,
        entityType: 'person' as EntityType,
        relevance: c.centrality,
        snippet: `${c.personName} (centrality: ${c.centrality.toFixed(2)})`,
      })),
      insights: [],
      followUpQueries: [
        'Who haven\'t I contacted recently?',
        'Who are my strongest connections?',
        'Who could introduce me to new people?',
      ],
      suggestedActions: [],
    };
  }

  private async handleConnectionQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const people = this.getPeople();
    const relationships = this.getRelationshipStrengths();

    const strong = relationships.filter(r => r.strength > 0.7);

    return {
      answer: `You have ${people.length} people in your network. ` +
        `Your strongest connections are: ${strong.slice(0, 5).map(r => r.personName).join(', ')}`,
      confidence: 0.9,
      evidence: strong.slice(0, 5).map(r => ({
        entityId: r.personId,
        entityType: 'person' as EntityType,
        relevance: r.strength,
        snippet: `${r.personName}: ${r.interactions} interactions, ${r.connectionTypes.join(', ')}`,
      })),
      insights: [],
      followUpQueries: ['Tell me more about my network', 'Who should I reconnect with?'],
      suggestedActions: [],
    };
  }

  private async handleDormantQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const relationships = this.getRelationshipStrengths();
    const dormant = relationships.filter(r => {
      if (!r.lastInteraction) return true;
      const daysSince = (Date.now() - r.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);
      return daysSince > 30;
    });

    return {
      answer: dormant.length > 0
        ? `You have ${dormant.length} dormant connection(s) you haven't contacted in 30+ days: ${dormant.slice(0, 5).map(d => d.personName).join(', ')}`
        : 'You\'ve been in touch with all your connections recently. Great networking!',
      confidence: 0.9,
      evidence: dormant.slice(0, 5).map(d => ({
        entityId: d.personId,
        entityType: 'person' as EntityType,
        relevance: 1,
        snippet: `${d.personName}: Last contact ${d.lastInteraction ? this.formatDaysAgo(d.lastInteraction) : 'never'}`,
      })),
      insights: dormant.length > 3 ? [{
        id: this.generateId(),
        type: 'suggestion',
        title: 'Network Maintenance',
        description: 'Several connections are going dormant. Consider reaching out.',
        confidence: 0.85,
        relatedEntityIds: dormant.slice(0, 5).map(d => d.personId),
        actionable: true,
      }] : [],
      followUpQueries: ['Who should I prioritize?', 'Draft a message to reconnect'],
      suggestedActions: dormant.slice(0, 3).map(d => ({
        type: 'reach_out',
        description: `Reach out to ${d.personName}`,
        parameters: { personId: d.personId },
      })),
    };
  }

  private async handleMutualConnectionQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const graph = this.getGraph();
    const people = this.getPeople();

    // Find people who could make introductions
    const connectors: Array<{ person: PersonEntity; connections: number }> = [];

    for (const person of people) {
      const neighbors = await graph.getNeighbors(person.id, { entityTypes: ['person'] });
      connectors.push({ person, connections: neighbors.length });
    }

    connectors.sort((a, b) => b.connections - a.connections);
    const topConnectors = connectors.slice(0, 5);

    return {
      answer: `Your best connected contacts who might make introductions: ` +
        topConnectors.map(c => `${c.person.name} (${c.connections} connections)`).join(', '),
      confidence: 0.8,
      evidence: topConnectors.map(c => ({
        entityId: c.person.id,
        entityType: 'person' as EntityType,
        relevance: c.connections / (topConnectors[0]?.connections || 1),
        snippet: `${c.person.name}: ${c.connections} mutual connections`,
      })),
      insights: [],
      followUpQueries: ['Who do they know that I don\'t?', 'Who should I ask for an introduction?'],
      suggestedActions: [],
    };
  }

  private async handleColleagueQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const store = this.getStore();
    const people = this.getPeople();

    // Find people with COLLEAGUE or WORKS_AT relationships
    const colleagues: PersonEntity[] = [];

    for (const person of people) {
      const relationships = store.getRelationships(person.id);
      const isColleague = relationships.some(r =>
        r.relationshipType === 'COLLEAGUE' ||
        r.relationshipType === 'WORKS_AT' ||
        r.relationshipType === 'MANAGED_BY' ||
        r.relationshipType === 'MANAGES'
      );

      if (isColleague) {
        colleagues.push(person);
      }
    }

    return {
      answer: colleagues.length > 0
        ? `You have ${colleagues.length} colleague(s): ${colleagues.slice(0, 5).map(c => c.name).join(', ')}${colleagues.length > 5 ? '...' : ''}`
        : 'I don\'t have any colleagues tracked yet. Add some work contacts!',
      confidence: 0.9,
      evidence: colleagues.slice(0, 5).map(c => ({
        entityId: c.id,
        entityType: 'person' as EntityType,
        relevance: 1,
        snippet: `${c.name} - ${c.properties?.title ?? 'Colleague'}`,
      })),
      insights: [],
      followUpQueries: ['Who do I work closest with?', 'Show my work network'],
      suggestedActions: [],
    };
  }

  private async handleGeneralQuery(query: AgentQuery): Promise<AgentQueryResult> {
    return {
      answer: 'I can help analyze your relationships and network. Try asking about your network, connections, or who to reconnect with.',
      confidence: 0.5,
      evidence: [],
      insights: [],
      followUpQueries: [
        'Who are my strongest connections?',
        'Who haven\'t I contacted recently?',
        'Analyze my network',
      ],
      suggestedActions: [],
    };
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  protected async computeInsights(context: AgentContext): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const relationships = this.getRelationshipStrengths();

    // Network health
    const strong = relationships.filter(r => r.strength > 0.7);
    const dormant = relationships.filter(r => {
      if (!r.lastInteraction) return true;
      const daysSince = (Date.now() - r.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);
      return daysSince > 30;
    });

    if (dormant.length > relationships.length * 0.3) {
      insights.push({
        id: this.generateId(),
        type: 'warning',
        title: 'Network Health',
        description: `${((dormant.length / relationships.length) * 100).toFixed(0)}% of your connections are dormant`,
        confidence: 0.85,
        relatedEntityIds: dormant.slice(0, 5).map(d => d.personId),
        actionable: true,
        suggestedAction: {
          type: 'batch_reach_out',
          description: 'Schedule time to reconnect with dormant contacts',
          parameters: { personIds: dormant.slice(0, 10).map(d => d.personId) },
        },
      });
    }

    // Key relationship reminder
    const importantDormant = dormant.filter(d =>
      strong.some(s => s.personId === d.personId)
    );

    if (importantDormant.length > 0) {
      insights.push({
        id: this.generateId(),
        type: 'suggestion',
        title: 'Important Connections',
        description: `${importantDormant.length} important connection(s) you haven't contacted recently: ${importantDormant.map(d => d.personName).join(', ')}`,
        confidence: 0.9,
        relatedEntityIds: importantDormant.map(d => d.personId),
        actionable: true,
      });
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  protected async computeAlerts(context: AgentContext): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];
    const relationships = this.getRelationshipStrengths();

    // Birthday alerts (would need birthdate data)
    const today = new Date();
    for (const rel of relationships) {
      const person = this.getStore().getEntity(rel.personId) as PersonEntity | null;
      if (person?.properties?.birthday) {
        const birthday = new Date(person.properties.birthday as string);
        const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
        const daysUntil = Math.ceil((thisYearBirthday.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

        if (daysUntil === 0) {
          alerts.push({
            id: this.generateId(),
            agentId: this.id,
            type: 'info',
            title: 'Birthday Today!',
            description: `It's ${person.name}'s birthday today`,
            relatedEntities: [person.id],
            priority: 7,
            actionable: true,
            suggestedActions: [{
              type: 'send_birthday_message',
              description: 'Send birthday wishes',
              parameters: { personId: person.id },
            }],
            createdAt: new Date(),
            dismissed: false,
          });
        } else if (daysUntil > 0 && daysUntil <= 3) {
          alerts.push({
            id: this.generateId(),
            agentId: this.id,
            type: 'info',
            title: 'Upcoming Birthday',
            description: `${person.name}'s birthday is in ${daysUntil} day(s)`,
            relatedEntities: [person.id],
            priority: 5,
            actionable: false,
            suggestedActions: [],
            createdAt: new Date(),
            dismissed: false,
          });
        }
      }
    }

    // Long dormant important connections
    for (const rel of relationships) {
      if (rel.strength > 0.6 && rel.lastInteraction) {
        const daysSince = (Date.now() - rel.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSince > 60) {
          alerts.push({
            id: this.generateId(),
            agentId: this.id,
            type: 'warning',
            title: 'Connection Fading',
            description: `You haven't been in touch with ${rel.personName} for ${Math.floor(daysSince)} days`,
            relatedEntities: [rel.personId],
            priority: 4,
            actionable: true,
            suggestedActions: [{
              type: 'reach_out',
              description: `Reconnect with ${rel.personName}`,
              parameters: { personId: rel.personId },
            }],
            createdAt: new Date(),
            dismissed: false,
          });
        }
      }
    }

    return alerts;
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  protected async computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];
    const analysis = await this.analyzeNetwork();

    // Network expansion
    if (analysis.totalConnections < 50) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'network_growth',
        title: 'Expand Your Network',
        description: `Your network has ${analysis.totalConnections} connections`,
        rationale: 'A larger network provides more opportunities and perspectives',
        confidence: 0.75,
        impact: 'medium',
        effort: 'medium',
        relatedEntities: [],
        actions: [{
          type: 'find_new_connections',
          description: 'Attend networking events or reach out to second-degree connections',
          parameters: {},
        }],
        createdAt: new Date(),
      });
    }

    // Strengthen weak ties
    const relationships = this.getRelationshipStrengths();
    const weak = relationships.filter(r => r.strength > 0.3 && r.strength < 0.5);

    if (weak.length > 5) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'relationship_maintenance',
        title: 'Strengthen Weak Ties',
        description: `${weak.length} connections could be strengthened`,
        rationale: 'Weak ties often provide valuable new information and opportunities',
        confidence: 0.7,
        impact: 'medium',
        effort: 'low',
        relatedEntities: weak.slice(0, 10).map(w => w.personId),
        actions: [{
          type: 'batch_reach_out',
          description: 'Schedule coffee chats or quick calls',
          parameters: { personIds: weak.slice(0, 5).map(w => w.personId) },
        }],
        createdAt: new Date(),
      });
    }

    // Community building
    if (analysis.communities.length < 3) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'community_diversity',
        title: 'Diversify Your Network',
        description: 'Your network is concentrated in few communities',
        rationale: 'Diverse networks provide more varied perspectives and opportunities',
        confidence: 0.65,
        impact: 'high',
        effort: 'high',
        relatedEntities: [],
        actions: [{
          type: 'join_community',
          description: 'Join groups or communities outside your usual circles',
          parameters: {},
        }],
        createdAt: new Date(),
      });
    }

    return recommendations;
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  protected async handleAction(action: AgentAction): Promise<AgentResponse> {
    switch (action.type) {
      case 'reach_out':
        const person = this.getStore().getEntity(action.parameters?.personId as string);
        return {
          success: true,
          message: person
            ? `Reminder set to reach out to ${person.name}`
            : 'Person not found',
        };

      case 'batch_reach_out':
        return {
          success: true,
          message: 'Batch reconnection task created',
        };

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private getPeople(): PersonEntity[] {
    const store = this.getStore();
    return store.getEntitiesByType('person', 500) as PersonEntity[];
  }

  private getRelationshipStrengths(): RelationshipStrength[] {
    const store = this.getStore();
    const people = this.getPeople();
    const temporal = this.getTemporal();

    return people.map(person => {
      const relationships = store.getRelationships(person.id);
      const incomingRelationships = store.getIncomingRelationships(person.id);
      const allRelationships = [...relationships, ...incomingRelationships];

      const connectionTypes = [...new Set(allRelationships.map(r => r.relationshipType))];
      const interactionCount = allRelationships.length;

      // Calculate strength based on relationship count and recency
      const relevance = temporal.calculateRelevance(person);
      const strength = Math.min(1, (interactionCount / 10) * 0.5 + relevance * 0.5);

      // Get last interaction
      const sortedRels = allRelationships.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const lastInteraction = sortedRels[0]
        ? new Date(sortedRels[0].createdAt)
        : undefined;

      // Get shared entities
      const sharedEntities: RelationshipStrength['sharedEntities'] = [];
      for (const rel of relationships.slice(0, 5)) {
        const target = store.getEntity(rel.targetId);
        if (target && target.type !== 'person') {
          sharedEntities.push({
            entityId: target.id,
            entityType: target.type,
            entityName: target.name,
          });
        }
      }

      return {
        personId: person.id,
        personName: person.name,
        strength,
        interactions: interactionCount,
        lastInteraction,
        connectionTypes,
        sharedEntities,
      };
    });
  }

  async analyzeNetwork(): Promise<NetworkAnalysis> {
    const relationships = this.getRelationshipStrengths();
    const graph = this.getGraph();

    const strong = relationships.filter(r => r.strength > 0.7);
    const weak = relationships.filter(r => r.strength > 0.3 && r.strength <= 0.7);
    const dormant = relationships.filter(r => {
      if (!r.lastInteraction) return true;
      const daysSince = (Date.now() - r.lastInteraction.getTime()) / (24 * 60 * 60 * 1000);
      return daysSince > 30;
    });

    // Calculate centrality
    const centrality = await graph.calculateCentrality({ algorithm: 'degree', normalized: true });

    const keyConnectors = relationships
      .map(r => ({
        personId: r.personId,
        personName: r.personName,
        centrality: centrality.get(r.personId) ?? 0,
      }))
      .sort((a, b) => b.centrality - a.centrality)
      .slice(0, 10);

    // Detect communities
    const communities = await graph.detectCommunities();
    const personCommunities = communities
      .filter(c => c.nodes.some(n => relationships.some(r => r.personId === n)))
      .map(c => ({
        name: `Community ${c.id}`,
        members: c.nodes.filter(n => relationships.some(r => r.personId === n)),
        strength: c.density,
      }));

    return {
      totalConnections: relationships.length,
      strongConnections: strong.length,
      weakConnections: weak.length,
      dormantConnections: dormant.length,
      keyConnectors,
      communities: personCommunities,
    };
  }

  private formatDaysAgo(date: Date): string {
    const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: RelationshipAgent | null = null;

export function getRelationshipAgent(): RelationshipAgent {
  if (!instance) {
    instance = new RelationshipAgent();
  }
  return instance;
}
