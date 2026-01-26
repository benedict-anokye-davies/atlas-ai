/**
 * Atlas Desktop - Knowledge Graph
 * Build semantic knowledge network for reasoning
 *
 * Features:
 * - Entity extraction
 * - Relationship mapping
 * - Graph traversal
 * - Semantic search
 * - Knowledge inference
 *
 * @module ml/knowledge-graph
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('KnowledgeGraph');

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeEntity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  properties: Record<string, unknown>;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
  confidence: number;
  sources: string[];
}

export type EntityType =
  | 'person'
  | 'organization'
  | 'location'
  | 'concept'
  | 'event'
  | 'skill'
  | 'project'
  | 'file'
  | 'tool'
  | 'topic';

export interface KnowledgeRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  properties: Record<string, unknown>;
  weight: number;
  confidence: number;
  createdAt: number;
  sources: string[];
}

export type RelationType =
  | 'related_to'
  | 'part_of'
  | 'works_with'
  | 'located_in'
  | 'created_by'
  | 'uses'
  | 'knows'
  | 'similar_to'
  | 'depends_on'
  | 'causes'
  | 'precedes'
  | 'includes';

export interface GraphQuery {
  startEntity?: string;
  entityTypes?: EntityType[];
  relationTypes?: RelationType[];
  maxDepth?: number;
  minConfidence?: number;
  limit?: number;
}

export interface GraphPath {
  nodes: KnowledgeEntity[];
  edges: KnowledgeRelation[];
  score: number;
}

export interface KnowledgeGraphConfig {
  maxEntities: number;
  maxRelations: number;
  defaultConfidence: number;
  decayRate: number;
  embeddingDim: number;
}

export interface KnowledgeGraphEvents {
  'entity-added': (entity: KnowledgeEntity) => void;
  'entity-updated': (entity: KnowledgeEntity) => void;
  'relation-added': (relation: KnowledgeRelation) => void;
  'inference-made': (inference: { entity: KnowledgeEntity; relations: KnowledgeRelation[] }) => void;
  error: (error: Error) => void;
}

// ============================================================================
// Knowledge Graph
// ============================================================================

export class KnowledgeGraph extends EventEmitter {
  private config: KnowledgeGraphConfig;
  private entities: Map<string, KnowledgeEntity> = new Map();
  private relations: Map<string, KnowledgeRelation> = new Map();
  private entityIndex: Map<string, Set<string>> = new Map(); // name/alias -> entity ids
  private adjacencyList: Map<string, Set<string>> = new Map(); // entity id -> relation ids
  private dataPath: string;

  // Stats
  private stats = {
    entitiesAdded: 0,
    relationsAdded: 0,
    queriesProcessed: 0,
    inferencesMade: 0,
  };

  constructor(config?: Partial<KnowledgeGraphConfig>) {
    super();
    this.config = {
      maxEntities: 100000,
      maxRelations: 500000,
      defaultConfidence: 0.5,
      decayRate: 0.99,
      embeddingDim: 64,
      ...config,
    };

    this.dataPath = path.join(app.getPath('userData'), 'knowledge-graph.json');
    this.loadData();

    logger.info('KnowledgeGraph initialized', { config: this.config });
  }

  // ============================================================================
  // Data Persistence
  // ============================================================================

  private loadData(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));

        // Load entities
        for (const entity of data.entities || []) {
          this.entities.set(entity.id, entity);
          this.indexEntity(entity);
        }

        // Load relations
        for (const relation of data.relations || []) {
          this.relations.set(relation.id, relation);
          this.indexRelation(relation);
        }

        logger.info('Loaded knowledge graph', {
          entities: this.entities.size,
          relations: this.relations.size,
        });
      }
    } catch (error) {
      logger.warn('Failed to load knowledge graph', { error });
    }
  }

  private saveData(): void {
    try {
      const data = {
        entities: Array.from(this.entities.values()),
        relations: Array.from(this.relations.values()),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('Failed to save knowledge graph', { error });
    }
  }

  // ============================================================================
  // Entity Operations
  // ============================================================================

  /**
   * Add or update an entity
   */
  addEntity(
    type: EntityType,
    name: string,
    properties: Record<string, unknown> = {},
    source?: string
  ): KnowledgeEntity {
    // Check if entity already exists
    const existingId = this.findEntityByName(name, type);
    if (existingId) {
      return this.updateEntity(existingId, properties, source);
    }

    // Create new entity
    const entity: KnowledgeEntity = {
      id: this.generateId('entity'),
      type,
      name: name.toLowerCase(),
      aliases: [],
      properties,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      confidence: this.config.defaultConfidence,
      sources: source ? [source] : [],
    };

    // Generate embedding
    entity.embedding = this.generateEmbedding(name, type, properties);

    this.entities.set(entity.id, entity);
    this.indexEntity(entity);
    this.stats.entitiesAdded++;

    this.emit('entity-added', entity);
    logger.debug('Entity added', { id: entity.id, type, name });

    // Enforce limits
    this.enforceEntityLimit();

    return entity;
  }

  /**
   * Update an entity
   */
  updateEntity(
    entityId: string,
    properties: Record<string, unknown>,
    source?: string
  ): KnowledgeEntity {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    // Merge properties
    entity.properties = { ...entity.properties, ...properties };
    entity.updatedAt = Date.now();
    entity.confidence = Math.min(entity.confidence + 0.1, 1);

    if (source && !entity.sources.includes(source)) {
      entity.sources.push(source);
    }

    // Update embedding
    entity.embedding = this.generateEmbedding(entity.name, entity.type, entity.properties);

    this.emit('entity-updated', entity);

    return entity;
  }

  /**
   * Add alias to entity
   */
  addAlias(entityId: string, alias: string): void {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    const normalizedAlias = alias.toLowerCase();
    if (!entity.aliases.includes(normalizedAlias)) {
      entity.aliases.push(normalizedAlias);
      this.indexAlias(entityId, normalizedAlias);
    }
  }

  /**
   * Delete entity
   */
  deleteEntity(entityId: string): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) return false;

    // Remove from indexes
    this.unindexEntity(entity);

    // Remove related relations
    const relatedRelations = this.adjacencyList.get(entityId) || new Set();
    for (const relationId of relatedRelations) {
      this.deleteRelation(relationId);
    }

    this.entities.delete(entityId);
    return true;
  }

  // ============================================================================
  // Relation Operations
  // ============================================================================

  /**
   * Add a relation between entities
   */
  addRelation(
    sourceId: string,
    targetId: string,
    type: RelationType,
    properties: Record<string, unknown> = {},
    source?: string
  ): KnowledgeRelation | null {
    // Verify entities exist
    if (!this.entities.has(sourceId) || !this.entities.has(targetId)) {
      logger.warn('Cannot add relation - entity not found', { sourceId, targetId });
      return null;
    }

    // Check for existing relation
    const existingRelation = this.findRelation(sourceId, targetId, type);
    if (existingRelation) {
      existingRelation.weight++;
      existingRelation.confidence = Math.min(existingRelation.confidence + 0.1, 1);
      return existingRelation;
    }

    const relation: KnowledgeRelation = {
      id: this.generateId('relation'),
      sourceId,
      targetId,
      type,
      properties,
      weight: 1,
      confidence: this.config.defaultConfidence,
      createdAt: Date.now(),
      sources: source ? [source] : [],
    };

    this.relations.set(relation.id, relation);
    this.indexRelation(relation);
    this.stats.relationsAdded++;

    this.emit('relation-added', relation);

    // Enforce limits
    this.enforceRelationLimit();

    return relation;
  }

  /**
   * Delete a relation
   */
  deleteRelation(relationId: string): boolean {
    const relation = this.relations.get(relationId);
    if (!relation) return false;

    // Remove from adjacency list
    this.adjacencyList.get(relation.sourceId)?.delete(relationId);
    this.adjacencyList.get(relation.targetId)?.delete(relationId);

    this.relations.delete(relationId);
    return true;
  }

  // ============================================================================
  // Indexing
  // ============================================================================

  private indexEntity(entity: KnowledgeEntity): void {
    // Index by name
    this.indexAlias(entity.id, entity.name);

    // Index by aliases
    for (const alias of entity.aliases) {
      this.indexAlias(entity.id, alias);
    }

    // Initialize adjacency list
    if (!this.adjacencyList.has(entity.id)) {
      this.adjacencyList.set(entity.id, new Set());
    }
  }

  private indexAlias(entityId: string, alias: string): void {
    const normalized = alias.toLowerCase();
    if (!this.entityIndex.has(normalized)) {
      this.entityIndex.set(normalized, new Set());
    }
    this.entityIndex.get(normalized)!.add(entityId);
  }

  private unindexEntity(entity: KnowledgeEntity): void {
    this.entityIndex.get(entity.name)?.delete(entity.id);
    for (const alias of entity.aliases) {
      this.entityIndex.get(alias)?.delete(entity.id);
    }
    this.adjacencyList.delete(entity.id);
  }

  private indexRelation(relation: KnowledgeRelation): void {
    // Add to adjacency lists
    this.adjacencyList.get(relation.sourceId)?.add(relation.id);
    this.adjacencyList.get(relation.targetId)?.add(relation.id);
  }

  // ============================================================================
  // Querying
  // ============================================================================

  /**
   * Find entity by name
   */
  findEntityByName(name: string, type?: EntityType): string | null {
    const normalized = name.toLowerCase();
    const entityIds = this.entityIndex.get(normalized);

    if (!entityIds || entityIds.size === 0) return null;

    for (const id of entityIds) {
      const entity = this.entities.get(id);
      if (entity && (!type || entity.type === type)) {
        return id;
      }
    }

    return null;
  }

  /**
   * Get entity by ID
   */
  getEntity(entityId: string): KnowledgeEntity | undefined {
    return this.entities.get(entityId);
  }

  /**
   * Get relation by ID
   */
  getRelation(relationId: string): KnowledgeRelation | undefined {
    return this.relations.get(relationId);
  }

  /**
   * Find relation between entities
   */
  findRelation(sourceId: string, targetId: string, type: RelationType): KnowledgeRelation | null {
    const relationIds = this.adjacencyList.get(sourceId) || new Set();

    for (const relationId of relationIds) {
      const relation = this.relations.get(relationId);
      if (relation && relation.targetId === targetId && relation.type === type) {
        return relation;
      }
    }

    return null;
  }

  /**
   * Get relations for entity
   */
  getRelations(entityId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): KnowledgeRelation[] {
    const relationIds = this.adjacencyList.get(entityId) || new Set();
    const relations: KnowledgeRelation[] = [];

    for (const relationId of relationIds) {
      const relation = this.relations.get(relationId);
      if (!relation) continue;

      if (
        direction === 'both' ||
        (direction === 'outgoing' && relation.sourceId === entityId) ||
        (direction === 'incoming' && relation.targetId === entityId)
      ) {
        relations.push(relation);
      }
    }

    return relations;
  }

  /**
   * Query the graph
   */
  query(query: GraphQuery): KnowledgeEntity[] {
    this.stats.queriesProcessed++;
    let results: KnowledgeEntity[] = [];

    if (query.startEntity) {
      // Start from specific entity
      const startId = this.findEntityByName(query.startEntity);
      if (startId) {
        results = this.traverseGraph(startId, query);
      }
    } else {
      // Search all entities
      for (const entity of this.entities.values()) {
        if (this.matchesQuery(entity, query)) {
          results.push(entity);
        }
      }
    }

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Traverse graph from starting entity
   */
  private traverseGraph(startId: string, query: GraphQuery): KnowledgeEntity[] {
    const visited = new Set<string>();
    const results: KnowledgeEntity[] = [];
    const maxDepth = query.maxDepth || 2;

    const traverse = (entityId: string, depth: number): void => {
      if (depth > maxDepth || visited.has(entityId)) return;

      visited.add(entityId);
      const entity = this.entities.get(entityId);
      if (!entity) return;

      if (this.matchesQuery(entity, query)) {
        results.push(entity);
      }

      // Get connected entities
      const relations = this.getRelations(entityId);
      for (const relation of relations) {
        if (query.relationTypes && !query.relationTypes.includes(relation.type)) continue;
        if (query.minConfidence && relation.confidence < query.minConfidence) continue;

        const nextId = relation.sourceId === entityId ? relation.targetId : relation.sourceId;
        traverse(nextId, depth + 1);
      }
    };

    traverse(startId, 0);
    return results;
  }

  /**
   * Check if entity matches query
   */
  private matchesQuery(entity: KnowledgeEntity, query: GraphQuery): boolean {
    if (query.entityTypes && !query.entityTypes.includes(entity.type)) return false;
    if (query.minConfidence && entity.confidence < query.minConfidence) return false;
    return true;
  }

  /**
   * Find shortest path between entities
   */
  findPath(sourceId: string, targetId: string, maxDepth = 5): GraphPath | null {
    const visited = new Set<string>();
    const queue: Array<{ entityId: string; path: KnowledgeEntity[]; edges: KnowledgeRelation[] }> = [];

    const startEntity = this.entities.get(sourceId);
    if (!startEntity) return null;

    queue.push({ entityId: sourceId, path: [startEntity], edges: [] });
    visited.add(sourceId);

    while (queue.length > 0) {
      const { entityId, path, edges } = queue.shift()!;

      if (entityId === targetId) {
        return {
          nodes: path,
          edges,
          score: this.calculatePathScore(path, edges),
        };
      }

      if (path.length > maxDepth) continue;

      const relations = this.getRelations(entityId);
      for (const relation of relations) {
        const nextId = relation.sourceId === entityId ? relation.targetId : relation.sourceId;

        if (!visited.has(nextId)) {
          visited.add(nextId);
          const nextEntity = this.entities.get(nextId);
          if (nextEntity) {
            queue.push({
              entityId: nextId,
              path: [...path, nextEntity],
              edges: [...edges, relation],
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate path score
   */
  private calculatePathScore(nodes: KnowledgeEntity[], edges: KnowledgeRelation[]): number {
    if (nodes.length === 0) return 0;

    const avgNodeConfidence = nodes.reduce((sum, n) => sum + n.confidence, 0) / nodes.length;
    const avgEdgeWeight = edges.length > 0 ? edges.reduce((sum, e) => sum + e.weight, 0) / edges.length : 1;
    const pathLengthPenalty = 1 / Math.sqrt(nodes.length);

    return avgNodeConfidence * avgEdgeWeight * pathLengthPenalty;
  }

  // ============================================================================
  // Semantic Search
  // ============================================================================

  /**
   * Search entities by semantic similarity
   */
  semanticSearch(query: string, type?: EntityType, limit = 10): KnowledgeEntity[] {
    const queryEmbedding = this.generateEmbedding(query, type || 'concept', {});
    const scored: Array<{ entity: KnowledgeEntity; score: number }> = [];

    for (const entity of this.entities.values()) {
      if (type && entity.type !== type) continue;
      if (!entity.embedding) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, entity.embedding);
      scored.push({ entity, score: similarity });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entity);
  }

  // ============================================================================
  // Inference
  // ============================================================================

  /**
   * Infer new relations based on patterns
   */
  infer(): Array<{ entity: KnowledgeEntity; relations: KnowledgeRelation[] }> {
    const inferences: Array<{ entity: KnowledgeEntity; relations: KnowledgeRelation[] }> = [];

    // Transitive closure for "part_of" relations
    for (const entity of this.entities.values()) {
      const partOfRelations = this.getRelations(entity.id, 'outgoing').filter((r) => r.type === 'part_of');

      for (const relation of partOfRelations) {
        const parentRelations = this.getRelations(relation.targetId, 'outgoing').filter((r) => r.type === 'part_of');

        for (const parentRelation of parentRelations) {
          // Check if transitive relation already exists
          if (!this.findRelation(entity.id, parentRelation.targetId, 'part_of')) {
            const newRelation = this.addRelation(entity.id, parentRelation.targetId, 'part_of', {
              inferred: true,
            });

            if (newRelation) {
              inferences.push({ entity, relations: [newRelation] });
              this.stats.inferencesMade++;
              this.emit('inference-made', { entity, relations: [newRelation] });
            }
          }
        }
      }
    }

    // Similar entities likely have similar relations
    for (const entity of this.entities.values()) {
      const similar = this.semanticSearch(entity.name, entity.type, 5);

      for (const similarEntity of similar) {
        if (similarEntity.id === entity.id) continue;

        const similarRelations = this.getRelations(similarEntity.id);
        const entityRelations = this.getRelations(entity.id);
        const entityTargets = new Set(entityRelations.map((r) => r.targetId));

        for (const relation of similarRelations) {
          if (!entityTargets.has(relation.targetId) && relation.confidence > 0.7) {
            const newRelation = this.addRelation(entity.id, relation.targetId, 'similar_to', {
              inferred: true,
              basedOn: similarEntity.id,
            });

            if (newRelation) {
              inferences.push({ entity, relations: [newRelation] });
              this.stats.inferencesMade++;
            }
          }
        }
      }
    }

    return inferences;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate simple embedding
   */
  private generateEmbedding(text: string, _type: EntityType, _properties: Record<string, unknown>): number[] {
    const embedding = new Array(this.config.embeddingDim).fill(0);

    // Simple character-based embedding
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const charCode = word.charCodeAt(j);
        const index = (i * 7 + j * 11 + charCode) % this.config.embeddingDim;
        embedding[index] += 1 / (i + 1);
      }
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private enforceEntityLimit(): void {
    if (this.entities.size <= this.config.maxEntities) return;

    // Remove lowest confidence entities
    const sorted = Array.from(this.entities.values()).sort((a, b) => a.confidence - b.confidence);

    const toRemove = sorted.slice(0, Math.floor(this.config.maxEntities * 0.1));
    for (const entity of toRemove) {
      this.deleteEntity(entity.id);
    }
  }

  private enforceRelationLimit(): void {
    if (this.relations.size <= this.config.maxRelations) return;

    const sorted = Array.from(this.relations.values()).sort((a, b) => a.confidence - b.confidence);

    const toRemove = sorted.slice(0, Math.floor(this.config.maxRelations * 0.1));
    for (const relation of toRemove) {
      this.deleteRelation(relation.id);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    entitiesAdded: number;
    relationsAdded: number;
    queriesProcessed: number;
    inferencesMade: number;
    totalEntities: number;
    totalRelations: number;
  } {
    return {
      ...this.stats,
      totalEntities: this.entities.size,
      totalRelations: this.relations.size,
    };
  }

  /**
   * Export graph to JSON
   */
  export(): { entities: KnowledgeEntity[]; relations: KnowledgeRelation[] } {
    return {
      entities: Array.from(this.entities.values()),
      relations: Array.from(this.relations.values()),
    };
  }

  /**
   * Save to disk
   */
  save(): void {
    this.saveData();
    logger.info('Knowledge graph saved');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let knowledgeGraph: KnowledgeGraph | null = null;

export function getKnowledgeGraph(): KnowledgeGraph {
  if (!knowledgeGraph) {
    knowledgeGraph = new KnowledgeGraph();
  }
  return knowledgeGraph;
}
