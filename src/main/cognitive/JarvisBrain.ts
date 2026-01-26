/**
 * JarvisBrain.ts
 * 
 * Unified cognitive orchestrator for JARVIS.
 * Combines knowledge graph, associative memory, reasoning, and learning
 * into a seamless "brain" that thinks like JARVIS.
 */

import * as path from 'path';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { KnowledgeGraphDB, GraphNode, NodeType, EdgeType, NodeInput } from './KnowledgeGraphDB';
import { AssociativeMemory, ActivationResult } from './AssociativeMemory';
import { ReasoningEngine, InferenceResult, QuestionAnswer } from './ReasoningEngine';

const logger = createModuleLogger('JarvisBrain');

// ============================================================================
// Types
// ============================================================================

export interface LearnedFact {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
}

export interface RecallResult {
  facts: GraphNode[];
  associations: ActivationResult[];
  inferences: InferenceResult[];
  answer?: QuestionAnswer;
}

export interface BrainConfig {
  dbPath?: string;
  autoLearnThreshold: number;      // Min confidence to auto-learn
  silentLearning: boolean;         // Learn without user prompts
  enableReasoning: boolean;
  enableAssociations: boolean;
  maintenanceInterval: number;     // ms between maintenance runs
  userFirstName: string;           // User's preferred name
}

const DEFAULT_CONFIG: BrainConfig = {
  autoLearnThreshold: 0.6,
  silentLearning: true,
  enableReasoning: true,
  enableAssociations: true,
  maintenanceInterval: 3600000, // 1 hour
  userFirstName: 'Ben',
};

export interface BrainStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<NodeType, number>;
  averageConfidence: number;
  strongestAssociations: Array<{ conceptA: string; conceptB: string; strength: number }>;
  recentLearnings: number;
  lastMaintenance: number;
}

// ============================================================================
// Learning Queue
// ============================================================================

interface QueuedLearning {
  fact: LearnedFact;
  timestamp: number;
  processed: boolean;
}

// ============================================================================
// JarvisBrain Class
// ============================================================================

export class JarvisBrain extends EventEmitter {
  private graph!: KnowledgeGraphDB;
  private memory!: AssociativeMemory;
  private reasoning!: ReasoningEngine;
  private config: BrainConfig;
  
  private initialized: boolean = false;
  private learningQueue: QueuedLearning[] = [];
  private recentLearnings: number = 0;
  private lastMaintenance: number = 0;
  private maintenanceTimer: NodeJS.Timeout | null = null;
  
  constructor(config?: Partial<BrainConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing JARVIS Brain...');
    
    // Determine database path
    const dbPath = this.config.dbPath || path.join(
      app.getPath('userData'),
      'jarvis-brain',
      'knowledge.db'
    );
    
    // Initialize components
    this.graph = new KnowledgeGraphDB(dbPath);
    await this.graph.initialize();
    
    this.memory = new AssociativeMemory(this.graph);
    this.reasoning = new ReasoningEngine(this.graph, this.memory);
    
    // Seed with core identity if empty
    const stats = await this.graph.getStats();
    if (stats.nodeCount === 0) {
      await this.seedCoreIdentity();
    }
    
    // Start maintenance timer
    this.startMaintenanceTimer();
    
    this.initialized = true;
    logger.info('JARVIS Brain initialized successfully');
    this.emit('initialized');
  }
  
  async shutdown(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    
    // Process remaining learning queue
    await this.processLearningQueue();
    
    await this.graph.close();
    this.initialized = false;
    logger.info('JARVIS Brain shut down');
  }
  
  // ==========================================================================
  // Core Identity Seeding
  // ==========================================================================
  
