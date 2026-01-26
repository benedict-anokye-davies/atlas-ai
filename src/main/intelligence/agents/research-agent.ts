/**
 * Research Intelligence Agent
 * Manages knowledge, research topics, and provides research insights
 */

import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction, DocumentEntity, SkillEntity } from '../types';
import { BaseIntelligenceAgent } from './base-agent';
import {
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  ResearchTopic,
  KnowledgeGap,
} from './types';

const logger = createModuleLogger('ResearchAgent');

// ============================================================================
// RESEARCH AGENT
// ============================================================================

export class ResearchAgent extends BaseIntelligenceAgent {
  id = 'research';
  name = 'Research Intelligence';
  description = 'Manages knowledge, tracks research topics, and identifies knowledge gaps';
  capabilities: AgentCapability[] = [
    'entity_query',
    'semantic_search',
    'graph_traversal',
    'pattern_detection',
    'recommendation',
    'alert_generation',
  ];
  focusEntities: EntityType[] = ['document', 'skill'];

  // --------------------------------------------------------------------------
  // QUERY HANDLING
  // --------------------------------------------------------------------------

  protected async handleQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const lowerQuery = query.query.toLowerCase();

    if (lowerQuery.includes('topic') || lowerQuery.includes('research') || lowerQuery.includes('studying')) {
      return this.handleTopicsQuery(query);
    }

    if (lowerQuery.includes('skill') || lowerQuery.includes('know how') || lowerQuery.includes('expertise')) {
      return this.handleSkillsQuery(query);
    }

    if (lowerQuery.includes('gap') || lowerQuery.includes('learn') || lowerQuery.includes('missing')) {
      return this.handleGapsQuery(query);
    }

    if (lowerQuery.includes('document') || lowerQuery.includes('resource') || lowerQuery.includes('source')) {
      return this.handleDocumentsQuery(query);
    }

    if (lowerQuery.includes('recommend') || lowerQuery.includes('suggest') || lowerQuery.includes('should learn')) {
      return this.handleLearningRecommendationQuery(query);
    }

