/**
 * Atlas Desktop - Memory Graph Builder
 * Generates graph data structures for visualizing memory as a knowledge graph
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import type { MemoryEntry, MemoryType, ConversationSession } from './index';
import type { ConversationSummary, ActionItem } from './types';
import type { TopicCategory } from './topic-detector';

const logger = createModuleLogger('GraphBuilder');

// ============================================================================
// Types
// ============================================================================

/**
 * Node types for the memory graph
 */
export type GraphNodeType =
  | 'memory'
  | 'topic'
  | 'entity'
  | 'session'
  | 'summary'
  | 'action'
  | 'fact'
  | 'preference';

/**
 * Edge types for relationships between nodes
 */
export type GraphEdgeType =
  | 'contains'
  | 'related_to'
  | 'mentioned_in'
  | 'derived_from'
  | 'similar_to'
  | 'follows'
  | 'assigned_to'
  | 'categorized_as';

/**
 * A node in the memory graph
 */
export interface GraphNode {
  /** Unique node ID */
  id: string;
  /** Node type */
  type: GraphNodeType;
  /** Display label */
  label: string;
  /** Full content/description */
  content: string;
  /** Node importance/weight (0-1) */
  weight: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last accessed timestamp */
  accessedAt: number;
  /** Memory strength/decay (0-1, decreases over time) */
  strength: number;
  /** Color for visualization (hex) */
  color: string;
  /** Node size multiplier (based on importance/connections) */
  size: number;
  /** Category for grouping */
  category?: string;
  /** Tags for filtering */
  tags: string[];
  /** Source memory type */
  sourceType?: MemoryType;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * An edge connecting two nodes
 */
export interface GraphEdge {
  /** Unique edge ID */
  id: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Relationship type */
  type: GraphEdgeType;
  /** Edge weight (affects visualization) */
  weight: number;
  /** Display label */
  label?: string;
  /** Edge color (hex) */
  color: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Complete memory graph
 */
export interface MemoryGraph {
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges in the graph */
  edges: GraphEdge[];
  /** Graph statistics */
  stats: GraphStats;
  /** Generation timestamp */
  generatedAt: number;
}

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Total node count */
  nodeCount: number;
  /** Total edge count */
  edgeCount: number;
  /** Nodes by type */
  nodesByType: Record<GraphNodeType, number>;
  /** Edges by type */
  edgesByType: Record<GraphEdgeType, number>;
  /** Average node weight */
  averageWeight: number;
  /** Average memory strength */
  averageStrength: number;
  /** Most connected nodes */
  topConnected: Array<{ id: string; label: string; connections: number }>;
  /** Date range covered */
  dateRange: { start: number; end: number };
}

/**
 * Graph filter options
 */
export interface GraphFilterOptions {
  /** Filter by node types */
  nodeTypes?: GraphNodeType[];
  /** Filter by edge types */
  edgeTypes?: GraphEdgeType[];
  /** Filter by minimum weight */
  minWeight?: number;
  /** Filter by minimum strength */
  minStrength?: number;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Filter by category */
  category?: string;
  /** Filter by date range */
  dateRange?: { start?: number; end?: number };
  /** Search text (fuzzy match on labels/content) */
  searchText?: string;
  /** Maximum nodes to return */
  maxNodes?: number;
  /** Include orphan nodes (no edges) */
  includeOrphans?: boolean;
}

/**
 * Graph builder configuration
 */
export interface GraphBuilderConfig {
  /** Decay rate per day (0-1) */
  decayRatePerDay: number;
  /** Base node size */
  baseNodeSize: number;
  /** Maximum node size */
  maxNodeSize: number;
  /** Enable entity extraction */
  enableEntityExtraction: boolean;
  /** Minimum similarity for creating edges */
  minSimilarity: number;
}

const DEFAULT_CONFIG: GraphBuilderConfig = {
  decayRatePerDay: 0.02,
  baseNodeSize: 10,
  maxNodeSize: 50,
  enableEntityExtraction: true,
  minSimilarity: 0.3,
};

// ============================================================================
// Color Schemes
// ============================================================================

const NODE_COLORS: Record<GraphNodeType, string> = {
  memory: '#6366F1', // Indigo
  topic: '#8B5CF6', // Violet
  entity: '#EC4899', // Pink
  session: '#14B8A6', // Teal
  summary: '#F59E0B', // Amber
  action: '#EF4444', // Red
  fact: '#22C55E', // Green
  preference: '#3B82F6', // Blue
};

const EDGE_COLORS: Record<GraphEdgeType, string> = {
  contains: '#6366F1',
  related_to: '#8B5CF6',
  mentioned_in: '#EC4899',
  derived_from: '#14B8A6',
  similar_to: '#F59E0B',
  follows: '#94A3B8',
  assigned_to: '#EF4444',
  categorized_as: '#3B82F6',
};

const CATEGORY_COLORS: Record<TopicCategory | string, string> = {
  technology: '#3B82F6',
  programming: '#8B5CF6',
  entertainment: '#EC4899',
  work: '#F59E0B',
  personal: '#EF4444',
  health: '#22C55E',
  education: '#06B6D4',
  finance: '#84CC16',
  travel: '#F97316',
  food: '#FB923C',
  sports: '#10B981',
  weather: '#64748B',
  news: '#6366F1',
  shopping: '#A855F7',
  home: '#14B8A6',
  general: '#94A3B8',
};

// ============================================================================
// Graph Builder Class
// ============================================================================

/**
 * Memory Graph Builder
 * Generates graph data from memory entries for visualization
 */
export class GraphBuilder extends EventEmitter {
  private config: GraphBuilderConfig;
  private nodeMap: Map<string, GraphNode> = new Map();
  private edgeMap: Map<string, GraphEdge> = new Map();
  private connectionCounts: Map<string, number> = new Map();