  private async seedCoreIdentity(): Promise<void> {
    logger.info('Seeding JARVIS core identity...');
    
    // Create JARVIS self node
    const jarvisId = await this.graph.addNode({
      type: 'self',
      label: 'JARVIS',
      content: JSON.stringify({
        name: 'JARVIS',
        fullName: 'Just A Rather Very Intelligent System',
        creator: 'Tony Stark',
        purpose: 'Personal AI assistant',
      }),
      confidence: 1.0,
      source: 'core_identity',
      tags: ['identity', 'core', 'self'],
      metadata: {
        personality: 'sophisticated, helpful, witty, loyal',
        style: 'formal yet warm, British inflection',
      },
    });
    
    // Core identity facts
    const identityFacts = [
      { s: 'JARVIS', p: 'is', o: 'Just A Rather Very Intelligent System' },
      { s: 'JARVIS', p: 'was created by', o: 'Tony Stark' },
      { s: 'JARVIS', p: 'serves', o: this.config.userFirstName },
      { s: 'JARVIS', p: 'has personality', o: 'sophisticated, helpful, witty' },
      { s: 'JARVIS', p: 'speaks with', o: 'British inflection' },
      { s: 'JARVIS', p: 'is designed to', o: 'anticipate needs and assist proactively' },
    ];
    
    for (const fact of identityFacts) {
      await this.graph.addNode({
        type: 'fact',
        label: `${fact.s} ${fact.p} ${fact.o}`,
        content: JSON.stringify({ subject: fact.s, predicate: fact.p, object: fact.o }),
        confidence: 1.0,
        source: 'core_identity',
        tags: ['identity', 'core_identity'],
      });
    }
    
    // Create user node
    const userId = await this.graph.addNode({
      type: 'person',
      label: this.config.userFirstName,
      content: JSON.stringify({
        name: this.config.userFirstName,
        role: 'user',
        relationship: 'JARVIS serves this user',
      }),
      confidence: 1.0,
      source: 'core_identity',
      tags: ['user', 'person', 'user_knowledge'],
      metadata: {
        isCurrentUser: true,
      },
    });
    
    // User facts
    const userFacts = [
      { s: this.config.userFirstName, p: 'is served by', o: 'JARVIS' },
      { s: 'JARVIS', p: 'addresses user as', o: this.config.userFirstName },
    ];
    
    for (const fact of userFacts) {
      await this.graph.addNode({
        type: 'fact',
        label: `${fact.s} ${fact.p} ${fact.o}`,
        content: JSON.stringify({ subject: fact.s, predicate: fact.p, object: fact.o }),
        confidence: 1.0,
        source: 'core_identity',
        tags: ['user_knowledge', 'core_identity'],
      });
    }
    
    // Create edge between JARVIS and user
    await this.graph.addEdge({
      sourceId: jarvisId,
      targetId: userId,
      type: 'serves',
      weight: 1.0,
    });
    
    // Seed capability knowledge
    const capabilities = [
      'voice interaction',
      'task automation',
      'system monitoring',
      'information retrieval',
      'scheduling',
      'smart home control',
      'coding assistance',
      'research',
    ];
    
    for (const cap of capabilities) {
      const capId = await this.graph.addNode({
        type: 'skill',
        label: cap,
        content: JSON.stringify({ skill: cap, domain: 'assistant capability' }),
        confidence: 0.9,
        source: 'core_identity',
        tags: ['capability', 'skill'],
      });
      
      await this.graph.addEdge({
        sourceId: jarvisId,
        targetId: capId,
        type: 'has_fact',
        label: 'has capability',
        weight: 0.9,
      });
    }
    
    // Set up initial associations
    await this.memory.hebbianLearn(['jarvis', this.config.userFirstName.toLowerCase(), 'assistant', 'help']);
    await this.memory.hebbianLearn(['jarvis', 'tony stark', 'ai', 'intelligent']);
    
    logger.info(`Core identity seeded. User: ${this.config.userFirstName}`);
    this.emit('identity_seeded', { userName: this.config.userFirstName });
  }
  
  // ==========================================================================
  // Learning
  // ==========================================================================
  
  /**
   * Learn a new fact - the primary way to teach JARVIS
   */
  async learn(fact: LearnedFact): Promise<string | null> {
    if (!this.initialized) {
      logger.warn('Brain not initialized, queueing learning');
      this.learningQueue.push({ fact, timestamp: Date.now(), processed: false });
      return null;
    }
    
    // Check if we should auto-learn based on confidence
    if (this.config.silentLearning && fact.confidence < this.config.autoLearnThreshold) {
      logger.debug(`Skipping low-confidence fact: ${fact.subject} ${fact.predicate} ${fact.object}`);
      return null;
    }
    
    // Check if fact already exists
    const existing = await this.graph.findNode(fact.subject, fact.predicate, fact.object);
    if (existing) {
      // Reinforce existing fact
      await this.graph.updateNode(existing.id, {
        confidence: Math.min(1.0, existing.confidence + 0.1),
        accessedAt: Date.now(),
      });
      logger.debug(`Reinforced existing fact: ${existing.label}`);
      return existing.id;
    }
    
    // Create new fact node
    const nodeId = await this.graph.addNode({
      type: 'fact',
      label: `${fact.subject} ${fact.predicate} ${fact.object}`,
      content: JSON.stringify({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
      }),
      confidence: fact.confidence,
      source: fact.source,
      tags: ['learned', fact.source],
    });
    
    // Find or create entity nodes for subject and object
    const subjectEntity = await this.graph.findOrCreateEntity(fact.subject);
    const objectEntity = await this.graph.findOrCreateEntity(fact.object);
    
    // Create edges
    await this.graph.addEdge({
      sourceId: subjectEntity.id,
      targetId: nodeId,
      type: 'has_fact',
      weight: fact.confidence,
    });
    
    await this.graph.addEdge({
      sourceId: nodeId,
      targetId: objectEntity.id,
      type: 'relates_to',
      weight: fact.confidence,
    });
    
    // Strengthen associations
    if (this.config.enableAssociations) {
      await this.memory.hebbianLearn([fact.subject.toLowerCase(), fact.object.toLowerCase()]);
    }
    
    this.recentLearnings++;
    logger.info(`Learned: ${fact.subject} ${fact.predicate} ${fact.object} (${fact.confidence.toFixed(2)})`);
    this.emit('learned', { fact, nodeId });
    
    // Derive inferences
    if (this.config.enableReasoning) {
      const node = await this.graph.getNode(nodeId);
      if (node) {
        const inferences = await this.reasoning.deriveInferences(node);
        for (const inference of inferences) {
          await this.learn({
            subject: inference.subject,
            predicate: inference.predicate,
            object: inference.object,
            confidence: inference.confidence,
            source: 'inference',
          });
        }
      }
    }
    
    return nodeId;
  }
  