    return this.handleGeneralQuery(query);
  }

  private async handleTopicsQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const topics = await this.getResearchTopics();

    const active = topics.filter(t => t.activityLevel > 0.5);
    const dormant = topics.filter(t => t.activityLevel <= 0.3);

    return {
      answer: `You have ${topics.length} research topic(s). ` +
        `Active: ${active.map(t => t.name).join(', ') || 'none'}. ` +
        `Dormant: ${dormant.map(t => t.name).join(', ') || 'none'}.`,
      confidence: 0.85,
      evidence: topics.slice(0, 5).map(t => ({
        entityId: t.id,
        entityType: 'skill' as EntityType,
        relevance: t.activityLevel,
        snippet: `${t.name}: ${t.documentCount} documents, ${t.relatedSkills.length} related skills`,
      })),
      insights: [],
      followUpQueries: [
        'What knowledge gaps do I have?',
        'What should I learn next?',
        'Show me my skills',
      ],
      suggestedActions: [],
    };
  }

  private async handleSkillsQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const skills = this.getSkills();

    const byProficiency = [...skills].sort((a, b) =>
      (b.properties?.proficiency as number ?? 0) - (a.properties?.proficiency as number ?? 0)
    );

    return {
      answer: `You have ${skills.length} skill(s) tracked. ` +
        `Top skills: ${byProficiency.slice(0, 5).map(s => s.name).join(', ')}`,
      confidence: 0.9,
      evidence: byProficiency.slice(0, 5).map(s => ({
        entityId: s.id,
        entityType: 'skill' as EntityType,
        relevance: (s.properties?.proficiency as number ?? 0) / 100,
        snippet: `${s.name}: ${s.properties?.proficiency ?? 'unknown'}% proficiency`,
      })),
      insights: [],
      followUpQueries: [
        'What should I improve?',
        'What gaps do I have?',
        'What topics am I researching?',
      ],
      suggestedActions: [],
    };
  }

  private async handleGapsQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const gaps = await this.identifyKnowledgeGaps();

    if (gaps.length === 0) {
      return {
        answer: 'I haven\'t identified any specific knowledge gaps yet. Add more documents and skills to get better insights.',
        confidence: 0.5,
        evidence: [],
        insights: [],
        followUpQueries: ['What skills do I have?', 'What topics am I researching?'],
        suggestedActions: [],
      };
    }

    return {
      answer: `I've identified ${gaps.length} knowledge gap(s):\n` +
        gaps.slice(0, 5).map(g => `- ${g.name}: ${g.description}`).join('\n'),
      confidence: 0.8,
      evidence: gaps.slice(0, 5).map(g => ({
        entityId: g.id,
        entityType: 'skill' as EntityType,
        relevance: g.priority,
        snippet: `${g.name}: ${g.suggestedResources.length} resources available`,
      })),
      insights: [{
        id: this.generateId(),
        type: 'suggestion',
        title: 'Learning Opportunity',
        description: `Priority gap: ${gaps[0]?.name ?? 'unknown'}`,
        confidence: 0.75,
        relatedEntityIds: gaps.slice(0, 3).map(g => g.id),
        actionable: true,
      }],
      followUpQueries: [
        'How do I fill these gaps?',
        'What resources can help?',
        'Create a learning plan',
      ],
      suggestedActions: gaps.slice(0, 3).map(g => ({
        type: 'start_learning',
        description: `Start learning ${g.name}`,
        parameters: { gapId: g.id },
      })),
    };
  }

  private async handleDocumentsQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const documents = this.getDocuments();
    const temporal = this.getTemporal();

    // Sort by recency
    const recent = documents
      .map(d => ({ doc: d, relevance: temporal.calculateRelevance(d) }))
      .sort((a, b) => b.relevance - a.relevance);

    // Group by type
    const byType = documents.reduce((acc, d) => {
      const type = d.properties?.documentType as string ?? 'unknown';
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      answer: `You have ${documents.length} document(s). ` +
        `Types: ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')}. ` +
        `Recent: ${recent.slice(0, 3).map(r => r.doc.name).join(', ')}`,
      confidence: 0.85,
      evidence: recent.slice(0, 5).map(r => ({
        entityId: r.doc.id,
        entityType: 'document' as EntityType,
        relevance: r.relevance,
        snippet: `${r.doc.name} (${r.doc.properties?.documentType ?? 'document'})`,
      })),
      insights: [],
      followUpQueries: [
        'Find documents about a topic',
        'What have I read recently?',
        'Recommend reading material',
      ],
      suggestedActions: [],
    };
  }

  private async handleLearningRecommendationQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const gaps = await this.identifyKnowledgeGaps();
    const skills = this.getSkills();

    // Find skills that need improvement
    const toImprove = skills
      .filter(s => (s.properties?.proficiency as number ?? 0) < 70)
      .slice(0, 5);

    const recommendations: string[] = [];

    if (gaps.length > 0) {
      recommendations.push(`Fill knowledge gap: ${gaps[0]?.name}`);
    }

    if (toImprove.length > 0) {
      recommendations.push(`Improve skill: ${toImprove[0]?.name}`);
    }

    // Add related skills to current research
    const topics = await this.getResearchTopics();
    const activeTopics = topics.filter(t => t.activityLevel > 0.5);

    for (const topic of activeTopics.slice(0, 2)) {
      for (const relatedSkill of topic.relatedSkills.slice(0, 2)) {
        const hasSkill = skills.some(s => s.id === relatedSkill);
        if (!hasSkill) {
          const skillEntity = this.getStore().getEntity(relatedSkill);
          if (skillEntity) {
            recommendations.push(`Learn related skill: ${skillEntity.name}`);
          }
        }
      }
    }

    return {
      answer: recommendations.length > 0
        ? `Learning recommendations:\n${recommendations.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : 'Keep up your current learning! I don\'t have specific recommendations right now.',
      confidence: 0.75,
      evidence: [],
      insights: [],
      followUpQueries: [
        'Create a learning plan',
        'What resources do I have?',
        'Track my progress',
      ],
      suggestedActions: recommendations.slice(0, 3).map(r => ({
        type: 'create_learning_goal',
        description: r,
        parameters: {},
      })),
    };
  }

  private async handleGeneralQuery(query: AgentQuery): Promise<AgentQueryResult> {
    return {
      answer: 'I can help with knowledge management and research. Try asking about your topics, skills, knowledge gaps, or documents.',
      confidence: 0.5,
      evidence: [],
      insights: [],
      followUpQueries: [
        'What topics am I researching?',
        'What are my skills?',
        'What knowledge gaps do I have?',
        'Show my documents',
      ],
      suggestedActions: [],
    };
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  protected async computeInsights(context: AgentContext): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const topics = await this.getResearchTopics();
    const skills = this.getSkills();

    // Active research momentum
    const activeTopics = topics.filter(t => t.activityLevel > 0.5);
    if (activeTopics.length > 0) {
      insights.push({
        id: this.generateId(),
        type: 'positive',
        title: 'Research Momentum',
        description: `You're actively researching ${activeTopics.length} topic(s): ${activeTopics.map(t => t.name).join(', ')}`,
        confidence: 0.85,
        relatedEntityIds: activeTopics.map(t => t.id),
        actionable: false,
      });
    }

    // Skill growth
    const recentSkills = skills.filter(s => {
      const created = new Date(s.createdAt);
      const daysSince = (Date.now() - created.getTime()) / (24 * 60 * 60 * 1000);
      return daysSince < 30;
    });

    if (recentSkills.length > 0) {
      insights.push({
        id: this.generateId(),
        type: 'positive',
        title: 'Skill Growth',
        description: `You've added ${recentSkills.length} new skill(s) in the last 30 days`,
        confidence: 0.9,
        relatedEntityIds: recentSkills.map(s => s.id),
        actionable: false,
      });
    }

    // Knowledge concentration
    const topicCounts = topics.map(t => t.documentCount);
    const maxDocs = Math.max(...topicCounts, 1);
    const avgDocs = topicCounts.reduce((a, b) => a + b, 0) / (topics.length || 1);

    if (maxDocs > avgDocs * 3 && topics.length > 3) {
      const dominant = topics.find(t => t.documentCount === maxDocs);
      if (dominant) {
        insights.push({
          id: this.generateId(),
          type: 'suggestion',
          title: 'Knowledge Concentration',
          description: `Most of your research is in "${dominant.name}". Consider diversifying.`,
          confidence: 0.7,
          relatedEntityIds: [dominant.id],
          actionable: true,
        });
      }
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  protected async computeAlerts(context: AgentContext): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];
    const topics = await this.getResearchTopics();

    // Dormant research topics
    const dormant = topics.filter(t => t.activityLevel < 0.2);

    for (const topic of dormant.slice(0, 3)) {
      alerts.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'info',
        title: 'Dormant Research',
        description: `"${topic.name}" hasn't had activity recently`,
        relatedEntities: [topic.id],
        priority: 3,
        actionable: true,
        suggestedActions: [{
          type: 'resume_research',
          description: `Resume research on ${topic.name}`,
          parameters: { topicId: topic.id },
        }],
        createdAt: new Date(),
        dismissed: false,
      });
    }

    // Review needed for old documents
    const documents = this.getDocuments();
    const oldDocuments = documents.filter(d => {
      const age = (Date.now() - new Date(d.createdAt).getTime()) / (24 * 60 * 60 * 1000);
      return age > 90 && !(d.properties?.reviewed as boolean);
    });

    if (oldDocuments.length > 5) {
      alerts.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'info',
        title: 'Documents Need Review',
        description: `${oldDocuments.length} document(s) haven't been reviewed in 90+ days`,
        relatedEntities: oldDocuments.slice(0, 5).map(d => d.id),
        priority: 2,
        actionable: true,
        suggestedActions: [{
          type: 'review_documents',
          description: 'Schedule document review session',
          parameters: { documentIds: oldDocuments.slice(0, 10).map(d => d.id) },
        }],
        createdAt: new Date(),
        dismissed: false,
      });
    }

    return alerts;
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  protected async computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];
    const gaps = await this.identifyKnowledgeGaps();
    const topics = await this.getResearchTopics();

    // Address knowledge gaps
    for (const gap of gaps.slice(0, 2)) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'learning',
        title: `Learn ${gap.name}`,
        description: gap.description,
        rationale: `This will ${gap.reason}`,
        confidence: 0.8,
        impact: 'high',
        effort: 'medium',
        relatedEntities: gap.relatedSkills,
        actions: gap.suggestedResources.slice(0, 3).map(r => ({
          type: 'use_resource',
          description: `Use resource: ${r}`,
          parameters: { resource: r },
        })),
        createdAt: new Date(),
      });
    }

    // Deep dive active topics
    const activeTopics = topics.filter(t => t.activityLevel > 0.5);
    for (const topic of activeTopics.slice(0, 1)) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'research',
        title: `Deep Dive: ${topic.name}`,
        description: `Continue building expertise in ${topic.name}`,
        rationale: 'You have momentum in this area',
        confidence: 0.75,
        impact: 'medium',
        effort: 'low',
        relatedEntities: [topic.id, ...topic.relatedSkills],
        actions: [{
          type: 'find_resources',
          description: 'Find advanced resources',
          parameters: { topicId: topic.id },
        }],
        createdAt: new Date(),
      });
    }

    // Cross-pollination
    if (topics.length >= 2) {
      const [topic1, topic2] = topics.slice(0, 2);
      if (topic1 && topic2) {
        recommendations.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'synthesis',
          title: 'Cross-Pollination',
          description: `Explore connections between ${topic1.name} and ${topic2.name}`,
          rationale: 'Novel insights often emerge at the intersection of fields',
          confidence: 0.65,
          impact: 'high',
          effort: 'high',
          relatedEntities: [topic1.id, topic2.id],
          actions: [{
            type: 'explore_connections',
            description: 'Map connections between topics',
            parameters: { topic1Id: topic1.id, topic2Id: topic2.id },
          }],
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  protected async handleAction(action: AgentAction): Promise<AgentResponse> {
    switch (action.type) {
      case 'start_learning':
        return {
          success: true,
          message: 'Learning goal created',
        };

      case 'resume_research':
        return {
          success: true,
          message: 'Research topic marked as active',
        };

      case 'review_documents':
        return {
          success: true,
          message: 'Document review session scheduled',
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

  private getSkills(): SkillEntity[] {
    const store = this.getStore();
    return store.getEntitiesByType('skill', 500) as SkillEntity[];
  }

  private getDocuments(): DocumentEntity[] {
    const store = this.getStore();
    return store.getEntitiesByType('document', 500) as DocumentEntity[];
  }

  async getResearchTopics(): Promise<ResearchTopic[]> {
    const store = this.getStore();
    const skills = this.getSkills();
    const documents = this.getDocuments();
    const temporal = this.getTemporal();
    const graph = this.getGraph();

    const topics: ResearchTopic[] = [];

    // Build topics from skills and their related documents
    for (const skill of skills) {
      const skillRelationships = store.getRelationships(skill.id);
      const relatedDocIds = skillRelationships
        .filter(r => r.relationshipType === 'DOCUMENTS' || r.relationshipType === 'RELATED_TO')
        .map(r => r.targetId);

      const relatedDocs = documents.filter(d => relatedDocIds.includes(d.id));
      const recentActivity = temporal.calculateRelevance(skill);

      // Get related skills via graph
      const neighbors = await graph.getNeighbors(skill.id, { entityTypes: ['skill'], maxDepth: 1 });
      const relatedSkillIds = neighbors.filter(n => n !== skill.id);

      topics.push({
        id: skill.id,
        name: skill.name,
        description: skill.properties?.description as string ?? '',
        relatedSkills: relatedSkillIds,
        documentCount: relatedDocs.length,
        lastActivity: skill.updatedAt,
        activityLevel: recentActivity,
      });
    }

    return topics.sort((a, b) => b.activityLevel - a.activityLevel);
  }

  async identifyKnowledgeGaps(): Promise<KnowledgeGap[]> {
    const skills = this.getSkills();
    const topics = await this.getResearchTopics();
    const graph = this.getGraph();

    const gaps: KnowledgeGap[] = [];

    // Find skills mentioned in relationships but not tracked
    const store = this.getStore();
    const allRelationships = skills.flatMap(s => store.getRelationships(s.id));

    for (const rel of allRelationships) {
      if (rel.relationshipType === 'REQUIRES' || rel.relationshipType === 'PREREQUISITE') {
        const targetSkill = store.getEntity(rel.targetId);
        if (targetSkill && !skills.some(s => s.id === targetSkill.id)) {
          // This is a required skill we don't have
          gaps.push({
            id: targetSkill.id,
            name: targetSkill.name,
            description: `Required for ${rel.sourceId}`,
            reason: 'improve related skills',
            priority: 0.8,
            relatedSkills: [rel.sourceId],
            suggestedResources: [],
          });
        }
      }
    }

    // Find low-proficiency skills
    for (const skill of skills) {
      const proficiency = skill.properties?.proficiency as number ?? 50;
      if (proficiency < 50) {
        gaps.push({
          id: skill.id,
          name: skill.name,
          description: `Low proficiency (${proficiency}%)`,
          reason: 'strengthen fundamentals',
          priority: (50 - proficiency) / 100 + 0.5,
          relatedSkills: [],
          suggestedResources: [],
        });
      }
    }

    // Find isolated topics
    for (const topic of topics) {
      if (topic.relatedSkills.length === 0 && topic.documentCount < 3) {
        gaps.push({
          id: topic.id,
          name: topic.name,
          description: 'Isolated topic with little supporting material',
          reason: 'build connections and depth',
          priority: 0.6,
          relatedSkills: [],
          suggestedResources: [],
        });
      }
    }

    return gaps.sort((a, b) => b.priority - a.priority);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: ResearchAgent | null = null;

export function getResearchAgent(): ResearchAgent {
  if (!instance) {
    instance = new ResearchAgent();
  }
  return instance;
}
