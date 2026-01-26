/**
 * Knowledge Graph Types
 */

import { EntityType, RelationshipType, OntologyEntity, OntologyRelationship } from '../types';

// ============================================================================
// GRAPH TYPES
// ============================================================================

/**
 * Node in the knowledge graph
 */
export interface GraphNode {
  id: string;
  type: EntityType;
  name: string;
  properties: Record<string, unknown>;
  degree: number;
  inDegree: number;
  outDegree: number;
  centralityScore?: number;
}

/**
 * Edge in the knowledge graph
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  weight: number;
  properties?: Record<string, unknown>;
}

/**
 * Path between two nodes
 */
export interface GraphPath {
  nodes: string[];
  edges: string[];
  length: number;
  weight: number;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Graph query options
 */
export interface GraphQueryOptions {
  maxDepth?: number;
  maxResults?: number;
  relationshipTypes?: RelationshipType[];
  entityTypes?: EntityType[];
  minStrength?: number;
  includeProperties?: boolean;
}

/**
 * Path finding options
 */
export interface PathFindingOptions {
  maxDepth?: number;
  maxPaths?: number;
  algorithm?: 'bfs' | 'dijkstra' | 'all_paths';
  weightField?: 'strength' | 'confidence' | 'count';
}

/**
 * Centrality calculation options
 */
export interface CentralityOptions {
  algorithm?: 'degree' | 'betweenness' | 'closeness' | 'pagerank';
  normalized?: boolean;
  directed?: boolean;
  dampingFactor?: number; // For PageRank
}

// ============================================================================
// COMMUNITY DETECTION
// ============================================================================

/**
 * Community/cluster in the graph
 */
export interface GraphCommunity {
  id: string;
  nodes: string[];
  size: number;
  density: number;
  label?: string;
  centralNode?: string;
}

// ============================================================================
// GRAPH STATISTICS
// ============================================================================

/**
 * Overall graph statistics
 */
export interface GraphStatistics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  averageDegree: number;
  clusteringCoefficient: number;
  connectedComponents: number;
  diameter?: number;
  nodesByType: Record<EntityType, number>;
  edgesByType: Record<RelationshipType, number>;
}

// ============================================================================
// SUBGRAPH TYPES
// ============================================================================

/**
 * Subgraph extracted from the main graph
 */
export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootNode?: string;
  metadata: {
    extractedAt: Date;
    query?: string;
    depth?: number;
  };
}

// ============================================================================
// RECOMMENDATION TYPES
// ============================================================================

/**
 * Recommended connection in the graph
 */
export interface ConnectionRecommendation {
  sourceId: string;
  targetId: string;
  score: number;
  reason: string;
  commonNeighbors?: string[];
  pathLength?: number;
}

// ============================================================================
// CONFIG
// ============================================================================

/**
 * Knowledge graph configuration
 */
export interface KnowledgeGraphConfig {
  maxCacheSize: number;
  cacheExpiryMs: number;
  defaultQueryDepth: number;
  enableCentralityCache: boolean;
  centralityCacheExpiryMs: number;
}

export const DEFAULT_KNOWLEDGE_GRAPH_CONFIG: KnowledgeGraphConfig = {
  maxCacheSize: 1000,
  cacheExpiryMs: 5 * 60 * 1000, // 5 minutes
  defaultQueryDepth: 3,
  enableCentralityCache: true,
  centralityCacheExpiryMs: 30 * 60 * 1000, // 30 minutes
};