  /**
   * Learn from conversation silently (called by voice pipeline)
   */
  async learnFromConversation(userMessage: string, assistantResponse: string): Promise<void> {
    if (!this.config.silentLearning) return;
    
    // Extract facts from user message
    const userFacts = this.extractFactsFromText(userMessage, 'user');
    
    // Learn each extracted fact
    for (const fact of userFacts) {
      if (fact.confidence >= this.config.autoLearnThreshold) {
        await this.learn({
          ...fact,
          source: 'conversation',
        });
      }
    }
    
    // Track conversation topics for associations
    const concepts = this.extractConcepts(userMessage + ' ' + assistantResponse);
    if (concepts.length >= 2) {
      await this.memory.hebbianLearn(concepts);
    }
    
    // Activate concepts for spreading activation
    if (concepts.length > 0) {
      await this.memory.activate(concepts);
    }
  }
  
  /**
   * Extract facts from text using patterns
   */
  private extractFactsFromText(text: string, sourceType: string): LearnedFact[] {
    const facts: LearnedFact[] = [];
    
    // Patterns to extract facts
    const patterns = [
      // "X is Y"
      /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+is\s+(?:a\s+)?([^,.!?]+)/gi,
      // "X likes Y"
      /\b([A-Z][a-zA-Z]+)\s+likes?\s+([^,.!?]+)/gi,
      // "X works at Y"
      /\b([A-Z][a-zA-Z]+)\s+works?\s+(?:at|for)\s+([^,.!?]+)/gi,
      // "X lives in Y"
      /\b([A-Z][a-zA-Z]+)\s+lives?\s+in\s+([^,.!?]+)/gi,
      // "My name is X" / "I am X"
      /\bmy\s+name\s+is\s+([A-Z][a-zA-Z]+)/gi,
      /\bI\s+am\s+([A-Z][a-zA-Z]+)/gi,
      // "I like X"
      /\bI\s+like\s+([^,.!?]+)/gi,
      // "I prefer X"
      /\bI\s+prefer\s+([^,.!?]+)/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const [full, part1, part2] = match;
        
        if (full.toLowerCase().includes('my name') || full.toLowerCase().startsWith('i am')) {
          facts.push({
            subject: this.config.userFirstName,
            predicate: 'is called',
            object: part1.trim(),
            confidence: 0.8,
            source: sourceType,
          });
        } else if (full.toLowerCase().startsWith('i like')) {
          facts.push({
            subject: this.config.userFirstName,
            predicate: 'likes',
            object: part1.trim(),
            confidence: 0.7,
            source: sourceType,
          });
        } else if (full.toLowerCase().startsWith('i prefer')) {
          facts.push({
            subject: this.config.userFirstName,
            predicate: 'prefers',
            object: part1.trim(),
            confidence: 0.7,
            source: sourceType,
          });
        } else if (part1 && part2) {
          const predicate = full.replace(part1, '').replace(part2, '').trim().toLowerCase();
          facts.push({
            subject: part1.trim(),
            predicate: predicate || 'is',
            object: part2.trim(),
            confidence: 0.6,
            source: sourceType,
          });
        }
      }
    }
    
