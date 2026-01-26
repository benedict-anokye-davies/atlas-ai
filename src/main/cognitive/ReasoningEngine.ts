/**
 * ReasoningEngine.ts
 * 
 * Inference and reasoning layer for JARVIS's brain.
 * Enables pattern detection, logical inference, and Q&A capabilities.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { KnowledgeGraphDB, GraphNode, EdgeType, NodeType } from './KnowledgeGraphDB';
import { AssociativeMemory } from './AssociativeMemory';

const logger = createModuleLogger('ReasoningEngine');

// ============================================================================
// Types
// ============================================================================

export interface InferenceResult {
  type: 'derived' | 'analogical' | 'causal' | 'temporal';
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  explanation: string;
  supportingFacts: string[];
}

export interface PatternMatch {
  pattern: string;
  instances: GraphNode[];
  frequency: number;
  confidence: number;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
  confidence: number;
  sources: GraphNode[];
  reasoning: string;
}

export interface ReasoningContext {
  recentTopics: string[];
  activeFacts: GraphNode[];
  conversationFacts: Map<string, unknown>;
}

// ============================================================================
// ReasoningEngine Class
// ============================================================================

export class ReasoningEngine extends EventEmitter {
  private graph: KnowledgeGraphDB;
  private memory: AssociativeMemory;
  private context: ReasoningContext;
  
  constructor(graph: KnowledgeGraphDB, memory: AssociativeMemory) {
    super();
    this.graph = graph;
    this.memory = memory;
    this.context = {
      recentTopics: [],
      activeFacts: [],
      conversationFacts: new Map(),
    };
  }
  
  // ==========================================================================
  // Inference
  // ==========================================================================
  
  /**
   * Derive new facts from existing knowledge using inference rules
   */
  async deriveInferences(fromNode: GraphNode): Promise<InferenceResult[]> {
    const inferences: InferenceResult[] = [];
    
    try {
      const content = JSON.parse(fromNode.content);
      const { subject, predicate, object } = content;
      
      // Transitivity inference
      const transitiveInferences = await this.inferTransitive(subject, predicate, object);
      inferences.push(...transitiveInferences);
      
      // Inverse inference
      const inverseInference = this.inferInverse(subject, predicate, object);
      if (inverseInference) inferences.push(inverseInference);
      
      // Category inference
      const categoryInferences = await this.inferFromCategory(subject, predicate, object);
      inferences.push(...categoryInferences);
      
    } catch {
      // Non-SPO content, skip inference
    }
    
    return inferences.filter(i => i.confidence > 0.3);
  }
  
  /**
   * Transitive inference: if A→B and B→C, then A→C
   */
  private async inferTransitive(subject: string, predicate: string, object: string): Promise<InferenceResult[]> {
    const inferences: InferenceResult[] = [];
    
    // Find facts where our object is the subject
    const continuations = await this.graph.findBySubjectPredicate(object, predicate);
    
    for (const cont of continuations) {
      try {
        const contContent = JSON.parse(cont.content);
        inferences.push({
          type: 'derived',
          subject,
          predicate,
          object: contContent.object,
          confidence: cont.confidence * 0.7, // Decay confidence through chain
          explanation: `If ${subject} ${predicate} ${object}, and ${object} ${predicate} ${contContent.object}, then ${subject} ${predicate} ${contContent.object}`,
          supportingFacts: [JSON.stringify({ subject, predicate, object }), cont.content],
        });
      } catch {
        // Skip malformed content
      }
    }
    
    return inferences;
  }
  
  /**
   * Inverse relation inference
   */
  private inferInverse(subject: string, predicate: string, object: string): InferenceResult | null {
    // Define inverse relationships
    const inverses: Record<string, string> = {
      'is parent of': 'is child of',
      'is child of': 'is parent of',
      'causes': 'is caused by',
      'is caused by': 'causes',
      'contains': 'is part of',
      'is part of': 'contains',
      'follows': 'precedes',
      'precedes': 'follows',
      'works for': 'employs',
      'employs': 'works for',
    };
    
    const inversePredicate = inverses[predicate.toLowerCase()];
    if (!inversePredicate) return null;
    
    return {
      type: 'derived',
      subject: object,
      predicate: inversePredicate,
      object: subject,
      confidence: 0.9, // High confidence for logical inverses
      explanation: `If ${subject} ${predicate} ${object}, then ${object} ${inversePredicate} ${subject}`,
      supportingFacts: [JSON.stringify({ subject, predicate, object })],
    };
  }
  
  /**
   * Infer properties from category membership
   */
  private async inferFromCategory(subject: string, predicate: string, object: string): Promise<InferenceResult[]> {
    const inferences: InferenceResult[] = [];
    
    // If subject is instance of category, inherit category properties
    if (predicate.toLowerCase() === 'is a' || predicate.toLowerCase() === 'is an') {
      // Find properties of the category
      const categoryFacts = await this.graph.findBySubjectPredicate(object, '');
      
      for (const fact of categoryFacts.slice(0, 5)) {
        try {
          const factContent = JSON.parse(fact.content);
          // Don't inherit identity relations
          if (factContent.predicate.toLowerCase().startsWith('is a')) continue;
          
          inferences.push({
            type: 'derived',
            subject,
            predicate: factContent.predicate,
            object: factContent.object,
            confidence: fact.confidence * 0.5, // Lower confidence for category inheritance
            explanation: `${subject} is a ${object}, and ${object} ${factContent.predicate} ${factContent.object}`,
            supportingFacts: [JSON.stringify({ subject, predicate, object }), fact.content],
          });
        } catch {
          // Skip malformed
        }
      }
    }
    
    return inferences;
  }
  
  // ==========================================================================
  // Analogical Reasoning
  // ==========================================================================
  
  /**
   * Find analogies: if A is to B as C is to D
   */
  async findAnalogies(conceptA: string, conceptB: string): Promise<Array<{ concept: string; analog: string; score: number }>> {
    const analogies: Array<{ concept: string; analog: string; score: number }> = [];
    
    // Get the relationship between A and B
    const conceptAId = await this.getNodeIdForConcept(conceptA);
    const conceptBId = await this.getNodeIdForConcept(conceptB);
    const edgesFromA = await this.graph.getEdgesFrom(conceptAId);
    const aToBEdge = edgesFromA.find(e => e.targetId === conceptBId);
    
    if (!aToBEdge) return analogies;
    
    // Find similar relationships in the graph
    const allNodes = (await this.graph.search({ query: '*', limit: 100 }));
    
    for (const node of allNodes) {
      const edges = await this.graph.getEdgesFrom(node.id);
      
      for (const edge of edges) {
        if (edge.type === aToBEdge.type && edge.id !== aToBEdge.id) {
          const targetNode = await this.graph.getNode(edge.targetId);
          if (targetNode) {
            analogies.push({
              concept: node.label,
              analog: targetNode.label,
              score: edge.weight * node.confidence,
            });
          }
        }
      }
    }
    
    return analogies.sort((a, b) => b.score - a.score).slice(0, 10);
  }
  
  private async getNodeIdForConcept(concept: string): Promise<string> {
    const nodes = await this.graph.search({ query: concept, limit: 1 });
    return nodes[0]?.id || '';
  }
  
  // ==========================================================================
  // Causal Reasoning
  // ==========================================================================
  
  /**
   * Find causal chains: what causes what?
   */
  async findCausalChain(fromConcept: string, toConcept: string): Promise<string[] | null> {
    const fromNodes = await this.graph.search({ query: fromConcept, limit: 5 });
    const toNodes = await this.graph.search({ query: toConcept, limit: 5 });
    
    if (fromNodes.length === 0 || toNodes.length === 0) return null;
    
    // Try to find a path through causal relationships
    for (const fromNode of fromNodes) {
      for (const toNode of toNodes) {
        const path = await this.graph.findPath(fromNode.id, toNode.id, 5);
        if (path) {
          return path.map(n => n.label);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Predict effects of an action or event
   */
  async predictEffects(action: string): Promise<Array<{ effect: string; confidence: number }>> {
    const effects: Array<{ effect: string; confidence: number }> = [];
    
    // Search for facts about this action
    const actionNodes = await this.graph.search({ query: action, limit: 10 });
    
    for (const node of actionNodes) {
      // Get outgoing causal edges
      const edges = await this.graph.getEdgesFrom(node.id);
      
      for (const edge of edges) {
        if (edge.type === 'causes' || edge.type === 'related_to') {
          const effectNode = await this.graph.getNode(edge.targetId);
          if (effectNode) {
            effects.push({
              effect: effectNode.label,
              confidence: edge.weight * effectNode.confidence,
            });
          }
        }
      }
    }
    
    return effects.sort((a, b) => b.confidence - a.confidence);
  }
  
  // ==========================================================================
  // Pattern Detection
  // ==========================================================================
  
  /**
   * Detect recurring patterns in the knowledge graph
   */
  async detectPatterns(): Promise<PatternMatch[]> {
    const patterns: PatternMatch[] = [];
    
    // Find frequently co-occurring concept types
    const stats = await this.graph.getStats();
    const graph = await this.graph.getFullGraph({ limit: 200 });
    
    // Group by edge types
    const edgePatterns: Map<string, GraphNode[][]> = new Map();
    
    for (const edge of graph.edges) {
      const sourceNode = graph.nodes.find(n => n.id === edge.sourceId);
      const targetNode = graph.nodes.find(n => n.id === edge.targetId);
      
      if (sourceNode && targetNode) {
        const pattern = `${sourceNode.type}-[${edge.type}]-${targetNode.type}`;
        const instances = edgePatterns.get(pattern) || [];
        instances.push([sourceNode, targetNode]);
        edgePatterns.set(pattern, instances);
      }
    }
    
    // Convert to pattern matches
    for (const [pattern, instances] of edgePatterns) {
      if (instances.length >= 2) {
        patterns.push({
          pattern,
          instances: instances.flat(),
          frequency: instances.length,
          confidence: Math.min(1, instances.length / 10),
        });
      }
    }
    
    return patterns.sort((a, b) => b.frequency - a.frequency);
  }
  
  /**
   * Find anomalies in the knowledge graph
   */
  async findAnomalies(): Promise<GraphNode[]> {
    const anomalies: GraphNode[] = [];
    const stats = await this.graph.getStats();
    
    // Find isolated nodes (no edges)
    const graph = await this.graph.getFullGraph({ limit: 500 });
    const connectedIds = new Set<string>();
    
    for (const edge of graph.edges) {
      connectedIds.add(edge.sourceId);
      connectedIds.add(edge.targetId);
    }
    
    for (const node of graph.nodes) {
      if (!connectedIds.has(node.id) && node.confidence > 0.5) {
        anomalies.push(node);
      }
    }
    
    return anomalies;
  }
  
  // ==========================================================================
  // Question Answering
  // ==========================================================================
  
  /**
   * Answer a question using the knowledge graph
   */
  async answerQuestion(question: string): Promise<QuestionAnswer | null> {
    // Parse question type
    const qLower = question.toLowerCase();
    
    // Extract key concepts from question
    const concepts = this.extractConcepts(question);
    
    if (concepts.length === 0) {
      return null;
    }
    
    // Search for relevant nodes
    const relevantNodes: GraphNode[] = [];
    for (const concept of concepts) {
      const nodes = await this.graph.search({ query: concept, limit: 10 });
      relevantNodes.push(...nodes);
    }
    
    if (relevantNodes.length === 0) {
      return null;
    }
    
    // Activate concepts in associative memory
    await this.memory.activate(concepts);
    
    // Try to answer based on question type
    if (qLower.startsWith('what is') || qLower.startsWith("what's")) {
      return this.answerWhatIs(concepts[0], relevantNodes);
    }
    
    if (qLower.startsWith('who is') || qLower.startsWith("who's")) {
      return this.answerWhoIs(concepts[0], relevantNodes);
    }
    
    if (qLower.startsWith('where')) {
      return this.answerWhere(concepts, relevantNodes);
    }
    
    if (qLower.startsWith('when')) {
      return this.answerWhen(concepts, relevantNodes);
    }
    
    if (qLower.startsWith('why')) {
      return this.answerWhy(concepts, relevantNodes);
    }
    
    if (qLower.startsWith('how')) {
      return this.answerHow(concepts, relevantNodes);
    }
    
    // Generic answer using highest confidence nodes
    const bestNode = relevantNodes.sort((a, b) => b.confidence - a.confidence)[0];
    
    return {
      question,
      answer: bestNode.content,
      confidence: bestNode.confidence,
      sources: [bestNode],
      reasoning: `Found relevant information about "${concepts.join(', ')}"`,
    };
  }
  
  private extractConcepts(text: string): string[] {
    // Simple concept extraction - remove common words
    const stopWords = new Set(['what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'the', 'a', 'an', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'about', 'like']);
    
    const words = text.toLowerCase()
      .replace(/[?!.,]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    
    return words;
  }
  
  private async answerWhatIs(concept: string, nodes: GraphNode[]): Promise<QuestionAnswer> {
    // Look for definition-like content
    const definitionNode = nodes.find(n => 
      n.type === 'concept' || n.type === 'knowledge' || n.type === 'fact'
    );
    
    if (definitionNode) {
      try {
        const content = JSON.parse(definitionNode.content);
        return {
          question: `What is ${concept}?`,
          answer: `${content.subject} ${content.predicate} ${content.object}`,
          confidence: definitionNode.confidence,
          sources: [definitionNode],
          reasoning: 'Found definition in knowledge base',
        };
      } catch {
        return {
          question: `What is ${concept}?`,
          answer: definitionNode.content,
          confidence: definitionNode.confidence,
          sources: [definitionNode],
          reasoning: 'Found relevant information',
        };
      }
    }
    
    return {
      question: `What is ${concept}?`,
      answer: `I don't have specific information about "${concept}" in my knowledge base.`,
      confidence: 0,
      sources: [],
      reasoning: 'No matching definition found',
    };
  }
  
  private async answerWhoIs(concept: string, nodes: GraphNode[]): Promise<QuestionAnswer> {
    const personNode = nodes.find(n => n.type === 'person' || n.type === 'entity');
    
    if (personNode) {
      const relatedFacts = await this.graph.getRelatedNodes(personNode.id, 1);
      const factStrings = relatedFacts.slice(0, 3).map(n => n.label).join(', ');
      
      return {
        question: `Who is ${concept}?`,
        answer: `${personNode.label}: ${personNode.content}${factStrings ? `. Related: ${factStrings}` : ''}`,
        confidence: personNode.confidence,
        sources: [personNode, ...relatedFacts.slice(0, 3)],
        reasoning: 'Found person in knowledge base with related facts',
      };
    }
    
    return {
      question: `Who is ${concept}?`,
      answer: `I don't have information about a person named "${concept}".`,
      confidence: 0,
      sources: [],
      reasoning: 'No matching person found',
    };
  }
  
  private async answerWhere(concepts: string[], nodes: GraphNode[]): Promise<QuestionAnswer> {
    const placeNode = nodes.find(n => n.type === 'place');
    
    if (placeNode) {
      return {
        question: `Where? (${concepts.join(' ')})`,
        answer: placeNode.label,
        confidence: placeNode.confidence,
        sources: [placeNode],
        reasoning: 'Found location in knowledge base',
      };
    }
    
    return {
      question: `Where? (${concepts.join(' ')})`,
      answer: `I don't have location information for this query.`,
      confidence: 0,
      sources: [],
      reasoning: 'No location found',
    };
  }
  
  private async answerWhen(concepts: string[], nodes: GraphNode[]): Promise<QuestionAnswer> {
    const eventNode = nodes.find(n => n.type === 'event');
    
    if (eventNode && eventNode.metadata?.date) {
      return {
        question: `When? (${concepts.join(' ')})`,
        answer: String(eventNode.metadata.date),
        confidence: eventNode.confidence,
        sources: [eventNode],
        reasoning: 'Found temporal information in knowledge base',
      };
    }
    
    return {
      question: `When? (${concepts.join(' ')})`,
      answer: `I don't have temporal information for this query.`,
      confidence: 0,
      sources: [],
      reasoning: 'No temporal data found',
    };
  }
  
  private async answerWhy(concepts: string[], nodes: GraphNode[]): Promise<QuestionAnswer> {
    // Look for causal relationships
    for (const node of nodes) {
      const edges = await this.graph.getEdgesTo(node.id);
      const causalEdge = edges.find(e => e.type === 'causes' || e.type === 'caused_by');
      
      if (causalEdge) {
        const causeNode = await this.graph.getNode(causalEdge.sourceId);
        if (causeNode) {
          return {
            question: `Why? (${concepts.join(' ')})`,
            answer: `Because ${causeNode.label}`,
            confidence: causeNode.confidence * causalEdge.weight,
            sources: [node, causeNode],
            reasoning: 'Found causal relationship in knowledge base',
          };
        }
      }
    }
    
    return {
      question: `Why? (${concepts.join(' ')})`,
      answer: `I don't have causal information for this query.`,
      confidence: 0,
      sources: [],
      reasoning: 'No causal relationship found',
    };
  }
  
  private async answerHow(concepts: string[], nodes: GraphNode[]): Promise<QuestionAnswer> {
    // Look for process or method nodes
    const processNode = nodes.find(n => 
      n.type === 'skill' || n.type === 'knowledge' || n.tags.includes('process')
    );
    
    if (processNode) {
      return {
        question: `How? (${concepts.join(' ')})`,
        answer: processNode.content,
        confidence: processNode.confidence,
        sources: [processNode],
        reasoning: 'Found process/method in knowledge base',
      };
    }
    
    return {
      question: `How? (${concepts.join(' ')})`,
      answer: `I don't have process information for this query.`,
      confidence: 0,
      sources: [],
      reasoning: 'No process information found',
    };
  }
  
  // ==========================================================================
  // Context Management
  // ==========================================================================
  
  /**
   * Update reasoning context with new information
   */
  updateContext(topics: string[], facts: GraphNode[]): void {
    // Keep recent topics (max 10)
    this.context.recentTopics = [...topics, ...this.context.recentTopics].slice(0, 10);
    
    // Update active facts
    this.context.activeFacts = facts;
  }
  
  /**
   * Get current reasoning context
   */
  getContext(): ReasoningContext {
    return { ...this.context };
  }
  
  /**
   * Clear reasoning context
   */
  clearContext(): void {
    this.context = {
      recentTopics: [],
      activeFacts: [],
      conversationFacts: new Map(),
    };
  }
}

export default ReasoningEngine;