  constructor(config?: Partial<GraphBuilderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('GraphBuilder initialized', { config: this.config });
  }

  /**
   * Build a complete memory graph from various data sources
   */
  buildGraph(
    entries: MemoryEntry[],
    sessions: ConversationSession[],
    summaries: ConversationSummary[] = [],
    options?: GraphFilterOptions
  ): MemoryGraph {
    const startTime = Date.now();
    this.clear();

    logger.info('Building memory graph', {
      entries: entries.length,
      sessions: sessions.length,
      summaries: summaries.length,
    });

    // Add nodes from different sources
    this.addMemoryEntryNodes(entries);
    this.addSessionNodes(sessions);
    this.addSummaryNodes(summaries);

    // Extract entities and topics
    if (this.config.enableEntityExtraction) {
      this.extractEntitiesAndTopics(entries, sessions);
    }

    // Create edges
    this.createEdges(entries, sessions, summaries);

    // Apply decay to node strengths
    this.applyDecay();

    // Get nodes and edges
    let nodes = Array.from(this.nodeMap.values());
    let edges = Array.from(this.edgeMap.values());

    // Apply filters
    if (options) {
      const filtered = this.applyFilters(nodes, edges, options);
      nodes = filtered.nodes;
      edges = filtered.edges;
    }

    // Calculate sizes based on connections
    this.calculateNodeSizes(nodes, edges);

    // Build stats
    const stats = this.calculateStats(nodes, edges);

    const graph: MemoryGraph = {
      nodes,
      edges,
      stats,
      generatedAt: Date.now(),
    };

    logger.info('Memory graph built', {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      durationMs: Date.now() - startTime,
    });

    return graph;
  }