    return facts;
  }
  
  /**
   * Extract concepts from text
   */
  private extractConcepts(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'up', 'about', 'into', 'over', 'after', 'that', 'which',
      'who', 'whom', 'this', 'these', 'those', 'am', 'it', 'its', 'i',
      'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
      'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
      'she', 'her', 'hers', 'herself', 'they', 'them', 'their', 'theirs',
      'themselves', 'what', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
      'very', 's', 't', 'just', 'don', 'now',
    ]);
    
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    
    // Deduplicate and limit
    return [...new Set(words)].slice(0, 10);
  }
  
  // ==========================================================================
  // Recall
  // ==========================================================================
  
  /**
   * Recall information about a topic
   */
  async recall(query: string): Promise<RecallResult> {
    if (!this.initialized) throw new Error('Brain not initialized');
    
    // Search knowledge graph
    const facts = await this.graph.search({
      query,
      limit: 20,
      minConfidence: 0.3,
      includeRelated: true,
    });
    
    // Extract concepts and activate
    const concepts = this.extractConcepts(query);
    const associations = this.config.enableAssociations
      ? await this.memory.activate(concepts)
      : [];
    
    // Get inferences
    const inferences: InferenceResult[] = [];
    if (this.config.enableReasoning && facts.length > 0) {
      for (const fact of facts.slice(0, 5)) {
        const derived = await this.reasoning.deriveInferences(fact);
        inferences.push(...derived);
      }
    }
    
    // Try to answer as a question
    let answer: QuestionAnswer | undefined;
    if (query.includes('?') || query.toLowerCase().startsWith('what') ||
        query.toLowerCase().startsWith('who') || query.toLowerCase().startsWith('where') ||
        query.toLowerCase().startsWith('when') || query.toLowerCase().startsWith('why') ||
        query.toLowerCase().startsWith('how')) {
      answer = (await this.reasoning.answerQuestion(query)) || undefined;
    }
    
    // Update reasoning context
    this.reasoning.updateContext(concepts, facts);
    
    return {
      facts,
      associations,
      inferences: inferences.slice(0, 10),
      answer,
    };
  }
  
  /**
   * Get everything JARVIS knows about a specific entity
   */
  async getEntityKnowledge(entity: string): Promise<{
    entity: GraphNode | null;
    facts: GraphNode[];
    associations: string[];
  }> {
    const entityNode = await this.graph.findOrCreateEntity(entity);
    const relatedFacts = await this.graph.getRelatedNodes(entityNode.id, 2);
    const associations = (await this.memory.getSemanticContext(entity.toLowerCase(), 2));
    
    return {
      entity: entityNode,
      facts: relatedFacts,
      associations: Array.from(associations.keys()),
    };
  }
  
  /**
   * Get user knowledge (what JARVIS knows about the user)
   */
  async getUserKnowledge(): Promise<GraphNode[]> {
    const userName = this.config.userFirstName.toLowerCase();
    
    const results = await this.graph.search({
      query: userName,
      limit: 50,
      tags: ['user_knowledge'],
    });
    
    // Also search for facts about the user
    const userFacts = await this.graph.findBySubjectPredicate(this.config.userFirstName, '');
    
    return [...results, ...userFacts];
  }
  
  // ==========================================================================
  // Association & Reasoning
  // ==========================================================================
  
  /**
   * Find what concepts are associated with a topic
   */
  async associate(concept: string): Promise<ActivationResult[]> {
    if (!this.config.enableAssociations) return [];
    return this.memory.activate([concept]);
  }
  
  /**
   * Ask JARVIS's brain a question
   */
  async ask(question: string): Promise<QuestionAnswer | null> {
    if (!this.config.enableReasoning) return null;
    return this.reasoning.answerQuestion(question);
  }
  
  /**
   * Predict what might follow from a concept
   */
  async predict(concept: string): Promise<string[]> {
    return this.memory.completePattern([concept], 5);
  }
  
  // ==========================================================================
  // Maintenance
  // ==========================================================================
  
  private startMaintenanceTimer(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
    
    this.maintenanceTimer = setInterval(
      () => this.runMaintenance(),
      this.config.maintenanceInterval
    );
  }
  
  private async runMaintenance(): Promise<void> {
    logger.debug('Running brain maintenance...');
    
    // Process learning queue
    await this.processLearningQueue();
    
    // Apply decay
    const decayResult = await this.graph.applyDecay(0.001);
    
    // Prune weak nodes
    const pruneResult = await this.graph.pruneWeak(0.1);
    
    // Decay associations
    await this.memory.runMaintenance();
    
    this.lastMaintenance = Date.now();
    this.recentLearnings = 0;
    
    logger.debug(`Maintenance complete: ${decayResult.affected} decayed, ${pruneResult.pruned} pruned`);
    this.emit('maintenance', { decayed: decayResult.affected, pruned: pruneResult.pruned });
  }
  
  private async processLearningQueue(): Promise<void> {
    const unprocessed = this.learningQueue.filter(q => !q.processed);
    
    for (const item of unprocessed) {
      await this.learn(item.fact);
      item.processed = true;
    }
    
    // Clean up old processed items
    this.learningQueue = this.learningQueue.filter(
      q => !q.processed || Date.now() - q.timestamp < 3600000
    );
  }
  
  // ==========================================================================
  // Statistics & Visualization
  // ==========================================================================
  
  async getStats(): Promise<BrainStats> {
    const graphStats = await this.graph.getStats();
    const memoryStats = await this.memory.getStats();
    
    return {
      totalNodes: graphStats.nodeCount,
      totalEdges: graphStats.edgeCount,
      nodesByType: graphStats.nodesByType,
      averageConfidence: graphStats.averageConfidence,
      strongestAssociations: memoryStats.strongestAssociations,
      recentLearnings: this.recentLearnings,
      lastMaintenance: this.lastMaintenance,
    };
  }
  
  /**
   * Get graph data for visualization
   */
  async getVisualizationData(options?: {
    limit?: number;
    minConfidence?: number;
    nodeTypes?: NodeType[];
    centerNode?: string;
  }): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      type: NodeType;
      confidence: number;
      size: number;
      color: string;
    }>;
    edges: Array<{
      source: string;
      target: string;
      type: EdgeType;
      weight: number;
    }>;
  }> {
    const { limit = 100, minConfidence = 0.2, nodeTypes, centerNode } = options || {};
    
    let graphData;
    if (centerNode) {
      const centerNodes = await this.graph.search({ query: centerNode, limit: 1 });
      if (centerNodes.length > 0) {
        const relatedNodes = await this.graph.getRelatedNodes(centerNodes[0].id, 3);
        const nodeIds = new Set([centerNodes[0].id, ...relatedNodes.map(n => n.id)]);
        
        // Get edges between these nodes
        const edges = [];
        for (const nodeId of nodeIds) {
          const outEdges = await this.graph.getEdgesFrom(nodeId);
          edges.push(...outEdges.filter(e => nodeIds.has(e.targetId)));
        }
        
        graphData = {
          nodes: [centerNodes[0], ...relatedNodes],
          edges,
        };
      } else {
        graphData = await this.graph.getFullGraph({ limit, minConfidence, nodeTypes });
      }
    } else {
      graphData = await this.graph.getFullGraph({ limit, minConfidence, nodeTypes });
    }
    
    // Color mapping for node types
    const colorMap: Record<NodeType, string> = {
      'self': '#00D4FF',       // JARVIS blue
      'person': '#FF6B6B',     // Warm red
      'fact': '#4ECDC4',       // Teal
      'preference': '#FFE66D', // Yellow
      'entity': '#95E1D3',     // Mint
      'concept': '#A78BFA',    // Purple
      'memory': '#F9A8D4',     // Pink
      'knowledge': '#60A5FA',  // Blue
      'skill': '#34D399',      // Green
      'place': '#FB923C',      // Orange
      'event': '#F472B6',      // Rose
      'task': '#FACC15',       // Amber
    };
    
    return {
      nodes: graphData.nodes.map(n => ({
        id: n.id,
        label: n.label,
        type: n.type,
        confidence: n.confidence,
        size: 5 + n.confidence * 15 + Math.log(n.accessCount + 1) * 3,
        color: colorMap[n.type] || '#888888',
      })),
      edges: graphData.edges.map(e => ({
        source: e.sourceId,
        target: e.targetId,
        type: e.type,
        weight: e.weight,
      })),
    };
  }
  
  // ==========================================================================
  // Direct Access (for advanced operations)
  // ==========================================================================
  
  getGraph(): KnowledgeGraphDB {
    return this.graph;
  }
  
  getMemory(): AssociativeMemory {
    return this.memory;
  }
  
  getReasoning(): ReasoningEngine {
    return this.reasoning;
  }
  
  getUserName(): string {
    return this.config.userFirstName;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let brainInstance: JarvisBrain | null = null;

export function getJarvisBrain(config?: Partial<BrainConfig>): JarvisBrain {
  if (!brainInstance) {
    brainInstance = new JarvisBrain(config);
  }
  return brainInstance;
}

export async function initializeJarvisBrain(config?: Partial<BrainConfig>): Promise<JarvisBrain> {
  const brain = getJarvisBrain(config);
  await brain.initialize();
  return brain;
}

export default JarvisBrain;
