/**
 * Knowledge Graph Module
 * Graph-based queries, path finding, centrality, and community detection
 */

export * from './types';
export * from './knowledge-graph-engine';

import { getKnowledgeGraphEngine } from './knowledge-graph-engine';

/**
 * Initialize the knowledge graph engine
 */
export function initializeKnowledgeGraph(): void {
  const engine = getKnowledgeGraphEngine();
  engine.clearCache();
}