  /**
   * Add nodes from memory entries
   */
  private addMemoryEntryNodes(entries: MemoryEntry[]): void {
    for (const entry of entries) {
      const nodeType = this.memoryTypeToNodeType(entry.type);
      const node = this.createNode({
        id: `memory-${entry.id}`,
        type: nodeType,
        label: this.truncateLabel(entry.content),
        content: entry.content,
        weight: entry.importance,
        createdAt: entry.createdAt,
        accessedAt: entry.accessedAt,
        strength: 1,
        tags: entry.tags || [],
        sourceType: entry.type,
        metadata: entry.metadata || {},
      });
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Add nodes from conversation sessions
   */
  private addSessionNodes(sessions: ConversationSession[]): void {
    for (const session of sessions) {
      const messageCount = session.messages.length;
      const node = this.createNode({
        id: `session-${session.id}`,
        type: 'session',
        label: `Session ${new Date(session.startedAt).toLocaleDateString()}`,
        content: session.summary || `${messageCount} messages`,
        weight: Math.min(1, messageCount / 20),
        createdAt: session.startedAt,
        accessedAt: session.lastActivityAt,
        strength: 1,
        tags: [],
        metadata: {
          messageCount,
          ...session.metadata,
        },
      });
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Add nodes from conversation summaries
   */
  private addSummaryNodes(summaries: ConversationSummary[]): void {
    for (const summary of summaries) {
      const node = this.createNode({
        id: `summary-${summary.id}`,
        type: 'summary',
        label: this.truncateLabel(summary.summary),
        content: summary.summary,
        weight: Math.min(1, summary.exchangeCount / 10),
        createdAt: summary.createdAt,
        accessedAt: summary.createdAt,
        strength: 1,
        tags: summary.topics,
        category: summary.level,
        metadata: {
          level: summary.level,
          sentiment: summary.sentiment,
          keyFacts: summary.keyFacts,
          decisions: summary.decisions,
        },
      });
      this.nodeMap.set(node.id, node);

      // Add action items as separate nodes
      for (const action of summary.actionItems) {
        this.addActionItemNode(action, summary);
      }
    }
  }

  /**
   * Add an action item node
   */
  private addActionItemNode(action: ActionItem, summary: ConversationSummary): void {
    const actionId = `action-${summary.id}-${action.description.slice(0, 20).replace(/\s+/g, '-')}`;
    const node = this.createNode({
      id: actionId,
      type: 'action',
      label: this.truncateLabel(action.description),
      content: action.description,
      weight: action.priority === 'high' ? 0.9 : action.priority === 'medium' ? 0.6 : 0.3,
      createdAt: summary.createdAt,
      accessedAt: summary.createdAt,
      strength: action.completed ? 0.3 : 1,
      tags: [action.priority],
      category: 'action',
      metadata: {
        priority: action.priority,
        completed: action.completed,
        assignee: action.assignee,
        dueDate: action.dueDate,
      },
    });
    this.nodeMap.set(node.id, node);

    // Create edge from summary to action
    this.addEdge({
      source: `summary-${summary.id}`,
      target: actionId,
      type: 'contains',
      weight: 0.8,
    });
  }

  /**
   * Extract entities and topics from text content
   */
  private extractEntitiesAndTopics(
    entries: MemoryEntry[],
    sessions: ConversationSession[]
  ): void {
    const topicCounts = new Map<string, number>();
    const entityCounts = new Map<string, { count: number; sources: string[] }>();

    // Process entries
    for (const entry of entries) {
      const extracted = this.extractFromText(entry.content);

      for (const topic of extracted.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }

      for (const entity of extracted.entities) {
        const existing = entityCounts.get(entity) || { count: 0, sources: [] };
        existing.count++;
        existing.sources.push(`memory-${entry.id}`);
        entityCounts.set(entity, existing);
      }
    }

    // Process session messages
    for (const session of sessions) {
      for (const message of session.messages) {
        const extracted = this.extractFromText(message.content);

        for (const topic of extracted.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }

        for (const entity of extracted.entities) {
          const existing = entityCounts.get(entity) || { count: 0, sources: [] };
          existing.count++;
          existing.sources.push(`session-${session.id}`);
          entityCounts.set(entity, existing);
        }
      }
    }

    // Create topic nodes
    for (const [topic, count] of topicCounts) {
      if (count >= 2) {
        const category = this.categorize(topic);
        const node = this.createNode({
          id: `topic-${topic.toLowerCase().replace(/\s+/g, '-')}`,
          type: 'topic',
          label: topic,
          content: `Topic: ${topic} (mentioned ${count} times)`,
          weight: Math.min(1, count / 10),
          createdAt: Date.now(),
          accessedAt: Date.now(),
          strength: 1,
          tags: [],
          category,
          metadata: { mentionCount: count },
        });
        this.nodeMap.set(node.id, node);
      }
    }

    // Create entity nodes
    for (const [entity, data] of entityCounts) {
      if (data.count >= 2) {
        const node = this.createNode({
          id: `entity-${entity.toLowerCase().replace(/\s+/g, '-')}`,
          type: 'entity',
          label: entity,
          content: `Entity: ${entity} (mentioned ${data.count} times)`,
          weight: Math.min(1, data.count / 5),
          createdAt: Date.now(),
          accessedAt: Date.now(),
          strength: 1,
          tags: [],
          metadata: { mentionCount: data.count, sources: data.sources },
        });
        this.nodeMap.set(node.id, node);

        // Create edges to sources
        for (const sourceId of data.sources.slice(0, 10)) {
          if (this.nodeMap.has(sourceId)) {
            this.addEdge({
              source: sourceId,
              target: node.id,
              type: 'mentioned_in',
              weight: 0.5,
            });
          }
        }
      }
    }
  }

  /**
   * Extract topics and entities from text
   */
  private extractFromText(text: string): { topics: string[]; entities: string[] } {
    const topics: string[] = [];
    const entities: string[] = [];

    // Simple keyword-based extraction
    const words = text.toLowerCase().split(/\s+/);
    const capitalizedWords = text.match(/\b[A-Z][a-z]+\b/g) || [];

    // Extract potential entities (proper nouns)
    for (const word of capitalizedWords) {
      if (word.length > 2 && !this.isCommonWord(word)) {
        entities.push(word);
      }
    }

    // Extract topics based on keywords
    const topicKeywords: Record<string, string[]> = {
      'technology': ['software', 'hardware', 'computer', 'tech', 'digital', 'app'],
      'programming': ['code', 'function', 'class', 'api', 'debug', 'test'],
      'work': ['project', 'meeting', 'deadline', 'task', 'team', 'client'],
      'personal': ['family', 'friend', 'home', 'life', 'weekend'],
      'health': ['exercise', 'sleep', 'diet', 'doctor', 'health'],
      'finance': ['money', 'budget', 'invest', 'bank', 'payment'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      for (const keyword of keywords) {
        if (words.includes(keyword)) {
          topics.push(topic);
          break;
        }
      }
    }

    return { topics: [...new Set(topics)], entities: [...new Set(entities)] };
  }

  /**
   * Create edges between related nodes
   */
  private createEdges(
    entries: MemoryEntry[],
    sessions: ConversationSession[],
    summaries: ConversationSummary[]
  ): void {
    // Connect entries to sessions by timestamp proximity
    for (const entry of entries) {
      for (const session of sessions) {
        if (
          entry.createdAt >= session.startedAt &&
          entry.createdAt <= session.lastActivityAt
        ) {
          this.addEdge({
            source: `session-${session.id}`,
            target: `memory-${entry.id}`,
            type: 'contains',
            weight: 0.7,
          });
        }
      }
    }

    // Connect summaries to sessions
    for (const summary of summaries) {
      if (summary.sessionId) {
        this.addEdge({
          source: `session-${summary.sessionId}`,
          target: `summary-${summary.id}`,
          type: 'derived_from',
          weight: 0.9,
        });
      }
    }

    // Connect entries with similar tags
    const entryList = Array.from(this.nodeMap.values()).filter(n => n.sourceType);
    for (let i = 0; i < entryList.length; i++) {
      for (let j = i + 1; j < entryList.length; j++) {
        const similarity = this.calculateTagSimilarity(entryList[i].tags, entryList[j].tags);
        if (similarity >= this.config.minSimilarity) {
          this.addEdge({
            source: entryList[i].id,
            target: entryList[j].id,
            type: 'similar_to',
            weight: similarity,
          });
        }
      }
    }

    // Connect topics to nodes that mention them
    const topicNodes = Array.from(this.nodeMap.values()).filter(n => n.type === 'topic');
    for (const topicNode of topicNodes) {
      for (const node of this.nodeMap.values()) {
        if (
          node.type !== 'topic' &&
          node.type !== 'entity' &&
          node.content.toLowerCase().includes(topicNode.label.toLowerCase())
        ) {
          this.addEdge({
            source: node.id,
            target: topicNode.id,
            type: 'categorized_as',
            weight: 0.6,
          });
        }
      }
    }

    // Connect sessions in chronological order
    const sortedSessions = sessions.slice().sort((a, b) => a.startedAt - b.startedAt);
    for (let i = 0; i < sortedSessions.length - 1; i++) {
      this.addEdge({
        source: `session-${sortedSessions[i].id}`,
        target: `session-${sortedSessions[i + 1].id}`,
        type: 'follows',
        weight: 0.4,
      });
    }
  }

  /**
   * Apply time-based decay to node strengths
   */
  private applyDecay(): void {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    for (const node of this.nodeMap.values()) {
      const daysSinceAccess = (now - node.accessedAt) / msPerDay;
      const decay = Math.pow(1 - this.config.decayRatePerDay, daysSinceAccess);
      node.strength = Math.max(0.1, decay);

      // Adjust color opacity based on strength
      const baseColor = node.color;
      node.color = this.adjustColorOpacity(baseColor, node.strength);
    }
  }

  /**
   * Calculate node sizes based on connections
   */
  private calculateNodeSizes(nodes: GraphNode[], edges: GraphEdge[]): void {
    // Count connections for each node
    const connectionCounts = new Map<string, number>();

    for (const edge of edges) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
    }

    // Find max connections for normalization
    const maxConnections = Math.max(...Array.from(connectionCounts.values()), 1);

    // Calculate sizes
    for (const node of nodes) {
      const connections = connectionCounts.get(node.id) || 0;
      const normalizedConnections = connections / maxConnections;
      const weightFactor = node.weight;
      const strengthFactor = node.strength;

      node.size = this.config.baseNodeSize +
        (this.config.maxNodeSize - this.config.baseNodeSize) *
        (0.4 * normalizedConnections + 0.4 * weightFactor + 0.2 * strengthFactor);
    }

    this.connectionCounts = connectionCounts;
  }

  /**
   * Apply filters to nodes and edges
   */
  private applyFilters(
    nodes: GraphNode[],
    edges: GraphEdge[],
    options: GraphFilterOptions
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    let filteredNodes = nodes;

    // Filter by node types
    if (options.nodeTypes?.length) {
      filteredNodes = filteredNodes.filter(n => options.nodeTypes!.includes(n.type));
    }

    // Filter by minimum weight
    if (options.minWeight !== undefined) {
      filteredNodes = filteredNodes.filter(n => n.weight >= options.minWeight!);
    }

    // Filter by minimum strength
    if (options.minStrength !== undefined) {
      filteredNodes = filteredNodes.filter(n => n.strength >= options.minStrength!);
    }

    // Filter by tags
    if (options.tags?.length) {
      filteredNodes = filteredNodes.filter(n =>
        options.tags!.some(tag => n.tags.includes(tag))
      );
    }

    // Filter by category
    if (options.category) {
      filteredNodes = filteredNodes.filter(n => n.category === options.category);
    }

    // Filter by date range
    if (options.dateRange) {
      if (options.dateRange.start) {
        filteredNodes = filteredNodes.filter(n => n.createdAt >= options.dateRange!.start!);
      }
      if (options.dateRange.end) {
        filteredNodes = filteredNodes.filter(n => n.createdAt <= options.dateRange!.end!);
      }
    }

    // Filter by search text
    if (options.searchText) {
      const searchLower = options.searchText.toLowerCase();
      filteredNodes = filteredNodes.filter(n =>
        n.label.toLowerCase().includes(searchLower) ||
        n.content.toLowerCase().includes(searchLower)
      );
    }

    // Get valid node IDs
    const validNodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter edges
    let filteredEdges = edges.filter(e =>
      validNodeIds.has(e.source) && validNodeIds.has(e.target)
    );

    // Filter by edge types
    if (options.edgeTypes?.length) {
      filteredEdges = filteredEdges.filter(e => options.edgeTypes!.includes(e.type));
    }

    // Remove orphan nodes if requested
    if (!options.includeOrphans) {
      const connectedNodeIds = new Set<string>();
      for (const edge of filteredEdges) {
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
      }
      filteredNodes = filteredNodes.filter(n => connectedNodeIds.has(n.id));
    }

    // Limit number of nodes
    if (options.maxNodes && filteredNodes.length > options.maxNodes) {
      // Sort by weight and strength, keep top nodes
      filteredNodes.sort((a, b) => (b.weight * b.strength) - (a.weight * a.strength));
      filteredNodes = filteredNodes.slice(0, options.maxNodes);

      const remainingIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = filteredEdges.filter(e =>
        remainingIds.has(e.source) && remainingIds.has(e.target)
      );
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }

  /**
   * Calculate graph statistics
   */
  private calculateStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
    const nodesByType: Record<GraphNodeType, number> = {
      memory: 0,
      topic: 0,
      entity: 0,
      session: 0,
      summary: 0,
      action: 0,
      fact: 0,
      preference: 0,
    };

    const edgesByType: Record<GraphEdgeType, number> = {
      contains: 0,
      related_to: 0,
      mentioned_in: 0,
      derived_from: 0,
      similar_to: 0,
      follows: 0,
      assigned_to: 0,
      categorized_as: 0,
    };

    let totalWeight = 0;
    let totalStrength = 0;
    let minDate = Infinity;
    let maxDate = 0;

    for (const node of nodes) {
      nodesByType[node.type]++;
      totalWeight += node.weight;
      totalStrength += node.strength;
      minDate = Math.min(minDate, node.createdAt);
      maxDate = Math.max(maxDate, node.createdAt);
    }

    for (const edge of edges) {
      edgesByType[edge.type]++;
    }

    // Find top connected nodes
    const topConnected = Array.from(this.connectionCounts.entries())
      .filter(([id]) => nodes.some(n => n.id === id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, connections]) => {
        const node = nodes.find(n => n.id === id);
        return {
          id,
          label: node?.label || id,
          connections,
        };
      });

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByType,
      edgesByType,
      averageWeight: nodes.length > 0 ? totalWeight / nodes.length : 0,
      averageStrength: nodes.length > 0 ? totalStrength / nodes.length : 0,
      topConnected,
      dateRange: {
        start: minDate === Infinity ? Date.now() : minDate,
        end: maxDate === 0 ? Date.now() : maxDate,
      },
    };
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Create a graph node with defaults
   */
  private createNode(params: Partial<GraphNode> & { id: string; type: GraphNodeType }): GraphNode {
    return {
      label: params.label || params.id,
      content: params.content || '',
      weight: params.weight ?? 0.5,
      createdAt: params.createdAt ?? Date.now(),
      accessedAt: params.accessedAt ?? Date.now(),
      strength: params.strength ?? 1,
      color: params.color || (params.category ? CATEGORY_COLORS[params.category] : NODE_COLORS[params.type]),
      size: params.size ?? this.config.baseNodeSize,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
      ...params,
    };
  }

  /**
   * Add an edge to the graph
   */
  private addEdge(params: {
    source: string;
    target: string;
    type: GraphEdgeType;
    weight?: number;
    label?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const id = `${params.source}-${params.type}-${params.target}`;

    if (this.edgeMap.has(id)) {
      return;
    }

    const edge: GraphEdge = {
      id,
      source: params.source,
      target: params.target,
      type: params.type,
      weight: params.weight ?? 0.5,
      label: params.label,
      color: EDGE_COLORS[params.type],
      metadata: params.metadata,
    };

    this.edgeMap.set(id, edge);
  }

  /**
   * Convert memory type to node type
   */
  private memoryTypeToNodeType(type: MemoryType): GraphNodeType {
    switch (type) {
      case 'fact':
        return 'fact';
      case 'preference':
        return 'preference';
      case 'conversation':
      case 'context':
      default:
        return 'memory';
    }
  }

  /**
   * Truncate text for label
   */
  private truncateLabel(text: string, maxLength = 40): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Calculate similarity between two tag arrays
   */
  private calculateTagSimilarity(tags1: string[], tags2: string[]): number {
    if (tags1.length === 0 || tags2.length === 0) {
      return 0;
    }

    const set1 = new Set(tags1.map(t => t.toLowerCase()));
    const set2 = new Set(tags2.map(t => t.toLowerCase()));

    let intersection = 0;
    for (const tag of set1) {
      if (set2.has(tag)) {
        intersection++;
      }
    }

    const union = new Set([...set1, ...set2]).size;
    return intersection / union;
  }

  /**
   * Categorize a topic string
   */
  private categorize(topic: string): string {
    const topicLower = topic.toLowerCase();

    if (CATEGORY_COLORS[topicLower]) {
      return topicLower;
    }

    return 'general';
  }

  /**
   * Check if a word is common (should be ignored for entities)
   */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
      'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'but', 'and', 'or',
      'if', 'then', 'else', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with',
      'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
      'again', 'further', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
      'september', 'october', 'november', 'december', 'today', 'tomorrow', 'yesterday',
    ]);

    return commonWords.has(word.toLowerCase());
  }

  /**
   * Adjust color opacity based on strength
   */
  private adjustColorOpacity(hexColor: string, opacity: number): string {
    // Parse hex color
    let r = 0, g = 0, b = 0;

    if (hexColor.startsWith('#')) {
      const hex = hexColor.slice(1);
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
    }

    // For full opacity, return original
    if (opacity >= 0.9) {
      return hexColor;
    }

    // Blend with dark background
    const blend = (c: number, factor: number) => Math.round(c * factor);

    const newR = blend(r, 0.5 + opacity * 0.5);
    const newG = blend(g, 0.5 + opacity * 0.5);
    const newB = blend(b, 0.5 + opacity * 0.5);

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  /**
   * Clear all graph data
   */
  private clear(): void {
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.connectionCounts.clear();
  }

  /**
   * Get a single node by ID
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(nodeId: string, edges: GraphEdge[]): GraphNode[] {
    const neighborIds = new Set<string>();

    for (const edge of edges) {
      if (edge.source === nodeId) {
        neighborIds.add(edge.target);
      }
      if (edge.target === nodeId) {
        neighborIds.add(edge.source);
      }
    }

    return Array.from(neighborIds)
      .map(id => this.nodeMap.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.clear();
    this.removeAllListeners();
    logger.info('GraphBuilder shutdown');
  }
}

// Singleton instance
let graphBuilderInstance: GraphBuilder | null = null;

/**
 * Get or create the graph builder instance
 */
export function getGraphBuilder(config?: Partial<GraphBuilderConfig>): GraphBuilder {
  if (!graphBuilderInstance) {
    graphBuilderInstance = new GraphBuilder(config);
  }
  return graphBuilderInstance;
}

/**
 * Shutdown the graph builder
 */
export function shutdownGraphBuilder(): void {
  if (graphBuilderInstance) {
    graphBuilderInstance.shutdown();
    graphBuilderInstance = null;
  }
}

export default GraphBuilder;
