/**
 * Knowledge Graph Engine
 * Graph-based queries, path finding, centrality analysis
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getOntologyStore } from '../ontology/ontology-store';
import { EntityType, RelationshipType } from '../types';
import {
  GraphNode,
  GraphEdge,
  GraphPath,
  Subgraph,
  GraphCommunity,
  GraphStatistics,
  ConnectionRecommendation,
  GraphQueryOptions,
  PathFindingOptions,
  CentralityOptions,
  KnowledgeGraphConfig,
  DEFAULT_KNOWLEDGE_GRAPH_CONFIG,
} from './types';

const logger = createModuleLogger('KnowledgeGraph');

// ============================================================================
// KNOWLEDGE GRAPH ENGINE
// ============================================================================

export class KnowledgeGraphEngine extends EventEmitter {
  private config: KnowledgeGraphConfig;
  private nodeCache: Map<string, { node: GraphNode; expiresAt: number }> = new Map();
  private centralityCache: Map<string, { scores: Map<string, number>; expiresAt: number }> = new Map();

  constructor(config?: Partial<KnowledgeGraphConfig>) {
    super();
    this.config = { ...DEFAULT_KNOWLEDGE_GRAPH_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // NODE & EDGE RETRIEVAL
  // --------------------------------------------------------------------------

  /**
   * Get a node from the graph
   */
  async getNode(entityId: string): Promise<GraphNode | null> {
    // Check cache
    const cached = this.nodeCache.get(entityId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.node;
    }

    const store = getOntologyStore();
    const entity = store.getEntity(entityId);

    if (!entity) return null;

    // Get degree information
    const outgoing = store.getRelationships(entityId);
    const incoming = store.getIncomingRelationships(entityId);

    const node: GraphNode = {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      properties: { ...entity },
      degree: outgoing.length + incoming.length,
      inDegree: incoming.length,
      outDegree: outgoing.length,
    };

    // Cache the node
    this.nodeCache.set(entityId, {
      node,
      expiresAt: Date.now() + this.config.cacheExpiryMs,
    });

    return node;
  }

  /**
   * Get edges for a node
   */
  getEdges(
    entityId: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both'; types?: RelationshipType[] }
  ): GraphEdge[] {
    const store = getOntologyStore();
    const edges: GraphEdge[] = [];
    const direction = options?.direction || 'both';
    const types = options?.types;

    if (direction === 'outgoing' || direction === 'both') {
      const outgoing = store.getRelationships(entityId);
      for (const rel of outgoing) {
        if (!types || types.includes(rel.relationshipType)) {
          edges.push({
            id: rel.id,
            source: rel.sourceId,
            target: rel.targetId,
            type: rel.relationshipType,
            weight: rel.strength,
            properties: rel.properties,
          });
        }
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      const incoming = store.getIncomingRelationships(entityId);
      for (const rel of incoming) {
        if (!types || types.includes(rel.relationshipType)) {
          edges.push({
            id: rel.id,
            source: rel.sourceId,
            target: rel.targetId,
            type: rel.relationshipType,
            weight: rel.strength,
            properties: rel.properties,
          });
        }
      }
    }

    return edges;
  }

  // --------------------------------------------------------------------------
  // SUBGRAPH EXTRACTION
  // --------------------------------------------------------------------------

  /**
   * Extract a subgraph around a central node
   */
  async getSubgraph(
    rootId: string,
    options?: GraphQueryOptions
  ): Promise<Subgraph> {
    const maxDepth = options?.maxDepth ?? this.config.defaultQueryDepth;
    const maxResults = options?.maxResults ?? 100;
    const relationshipTypes = options?.relationshipTypes;
    const entityTypes = options?.entityTypes;
    const minStrength = options?.minStrength ?? 0;

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // BFS traversal
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

    while (queue.length > 0 && nodes.length < maxResults) {
      const { id, depth } = queue.shift()!;

      if (visitedNodes.has(id) || depth > maxDepth) continue;
      visitedNodes.add(id);

      const node = await this.getNode(id);
      if (!node) continue;

      // Filter by entity type
      if (entityTypes && !entityTypes.includes(node.type)) continue;

      nodes.push(node);

      // Get edges
      const nodeEdges = this.getEdges(id, { types: relationshipTypes });

      for (const edge of nodeEdges) {
        if (edge.weight < minStrength) continue;
        if (visitedEdges.has(edge.id)) continue;

        visitedEdges.add(edge.id);
        edges.push(edge);

        // Add connected node to queue
        const nextId = edge.source === id ? edge.target : edge.source;
        if (!visitedNodes.has(nextId)) {
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return {
      nodes,
      edges,
      rootNode: rootId,
      metadata: {
        extractedAt: new Date(),
        depth: maxDepth,
      },
    };
  }

  /**
   * Get neighbors of a node
   */
  async getNeighbors(
    entityId: string,
    options?: GraphQueryOptions
  ): Promise<GraphNode[]> {
    const edges = this.getEdges(entityId, {
      types: options?.relationshipTypes,
    });

    const neighborIds = new Set<string>();
    for (const edge of edges) {
      const neighborId = edge.source === entityId ? edge.target : edge.source;
      neighborIds.add(neighborId);
    }

    const neighbors: GraphNode[] = [];
    for (const id of neighborIds) {
      const node = await this.getNode(id);
      if (node) {
        if (options?.entityTypes && !options.entityTypes.includes(node.type)) {
          continue;
        }
        neighbors.push(node);
      }
    }

    return neighbors;
  }

  // --------------------------------------------------------------------------
  // PATH FINDING
  // --------------------------------------------------------------------------

  /**
   * Find shortest path between two nodes
   */
  async findShortestPath(
    sourceId: string,
    targetId: string,
    options?: PathFindingOptions
  ): Promise<GraphPath | null> {
    const maxDepth = options?.maxDepth ?? 10;
    const algorithm = options?.algorithm ?? 'bfs';

    if (algorithm === 'dijkstra') {
      return this.dijkstraPath(sourceId, targetId, maxDepth, options?.weightField);
    }

    return this.bfsPath(sourceId, targetId, maxDepth);
  }

  /**
   * BFS-based shortest path
   */
  private bfsPath(sourceId: string, targetId: string, maxDepth: number): GraphPath | null {
    const visited = new Map<string, { parent: string | null; edge: string | null }>();
    const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];

    visited.set(sourceId, { parent: null, edge: null });

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (id === targetId) {
        return this.reconstructPath(sourceId, targetId, visited);
      }

      if (depth >= maxDepth) continue;

      const edges = this.getEdges(id);
      for (const edge of edges) {
        const nextId = edge.source === id ? edge.target : edge.source;

        if (!visited.has(nextId)) {
          visited.set(nextId, { parent: id, edge: edge.id });
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return null;
  }

  /**
   * Dijkstra's algorithm for weighted shortest path
   */
  private dijkstraPath(
    sourceId: string,
    targetId: string,
    maxDepth: number,
    weightField?: 'strength' | 'confidence' | 'count'
  ): GraphPath | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, { node: string; edge: string }>();
    const unvisited = new Set<string>();

    distances.set(sourceId, 0);
    unvisited.add(sourceId);

    // Initialize with BFS to find reachable nodes
    const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      unvisited.add(id);
      distances.set(id, Infinity);

      const edges = this.getEdges(id);
      for (const edge of edges) {
        const nextId = edge.source === id ? edge.target : edge.source;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    distances.set(sourceId, 0);

    while (unvisited.size > 0) {
      // Find node with minimum distance
      let minNode: string | null = null;
      let minDist = Infinity;

      for (const node of unvisited) {
        const dist = distances.get(node) ?? Infinity;
        if (dist < minDist) {
          minDist = dist;
          minNode = node;
        }
      }

      if (minNode === null || minDist === Infinity) break;
      if (minNode === targetId) break;

      unvisited.delete(minNode);

      const edges = this.getEdges(minNode);
      for (const edge of edges) {
        const neighborId = edge.source === minNode ? edge.target : edge.source;

        if (!unvisited.has(neighborId)) continue;

        // Calculate edge weight (inverse of strength for shortest path)
        const weight = this.getEdgeWeight(edge, weightField);
        const alt = minDist + weight;

        if (alt < (distances.get(neighborId) ?? Infinity)) {
          distances.set(neighborId, alt);
          previous.set(neighborId, { node: minNode, edge: edge.id });
        }
      }
    }

    // Reconstruct path
    if (!previous.has(targetId) && sourceId !== targetId) {
      return null;
    }

    const nodes: string[] = [];
    const edges: string[] = [];
    let current = targetId;

    while (current !== sourceId) {
      nodes.unshift(current);
      const prev = previous.get(current);
      if (!prev) break;
      edges.unshift(prev.edge);
      current = prev.node;
    }
    nodes.unshift(sourceId);

    return {
      nodes,
      edges,
      length: nodes.length - 1,
      weight: distances.get(targetId) ?? Infinity,
    };
  }

  private getEdgeWeight(edge: GraphEdge, weightField?: 'strength' | 'confidence' | 'count'): number {
    // Inverse weight - higher strength = lower cost
    const value = edge.weight || 0.5;
    return 1 - value + 0.1; // Add small constant to avoid 0 weights
  }

  private reconstructPath(
    sourceId: string,
    targetId: string,
    visited: Map<string, { parent: string | null; edge: string | null }>
  ): GraphPath {
    const nodes: string[] = [];
    const edges: string[] = [];
    let current: string | null = targetId;

    while (current) {
      nodes.unshift(current);
      const info = visited.get(current);
      if (info?.edge) {
        edges.unshift(info.edge);
      }
      current = info?.parent ?? null;
    }

    return {
      nodes,
      edges,
      length: nodes.length - 1,
      weight: nodes.length - 1, // Unweighted path
    };
  }

  /**
   * Find all paths between two nodes (up to limit)
   */
  async findAllPaths(
    sourceId: string,
    targetId: string,
    options?: PathFindingOptions
  ): Promise<GraphPath[]> {
    const maxDepth = options?.maxDepth ?? 5;
    const maxPaths = options?.maxPaths ?? 10;
    const paths: GraphPath[] = [];

    const dfs = (
      current: string,
      target: string,
      visited: Set<string>,
      currentPath: string[],
      currentEdges: string[],
      depth: number
    ) => {
      if (paths.length >= maxPaths) return;
      if (depth > maxDepth) return;
      if (visited.has(current)) return;

      currentPath.push(current);
      visited.add(current);

      if (current === target) {
        paths.push({
          nodes: [...currentPath],
          edges: [...currentEdges],
          length: currentPath.length - 1,
          weight: currentPath.length - 1,
        });
      } else {
        const edges = this.getEdges(current);
        for (const edge of edges) {
          const nextId = edge.source === current ? edge.target : edge.source;
          currentEdges.push(edge.id);
          dfs(nextId, target, visited, currentPath, currentEdges, depth + 1);
          currentEdges.pop();
        }
      }

      currentPath.pop();
      visited.delete(current);
    };

    dfs(sourceId, targetId, new Set(), [], [], 0);

    return paths.sort((a, b) => a.length - b.length);
  }

  // --------------------------------------------------------------------------
  // CENTRALITY ANALYSIS
  // --------------------------------------------------------------------------

  /**
   * Calculate centrality scores for nodes
   */
  async calculateCentrality(
    options?: CentralityOptions
  ): Promise<Map<string, number>> {
    const algorithm = options?.algorithm ?? 'degree';
    const cacheKey = `${algorithm}_${options?.normalized ?? true}`;

    // Check cache
    const cached = this.centralityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.scores;
    }

    let scores: Map<string, number>;

    switch (algorithm) {
      case 'degree':
        scores = await this.degreeCentrality(options?.normalized ?? true);
        break;
      case 'betweenness':
        scores = await this.betweennessCentrality(options?.normalized ?? true);
        break;
      case 'closeness':
        scores = await this.closenessCentrality(options?.normalized ?? true);
        break;
      case 'pagerank':
        scores = await this.pageRank(options?.dampingFactor ?? 0.85);
        break;
      default:
        scores = await this.degreeCentrality(true);
    }

    // Cache results
    if (this.config.enableCentralityCache) {
      this.centralityCache.set(cacheKey, {
        scores,
        expiresAt: Date.now() + this.config.centralityCacheExpiryMs,
      });
    }

    return scores;
  }

  /**
   * Degree centrality - number of connections
   */
  private async degreeCentrality(normalized: boolean): Promise<Map<string, number>> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(10000);
    const scores = new Map<string, number>();
    let maxDegree = 0;

    for (const entity of entities) {
      const outgoing = store.getRelationships(entity.id);
      const incoming = store.getIncomingRelationships(entity.id);
      const degree = outgoing.length + incoming.length;
      scores.set(entity.id, degree);
      maxDegree = Math.max(maxDegree, degree);
    }

    if (normalized && maxDegree > 0) {
      for (const [id, score] of scores) {
        scores.set(id, score / maxDegree);
      }
    }

    return scores;
  }

  /**
   * Betweenness centrality - how often node is on shortest paths
   */
  private async betweennessCentrality(normalized: boolean): Promise<Map<string, number>> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(500); // Limit for performance
    const scores = new Map<string, number>();

    // Initialize scores
    for (const entity of entities) {
      scores.set(entity.id, 0);
    }

    // For each pair of nodes, find shortest path and count intermediaries
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const path = await this.findShortestPath(entities[i].id, entities[j].id, { maxDepth: 5 });

        if (path && path.length > 1) {
          // Count intermediate nodes (not source or target)
          for (let k = 1; k < path.nodes.length - 1; k++) {
            const nodeId = path.nodes[k];
            scores.set(nodeId, (scores.get(nodeId) ?? 0) + 1);
          }
        }
      }
    }

    // Normalize
    if (normalized) {
      const n = entities.length;
      const normFactor = (n - 1) * (n - 2) / 2;

      if (normFactor > 0) {
        for (const [id, score] of scores) {
          scores.set(id, score / normFactor);
        }
      }
    }

    return scores;
  }

  /**
   * Closeness centrality - inverse of average distance to all other nodes
   */
  private async closenessCentrality(normalized: boolean): Promise<Map<string, number>> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(500);
    const scores = new Map<string, number>();

    for (const entity of entities) {
      let totalDistance = 0;
      let reachableCount = 0;

      for (const other of entities) {
        if (other.id === entity.id) continue;

        const path = await this.findShortestPath(entity.id, other.id, { maxDepth: 5 });
        if (path) {
          totalDistance += path.length;
          reachableCount++;
        }
      }

      if (reachableCount > 0) {
        const closeness = reachableCount / totalDistance;
        scores.set(entity.id, normalized ? closeness / (entities.length - 1) : closeness);
      } else {
        scores.set(entity.id, 0);
      }
    }

    return scores;
  }

  /**
   * PageRank algorithm
   */
  private async pageRank(dampingFactor: number): Promise<Map<string, number>> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(1000);
    const n = entities.length;

    if (n === 0) return new Map();

    // Initialize scores equally
    let scores = new Map<string, number>();
    for (const entity of entities) {
      scores.set(entity.id, 1 / n);
    }

    // Build adjacency lists
    const outLinks = new Map<string, string[]>();
    for (const entity of entities) {
      const edges = this.getEdges(entity.id, { direction: 'outgoing' });
      outLinks.set(entity.id, edges.map(e => e.target));
    }

    // Iterate
    const iterations = 20;
    for (let iter = 0; iter < iterations; iter++) {
      const newScores = new Map<string, number>();

      for (const entity of entities) {
        let rank = (1 - dampingFactor) / n;

        // Sum contributions from incoming links
        for (const other of entities) {
          const otherLinks = outLinks.get(other.id) ?? [];
          if (otherLinks.includes(entity.id)) {
            rank += dampingFactor * (scores.get(other.id) ?? 0) / otherLinks.length;
          }
        }

        newScores.set(entity.id, rank);
      }

      scores = newScores;
    }

    return scores;
  }

  // --------------------------------------------------------------------------
  // COMMUNITY DETECTION
  // --------------------------------------------------------------------------

  /**
   * Detect communities in the graph using label propagation
   */
  async detectCommunities(): Promise<GraphCommunity[]> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(1000);

    // Initialize each node with unique label
    const labels = new Map<string, string>();
    for (const entity of entities) {
      labels.set(entity.id, entity.id);
    }

    // Iterate label propagation
    const maxIterations = 10;
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;

      // Shuffle order for fairness
      const shuffled = [...entities].sort(() => Math.random() - 0.5);

      for (const entity of shuffled) {
        const neighbors = await this.getNeighbors(entity.id);
        if (neighbors.length === 0) continue;

        // Count neighbor labels
        const labelCounts = new Map<string, number>();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor.id)!;
          labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        }

        // Find most common label
        let maxCount = 0;
        let bestLabel = labels.get(entity.id)!;
        for (const [label, count] of labelCounts) {
          if (count > maxCount) {
            maxCount = count;
            bestLabel = label;
          }
        }

        if (bestLabel !== labels.get(entity.id)) {
          labels.set(entity.id, bestLabel);
          changed = true;
        }
      }

      if (!changed) break;
    }

    // Group by label
    const communities = new Map<string, string[]>();
    for (const [nodeId, label] of labels) {
      if (!communities.has(label)) {
        communities.set(label, []);
      }
      communities.get(label)!.push(nodeId);
    }

    // Build community objects
    const result: GraphCommunity[] = [];
    let communityIndex = 0;

    for (const [_, nodeIds] of communities) {
      if (nodeIds.length < 2) continue; // Skip singletons

      // Calculate density
      let edgeCount = 0;
      for (const nodeId of nodeIds) {
        const edges = this.getEdges(nodeId);
        edgeCount += edges.filter(e => nodeIds.includes(e.target) || nodeIds.includes(e.source)).length;
      }
      edgeCount /= 2; // Each edge counted twice

      const maxEdges = (nodeIds.length * (nodeIds.length - 1)) / 2;
      const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

      // Find central node (highest degree within community)
      let centralNode = nodeIds[0];
      let maxDegree = 0;
      for (const nodeId of nodeIds) {
        const edges = this.getEdges(nodeId);
        const internalDegree = edges.filter(e => nodeIds.includes(e.target) || nodeIds.includes(e.source)).length;
        if (internalDegree > maxDegree) {
          maxDegree = internalDegree;
          centralNode = nodeId;
        }
      }

      result.push({
        id: `community_${communityIndex++}`,
        nodes: nodeIds,
        size: nodeIds.length,
        density,
        centralNode,
      });
    }

    return result.sort((a, b) => b.size - a.size);
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  /**
   * Get overall graph statistics
   */
  async getStatistics(): Promise<GraphStatistics> {
    const store = getOntologyStore();
    const entities = store.getAllEntities(10000);
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};

    let totalDegree = 0;
    const edgeIds = new Set<string>();

    for (const entity of entities) {
      // Count by type
      nodesByType[entity.type] = (nodesByType[entity.type] ?? 0) + 1;

      // Get edges
      const edges = this.getEdges(entity.id);
      for (const edge of edges) {
        if (!edgeIds.has(edge.id)) {
          edgeIds.add(edge.id);
          edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
        }
      }

      totalDegree += edges.length;
    }

    const nodeCount = entities.length;
    const edgeCount = edgeIds.size;
    const maxEdges = (nodeCount * (nodeCount - 1)) / 2;
    const density = maxEdges > 0 ? edgeCount / maxEdges : 0;
    const averageDegree = nodeCount > 0 ? totalDegree / nodeCount : 0;

    // Count connected components
    const visited = new Set<string>();
    let connectedComponents = 0;

    for (const entity of entities) {
      if (!visited.has(entity.id)) {
        connectedComponents++;
        const queue = [entity.id];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);

          const neighbors = await this.getNeighbors(current);
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor.id)) {
              queue.push(neighbor.id);
            }
          }
        }
      }
    }

    return {
      nodeCount,
      edgeCount,
      density,
      averageDegree,
      clusteringCoefficient: 0, // Would require additional calculation
      connectedComponents,
      nodesByType: nodesByType as Record<EntityType, number>,
      edgesByType: edgesByType as Record<RelationshipType, number>,
    };
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  /**
   * Recommend potential connections based on common neighbors
   */
  async recommendConnections(
    entityId: string,
    limit: number = 10
  ): Promise<ConnectionRecommendation[]> {
    const recommendations: ConnectionRecommendation[] = [];
    const directNeighbors = await this.getNeighbors(entityId);
    const directNeighborIds = new Set(directNeighbors.map(n => n.id));

    // Find friends of friends
    const secondDegree = new Map<string, string[]>();

    for (const neighbor of directNeighbors) {
      const neighborsOfNeighbor = await this.getNeighbors(neighbor.id);

      for (const candidate of neighborsOfNeighbor) {
        if (candidate.id === entityId) continue;
        if (directNeighborIds.has(candidate.id)) continue;

        if (!secondDegree.has(candidate.id)) {
          secondDegree.set(candidate.id, []);
        }
        secondDegree.get(candidate.id)!.push(neighbor.id);
      }
    }

    // Score by number of common neighbors
    for (const [candidateId, commonNeighbors] of secondDegree) {
      const score = commonNeighbors.length / (directNeighbors.length || 1);

      recommendations.push({
        sourceId: entityId,
        targetId: candidateId,
        score,
        reason: `${commonNeighbors.length} mutual connections`,
        commonNeighbors,
        pathLength: 2,
      });
    }

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // CACHE MANAGEMENT
  // --------------------------------------------------------------------------

  clearCache(): void {
    this.nodeCache.clear();
    this.centralityCache.clear();
    logger.debug('Knowledge graph cache cleared');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: KnowledgeGraphEngine | null = null;

export function getKnowledgeGraphEngine(): KnowledgeGraphEngine {
  if (!instance) {
    instance = new KnowledgeGraphEngine();
  }
  return instance;
}
